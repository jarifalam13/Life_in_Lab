// three.js meshes for the competition course elements (gate, path markers,
// slalom, bin, torpedo board, octagon with table / baskets, pingers, dock).
// World mapping: NED (x north, y east, z down) -> three (east, up, south).

import * as THREE from 'three';
import { animalTexture, IMAGES } from './art.js';
import { mergeStatic } from './bots3d.js';

export const ned = (x, y, z) => new THREE.Vector3(y, -z, -x);
export const nedYaw = (h) => -h; // NED heading -> rotation.y of an object built facing -Z

const mats = {};
function mat(key, make) { return mats[key] || (mats[key] = make()); }
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...extra });

function box(w, h, d, m) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); return o; }
function cyl(r, h, m, seg = 12) { return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); }

// a vertical line from y0 to y1 (mooring rope)
function rope(x, z, y0, y1) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y0, z), new THREE.Vector3(x, y1, z)]);
  return new THREE.Line(g, mat('rope', () => new THREE.LineBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.7 })));
}

function imagePlane(animal, size) {
  const m = new THREE.MeshStandardMaterial({ map: animalTexture(animal), roughness: 0.8, side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
}

// the board print (shark-top or sawfish-top version from the handbook) with
// the two 4 in openings cut out and their 0.5 in red borders drawn
function boardTexture(board) {
  const N = 512, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const S = board.size;
  const toPx = (u, v) => [(u / S + 0.5) * N, (0.5 - v / S) * N];
  const shape = (o, grow) => {
    const [cx, cy] = toPx(o.u, o.v), r = ((o.r + grow) / S) * N;
    g.beginPath();
    if (o.shape === 'square') g.rect(cx - r, cy - r, 2 * r, 2 * r); else g.arc(cx, cy, r, 0, Math.PI * 2);
  };
  const paint = (img) => {
    g.globalCompositeOperation = 'source-over';
    if (img) g.drawImage(img, 0, 0, N, N); else { g.fillStyle = '#2f8fc0'; g.fillRect(0, 0, N, N); }
    g.fillStyle = '#e31b1b';
    for (const o of board.openings) { shape(o, 0.0127); g.fill(); }
    g.globalCompositeOperation = 'destination-out';
    for (const o of board.openings) { shape(o, 0); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    g.lineWidth = 6; g.strokeStyle = '#1b2a3a'; g.strokeRect(3, 3, N - 6, N - 6);
    t.needsUpdate = true;
  };
  paint(null);
  const img = new Image();
  img.onload = () => paint(img);
  img.src = board.sharkTop ? IMAGES.boardSharkTop : IMAGES.boardSawfishTop;
  return t;
}

function textSprite(text, { color = '#fff', bg = 'rgba(0,0,0,0.55)', w = 256, h = 64, font = 'bold 34px Arial' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createCourse(course, { logoTexture } = {}) {
  const root = new THREE.Group();
  root.name = 'course';
  const floorY = -course.floor;
  const pingerLights = [];

  // ---------------- gate ----------------
  {
    const G = course.gate;
    const g = new THREE.Group();
    g.position.copy(ned(G.pos[0], G.pos[1], 0));
    g.rotation.y = nedYaw(G.heading);
    const black = mat('black', () => std(0x151515, { roughness: 0.7 }));
    const red = mat('red', () => std(0xd8262c, { roughness: 0.55 }));
    const W = G.width, bar = 0.076;
    const yTop = -(G.topDepth - 0.04);
    // top bar: black on the left, red on the right ("red, right, above")
    const left = box(W / 2 + bar, bar, bar, black); left.position.set(-W / 4, yTop, 0); g.add(left);
    const right = box(W / 2 + bar, bar, bar, red); right.position.set(W / 4, yTop, 0); g.add(right);
    const legH = G.legDepth[1] - G.legDepth[0];
    for (const s of [-1, 1]) {
      const legU = box(bar, legH / 2, bar, s > 0 ? red : black); // figure: left black over red, right red over black legU.position.set((s * W) / 2, -G.legDepth[0] - legH / 4, 0); g.add(legU);
      const legL = box(bar, legH / 2, bar, s > 0 ? black : red); legL.position.set((s * W) / 2, -G.legDepth[0] - (3 * legH) / 4, 0); g.add(legL);
      g.add(rope((s * W) / 2, 0, -G.legDepth[1], floorY));
      // floats that hold the gate up
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), mat('float', () => std(0xffe14d)));
      fl.position.set((s * W) / 2, -0.12, 0); g.add(fl);
      g.add(rope((s * W) / 2, 0, -0.12, yTop));
    }
    const div = box(0.051, G.dividerDepth[1] - G.dividerDepth[0], 0.012, red);
    div.position.set(0, -(G.dividerDepth[0] + G.dividerDepth[1]) / 2, 0); g.add(div);
    // reef shark on one side, sawfish on the other
    const sideAnimal = (s) => (s === G.sharkSide ? 'shark' : 'sawfish');
    for (const s of [-1, 1]) {
      const im = imagePlane(sideAnimal(s), 0.305);
      im.position.set(s * 0.9, yTop - bar / 2 - 0.17, 0.0);
      g.add(im);
    }
    root.add(g);
  }

  // ---------------- path markers ----------------
  for (const p of course.paths) {
    const m = box(0.152, 0.02, 1.22, mat('orange', () => std(0xff7a00, { emissive: 0x401a00, roughness: 0.5 })));
    m.position.copy(ned(p.pos[0], p.pos[1], course.floor - 0.012));
    m.rotation.y = nedYaw(p.heading);
    root.add(m);
    // arrow tip so the direction reads on camera
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 3), m.material);
    tip.rotation.x = -Math.PI / 2;
    const tg = new THREE.Group(); tg.add(tip); tip.position.set(0, 0, -0.72);
    tg.position.copy(m.position); tg.rotation.y = m.rotation.y; tg.scale.set(1, 0.15, 1);
    root.add(tg);
  }

  // ---------------- slalom ----------------
  {
    const S = course.slalom;
    const white = mat('pvcWhite', () => std(0xf2f2f2, { roughness: 0.4 }));
    const red = mat('pvcRed', () => std(0xd8262c, { roughness: 0.45 }));
    const h = S.band[1] - S.band[0];
    const geo = new THREE.CylinderGeometry(0.0335, 0.0335, h, 12);
    for (const set of S.sets) for (const pp of set.pipes) {
      const m = new THREE.Mesh(geo, pp.color === 'red' ? red : white);
      const c = ned(pp.p[0], pp.p[1], (S.band[0] + S.band[1]) / 2);
      m.position.copy(c);
      root.add(m);
      root.add(rope(c.x, c.z, -S.band[1], floorY));
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat('float', () => std(0xffe14d)));
      cap.position.set(c.x, -S.band[0] + 0.05, c.z); root.add(cap);
    }
  }

  // ---------------- bin ----------------
  {
    const B = course.bin;
    const g = new THREE.Group();
    g.position.copy(ned(B.pos[0], B.pos[1], course.floor));
    g.rotation.y = nedYaw(B.heading);
    const L = B.size[0], W = B.size[1], H = B.height, PL = B.plate[0], PW = B.plate[1], t = 0.012;
    const plate = mat('binPlate', () => std(0xeeeeee, { roughness: 0.75 }));
    const dark = mat('binDark', () => std(0x161616, { roughness: 0.9 }));
    // top plate around the opening (four strips)
    const endL = (PL - L) / 2, sideW = (PW - W) / 2;
    for (const s of [-1, 1]) {
      const e = box(PW, t, endL, plate); e.position.set(0, H, s * (L / 2 + endL / 2)); g.add(e);
      const sd = box(sideW, t, L, plate); sd.position.set(s * (W / 2 + sideW / 2), H, 0); g.add(sd);
      // the black box under the opening
      const a = box(W, H, t, dark); a.position.set(0, H / 2, (s * L) / 2); g.add(a);
      const b = box(t, H, L, dark); b.position.set((s * W) / 2, H / 2, 0); g.add(b);
    }
    // legs under the plate corners
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = box(0.03, H, 0.03, plate); l.position.set(sx * (PW / 2 - 0.03), H / 2, sz * (PL / 2 - 0.03)); g.add(l); }
    // halves: halves[0] is the near half (toward the approach = +Z local)
    B.halves.forEach((animal, i) => {
      const m = new THREE.MeshStandardMaterial({ map: animalTexture(animal, 'bin'), roughness: 0.85 });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.01, L / 2 - 0.01), m);
      pl.rotation.x = -Math.PI / 2;
      pl.position.set(0, 0.006, i === 0 ? L / 4 : -L / 4);
      g.add(pl);
    });
    const mid = box(W, 0.004, 0.012, dark); mid.position.set(0, 0.008, 0); g.add(mid);
    root.add(g);
  }

  // ---------------- torpedo board ----------------
  {
    const Bd = course.board;
    const g = new THREE.Group();
    g.position.copy(ned(Bd.pos[0], Bd.pos[1], Bd.depth));
    g.rotation.y = nedYaw(Bd.heading);
    const tex = boardTexture(Bd);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(Bd.size, Bd.size), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }));
    front.rotation.y = Math.PI; // face along the board normal (local -Z)
    g.add(front);
    const frame = mat('frame', () => std(0xdddddd, { roughness: 0.5 }));
    const e = Bd.size / 2 + 0.02;
    for (const s of [-1, 1]) {
      const a = box(Bd.size + 0.08, 0.04, 0.04, frame); a.position.set(0, s * e, 0.02); g.add(a);
      const b = box(0.04, Bd.size + 0.08, 0.04, frame); b.position.set(s * e, 0, 0.02); g.add(b);
    }
    root.add(g);
    // stand
    const pole = cyl(0.03, course.floor - Bd.depth - Bd.size / 2, frame);
    const pp = ned(Bd.pos[0] - Bd.dir[0] * 0.08, Bd.pos[1] - Bd.dir[1] * 0.08, (course.floor + Bd.depth + Bd.size / 2) / 2);
    pole.position.copy(pp); root.add(pole);
    // "far" bars on the floor
    const bars = new THREE.Group();
    bars.position.copy(ned(Bd.pos[0] + Bd.dir[0] * Bd.farDistance, Bd.pos[1] + Bd.dir[1] * Bd.farDistance, course.floor - 0.01));
    bars.rotation.y = nedYaw(Bd.heading);
    for (const off of [-0.08, 0.08]) { const b = box(0.9, 0.02, 0.05, mat('barWhite', () => std(0xffffff, { emissive: 0x333333 }))); b.position.z = off; bars.add(b); }
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), new THREE.MeshBasicMaterial({ map: textSprite('FAR', { bg: 'rgba(0,0,0,0)', font: 'bold 48px Arial' }), transparent: true }));
    lbl.rotation.x = -Math.PI / 2; lbl.position.set(0, 0.012, 0.25); bars.add(lbl);
    root.add(bars);
  }

  // ---------------- octagon ----------------
  {
    const O = course.octagon;
    const g = new THREE.Group();
    g.position.copy(ned(O.pos[0], O.pos[1], 0));
    const pvc = mat('pvcWhite', () => std(0xf2f2f2, { roughness: 0.4 }));
    const noodle = mat('noodle', () => std(0xff8a1f, { roughness: 0.8 }));
    const R = O.radius;
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2 + Math.PI / 8, a1 = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8;
      const p0 = new THREE.Vector3(Math.cos(a0) * R, 0.03, Math.sin(a0) * R), p1 = new THREE.Vector3(Math.cos(a1) * R, 0.03, Math.sin(a1) * R);
      const len = p0.distanceTo(p1);
      for (const [r, m] of [[0.024, pvc], [0.06, noodle]]) {
        const s = cyl(r, len * (m === noodle ? 0.7 : 1), m, 10);
        s.position.copy(p0).add(p1).multiplyScalar(0.5);
        s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
        g.add(s);
      }
    }
    // images hanging inside, facing the centre
    for (const im of O.images) {
      const pl = imagePlane(im.animal, 0.305);
      const dx = Math.cos(im.angle), dy = Math.sin(im.angle); // NED direction from the centre
      pl.position.set(dy * (R - 0.08), -0.19, -dx * (R - 0.08));
      pl.lookAt(new THREE.Vector3(0, -0.19, 0).add(g.position).sub(g.position));
      g.add(pl);
      g.add(rope(dy * (R - 0.08), -dx * (R - 0.08), 0.02, -0.03));
    }
    root.add(g);
    // table, baskets
    const tg = new THREE.Group();
    tg.position.copy(ned(O.pos[0], O.pos[1], O.tableTop));
    const top = box(O.tableHalf * 2, 0.03, O.tableHalf * 2, mat('table', () => std(0xbfc6cc, { roughness: 0.5 })));
    top.position.y = -0.015; tg.add(top);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const l = cyl(0.024, course.floor - O.tableTop, pvc, 8); l.position.set(sx * 0.28, -(course.floor - O.tableTop) / 2, sy * 0.28); tg.add(l); }
    root.add(tg);
    const net = mat('basket', () => new THREE.MeshStandardMaterial({ color: 0x3fa34d, roughness: 0.7, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    for (const bk of O.baskets) {
      const bg = new THREE.Group();
      bg.position.copy(ned(bk.c[0], bk.c[1], bk.depthTop + 0.1));
      const hx = bk.h[1], hz = bk.h[0]; // three X = east (NED y), Z = south (NED x)
      const bottom = box(hx * 2, 0.01, hz * 2, net); bg.add(bottom);
      for (const s of [-1, 1]) {
        const a = box(hx * 2, 0.1, 0.01, net); a.position.set(0, 0.05, s * hz); bg.add(a);
        const b = box(0.01, 0.1, hz * 2, net); b.position.set(s * hx, 0.05, 0); bg.add(b);
      }
      const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.11), new THREE.MeshBasicMaterial({ map: textSprite(bk.item.toUpperCase(), { bg: '#1d4f2a', font: 'bold 40px Arial' }), side: THREE.DoubleSide }));
      icon.position.set(0, 0.16, 0); icon.rotation.y = Math.PI / 2;
      bg.add(icon);
      root.add(bg);
    }
  }

  // ---------------- pingers ----------------
  for (const pg of course.pingers) {
    const body = cyl(0.04, 0.22, mat('pinger', () => std(0x333a40, { metalness: 0.6, roughness: 0.3 })), 10);
    body.position.copy(ned(pg.pos[0], pg.pos[1], course.floor - 0.11));
    root.add(body);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0x40ff90 }));
    led.position.copy(body.position).add(new THREE.Vector3(0, 0.13, 0));
    root.add(led);
    pingerLights.push({ led, period: pg.period });
  }

  // ---------------- start dock ----------------
  {
    const D = course.dock;
    const g = new THREE.Group();
    g.position.copy(ned(D.pos[0] - 2.2, D.pos[1], 0));
    const deck = box(4.5, 0.18, 1.2, mat('dock', () => std(0x8a6a48, { roughness: 0.9 })));
    deck.position.y = 0.05; g.add(deck);
    for (const s of [-1, 1]) { const fl = cyl(0.18, 4.4, mat('dockFloat', () => std(0x2a3a4a)), 10); fl.rotation.z = Math.PI / 2; fl.position.set(0, -0.06, s * 0.4); g.add(fl); }
    if (logoTexture) {
      const img = logoTexture.image;
      const asp = img && img.width ? img.width / img.height : 2.6;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2 * asp * 0.6, 0.72), new THREE.MeshBasicMaterial({ map: logoTexture, side: THREE.DoubleSide }));
      sign.position.set(0, 1.05, 0); sign.rotation.y = Math.PI; // faces north (toward the course)
      g.add(sign);
      const post = cyl(0.04, 0.8, mat('frame', () => std(0xdddddd)), 8); post.position.set(0, 0.5, 0); g.add(post);
    }
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: textSprite('START', { bg: '#0d3b66', font: 'bold 44px Arial' }), side: THREE.DoubleSide }));
    lbl.position.set(0, 0.16, -0.61); lbl.rotation.y = Math.PI; g.add(lbl);
    root.add(g);
    // start zone ring on the surface
    const ring = new THREE.Mesh(new THREE.RingGeometry(D.radius - 0.04, D.radius + 0.04, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(ned(D.pos[0], D.pos[1], -0.01));
    root.add(ring);
  }

  mergeStatic(root, pingerLights.map((p) => p.led));
  return {
    group: root,
    update(time) {
      for (const p of pingerLights) {
        const ph = (time % p.period) / p.period;
        p.led.visible = ph < 0.08;
      }
    },
  };
}
