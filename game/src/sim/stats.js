// Numbers for the garage screen, worked out from each design's physics (not
// typed in): top speed where full thrust meets the hull drag, turn rate,
// controllable axes from the thruster allocation, net buoyancy per water.

import { Environment } from '../../../src/physics/environment.js';
import { RNG } from '../../../src/core/rng.js';
import { waterDensity } from '../../../src/hydro/water.js';
import { Vehicle } from './vehicle.js';
import { environmentConfig, SCENARIOS } from './scenarios.js';

// steady speed where F = lin v + quad v^2
const terminal = (F, lin, quad) => (quad > 1e-9 ? (-lin + Math.sqrt(lin * lin + 4 * quad * F)) / (2 * quad) : F / Math.max(lin, 1e-9));

const cache = {};
export function botStats(design) {
  if (cache[design.id]) return cache[design.id];
  const env = new Environment(environmentConfig('pool'), new RNG(1));
  const v = new Vehicle(design, env);
  const d = design;
  const axes = ['Surge', 'Sway', 'Heave', 'Roll', 'Pitch', 'Yaw'];
  const dof = axes.filter((_, k) => v.wmax[k] > (k < 3 ? 2 : 0.3));
  const st = {
    surge: terminal(v.wmax[0], d.dampLin[0], d.dampQuad[0]),
    sway: terminal(v.wmax[1], d.dampLin[1], d.dampQuad[1]),
    heave: terminal(v.wmax[2], d.dampLin[2], d.dampQuad[2]),
    yawRate: (terminal(v.wmax[5], d.dampLin[5], d.dampQuad[5]) * 180) / Math.PI,
    rollRate: v.wmax[3] > 0.3 ? (terminal(v.wmax[3], d.dampLin[3], d.dampQuad[3]) * 180) / Math.PI : 0,
    righting: d.zB * d.mass * env.g, // N m per rad of heel
    thrust: v.wmax[0],
    mass: d.mass,
    thrusters: d.thrusters.length,
    dof,
    buoyancy: Object.fromEntries(Object.values(SCENARIOS).map((s) => [s.id, waterDensity(s.env.temperature, s.env.salinity) * env.g * v.volume - d.mass * env.g])),
  };
  cache[design.id] = st;
  return st;
}
