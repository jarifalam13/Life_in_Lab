// Contacts between vehicles (a few spheres each), the course elements and the
// arena. Each contact pushes the vehicle out along the surface normal and
// removes the inward velocity (small restitution, Coulomb-like friction), the
// same idea as the simulator's penalty contacts but stiff enough for a game
// step.

import { boardLocal } from './course.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// sphere (centre c, radius r) vs obstacle -> { n: normal out of the obstacle, d: depth } or null
export function sphereVs(o, c, r) {
  if (o.type === 'cyl') {
    const z = clamp(c[2], o.z0, o.z1);
    const dx = c[0] - o.p[0], dy = c[1] - o.p[1], dz = c[2] - z;
    // closest point on the cylinder surface (side or caps)
    const rh = Math.hypot(dx, dy);
    if (c[2] >= o.z0 && c[2] <= o.z1) {
      const d = o.r + r - rh;
      if (d <= 0) return null;
      return { n: rh > 1e-9 ? [dx / rh, dy / rh, 0] : [1, 0, 0], d };
    }
    const qx = rh > o.r ? o.p[0] + (dx / rh) * o.r : c[0], qy = rh > o.r ? o.p[1] + (dy / rh) * o.r : c[1];
    const ex = c[0] - qx, ey = c[1] - qy, L = Math.hypot(ex, ey, dz);
    if (L >= r || L < 1e-9) return null;
    return { n: [ex / L, ey / L, dz / L], d: r - L };
  }
  if (o.type === 'box') {
    const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
    const dx = c[0] - o.c[0], dy = c[1] - o.c[1], dz = c[2] - o.c[2];
    const lx = dx * cy + dy * sy, ly = -dx * sy + dy * cy;
    const px = clamp(lx, -o.h[0], o.h[0]), py = clamp(ly, -o.h[1], o.h[1]), pz = clamp(dz, -o.h[2], o.h[2]);
    let ex = lx - px, ey = ly - py, ez = dz - pz;
    let L = Math.hypot(ex, ey, ez);
    if (L >= r) return null;
    if (L < 1e-9) {
      // centre inside: leave through the nearest face
      const fx = o.h[0] - Math.abs(lx), fy = o.h[1] - Math.abs(ly), fz = o.h[2] - Math.abs(dz);
      if (fx <= fy && fx <= fz) { ex = Math.sign(lx) || 1; ey = 0; ez = 0; L = -fx; }
      else if (fy <= fz) { ex = 0; ey = Math.sign(ly) || 1; ez = 0; L = -fy; }
      else { ex = 0; ey = 0; ez = Math.sign(dz) || 1; L = -fz; }
      return { n: [ex * cy - ey * sy, ex * sy + ey * cy, ez], d: r - L };
    }
    ex /= L; ey /= L; ez /= L;
    return { n: [ex * cy - ey * sy, ex * sy + ey * cy, ez], d: r - L };
  }
  if (o.type === 'board') {
    const b = o.board;
    const { u, v, n } = boardLocal(b, c);
    const half = b.size / 2, th = 0.012;
    const pu = clamp(u, -half, half), pv = clamp(v, -half, half), pn = clamp(n, -th, th);
    const eu = u - pu, ev = v - pv, en = n - pn;
    const L = Math.hypot(eu, ev, en);
    if (L >= r) return null;
    // back to world: u -> -right, v -> up (-z), n -> dir
    const k = L > 1e-9 ? 1 / L : 0;
    const nu = eu * k, nv = ev * k, nn = L > 1e-9 ? en * k : Math.sign(n) || 1;
    return { n: [-b.right[0] * nu + b.dir[0] * nn, -b.right[1] * nu + b.dir[1] * nn, -nv], d: r - (L > 1e-9 ? L : 0) };
  }
  if (o.type === 'ring') {
    // octagon floating pipe: torus around the vertical axis at the surface
    const dx = c[0] - o.p[0], dy = c[1] - o.p[1];
    const rh = Math.hypot(dx, dy) || 1e-9;
    const qx = o.p[0] + (dx / rh) * o.R, qy = o.p[1] + (dy / rh) * o.R, qz = o.z;
    const ex = c[0] - qx, ey = c[1] - qy, ez = c[2] - qz, L = Math.hypot(ex, ey, ez);
    if (L >= o.r + r || L < 1e-9) return null;
    return { n: [ex / L, ey / L, ez / L], d: o.r + r - L };
  }
  return null;
}

// Resolve contacts for one vehicle. Returns the set of obstacle tags touched.
export function collideVehicle(veh, course, arena, others = []) {
  const touched = new Set();
  const spheres = veh.d.spheres;
  for (let pass = 0; pass < 2; pass++) {
    for (const s of spheres) {
      const c = veh.toWorld(s);
      const r = s[3];
      const hits = [];
      for (const o of course.obstacles) {
        const h = sphereVs(o, c, r);
        if (h) { hits.push(h); touched.add(o.tag); }
      }
      // floor and walls (the sea scenarios keep an invisible boundary at the same place)
      if (c[2] + r > arena.depth) hits.push({ n: [0, 0, -1], d: c[2] + r - arena.depth, floor: true });
      const hx = arena.length / 2, hy = arena.width / 2;
      if (c[0] + r > hx) hits.push({ n: [-1, 0, 0], d: c[0] + r - hx });
      if (c[0] - r < -hx) hits.push({ n: [1, 0, 0], d: -hx - (c[0] - r) });
      if (c[1] + r > hy) hits.push({ n: [0, -1, 0], d: c[1] + r - hy });
      if (c[1] - r < -hy) hits.push({ n: [0, 1, 0], d: -hy - (c[1] - r) });
      if (c[2] - r < -0.6) hits.push({ n: [0, 0, 1], d: -0.6 - (c[2] - r) }); // can't jump out of the water
      for (const other of others) {
        for (const so of other.d.spheres) {
          const co = other.toWorld(so);
          const dx = c[0] - co[0], dy = c[1] - co[1], dz = c[2] - co[2];
          const L = Math.hypot(dx, dy, dz), rr = r + so[3];
          if (L < rr && L > 1e-6) { hits.push({ n: [dx / L, dy / L, dz / L], d: (rr - L) * 0.5, bot: other }); touched.add('bot'); }
        }
      }
      for (const h of hits) applyContact(veh, h, s);
    }
  }
  return touched;
}

function applyContact(veh, h, s) {
  const n = h.n;
  const d = Math.min(h.d, 0.12);
  veh.p[0] += n[0] * d; veh.p[1] += n[1] * d; veh.p[2] += n[2] * d;
  // world velocity of the contact point: v + w x r (r in world)
  const vw = veh.worldVel();
  const vn = vw[0] * n[0] + vw[1] * n[1] + vw[2] * n[2];
  if (vn < 0) {
    const e = 0.25;
    const dv = -(1 + e) * vn;
    const nv = [vw[0] + n[0] * dv, vw[1] + n[1] * dv, vw[2] + n[2] * dv];
    // friction on the tangential part
    const vt = [nv[0] - n[0] * (nv[0] * n[0] + nv[1] * n[1] + nv[2] * n[2]), nv[1] - n[1] * (nv[0] * n[0] + nv[1] * n[1] + nv[2] * n[2]), nv[2] - n[2] * (nv[0] * n[0] + nv[1] * n[1] + nv[2] * n[2])];
    const f = h.floor ? 0.25 : 0.1;
    for (let i = 0; i < 3; i++) nv[i] -= vt[i] * f;
    const R = veh.R;
    veh.v = [R[0] * nv[0] + R[3] * nv[1] + R[6] * nv[2], R[1] * nv[0] + R[4] * nv[1] + R[7] * nv[2], R[2] * nv[0] + R[5] * nv[1] + R[8] * nv[2]];
    // a knock spins the vehicle a little (torque of the impulse about the CG)
    const rb = [s[0], s[1], s[2]];
    const nb = [R[0] * n[0] + R[3] * n[1] + R[6] * n[2], R[1] * n[0] + R[4] * n[1] + R[7] * n[2], R[2] * n[0] + R[5] * n[1] + R[8] * n[2]];
    const tq = [rb[1] * nb[2] - rb[2] * nb[1], rb[2] * nb[0] - rb[0] * nb[2], rb[0] * nb[1] - rb[1] * nb[0]];
    const k = (dv * veh.mass) * 0.35;
    for (let i = 0; i < 3; i++) veh.w[i] += (tq[i] * k) / veh.It[i];
    veh.lastImpact = dv;
  }
}
