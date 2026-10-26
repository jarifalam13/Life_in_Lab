// Life as Duburi — browser game entry. One WebGL canvas split into one
// viewport per player, PS5-couch style (a TV camera with the leaderboard
// fills the 4th quarter for three players). Physics runs at a fixed 120 Hz;
// rendering interpolates poses. Each view goes through a post-processing
// pass (bloom, underwater grade); shadows are rendered once per frame.

import * as THREE from 'three';
import logoUrl from '../assets/logo.jpg';
import { Game } from './sim/game.js';
import { DT } from './sim/vehicle.js';
import { Autopilot } from './sim/autopilot.js';
import { BOTS } from './sim/bots.js';
import { SCENARIOS } from './sim/scenarios.js';
import { ARENA } from './sim/course.js';
import { createScenery } from './render/scenery.js';
import { createBotMesh, createItemMesh, disposeObject } from './render/bots3d.js';
import { createCourse, ned } from './render/course3d.js';
import { createPost } from './render/post.js';
import { createBubbles } from './render/bubbles.js';
import { QUALITY, QUALITY_ORDER, loadQuality, saveQuality, makeEnvironment, setupShadows, castShadows } from './render/graphics.js';
import { HUD } from './ui/hud.js';
import { Input } from './ui/input.js';
import { Sound } from './ui/audio.js';
import { Menu, resultsHTML, rulesHTML, controlsHTML, GAME_NAME } from './ui/menu.js';

const CAMS = ['chase', 'front', 'down'];
const TASK_NAME = { gate: 'Gate', slalom: 'Slalom', bin: 'Bin', torpedo: 'Torpedoes', octagon: 'Octagon', home: 'Return home' };
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// NED body->world quaternion [w,x,y,z] -> three.js quaternion (basis change P q P^T)
function nedQuat(q, out) { return out.set(q[2], -q[3], -q[1], q[0]); }
const SIZE_OF = (preset) => (preset.startsWith('t500') ? 't500' : preset.startsWith('generic') ? 'small' : 't200');
const MAX_RPM = { t200: 3500, t500: 3200, small: 4000 };

class App {
  constructor(root) {
    this.root = root;
    root.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl';
    root.appendChild(this.canvas);
    this.quality = loadQuality();
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
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
    this.menu = new Menu(this.ui, { logoUrl, thumb: (bot, color) => this.thumb(bot, color), onStart: (cfg) => this.start(cfg), sound: this.sound, input: this.input });
    this.thumbs = new Map();
    this.state = 'menu';
    this.applyQuality();
    this.menuScene();
    this.menu.show('title');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.last = performance.now();
    this.fps = 60;
    this.renderer.setAnimationLoop(() => this.frame());
    window.__duburi = this; // handle for tests / debugging
  }

  applyQuality() {
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.post?.dispose();
    this.post = q.post ? createPost(this.renderer, { quality: q.post }) : null;
    if (this.W) this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.W = w; this.H = h;
    if (this.views) this.layoutViews();
  }

  // ------------------------------------------------------------------ shared scene bits
  sceneExtras(scene, look, arena) {
    // reflections for metal and acrylic parts, sun shadows, bubbles
    if (this.envTex) this.envTex.dispose();
    this.envTex = makeEnvironment(this.renderer, look);
    scene.environment = this.envTex;
    scene.environmentIntensity = 0.55;
    const q = QUALITY[this.quality];
    this.sun = setupShadows(this.renderer, scene, this.scenery.root ?? scene, q.shadows, arena);
    this.bubbles = createBubbles(scene, { max: q.bubbles });
    this.look = look;
    this.waterColor = new THREE.Color(look.water);
    this.turbidity = Math.max(0, Math.min(1, (look.fogDensity - 0.02) / 0.05));
  }

  // ------------------------------------------------------------------ menu background
  menuScene() {
    this.disposeScene();
    const scene = new THREE.Scene();
    this.scene = scene;
    const sc = SCENARIOS.pacific;
    this.scenery = createScenery(scene, sc, { logoTexture: this.logoTexture, arena: { ...ARENA, depth: 12 }, clearZones: [] });
    this.sceneExtras(scene, sc.look, { ...ARENA, depth: 12 });
    const cam = new THREE.PerspectiveCamera(60, 1, 0.05, 400);
    this.menuCam = cam;
    this.menuBots = [];
    ['duburi', 'manta', 'dubomini'].forEach((id, i) => {
      const m = createBotMesh(BOTS[id], BOTS[id].color, { logoTexture: this.logoTexture });
      castShadows(m.group);
      scene.add(m.group);
      this.menuBots.push({ m, i, ph: i * 2.1, id, th: BOTS[id].thrusters.map(() => ({ n: 0.6, Teff: 10 })) });
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
      this.thumbScene.environment = makeEnvironment(this.thumbR, SCENARIOS.pool.look);
      this.thumbScene.environmentIntensity = 0.6;
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
    const sc = SCENARIOS[cfg.scenario];
    const clear = [c.dock.pos, c.gate.pos, c.slalom.pos, c.bin.pos, c.board.pos, c.octagon.pos].map((p) => ({ x: p[1], z: -p[0], r: 4 }));
    this.scenery = createScenery(scene, sc, { logoTexture: this.logoTexture, arena: game.arena, clearZones: clear });
    this.course3d = createCourse(c, { logoTexture: this.logoTexture });
    castShadows(this.course3d.group);
    scene.add(this.course3d.group);
    this.sceneExtras(scene, sc.look, game.arena);
    this.devices = cfg.players.map((p) => p.device);
    this.pilots = cfg.players.map((p, i) => (p.device === 'cpu' ? new Autopilot(game, i) : null));
    this.bots = game.players.map((p) => {
      const m = createBotMesh(p.design, p.color, { logoTexture: this.logoTexture });
      castShadows(m.group);
      scene.add(m.group);
      // soft contact shadow (ambient occlusion) under the vehicle
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(Math.max(...p.design.dims) * 0.6, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      scene.add(shadow);
      return { m, shadow, prevP: p.veh.p.slice(), prevQ: p.veh.q.slice(), state: { gripClosed: false, holding: false, markers: 2, torpedoes: 2 }, bub: new Float32Array(p.design.thrusters.length), wasSurf: true, n: new Float32Array(p.design.thrusters.length), size: SIZE_OF(p.design.thrusters[0].preset) };
    });
    this.itemMeshes = new Map();
    this.cams = game.players.map(() => 'chase');
    this.hud = new HUD(this.ui, game, { logoUrl, cams: this.cams });
    this.buildViews();
    this.acc = 0;
    this.pingNext = c.pingers.map(() => 0);
    this.paused = false;
    this.state = 'game';
    this.overShown = false;
  }

  // one view per human player still in the match (a CPU match shows player 1)
  buildViews() {
    const g = this.game;
    const humans = g.players.filter((p, i) => this.devices[i] !== 'cpu' && !p.left);
    this.viewPlayers = (humans.length ? humans : [g.players.find((p) => !p.left) || g.players[0]]).map((p) => p.index);
    const old = this.views || [];
    this.views = this.viewPlayers.map((pi) => old.find((v) => v.pi === pi) || { pi, cam: new THREE.PerspectiveCamera(66, 1, 0.03, 300), smooth: null });
    if (this.views.length === 3) this.views.push(old.find((v) => v.spectator) || { pi: -1, cam: new THREE.PerspectiveCamera(55, 1, 0.05, 300), spectator: true });
    this.hud.panels.forEach((P, i) => { P.el.hidden = !this.viewPlayers.includes(i); });
    this.layoutViews();
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
    if (this.hud) {
      this.hud.layout(this.game.players.map((_, i) => hudRects[i] || { x: 0, y: 0, w: 0, h: 0 }));
      const spec = this.views.find((v) => v.spectator);
      this.hud.setBoard(spec ? spec.rect : null);
    }
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
      this.bubbles?.dispose?.();
      this.scene.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
      this.scene = null;
    }
    this.bubbles = null;
    this.views = null;
    this.game = null;
  }

  // ------------------------------------------------------------------ menus (keyboard + gamepad navigation)
  onKey(e) {
    if (this.nav) {
      const k = e.code;
      this.input.pressed.delete(k); // a key used in a menu does nothing in the game
      if (k === 'ArrowUp' || k === 'KeyW') { this.navMove(-1); e.preventDefault(); }
      else if (k === 'ArrowDown' || k === 'KeyS') { this.navMove(1); e.preventDefault(); }
      else if (k === 'Enter' || k === 'Space' || k === 'NumpadEnter') { if (e.target?.tagName !== 'BUTTON') { this.navActivate(); e.preventDefault(); } }
      else if (k === 'Escape' || k === 'Tab' || k === 'Backspace') { this.navBack(); e.preventDefault(); }
      return;
    }
    if (e.code === 'Escape' && this.state === 'game') this.openPause(this.viewPlayers?.[0] ?? 0);
  }

  // overlay with a list of [data-nav] buttons the owner can move through
  overlay(html, { owner = -1, onBack = null } = {}) {
    this.closeOverlay();
    const o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = `<div class="panel">${html}</div>`;
    this.ui.appendChild(o);
    this.ov = o;
    const items = [...o.querySelectorAll('[data-nav]')];
    this.nav = { items, i: 0, owner, onBack };
    items.forEach((b, i) => b.addEventListener('mouseenter', () => this.navFocus(i)));
    this.navFocus(0);
    this.input.padPresses(); // swallow the press that opened it
    return o;
  }
  closeOverlay() { if (this.ov) { this.ov.remove(); this.ov = null; } this.nav = null; }
  navFocus(i) {
    const n = this.nav;
    if (!n || !n.items.length) return;
    n.i = (i + n.items.length) % n.items.length;
    n.items.forEach((b, k) => b.classList.toggle('focus', k === n.i));
    n.items[n.i].focus({ preventScroll: true });
  }
  navMove(d) { if (this.nav) { this.navFocus(this.nav.i + d); this.sfx('uiMove'); } }
  navActivate() { const n = this.nav; if (n && n.items[n.i]) { this.sfx('uiSelect'); n.items[n.i].click(); } }
  navBack() { const n = this.nav; if (n && n.onBack) { this.sfx('uiBack'); n.onBack(); } }
  navPoll() {
    if (!this.nav) return;
    for (const { pad, button } of this.input.padPresses()) {
      const owner = this.nav.owner;
      const ownerPad = owner >= 0 && this.devices?.[owner]?.startsWith('pad') ? +this.devices[owner].slice(3) : -1;
      if (ownerPad >= 0 && pad !== ownerPad && button !== 9) continue; // the owner drives their menu
      if (button === 12) this.navMove(-1);
      else if (button === 13) this.navMove(1);
      else if (button === 0) this.navActivate();
      else if (button === 1 || button === 9) this.navBack();
    }
  }
  sfx(name) { if (typeof this.sound[name] === 'function') this.sound[name](); else this.sound.click(); }

  // the pause menu belongs to the player who opened it
  openPause(pi) {
    if (this.state !== 'game' || !this.game || this.game.over) return;
    const g = this.game;
    const p = g.players[pi] || g.players[0];
    this.paused = true;
    this.sound.ensure();
    const running = p.run.state === 'running';
    const task = running ? TASK_NAME[g.currentTask(p)] : null;
    const humans = g.players.filter((x, i) => this.devices[i] !== 'cpu' && !x.left).length;
    const b = (a, label, sub = '', cls = '') => `<button class="mi ${cls}" data-nav data-a="${a}"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</button>`;
    const o = this.overlay(`<header style="--pc:${p.color}"><i class="pdot"></i><h2>Paused — ${esc(p.name)}</h2><span class="sub">${esc(p.design.name)} · ${g.total(p).toLocaleString()} pts${task ? ` · on: ${task}` : ''}</span></header>
      <div class="scroll"><div class="pause-menu">
        ${b('resume', 'Resume', '', 'primary')}
        ${running ? b('skip', `Skip task${task ? `: ${task}` : ''}`, 'no points for it — you are moved to the next task') : ''}
        ${running ? b('end', 'End run', 'keep the points of this run') : ''}
        ${b('forfeit', 'Forfeit run', 'lose this run\'s points and start again from the dock', 'warn')}
        ${humans > 1 ? b('leave', 'Leave match', 'the others keep playing', 'warn') : ''}
        ${b('restart', 'Restart match', 'same players, same water')}
        ${b('quit', 'Quit to main menu', '', 'bad')}
        ${b('quality', `Graphics: ${QUALITY[this.quality].label}`, 'High · Medium · Low')}
        ${b('mute', this.sound.muted ? 'Sound: off' : 'Sound: on')}
      </div>
      <p class="note nav-hint">↑ ↓ / D-pad to choose · Enter / ✕ / A to select · Esc / ○ / B to resume</p>
      <details><summary>Rules</summary>${rulesHTML()}</details><details><summary>Controls</summary>${controlsHTML()}</details></div>`, { owner: pi, onBack: () => this.resume() });
    const on = (a, fn) => { const el = o.querySelector(`[data-a=${a}]`); if (el) el.onclick = fn; };
    on('resume', () => this.resume());
    on('skip', () => { g.action(pi, 'skip'); this.resume(); });
    on('end', () => { g.action(pi, 'endRun'); this.resume(); });
    on('forfeit', () => { g.action(pi, 'forfeit'); this.resume(); });
    on('leave', () => this.leave(pi));
    on('restart', () => this.start(this.cfg));
    on('quit', () => this.toMenu());
    on('quality', () => {
      this.quality = QUALITY_ORDER[(QUALITY_ORDER.indexOf(this.quality) + 1) % QUALITY_ORDER.length];
      saveQuality(this.quality);
      this.applyQuality();
      // shadows / bubble pool follow the new quality
      const q = QUALITY[this.quality];
      this.sun = setupShadows(this.renderer, this.scene, this.scenery.root ?? this.scene, q.shadows, this.game.arena);
      this.scene.traverse((m) => { if (m.material) m.material.needsUpdate = true; });
      this.openPause(pi);
    });
    on('mute', () => { this.sound.setMuted(!this.sound.muted); this.openPause(pi); });
  }

  resume() {
    this.paused = false;
    this.closeOverlay();
    // forget buttons pressed in the menu so they don't fire a game action
    this.input.pressed.clear();
    this.devices?.forEach((d) => { if (d.startsWith('pad')) this.input.read(d); });
  }

  leave(pi) {
    const g = this.game;
    g.action(pi, 'leave');
    this.resume();
    const humansLeft = g.players.filter((p, i) => this.devices[i] !== 'cpu' && !p.left).length;
    if (!humansLeft) {
      for (const p of g.players) if (p.run.state === 'running') g.endRun(p, 'Match ended');
      g.over = true;
      return;
    }
    this.buildViews();
  }

  toMenu() {
    this.closeOverlay();
    this.paused = false;
    this.state = 'menu';
    this.sound.motor(0);
    this.menuScene();
    this.menu.show('setup');
  }

  showResults() {
    this.overShown = true;
    const o = this.overlay(`<header><img src="${logoUrl}" alt="" class="hdr-logo"><h2>Results — ${SCENARIOS[this.game.scenario].name}, ${this.game.depth} m</h2></header><div class="scroll">${resultsHTML(this.game)}<div class="pause-btns"><button class="btn primary" data-nav data-a="again">Play again</button><button class="btn" data-nav data-a="lobby">Lobby</button><button class="btn" data-nav data-a="menu">Main menu</button></div></div>`, { onBack: () => this.toMenu() });
    o.querySelector('[data-a=again]').onclick = () => this.start(this.cfg);
    o.querySelector('[data-a=lobby]').onclick = () => this.toMenu();
    o.querySelector('[data-a=menu]').onclick = () => { this.toMenu(); this.menu.show('title'); };
  }

  // ------------------------------------------------------------------ per frame
  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    this.navPoll();
    if (this.state === 'game' && this.game) this.gameFrame(dt);
    else { this.menu.poll(); this.menuFrame(dt); }
    this.input.endFrame();
  }

  menuFrame(dt) {
    const t = (this.fakeEnv.time += dt);
    this.menuBots.forEach((b) => {
      const a = t * 0.25 + b.ph;
      b.m.group.position.set(Math.cos(a) * (2.2 + b.i * 0.8), -1.4 - b.i * 0.5 + Math.sin(t * 0.7 + b.i) * 0.15, Math.sin(a) * (2.2 + b.i * 0.8) - 2);
      b.m.group.rotation.set(Math.sin(t * 0.5 + b.i) * 0.08, -a, 0);
      b.m.update(dt, { th: b.th }, { gripClosed: false, holding: false, markers: 2, torpedoes: 2 });
      // bubbles streaming from the thrusters
      if (Math.random() < dt * 30) {
        const d = BOTS[b.id].thrusters[(Math.random() * BOTS[b.id].thrusters.length) | 0];
        tmpV.set(d.pos[1], -d.pos[2], -d.pos[0]).applyQuaternion(b.m.group.quaternion).add(b.m.group.position);
        tmpV2.set(-d.axis[1], d.axis[2], d.axis[0]).applyQuaternion(b.m.group.quaternion).multiplyScalar(0.6);
        this.bubbles.emit(tmpV.x, tmpV.y, tmpV.z, tmpV2.x, tmpV2.y, tmpV2.z, 2, 0.006);
      }
    });
    this.bubbles.update(dt, t);
    this.menuCam.aspect = this.W / this.H;
    this.menuCam.updateProjectionMatrix();
    this.menuCam.position.set(Math.sin(t * 0.05) * 1.5, -1.2, 4.5);
    this.menuCam.lookAt(0, -1.6, -2);
    this.scenery.update(t, this.fakeEnv);
    this.renderer.shadowMap.needsUpdate = true;
    this.drawView(this.menuCam, { x: 0, y: 0, w: this.W, h: this.H }, t);
    this.sound.update?.(dt, { underwater: true, depth: 1.5, paused: false, vehicles: [] });
  }

  handleInput() {
    const g = this.game;
    g.players.forEach((p, i) => {
      const dev = this.devices[i];
      if (dev === 'cpu' || p.left) return;
      const r = this.input.read(dev);
      Object.assign(p.veh.input, r.axes);
      for (const a of r.actions) {
        if (a === 'camera') this.cams[i] = CAMS[(CAMS.indexOf(this.cams[i]) + 1) % CAMS.length];
        else if (a === 'pause') this.openPause(i);
        else {
          const run = p.run.state === 'running';
          if (a === 'marker' && p.run.markers > 0 && run) this.sound.drop();
          if (a === 'torpedo' && p.run.torpedoes > 0 && run) this.sound.launch();
          if (a === 'grip' && run) { if (p.run.held) this.sound.release?.(); else this.sound.grab?.(); }
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
    }
    const alpha = Math.min(1, this.acc / DT);
    this.events();
    this.syncMeshes(alpha, this.paused ? 0 : dt);
    this.effects(this.paused ? 0 : dt);
    this.audio(dt);
    this.course3d.update(g.time);
    this.scenery.update(g.env.time, g.env);
    this.hud.update(dt);
    this.renderer.shadowMap.needsUpdate = true;
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
      b.m.group.visible = !p.left;
      b.shadow.visible = !p.left;
      if (p.left) return;
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
      b.shadow.material.opacity = Math.max(0, 0.3 - hgt * 0.05);
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
        castShadows(m);
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

  // bubbles from the thrusters (rate ~ thrust), torpedo wakes, sinking markers, splashes
  effects(dt) {
    const g = this.game, B = this.bubbles;
    if (!B) return;
    if (dt > 0) g.players.forEach((p, i) => {
      if (p.left) return;
      const b = this.bots[i], v = p.veh, grp = b.m.group;
      v.th.forEach((th, k) => {
        const n = Math.abs(th.n);
        if (n < 0.12) return;
        const d = p.design.thrusters[k];
        tmpV.set(d.pos[1], -d.pos[2], -d.pos[0]).applyQuaternion(grp.quaternion).add(grp.position);
        if (tmpV.y > -0.05) return; // out of the water
        b.bub[k] += dt * n * n * (b.size === 't500' ? 70 : b.size === 'small' ? 25 : 45);
        if (b.bub[k] < 1) return;
        const cnt = b.bub[k] | 0;
        b.bub[k] -= cnt;
        // the jet leaves opposite to the push direction
        const s = -Math.sign(th.n) * (0.6 + 1.6 * n);
        tmpV2.set(d.axis[1], -d.axis[2], -d.axis[0]).applyQuaternion(grp.quaternion).multiplyScalar(s);
        B.emit(tmpV.x, tmpV.y, tmpV.z, tmpV2.x, tmpV2.y, tmpV2.z, cnt, b.size === 't500' ? 0.009 : 0.006);
      });
      // surfacing / diving: splash + bubbles
      const surf = v.depth < p.design.dims[2] * 0.45;
      if (surf !== b.wasSurf && this.viewPlayers.includes(i)) {
        this.sound.splash?.(Math.min(1, Math.abs(v.worldVel()[2]) * 2 + 0.3));
        B.emit(grp.position.x, grp.position.y - 0.1, grp.position.z, 0, 0.2, 0, 30, 0.01);
      }
      b.wasSurf = surf;
    });
    if (dt > 0) for (const it of g.items) {
      if (it.state !== 'fall' || Math.random() > dt * (it.kind === 'torpedo' ? 50 : 8)) continue;
      const q = ned(it.pos[0], it.pos[1], it.pos[2]);
      B.emit(q.x, q.y, q.z, 0, 0.05, 0, it.kind === 'torpedo' ? 2 : 1, 0.005);
    }
    const env = g.env;
    B.update(dt, env.time, (x, z) => env.surfaceElevation(-z, x));
  }

  audio(dt) {
    const g = this.game;
    const me = g.players[this.viewPlayers[0]];
    const myPos = me.veh.p, myYaw = me.veh.euler()[2];
    const vehicles = [];
    g.players.forEach((p, i) => {
      if (p.left) return;
      const b = this.bots[i], v = p.veh;
      for (let k = 0; k < v.th.length; k++) b.n[k] = v.th[k].n;
      const own = this.viewPlayers.includes(i);
      const dx = v.p[0] - myPos[0], dy = v.p[1] - myPos[1], dz = v.p[2] - myPos[2];
      const dist = own ? 0 : Math.hypot(dx, dy, dz);
      const pan = own ? 0 : Math.sin(Math.atan2(dy, dx) - myYaw);
      vehicles.push({ n: b.n, maxRpm: MAX_RPM[b.size], blades: 3, size: b.size, dist, pan });
    });
    const cam = this.views[0].cam;
    if (this.sound.update) this.sound.update(dt, { underwater: cam.position.y < g.env.surfaceElevation(-cam.position.z, cam.position.x), depth: Math.max(0, me.veh.depth), paused: this.paused || g.over, vehicles });
    else {
      let lvl = 0;
      for (const pi of this.viewPlayers) { const v = g.players[pi].veh; lvl += v.th.reduce((s, t) => s + Math.abs(t.n), 0) / v.th.length; }
      this.sound.motor(this.paused || g.over ? 0 : (lvl / this.viewPlayers.length) * 1.4);
    }
    // pingers heard on the first viewed vehicle's hydrophone
    g.course.pingers.forEach((pg, k) => {
      if (g.time < this.pingNext[k]) return;
      this.pingNext[k] = g.time + pg.period;
      if (this.paused) return;
      const b = g.pingerBearing(me, pg.id);
      this.sound.ping(pg.freq, Math.min(1, 6 / (b.dist + 2)), Math.sin(b.rel));
    });
  }

  // render one camera into a CSS-pixel rect (top-left origin), through post-processing
  drawView(cam, rect, time) {
    const r = this.renderer;
    const y = this.H - rect.y - rect.h;
    r.setViewport(rect.x, y, rect.w, rect.h);
    r.setScissor(rect.x, y, rect.w, rect.h);
    this.scenery.applyForCamera(cam, r);
    this.bubbles?.setViewportHeight?.(rect.h * r.getPixelRatio());
    if (this.post) {
      const env = this.game ? this.game.env : null;
      const surf = env ? env.surfaceElevation(-cam.position.z, cam.position.x) : 0;
      this.post.render(this.scene, cam, rect, { underwater: cam.position.y < surf, depth: Math.max(0, surf - cam.position.y), time, waterColor: this.waterColor, turbidity: this.turbidity });
    } else r.render(this.scene, cam);
  }

  renderView(view, dt) {
    const g = this.game, cam = view.cam;
    const k = 1 - Math.exp(-dt * 6);
    if (view.spectator) {
      // TV camera: follows the leader from the side
      const lead = [...g.players].filter((p) => !p.left).sort((a, b) => g.total(b) - g.total(a))[0];
      const grp = this.bots[lead.index].m.group;
      const t = g.time * 0.08;
      const want = tmpV.set(grp.position.x + Math.sin(t) * 4, Math.min(grp.position.y + 1.6, -0.3), grp.position.z + Math.cos(t) * 4);
      if (!view.smooth) view.smooth = want.clone();
      view.smooth.lerp(want, k * 0.5);
      cam.position.copy(view.smooth);
      cam.lookAt(grp.position);
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
        tmpV3.set(grp.position.x + Math.sin(yaw) * 1.2, grp.position.y - 0.1, grp.position.z - Math.cos(yaw) * 1.2);
        cam.up.set(0, 1, 0);
        cam.lookAt(tmpV3);
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
    // hide your own vehicle in the onboard views
    const own = view.pi >= 0 && this.cams[view.pi] !== 'chase' ? this.bots[view.pi].m.group : null;
    if (own) own.visible = false;
    this.drawView(cam, view.rect, g.env.time);
    if (own) own.visible = !g.players[view.pi].left;
  }
}

function boot() {
  const root = document.getElementById('app');
  try {
    new App(root);
  } catch (e) {
    root.innerHTML = `<div class="boot">${GAME_NAME} could not start: ${String(e.message || e)}. It needs a browser with WebGL2 (Chrome, Edge, Firefox, Safari).</div>`;
    throw e;
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
