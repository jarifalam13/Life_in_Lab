// 3D models of the player vehicles and of the game items (markers, torpedoes,
// cup, spoon), built from three.js primitives at real scale (metres).
//
// Model frame: body FRD point b = [x fwd, y right, z down] -> (b[1], -b[2], -b[0]),
// i.e. the model faces -Z, +Y is up, +X is right, origin at the CG.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// body FRD -> model coords
const P = (b, out = new THREE.Vector3()) => out.set(b[1], -b[2], -b[0]);
const place = (o, b) => { P(b, o.position); return o; };
const add = (parent, o, b) => { if (b) place(o, b); parent.add(o); return o; };

// ---------------------------------------------------------------- materials

const std = (color, metalness, roughness, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });

// Per-bot build context: materials + a geometry cache so parts are reused.
function makeCtx(color) {
  const c = new THREE.Color(color);
  const geos = new Map();
  const M = {
    team: std(c, 0.1, 0.45),
    teamDark: std(c.clone().multiplyScalar(0.42), 0.1, 0.6),
    foam: std(c, 0, 0.85),
    black: std(0x16181b, 0, 0.75),            // HDPE / plastic
    plastic: std(0x2a2e34, 0.1, 0.5),
    alu: std(0xb9c0c8, 0.6, 0.35),
    anod: std(0x3b4048, 0.5, 0.4),
    prop: std(0x2b323b, 0.1, 0.45, { side: THREE.DoubleSide }),
    tunnel: std(0x060708, 0, 0.95, { side: THREE.DoubleSide }),
    acrylic: std(0xd8ecff, 0, 0.05, { transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    pcb: std(0x1d7a3c, 0.1, 0.55),
    chip: std(0x101114, 0.2, 0.4),
    blue: std(0x2b6cb0, 0.2, 0.5),
    lens: std(0x04060a, 0.6, 0.06),
    white: std(0xf2f2f2, 0, 0.5),
    led: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 3, roughness: 0.3 }),
    halo: new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  const geo = (key, make) => { let g = geos.get(key); if (!g) { g = make(); geos.set(key, g); } return g; };
  return { M, geo, color: c };
}

const mesh = (g, m, name) => { const o = new THREE.Mesh(g, m); if (name) o.name = name; return o; };

// Cylinder along model Z (body x), centred.
const cylZ = (rt, rb, h, seg, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).rotateX(PI / 2);

// Point a child's +Z along a body-frame direction.
function orient(o, axisBody) {
  P(axisBody, _v).normalize();
  o.quaternion.setFromUnitVectors(Z_AXIS, _v);
}

// Rod between two body points (unit cylinder scaled along its length).
function rod(ctx, parent, a, b, r, mat) {
  const g = ctx.geo(`rod${r}`, () => new THREE.CylinderGeometry(r, r, 1, 8));
  const m = mesh(g, mat);
  P(a, _v); P(b, _w);
  m.position.copy(_v).add(_w).multiplyScalar(0.5);
  _w.sub(_v); m.scale.y = _w.length();
  m.quaternion.setFromUnitVectors(Y_AXIS, _w.normalize());
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------- thrusters

// Twisted 3-blade propeller in the XY plane, spinning about Z.
function propGeometry(R, hand = 1, blades = 3) {
  const pos = [];
  const rh = R * 0.3, seg = 4, pitch = 0.55 * (hand || 1);
  const pt = (a, rr, side) => {
    const k = (rr - rh) / (R - rh);
    const c = R * 0.5 * (1 - 0.45 * k);                 // chord
    const ph = pitch * (1 - 0.4 * k);                   // twist
    const ca = Math.cos(a), sa = Math.sin(a);
    const t = side * c * 0.5;
    return [ca * rr - sa * t * Math.cos(ph), sa * rr + ca * t * Math.cos(ph), t * Math.sin(ph)];
  };
  for (let b = 0; b < blades; b++) {
    const a = (b * 2 * PI) / blades;
    for (let s = 0; s < seg; s++) {
      const r0 = rh + ((R - rh) * s) / seg, r1 = rh + ((R - rh) * (s + 1)) / seg;
      const p00 = pt(a, r0, -1), p01 = pt(a, r0, 1), p10 = pt(a, r1, -1), p11 = pt(a, r1, 1);
      pos.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Thruster sizes per preset: duct outer radius, duct length.
const TH_SIZE = { 't200-16v': [0.05, 0.07], 't500-20v': [0.075, 0.1], 'generic-small': [0.03, 0.042] };

// Ducted thruster with local +Z = thrust axis. Returns { group, prop }.
function makeThruster(ctx, t, i, opt = {}) {
  const [R, L] = opt.size ?? TH_SIZE[t.preset] ?? TH_SIZE['t200-16v'];
  const hand = t.hand ?? 1;
  const { M } = ctx;
  const g = new THREE.Group();
  g.name = `thruster_${i}`;
  const th = R * 0.13, rh = R * 0.26;

  const prop = mesh(ctx.geo(`prop${R}${hand}`, () => propGeometry(R - th - 0.002, hand)), M.prop, `propeller_${i}`);
  const hub = mesh(ctx.geo(`hub${R}`, () => new THREE.LatheGeometry([
    new THREE.Vector2(0, -L * 0.42), new THREE.Vector2(rh * 0.7, -L * 0.42), new THREE.Vector2(rh, -L * 0.3),
    new THREE.Vector2(rh, L * 0.25), new THREE.Vector2(rh * 0.55, L * 0.42), new THREE.Vector2(0, L * 0.46),
  ], 8).rotateX(PI / 2)), M.black);

  if (opt.tunnel) {
    // Tunnel through a hull: dark openings with rims; prop sits at the -axis opening.
    const [dn, dp] = opt.tunnel;
    const ring = ctx.geo(`trim${R}`, () => new THREE.RingGeometry(R * 0.92, R * 1.18, 20));
    const disc = ctx.geo(`tdisc${R}`, () => new THREE.CircleGeometry(R * 0.93, 20));
    for (const [d, s] of [[-dn, -1], [dp, 1]]) {
      const r = mesh(ring, M.plastic); r.position.z = d + s * 0.0015; if (s < 0) r.rotation.y = PI; g.add(r);
      const k = mesh(disc, M.tunnel); k.position.z = d; if (s < 0) k.rotation.y = PI; g.add(k);
    }
    prop.position.z = -dn - 0.003;
    hub.scale.setScalar(0.35); hub.position.z = -dn - 0.002;
    g.add(prop, hub);
    return { group: g, prop };
  }

  const duct = mesh(ctx.geo(`duct${R}`, () => new THREE.LatheGeometry([
    new THREE.Vector2(R - th, -L / 2), new THREE.Vector2(R - th * 0.3, -L / 2), new THREE.Vector2(R, -L * 0.25),
    new THREE.Vector2(R, L / 2), new THREE.Vector2(R - th, L / 2), new THREE.Vector2(R - th, -L / 2),
  ], 16).rotateX(PI / 2)), M.black);
  // three stator struts hub -> duct
  const strut = ctx.geo(`strut${R}`, () => new THREE.BoxGeometry(0.004, R - th - rh + 0.004, L * 0.14));
  for (let k = 0; k < 3; k++) {
    const s = mesh(strut, M.black);
    const a = (k * 2 * PI) / 3 + PI / 6;
    const rm = (rh + R - th) / 2;
    s.position.set(Math.cos(a) * rm, Math.sin(a) * rm, L * 0.3);
    s.rotation.z = a - PI / 2;
    g.add(s);
  }
  prop.position.z = -L * 0.08;
  g.add(duct, hub, prop);
  return { group: g, prop };
}

function addThrusters(ctx, root, design, opts = {}) {
  return design.thrusters.map((t, i) => {
    const o = typeof opts === 'function' ? opts(t, i) ?? {} : opts;
    const { group, prop } = makeThruster(ctx, t, i, o);
    place(group, t.pos);
    orient(group, t.axis);
    root.add(group);
    return prop;
  });
}

// ---------------------------------------------------------------- sensors

// Front camera lens, LED lights and a downward camera.
function addSensors(ctx, root, { cam, camR = 0.014, leds = [], ledR = 0.011, down }) {
  const { M } = ctx;
  const camG = new THREE.Group(); camG.name = 'camera_front';
  camG.add(mesh(ctx.geo(`bezel${camR}`, () => cylZ(camR * 1.3, camR * 1.3, camR * 0.9, 16)), M.anod));
  const glass = mesh(ctx.geo(`lensG${camR}`, () => new THREE.SphereGeometry(camR, 16, 8, 0, 2 * PI, 0, PI / 2).rotateX(-PI / 2)), M.lens);
  glass.position.z = -camR * 0.45; glass.scale.z = 0.6;
  camG.add(glass);
  add(root, camG, cam);

  leds.forEach((b, i) => {
    const l = new THREE.Group(); l.name = `led_${i}`;
    l.add(mesh(ctx.geo(`ledH${ledR}`, () => cylZ(ledR, ledR, ledR * 1.8, 12)), M.alu));
    const face = mesh(ctx.geo(`ledF${ledR}`, () => new THREE.CircleGeometry(ledR * 0.8, 12)), M.led);
    face.position.z = -ledR * 0.91; face.rotation.y = PI;
    const halo = mesh(ctx.geo(`ledHalo${ledR}`, () => new THREE.SphereGeometry(ledR * 2, 10, 6)), M.halo);
    halo.position.z = -ledR * 1.2; halo.renderOrder = 2;
    l.add(face, halo);
    add(root, l, b);
  });

  if (down) {
    const d = new THREE.Group(); d.name = 'camera_down';
    d.add(mesh(ctx.geo('dcamH', () => new THREE.CylinderGeometry(0.016, 0.016, 0.014, 14)), M.anod));
    const lens = mesh(ctx.geo('dcamL', () => new THREE.SphereGeometry(0.011, 12, 6, 0, 2 * PI, PI / 2, PI / 2)), M.lens);
    lens.position.y = -0.007; lens.scale.y = 0.6;
    d.add(lens);
    add(root, d, down);
  }
}

// ---------------------------------------------------------------- payloads

// Gripper claw at body point; jaws open sideways, pointing forward (-Z).
function addGripper(ctx, root, b, { s = 1, arm = 0.04, post = 0.03 } = {}) {
  const { M } = ctx;
  const g = new THREE.Group(); g.name = 'gripper';
  const base = mesh(ctx.geo(`gBase${s}`, () => new THREE.BoxGeometry(0.042 * s, 0.026 * s, 0.03 * s)), M.anod);
  g.add(base);
  if (arm > 0) {
    const a = mesh(ctx.geo(`gArm${s}`, () => new THREE.BoxGeometry(0.014 * s, 0.014 * s, 1)), M.alu);
    a.scale.z = arm; a.position.z = arm / 2; g.add(a);
  }
  if (post > 0) {
    const p = mesh(ctx.geo(`gPost${s}`, () => new THREE.BoxGeometry(0.014 * s, 1, 0.014 * s)), M.alu);
    p.scale.y = post; p.position.set(0, post / 2, arm); g.add(p);
  }
  const link = ctx.geo(`gLink${s}`, () => new THREE.BoxGeometry(0.007 * s, 0.02 * s, 0.05 * s).translate(0, 0, -0.025 * s));
  const tip = ctx.geo(`gTip${s}`, () => new THREE.BoxGeometry(0.007 * s, 0.02 * s, 0.024 * s).translate(0, 0, -0.012 * s));
  const fingers = [-1, 1].map((side) => {
    const f = new THREE.Group(); f.name = side < 0 ? 'finger_left' : 'finger_right';
    f.position.set(side * 0.013 * s, 0, -0.015 * s);
    f.add(mesh(link, M.alu));
    const t = mesh(tip, M.black);
    t.position.z = -0.048 * s; t.rotation.y = side * 0.7;    // tips bend inward
    f.add(t);
    g.add(f);
    return f;
  });
  const tipPt = new THREE.Object3D(); tipPt.name = 'grip_point';
  tipPt.position.z = -0.065 * s;
  g.add(tipPt);
  add(root, g, b);
  return { group: g, fingers, tip: tipPt };
}

// Marker dropper: two horizontal markers side by side under a holder plate.
function addMarkers(ctx, root, b, color) {
  const g = new THREE.Group(); g.name = 'marker_dropper';
  const plate = mesh(ctx.geo('mPlate', () => new THREE.BoxGeometry(0.12, 0.006, 0.17)), ctx.M.black);
  plate.position.y = 0.03; g.add(plate);
  const rail = ctx.geo('mRail', () => new THREE.BoxGeometry(0.004, 0.05, 0.17));
  for (const x of [-0.06, 0, 0.06]) { const r = mesh(rail, ctx.M.black); r.position.set(x, 0.005, 0); g.add(r); }
  const loaded = [-0.03, 0.03].map((x, i) => {
    const m = createItemMesh('marker', color);
    m.name = `marker_${i}`; m.rotation.x = PI / 2; m.position.x = x;
    g.add(m); return m;
  });
  add(root, g, b);
  return loaded;
}

// Two torpedo tubes ('v' = stacked, 'h' = side by side), pointing forward.
function addTorpedoes(ctx, root, b, color, { layout = 'h', off = [0, 0, 0] } = {}) {
  const g = new THREE.Group(); g.name = 'torpedo_launcher';
  const tube = ctx.geo('tTube', () => cylZ(0.029, 0.029, 0.16, 16, true));
  const lip = ctx.geo('tLip', () => new THREE.RingGeometry(0.026, 0.033, 16));
  const loaded = [-1, 1].map((s, i) => {
    const d = s * 0.031;
    const t = mesh(tube, ctx.M.anod);
    const l = mesh(lip, ctx.M.black); l.position.z = -0.0801; l.rotation.y = PI;
    const tg = new THREE.Group(); tg.add(t, l);
    if (layout === 'v') tg.position.y = d; else tg.position.x = d;
    const torp = createItemMesh('torpedo', color);
    torp.name = `torpedo_${i}`; torp.position.z = -0.012;
    tg.add(torp);
    g.add(tg);
    return torp;
  });
  add(root, g, [b[0] + off[0], b[1] + off[1], b[2] + off[2]]);
  return loaded;
}

// Logo decal plane (width w, aspect ~2.6). rotY turns the +Z face outward.
function logoPlane(ctx, tex, w, rotY) {
  const img = tex.image;
  const aspect = img && img.width && img.height ? img.width / img.height : 2.6;
  if (!ctx.M.logo) {
    ctx.M.logo = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, roughness: 0.55, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
  }
  const m = mesh(new THREE.PlaneGeometry(w, w / aspect), ctx.M.logo, 'logo');
  m.rotation.y = rotY;
  return m;
}

// ---------------------------------------------------------------- vehicles

function buildDuburi(ctx, root, d, tex) {
  const { M } = ctx;
  // side plates (black HDPE) with chamfered top corners and lightening holes
  const hx = 0.22, hy = 0.12, c = 0.05, r = 0.02, t = 0.012, py = 0.165;
  const plateGeo = ctx.geo('plate', () => {
    const s = new THREE.Shape();
    s.moveTo(-hx + r, -hy); s.lineTo(hx - r, -hy); s.quadraticCurveTo(hx, -hy, hx, -hy + r);
    s.lineTo(hx, hy - c); s.lineTo(hx - c, hy); s.lineTo(-hx + c, hy); s.lineTo(-hx, hy - c);
    s.lineTo(-hx, -hy + r); s.quadraticCurveTo(-hx, -hy, -hx + r, -hy);
    for (const x of [-0.13, 0, 0.13]) { const h = new THREE.Path(); h.absarc(x, -0.075, 0.02, 0, 2 * PI, true); s.holes.push(h); }
    return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 5 })
      .translate(0, 0, -t / 2).rotateY(PI / 2);   // shape x -> forward (-Z), extrude -> X
  });
  for (const side of [-1, 1]) {
    const p = mesh(plateGeo, M.black, side > 0 ? 'plate_right' : 'plate_left');
    p.position.x = side * py; root.add(p);
    if (tex) {
      // outer face; rotY=+90deg on the right / -90deg on the left keeps text unmirrored
      const l = logoPlane(ctx, tex, 0.3, side * PI / 2);
      l.position.set(side * (py + t / 2 + 0.0008), 0.012, 0);
      root.add(l);
    }
  }
  // cross bars
  const bar = ctx.geo('bar', () => new THREE.BoxGeometry(2 * py, 0.02, 0.02));
  for (const [x, z] of [[0.2, 0.055], [-0.2, 0.11], [0.19, 0.11], [-0.2, -0.1]]) add(root, mesh(bar, M.black), [x, 0, z]);

  // main electronics tube: clear acrylic, dome front, alu end caps
  const tz = -0.015, tr = 0.057;
  add(root, mesh(cylZ(tr, tr, 0.3, 24, true), M.acrylic, 'main_tube'), [0, 0, tz]);
  const dome = mesh(new THREE.SphereGeometry(tr, 20, 8, 0, 2 * PI, 0, PI / 2).rotateX(-PI / 2), M.acrylic, 'dome');
  add(root, dome, [0.15, 0, tz]);
  const flange = ctx.geo('flange', () => cylZ(tr + 0.005, tr + 0.005, 0.016, 24));
  add(root, mesh(flange, M.alu), [0.15, 0, tz]);
  add(root, mesh(flange, M.alu), [-0.155, 0, tz]);
  const pen = ctx.geo('pen', () => cylZ(0.006, 0.006, 0.02, 8));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * 2 * PI;
    add(root, mesh(pen, M.black), [-0.17, Math.cos(a) * 0.035, tz + Math.sin(a) * 0.035]);
  }
  // electronics inside
  add(root, mesh(new THREE.BoxGeometry(0.08, 0.004, 0.24), M.pcb), [0, 0, tz + 0.012]);
  add(root, mesh(new THREE.BoxGeometry(0.045, 0.016, 0.07), M.chip), [0.05, 0, tz + 0.002]);
  add(root, mesh(new THREE.BoxGeometry(0.055, 0.018, 0.085), M.pcb), [-0.06, 0, tz + 0.001]);
  add(root, mesh(new THREE.BoxGeometry(0.03, 0.012, 0.03), M.blue), [-0.06, 0.012, tz - 0.012]);
  add(root, mesh(new THREE.BoxGeometry(0.06, 0.012, 0.05), M.chip), [0.02, 0, tz + 0.025]);
  add(root, mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), M.plastic), [0.135, 0, tz]); // camera tilt mount

  // battery tube below
  add(root, mesh(cylZ(0.038, 0.038, 0.24, 20), M.alu, 'battery_tube'), [0, 0, 0.08]);
  const bcap = ctx.geo('bcap', () => cylZ(0.041, 0.041, 0.016, 20));
  add(root, mesh(bcap, M.black), [0.12, 0, 0.08]);
  add(root, mesh(bcap, M.black), [-0.12, 0, 0.08]);

  // buoyancy foam on top: two blocks leaving a channel over the tube
  const foam = ctx.geo('foam', () => new THREE.BoxGeometry(0.11, 0.055, 0.4));
  for (const y of [-0.097, 0.097]) add(root, mesh(foam, M.foam, 'foam'), [0, y, -0.1025]);

  return {
    props: addThrusters(ctx, root, d),
    sensors: { cam: [0.17, 0, tz], camR: 0.013, leds: [[0.215, 0.105, 0.04], [0.215, -0.105, 0.04]], down: [0.14, 0, 0.125] },
    grip: { s: 1.2, arm: 0.08, post: 0.03 },
    torp: { layout: 'v', off: [0.05, 0, 0] },
  };
}

function buildBarracuda(ctx, root, d, tex) {
  const { M } = ctx;
  const R = 0.085;
  add(root, mesh(cylZ(R, R, 0.78, 28), M.team, 'hull'), [0.01, 0, 0]);
  const nose = mesh(new THREE.SphereGeometry(1, 28, 10, 0, 2 * PI, 0, PI / 2).rotateX(-PI / 2), M.team, 'nose');
  nose.scale.set(R, R, 0.15);
  add(root, nose, [0.4, 0, 0]);
  add(root, mesh(cylZ(R, 0.03, 0.14, 28), M.anod, 'tail_cone'), [-0.45, 0, 0]);

  // tail fins in a + pattern
  const finGeo = ctx.geo('fin', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.38, 0.06); s.lineTo(-0.5, 0.03); s.lineTo(-0.535, 0.13); s.lineTo(-0.475, 0.13); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: false }).translate(0, 0, -0.0025).rotateY(PI / 2);
  });
  for (let k = 0; k < 4; k++) { const f = mesh(finGeo, M.teamDark); f.rotation.z = (k * PI) / 2; root.add(f); }

  // logo stripe: white band with the logo on each flank
  add(root, mesh(cylZ(R + 0.0008, R + 0.0008, 0.2, 28, true), M.white, 'stripe'), [0.05, 0, 0]);
  if (tex) {
    for (const side of [-1, 1]) {
      const l = logoPlane(ctx, tex, 0.17, side * PI / 2);
      l.position.set(side * (R + 0.0015), 0, -0.05);
      root.add(l);
    }
  }

  // main prop in a shroud at the stern; others are tunnel thrusters through the hull
  const props = addThrusters(ctx, root, d, (t, i) => (i === 0 ? { size: [0.055, 0.075] } : { size: [0.028, 0.05], tunnel: [R + 0.0005, R + 0.0005] }));
  return {
    props,
    sensors: { cam: [0.548, 0, 0], camR: 0.016, leds: [[0.525, 0.035, 0.02], [0.525, -0.035, 0.02]], down: [0.25, 0, 0.087] },
    grip: { s: 1, arm: 0.03, post: 0.05 },
    torp: { layout: 'h', off: [-0.05, 0, -0.03] },
  };
}

function buildKraken(ctx, root, d) {
  const { M } = ctx;
  const X = 0.37, Y = 0.3, Z = 0.22, r = 0.012;
  // 12 frame edges
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) rod(ctx, root, [-X, sy * Y, sz * Z], [X, sy * Y, sz * Z], r, M.alu);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(ctx, root, [sx * X, -Y, sz * Z], [sx * X, Y, sz * Z], r, M.alu);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) rod(ctx, root, [sx * X, sy * Y, -Z], [sx * X, sy * Y, Z], r, M.alu);
  // cross members
  for (const x of [-0.12, 0.12]) rod(ctx, root, [x, -Y, -Z], [x, Y, -Z], r, M.alu);
  for (const x of [-0.2, 0.2]) rod(ctx, root, [x, -Y, Z], [x, Y, Z], r, M.alu);
  for (const sy of [-1, 1]) {
    rod(ctx, root, [0, sy * Y, -Z], [0, sy * Y, Z], r, M.alu);
    rod(ctx, root, [0, sy * 0.187, -0.102], [0, sy * Y, -0.102], r * 0.8, M.alu);   // vertical thruster mounts
    for (const sx of [-1, 1]) rod(ctx, root, [sx * 0.265, sy * 0.189, 0], [sx * X, sy * Y, 0], r * 0.8, M.alu);
  }
  // two big hull tubes with end caps, clamped to the bottom cross members
  const hull = ctx.geo('hull', () => cylZ(0.07, 0.07, 0.44, 24));
  const cap = ctx.geo('hcap', () => cylZ(0.075, 0.075, 0.025, 24));
  for (const y of [-0.14, 0.14]) {
    add(root, mesh(hull, M.anod, 'hull_tube'), [0, y, 0.13]);
    add(root, mesh(cap, M.black), [0.225, y, 0.13]);
    add(root, mesh(cap, M.black), [-0.225, y, 0.13]);
  }
  // foam on top in two blocks (gap over the vertical thrusters)
  const foam = ctx.geo('foam', () => new THREE.BoxGeometry(0.58, 0.07, 0.24));
  for (const x of [-0.21, 0.21]) add(root, mesh(foam, M.foam, 'foam'), [x, 0, -0.195]);
  // front camera housing
  add(root, mesh(cylZ(0.03, 0.03, 0.08, 16), M.acrylic), [0.33, 0, 0]);
  return {
    props: addThrusters(ctx, root, d),
    sensors: { cam: [0.375, 0, 0], camR: 0.02, ledR: 0.015, leds: [[0.38, 0.22, -0.06], [0.38, -0.22, -0.06]], down: [0.25, 0, 0.235] },
    grip: { s: 1.5, arm: 0.05, post: 0.0 },
    torp: { layout: 'v', off: [0.03, 0, 0.02] },
  };
}

function buildManta(ctx, root, d) {
  const { M } = ctx;
  const sx = 0.42, sy = 0.09, sz = 0.31;
  const top = mesh(new THREE.SphereGeometry(1, 32, 8, 0, 2 * PI, 0, PI / 2), M.team, 'body_top');
  const bot = mesh(new THREE.SphereGeometry(1, 32, 5, 0, 2 * PI, PI / 2, PI / 2), M.teamDark, 'body_bottom');
  top.scale.set(sx, sy, sz); bot.scale.set(sx, sy * 0.8, sz);
  root.add(top, bot);
  // smoked canopy over the electronics bay
  const can = mesh(new THREE.SphereGeometry(1, 20, 8, 0, 2 * PI, 0, PI / 2), M.acrylic, 'canopy');
  can.scale.set(0.11, 0.05, 0.17); can.position.set(0, 0.06, -0.03); root.add(can);
  add(root, mesh(new THREE.BoxGeometry(0.08, 0.03, 0.14), M.chip), [0.03, 0, -0.07]);
  // tail fin
  const fin = new THREE.Shape();
  fin.moveTo(0, 0); fin.lineTo(0.12, 0); fin.lineTo(0.16, 0.09); fin.lineTo(0.12, 0.09); fin.closePath();
  const fm = mesh(new THREE.ExtrudeGeometry(fin, { depth: 0.006, bevelEnabled: false }).translate(0, 0, -0.003).rotateY(-PI / 2), M.teamDark, 'tail_fin');
  fm.position.set(0, 0.035, 0.14); root.add(fm);
  // wingtip fairings around the vertical thrusters
  const fair = ctx.geo('fair', () => new THREE.TorusGeometry(0.056, 0.008, 4, 16).rotateX(PI / 2));
  for (const t of d.thrusters) if (t.axis[2]) add(root, mesh(fair, M.teamDark), t.pos);
  return {
    props: addThrusters(ctx, root, d),
    sensors: { cam: [0.305, 0, 0.005], camR: 0.013, leds: [[0.285, 0.09, 0.005], [0.285, -0.09, 0.005]], down: [0.18, 0, 0.065] },
    grip: { s: 1.2, arm: 0.03, post: 0.04 },
    torp: { layout: 'h', off: [-0.05, 0, 0.04] },
  };
}

function buildMinnow(ctx, root, d) {
  const { M } = ctx;
  const body = mesh(new THREE.CapsuleGeometry(0.07, 0.2, 6, 18).rotateX(PI / 2), M.team, 'body');
  root.add(body);
  add(root, mesh(cylZ(0.0705, 0.0705, 0.05, 20, true), M.teamDark, 'band'), [-0.03, 0, 0]);
  // big cute camera eye
  const eye = new THREE.Group(); eye.name = 'eye';
  eye.add(mesh(cylZ(0.046, 0.046, 0.014, 24), M.white));
  const dome = mesh(new THREE.SphereGeometry(0.04, 20, 8, 0, 2 * PI, 0, PI / 2).rotateX(-PI / 2), M.acrylic);
  dome.position.z = -0.007; eye.add(dome);
  const glint = mesh(new THREE.SphereGeometry(0.005, 8, 6), M.led);
  glint.position.set(0.009, 0.01, -0.03); eye.add(glint);
  add(root, eye, [0.15, 0, 0.02]);
  // little dorsal fin
  const fin = new THREE.Shape();
  fin.moveTo(0, 0); fin.lineTo(0.08, 0); fin.lineTo(0.1, 0.045); fin.lineTo(0.07, 0.045); fin.closePath();
  const fm = mesh(new THREE.ExtrudeGeometry(fin, { depth: 0.004, bevelEnabled: false }).translate(0, 0, -0.002).rotateY(-PI / 2), M.teamDark, 'tail_fin');
  fm.position.set(0, 0.055, 0.08); root.add(fm);
  const props = addThrusters(ctx, root, d, (t) => {
    if (t.name === 'Lateral') return { size: [0.022, 0.03], tunnel: [0.0705, 0.0705] };
    if (t.name === 'Vert front') return { size: [0.022, 0.03], tunnel: [0.037, 0.097] };
    return {};
  });
  return {
    props,
    sensors: { cam: [0.172, 0, 0.02], camR: 0.022, ledR: 0.007, leds: [[0.13, 0.055, -0.03], [0.13, -0.055, -0.03]], down: [0.06, 0, 0.072] },
    grip: { s: 0.8, arm: 0.02, post: 0.02 },
    torp: { layout: 'h', off: [-0.05, 0, -0.03] },
  };
}

const BUILDERS = { duburi: buildDuburi, barracuda: buildBarracuda, kraken: buildKraken, manta: buildManta, minnow: buildMinnow };

// Merge every mesh that never moves relative to the hull into one mesh per
// material: ~100 draw calls per bot become ~10, which matters with four bots
// in four split-screen views.
export function mergeStatic(group, dynamic) {
  const dyn = new Set(dynamic);
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const victims = [];
  group.traverse((o) => {
    if (o === group || !o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
    for (let p = o; p && p !== group; p = p.parent) if (dyn.has(p)) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const key = o.material.uuid + '|' + o.renderOrder;
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, order: o.renderOrder, geos: [] });
    buckets.get(key).geos.push(g);
    victims.push(o);
  });
  for (const o of victims) {
    // keep children that are dynamic: re-parent them to the group with their world transform
    for (const c of [...o.children]) { group.attach(c); }
    o.parent.remove(o);
  }
  // drop empty static containers
  const empties = [];
  group.traverse((o) => { if (o !== group && !o.isMesh && !o.isLight && !o.children.length && !dyn.has(o) && o.type === 'Group') empties.push(o); });
  for (const e of empties) e.parent && e.parent.remove(e);
  for (const { mat, order, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.renderOrder = order;
    m.name = 'static';
    group.add(m);
  }
}

/**
 * Build a vehicle model. Returns { group, update(dt, veh, state), parts }.
 * state = { gripClosed, holding, markers: 0..2, torpedoes: 0..2 }
 */
export function createBotMesh(design, color, { logoTexture } = {}) {
  color = color ?? design.color;
  const ctx = makeCtx(color);
  const group = new THREE.Group();
  group.name = `bot_${design.id}`;
  const build = BUILDERS[design.id] ?? buildDuburi;
  const spec = build(ctx, group, design, logoTexture);

  addSensors(ctx, group, spec.sensors);
  const grip = addGripper(ctx, group, design.gripper, spec.grip);
  const markers = addMarkers(ctx, group, design.marker, color);
  const torpedoes = addTorpedoes(ctx, group, design.torpedo, color, spec.torp);
  const props = spec.props;

  const dynamic = [...props, ...grip.fingers, ...markers, ...torpedoes];
  mergeStatic(group, dynamic);
  for (const d of dynamic) mergeStatic(d, []);
  group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });

  let open = 1;   // smoothed claw opening 0..1
  const update = (dt, veh, state) => {
    const th = veh && veh.th;
    if (th) for (let i = 0; i < props.length; i++) if (th[i]) props[i].rotation.z += th[i].n * 60 * dt;
    if (state) {
      const holding = !!state.holding;
      const target = holding || state.gripClosed ? 0 : 1;
      open += (target - open) * Math.min(1, dt * 10);
      const a = (holding ? 0.22 : 0.02) + 0.5 * open;
      grip.fingers[0].rotation.y = a;     // left finger swings to -X when opening
      grip.fingers[1].rotation.y = -a;
      const nm = state.markers ?? 2, nt = state.torpedoes ?? 2;
      for (let i = 0; i < markers.length; i++) markers[i].visible = i < nm;
      for (let i = 0; i < torpedoes.length; i++) torpedoes[i].visible = i < nt;
    }
  };
  update(0, null, { gripClosed: false, holding: false, markers: 2, torpedoes: 2 });

  return {
    group,
    update,
    parts: { props, gripper: grip.group, fingers: grip.fingers, gripPoint: grip.tip, markers, torpedoes },
  };
}

// ---------------------------------------------------------------- items

const SHARED = new WeakSet();
const share = (x) => { SHARED.add(x); return x; };
let IG = null;                       // shared item geometries
const IM = new Map();                // shared item materials by key

function itemGeos() {
  if (IG) return IG;
  const V = (x, y) => new THREE.Vector2(x, y);
  IG = {
    marker: new THREE.BoxGeometry(0.051, 0.152, 0.051),
    band: new THREE.BoxGeometry(0.0535, 0.03, 0.0535),
    torp: new THREE.LatheGeometry([
      V(0, -0.076), V(0.011, -0.076), V(0.019, -0.062), V(0.025, -0.04), V(0.025, 0.04),
      V(0.023, 0.056), V(0.017, 0.068), V(0.008, 0.075), V(0, 0.076),
    ], 16).rotateX(-PI / 2),                                  // nose -> -Z
    torpBand: cylZ(0.0255, 0.0255, 0.012, 16, true),
    finA: new THREE.BoxGeometry(0.075, 0.002, 0.026),
    finB: new THREE.BoxGeometry(0.002, 0.075, 0.026),
    cup: new THREE.LatheGeometry([
      V(0, -0.045), V(0.032, -0.045), V(0.0455, 0.044), V(0.044, 0.046), V(0.0425, 0.044),
      V(0.0295, -0.0425), V(0, -0.0425),
    ], 28),
    bowl: new THREE.SphereGeometry(1, 20, 6, 0, 2 * PI, PI / 2, PI / 2),
    handle: new THREE.BoxGeometry(0.018, 0.005, 0.22),
    neck: new THREE.BoxGeometry(0.01, 0.005, 0.04),
  };
  for (const g of Object.values(IG)) share(g);
  return IG;
}

function itemMat(key, make) {
  let m = IM.get(key);
  if (!m) { m = share(make()); IM.set(key, m); }
  return m;
}

/** Item mesh for 'marker' | 'torpedo' | 'cup' | 'spoon', origin at its centre. */
export function createItemMesh(kind, color = '#ffb547') {
  const G = itemGeos();
  const g = new THREE.Group();
  g.name = `item_${kind}`;
  const team = () => itemMat(`team${color}`, () => std(new THREE.Color(color), 0.1, 0.45));
  const white = itemMat('white', () => std(0xf4f4f4, 0, 0.5));
  if (kind === 'marker') {
    g.add(new THREE.Mesh(G.marker, team()), new THREE.Mesh(G.band, white));
  } else if (kind === 'torpedo') {
    const band = new THREE.Mesh(G.torpBand, white); band.position.z = -0.02;
    const fa = new THREE.Mesh(G.finA, white), fb = new THREE.Mesh(G.finB, white);
    fa.position.z = fb.position.z = 0.058;
    g.add(new THREE.Mesh(G.torp, team()), band, fa, fb);
  } else if (kind === 'cup') {
    g.add(new THREE.Mesh(G.cup, itemMat('cup', () => std(0xd62828, 0, 0.4, { side: THREE.DoubleSide }))));
  } else if (kind === 'spoon') {
    const silver = itemMat('silver', () => std(0xd5d9de, 0.85, 0.25, { side: THREE.DoubleSide }));
    const bowl = new THREE.Mesh(G.bowl, silver);
    bowl.scale.set(0.035, 0.014, 0.05); bowl.position.z = -0.1;
    const handle = new THREE.Mesh(G.handle, silver); handle.position.set(0, 0.004, 0.04);
    const neck = new THREE.Mesh(G.neck, silver); neck.position.set(0, 0.002, -0.06); neck.rotation.x = -0.1;
    g.add(bowl, handle, neck);
  }
  g.traverse((o) => { o.castShadow = false; });
  return g;
}

/** Dispose geometries/materials under obj (skips shared item resources; never disposes textures). */
export function disposeObject(obj) {
  const done = new Set();
  obj.traverse((o) => {
    if (o.geometry && !SHARED.has(o.geometry) && !done.has(o.geometry)) { done.add(o.geometry); o.geometry.dispose(); }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (!SHARED.has(m) && !done.has(m)) { done.add(m); m.dispose(); }
  });
}
