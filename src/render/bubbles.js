// Thruster / payload bubbles: one THREE.Points draw call over a ring-buffer
// pool. Simulated on the CPU (typed arrays, no per-frame allocations) and
// drawn as small silvery bubbles with a bright rim, a clear centre and a
// highlight, all procedural from gl_PointCoord. Positions / velocities are
// three.js world coordinates (metres, m/s; Y up, water surface at Y ~ 0).
//
//   const bubbles = createBubbles(scene, { max: 2000 });
//   bubbles.emit(x, y, z, vx, vy, vz, count, size);  // size = bubble diameter, m
//   bubbles.update(dt, time, (x, z) => surfaceY);    // once per frame
//
// Point sizes follow the current viewport automatically (read at draw time),
// or from setViewportHeight(px) in device pixels when the caller sets it.
// The pool hooks scene.onBeforeRender to draw after the water surface for
// cameras under water and before it for cameras above (dispose() unhooks).

import * as THREE from 'three';

const VS = /* glsl */`
uniform float uViewH, uSizeScale;
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  if (aAlpha <= 0.0) { // dead slot: off-screen, no fragments
    vAlpha = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float dist = projectionMatrix[2][3] < -0.5 ? max(-mvPosition.z, 0.01) : 1.0; // perspective vs ortho
  float px = aSize * uSizeScale * uViewH * 0.5 * projectionMatrix[1][1] / dist;
  // a ring can't be resolved below ~2.5 px: keep a small dot and fade it by area
  gl_PointSize = clamp(px, 2.5, 96.0);
  vAlpha = aAlpha * min(1.0, px * px / 6.25);
  #include <fog_vertex>
}`;

const FS = /* glsl */`
uniform vec3 uColor, uEnv;
uniform float uOpacity;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float r = length(p);
  if (r > 1.0 || vAlpha <= 0.0) discard;
  float edge = 1.0 - smoothstep(0.8, 1.0, r);
  float rim = smoothstep(0.35, 0.85, r) * edge;                    // bright rim, clear centre
  float hl = 1.0 - smoothstep(0.0, 0.3, length(p - vec2(-0.3, 0.35))); // sky highlight
  vec3 base = mix(uColor, uEnv * 2.5, 0.35);                       // pick up the water's tint
  vec3 col = base * (0.75 + 0.5 * rim) + vec3(0.6 * hl);
  float a = (0.08 + 0.8 * rim * rim + 0.75 * hl) * vAlpha * uOpacity;
  gl_FragColor = vec4(col, min(a, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      gl_FragColor.a *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      gl_FragColor.a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #endif
}`;

const STRIDE = 6; // x y z size alpha seed
const TAU_WASH = 0.25; // s, decay of the thruster wash velocity
const TAU_RISE = 0.2; // s, approach to the terminal rise speed
const SURFACE_GAP = 0.02; // m, bubbles pop this far below the surface
const P_ATM = 10.3; // m of water per atmosphere (bubble growth with ascent)
const flat = () => 0;

export function createBubbles(scene, { max = 2000 } = {}) {
  max = Math.max(1, Math.floor(max));

  // GPU data (interleaved) + CPU-only state
  const gpu = new Float32Array(max * STRIDE);
  const base = new Float32Array(max * 3); // position without the wobble
  const vel = new Float32Array(max * 3); // wash velocity (decays)
  const rise = new Float32Array(max); // current rise speed
  const vt = new Float32Array(max); // terminal rise speed
  const age = new Float32Array(max);
  const life = new Float32Array(max); // 0 = dead slot
  const d0 = new Float32Array(max); // diameter at spawn
  const z0 = new Float32Array(max); // depth below the surface at spawn
  const wob = new Float32Array(max * 4); // amp1, freq1, amp2, freq2
  let head = 0, alive = 0, hi = -1, dirty = false;
  let waveFn = flat;

  // small deterministic PRNG (mulberry32)
  let rs = 0x9e3779b9;
  const rnd = () => {
    rs = (rs + 0x6d2b79f5) | 0;
    let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const ib = new THREE.InterleavedBuffer(gpu, STRIDE);
  ib.setUsage(THREE.DynamicDrawUsage);
  const range = { start: 0, count: 0 }; // reused upload range
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
  geo.setAttribute('aSize', new THREE.InterleavedBufferAttribute(ib, 1, 3));
  geo.setAttribute('aAlpha', new THREE.InterleavedBufferAttribute(ib, 1, 4));
  geo.setAttribute('aSeed', new THREE.InterleavedBufferAttribute(ib, 1, 5));
  geo.setDrawRange(0, 0);

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uViewH: { value: 800 }, uSizeScale: { value: 1 }, uOpacity: { value: 1 },
    uColor: { value: new THREE.Color(0xe8f6ff) }, uEnv: { value: new THREE.Color(0x3aa6c9) },
  }]);
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VS, fragmentShader: FS, fog: true, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, material);
  points.name = 'bubbles';
  points.frustumCulled = false;
  points.renderOrder = 3;

  // per draw: point scale from the current viewport, tint from the current fog
  let manualH = 0;
  const _vp = new THREE.Vector4();
  points.onBeforeRender = (renderer, sc) => {
    let h = manualH;
    if (!(h > 0)) { renderer.getCurrentViewport(_vp); h = _vp.w || 800; }
    uniforms.uViewH.value = h;
    if (sc && sc.fog && sc.fog.color) uniforms.uEnv.value.copy(sc.fog.color);
    material.uniformsNeedUpdate = true;
  };

  // per camera: draw after the water surface (renderOrder 2) when the camera is
  // under water, before it when above, so the surface tints bubbles from above
  const _c = new THREE.Vector3();
  const ownHook = Object.prototype.hasOwnProperty.call(scene, 'onBeforeRender');
  const prevHook = scene.onBeforeRender;
  const hook = function (renderer, sc, camera, rt) {
    if (camera) {
      camera.getWorldPosition(_c);
      points.renderOrder = _c.y < waveFn(_c.x, _c.z) ? 3 : 1;
    }
    return prevHook.call(this, renderer, sc, camera, rt);
  };
  scene.onBeforeRender = hook;
  scene.add(points);

  function kill(i) {
    life[i] = 0;
    gpu[i * STRIDE + 4] = 0;
  }

  function emit(x, y, z, vx = 0, vy = 0, vz = 0, count = 1, size = 0.01) {
    // fractional counts are rounded stochastically (emit(..., rate * dt) works)
    let n = Math.floor(count);
    if (rnd() < count - n) n++;
    if (n <= 0 || !(size > 0)) return;
    const jit = 0.006 + size;
    for (let k = 0; k < n; k++) {
      const px = x + (rnd() - 0.5) * 2 * jit, py = y + (rnd() - 0.5) * 2 * jit, pz = z + (rnd() - 0.5) * 2 * jit;
      const wy = waveFn(px, pz);
      if (py >= wy - SURFACE_GAP) continue; // above / at the surface: nothing to show
      const i = head;
      head = (head + 1) % max; // ring: the oldest bubble is recycled when full
      if (life[i] <= 0) alive++;
      const s = rnd();
      const d = size * (0.6 + 0.7 * rnd());
      base[i * 3] = px; base[i * 3 + 1] = py; base[i * 3 + 2] = pz;
      const vj = 0.85 + 0.3 * rnd();
      vel[i * 3] = vx * vj + (rnd() - 0.5) * 0.08;
      vel[i * 3 + 1] = vy * vj + (rnd() - 0.5) * 0.08;
      vel[i * 3 + 2] = vz * vj + (rnd() - 0.5) * 0.08;
      vt[i] = (0.15 + 0.15 * Math.min(1, d / 0.01)) * (0.92 + 0.16 * rnd()); // ~0.15-0.3 m/s
      rise[i] = 0;
      age[i] = 0;
      life[i] = 6.5 + 1.5 * rnd(); // <= 8 s
      d0[i] = d;
      z0[i] = wy - py;
      wob[i * 4] = 0.004 + 0.5 * d; // fast zig-zag (m)
      wob[i * 4 + 1] = 2 * Math.PI * (1.6 + 1.2 * s);
      wob[i * 4 + 2] = 0.012 + 0.01 * rnd(); // slow drift (m)
      wob[i * 4 + 3] = 2 * Math.PI * (0.3 + 0.4 * rnd());
      const o = i * STRIDE;
      gpu[o] = px; gpu[o + 1] = py; gpu[o + 2] = pz;
      gpu[o + 3] = d; gpu[o + 4] = 0; gpu[o + 5] = s; // fades in during update
      if (i > hi) hi = i;
      dirty = true;
    }
  }

  // time is accepted for API symmetry; the motion runs on each bubble's age
  function update(dt, time = 0, waveY = flat) {
    waveFn = typeof waveY === 'function' ? waveY : flat;
    if (!(dt >= 0)) dt = 0;
    if (alive === 0 && !dirty) return;
    const wash = Math.exp(-dt / TAU_WASH), riseK = 1 - Math.exp(-dt / TAU_RISE);
    let top = -1, n = 0;
    for (let i = 0, end = hi; i <= end; i++) {
      if (life[i] <= 0) continue;
      const a = (age[i] += dt);
      if (a >= life[i]) { kill(i); dirty = true; continue; }
      const j = i * 3;
      const vx = (vel[j] *= wash), vy = (vel[j + 1] *= wash), vz = (vel[j + 2] *= wash);
      const r = (rise[i] += (vt[i] - rise[i]) * riseK);
      const bx = (base[j] += vx * dt), by = (base[j + 1] += (vy + r) * dt), bz = (base[j + 2] += vz * dt);
      const wy = waveFn(bx, bz);
      if (by >= wy - SURFACE_GAP) { kill(i); dirty = true; continue; } // popped at the surface
      // sideways wobble (zig-zag + slow spiral), ramping in as the wash dies down
      const w = i * 4, ph = gpu[i * STRIDE + 5] * 6.2832, ramp = Math.min(1, a * 2);
      const ox = (wob[w] * Math.sin(wob[w + 1] * a + ph) + wob[w + 2] * Math.sin(wob[w + 3] * a + ph * 1.7)) * ramp;
      const oz = (wob[w] * Math.cos(wob[w + 1] * a * 0.83 + ph) + wob[w + 2] * Math.cos(wob[w + 3] * a + ph * 2.3)) * ramp;
      // grows as the pressure drops on the way up (and a little with age)
      const dep = Math.max(0, wy - by);
      const grow = Math.cbrt((P_ATM + z0[i]) / (P_ATM + dep)) * (1 + 0.02 * a);
      const o = i * STRIDE;
      gpu[o] = bx + ox; gpu[o + 1] = by; gpu[o + 2] = bz + oz;
      gpu[o + 3] = d0[i] * grow;
      gpu[o + 4] = Math.min(1, a / 0.08) * Math.min(1, (life[i] - a) / 0.6);
      top = i; n++;
    }
    alive = n;
    hi = top;
    geo.setDrawRange(0, hi + 1);
    if (dirty || n > 0) {
      // upload the live prefix only (the reused range object avoids garbage)
      ib.updateRanges.length = 0;
      if (hi >= 0) {
        range.count = (hi + 1) * STRIDE;
        ib.updateRanges.push(range);
        ib.needsUpdate = true;
      }
    }
    dirty = false;
  }

  function clear() {
    life.fill(0);
    for (let i = 0; i < max; i++) gpu[i * STRIDE + 4] = 0;
    alive = 0; hi = -1; head = 0; dirty = false;
    geo.setDrawRange(0, 0);
  }

  return {
    points,
    emit,
    update,
    clear,
    // point-size reference in device pixels (rect.h * pixelRatio); 0 = read the
    // current viewport at draw time (the default)
    setViewportHeight(px) { manualH = px > 0 ? px : 0; },
    get count() { return alive; },
    dispose() {
      scene.remove(points);
      if (scene.onBeforeRender === hook) {
        if (ownHook) scene.onBeforeRender = prevHook;
        else delete scene.onBeforeRender;
      }
      geo.dispose();
      material.dispose();
    },
  };
}
