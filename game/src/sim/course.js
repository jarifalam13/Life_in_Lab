// The RoboSub 2025 "Protect the Deep" course, laid out in the world NED frame
// (x north, y east, z down, origin at the still surface in the pool centre).
// Dimensions follow the team handbook (section 3.2); positions are chosen so
// no three elements are on a line and the path markers point at the next task.

const rot2 = (h) => [Math.cos(h), Math.sin(h)];
const add2 = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s];
const perp = (d) => [-d[1], d[0]]; // 90 deg to the right of d (NED, looking down)

export const ARENA = { length: 50, width: 25, depth: 4.8 };

export function buildCourse(rng = Math.random) {
  const floor = ARENA.depth;
  const course = { floor, elements: [], obstacles: [] };

  // ---- randomised per run (like the judges' set-up) ----
  const sharkSide = rng() < 0.5 ? -1 : 1; // gate side (-1 = left / west, +1 = right / east) with the reef shark
  const boardSharkTop = rng() < 0.5; // torpedo board version
  const binSharkNear = rng() < 0.5; // which bin half is the shark
  course.random = { sharkSide, boardSharkTop, binSharkNear };

  // ---- start dock ----
  const dock = { pos: [-21, -3], radius: 3.0 };
  course.dock = dock;

  // ---- Task 1: gate (3 m x 1.5 m, floating just below the surface) ----
  const gate = { pos: [-15.5, -1.2], heading: 0, width: 3.048, legDepth: [0.45, 1.95], topDepth: 0.45, barH: 0.076, dividerDepth: [0.45, 1.06], sharkSide };
  gate.dir = rot2(gate.heading);
  gate.right = perp(gate.dir);
  course.gate = gate;
  for (const s of [-1, 1]) {
    const p = add2(gate.pos, gate.right, (s * gate.width) / 2);
    course.obstacles.push({ type: 'cyl', tag: 'gateLeg', p, r: 0.06, z0: gate.legDepth[0], z1: gate.legDepth[1] });
  }
  course.obstacles.push({ type: 'box', tag: 'gateBar', c: [gate.pos[0], gate.pos[1], gate.topDepth - 0.04], h: [0.05, gate.width / 2 + 0.06, 0.045], yaw: gate.heading });
  course.obstacles.push({ type: 'box', tag: 'gateDivider', c: [gate.pos[0], gate.pos[1], (gate.dividerDepth[0] + gate.dividerDepth[1]) / 2], h: [0.012, 0.026, (gate.dividerDepth[1] - gate.dividerDepth[0]) / 2], yaw: gate.heading });

  // ---- path 1 (orange, on the floor) right after the gate, pointing to the slalom ----
  const slalom = { pos: [-7.4, 2.6], sets: [] };
  const p1 = add2(gate.pos, gate.dir, 2.4);
  const toSlalom = Math.atan2(slalom.pos[1] - p1[1], slalom.pos[0] - p1[0]);
  course.paths = [{ pos: p1, heading: toSlalom }];

  // ---- Task 2: slalom, 3 sets of white / red / white pipes ----
  slalom.heading = toSlalom;
  slalom.dir = rot2(toSlalom);
  slalom.right = perp(slalom.dir);
  slalom.band = [floor - 1.35, floor - 0.45]; // pipes 0.9 m tall, moored above the floor
  for (let k = -1; k <= 1; k++) {
    const c = add2(add2(slalom.pos, slalom.dir, k * 2.6), slalom.right, k === 0 ? 0.35 : -0.2 * k);
    const set = { pos: c, pipes: [] };
    for (const [lat, color] of [[-1.524, 'white'], [0, 'red'], [1.524, 'white']]) {
      const p = add2(c, slalom.right, lat);
      set.pipes.push({ p, color });
      course.obstacles.push({ type: 'cyl', tag: color === 'red' ? 'slalomRed' : 'slalomWhite', p, r: 0.045, z0: slalom.band[0], z1: slalom.band[1] });
    }
    slalom.sets.push(set);
  }
  course.slalom = slalom;

  // ---- path 2 after the slalom, pointing at the bin ----
  // 36 x 24 in top plate with a 24 x 12 in, 6 in deep opening (handbook figure)
  const bin = { pos: [0.6, 7.2], size: [0.61, 0.305], plate: [0.914, 0.61], height: 0.152, sharkNear: binSharkNear };
  const p2 = add2(slalom.sets[2].pos, slalom.dir, 2.2);
  const toBin = Math.atan2(bin.pos[1] - p2[1], bin.pos[0] - p2[0]);
  course.paths.push({ pos: p2, heading: toBin });

  // ---- Task 3: bin on the floor, long axis along the approach ----
  bin.heading = toBin;
  bin.dir = rot2(toBin);
  bin.right = perp(bin.dir);
  // the shark half is the near half (toward the approach) or the far half
  bin.halves = binSharkNear ? ['shark', 'sawfish'] : ['sawfish', 'shark'];
  course.bin = bin;
  course.obstacles.push({ type: 'box', tag: 'bin', c: [bin.pos[0], bin.pos[1], floor - bin.height / 2], h: [bin.plate[0] / 2, bin.plate[1] / 2, bin.height / 2], yaw: bin.heading });

  // ---- Task 4: torpedo board, 0.6 m square, facing back toward the bin ----
  const board = { pos: [6.8, -4.2], depth: 2.3, size: 0.61, sharkTop: boardSharkTop };
  board.heading = Math.atan2(bin.pos[1] - board.pos[1], bin.pos[0] - board.pos[0]); // normal points at the approach side
  board.dir = rot2(board.heading);
  board.right = perp(board.dir);
  // openings in board coordinates (u to the viewer's right, v up), as seen from the front
  // two 4 in (102 mm) openings with a 0.5 in red border, one beside each animal
  board.openings = [
    { u: -0.12, v: 0.07, r: 0.051, shape: 'circle', animal: boardSharkTop ? 'shark' : 'sawfish', label: 'upper' },
    { u: 0.14, v: -0.07, r: 0.051, shape: 'square', animal: boardSharkTop ? 'sawfish' : 'shark', label: 'lower' },
  ];
  board.farDistance = 2.0; // horizontal bars on the floor mark "far"
  course.board = board;
  course.obstacles.push({ type: 'board', tag: 'board', board });
  course.obstacles.push({ type: 'cyl', tag: 'boardPole', p: add2(board.pos, board.dir, -0.08), r: 0.04, z0: board.depth + board.size / 2, z1: floor });

  // ---- Task 5: octagon (2.7 m) floating on the surface, table + trash below ----
  const oct = { pos: [13.6, 3.4], radius: 1.37, tableTop: floor - 0.75, tableHalf: 0.305 };
  oct.heading = 0;
  // images hang inside facing inward on two opposite sides
  oct.images = [
    { animal: 'shark', angle: Math.PI / 2 }, // on the east side, faced from inside looking east
    { animal: 'sawfish', angle: -Math.PI / 2 },
  ];
  // baskets along two opposite table edges: north edge for the cup, south edge for the spoon
  oct.baskets = [
    { item: 'cup', c: [oct.pos[0] + oct.tableHalf + 0.13, oct.pos[1]], h: [0.12, 0.3], depthTop: oct.tableTop - 0.1 },
    { item: 'spoon', c: [oct.pos[0] - oct.tableHalf - 0.13, oct.pos[1]], h: [0.12, 0.3], depthTop: oct.tableTop - 0.1 },
  ];
  oct.trash = [
    { kind: 'cup', pos: [oct.pos[0] + 0.12, oct.pos[1] - 0.14, oct.tableTop - 0.05] },
    { kind: 'spoon', pos: [oct.pos[0] - 0.12, oct.pos[1] + 0.14, oct.tableTop - 0.015] },
  ];
  course.octagon = oct;
  course.obstacles.push({ type: 'box', tag: 'table', c: [oct.pos[0], oct.pos[1], oct.tableTop + 0.02], h: [oct.tableHalf, oct.tableHalf, 0.02], yaw: 0 });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) course.obstacles.push({ type: 'cyl', tag: 'table', p: [oct.pos[0] + sx * 0.28, oct.pos[1] + sy * 0.28], r: 0.025, z0: oct.tableTop, z1: floor });
  course.obstacles.push({ type: 'ring', tag: 'octagon', p: oct.pos, R: oct.radius, r: 0.05, z: 0.0 });

  // ---- pingers: octagon (floor centre) and the torpedo task (community-poll task) ----
  course.pingers = [
    { id: 'octagon', pos: [oct.pos[0], oct.pos[1], floor - 0.05], freq: 30, period: 2.0 },
    { id: 'torpedo', pos: [board.pos[0], board.pos[1], floor - 0.05], freq: 25, period: 1.5 },
  ];
  // task buffers (3 m spheres around each task, handbook 4.2)
  course.tasks = [
    { id: 'gate', name: 'Collecting Data (Gate)', pos: [gate.pos[0], gate.pos[1], 1.2] },
    { id: 'slalom', name: 'Navigate the Channel', pos: [slalom.pos[0], slalom.pos[1], 3.9] },
    { id: 'bin', name: 'Drop a BRUVS (Bin)', pos: [bin.pos[0], bin.pos[1], floor - 0.3] },
    { id: 'torpedo', name: 'Tagging (Torpedoes)', pos: [board.pos[0], board.pos[1], board.depth] },
    { id: 'octagon', name: 'Ocean Cleanup (Octagon)', pos: [oct.pos[0], oct.pos[1], 0.5] },
    { id: 'home', name: 'Return Home', pos: [gate.pos[0], gate.pos[1], 1.2] },
  ];
  return course;
}

// world point -> board coordinates (u right as seen from the front, v up, n toward the viewer)
export function boardLocal(board, p) {
  const dx = p[0] - board.pos[0], dy = p[1] - board.pos[1];
  const n = dx * board.dir[0] + dy * board.dir[1];
  // seen from the front (looking along -dir) the viewer's right is -right
  const u = -(dx * board.right[0] + dy * board.right[1]);
  const v = board.depth - p[2];
  return { u, v, n };
}
