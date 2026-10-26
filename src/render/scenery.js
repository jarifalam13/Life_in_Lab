// Environment scenery for the water scenarios (pool / pacific / arctic):
// lights, wave-following water surface, caustic floor, walls or seabed, life,
// particles, god rays, arena buoy line and the DUBURI logo banners / sign.
// three.js world = (east, up, south); water surface at Y = 0, arena floor at Y = -depth.
// Everything random is seeded, everything animated runs on shared uniforms
// (plus a few dozen instance matrices for fish / jellyfish).

import * as THREE from 'three';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- utilities

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// merge geometries (position / normal / uv, plus color when every part has it)
function merge(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) { if (!g.attributes.normal) g.computeVertexNormals(); n += g.attributes.position.count; }
  const hasColor = parts.every((g) => g.attributes.color);
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), T = new Float32Array(n * 2), C = hasColor ? new Float32Array(n * 3) : null;
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) T.set(g.attributes.uv.array, o * 2);
    if (C) C.set(g.attributes.color.array, o * 3);
    o += c;
  }
  for (const g of geos) g.dispose();
  for (const g of parts) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(T, 2));
  if (C) out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.computeBoundingSphere();
  return out;
}

function colored(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

// ---------------------------------------------------------------- canvas textures

function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext && c.getContext('2d');
  return g ? { c, g } : null;
}

function toTexture(cv, srgb = true) {
  const t = new THREE.CanvasTexture(cv.c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8; // clamped by three to the GPU max
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// tileable value noise on a G x G lattice, domain [0,1)^2
function valueNoise(G, rnd) {
  const L = new Float32Array(G * G).map(() => rnd());
  return (u, v) => {
    const x = u * G, y = v * G, xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % G) + G) % G, y0 = ((yi % G) + G) % G, x1 = (x0 + 1) % G, y1 = (y0 + 1) % G;
    const a = L[y0 * G + x0], b = L[y0 * G + x1], c = L[y1 * G + x0], d = L[y1 * G + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

// tileable Worley noise: writes [d1, d2, cellId] into out
function worley(G, rnd) {
  const jx = new Float32Array(G * G).map(() => rnd()), jy = new Float32Array(G * G).map(() => rnd());
  return (u, v, out) => {
    const x = u * G, y = v * G, xi = Math.floor(x), yi = Math.floor(y);
    let d1 = 9, d2 = 9, id = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy, k = (((cy % G) + G) % G) * G + (((cx % G) + G) % G);
      const px = cx + jx[k] - x, py = cy + jy[k] - y, d = px * px + py * py;
      if (d < d1) { d2 = d1; d1 = d; id = k; } else if (d < d2) d2 = d;
    }
    out[0] = Math.sqrt(d1); out[1] = Math.sqrt(d2); out[2] = id;
  };
}

function paintPixels(S, fn) {
  const cv = makeCanvas(S, S);
  if (!cv) return null;
  const img = cv.g.createImageData(S, S), d = img.data, rgb = [0, 0, 0];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    fn(x / S, y / S, rgb);
    const i = (y * S + x) * 4;
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
  }
  cv.g.putImageData(img, 0, 0);
  return cv;
}

// 1 m period: 4 x 4 light-blue pool tiles with grout
function tilesCanvas() {
  const S = 256, cv = makeCanvas(S, S);
  if (!cv) return null;
  const g = cv.g, rnd = mulberry32(7), n = 4, t = S / n, gw = 4;
  g.fillStyle = '#86b9c9'; g.fillRect(0, 0, S, S);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const l = 0.94 + rnd() * 0.06;
    g.fillStyle = `rgb(${Math.round(186 * l)},${Math.round(226 * l)},${Math.round(240 * l)})`;
    g.fillRect(i * t + gw / 2, j * t + gw / 2, t - gw, t - gw);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.fillRect(i * t + gw / 2 + 4, j * t + gw / 2 + 4, t - gw - 8, 5);
  }
  return cv;
}

// 4 m period
function sandCanvas(pale) {
  const rnd = mulberry32(21), n1 = valueNoise(6, rnd), n2 = valueNoise(48, rnd);
  const base = pale ? [240, 232, 208] : [214, 200, 168];
  return paintPixels(512, (u, v, o) => {
    const r = Math.sin(TAU * (v * 9 + u + n1(u, v) * 1.6));
    const s = 0.93 + 0.06 * r * Math.abs(r) + (n2(u, v) - 0.5) * 0.1 - (rnd() < 0.02 ? 0.12 : 0);
    o[0] = base[0] * s; o[1] = base[1] * s; o[2] = base[2] * s;
  });
}

function gravelCanvas() {
  const rnd = mulberry32(33), w = worley(14, rnd), n = valueNoise(64, rnd), f = [0, 0, 0];
  const pal = [[128, 126, 120], [104, 100, 94], [140, 132, 118], [92, 96, 100], [118, 110, 98], [150, 148, 142]];
  return paintPixels(512, (u, v, o) => {
    w(u, v, f);
    const c = pal[f[2] % pal.length], gap = smooth(0.0, 0.14, f[1] - f[0]);
    const s = (0.45 + 0.55 * gap) * (1.08 - f[0] * 0.45) * (0.9 + n(u, v) * 0.2);
    o[0] = c[0] * s; o[1] = c[1] * s; o[2] = c[2] * s;
  });
}

function rockCanvas() {
  const rnd = mulberry32(45), a = valueNoise(4, rnd), b = valueNoise(12, rnd), c = valueNoise(40, rnd), w = worley(5, rnd), f = [0, 0, 0];
  return paintPixels(512, (u, v, o) => {
    w(u, v, f);
    const fbm = a(u, v) * 0.5 + b(u, v) * 0.3 + c(u, v) * 0.2;
    const crack = smooth(0.0, 0.06, f[1] - f[0]);
    const s = (0.45 + 0.8 * fbm) * (0.55 + 0.45 * crack);
    o[0] = 78 * s; o[1] = 82 * s; o[2] = 70 * s;
  });
}

function spriteCanvas() {
  const cv = makeCanvas(64, 64);
  if (!cv) return null;
  const g = cv.g, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return cv;
}

// ---------------------------------------------------------------- shader snippets

const WAVE_GLSL = /* glsl */`
uniform float uWaveA, uWaveK, uWaveW, uWaveT;
uniform vec2 uWaveD;
// NED: xN = -Z, yE = X
float scWave(vec2 xz) { return uWaveA * cos(uWaveK * (-xz.y * uWaveD.x + xz.x * uWaveD.y) - uWaveW * uWaveT); }
`;

const CAUSTIC_GLSL = /* glsl */`
uniform float uTime, uCaustic;
varying vec3 vCWorld;
// tileable water caustic (after Dave Hoskins), uv period 1
float scCaustic(vec2 uv, float time) {
  vec2 p = mod(uv * 6.2831853, 6.2831853) - 250.0;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / 0.005), p.y / (cos(i.y + t) / 0.005)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

// Patch a built-in material: world-space vertex stage with optional wave
// following, kelp sway, fish tail wiggle, and floor caustics.
function patchMaterial(mat, U, opts) {
  const { wave = false, caustic = false, sway = 0, wiggle = false } = opts;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    if (wave) Object.assign(sh.uniforms, { uWaveA: U.uWaveA, uWaveK: U.uWaveK, uWaveW: U.uWaveW, uWaveT: U.uWaveT, uWaveD: U.uWaveD });
    if (caustic) sh.uniforms.uCaustic = U.uCaustic;
    let head = caustic ? 'varying vec3 vCWorld;\nuniform float uTime;\n' : 'uniform float uTime;\n';
    if (wave) head += WAVE_GLSL;
    let proj = 'vec4 scW = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n scW = instanceMatrix * scW;\n#endif\nscW = modelMatrix * scW;\n';
    if (wave) proj += 'scW.y += scWave(scW.xz);\n';
    if (sway) proj += `{ float sh = position.y * position.y; float ph = uTime * 0.7 + instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
  scW.x += (sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.2) * sh * ${sway.toFixed(3)};
  scW.z += cos(ph * 0.8 + 0.5) * 0.5 * sh * ${sway.toFixed(3)}; }\n`;
    if (caustic) proj += 'vCWorld = scW.xyz;\n';
    proj += 'vec4 mvPosition = viewMatrix * scW;\ngl_Position = projectionMatrix * mvPosition;\n';
    let vs = head + sh.vertexShader.replace('#include <project_vertex>', proj);
    if (wiggle) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += sin(uTime * 11.0 + float(gl_InstanceID) * 1.37) * 0.22 * clamp(0.1 - position.z, 0.0, 1.0);');
    sh.vertexShader = vs;
    if (caustic) {
      sh.fragmentShader = CAUSTIC_GLSL + sh.fragmentShader.replace('#include <opaque_fragment>', `{
  float cz = clamp(-vCWorld.y * 3.0, 0.0, 1.0);
  float cc = min(scCaustic(vCWorld.xz / 3.5, uTime * 0.45 + 23.0), 2.0);
  outgoingLight += diffuseColor.rgb * cc * uCaustic * cz;
}
#include <opaque_fragment>`);
    }
  };
  mat.customProgramCacheKey = () => `scenery:${wave ? 1 : 0}${caustic ? 1 : 0}${sway}${wiggle ? 1 : 0}`;
  return mat;
}

const WATER_VS = /* glsl */`
${WAVE_GLSL}
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  w.y += scWave(w.xz);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FS = /* glsl */`
uniform float uWaveA, uWaveK, uWaveW, uWaveT, uTime, uRipple, uLight, uAboveAlpha;
uniform vec2 uWaveD;
uniform vec3 uWater, uSurf, uSky, uDeep, uSunDir, uSunCol;
varying vec3 vW;
#include <fog_pars_fragment>
vec2 ripple(vec2 p, float t) {
  vec2 g = vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 3.1 + t * 1.9);
  g += vec2(-0.5, 0.866) * cos(dot(p, vec2(-0.5, 0.866)) * 4.3 + t * 2.3);
  g += vec2(0.2, -0.98) * cos(dot(p, vec2(0.2, -0.98)) * 6.7 + t * 2.9) * 0.6;
  g += vec2(-0.93, -0.37) * cos(dot(p, vec2(-0.93, -0.37)) * 9.1 + t * 3.7) * 0.45;
  g += vec2(0.6, -0.8) * cos(dot(p, vec2(0.6, -0.8)) * 14.3 + t * 4.6) * 0.3;
  return g;
}
void main() {
  float ph = uWaveK * (-vW.z * uWaveD.x + vW.x * uWaveD.y) - uWaveW * uWaveT;
  float s = -uWaveA * uWaveK * sin(ph);
  vec2 rp = ripple(vW.xz, uTime);
  vec2 g = vec2(s * uWaveD.y, -s * uWaveD.x) + rp * uRipple;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vW);
  vec3 col; float alpha;
  if (V.y < 0.0) {
    // from below: Snell's window toward straight up, total internal reflection outside it
    vec3 up = -V;
    float c = dot(up, n);
    float win = smoothstep(0.60, 0.70, c);
    float rim = smoothstep(0.55, 0.65, c) * (1.0 - smoothstep(0.66, 0.76, c));
    float shim = smoothstep(1.2, 2.6, length(rp));
    vec3 sky = mix(uSurf, vec3(1.0), 0.5) * 1.3;
    vec3 refl = mix(uDeep, uSurf, 0.35 + 0.35 * shim);
    col = mix(refl, sky, win) + uSurf * (rim * 0.5 + shim * 0.35);
    vec3 d = normalize(up + (n - vec3(0.0, 1.0, 0.0)) * 2.5);
    col += uSunCol * pow(max(dot(d, uSunDir), 0.0), 90.0) * 2.5 * win;
    col *= uLight;
    alpha = mix(0.94, 0.82, win);
  } else {
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, n), 0.0, 1.0), 5.0);
    vec3 h = normalize(V + uSunDir);
    float spec = pow(max(dot(n, h), 0.0), 220.0);
    col = mix(uWater, uSky, fres) * min(uLight, 1.1) + uSunCol * spec * 1.6;
    alpha = clamp(mix(uAboveAlpha, 1.0, fres) + spec, 0.0, 1.0);
  }
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const PARTICLE_VS = /* glsl */`
uniform float uTime, uSize, uScale, uFall, uDepth;
attribute float aSeed;
varying float vA;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  float s = aSeed;
  p.x += sin(uTime * 0.21 + s * 6.28) * 0.35;
  p.z += cos(uTime * 0.17 + s * 9.1) * 0.35;
  p.y = -uDepth + mod(position.y + uDepth - uTime * uFall * (0.5 + s) + sin(uTime * 0.3 + s * 20.0) * 0.15, uDepth - 0.05);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(uSize * (0.6 + 0.8 * s) * uScale / max(-mvPosition.z, 0.05), 1.0, 48.0);
  vA = 0.35 + 0.65 * fract(s * 13.7);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const PARTICLE_FS = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
#include <fog_pars_fragment>
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vA * uOpacity;
  #ifdef FOG_EXP2
    a *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #endif
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}`;

const RAY_VS = /* glsl */`
uniform float uTime;
attribute float aSeed;
varying vec2 vUv;
varying float vDist, vSeed;
void main() {
  vec3 p = position;
  float d = uv.y;
  p.x += sin(uTime * 0.23 + aSeed * 6.28) * 0.6 * d;
  p.z += cos(uTime * 0.19 + aSeed * 4.1) * 0.6 * d;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDist = -mv.z; vUv = uv; vSeed = aSeed;
  gl_Position = projectionMatrix * mv;
}`;

const RAY_FS = /* glsl */`
uniform vec3 uColor;
uniform float uI, uTime, uFade;
varying vec2 vUv;
varying float vDist, vSeed;
void main() {
  float e = sin(3.14159 * vUv.x); e *= e;
  float a = uI * e * pow(1.0 - vUv.y, 1.6) * (0.55 + 0.45 * sin(uTime * 0.6 + vSeed * 30.0));
  a *= exp(-vDist * uFade) * smoothstep(0.5, 3.0, vDist);
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- shape builders

function rockGeometry(seed) {
  const rnd = mulberry32(seed), g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position;
  const a = rnd() * 10, b = rnd() * 10, c = rnd() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.18 * Math.sin(x * 3.1 + a) * Math.cos(z * 2.7 + b) + 0.1 * Math.sin(y * 4.3 + c) + 0.05 * Math.sin((x + z) * 7.0);
    p.setXYZ(i, x * k, y * k * 0.62, z * k * (0.85 + 0.15 * Math.sin(a)));
  }
  g.computeVertexNormals();
  return g;
}

// vertical strip, local y in [0,1]
function ribbon(width, segs, twist, bend, phase) {
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const v = i / segs, a = phase + twist * v, ox = Math.sin(v * Math.PI * 1.3 + phase) * bend * v;
    const w = width * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, v * 0.9 + 0.12)));
    const cx = Math.cos(a) * w * 0.5, cz = Math.sin(a) * w * 0.5, nx = -Math.sin(a), nz = Math.cos(a);
    pos.push(ox - cx, v, -cz, ox + cx, v, cz);
    nor.push(nx, 0, nz, nx, 0, nz);
    uv.push(0, v, 1, v);
    if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function plantGeometry(blades, width, segs, twist, bend, seed) {
  const rnd = mulberry32(seed), parts = [];
  for (let i = 0; i < blades; i++) {
    const g = ribbon(width, segs, twist * (0.6 + rnd() * 0.8), bend * (0.5 + rnd()), rnd() * TAU);
    const s = 0.75 + rnd() * 0.25;
    g.scale(1, s, 1);
    g.rotateY(rnd() * TAU);
    g.translate((rnd() - 0.5) * 0.12, 0, (rnd() - 0.5) * 0.12);
    parts.push(g);
  }
  return merge(parts);
}

function branchCoralGeometry(seed) {
  const rnd = mulberry32(seed), parts = [], up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  const branch = (start, dir, len, rad, depth) => {
    const g = new THREE.CylinderGeometry(rad * 0.65, rad, len, 5, 1);
    g.translate(0, len / 2, 0);
    q.setFromUnitVectors(up, dir);
    g.applyMatrix4(m.compose(start, q, one));
    parts.push(g);
    const end = start.clone().addScaledVector(dir, len);
    if (depth > 0) {
      const n = 2 + (rnd() < 0.4 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const d = dir.clone().add(new THREE.Vector3(rnd() - 0.5, rnd() * 0.3, rnd() - 0.5).multiplyScalar(1.3)).normalize();
        d.y = Math.max(d.y, 0.3); d.normalize();
        branch(end, d, len * 0.75, rad * 0.7, depth - 1);
      }
    } else {
      const tip = new THREE.SphereGeometry(rad * 0.75, 5, 4);
      tip.translate(end.x, end.y, end.z);
      parts.push(tip);
    }
  };
  for (let t = 0; t < 3; t++) {
    const a = (t / 3) * TAU + rnd();
    branch(new THREE.Vector3(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06), new THREE.Vector3(Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35).normalize(), 0.32, 0.05, 2);
  }
  return merge(parts);
}

function brainCoralGeometry() {
  const g = new THREE.SphereGeometry(0.5, 22, 10, 0, TAU, 0, Math.PI / 2), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const k = 0.5 * (1 + 0.05 * Math.sin(22 * v.x + 7 * Math.sin(15 * v.z)) * Math.sin(18 * v.z + 5 * v.y));
    p.setXYZ(i, v.x * k, v.y * k * 0.72, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

function tubeSpongeGeometry(seed) {
  const rnd = mulberry32(seed), parts = [];
  for (let i = 0; i < 5; i++) {
    const h = 0.3 + rnd() * 0.5, r = 0.05 + rnd() * 0.05;
    const g = new THREE.CylinderGeometry(r * 1.15, r * 0.8, h, 9, 1, true);
    g.translate((rnd() - 0.5) * 0.3, h / 2, (rnd() - 0.5) * 0.3);
    parts.push(g);
  }
  return merge(parts);
}

function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.38 : 1, a = (i / 10) * TAU + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.08, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}

function fishGeometry() {
  const body = new THREE.SphereGeometry(0.5, 8, 6);
  body.scale(0.32, 0.55, 1);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.42, 0, 0.3, -0.82, 0, -0.3, -0.82], 3));
  tail.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  return merge([body, tail]);
}

function jellyGeometry() {
  const bell = new THREE.SphereGeometry(0.5, 14, 6, 0, TAU, 0, Math.PI * 0.5);
  bell.scale(1, 0.8, 1);
  const parts = [bell];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU, t = new THREE.CylinderGeometry(0.012, 0.004, 0.9, 3, 1, true);
    t.translate(Math.cos(a) * 0.3, -0.45, Math.sin(a) * 0.3);
    parts.push(t);
  }
  return merge(parts);
}

function iceGeometry(seed) {
  const rnd = mulberry32(seed), s = new THREE.Shape(), n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, r = 0.75 + rnd() * 0.3;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2); // extrusion along +Y, y in [-0.08, 1.08]
  g.translate(0, -1, 0); // top ~ +0.08
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- main

export function createScenery(scene, scenario, { logoTexture, arena = { length: 50, width: 25, depth: 4.8 }, clearZones = [] } = {}) {
  const look = { water: 0x2f9fc4, fog: 0x3aa6c9, fogDensity: 0.03, sky: 0x9fd8ec, floor: 'sand', light: 1, sun: 0xffffff, surface: 0x7fd6ee, particles: 0.5, life: 'none', ice: false, ...(scenario?.look || {}) };
  const L = arena.length ?? 50, W = arena.width ?? 25, D = arena.depth ?? 4.8;
  const isPool = look.floor === 'tiles';
  const id = scenario?.id || look.floor;
  const seed = [...String(id)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 17);
  const rnd = mulberry32(seed);

  const root = new THREE.Group();
  root.name = 'scenery';
  scene.add(root);
  const textures = [], animators = [], lineMats = [];
  const prevFog = scene.fog, prevBg = scene.background;

  // shared uniforms (one object per value, referenced by every material)
  const U = {
    uTime: { value: 0 }, uWaveA: { value: 0 }, uWaveK: { value: 0 }, uWaveW: { value: 0 }, uWaveT: { value: 0 },
    uWaveD: { value: new THREE.Vector2(1, 0) }, uCaustic: { value: 0 }, uPointScale: { value: 600 },
  };

  // caustic strength: strong in bright clear water, faint in dim / murky water
  let caustic = THREE.MathUtils.clamp((look.light - 0.6) * 1.6, 0.08, 1.0) * THREE.MathUtils.clamp(1.4 - look.fogDensity * 12, 0.3, 1.0);
  if (look.ice) caustic *= 0.7;
  U.uCaustic.value = caustic;

  const sunDir = new THREE.Vector3(0.28, 1, 0.38).normalize();
  const C = (h) => new THREE.Color(h);
  const add = (o) => { root.add(o); return o; };
  const inArena = (x, z) => Math.abs(x) < W / 2 && Math.abs(z) < L / 2;
  const nearZone = (x, z, r) => clearZones.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + r);
  const dummy = new THREE.Object3D();

  // ---- lights
  const hemi = add(new THREE.HemisphereLight(C(look.surface).lerp(C(0xffffff), 0.5), C(look.water).multiplyScalar(0.5), 1.5 * look.light));
  hemi.position.set(0, 10, 0);
  const sun = add(new THREE.DirectionalLight(C(look.sun), 2.2 * look.light));
  sun.position.copy(sunDir).multiplyScalar(40);
  add(sun.target);

  // ---- fog / background objects (swapped per viewport)
  const fogUnder = new THREE.FogExp2(look.fog, look.fogDensity);
  const fogAbove = new THREE.FogExp2(look.sky, isPool ? 0.006 : 0.011);
  const bgUnder = C(look.fog), bgAbove = C(look.sky);
  scene.fog = fogUnder;
  scene.background = bgUnder;

  // ---- seabed height (flat arena, gentle relief outside, never shallower than 1.5 m)
  const seabedY = (x, z) => {
    if (isPool) return -D;
    const dx = Math.max(0, Math.abs(x) - (W / 2 + 1)), dz = Math.max(0, Math.abs(z) - (L / 2 + 1)), d = Math.hypot(dx, dz);
    if (d <= 0) return -D;
    const n = Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 - 0.7) * 1.1 + Math.sin(x * 0.27 + z * 0.21) * 0.45 + Math.sin(z * 0.37 - x * 0.13) * 0.25;
    return Math.min(-1.5, -D + smooth(0, 10, d) * n * 0.9 - smooth(10, 80, d) * 1.2);
  };

  // ---- placement: outside the arena (biased close) or in its edge band, never in clear zones
  const allowed = (x, z, r, band = 1.6) => {
    if (inArena(x, z) && Math.min(W / 2 - Math.abs(x), L / 2 - Math.abs(z)) > band) return false;
    return !nearZone(x, z, r);
  };
  const scatter = (n, { r = 0.5, inside = 0.12, spread = 40, falloff = 18 } = {}) => {
    const out = [];
    for (let tries = 0; out.length < n && tries < n * 60; tries++) {
      let x, z;
      if (rnd() < inside) {
        const t = rnd(), e = rnd() * 1.5, side = Math.floor(rnd() * 4);
        if (side < 2) { x = (side ? 1 : -1) * (W / 2 - e); z = (t - 0.5) * L; } else { z = (side === 3 ? 1 : -1) * (L / 2 - e); x = (t - 0.5) * W; }
      } else {
        x = (rnd() * 2 - 1) * (W / 2 + spread); z = (rnd() * 2 - 1) * (L / 2 + spread);
        if (inArena(x, z)) continue;
        const d = Math.hypot(Math.max(0, Math.abs(x) - W / 2), Math.max(0, Math.abs(z) - L / 2));
        if (rnd() > Math.exp(-d / falloff)) continue;
      }
      if (allowed(x, z, r)) out.push([x, z]);
    }
    return out;
  };

  const instanced = (geo, mat, list, place, opts = {}) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    m.count = list.length;
    list.forEach((p, i) => { place(p, i, dummy); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); if (opts.color) m.setColorAt(i, opts.color(i)); });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (opts.static !== false) m.computeBoundingSphere(); else m.frustumCulled = false;
    return add(m);
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const tint = (hex, v) => { const c = C(hex); c.offsetHSL((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * v); return c; };

  // ---- water surface
  const waterSize = isPool ? [W, L] : [400, 400];
  const waterGeo = new THREE.PlaneGeometry(waterSize[0], waterSize[1], isPool ? 50 : 128, isPool ? 100 : 128);
  waterGeo.rotateX(-Math.PI / 2);
  const waterUniforms = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
  Object.assign(waterUniforms, {
    uTime: U.uTime, uWaveA: U.uWaveA, uWaveK: U.uWaveK, uWaveW: U.uWaveW, uWaveT: U.uWaveT, uWaveD: U.uWaveD,
    uRipple: { value: isPool ? 0.035 : look.ice ? 0.03 : 0.07 }, uLight: { value: look.light }, uAboveAlpha: { value: isPool ? 0.35 : 0.72 },
    uWater: { value: C(look.water) }, uSurf: { value: C(look.surface) }, uSky: { value: C(look.sky) }, uDeep: { value: C(look.fog).multiplyScalar(0.7) },
    uSunDir: { value: sunDir.clone() }, uSunCol: { value: C(look.sun) },
  });
  const water = add(new THREE.Mesh(waterGeo, new THREE.ShaderMaterial({
    uniforms: waterUniforms, vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  })));
  water.renderOrder = 2;
  water.frustumCulled = false;

  // ---- floor
  const floorTexCv = isPool ? tilesCanvas() : look.floor === 'gravel' ? gravelCanvas() : look.floor === 'rock' ? rockCanvas() : sandCanvas(look.life === 'reef');
  const floorTex = floorTexCv ? toTexture(floorTexCv) : null;
  if (floorTex) textures.push(floorTex);
  const floorMat = patchMaterial(new THREE.MeshStandardMaterial({ map: floorTex, color: floorTex ? 0xffffff : 0xb8a888, roughness: 0.95, metalness: 0 }), U, { caustic: true });
  let floorGeo;
  if (isPool) {
    floorGeo = scaleUV(new THREE.PlaneGeometry(W, L), W, L); // tile texture has a 1 m period
    floorGeo.rotateX(-Math.PI / 2);
    floorGeo.translate(0, -D, 0);
  } else {
    const S = 300, N = 120, per = 4; // texture period 4 m
    floorGeo = scaleUV(new THREE.PlaneGeometry(S, S, N, N), S / per, S / per);
    floorGeo.rotateX(-Math.PI / 2);
    const p = floorGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, seabedY(p.getX(i), p.getZ(i)));
    floorGeo.computeVertexNormals();
  }
  add(new THREE.Mesh(floorGeo, floorMat));

  // ---- surface-floating things that follow the waves
  const waveMat = (params) => patchMaterial(new THREE.MeshStandardMaterial(params), U, { wave: true });

  if (isPool) buildPool(); else buildSea();

  // ---- suspended particles / marine snow
  {
    const n = Math.round(4000 * look.particles), pos = new Float32Array(n * 3), sd = new Float32Array(n);
    const ex = isPool ? W / 2 : W / 2 + 10, ez = isPool ? L / 2 : L / 2 + 12;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() * 2 - 1) * ex; pos[i * 3 + 1] = -D + rnd() * D; pos[i * 3 + 2] = (rnd() * 2 - 1) * ez; sd[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    const spCv = spriteCanvas(), sprite = spCv ? toTexture(spCv, false) : new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    sprite.needsUpdate = true;
    textures.push(sprite);
    const snow = look.life === 'arctic';
    const uni = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    Object.assign(uni, {
      uTime: U.uTime, uScale: U.uPointScale, uMap: { value: sprite }, uDepth: { value: D },
      uSize: { value: snow ? 0.05 : isPool ? 0.022 : 0.032 }, uFall: { value: snow ? 0.05 : 0.008 },
      uColor: { value: snow ? C(0xffffff) : C(look.surface).lerp(C(0xffffff), 0.6) }, uOpacity: { value: isPool ? 0.35 : snow ? 0.8 : 0.55 },
    });
    const pts = add(new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: uni, vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
    pts.frustumCulled = false;
    pts.visible = n > 0;
  }

  // ---- god rays (vertical additive quads from the surface)
  let rays = null;
  {
    const cfg = { reef: [16, 0.22, 7], kelp: [7, 0.1, 6], arctic: [6, 0.12, 5] }[look.life];
    if (cfg) {
      const [n, inten, len] = cfg, pos = [], uvs = [], sds = [], idx = [];
      for (let i = 0; i < n; i++) {
        let x, z;
        if (look.ice) { x = (rnd() - 0.5) * 4; z = (rnd() - 0.5) * (L - 6); } else { x = (rnd() - 0.5) * (W + 14); z = (rnd() - 0.5) * (L + 14); }
        const w = 1.0 + rnd() * 2.0, l = len * (0.8 + rnd() * 0.4), s = rnd(), yaw = rnd() * Math.PI;
        const bx = -sunDir.x / sunDir.y * l * 0.7, bz = -sunDir.z / sunDir.y * l * 0.7;
        for (let q = 0; q < 2; q++) {
          const a = yaw + q * Math.PI / 2, cx = Math.cos(a), cz = Math.sin(a), wt = w * 0.5, wb = w * 0.8, b = pos.length / 3;
          pos.push(x - cx * wt, 0.02, z - cz * wt, x + cx * wt, 0.02, z + cz * wt, x + bx - cx * wb, -l, z + bz - cz * wb, x + bx + cx * wb, -l, z + bz + cz * wb);
          uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
          sds.push(s, s, s, s);
          idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sds, 1));
      g.setIndex(idx);
      rays = add(new THREE.Mesh(g, new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uColor: { value: C(look.surface).lerp(C(0xffffff), 0.5) }, uI: { value: inten * look.light }, uFade: { value: look.fogDensity * 1.2 } },
        vertexShader: RAY_VS, fragmentShader: RAY_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      })));
      rays.frustumCulled = false;
      rays.renderOrder = 3;
    }
  }

  // ================================================================ pool
  function buildPool() {
    const H = D + 0.4; // wall height, floor to 0.4 m above water
    const parts = [];
    const wall = (w, rotY, x, z) => {
      const g = scaleUV(new THREE.PlaneGeometry(w, H), w, H);
      g.rotateY(rotY); g.translate(x, (0.4 - D) / 2, z);
      parts.push(g);
    };
    wall(W, 0, 0, -L / 2); // north wall, faces +Z
    wall(W, Math.PI, 0, L / 2);
    wall(L, Math.PI / 2, -W / 2, 0);
    wall(L, -Math.PI / 2, W / 2, 0);
    add(new THREE.Mesh(merge(parts), patchMaterial(new THREE.MeshStandardMaterial({ map: floorTex, color: floorTex ? 0xffffff : 0xbfe6f2, roughness: 0.6 }), U, { caustic: true })));

    // competition lane lines with T ends + wall targets
    const lanes = 10, lw = 0.25, marks = [];
    for (let i = 0; i < lanes; i++) {
      const x = -W / 2 + (W / lanes) * (i + 0.5);
      let g = new THREE.BoxGeometry(lw, 0.004, L - 4); g.translate(x, -D + 0.003, 0); marks.push(g);
      for (const s of [-1, 1]) {
        g = new THREE.BoxGeometry(1.0, 0.004, lw); g.translate(x, -D + 0.003, s * (L / 2 - 2)); marks.push(g);
        g = new THREE.BoxGeometry(lw, D - 0.3, 0.004); g.translate(x, -D + (D - 0.3) / 2, s * (L / 2 - 0.003)); marks.push(g);
        g = new THREE.BoxGeometry(0.5, lw, 0.004); g.translate(x, -0.3 - lw / 2, s * (L / 2 - 0.003)); marks.push(g);
      }
    }
    add(new THREE.Mesh(merge(marks), patchMaterial(new THREE.MeshStandardMaterial({ color: 0x0d2a6b, roughness: 0.6 }), U, { caustic: true })));

    // deck slabs + white coping
    const dk = [], dx = 6, dz = 8;
    const slab = (w, d, x, z, hex, h = 0.4, y = 0.2) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); dk.push(colored(g, hex)); };
    slab(W + 2 * dx, dz, 0, -L / 2 - dz / 2, 0xd6d1c4);
    slab(W + 2 * dx, dz, 0, L / 2 + dz / 2, 0xd6d1c4);
    slab(dx, L, -W / 2 - dx / 2, 0, 0xd6d1c4);
    slab(dx, L, W / 2 + dx / 2, 0, 0xd6d1c4);
    slab(W + 0.7, 0.35, 0, -L / 2 - 0.175, 0xf4f2ec, 0.1, 0.45);
    slab(W + 0.7, 0.35, 0, L / 2 + 0.175, 0xf4f2ec, 0.1, 0.45);
    slab(0.35, L, -W / 2 - 0.175, 0, 0xf4f2ec, 0.1, 0.45);
    slab(0.35, L, W / 2 + 0.175, 0, 0xf4f2ec, 0.1, 0.45);
    add(new THREE.Mesh(merge(dk), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })));

    // hall (inside of a box) and ceiling light panels
    const hallH = 14, hall = new THREE.BoxGeometry(W + 2 * dx, hallH, L + 2 * dz);
    hall.translate(0, 0.35 + hallH / 2, 0);
    add(new THREE.Mesh(hall, new THREE.MeshStandardMaterial({ color: 0xdfe9ee, roughness: 0.9, side: THREE.BackSide })));
    const lights = [];
    for (const x of [-8, 0, 8]) for (const z of [-21, -7, 7, 21]) lights.push([x, z]);
    instanced(new THREE.BoxGeometry(3, 0.1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), lights, ([x, z], i, o) => { o.position.set(x, 0.35 + hallH - 0.08, z); });

    // DUBURI banners: underwater on both end walls, and high on the hall end walls
    if (logoTexture) {
      const asp = logoTexture.image?.width && logoTexture.image?.height ? logoTexture.image.width / logoTexture.image.height : 2.6;
      const bp = [];
      const banner = (w, y, z, rotY) => { const g = new THREE.PlaneGeometry(w, w / asp); g.rotateY(rotY); g.translate(0, y, z); bp.push(g); };
      banner(9, -2.2, -L / 2 + 0.02, 0);
      banner(9, -2.2, L / 2 - 0.02, Math.PI);
      banner(14, 7, -L / 2 - dz + 0.05, 0);
      banner(14, 7, L / 2 + dz - 0.05, Math.PI);
      add(new THREE.Mesh(merge(bp), new THREE.MeshStandardMaterial({ map: logoTexture, transparent: true, roughness: 0.8 })));
    }

    // lane ropes along the side walls (discs on the surface)
    const fl = [], spacing = 0.1, nPer = Math.floor((L - 0.2) / spacing) + 1;
    for (const sx of [-1, 1]) for (let i = 0; i < nPer; i++) fl.push([sx * (W / 2 - 0.25), -L / 2 + 0.1 + i * spacing, i]);
    const disc = new THREE.CylinderGeometry(0.055, 0.055, 0.085, 10);
    disc.rotateX(Math.PI / 2);
    const red = C(0xd62828), blue = C(0x1d4fbf), white = C(0xf2f2f2);
    const ropes = instanced(disc, waveMat({ roughness: 0.4 }), fl, ([x, z], i, o) => { o.position.set(x, 0.0, z); }, {
      color: (i) => { const k = fl[i][2], zz = k * spacing; return zz < 5 || zz > L - 5.2 ? red : Math.floor(k / 5) % 2 ? white : blue; },
    });
    ropes.frustumCulled = false;

    // starting blocks at the south end
    const blk = [];
    const ped = new THREE.BoxGeometry(0.5, 0.7, 0.5); ped.translate(0, 0.75, 0); blk.push(colored(ped, 0xeeeeee));
    const top = new THREE.BoxGeometry(0.55, 0.05, 0.72); top.rotateX(-0.17); top.translate(0, 1.12, -0.02); blk.push(colored(top, 0x1b2f6b));
    const lanesX = [];
    for (let i = 0; i < lanes; i++) lanesX.push([-W / 2 + (W / lanes) * (i + 0.5), 0]);
    instanced(merge(blk), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), lanesX, ([x], i, o) => { o.position.set(x, 0, L / 2 + 0.55); });
  }

  // ================================================================ sea
  function buildSea() {
    const life = look.life;

    // rocks (two shapes)
    const nRocks = life === 'kelp' ? 90 : life === 'arctic' ? 40 : 30;
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const rockBase = life === 'kelp' ? 0x5d6158 : life === 'arctic' ? 0x6a6f72 : 0x9a9182;
    for (let v = 0; v < 2; v++) {
      const pts = scatter(nRocks, { r: 1.2, inside: 0.1 });
      instanced(rockGeometry(seed + v * 101), rockMat, pts, ([x, z], i, o) => {
        const s = inArena(x, z) ? 0.2 + rnd() * 0.35 : 0.4 + rnd() * rnd() * (life === 'kelp' ? 2.4 : 1.4);
        o.position.set(x, seabedY(x, z) + s * 0.15, z);
        o.rotation.set((rnd() - 0.5) * 0.3, rnd() * TAU, (rnd() - 0.5) * 0.3);
        o.scale.set(s * (0.8 + rnd() * 0.5), s, s * (0.8 + rnd() * 0.5));
      }, { color: () => tint(rockBase, 0.12) });
    }

    if (life === 'reef') {
      const pal = [0xff6f61, 0xff9f1c, 0xf15bb5, 0x9b5de5, 0xfee440, 0x00bbf9, 0xe76f51, 0xffb4c8];
      const centres = scatter(28, { r: 1.5, inside: 0.15, falloff: 14 });
      const cluster = (n, r) => {
        const out = [];
        for (let t = 0; out.length < n && t < n * 20; t++) {
          const c = pick(centres), a = rnd() * TAU, d = rnd() * 1.8, x = c[0] + Math.cos(a) * d, z = c[1] + Math.sin(a) * d;
          if (allowed(x, z, r)) out.push([x, z]);
        }
        return out;
      };
      const coralMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
      const place = (lo, hi) => ([x, z], i, o) => { const s = lo + rnd() * (hi - lo); o.position.set(x, seabedY(x, z) - 0.03, z); o.rotation.set(0, rnd() * TAU, 0); o.scale.setScalar(s); };
      instanced(branchCoralGeometry(seed + 5), coralMat, cluster(70, 0.5), place(0.6, 1.5), { color: () => C(pick(pal)) });
      instanced(brainCoralGeometry(), coralMat, cluster(55, 0.5), place(0.5, 1.4), { color: () => tint(pick([0xc9a227, 0x8fbf5a, 0xd77a61, 0xb06ab3]), 0.1) });
      instanced(tubeSpongeGeometry(seed + 9), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), cluster(40, 0.5), place(0.7, 1.6), { color: () => C(pick([0x9b5de5, 0xff9f1c, 0xf15bb5, 0xffd23f])) });
      addStars([0xff7b29, 0xe63946, 0x9b5de5, 0x3a86ff], 30);
      addFish([
        { c: [-17, -2.4, -8], r: [4, 7], w: 0.22, n: 22, col: 0xffd23f, s: 0.2 },
        { c: [18, -2.0, 10], r: [3.5, 6], w: -0.28, n: 22, col: 0x3fa7ff, s: 0.18 },
        { c: [0, -3.0, -31], r: [8, 3], w: 0.18, n: 20, col: 0xff7b29, s: 0.22 },
      ]);
    } else if (life === 'kelp') {
      const kelpPts = [];
      for (let t = 0; kelpPts.length < 280 && t < 20000; t++) {
        // dense band 1..14 m outside the arena edges, a few inside the edge band
        let x, z;
        if (rnd() < 0.06) { const p = scatter(1, { r: 0.6, inside: 1 })[0]; if (!p) continue; [x, z] = p; } else {
          const side = Math.floor(rnd() * 4), off = 1 + rnd() * rnd() * 14, t2 = rnd();
          if (side < 2) { x = (side ? 1 : -1) * (W / 2 + off); z = (t2 - 0.5) * (L + 30); } else { z = (side === 3 ? 1 : -1) * (L / 2 + off); x = (t2 - 0.5) * (W + 30); }
          if (!allowed(x, z, 0.6)) continue;
        }
        kelpPts.push([x, z]);
      }
      const kelp = instanced(plantGeometry(3, 0.22, 10, 2.2, 0.25, seed + 3), patchMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide }), U, { sway: 1.0 }), kelpPts, ([x, z], i, o) => {
        const y = seabedY(x, z), h = (-y - 0.2) * (0.55 + rnd() * 0.42);
        o.position.set(x, y, z); o.rotation.set(0, rnd() * TAU, 0); o.scale.set(1 + rnd() * 0.4, h, 1 + rnd() * 0.4);
      }, { color: () => tint(pick([0x6b6a24, 0x7a6a28, 0x55601f]), 0.12), static: false });
      kelp.frustumCulled = false;
      const weed = scatter(260, { r: 0.3, inside: 0.25, falloff: 12 });
      instanced(plantGeometry(5, 0.07, 5, 1.0, 0.12, seed + 4), patchMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), U, { sway: 0.15 }), weed, ([x, z], i, o) => {
        o.position.set(x, seabedY(x, z), z); o.rotation.set(0, rnd() * TAU, 0); o.scale.set(1, 0.25 + rnd() * 0.5, 1);
      }, { color: () => tint(pick([0x4f5d1e, 0x7a3b2e, 0x6b5a2a]), 0.12), static: false }).frustumCulled = false;
      addFish([
        { c: [-17, -2.2, 0], r: [4, 12], w: 0.12, n: 14, col: 0x9aa5a8, s: 0.34 },
        { c: [16, -3.0, -15], r: [3, 5], w: -0.2, n: 12, col: 0x7d8a7a, s: 0.3 },
      ]);
    } else if (life === 'arctic') {
      addStars([0xe85d2a, 0xd6336c, 0xf08c2e, 0x9c36b5], 40);
      addJellies(12);
    }

    if (look.ice) addIce();

    // arena boundary: red / white floats on a rope, corner anchor lines
    const fl = [], step = 0.75;
    const per = 2 * (W + L);
    for (let s = 0; s < per; s += step) { const [x, z] = edgePoint(s); fl.push([x, z, s]); }
    const red = C(0xd62828), white = C(0xf4f4f4);
    const fg = new THREE.SphereGeometry(1, 10, 6);
    fg.scale(1, 0.8, 1);
    instanced(fg, waveMat({ roughness: 0.45 }), fl, ([x, z], i, o) => { o.position.set(x, 0.02, z); o.scale.setScalar(0.15); }, {
      color: (i) => (Math.floor(fl[i][2] / 3) % 2 ? white : red), static: false,
    });
    const rp = [], seg = 0.5;
    for (let s = 0; s < per; s += seg) {
      const a = edgePoint(s), b = edgePoint(Math.min(per, s + seg));
      rp.push(a[0], 0.0, a[1], b[0], 0.0, b[1]);
    }
    for (const [x, z] of [[-W / 2, -L / 2], [W / 2, -L / 2], [W / 2, L / 2], [-W / 2, L / 2]]) rp.push(x, 0, z, x * 1.08, seabedY(x * 1.08, z * 1.04), z * 1.04);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    const rm = patchMaterial(new THREE.LineBasicMaterial({ color: 0xe8dfc4 }), U, { wave: true });
    lineMats.push(rm);
    add(new THREE.LineSegments(rg, rm)).frustumCulled = false;

    // floating DUBURI marker buoy with sign near the south end
    const bx = 7, bz = 22, bp = []; // east of the start dock, clear of the course
    const body = new THREE.CylinderGeometry(0.42, 0.55, 0.9, 16); body.translate(0, -0.25, 0); bp.push(colored(body, 0xf2a20c));
    const ring = new THREE.TorusGeometry(0.5, 0.05, 6, 20); ring.rotateX(Math.PI / 2); ring.translate(0, 0.12, 0); bp.push(colored(ring, 0xffffff));
    const mast = new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6); mast.translate(0, 0.9, 0); bp.push(colored(mast, 0x9aa0a6));
    const board = new THREE.BoxGeometry(1.9, 1.9 / 2.6 + 0.1, 0.04); board.translate(0, 1.25, 0); bp.push(colored(board, 0xffffff));
    const buoy = add(new THREE.Mesh(merge(bp), waveMat({ vertexColors: true, roughness: 0.5 })));
    buoy.position.set(bx, 0, bz);
    if (logoTexture) {
      const asp = logoTexture.image?.width && logoTexture.image?.height ? logoTexture.image.width / logoTexture.image.height : 2.6;
      const w = 1.8, front = new THREE.PlaneGeometry(w, w / asp), back = new THREE.PlaneGeometry(w, w / asp);
      front.translate(0, 1.25, 0.025);
      back.rotateY(Math.PI); back.translate(0, 1.25, -0.025);
      const sign = add(new THREE.Mesh(merge([front, back]), waveMat({ map: logoTexture, transparent: true, roughness: 0.7 })));
      sign.position.set(bx, 0, bz);
    }

    function edgePoint(s) {
      if (s < W) return [-W / 2 + s, -L / 2];
      if (s < W + L) return [W / 2, -L / 2 + (s - W)];
      if (s < 2 * W + L) return [W / 2 - (s - W - L), L / 2];
      return [-W / 2, L / 2 - Math.min(L, s - 2 * W - L)];
    }
  }

  function addStars(pal, n) {
    const pts = scatter(n, { r: 0.2, inside: 0.3, falloff: 10 });
    instanced(starGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), pts, ([x, z], i, o) => {
      o.position.set(x, seabedY(x, z) + 0.005, z); o.rotation.set(0, rnd() * TAU, 0); o.scale.setScalar(0.1 + rnd() * 0.1);
    }, { color: () => C(pick(pal)) });
  }

  // schools of fish swimming elliptical loops (CPU-animated instance matrices)
  function addFish(schools) {
    const total = schools.reduce((a, s) => a + s.n, 0), P = new Float32Array(total * 7);
    const mesh = new THREE.InstancedMesh(fishGeometry(), patchMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide }), U, { wiggle: true }), total);
    let k = 0;
    schools.forEach((s, si) => {
      for (let j = 0; j < s.n; j++, k++) {
        P.set([si, (rnd() - 0.5) * 0.7, (rnd() - 0.5) * 2.2, (rnd() - 0.5) * 0.9, (rnd() - 0.5) * 2.2, 0.9 + rnd() * 0.2, s.s * (0.8 + rnd() * 0.4)], k * 7);
        mesh.setColorAt(k, tint(s.col, 0.15));
      }
    });
    mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    add(mesh);
    animators.push((t) => {
      for (let i = 0; i < total; i++) {
        const o = i * 7, s = schools[P[o]], a = t * s.w * P[o + 5] + P[o + 1], dir = s.w < 0 ? -1 : 1;
        const ca = Math.cos(a), sa = Math.sin(a);
        dummy.position.set(s.c[0] + s.r[0] * ca + P[o + 2], s.c[1] + Math.sin(a * 2 + P[o + 1] * 5) * 0.3 + P[o + 3], s.c[2] + s.r[1] * sa + P[o + 4]);
        dummy.rotation.set(0, Math.atan2(-s.r[0] * sa * dir, s.r[1] * ca * dir), 0);
        dummy.scale.setScalar(P[o + 6]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  function addJellies(n) {
    const J = new Float32Array(n * 5);
    for (let i = 0, made = 0; made < n && i < 400; i++) {
      const x = (rnd() * 2 - 1) * (W / 2 + 10), z = (rnd() * 2 - 1) * (L / 2 + 10);
      if (inArena(x, z) && Math.min(W / 2 - Math.abs(x), L / 2 - Math.abs(z)) > 2) continue;
      J.set([x, -1.6 - rnd() * 2.2, z, rnd() * TAU, 0.25 + rnd() * 0.25], made++ * 5);
    }
    const mesh = add(new THREE.InstancedMesh(jellyGeometry(), new THREE.MeshStandardMaterial({
      color: 0xf2c6e8, emissive: 0x8a4f9e, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, roughness: 0.3,
    }), n));
    mesh.frustumCulled = false;
    animators.push((t) => {
      for (let i = 0; i < n; i++) {
        const o = i * 5, ph = J[o + 3], s = J[o + 4], p = Math.sin(t * 1.6 + ph);
        dummy.position.set(J[o] + Math.sin(t * 0.07 + ph) * 0.8, J[o + 1] + Math.sin(t * 0.25 + ph) * 0.4, J[o + 2] + Math.cos(t * 0.06 + ph) * 0.8);
        dummy.rotation.set(Math.sin(t * 0.3 + ph) * 0.15, ph, 0);
        dummy.scale.set(s * (1 + 0.1 * p), s * (1 - 0.12 * p), s * (1 + 0.1 * p));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  // ice floes; open water over clear zones, the centre-line, the boundary and the sign buoy
  function addIce() {
    const open = (x, z, r) =>
      nearZone(x, z, r + 1.0) ||
      (Math.abs(x) < 3 + r && Math.abs(z) < L / 2 + 3) ||
      Math.hypot(x - 7, z - 22) < 2.5 + r ||
      (Math.abs(Math.abs(x) - W / 2) < r + 0.8 && Math.abs(z) < L / 2 + r) ||
      (Math.abs(Math.abs(z) - L / 2) < r + 0.8 && Math.abs(x) < W / 2 + r);
    const lists = [[], []], step = 4.2;
    for (let gz = -L / 2 - 40; gz <= L / 2 + 40; gz += step) for (let gx = -W / 2 - 40; gx <= W / 2 + 40; gx += step) {
      if (rnd() < 0.12) continue;
      const x = gx + (rnd() - 0.5) * 2.2, z = gz + (rnd() - 0.5) * 2.2, r = 1.7 + rnd() * 1.4;
      if (open(x, z, r)) continue;
      lists[rnd() < 0.5 ? 0 : 1].push([x, z, r]);
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x6fa8bf, emissiveIntensity: 0.45, roughness: 0.55 });
    lists.forEach((list, v) => instanced(iceGeometry(seed + 200 + v), mat, list, ([x, z, r], i, o) => {
      const thick = inArena(x, z) ? 0.3 + rnd() * 0.25 : 0.4 + rnd() * 1.1;
      o.position.set(x, 0.1, z); o.rotation.set(0, rnd() * TAU, 0); o.scale.set(r * (0.85 + rnd() * 0.3), thick, r * (0.85 + rnd() * 0.3));
    }, { color: () => tint(0xe6f4fa, 0.06) }));
  }

  // ---------------------------------------------------------------- per-frame
  const _cam = new THREE.Vector3(), _vp = new THREE.Vector4();
  const n = animators.length;

  return {
    root,
    update(time, env) {
      U.uTime.value = time;
      if (env) {
        const w = env.cfg && env.cfg.waves;
        U.uWaveA.value = w && w.amplitude > 0 && env.waveOmega ? w.amplitude : 0;
        U.uWaveK.value = env.waveK || 0;
        U.uWaveW.value = env.waveOmega || 0;
        U.uWaveT.value = env.time ?? time;
        if (env.waveDir) U.uWaveD.value.set(env.waveDir[0], env.waveDir[1]);
      }
      for (let i = 0; i < n; i++) animators[i](time);
    },
    applyForCamera(camera, renderer) {
      camera.getWorldPosition(_cam);
      const eta = U.uWaveA.value * Math.cos(U.uWaveK.value * (-_cam.z * U.uWaveD.value.x + _cam.x * U.uWaveD.value.y) - U.uWaveW.value * U.uWaveT.value);
      const under = _cam.y < eta;
      scene.fog = under ? fogUnder : fogAbove;
      scene.background = under ? bgUnder : bgAbove;
      if (rays) rays.visible = under;
      let h = 0;
      if (renderer && renderer.getCurrentViewport) { renderer.getCurrentViewport(_vp); h = _vp.w; }
      if (!h) h = (renderer && renderer.domElement && renderer.domElement.height) || 800;
      U.uPointScale.value = (h * 0.5) / Math.tan(((camera.fov || 60) * Math.PI) / 360);
    },
    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        if (o.isInstancedMesh) o.dispose();
      });
      for (const t of textures) t.dispose();
      scene.remove(root);
      if (scene.fog === fogUnder || scene.fog === fogAbove) scene.fog = prevFog ?? null;
      if (scene.background === bgUnder || scene.background === bgAbove) scene.background = prevBg ?? null;
    },
  };
}
