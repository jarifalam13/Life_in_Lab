// Image-quality settings shared by the game: a reflection environment for the
// metal / acrylic parts (PMREM of a sky-over-water gradient per scenario) and
// sun shadows, rendered once per frame for all split-screen views.

import * as THREE from 'three';

export const QUALITY = {
  high: { label: 'High', post: 'high', shadows: 2048, pixelRatio: 1.25, bubbles: 2000 },
  medium: { label: 'Medium', post: 'low', shadows: 1024, pixelRatio: 1, bubbles: 1200 },
  low: { label: 'Low', post: null, shadows: 0, pixelRatio: 1, bubbles: 600 },
};
export const QUALITY_ORDER = ['high', 'medium', 'low'];

const STORE = 'life-as-duburi-quality';
export function loadQuality() {
  try { const q = localStorage.getItem(STORE); if (QUALITY[q]) return q; } catch { /* storage unavailable */ }
  return 'high';
}
export function saveQuality(q) { try { localStorage.setItem(STORE, q); } catch { /* ignore */ } }

// Gradient sphere (bright surface above, deep water below) baked to a PMREM
// environment map: gives the vehicles believable reflections in each water.
export function makeEnvironment(renderer, look) {
  const scene = new THREE.Scene();
  const top = new THREE.Color(look.surface).lerp(new THREE.Color(0xffffff), 0.45);
  const mid = new THREE.Color(look.water);
  const bot = new THREE.Color(look.fog).multiplyScalar(0.25);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: top }, mid: { value: mid }, bot: { value: bot } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vDir;
      void main(){ float y = vDir.y; vec3 c = y > 0.0 ? mix(mid, top, pow(y, 0.6)) : mix(mid, bot, pow(-y, 0.7));
        c += vec3(1.0, 0.97, 0.9) * pow(max(y, 0.0), 24.0) * 3.0; // sun / Snell's window
        gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.02);
  pm.dispose();
  mat.dispose();
  return rt.texture;
}

// Turn on sun shadows: the scenery's DirectionalLight casts onto the floor,
// course elements and vehicles. The shadow map is refreshed once per frame by
// the caller (renderer.shadowMap.needsUpdate) instead of once per viewport.
export function setupShadows(renderer, scene, sceneryRoot, size, arena) {
  renderer.shadowMap.enabled = size > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  if (!size) return null;
  let sun = null;
  sceneryRoot.traverse((o) => { if (o.isDirectionalLight && !sun) sun = o; });
  if (!sun) return null;
  sun.castShadow = true;
  sun.shadow.mapSize.set(size, size);
  const half = Math.max(arena.length, arena.width) / 2 + 4;
  const cam = sun.shadow.camera;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.near = 1; cam.far = 120;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  // high sun, slightly from the south-east, over the arena centre
  sun.position.set(9, 45, 14);
  sun.target.position.set(0, -arena.depth, 0);
  if (!sun.target.parent) scene.add(sun.target);
  cam.updateProjectionMatrix();
  // the floor and everything in the water receive
  sceneryRoot.traverse((o) => { if (o.isMesh && !o.material?.transparent) o.receiveShadow = true; });
  return sun;
}

export function castShadows(obj, cast = true, receive = true) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast && !o.material?.transparent; o.receiveShadow = receive; } });
}
