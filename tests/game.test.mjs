// Headless tests of Life as Duburi: vehicle physics, task judging by the
// handbook rules and complete autopilot runs for every vehicle and water.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, POINTS } from '../src/sim/game.js';
import { Autopilot } from '../src/sim/autopilot.js';
import { DT } from '../src/sim/vehicle.js';
import { BOTS, BOT_ORDER } from '../src/sim/bots.js';
import { SCENARIO_ORDER } from '../src/sim/scenarios.js';
import { botStats } from '../src/sim/stats.js';
import { boardLocal } from '../src/sim/course.js';

const run = (g, sec, fn) => { const n = Math.round(sec / DT); for (let i = 0; i < n && !g.over; i++) { fn?.(); g.step(DT); } };
const solo = (opts = {}) => new Game({ players: [{ bot: 'duburi' }], seed: 3, coinFlip: false, ...opts });

test('every vehicle floats slightly positive and dives on depth hold', () => {
  for (const id of BOT_ORDER) {
    const g = new Game({ players: [{ bot: id }], seed: 1, coinFlip: false });
    const v = g.players[0].veh;
    assert.ok(botStats(BOTS[id]).buoyancy.pool > 0, `${id} positive in fresh water`);
    v.depthTarget = 1.5;
    run(g, 10);
    assert.ok(Math.abs(v.p[2] - 1.5) < 0.2, `${id} holds 1.5 m (at ${v.p[2].toFixed(2)})`);
    const [r, p] = v.euler();
    assert.ok(Math.abs(r) < 0.1 && Math.abs(p) < 0.1, `${id} stays level`);
  }
});

test('cold salt water is denser, so the same vehicle is more buoyant (EOS-80)', () => {
  const b = botStats(BOTS.duburi).buoyancy;
  assert.ok(b.arctic > b.pacific && b.pacific > b.pool);
  assert.ok(b.arctic - b.pool > 2, 'about 3% more buoyancy than in the pool');
});

test('current pushes an idle vehicle downstream in the Atlantic, not in the pool', () => {
  const drift = (sc) => { const g = solo({ scenario: sc }); const v = g.players[0].veh; v.depthTarget = 2; run(g, 3); const y0 = v.p[1]; run(g, 10); return v.p[1] - y0; };
  assert.ok(Math.abs(drift('pool')) < 0.1);
  assert.ok(drift('atlantic') > 0.5);
});

test('roll input flips the vehicle and the stabiliser levels it again', () => {
  const g = solo();
  const v = g.players[0].veh;
  v.depthTarget = 1.5;
  run(g, 6);
  v.input.roll = 1;
  let acc = 0;
  run(g, 2.4, () => { acc += v.w[0] * DT; });
  v.input.roll = 0;
  assert.ok(acc > Math.PI * 1.5, `rolled ${(acc * 57.3).toFixed(0)} deg`);
  run(g, 4);
  assert.ok(Math.abs(v.euler()[0]) < 0.1, 'level again');
});

test('surfacing outside the octagon after leaving the start zone is a breach', () => {
  const g = solo();
  const p = g.players[0], v = p.veh;
  v.depthTarget = 1.2;
  run(g, 5);
  v.input.surge = 1;
  run(g, 6);
  v.input.surge = 0;
  assert.equal(p.run.state, 'running');
  v.depthTarget = 0; v.input.heave = 1;
  run(g, 8);
  assert.equal(p.run.state, 'ended');
  assert.match(p.run.reason, /Breach/);
});

test('leaving the start zone on the surface is a breach', () => {
  const g = solo();
  const p = g.players[0];
  p.veh.input.surge = 1;
  run(g, 15);
  assert.equal(p.run.state, 'ended');
});

test('markers in the bin before the gate score nothing (gate first)', () => {
  const g = solo();
  const p = g.players[0], bin = g.course.bin;
  p.veh.reset([bin.pos[0], bin.pos[1], 3.6], 0);
  p.veh.depthTarget = 3.6;
  run(g, 2);
  g.action(0, 'marker');
  run(g, 6);
  assert.equal(p.run.scores.bin, 0);
  assert.equal(p.run.markers, 1);
});

test('new run forfeits the points and restocks payloads', () => {
  const g = solo();
  const p = g.players[0];
  p.run.scores.gate = 600; p.run.markers = 0;
  g.action(0, 'restart');
  assert.equal(g.total(p), 0);
  assert.equal(p.run.markers, 2);
  assert.equal(p.run.torpedoes, 2);
});

test('board coordinates: openings are on the board, far line is 2 m out', () => {
  const g = solo();
  const b = g.course.board;
  for (const o of b.openings) assert.ok(Math.abs(o.u) + o.r < b.size / 2 && Math.abs(o.v) + o.r < b.size / 2);
  const front = [b.pos[0] + b.dir[0] * 2, b.pos[1] + b.dir[1] * 2, b.depth];
  assert.ok(Math.abs(boardLocal(b, front).n - 2) < 1e-9);
});

test('a scripted run completes every task in the pool (DUBURI)', () => {
  const g = new Game({ players: [{ bot: 'duburi' }], seed: 3, coinFlip: true });
  const ap = new Autopilot(g, 0);
  while (!g.over && g.time < 600) { ap.update(DT); g.step(DT); }
  const s = g.players[0].run.scores;
  assert.equal(g.players[0].run.reason, 'Run complete — returned home');
  assert.equal(s.coin, POINTS.coinFlip);
  assert.ok(s.gate >= POINTS.gatePass + POINTS.gateAnimal);
  assert.ok(s.style > 0);
  assert.equal(s.slalom, 3 * (POINTS.slalomSet + POINTS.slalomSide + POINTS.slalomInside));
  assert.equal(s.bin, 2 * (POINTS.binAny + POINTS.binCorrect));
  assert.ok(s.torpedo >= POINTS.torpedoThrough);
  assert.ok(s.octagon >= POINTS.octSurface + POINTS.basketAny);
  assert.equal(s.home, POINTS.home);
  assert.ok(s.time > 0, 'time bonus earned');
});

test('four vehicles in the same water: every one finishes in each scenario', () => {
  for (const sc of SCENARIO_ORDER) {
    const g = new Game({ scenario: sc, seed: 5, coinFlip: true, players: ['duburi', 'manta', 'kraken', 'barracuda'].map((bot) => ({ bot })) });
    const aps = g.players.map((_, i) => new Autopilot(g, i));
    while (!g.over && g.time < 900) { aps.forEach((a) => a.update(DT)); g.step(DT); }
    for (const p of g.players) {
      assert.equal(p.run.state, 'ended', `${sc} ${p.bot}`);
      assert.ok(p.run.gatePassed, `${sc} ${p.bot} passed the gate`);
      assert.ok(p.best > 3000, `${sc} ${p.bot} scored ${p.best}`);
    }
  }
});

test('every water has its own depth; the floor tasks follow it', () => {
  for (const [sc, d] of [['pool', 7], ['pacific', 12], ['arctic', 15], ['atlantic', 10]]) {
    const g = new Game({ scenario: sc, players: [{ bot: 'duburi' }], seed: 2 });
    assert.equal(g.course.floor, d);
    assert.ok(Math.abs(g.course.board.depth - (d - 1.6)) < 1e-9);
  }
  assert.equal(new Game({ scenario: 'pool', depth: 20, players: [{ bot: 'duburi' }] }).course.floor, 20);
});

test('Dubo Mini: 5 thrusters, no roll authority, finishes a full run', () => {
  assert.equal(BOTS.dubomini.thrusters.length, 5);
  assert.ok(!botStats(BOTS.dubomini).dof.includes('Roll'));
  const g = new Game({ players: [{ bot: 'dubomini' }], seed: 4, coinFlip: false });
  const ap = new Autopilot(g, 0);
  while (!g.over && g.time < 800) { ap.update(DT); g.step(DT); }
  const r = g.players[0].run;
  assert.ok(r.gatePassed && r.scores.slalom > 0 && r.scores.octagon > 0, JSON.stringify(r.scores));
});

test('skip moves through the tasks in order and scores nothing for skipped ones', () => {
  const g = solo();
  const p = g.players[0];
  const seen = [];
  for (let k = 0; k < 6; k++) { seen.push(g.currentTask(p)); g.action(0, 'skip'); run(g, 0.5); }
  assert.deepEqual(seen, ['gate', 'slalom', 'bin', 'torpedo', 'octagon', 'home']);
  assert.equal(p.run.state, 'ended');
  assert.equal(g.total(p), 0);
  assert.ok(p.run.chosen === 'shark' || p.run.chosen === 'sawfish');
});

test('after skipping the gate the next tasks still score', () => {
  const g = solo();
  const p = g.players[0], bin = g.course.bin;
  g.action(0, 'skip'); // gate
  g.action(0, 'skip'); // slalom -> bin start
  p.veh.reset([bin.pos[0] - p.design.marker[0], bin.pos[1], g.course.floor - 1.0], bin.heading);
  run(g, 3);
  g.action(0, 'marker');
  run(g, 6);
  assert.ok(p.run.scores.bin >= POINTS.binAny);
});

test('a player can leave; the others keep playing and the match ends when everyone is done', () => {
  const g = new Game({ players: [{ bot: 'duburi' }, { bot: 'manta' }], seed: 3, coinFlip: false });
  g.action(1, 'leave');
  assert.ok(g.players[1].left);
  assert.equal(g.players[0].run.state, 'running');
  run(g, 3);
  assert.ok(!g.over);
  g.action(0, 'forfeit');
  assert.equal(g.players[0].run.state, 'running');
  g.action(0, 'leave');
  run(g, 3);
  assert.ok(g.over);
});
