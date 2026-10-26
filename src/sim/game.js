// One competition run for 1-4 vehicles in the same water: the clock, the
// vehicles, the things they drop / fire / carry, and the judging of every
// task by the RoboSub 2025 handbook rules (sections 3.2 and 4.2).
//
// The handbook says the official point breakdown is "to be released"; the
// values in POINTS are this game's, chosen to keep the handbook's ordering
// (roll / pitch style worth more than yaw, the chosen animal worth more, the
// correct basket worth more, ...).

import { Environment } from '../physics/environment.js';
import { RNG } from '../core/rng.js';
import { wrapPI } from '../core/math.js';
import { environmentConfig } from './scenarios.js';
import { BOTS } from './bots.js';
import { Vehicle, DT } from './vehicle.js';
import { buildCourse, boardLocal, ARENA } from './course.js';
import { collideVehicle } from './collide.js';

export const POINTS = {
  coinFlip: 300,
  gatePass: 200, gateClean: 200, gateAnimal: 200, styleRollPitch: 200, styleYaw: 100, styleMax: 1600,
  slalomSet: 300, slalomSide: 150, slalomInside: 150,
  binAny: 400, binCorrect: 200,
  torpedoTouch: 200, torpedoThrough: 600, torpedoAnimal: 300, torpedoFar: 200, torpedoOrder: 400,
  octSurface: 1000, octWithItem: 400, octFaceAny: 300, octFaceChosen: 600, basketAny: 400, basketCorrect: 300, octRotation: 250,
  home: 500,
  timePerMinute: 100,
};

export const TASK_KEYS = ['coin', 'gate', 'style', 'slalom', 'bin', 'torpedo', 'octagon', 'home', 'time'];
export const TASK_LABEL = { coin: 'Coin flip', gate: 'Gate', style: 'Gate style', slalom: 'Slalom', bin: 'Bin (BRUVS)', torpedo: 'Torpedoes', octagon: 'Octagon', home: 'Return home', time: 'Time bonus' };

const HALF_PI = Math.PI / 2;
const hdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// payload physics (in-water net weight, added mass and quadratic drag)
const ITEM_PHYS = {
  marker: { mass: 0.4, vol: 0.00025, cq: 3.2, cl: 0.4, r: 0.03 },
  torpedo: { mass: 0.255, vol: 0.00025, cq: 0.09, cl: 0.05, r: 0.025 },
  cup: { mass: 0.12, vol: 0.00009, cq: 1.4, cl: 0.3, r: 0.045 },
  spoon: { mass: 0.1, vol: 0.00007, cq: 1.0, cl: 0.25, r: 0.03 },
};

export class Game {
  constructor({ scenario = 'pool', players = [{ name: 'Player 1', bot: 'duburi' }], runMinutes = 15, coinFlip = true, seed = (Math.random() * 1e9) | 0 } = {}) {
    this.scenario = scenario;
    this.seed = seed;
    this.rand = mulberry(seed);
    this.env = new Environment(environmentConfig(scenario), new RNG(seed + 7));
    this.course = buildCourse(this.rand);
    this.duration = runMinutes * 60;
    this.coinFlip = coinFlip;
    this.time = 0;
    this.over = false;
    this.events = [];
    this.items = [];
    for (const t of this.course.octagon.trash) this.items.push(this.makeItem(t.kind, null, t.pos, [0, 0, 0], 'rest', { home: t.pos.slice(), on: 'table' }));
    this.players = players.map((pc, i) => this.makePlayer(pc, i));
    for (const p of this.players) this.startRun(p, true);
  }

  makePlayer(pc, i) {
    const design = BOTS[pc.bot] ?? BOTS.duburi;
    const veh = new Vehicle(design, this.env);
    return { index: i, name: pc.name || `Player ${i + 1}`, color: pc.color || design.color, bot: design.id, design, veh, run: null, runs: [], best: 0 };
  }

  makeItem(kind, owner, pos, vel, state, extra = {}) {
    const ph = ITEM_PHYS[kind];
    const meff = ph.mass + 0.5 * this.env.rho * ph.vol;
    return { id: Math.random().toString(36).slice(2), kind, owner, pos: pos.slice(), vel: vel.slice(), state, ph, meff, t: 0, ...extra };
  }

  emit(player, text, pts = 0, kind = 'info') { this.events.push({ player: player ? player.index : -1, text, pts, kind, t: this.time }); }

  // ------------------------------------------------------------ runs
  startRun(p, first = false) {
    const c = this.course, dock = c.dock;
    const n = this.players.length || 1;
    const lane = (p.index - (n - 1) / 2) * 1.5;
    // coin flip (3.2.1): heads = parallel to the gate, tails = tail toward the gate
    let heading = c.gate.heading, coin = null;
    if (this.coinFlip) {
      coin = this.rand() < 0.5 ? 'heads' : 'tails';
      heading = coin === 'heads' ? c.gate.heading + (this.rand() < 0.5 ? HALF_PI : -HALF_PI) : c.gate.heading + Math.PI;
    }
    p.veh.reset([dock.pos[0], dock.pos[1] + lane, 0.02], wrapPI(heading));
    p.veh.depthTarget = 0;
    // forfeit: this player's dropped markers / torpedoes are cleared
    this.items = this.items.filter((it) => it.owner !== p || it.kind === 'cup' || it.kind === 'spoon');
    for (const it of this.items) if (it.holder === p) { it.holder = null; it.state = 'fall'; }
    if (p.run && !first) this.emit(p, 'New run — previous points forfeited', 0, 'warn');
    p.run = {
      state: 'running', reason: '', startTime: this.time, coin,
      markers: 2, torpedoes: 2, held: null,
      scores: Object.fromEntries(TASK_KEYS.map((k) => [k, 0])),
      leftStart: false, gatePassed: false, chosen: null, gateSide: 0,
      gateS: null, homeS: null, inGateBuf: false, styleAcc: [0, 0, 0], gateTouched: false, gateTouchedThis: false, gateAttempt: null,
      slalomS: [null, null, null], slalomBest: [0, 0, 0],
      binBest: {}, torpedoHits: [], octSurface: 0, octItems: new Set(), faceTimer: 0, faceBest: 0, rotAcc: 0, rotBest: 0, basketPts: {},
      totalTime: null, finished: false, timeBonusMet: null,
    };
    if (coin) this.emit(p, `Coin flip: ${coin.toUpperCase()} — ${coin === 'heads' ? 'start parallel to the gate' : 'start facing away from the gate'}`, 0, 'info');
  }

  endRun(p, reason = 'Run ended by team lead') {
    const r = p.run;
    if (!r || r.state !== 'running') return;
    r.state = 'ended';
    r.reason = reason;
    // time bonus (4.2): requires gate + (marker in bin or torpedo through) + surfaced in the octagon
    const met = r.gatePassed && (r.scores.bin > 0 || r.torpedoHits.some((h) => h.through)) && r.octSurface > 0;
    const remaining = Math.max(0, this.duration - this.time);
    if (met && remaining > 0) {
      r.scores.time = Math.round((remaining / 60) * POINTS.timePerMinute);
      this.emit(p, `Time bonus ${Math.floor(remaining / 60)}:${String(Math.floor(remaining % 60)).padStart(2, '0')} left`, r.scores.time, 'score');
    }
    r.total = this.total(p);
    p.runs.push({ total: r.total, scores: { ...r.scores }, reason });
    p.best = Math.max(p.best, r.total);
    if (r.held) { r.held.holder = null; r.held.state = 'fall'; r.held = null; }
    this.emit(p, reason, 0, reason.startsWith('Breach') ? 'bad' : 'info');
  }

  total(p) { return TASK_KEYS.reduce((s, k) => s + (p.run.scores[k] || 0), 0); }

  // ------------------------------------------------------------ actions
  action(i, what) {
    const p = this.players[i];
    if (!p || this.over) return;
    const r = p.run, v = p.veh;
    if (what === 'restart') { this.startRun(p); return; }
    if (!r || r.state !== 'running') return;
    if (what === 'depthHold') { v.depthHold = !v.depthHold; v.depthTarget = v.p[2]; this.emit(p, v.depthHold ? 'Depth hold ON' : 'Depth hold OFF (manual)', 0, 'info'); return; }
    if (what === 'endRun') { this.endRun(p, 'Run ended by team lead'); return; }
    if (what === 'marker') {
      if (r.markers <= 0) { this.emit(p, 'No markers left', 0, 'warn'); return; }
      r.markers--;
      const pos = v.toWorld(p.design.marker);
      this.items.push(this.makeItem('marker', p, pos, v.worldVel(), 'fall'));
      this.emit(p, `Marker dropped (${r.markers} left)`, 0, 'info');
      return;
    }
    if (what === 'torpedo') {
      if (r.torpedoes <= 0) { this.emit(p, 'No torpedoes left', 0, 'warn'); return; }
      r.torpedoes--;
      const pos = v.toWorld(p.design.torpedo);
      const dir = v.bodyToWorldDir([1, 0, 0]);
      const vw = v.worldVel();
      const speed = 2.6; // m/s: a "safe" speed (5.4.2)
      const it = this.makeItem('torpedo', p, pos, [vw[0] + dir[0] * speed, vw[1] + dir[1] * speed, vw[2] + dir[2] * speed], 'fall');
      const bl = boardLocal(this.course.board, pos);
      it.fireDist = Math.abs(bl.n);
      it.prevN = bl.n;
      it.dir = dir;
      this.items.push(it);
      this.emit(p, `Torpedo away (${r.torpedoes} left)`, 0, 'info');
      return;
    }
    if (what === 'grip') {
      if (r.held) {
        const it = r.held;
        it.holder = null; it.state = 'fall'; it.vel = v.worldVel(); it.releasedBy = p;
        r.held = null;
        this.emit(p, `Released the ${it.kind}`, 0, 'info');
        return;
      }
      const g = v.toWorld(p.design.gripper);
      let best = null, bd = 0.32;
      for (const it of this.items) {
        if ((it.kind !== 'cup' && it.kind !== 'spoon') || it.holder) continue;
        const d = Math.hypot(it.pos[0] - g[0], it.pos[1] - g[1], it.pos[2] - g[2]);
        if (d < bd) { bd = d; best = it; }
      }
      if (!best) { this.emit(p, 'Gripper closed — nothing in reach', 0, 'warn'); return; }
      best.holder = p; best.state = 'held'; best.inBasket = null;
      r.held = best;
      this.emit(p, `Grabbed the ${best.kind}`, 0, 'info');
    }
  }

  // ------------------------------------------------------------ simulation
  step(dt = DT) {
    if (this.over) return;
    this.env.step(dt);
    this.time += dt;
    const vehs = this.players.map((p) => p.veh);
    for (const p of this.players) {
      const running = p.run.state === 'running';
      p.veh.step(dt, running);
      p.touched = collideVehicle(p.veh, this.course, ARENA, vehs.filter((v) => v !== p.veh));
      if (running) this.judge(p, dt);
    }
    this.stepItems(dt);
    if (this.time >= this.duration) {
      for (const p of this.players) this.endRun(p, 'Time is up');
      this.over = true;
    } else if (this.players.every((p) => p.run.state !== 'running')) this.over = true;
  }

  stepItems(dt) {
    const env = this.env, c = this.course, g = env.g;
    for (const it of this.items) {
      if (it.state === 'held') {
        const p = it.holder, v = p.veh;
        it.pos = v.toWorld(p.design.gripper);
        it.vel = v.worldVel();
        continue;
      }
      if (it.state !== 'fall') continue;
      it.t += dt;
      const ph = it.ph;
      const fl = env.fluidVelocity(it.pos[0], it.pos[1], Math.max(0, it.pos[2]));
      const vr = [it.vel[0] - fl[0], it.vel[1] - fl[1], it.vel[2] - fl[2]];
      const sp = Math.hypot(vr[0], vr[1], vr[2]);
      const sub = it.pos[2] > 0 ? 1 : 0;
      const net = (ph.mass * g - env.rho * g * ph.vol * sub) / it.meff;
      const k = (ph.cl + ph.cq * sp) / it.meff;
      for (let i = 0; i < 3; i++) it.vel[i] = (it.vel[i] + dt * (i === 2 ? net : 0) + dt * k * fl[i]) / (1 + dt * k);
      const prev = it.pos.slice();
      for (let i = 0; i < 3; i++) it.pos[i] += it.vel[i] * dt;
      if (it.pos[2] < -0.05) { it.pos[2] = -0.05; it.vel[2] = Math.max(0, it.vel[2]); }
      if (it.kind === 'torpedo') this.torpedoBoard(it, prev);
      if (it.state !== 'fall') continue;
      this.landItem(it, prev, c);
      // arena walls
      const hx = ARENA.length / 2 - 0.05, hy = ARENA.width / 2 - 0.05;
      if (Math.abs(it.pos[0]) > hx) { it.pos[0] = Math.sign(it.pos[0]) * hx; it.vel[0] *= -0.3; }
      if (Math.abs(it.pos[1]) > hy) { it.pos[1] = Math.sign(it.pos[1]) * hy; it.vel[1] *= -0.3; }
    }
  }

  landItem(it, prev, c) {
    const floor = c.floor, r = it.ph.r;
    const bin = c.bin, oct = c.octagon;
    // bin: lands inside on its bottom, otherwise on the rim / outside
    const bl = this.binLocal(it.pos);
    if (Math.abs(bl[0]) < bin.size[0] / 2 && Math.abs(bl[1]) < bin.size[1] / 2) {
      if (it.pos[2] >= floor - 0.02 - r) { this.rest(it, floor - 0.02 - r, 'bin'); return; }
    }
    // baskets at the table edges
    for (const b of oct.baskets) {
      if (Math.abs(it.pos[0] - b.c[0]) < b.h[0] && Math.abs(it.pos[1] - b.c[1]) < b.h[1] && it.pos[2] >= b.depthTop + 0.08 - r && prev[2] < b.depthTop + 0.08) { this.rest(it, b.depthTop + 0.08 - r, 'basket', b); return; }
    }
    // table top
    if (Math.abs(it.pos[0] - oct.pos[0]) < oct.tableHalf && Math.abs(it.pos[1] - oct.pos[1]) < oct.tableHalf && it.pos[2] >= oct.tableTop - r && prev[2] <= oct.tableTop - r + 0.02) { this.rest(it, oct.tableTop - r, 'table'); return; }
    if (it.pos[2] >= floor - r) this.rest(it, floor - r, 'floor');
  }

  binLocal(p) {
    const b = this.course.bin;
    const dx = p[0] - b.pos[0], dy = p[1] - b.pos[1];
    return [dot2([dx, dy], b.dir), dot2([dx, dy], b.right)];
  }

  rest(it, z, on, basket = null) {
    it.pos[2] = z;
    it.vel = [0, 0, 0];
    it.state = 'rest';
    it.on = on;
    const owner = it.owner || it.releasedBy;
    if (!owner || owner.run.state !== 'running') return;
    const r = owner.run;
    if (it.kind === 'marker' && on === 'bin') {
      if (!r.gatePassed) { this.emit(owner, 'Marker in the bin — but the gate comes first (no points)', 0, 'warn'); return; }
      const half = this.binLocal(it.pos)[0] < 0 ? this.course.bin.halves[0] : this.course.bin.halves[1];
      const pts = POINTS.binAny + (half === r.chosen ? POINTS.binCorrect : 0);
      r.binBest[it.id] = pts;
      const vals = Object.values(r.binBest).sort((a, b) => b - a).slice(0, 2);
      const before = r.scores.bin;
      r.scores.bin = vals.reduce((s, v) => s + v, 0);
      this.emit(owner, `Marker in the bin (${half === 'shark' ? 'reef shark' : 'sawfish'} half${half === r.chosen ? ', correct!' : ''})`, r.scores.bin - before, 'score');
    } else if (it.kind === 'marker') this.emit(owner, 'Marker missed the bin', 0, 'warn');
    if ((it.kind === 'cup' || it.kind === 'spoon') && on === 'basket') {
      it.inBasket = basket.item;
      if (!r.gatePassed) return;
      const pts = POINTS.basketAny + (basket.item === it.kind ? POINTS.basketCorrect : 0);
      const before = r.scores.octagon;
      r.basketPts[it.kind] = Math.max(r.basketPts[it.kind] || 0, pts);
      r.rotAcc = 0;
      this.octagonScore(owner);
      this.emit(owner, `${it.kind === 'cup' ? 'Cup' : 'Spoon'} in the ${basket.item} basket${basket.item === it.kind ? ' — correct!' : ''}`, r.scores.octagon - before, 'score');
    }
  }

  torpedoBoard(it, prev) {
    const b = this.course.board;
    const bl = boardLocal(b, it.pos);
    const pn = it.prevN;
    it.prevN = bl.n;
    if (!(pn > 0 && bl.n <= 0)) return;
    // where it crossed the board plane
    const f = pn / (pn - bl.n);
    const cp = [prev[0] + (it.pos[0] - prev[0]) * f, prev[1] + (it.pos[1] - prev[1]) * f, prev[2] + (it.pos[2] - prev[2]) * f];
    const L = boardLocal(b, cp);
    const half = b.size / 2;
    if (Math.abs(L.u) > half + it.ph.r || Math.abs(L.v) > half + it.ph.r) return; // missed the board
    const p = it.owner, r = p.run;
    let through = null;
    for (const o of b.openings) {
      const dd = o.shape === 'square' ? Math.max(Math.abs(L.u - o.u), Math.abs(L.v - o.v)) : Math.hypot(L.u - o.u, L.v - o.v);
      if (dd <= o.r - it.ph.r * 0.5) through = o;
    }
    if (!through) {
      // hit the backing: stops and sinks in front of the board
      it.vel = [b.dir[0] * 0.15, b.dir[1] * 0.15, 0.05];
      it.pos = [cp[0] + b.dir[0] * 0.03, cp[1] + b.dir[1] * 0.03, cp[2]];
      it.prevN = 0.03;
    }
    if (r.state !== 'running') return;
    if (!r.gatePassed) { this.emit(p, 'Torpedo hit — but the gate comes first (no points)', 0, 'warn'); return; }
    const far = it.fireDist >= b.farDistance;
    const hit = { through: !!through, animal: through ? through.animal : null, far, t: this.time };
    r.torpedoHits.push(hit);
    const before = r.scores.torpedo;
    // best two torpedoes + order bonus
    const vals = r.torpedoHits.map((h) => (h.through ? POINTS.torpedoThrough + (h.animal === r.chosen ? POINTS.torpedoAnimal : 0) : POINTS.torpedoTouch) + (h.far ? POINTS.torpedoFar : 0));
    let s = vals.sort((a, b2) => b2 - a).slice(0, 2).reduce((a, v) => a + v, 0);
    const th = r.torpedoHits.filter((h) => h.through);
    if (th.length >= 2 && th[0].animal === r.chosen && th[1].animal !== r.chosen) s += POINTS.torpedoOrder;
    r.scores.torpedo = Math.max(r.scores.torpedo, s);
    const what = through ? `through the ${through.label} opening (${through.animal === 'shark' ? 'reef shark' : 'sawfish'})` : 'hit the board';
    this.emit(p, `Torpedo ${what}${far ? ' from far' : ''}`, r.scores.torpedo - before, 'score');
  }

  // ------------------------------------------------------------ judging
  judge(p, dt) {
    const r = p.run, v = p.veh, c = this.course, d = p.design;
    const pos = v.p, depth = v.depth;
    const H = d.dims[2];
    const surfaced = depth < H * 0.45;
    const gate = c.gate;

    // start zone: submerge before leaving it (3.2.1)
    if (!r.leftStart && hdist(pos, c.dock.pos) > c.dock.radius + 1.5) r.leftStart = true;

    // ---------- gate & return home ----------
    const rel = [pos[0] - gate.pos[0], pos[1] - gate.pos[1]];
    const s = dot2(rel, gate.dir), lat = dot2(rel, gate.right);
    const inBuf = Math.hypot(s, lat, depth - 1.2) < 3.0;
    if (inBuf && !r.inGateBuf) { r.styleAcc = [0, 0, 0]; r.gateTouchedThis = false; }
    r.inGateBuf = inBuf;
    if (inBuf) for (let i = 0; i < 3; i++) r.styleAcc[i] += v.w[i] * dt;
    if (p.touched && (p.touched.has('gateLeg') || p.touched.has('gateBar'))) r.gateTouchedThis = true;
    const between = Math.abs(lat) < gate.width / 2 && depth > gate.topDepth;
    if (r.gateS !== null && r.gateS < 0 && s >= 0 && between && !r.gatePassed) {
      r.gatePassed = true;
      r.gateSide = lat < 0 ? -1 : 1;
      r.chosen = r.gateSide === gate.sharkSide ? 'shark' : 'sawfish';
      r.gateAttempt = { time: this.time };
      const clean = !r.gateTouchedThis;
      const pts = POINTS.gatePass + (clean ? POINTS.gateClean : 0) + POINTS.gateAnimal;
      r.scores.gate = pts;
      this.emit(p, `Through the gate on the ${r.chosen === 'shark' ? 'REEF SHARK' : 'SAWFISH'} side${clean ? ', clean' : ' (touched a leg)'}`, pts, 'score');
      if (r.coin) { r.scores.coin = POINTS.coinFlip; this.emit(p, `Coin flip start (${r.coin})`, POINTS.coinFlip, 'score'); }
    }
    if (r.gatePassed && r.inGateBuf && this.time - r.gateAttempt.time < 12) {
      const n = r.styleAcc.map((a) => Math.floor(Math.abs(a) / HALF_PI));
      const sp = Math.min(POINTS.styleMax, (n[0] + n[1]) * POINTS.styleRollPitch + n[2] * POINTS.styleYaw);
      if (sp > r.scores.style) { this.emit(p, `Style: ${n[0]}× roll, ${n[1]}× pitch, ${n[2]}× yaw quarter-turns`, sp - r.scores.style, 'score'); r.scores.style = sp; }
    }
    // return home: back through the gate, underwater, after doing something else
    if (r.gatePassed && r.gateS !== null && r.gateS > 0 && s <= 0 && between && this.time - r.gateAttempt.time > 15 && r.scores.home === 0) {
      r.scores.home = POINTS.home;
      this.emit(p, 'Returned home through the gate', POINTS.home, 'score');
      r.finished = true;
      this.endRun(p, 'Run complete — returned home');
    }
    r.gateS = s;
    if (r.state !== 'running') return;

    // ---------- slalom ----------
    const sl = c.slalom;
    sl.sets.forEach((set, k) => {
      const rr = [pos[0] - set.pos[0], pos[1] - set.pos[1]];
      const a = dot2(rr, sl.dir), l = dot2(rr, sl.right);
      const prev = r.slalomS[k];
      r.slalomS[k] = a;
      if (prev === null || Math.sign(prev) === Math.sign(a) || Math.abs(l) > 1.524) return;
      if (!r.gatePassed) { this.emit(p, 'Slalom set passed — but the gate comes first', 0, 'warn'); return; }
      const travel = a > prev ? 1 : -1;
      const side = Math.sign(l) * travel;
      const inside = depth - H / 2 < sl.band[1] && depth + H / 2 > sl.band[0];
      const pts = POINTS.slalomSet + (side === r.gateSide ? POINTS.slalomSide : 0) + (inside ? POINTS.slalomInside : 0);
      if (pts > r.slalomBest[k]) {
        const before = r.scores.slalom;
        r.slalomBest[k] = pts;
        r.scores.slalom = r.slalomBest.reduce((x, y) => x + y, 0);
        this.emit(p, `Slalom set ${k + 1}${side === r.gateSide ? ', same side' : ''}${inside ? ', between the pipes' : ' (above / below)'}`, r.scores.slalom - before, 'score');
      }
    });

    // ---------- octagon / surfacing ----------
    const oct = c.octagon;
    const dO = hdist(pos, oct.pos);
    const halfW = Math.max(d.dims[0], d.dims[1]) / 2;
    const frac = Math.max(0, Math.min(1, (oct.radius - dO + halfW) / (2 * halfW)));
    if (dO < oct.radius && r.octItems.size + Object.keys(r.basketPts).length > 0) {
      r.rotAcc += v.w[2] * dt;
    } else if (dO >= oct.radius) r.rotAcc = 0;
    if (surfaced) {
      if (frac > 0.02) {
        if (r.gatePassed) {
          const sp = Math.round(POINTS.octSurface * frac);
          if (sp > r.octSurface) { const before = r.scores.octagon; r.octSurface = sp; this.octagonScore(p); this.emit(p, `Surfaced in the octagon${frac < 1 ? ` (${Math.round(frac * 100)}% inside)` : ''}`, r.scores.octagon - before, 'score'); }
          if (r.held && !r.octItems.has(r.held.kind)) { const before = r.scores.octagon; r.octItems.add(r.held.kind); this.octagonScore(p); this.emit(p, `Surfaced with the ${r.held.kind}`, r.scores.octagon - before, 'score'); }
          // facing an image hanging inside the octagon
          const hd = v.euler()[2];
          let facing = null;
          for (const im of oct.images) if (Math.abs(wrapPI(hd - im.angle)) < 0.35) facing = im;
          if (facing) {
            r.faceTimer += dt;
            const fp = facing.animal === r.chosen ? POINTS.octFaceChosen : POINTS.octFaceAny;
            if (r.faceTimer > 1.0 && fp > r.faceBest) { const before = r.scores.octagon; r.faceBest = fp; this.octagonScore(p); this.emit(p, `Facing the ${facing.animal === 'shark' ? 'reef shark' : 'sawfish'} image`, r.scores.octagon - before, 'score'); }
          } else r.faceTimer = 0;
        }
      } else if (r.leftStart || hdist(pos, c.dock.pos) > c.dock.radius) {
        this.endRun(p, r.leftStart ? 'Breached outside the octagon — run over' : 'Breach: left the start zone on the surface — run over');
        return;
      }
    } else r.faceTimer = 0;
    // rotations = number of trash items in baskets (3.2.6)
    const nb = Object.keys(r.basketPts).length;
    if (nb > 0) {
      const turns = Math.floor(Math.abs(r.rotAcc) / (2 * Math.PI));
      const rp = Math.min(turns, nb) >= nb ? POINTS.octRotation * nb : 0;
      if (rp > r.rotBest) { const before = r.scores.octagon; r.rotBest = rp; this.octagonScore(p); this.emit(p, `${nb} rotation${nb > 1 ? 's' : ''} for ${nb} item${nb > 1 ? 's' : ''} in the baskets`, r.scores.octagon - before, 'score'); }
    }
  }

  octagonScore(p) {
    const r = p.run;
    r.scores.octagon = r.octSurface + r.octItems.size * POINTS.octWithItem + r.faceBest + Object.values(r.basketPts).reduce((a, b) => a + b, 0) + r.rotBest;
  }

  // hydrophone: bearing (rad, relative to the vehicle heading) and distance to a pinger
  pingerBearing(p, id) {
    const pg = this.course.pingers.find((x) => x.id === id);
    const v = p.veh;
    const dx = pg.pos[0] - v.p[0], dy = pg.pos[1] - v.p[1];
    return { rel: wrapPI(Math.atan2(dy, dx) - v.euler()[2]), dist: Math.hypot(dx, dy, pg.pos[2] - v.p[2]), pinger: pg };
  }

  remaining() { return Math.max(0, this.duration - this.time); }
}
