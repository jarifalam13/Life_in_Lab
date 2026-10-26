// A simple AUV mission: the same task sequence a team would script, flown
// through the same pilot inputs a player uses. Drives the CPU opponents and
// the end-to-end tests.

import { wrapPI } from '../core/math.js';
import { boardLocal } from './course.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const add2 = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s];

export class Autopilot {
  constructor(game, playerIndex, { skill = 1 } = {}) {
    this.g = game;
    this.i = playerIndex;
    this.skill = skill;
    this.plan = this.buildPlan();
    this.k = 0;
    this.t = 0;
    this.stepT = 0;
  }

  get p() { return this.g.players[this.i]; }

  buildPlan() {
    const c = this.g.course, gate = c.gate, sl = c.slalom, bin = c.bin, b = c.board, oct = c.octagon;
    const side = () => (this.p.run.chosen ? (this.p.run.gateSide || 1) : (this.side ?? 1));
    this.side = gate.sharkSide; // go for the reef shark
    const plan = [];
    const go = (fn, opt = {}) => plan.push({ type: 'go', fn, ...opt });
    const act = (what, wait = 0.5) => plan.push({ type: 'act', what, wait });
    const wait = (s) => plan.push({ type: 'wait', s });
    const mid = 1.3;
    plan.push({ type: 'dive', z: mid });
    go(() => [...add2(add2(gate.pos, gate.dir, -2.5), gate.right, 0.8 * this.side), mid], { tol: 0.5 });
    go(() => [...add2(add2(gate.pos, gate.dir, -0.6), gate.right, 0.8 * this.side), mid], { tol: 0.35, hdg: gate.heading });
    plan.push({ type: 'roll', turns: 1, fn: () => [...add2(add2(gate.pos, gate.dir, -0.2), gate.right, 0.8 * this.side), mid] });
    go(() => [...add2(add2(gate.pos, gate.dir, 2.2), gate.right, 0.8 * this.side), mid], { tol: 0.5, hdg: gate.heading });
    plan.push({ type: 'checkGate', back: 1 });
    const band = (sl.band[0] + sl.band[1]) / 2;
    for (const set of sl.sets) {
      go(() => [...add2(add2(set.pos, sl.dir, -1.0), sl.right, 0.76 * side()), band], { tol: 0.4, hdg: sl.heading });
      go(() => [...add2(add2(set.pos, sl.dir, 0.9), sl.right, 0.76 * side()), band], { tol: 0.45, hdg: sl.heading });
    }
    const halfOff = () => {
      const chosen = this.p.run.chosen || 'shark';
      return bin.halves[0] === chosen ? -0.23 : 0.23;
    };
    const markerFix = () => this.p.design.marker[0];
    go(() => [...add2(bin.pos, bin.dir, halfOff() - markerFix()), c.floor - 1.0], { tol: 0.1, hdg: bin.heading, settle: 1.6, precise: true });
    act('marker', 2.5);
    go(() => [...add2(bin.pos, bin.dir, halfOff() * 0.6 - markerFix()), c.floor - 1.0], { tol: 0.1, hdg: bin.heading, settle: 1.2, precise: true });
    act('marker', 2.5);
    // torpedoes from the far line, chosen animal first, then the other
    const aim = (first) => {
      const chosen = this.p.run.chosen || 'shark';
      const o = b.openings.find((x) => (first ? x.animal === chosen : x.animal !== chosen));
      const m = this.p.design.torpedo;
      // board (u, v) -> world: u along -right, v up; torpedo leaves from the mount offset
      const along = b.farDistance + 0.35;
      const xy = add2(add2(b.pos, b.dir, along), b.right, -o.u);
      // the mount is m[1] to the right of the CG (body), facing the board: body right = board right... shift back
      const xy2 = add2(xy, b.right, m[1]);
      return [...xy2, b.depth - o.v - m[2] - 0.04 * along];
    };
    go(() => aim(true), { tol: 0.07, hdg: b.heading + Math.PI, settle: 2.0, precise: true });
    act('torpedo', 2.0);
    go(() => aim(false), { tol: 0.07, hdg: b.heading + Math.PI, settle: 2.0, precise: true });
    act('torpedo', 2.0);
    // octagon: pick the cup, put it in the cup basket, one rotation, surface, face the chosen image
    const cupPos = () => this.g.items.find((it) => it.kind === 'cup').pos;
    const grip = () => this.p.design.gripper;
    go(() => [...add2(oct.pos, [1, 0], -2.2), 2.5], { tol: 0.5 });
    go(() => { const q = cupPos(); return [q[0] - grip()[0], q[1], q[2] - grip()[2] - 0.12]; }, { tol: 0.08, hdg: 0, settle: 1.5, precise: true });
    go(() => { const q = cupPos(); return [q[0] - grip()[0], q[1], q[2] - grip()[2]]; }, { tol: 0.06, hdg: 0, settle: 1.0, precise: true });
    act('grip', 0.6);
    go(() => { const q = cupPos(); return [q[0] - grip()[0], q[1], oct.tableTop - 0.6]; }, { tol: 0.15, hdg: 0 });
    go(() => { const bk = oct.baskets.find((x) => x.item === 'cup'); return [bk.c[0] - grip()[0], bk.c[1], bk.depthTop - 0.25 - grip()[2]]; }, { tol: 0.06, hdg: 0, settle: 1.2, precise: true });
    act('grip', 2.5);
    go(() => [oct.pos[0], oct.pos[1], 2.0], { tol: 0.3 });
    plan.push({ type: 'spin', turns: 1.15 });
    plan.push({ type: 'surface' });
    plan.push({ type: 'face', fn: () => oct.images.find((im) => im.animal === (this.p.run.chosen || 'shark')).angle });
    plan.push({ type: 'dive', z: mid });
    go(() => [...add2(gate.pos, gate.dir, 2.5), mid], { tol: 0.5 });
    go(() => [...add2(gate.pos, gate.dir, -2.5), mid], { tol: 0.5, hdg: gate.heading + Math.PI });
    plan.push({ type: 'done' });
    return plan;
  }

  // fly toward a point (NED) with an optional final heading; returns the distance
  steer(target, hdg, dt, precise) {
    const v = this.p.veh;
    const dx = target[0] - v.p[0], dy = target[1] - v.p[1];
    const d = Math.hypot(dx, dy);
    const yaw = v.euler()[2];
    let want = hdg;
    if (want === undefined || (!precise && d > 1.2)) want = d > 0.3 ? Math.atan2(dy, dx) : yaw;
    const eh = wrapPI(want - yaw);
    v.input.yaw = clamp(eh * 1.8 - v.w[2] * 0.6, -1, 1);
    // position error in the heading frame (holonomic vehicles also use sway)
    const ch = Math.cos(yaw), sh = Math.sin(yaw);
    const ex = dx * ch + dy * sh, ey = -dx * sh + dy * ch;
    const vw = v.worldVel();
    const vx = vw[0] * ch + vw[1] * sh, vy = -vw[0] * sh + vw[1] * ch;
    const kp = precise ? 1.2 : 0.9, kd = precise ? 2.2 : 0.8;
    const turnSlow = Math.max(0.15, Math.cos(Math.min(Math.abs(eh), Math.PI / 2)));
    v.input.surge = clamp(kp * ex - kd * vx, -1, 1) * (precise ? 1 : turnSlow);
    v.input.sway = v.wmax[1] > 1 ? clamp(kp * ey - kd * vy, -1, 1) : 0;
    v.depthTarget = target[2];
    v.input.heave = 0;
    return { d: Math.hypot(d, (target[2] - v.p[2]) * 0.6), speed: Math.hypot(vw[0], vw[1], vw[2]), eh };
  }

  update(dt) {
    const p = this.p;
    if (!p || p.run.state !== 'running') return;
    const v = p.veh;
    v.input.roll = 0; v.input.pitch = 0;
    const s = this.plan[this.k];
    if (!s) return;
    this.t += dt;
    const next = () => { this.k++; this.t = 0; this.stepT = 0; };
    if (this.t > 70) { next(); return; } // give up on a step that does not converge
    switch (s.type) {
      case 'dive':
        v.depthHold = true; v.depthTarget = s.z; v.input.surge = 0; v.input.sway = 0; v.input.yaw = 0;
        if (Math.abs(v.p[2] - s.z) < 0.25) next();
        break;
      case 'go': {
        const tgt = s.fn();
        const r = this.steer(tgt, s.hdg, dt, s.precise);
        const ok = r.d < s.tol && (s.hdg === undefined || Math.abs(r.eh) < 0.12);
        if (ok && (!s.settle || r.speed < 0.06)) { this.stepT += dt; if (this.stepT >= (s.settle ? 0.6 : 0)) next(); }
        else this.stepT = 0;
        break;
      }
      case 'act':
        v.input.surge = 0; v.input.sway = 0; v.input.yaw = 0;
        if (this.stepT === 0) { this.g.action(this.i, s.what); this.stepT = 1e-6; }
        if (this.t > s.wait) next();
        break;
      case 'checkGate':
        if (p.run.gatePassed) next();
        else { this.noRoll = true; this.k = s.back; this.t = 0; this.stepT = 0; }
        break;
      case 'roll':
        if (this.noRoll) { next(); break; }
        this.steer(s.fn(), this.g.course.gate.heading, dt, true);
        v.input.surge = Math.max(v.input.surge, 0.2);
        this.rollAcc = (this.rollAcc || 0) + Math.abs(v.w[0]) * dt;
        if (this.p.veh.th.length && v.wmax[3] > 1) v.input.roll = 1;
        else if (v.wmax[4] > 1) v.input.pitch = 1;
        this.rollAcc += Math.abs(v.w[1]) * dt;
        if (this.rollAcc > s.turns * 2 * Math.PI - 0.6 || this.t > 6) { v.input.roll = 0; v.input.pitch = 0; this.rollAcc = 0; next(); }
        break;
      case 'spin':
        v.input.surge = 0; v.input.sway = 0; v.input.yaw = 1;
        this.spinAcc = (this.spinAcc || 0) + v.w[2] * dt;
        if (Math.abs(this.spinAcc) > s.turns * 2 * Math.PI) { v.input.yaw = 0; this.spinAcc = 0; next(); }
        break;
      case 'surface': {
        v.input.yaw = 0;
        const oct = this.g.course.octagon;
        this.steer([oct.pos[0], oct.pos[1], 0], undefined, dt, true);
        v.depthTarget = 0;
        if (v.depth < p.design.dims[2] * 0.4) { this.stepT += dt; if (this.stepT > 1) next(); }
        break;
      }
      case 'face': {
        const oct = this.g.course.octagon;
        const r = this.steer([oct.pos[0], oct.pos[1], 0], s.fn(), dt, true);
        if (Math.abs(r.eh) < 0.15) { this.stepT += dt; if (this.stepT > 1.6) next(); }
        break;
      }
      case 'done':
        v.input.surge = 0; v.input.sway = 0; v.input.yaw = 0;
        break;
      default: next();
    }
  }
}

export { boardLocal };
