// Water bodies the course can be set in. Every scenario is a real
// configuration of the simulator's Environment (src/physics/environment.js):
// temperature and salinity go through EOS-80 for the density, so the same
// vehicle is more buoyant in cold salt water than in the pool. Current,
// turbulence and waves feed the vehicle dynamics; the rest is look.

export const SCENARIOS = {
  pool: {
    id: 'pool',
    name: 'Swimming Pool',
    place: 'Indoor competition pool (Woollett-style)',
    blurb: 'Clear, warm fresh water. Tiled floor, lane lines, no current. The place every team tunes first.',
    env: { temperature: 26, salinity: 0, current: [0, 0, 0], turbulence: { sigma: 0, tau: 2 }, waves: { amplitude: 0.01, period: 2.2, direction: 30 }, visibility: 40 },
    depth: 7, // m: a deep competition / diving pool
    pool: { length: 50, width: 25, style: 'tiles' },
    look: { water: 0x2f9fc4, fog: 0x3aa6c9, fogDensity: 0.022, sky: 0x9fd8ec, floor: 'tiles', light: 1.25, sun: 0xfff6e0, surface: 0x7fd6ee, particles: 0.2, life: 'none', ice: false },
  },
  pacific: {
    id: 'pacific',
    name: 'Pacific Ocean',
    place: 'Tropical reef lagoon, 22 °C',
    blurb: 'Bright blue open sea over white sand and coral. Gentle swell and a slow tidal set to the east.',
    env: { temperature: 22, salinity: 34.5, current: [0.03, 0.08, 0], turbulence: { sigma: 0.03, tau: 3 }, waves: { amplitude: 0.12, period: 4.5, direction: 60 }, visibility: 28 },
    depth: 12,
    pool: { length: 50, width: 25, style: 'natural' },
    look: { water: 0x1677b8, fog: 0x1a7fbf, fogDensity: 0.034, sky: 0x7cc4f0, floor: 'sand', light: 1.1, sun: 0xfff2d0, surface: 0x58b8e8, particles: 0.5, life: 'reef', ice: false },
  },
  arctic: {
    id: 'arctic',
    name: 'Arctic Ocean',
    place: 'Under the sea ice, −1.5 °C',
    blurb: 'Freezing, dense water under a broken ice sheet. Dim light, marine snow, very calm.',
    env: { temperature: -1.5, salinity: 34, current: [0.02, -0.03, 0], turbulence: { sigma: 0.015, tau: 4 }, waves: { amplitude: 0.0, period: 3, direction: 0 }, visibility: 18 },
    depth: 15,
    pool: { length: 50, width: 25, style: 'natural' },
    look: { water: 0x0f4a5c, fog: 0x13505f, fogDensity: 0.05, sky: 0xd8ecf4, floor: 'gravel', light: 0.7, sun: 0xdfefff, surface: 0x9fd2e0, particles: 1.0, life: 'arctic', ice: true },
  },
};

export const SCENARIO_ORDER = ['pool', 'pacific', 'arctic'];

export const DEPTH_CHOICES = [0, 5, 8, 12, 16, 20]; // 0 = the scenario's own depth

export function waterDepth(id, override = 0) {
  return override > 0 ? override : (SCENARIOS[id] ?? SCENARIOS.pool).depth;
}

export function environmentConfig(id, depth = 0) {
  const s = SCENARIOS[id] ?? SCENARIOS.pool;
  return { ...s.env, pool: { ...s.pool, depth: waterDepth(id, depth), floor: 'flat', freeboard: 0.4 } };
}
