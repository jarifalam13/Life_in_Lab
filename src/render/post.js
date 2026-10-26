// Per-viewport post-processing for the split-screen game. Every player view is
// rendered into its own linear HDR (HalfFloat) target, gets a soft bloom from a
// small mip chain, and is composited into its rectangle of the shared canvas by
// one full-screen-triangle pass: under-water refraction wobble, depth
// absorption and grade, bloom, vignette, chromatic aberration, grain / dither,
// then tone mapping + sRGB output exactly like three's OutputPass (the
// renderer's toneMapping / exposure / outputColorSpace are honoured).
//
//   const post = createPost(renderer, { quality: 'high' });
//   // per view, after setViewport/setScissor(rect) and scenery.applyForCamera():
//   post.render(scene, camera, rect, { underwater, depth, time, waterColor, turbidity });
//
// rect is in CSS pixels with a top-left origin (like the game's view rects).
// Render targets are cached by pixel size, so equal-size views share them.

import * as THREE from 'three';

// ------------------------------------------------------------------ shaders

const VS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// 4x4 box downsample (4 bilinear taps on texel corners) with a Karis-style
// luminance weighting against fireflies, then a soft-knee threshold.
const BRIGHT_FS = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold, uKnee;
varying vec2 vUv;
float kw(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
void main() {
  vec3 a = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 b = texture2D(tSrc, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
  vec3 c = texture2D(tSrc, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
  vec3 d = texture2D(tSrc, vUv + vec2( 1.0,  1.0) * uTexel).rgb;
  float wa = kw(a), wb = kw(b), wc = kw(c), wd = kw(d);
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float k = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(min(col * k, vec3(24.0)), 1.0);
}`;

// 9-tap Gaussian (binomial) as 5 linear-filtered taps along uDir.
const BLUR_FS = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const FINAL_FS = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform vec3 uBloomW;
uniform vec3 uAbsorb;
uniform float uSat, uContrast, uTime, uAspect, uWobble, uCA, uVignette, uGrain;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  vec2 c = vUv - 0.5;

  // refraction wobble (uWobble = 0 above water), faded out at the borders so
  // the clamped edge texels never smear into the view
  vec2 q = vec2(uv.x * uAspect, uv.y);
  vec2 wob = vec2(sin(q.y * 21.0 + uTime * 1.7) + 0.6 * sin(q.y * 37.0 - q.x * 11.0 + uTime * 2.6),
                  cos(q.x * 17.0 + uTime * 1.3) + 0.6 * cos(q.x * 31.0 + q.y * 13.0 - uTime * 2.1));
  vec2 e = smoothstep(vec2(0.0), vec2(0.03), uv) * smoothstep(vec2(0.0), vec2(0.03), 1.0 - uv);
  uv += wob * (uWobble * 0.625 * e.x * e.y);

#ifdef CHROMA
  // lateral chromatic aberration, growing toward the edges
  vec2 ca = c * dot(c, c) * uCA;
  vec3 col = vec3(texture2D(tScene, uv + ca).r, texture2D(tScene, uv).g, texture2D(tScene, uv - ca).b);
#else
  vec3 col = texture2D(tScene, uv).rgb;
#endif

  vec3 bloom = texture2D(tBloom0, uv).rgb * uBloomW.x;
#if BLOOM_LEVELS > 1
  bloom += texture2D(tBloom1, uv).rgb * uBloomW.y;
  bloom += texture2D(tBloom2, uv).rgb * uBloomW.z;
#endif
  col += bloom;

  // under water: absorption over the water column above the camera (reds go
  // first, biased toward the water's hue) and a slight grade; identity above
  col *= uAbsorb;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, uSat), vec3(1e-6));
  col = 0.18 * pow(col / 0.18, vec3(uContrast));

  // soft vignette that follows the view's shape
  float d = length(c) * 1.41421356;
  col *= 1.0 - uVignette * smoothstep(0.3, 1.0, d);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  // grain + dither in display space (kills banding in the fog gradients)
  vec2 fc = gl_FragCoord.xy + fract(uTime * 7.31) * vec2(317.0, 191.0);
  float n = hash12(fc) + hash12(fc + vec2(57.3, 13.1)) - 1.0;
  gl_FragColor.rgb += n * uGrain;
}`;

// bloom layout per quality: bright pass and level sizes as divisors of the view,
// blur step (in destination texels) and level weights
const PRESETS = {
  high: { msaa: 4, bright: 4, levels: [4, 8, 16], spread: 1.0, weights: [0.4, 0.35, 0.3], chroma: true },
  low: { msaa: 0, bright: 4, levels: [4], spread: 1.0, weights: [1.0, 0, 0], chroma: false },
};

const MAX_CACHED = 4; // render-target sets kept (one per distinct view size)
const STALE = 240; // render calls after which an unused size is freed

export function createPost(renderer, { quality = 'high' } = {}) {
  quality = quality === 'low' ? 'low' : 'high';
  let P = PRESETS[quality];

  // HalfFloat colour buffers need EXT_color_buffer_float (all desktop WebGL2);
  // fall back to 8-bit targets (no HDR bloom headroom) where it is missing
  const ext = renderer.extensions;
  const hdr = !ext || !ext.has || ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
  const rtType = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;

  // tunables (multipliers / values the game may tweak at runtime)
  const settings = {
    bloom: 1, // bloom strength multiplier
    threshold: 1, // bloom threshold multiplier
    vignette: 1,
    aberration: 1,
    grain: 1,
    wobble: 1,
    absorption: 1,
  };

  // ---- shared full-screen triangle + camera
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false, ...extra,
  });

  const brightMat = pass(BRIGHT_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 } });
  const blurMat = pass(BLUR_FS, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
  const finalMat = pass(FINAL_FS, {
    tScene: { value: null }, tBloom0: { value: null }, tBloom1: { value: null }, tBloom2: { value: null },
    uBloomW: { value: new THREE.Vector3() }, uAbsorb: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1 }, uContrast: { value: 1 }, uTime: { value: 0 }, uAspect: { value: 1 },
    uWobble: { value: 0 }, uCA: { value: 0 }, uVignette: { value: 0 }, uGrain: { value: 0 },
  }, { toneMapped: true }); // tone mapping + sRGB happen here, on the way to the canvas
  const setDefines = () => {
    finalMat.defines = { BLOOM_LEVELS: P.levels.length };
    if (P.chroma) finalMat.defines.CHROMA = '';
    finalMat.needsUpdate = true;
  };
  setDefines();

  const quad = new THREE.Mesh(tri, finalMat);
  quad.frustumCulled = false;

  // ---- render targets, cached per view size in device pixels
  const cache = new Map();
  let tick = 0;
  const makeRT = (w, h, samples, depthBuffer) => {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: rtType, format: THREE.RGBAFormat, depthBuffer, stencilBuffer: false, samples,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    rt.texture.name = 'post';
    if (!hdr) rt.texture.colorSpace = THREE.SRGBColorSpace; // 8-bit fallback: sRGB storage against banding
    return rt;
  };
  const disposeSet = (e) => {
    e.scene.dispose(); e.bright.dispose();
    for (const t of e.tmp) t.dispose();
    for (const t of e.lvl) t.dispose();
  };
  const clearCache = () => { for (const e of cache.values()) disposeSet(e); cache.clear(); };
  const sz = (v, div) => Math.max(1, Math.round(v / div));
  function targets(pw, ph) {
    const key = pw * 65536 + ph;
    let e = cache.get(key);
    if (!e) {
      if (cache.size >= MAX_CACHED) { // drop the least recently used size
        let oldK = -1, oldT = Infinity;
        for (const [k, v] of cache) if (v.used < oldT) { oldT = v.used; oldK = k; }
        disposeSet(cache.get(oldK));
        cache.delete(oldK);
      }
      e = {
        scene: makeRT(pw, ph, P.msaa, true),
        bright: makeRT(sz(pw, P.bright), sz(ph, P.bright), 0, false),
        tmp: P.levels.map((d) => makeRT(sz(pw, d), sz(ph, d), 0, false)),
        lvl: P.levels.map((d) => makeRT(sz(pw, d), sz(ph, d), 0, false)),
        used: 0,
      };
      cache.set(key, e);
    }
    e.used = ++tick;
    if ((tick & 63) === 0) { // free sizes no view has used for a while (window resizes)
      for (const [k, v] of cache) if (tick - v.used > STALE) { disposeSet(v); cache.delete(k); }
    }
    return e;
  }

  function draw(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quad, cam);
  }

  // ---- per-call scratch (no allocations per frame)
  const _size = new THREE.Vector2();
  const _water = new THREE.Color(0x2f9fc4);
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  // per-channel transmittance of the water column above the camera, biased by
  // the water's hue; a floor keeps team colours readable and the camera's
  // exposure wins back part of the lost light
  function absorption(out, depth, turb, water) {
    if (!(depth > 0)) return out.set(1, 1, 1);
    const m = Math.max(water.r, water.g, water.b, 1e-4);
    const s = (0.45 + 0.8 * turb) * settings.absorption * depth;
    const tr = Math.exp(-s * (0.11 + 0.05 * (1 - water.r / m)));
    const tg = Math.exp(-s * (0.035 + 0.05 * (1 - water.g / m)));
    const tb = Math.exp(-s * (0.02 + 0.05 * (1 - water.b / m)));
    const r = 0.2 + 0.8 * tr, g = 0.2 + 0.8 * tg, b = 0.2 + 0.8 * tb;
    const comp = Math.pow(Math.max(0.2126 * r + 0.7152 * g + 0.0722 * b, 0.05), -0.6);
    return out.set(r * comp, g * comp, b * comp);
  }

  function render(scene, camera, rect, opts = {}) {
    if (!rect || rect.w <= 0 || rect.h <= 0) return;
    const under = !!opts.underwater;
    const depth = under ? Math.max(0, +opts.depth || 0) : 0;
    const turb = Math.min(1, Math.max(0, +opts.turbidity || 0));
    const time = Number.isFinite(opts.time) ? opts.time : ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) / 1000;
    const water = opts.waterColor && opts.waterColor.isColor ? opts.waterColor : _water;

    const pr = renderer.getPixelRatio();
    renderer.getSize(_size);
    const pw = Math.max(1, Math.round(rect.w * pr)), ph = Math.max(1, Math.round(rect.h * pr));
    const glY = _size.y - rect.y - rect.h;
    const T = targets(pw, ph);
    const prevAutoClear = renderer.autoClear;
    try {
      // 1. scene -> linear HDR target (three skips tone mapping / sRGB on targets);
      //    the target has its own full-size viewport and no scissor test
      renderer.setRenderTarget(T.scene);
      renderer.autoClear = true;
      renderer.render(scene, camera);
      renderer.autoClear = false;

      // 2. bloom: bright pass (4x4 box down to 1/4), then separable blur levels
      //    (each further level also halves the resolution)
      const bu = brightMat.uniforms;
      bu.tSrc.value = T.scene.texture;
      bu.uTexel.value.set(1 / pw, 1 / ph);
      const thr = (under ? 0.85 : 1.0) * settings.threshold;
      bu.uThreshold.value = thr;
      bu.uKnee.value = thr * 0.5;
      draw(brightMat, T.bright);
      const lu = blurMat.uniforms;
      let src = T.bright;
      for (let i = 0; i < T.lvl.length; i++) {
        const tmp = T.tmp[i], dst = T.lvl[i];
        lu.tSrc.value = src.texture;
        lu.uDir.value.set(P.spread / tmp.width, 0);
        draw(blurMat, tmp);
        lu.tSrc.value = tmp.texture;
        lu.uDir.value.set(0, P.spread / dst.height);
        draw(blurMat, dst);
        src = dst;
      }

      // 3. composite into the canvas rect (tone mapping + output colour space)
      const fu = finalMat.uniforms;
      fu.tScene.value = T.scene.texture;
      fu.tBloom0.value = T.lvl[0].texture;
      fu.tBloom1.value = (T.lvl[1] || T.lvl[0]).texture;
      fu.tBloom2.value = (T.lvl[2] || T.lvl[0]).texture;
      const bs = (under ? 0.24 + 0.1 * turb : 0.16) * settings.bloom;
      fu.uBloomW.value.set(P.weights[0] * bs, P.weights[1] * bs, P.weights[2] * bs);
      absorption(fu.uAbsorb.value, depth, turb, water);
      fu.uSat.value = under ? 1.08 - 0.1 * turb : 1.0;
      fu.uContrast.value = under ? 1.05 - 0.04 * turb : 1.0;
      fu.uTime.value = time;
      fu.uAspect.value = rect.w / rect.h;
      fu.uWobble.value = under ? (0.0022 + 0.0012 * turb) * settings.wobble : 0;
      fu.uCA.value = P.chroma ? (under ? 0.016 : 0.011) * settings.aberration : 0;
      fu.uVignette.value = (under ? 0.34 + 0.1 * turb : 0.18) * settings.vignette;
      fu.uGrain.value = (1.2 / 255 + (under ? 0.007 + 0.004 * turb : 0.004)) * settings.grain;

      renderer.setRenderTarget(null);
      renderer.setViewport(rect.x, glY, rect.w, rect.h);
      renderer.setScissor(rect.x, glY, rect.w, rect.h); // the scissor test keeps the renderer's own setting
      quad.material = finalMat;
      renderer.render(quad, cam);
    } finally {
      renderer.autoClear = prevAutoClear;
    }
  }

  return {
    render,
    settings,
    get quality() { return quality; },
    setQuality(q) {
      q = q === 'low' ? 'low' : 'high';
      if (q === quality) return;
      quality = q;
      P = PRESETS[q];
      clearCache();
      setDefines();
    },
    dispose() {
      clearCache();
      brightMat.dispose(); blurMat.dispose(); finalMat.dispose();
      tri.dispose();
    },
  };
}
