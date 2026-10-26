// DUBURI RoboSub — browser game entry. One WebGL canvas, split into one
// viewport per player (a spectator camera fills the 4th quadrant for three
// players). Physics runs at a fixed 120 Hz; rendering interpolates poses.

import * as THREE from 'three';
import logoUrl from '../assets/logo.jpg';
import { Game } from './sim/game.js';
import { DT } from './sim/vehicle.js';
import { Autopilot } from './sim/autopilot.js';
import { BOTS } from './sim/bots.js';
import { SCENARIOS } from './sim/scenarios.js';
import { createScenery } from './render/scenery.js';
import { createBotMesh, createItemMesh, disposeObject } from './render/bots3d.js';
import { createCourse, ned } from './render/course3d.js';
import { HUD } from './ui/hud.js';
import { Input } from './ui/input.js';
import { Sound } from './ui/audio.js';
import { Menu, resultsHTML, rulesHTML, controlsHTML } from './ui/menu.js';

const CAMS = ['chase', 'front', 'down'];
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

// NED body->world quaternion [w,x,y,z] -> three.js quaternion (basis change P q P^T)
function nedQuat(q, out) { return out.set(q[2], -q[3], -q[1], q[0]); }

class App {
  constructor(root) {
    this.root = root;
    root.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl';
    root.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setScissorTest(true);
    this.ui = document.createElement('div');
    this.ui.className = 'ui';
    root.appendChild(this.ui);
    this.logoTexture = new THREE.TextureLoader().load(logoUrl);
    this.logoTexture.colorSpace = THREE.SRGBColorSpace;
    this.logoTexture.anisotropy = 4;
    this.input = new Input(window);
    this.sound = new Sound();
    this.menu = new Menu(this.ui, { logoUrl, thumb: (bot, color) => this.thumb(bot, color), onStart: (cfg) => this.start(cfg), sound: this.sound });
    this.thumbs = new Map();
    this.state = 'menu';
    this.menuScene();
    this.menu.show('title');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape') this.togglePause(); });
    this.last = performance.now();
    this.fps = 60;
    this.renderer.setAnimationLoop(() => this.frame());
    window.__duburi = this; // handle for tests / debugging
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.W = w; this.H = h;
    if (this.views) this.layoutViews();
  }

  // ------------------------------------------------------------------ menu background
  menuScene() {
    this.disposeScene();
    const scene = new THREE.Scene();
    this.scene = scene;
    this.scenery = createScenery(scene, SCENARIOS.pacific, { logoTexture: this.logoTexture, clearZones: [] });
    const cam = new THREE.PerspectiveCamera(60, 1, 0.05, 400);
    this.menuCam = cam;
    this.menuBots = [];
    ['duburi', 'manta', 'barracuda'].forEach((id, i) => {
      const m = createBotMesh(BOTS[id], BOTS[id].color, { logoTexture: this.logoTexture });
      scene.add(m.group);
      this.menuBots.push({ m, i, ph: i * 2.1 });
    });
    this.fakeEnv = { time: 0, cfg: { waves: { amplitude: 0.1, period: 4.5, direction: 60 } }, waveK: 0.2, waveOmega: 1.4, waveDir: [0.5, 0.86] };
  }

  thumb(bot, color) {
    const key = `${bot}|${color}`;
    if (this.thumbs.has(key)) return Promise.resolve(this.thumbs.get(key));
    if (!this.thumbR) {
      this.thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.thumbR.setSize(240, 150);
      this.thumbR.outputColorSpace = THREE.SRGBColorSpace;
      this.thumbR.toneMapping = THREE.ACESFilmicToneMapping;
      this.thumbScene = new THREE.Scene();
      this.thumbScene.add(new THREE.HemisphereLight(0xdff4ff, 0x203040, 1.6));
      const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(2, 3, 2); this.thumbScene.add(d);
      this.thumbCam = new THREE.PerspectiveCamera(32, 240 / 150, 0.01, 50);
    }
    // one at a time: every call shares the thumbnail scene
    const job = (this.thumbQueue || Promise.resolve()).then(() => this.renderThumb(bot, color, key));
    this.thumbQueue = job;
    return job;
  }

  renderThumb(bot, color, key) {
    if (this.thumbs.has(key)) return this.thumbs.get(key);
    const m = createBotMesh(BOTS[bot], color, { logoTexture: this.logoTexture });
    this.thumbScene.add(m.group);
    const L = Math.max(...BOTS[bot].dims);
    this.thumbCam.position.set(L * 1.7, L * 0.9, L * 1.5);
    this.thumbCam.lookAt(0, 0, 0);
    // wait a frame so the logo texture is uploaded
    return new Promise((res) => requestAnimationFrame(() => {
      this.thumbR.render(this.thumbScene, this.thumbCam);
      const url = this.thumbR.domElement.toDataURL('image/png');
      this.thumbScene.remove(m.group);
      disposeObject(m.group);
      this.thumbs.set(key, url);
      res(url);
    }));
  }

  // ------------------------------------------------------------------ game
  start(cfg) {
    this.menu.hide();
    this.closeOverlay();
    this.cfg = cfg;
    this.disposeScene();
    const game = new Game(cfg);
    this.game = game;
    const scene = new THREE.Scene();
    this.scene = scene;
    const c = game.course;
    const clear = [c.dock.pos, c.gate.pos, c.slalom.pos, c.bin.pos, c.board.pos, c.octagon.pos].map((p) => ({ x: p[1], z: -p[0], r: 4 }));
    this.scenery = createScenery(scene, SCENARIOS[cfg.scenario], { logoTexture: this.logoTexture, clearZones: clear });
    this.course3d = createCourse(c, { logoTexture: this.logoTexture });
    scene.add(this.course3d.group);
    this.devices = cfg.players.map((p) => p.device);
    this.pilots = cfg.players.map((p, i) => (p.device === 'cpu' ? new Autopilot(game, i) : null));
    this.bots = game.players.map((p) => {
      const m = createBotMesh(p.design, p.color, { logoTexture: this.logoTexture });
      scene.add(m.group);
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(Math.max(...p.design.dims) * 0.6, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      scene.add(shadow);
      return { m, shadow, prevP: p.veh.p.slice(), prevQ: p.veh.q.slice(), state: { gripClosed: false, holding: false, markers: 2, torpedoes: 2 } };
    });
    this.itemMeshes = new Map();
    // one camera per human player (CPU players get one too when alone)
    const humans = game.players.filter((_, i) => this.devices[i] !== 'cpu');
    this.viewPlayers = (humans.length ? humans : [game.players[0]]).map((p) => p.index);
    this.cams = game.players.map(() => 'chase');
    this.views = this.viewPlayers.map((pi) => ({ pi, cam: new THREE.PerspectiveCamera(66, 1, 0.03, 300), smooth: null }));
    if (this.views.length === 3) this.views.push({ pi: -1, cam: new THREE.PerspectiveCamera(55, 1, 0.1, 300), spectator: true });
    this.hud = new HUD(this.ui, game, { logoUrl, cams: this.cams });
    // HUD panels exist for every player; only viewed players are shown
    this.hud.panels.forEach((P, i) => { P.el.hidden = !this.viewPlayers.includes(i); });
    this.layoutViews();
    this.acc = 0;
    this.pingNext = c.pingers.map(() => 0);
    this.paused = false;
    this.state = 'game';
    this.overShown = false;
  }

  layoutViews() {
    const W = this.W, H = this.H, n = this.views.length;
    let rects;
    if (n === 1) rects = [{ x: 0, y: 0, w: W, h: H }];
    else if (n === 2) rects = W >= H ? [{ x: 0, y: 0, w: W / 2, h: H }, { x: W / 2, y: 0, w: W / 2, h: H }] : [{ x: 0, y: 0, w: W, h: H / 2 }, { x: 0, y: H / 2, w: W, h: H / 2 }];
    else rects = [{ x: 0, y: 0, w: W / 2, h: H / 2 }, { x: W / 2, y: 0, w: W / 2, h: H / 2 }, { x: 0, y: H / 2, w: W / 2, h: H / 2 }, { x: W / 2, y: H / 2, w: W / 2, h: H / 2 }];
    rects = rects.map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }));
    this.views.forEach((v, i) => { v.rect = rects[i]; v.cam.aspect = rects[i].w / rects[i].h; v.cam.updateProjectionMatrix(); });
    const hudRects = [];
    this.views.forEach((v) => { if (v.pi >= 0) hudRects[v.pi] = v.rect; });
    if (this.hud) this.hud.layout(this.game.players.map((_, i) => hudRects[i] || { x: 0, y: 0, w: 0, h: 0 }));
    this.splitLines?.remove();
    if (n > 1) {
      this.splitLines = document.createElement('div');
      this.splitLines.className = `split split-${n === 2 ? (W >= H ? 'v' : 'h') : 'q'}`;
      this.ui.appendChild(this.splitLines);
    }
  }

  disposeScene() {
    if (this.hud) { this.hud.dispose(); this.hud = null; }
    this.splitLines?.remove();
    this.splitLines = null;
    if (this.scene) {
      this.scenery?.dispose?.();
      this.scene.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
      this.scene = null;
    }
    this.views = null;
    this.game = null;
  }

  togglePause(force) {
    if (this.state !== 'game' || !this.game) return;
    if (this.game.over && this.overShown) return;
    this.paused = force ?? !this.paused;
    if (this.paused) this.pauseOverlay(); else this.closeOverlay();
  }

  overlay(html) {
    this.closeOverlay();
    const o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = `<div class="panel">${html}</div>`;
    this.ui.appendChild(o);
    this.ov = o;
    return o;
  }
  closeOverlay() { if (this.ov) { this.ov.remove(); this.ov = null; } }

  pauseOverlay() {
    const o = this.overlay(`<header><h2>Paused</h2></header><div class="scroll"><div class="pause-btns">
      <button class="btn primary" data-a="resume">Resume</button>
      <button class="btn" data-a="restart">Restart (same setup)</button>
      <button class="btn" data-a="mute">${this.sound.muted ? 'Sound on' : 'Mute'}</button>
      <button class="btn" data-a="quit">Main menu</button></div>
      <h3>Rules</h3>${rulesHTML()}<h3>Controls</h3>${controlsHTML()}</div>`);
    o.querySelector('[data-a=resume]').onclick = () => this.togglePause(false);
    o.querySelector('[data-a=restart]').onclick = () => this.start(this.cfg);
    o.querySelector('[data-a=mute]').onclick = (e) => { this.sound.setMuted(!this.sound.muted); e.target.textContent = this.sound.muted ? 'Sound on' : 'Mute'; };
    o.querySelector('[data-a=quit]').onclick = () => this.toMenu();
  }

  toMenu() {
    this.closeOverlay();
    this.state = 'menu';
    this.sound.motor(0);
    this.menuScene();
    this.menu.show('setup');
  }

  showResults() {
    this.overShown = true;
    const o = this.overlay(`<header><img src="${logoUrl}" alt="" class="hdr-logo"><h2>Results — ${SCENARIOS[this.game.scenario].name}</h2></header><div class="scroll">${resultsHTML(this.game)}<div class="pause-btns"><button class="btn primary" data-a="again">Play again</button><button class="btn" data-a="menu">Main menu</button></div></div>`);
    o.querySelector('[data-a=again]').onclick = () => this.start(this.cfg);
    o.querySelector('[data-a=menu]').onclick = () => this.toMenu();
  }

  // ------------------------------------------------------------------ per frame
  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    if (this.state === 'game' && this.game) this.gameFrame(dt);
    else this.menuFrame(dt);
    this.input.endFrame();
  }

  menuFrame(dt) {
    const t = (this.fakeEnv.time += dt);
    this.menuBots.forEach((b) => {
      const a = t * 0.25 + b.ph;
      b.m.group.position.set(Math.cos(a) * (2.2 + b.i * 0.8), -1.4 - b.i * 0.5 + Math.sin(t * 0.7 + b.i) * 0.15, Math.sin(a) * (2.2 + b.i * 0.8) - 2);
      b.m.group.rotation.set(Math.sin(t * 0.5 + b.i) * 0.08, -a, 0);
      b.m.update(dt, { th: BOTS[['duburi', 'manta', 'barracuda'][b.i]].thrusters.map(() => ({ n: 0.6, Teff: 10 })) }, { gripClosed: false, holding: false, markers: 2, torpedoes: 2 });
    });
    this.menuCam.aspect = this.W / this.H;
    this.menuCam.updateProjectionMatrix();
    this.menuCam.position.set(Math.sin(t * 0.05) * 1.5, -1.2, 4.5);
    this.menuCam.lookAt(0, -1.6, -2);
    this.scenery.update(t, this.fakeEnv);
    this.renderer.setViewport(0, 0, this.W, this.H);
    this.renderer.setScissor(0, 0, this.W, this.H);
    this.scenery.applyForCamera(this.menuCam, this.renderer);
    this.renderer.render(this.scene, this.menuCam);
  }

  handleInput() {
    const g = this.game;
    g.players.forEach((p, i) => {
      const dev = this.devices[i];
      if (dev === 'cpu') return;
      const r = this.input.read(dev);
      Object.assign(p.veh.input, r.axes);
      for (const a of r.actions) {
        if (a === 'camera') this.cams[i] = CAMS[(CAMS.indexOf(this.cams[i]) + 1) % CAMS.length];
        else if (a === 'pause') this.togglePause();
        else {
          if (a === 'marker' && p.run.markers > 0 && p.run.state === 'running') this.sound.drop();
          if (a === 'torpedo' && p.run.torpedoes > 0 && p.run.state === 'running') this.sound.launch();
          g.action(i, a);
        }
      }
    });
  }

  gameFrame(dt) {
    const g = this.game;
    if (!this.paused && !g.over) {
      this.handleInput();
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 10) {
        g.players.forEach((p, i) => { this.bots[i].prevP = p.veh.p.slice(); this.bots[i].prevQ = p.veh.q.slice(); });
        this.pilots.forEach((ap) => ap && ap.update(DT));
        g.step(DT);
        this.acc -= DT;
        n++;
      }
      if (n === 10) this.acc = 0;
    } else if (this.paused) this.input.read('kbA'); // keep gamepad edge state fresh
    // gamepad Start can unpause
    if (this.paused) for (let i = 0; i < 4; i++) { const r = this.input.read(`pad${i}`); if (r.actions.includes('pause')) this.togglePause(false); }
    const alpha = Math.min(1, this.acc / DT);
    this.events();
    this.syncMeshes(alpha, dt);
    this.audio();
    this.course3d.update(g.time);
    this.scenery.update(g.env.time, g.env);
    this.hud.update(dt);
    for (const v of this.views) this.renderView(v, dt);
    if (g.over && !this.overShown) { this.overShown = true; setTimeout(() => this.showResults(), 2500); }
  }

  events() {
    const g = this.game;
    for (const e of g.events.splice(0)) {
      if (e.player >= 0) this.hud.toast(e.player, e.text, e.pts, e.kind);
      const viewed = e.player < 0 || this.viewPlayers.includes(e.player);
      if (!viewed) continue;
      if (e.kind === 'score' && e.pts > 0) this.sound.score();
      else if (e.kind === 'bad') this.sound.bad();
    }
  }

  syncMeshes(alpha, dt) {
    const g = this.game;
    g.players.forEach((p, i) => {
      const b = this.bots[i], v = p.veh;
      const P0 = b.prevP, P1 = v.p;
      const x = P0[0] + (P1[0] - P0[0]) * alpha, y = P0[1] + (P1[1] - P0[1]) * alpha, z = P0[2] + (P1[2] - P0[2]) * alpha;
      b.m.group.position.set(y, -z, -x);
      nedQuat(b.prevQ, tmpQ);
      nedQuat(v.q, b.m.group.quaternion);
      b.m.group.quaternion.copy(tmpQ.slerp(b.m.group.quaternion, alpha));
      b.state.holding = !!p.run.held;
      b.state.gripClosed = !!p.run.held;
      b.state.markers = p.run.markers;
      b.state.torpedoes = p.run.torpedoes;
      b.m.update(dt, v, b.state);
      const fl = -g.course.floor + 0.012;
      b.shadow.position.set(y, fl, -x);
      const hgt = g.course.floor - z;
      b.shadow.material.opacity = Math.max(0, 0.35 - hgt * 0.06);
      if (v.lastImpact > 0.25 && this.viewPlayers.includes(i)) this.sound.bump(v.lastImpact);
      v.lastImpact = 0;
    });
    // payload items
    const seen = new Set();
    for (const it of g.items) {
      seen.add(it.id);
      let m = this.itemMeshes.get(it.id);
      if (!m) {
        m = createItemMesh(it.kind, it.owner ? it.owner.color : '#ffffff');
        this.scene.add(m);
        this.itemMeshes.set(it.id, m);
      }
      m.position.copy(ned(it.pos[0], it.pos[1], it.pos[2]));
      if (it.kind === 'torpedo' && it.state === 'fall') {
        const sp = Math.hypot(it.vel[0], it.vel[1], it.vel[2]);
        if (sp > 0.05) { tmpV.copy(m.position).sub(tmpV2.set(it.vel[1], -it.vel[2], -it.vel[0])); m.lookAt(tmpV); }
      } else if (it.state === 'held' && it.holder) {
        nedQuat(it.holder.veh.q, m.quaternion);
      }
    }
    for (const [id, m] of this.itemMeshes) if (!seen.has(id)) { this.scene.remove(m); this.itemMeshes.delete(id); }
  }

  audio() {
    const g = this.game;
    // thrusters of the viewed players
    let lvl = 0, nV = 0;
    for (const pi of this.viewPlayers) {
      const v = g.players[pi].veh;
      lvl += v.th.reduce((s, t) => s + Math.abs(t.n), 0) / v.th.length;
      nV++;
    }
    this.sound.motor(this.paused || g.over ? 0 : (lvl / Math.max(1, nV)) * 1.4);
    // pingers heard on the first viewed vehicle's hydrophone
    const me = g.players[this.viewPlayers[0]];
    g.course.pingers.forEach((pg, k) => {
      if (g.time < this.pingNext[k]) return;
      this.pingNext[k] = g.time + pg.period;
      if (this.paused) return;
      const b = g.pingerBearing(me, pg.id);
      this.sound.ping(pg.freq, Math.min(1, 6 / (b.dist + 2)), Math.sin(b.rel));
    });
  }

  renderView(view, dt) {
    const g = this.game, r = this.renderer, cam = view.cam;
    const k = 1 - Math.exp(-dt * 6);
    if (view.spectator) {
      const t = g.time * 0.03;
      cam.position.set(Math.sin(t) * 14, 3.5, Math.cos(t) * 18);
      cam.lookAt(0, -2.5, 0);
    } else {
      const p = g.players[view.pi], v = p.veh, mode = this.cams[view.pi];
      const grp = this.bots[view.pi].m.group;
      const d = p.design;
      if (mode === 'chase') {
        const yaw = v.projectedHeading(v.q);
        const back = Math.max(1.4, d.dims[0] * 2.2), up = 0.55 + d.dims[2];
        const want = tmpV.set(grp.position.x - Math.sin(yaw) * back, grp.position.y + up, grp.position.z + Math.cos(yaw) * back);
        // keep the camera inside the arena and above the floor
        want.y = Math.max(want.y, -g.course.floor + 0.3);
        want.x = Math.max(-12.3, Math.min(12.3, want.x));
        want.z = Math.max(-24.8, Math.min(24.8, want.z));
        if (!view.smooth) view.smooth = want.clone();
        view.smooth.lerp(want, k);
        cam.position.copy(view.smooth);
        cam.fov = 66;
        tmpV2.set(grp.position.x + Math.sin(yaw) * 1.2, grp.position.y - 0.1, grp.position.z - Math.cos(yaw) * 1.2);
        cam.up.set(0, 1, 0);
        cam.lookAt(tmpV2);
      } else {
        // onboard cameras ride with the vehicle (body -> three local: (y, -z, -x))
        const front = mode === 'front';
        const b = front ? [d.dims[0] / 2 + 0.03, 0, 0] : [0, 0, d.dims[2] / 2 + 0.03];
        tmpV.set(b[1], -b[2], -b[0]).applyQuaternion(grp.quaternion).add(grp.position);
        cam.position.copy(tmpV);
        cam.quaternion.copy(grp.quaternion);
        if (!front) cam.quaternion.multiply(tmpQ.setFromAxisAngle(tmpV2.set(1, 0, 0), -Math.PI / 2));
        cam.fov = front ? 78 : 72;
        view.smooth = null;
      }
      cam.updateProjectionMatrix();
    }
    const rc = view.rect;
    const y = this.H - rc.y - rc.h;
    r.setViewport(rc.x, y, rc.w, rc.h);
    r.setScissor(rc.x, y, rc.w, rc.h);
    // hide your own vehicle in the onboard views
    const own = view.pi >= 0 && this.cams[view.pi] !== 'chase' ? this.bots[view.pi].m.group : null;
    if (own) own.visible = false;
    this.scenery.applyForCamera(cam, r);
    r.render(this.scene, cam);
    if (own) own.visible = true;
  }
}

function boot() {
  const root = document.getElementById('app');
  try {
    new App(root);
  } catch (e) {
    root.innerHTML = `<div class="boot">Could not start: ${String(e.message || e)}. This game needs a browser with WebGL2 (Chrome, Edge, Firefox, Safari).</div>`;
    throw e;
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
