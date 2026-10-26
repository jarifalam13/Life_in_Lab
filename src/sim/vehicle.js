// One player's vehicle: 6-DOF rigid body in water plus an ArduSub-style
// STABILIZE / DEPTH HOLD pilot loop.
//
// Plant (Fossen, body FRD about the CG, diagonal mass, implicit damping):
//   (M_RB + M_A) nu_dot + C_RB(nu) nu + D(nu_r) nu_r + g(eta) = tau_thr
// nu_r is the velocity relative to the water (current, turbulence and wave
// orbital velocity come from the simulator's Environment). Buoyancy uses the
// in-situ EOS-80 density at the vehicle's depth and the submerged fraction
// near the free surface. Thrusters are the simulator's ThrusterState: PWM ->
// thrust curve, rotor lag, in-flow loss and ventilation near the surface.
//
// Pilot inputs (all -1..1): surge, sway, heave, yaw, roll, pitch. Roll / pitch
// inputs are rate commands (hold to flip, release and the vehicle levels
// itself again, keeping its heading).

import { ThrusterState, THRUSTER_PRESETS, parametricCurve } from '../physics/thruster.js';
import { buildB } from '../alloc/allocation.js';
import { pinv, qmul, qnormalize, qconj, qToMat, qFromEuler, qToEuler, qToAxisAngle, qFromAxisAngleVec, clamp, wrapPI } from '../core/math.js';

export const DT = 1 / 120;
const DESIGN_RHO = 1000; // ballasted in fresh water (kg/m^3)
const ROLL_RATE = 2.6; // rad/s commanded at full roll/pitch input
const YAW_RATE = 1.4; // rad/s at full yaw input
const LEVEL_RATE = 2.4; // rad/s the target moves back to level

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mulMat = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const mulMatT = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];

// Rotate the quaternion `from` toward `to` by at most `maxAngle` radians.
function qStepToward(from, to, maxAngle) {
  let e = qmul(qconj(from), to);
  if (e[0] < 0) e = e.map((v) => -v);
  const rv = qToAxisAngle(e);
  const a = Math.hypot(rv[0], rv[1], rv[2]);
  if (a <= maxAngle || a < 1e-9) return to.slice();
  const k = maxAngle / a;
  return qnormalize(qmul(from, qFromAxisAngleVec([rv[0] * k, rv[1] * k, rv[2] * k])));
}

export class Vehicle {
  constructor(design, env) {
    this.d = design;
    this.env = env;
    const g = env.g;
    this.mass = design.mass;
    this.volume = (design.mass * g + design.Bnet) / (DESIGN_RHO * g);
    this.Mt = [0, 1, 2].map((i) => design.mass + design.addedMass[i]);
    this.It = [0, 1, 2].map((i) => design.inertia[i] + design.addedMass[3 + i]);
    this.th = design.thrusters.map((t) => {
      const pr = THRUSTER_PRESETS[t.preset];
      return new ThrusterState({ ...t, table: parametricCurve(pr.curve) });
    });
    this.voltage = THRUSTER_PRESETS[design.thrusters[0].preset].voltage;
    // allocation: u (fraction of nominal thrust per thruster) = P * wrench
    const defs = design.thrusters.map((t, i) => ({ pos: t.pos, axis: t.axis, fwdMax: this.th[i].curve.fwdMax, revMax: this.th[i].curve.revMax }));
    const { B, nom } = buildB(defs, [0, 0, 0]);
    this.nom = nom;
    this.P = pinv(B);
    // largest wrench along each axis before a thruster saturates
    this.wmax = [0, 1, 2, 3, 4, 5].map((k) => {
      let m = 0;
      for (let i = 0; i < this.P.length; i++) m = Math.max(m, Math.abs(this.P[i][k]));
      return m > 1e-9 ? 1 / m : 0;
    });
    this.chooseHands();
    this.reset([0, 0, 0], 0);
  }

  // Pick CW / CCW propellers so the reaction torques cancel for pure surge,
  // sway and heave (what a team does when it orders props).
  chooseHands() {
    const N = this.th.length, d = this.d;
    if (N > 12) return;
    let best = null;
    for (let mask = 0; mask < 1 << N; mask++) {
      let cost = 0;
      for (let k = 0; k < 3; k++) {
        const t = [0, 0, 0];
        for (let i = 0; i < N; i++) {
          const T = this.P[i][k] * this.wmax[k] * this.nom[i];
          const h = mask & (1 << i) ? 1 : -1;
          for (let j = 0; j < 3; j++) t[j] -= h * this.th[i].torqueRatio * (d.thrusters[i].propDiameter ?? THRUSTER_PRESETS[d.thrusters[i].preset].propDiameter) * T * d.thrusters[i].axis[j];
        }
        cost += t[0] * t[0] + t[1] * t[1] + t[2] * t[2] * 0.2;
      }
      if (!best || cost < best.cost - 1e-12) best = { cost, mask };
    }
    this.th.forEach((t, i) => { t.def = { ...t.def, hand: best.mask & (1 << i) ? 1 : -1 }; });
  }

  reset(pos, heading) {
    this.p = pos.slice();
    this.v = [0, 0, 0];
    this.w = [0, 0, 0];
    this.q = qFromEuler(0, 0, heading);
    this.targetQ = this.q.slice();
    this.hdg = heading;
    this.depthTarget = Math.max(0, pos[2]);
    this.depthHold = true;
    this.depthI = 0;
    this.acro = false;
    this.u = new Array(this.th.length).fill(0);
    for (const t of this.th) { t.n = 0; t.dwell = 0; }
    this.R = qToMat(this.q);
    this.diag = { submerged: 0, buoyancy: this.mass * this.env.g, weight: this.mass * this.env.g, rho: this.env.rho, thrust: 0, current: 0, net: 0, flow: [0, 0, 0] };
    this.contactTimer = 0;
    this.input = { surge: 0, sway: 0, heave: 0, yaw: 0, roll: 0, pitch: 0 };
  }

  get depth() { return this.p[2] + this.env.surfaceElevation(this.p[0], this.p[1]); }
  euler() { return qToEuler(this.q); }
  toWorld(b) { const r = mulMat(this.R, b); return [this.p[0] + r[0], this.p[1] + r[1], this.p[2] + r[2]]; }
  worldVel() { return mulMat(this.R, this.v); }
  bodyToWorldDir(b) { return mulMat(this.R, b); }

  // heading of the body x axis projected on the horizontal (keeps the last one when vertical)
  projectedHeading(q) {
    const R = qToMat(q);
    const fx = R[0], fy = R[3];
    if (Math.hypot(fx, fy) > 0.35) return Math.atan2(fy, fx);
    return this.hdg;
  }

  pwmFor(i, T) {
    // smallest PWM giving thrust T on thruster i's curve (monotonic table)
    const c = this.th[i].curve;
    if (Math.abs(T) < 1e-6) return 1500;
    const P = c.pwm, Tt = c.T, n = P.length;
    if (T > 0) {
      if (T >= Tt[n - 1]) return P[n - 1];
      for (let k = 0; k < n - 1; k++) if (Tt[k + 1] >= T && Tt[k] < T && Tt[k + 1] > 0) return P[k] + ((T - Tt[k]) / (Tt[k + 1] - Tt[k])) * (P[k + 1] - P[k]);
      return 1500;
    }
    if (T <= Tt[0]) return P[0];
    for (let k = n - 1; k > 0; k--) if (Tt[k - 1] <= T && Tt[k] > T && Tt[k - 1] < 0) return P[k] - ((Tt[k] - T) / (Tt[k] - Tt[k - 1])) * (P[k] - P[k - 1]);
    return 1500;
  }

  // ---------------- pilot loop ----------------
  control(dt) {
    const inp = this.input;
    const dz = (v) => (Math.abs(v) < 0.06 ? 0 : v);
    const roll = dz(inp.roll), pitch = dz(inp.pitch), yaw = dz(inp.yaw), heave = dz(inp.heave);
    this.hdg = wrapPI(this.hdg + yaw * YAW_RATE * dt);
    let ff = [0, 0, 0];
    if (roll || pitch) {
      // acro on roll / pitch: advance the target in body axes
      this.acro = true;
      ff = [roll * ROLL_RATE, pitch * ROLL_RATE, yaw * YAW_RATE];
      this.targetQ = qnormalize(qmul(this.targetQ, qFromAxisAngleVec([ff[0] * dt, ff[1] * dt, ff[2] * dt])));
      this.hdg = this.projectedHeading(this.targetQ);
    } else {
      if (this.acro) { this.hdg = this.projectedHeading(this.q); this.acro = false; }
      this.targetQ = qStepToward(this.targetQ, qFromEuler(0, 0, this.hdg), LEVEL_RATE * dt);
      ff = [0, 0, yaw * YAW_RATE * 0.6];
    }
    // attitude error -> rate -> torque
    let qe = qmul(qconj(this.q), this.targetQ);
    if (qe[0] < 0) qe = qe.map((v) => -v);
    const e = qToAxisAngle(qe);
    const tau = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const rateDes = clamp(5.0 * e[i] + ff[i], -4, 4);
      tau[i] = this.It[i] * 9 * (rateDes - this.w[i]) + (this.d.dampLin[3 + i] + this.d.dampQuad[3 + i] * Math.abs(this.w[i])) * this.w[i] * 0.5;
    }
    // depth: pilot throttle or depth hold (PID on depth, world vertical)
    const depth = this.p[2]; // pressure sensor: still-water depth (wave pressure decays with depth)
    const vzWorld = this.worldVel()[2];
    let Fz;
    const wz = this.wmax[2];
    if (heave) {
      Fz = -heave * wz;
      this.depthTarget = Math.max(0, depth);
      this.depthI *= 0.98;
    } else if (this.depthHold) {
      const err = clamp(this.depthTarget - depth, -1.5, 1.5);
      this.depthI = clamp(this.depthI + err * dt * 2.5, -0.6, 0.6);
      Fz = this.Mt[2] * (4 * err - 4.5 * vzWorld) + this.depthI * wz;
      // buoyancy feed-forward (pilot knows the trim) so the hold is crisp
      Fz += this.diag.buoyancy - this.mass * this.env.g;
      Fz = clamp(Fz, -wz, wz);
      if (this.depthTarget < 0.05 && depth < 0.25) Fz = Math.min(Fz, 0); // let it float on the surface
    } else Fz = 0;
    const fzBody = mulMatT(this.R, [0, 0, Fz]);
    const trans = [inp.surge * this.wmax[0] + fzBody[0], inp.sway * this.wmax[1] + fzBody[1], fzBody[2]];
    // allocate attitude first, translation scaled down to fit
    const N = this.th.length;
    const uA = new Array(N), uT = new Array(N);
    let maxA = 0;
    for (let i = 0; i < N; i++) {
      const P = this.P[i];
      uA[i] = P[3] * tau[0] + P[4] * tau[1] + P[5] * tau[2];
      uT[i] = P[0] * trans[0] + P[1] * trans[1] + P[2] * trans[2];
      maxA = Math.max(maxA, Math.abs(uA[i]));
    }
    if (maxA > 1) for (let i = 0; i < N; i++) uA[i] /= maxA;
    let s = 1;
    for (let i = 0; i < N; i++) {
      const tot = uA[i] + uT[i];
      if (Math.abs(tot) > 1 && Math.abs(uT[i]) > 1e-9) {
        const room = Math.sign(uT[i]) * Math.sign(tot) > 0 ? (Math.sign(tot) - uA[i]) / uT[i] : 1;
        s = Math.min(s, clamp(room, 0, 1));
      }
    }
    for (let i = 0; i < N; i++) this.u[i] = clamp(uA[i] + uT[i] * s, -1, 1);
  }

  // ---------------- plant ----------------
  step(dt, armed = true) {
    if (armed) this.control(dt); else this.u.fill(0);
    const env = this.env, d = this.d, g = env.g;
    const R = (this.R = qToMat(this.q));
    const p = this.p, v = this.v, w = this.w;
    const eta = env.surfaceElevation(p[0], p[1]);
    const depthC = p[2] + eta;
    const H = d.dims[2];
    const sub = clamp(depthC / H + 0.5, 0, 1);
    const rho = env.densityAtDepth(Math.max(0, depthC));
    const fl = env.fluidVelocity(p[0], p[1], Math.max(0, p[2]));
    const vcb = mulMatT(R, fl);
    const vr = [v[0] - vcb[0], v[1] - vcb[1], v[2] - vcb[2]];
    const W = this.mass * g;
    const Bf = rho * g * this.volume * sub;
    const gb = mulMatT(R, [0, 0, 1]);
    const F = [(W - Bf) * gb[0], (W - Bf) * gb[1], (W - Bf) * gb[2]];
    const rB = [0, 0, -d.zB];
    const tb = cross(rB, [-Bf * gb[0], -Bf * gb[1], -Bf * gb[2]]);
    const T = [tb[0], tb[1], tb[2]];
    // thrusters
    let thrustSum = 0, current = 0;
    for (let i = 0; i < this.th.length; i++) {
      const th = this.th[i], td = d.thrusters[i];
      const pwm = armed ? this.pwmFor(i, this.u[i] * this.nom[i]) : 1500;
      th.update(pwm, dt, this.voltage);
      const pv = cross(w, td.pos);
      const inflow = (vr[0] + pv[0]) * td.axis[0] + (vr[1] + pv[1]) * td.axis[1] + (vr[2] + pv[2]) * td.axis[2];
      const tw = this.toWorld(td.pos);
      const Te = th.effective(inflow, tw[2] + env.surfaceElevation(tw[0], tw[1]));
      th.Teff = Te;
      const f = [td.axis[0] * Te, td.axis[1] * Te, td.axis[2] * Te];
      const m = cross(td.pos, f);
      const Q = th.reactionTorque();
      for (let k = 0; k < 3; k++) { F[k] += f[k]; T[k] += m[k] + td.axis[k] * Q; }
      thrustSum += Math.abs(Te);
      current += th.current;
    }
    // Coriolis (rigid body + gyroscopic)
    const Iw = [d.inertia[0] * w[0], d.inertia[1] * w[1], d.inertia[2] * w[2]];
    const gyro = cross(w, Iw);
    const surf = 1 + 0.6 * 4 * sub * (1 - sub);
    const wv = cross(w, v);
    for (let i = 0; i < 3; i++) {
      const Dl = (d.dampLin[i] + d.dampQuad[i] * Math.abs(vr[i])) * surf;
      const a = F[i] / this.Mt[i] - (this.mass / this.Mt[i]) * wv[i];
      v[i] = (v[i] + dt * a + (dt * Dl / this.Mt[i]) * vcb[i]) / (1 + (dt * Dl) / this.Mt[i]);
      const Dr = (d.dampLin[3 + i] + d.dampQuad[3 + i] * Math.abs(w[i])) * surf;
      const ar = (T[i] - gyro[i]) / this.It[i];
      w[i] = (w[i] + dt * ar) / (1 + (dt * Dr) / this.It[i]);
    }
    const vw = mulMat(R, v);
    for (let i = 0; i < 3; i++) p[i] += vw[i] * dt;
    // can't fly: above the water the body falls back
    const qd = qmul(this.q, [0, w[0], w[1], w[2]]);
    this.q = qnormalize([this.q[0] + 0.5 * dt * qd[0], this.q[1] + 0.5 * dt * qd[1], this.q[2] + 0.5 * dt * qd[2], this.q[3] + 0.5 * dt * qd[3]]);
    this.R = qToMat(this.q);
    this.diag = { submerged: sub, buoyancy: Bf, weight: W, rho, thrust: thrustSum, current, net: Bf - W, flow: fl };
  }

  // speed through the water and over ground (m/s)
  speed() { const vw = this.worldVel(); return Math.hypot(vw[0], vw[1], vw[2]); }
}
