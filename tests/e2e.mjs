// Browser smoke test of the built game (dist/life-as-duburi.html) with the
// pre-installed Chromium: menus, every water scenario, 1 and 4 players,
// keyboard flying, CPU runs, console errors and frame rate. Screenshots go
// to the directory given as the first argument.
//   node tests/e2e.mjs <outDir>

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// the pre-installed Playwright is a global CommonJS package
const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || join(here, '../dist/e2e');
mkdirSync(out, { recursive: true });
const url = pathToFileURL(process.env.GAME_HTML || join(here, '../dist/life-as-duburi.html')).href;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|net::/.test(m.text())) errors.push(`console: ${m.text()}`); });
const shot = (n) => page.screenshot({ path: join(out, `${n}.png`), timeout: 180000 });
// software rendering in CI is slow: multi-view parts run at the Low preset
const quality = (q) => page.evaluate((q) => { const a = window.__duburi; a.quality = q; a.applyQuality(); }, q);
const wait = (ms) => page.waitForTimeout(ms);
const results = [];
// hold keys for a span of *game* time (software rendering in CI is slow)
async function holdSim(keys, sec) {
  for (const k of keys) await page.keyboard.down(k);
  const t0 = await page.evaluate(() => window.__duburi.game.time);
  await page.waitForFunction((t) => window.__duburi.game.time > t, t0 + sec, { timeout: 120000, polling: 100 });
  for (const k of keys) await page.keyboard.up(k);
}
async function waitSim(sec) {
  const t0 = await page.evaluate(() => window.__duburi.game.time);
  await page.waitForFunction((t) => window.__duburi.game.time > t, t0 + sec, { timeout: 120000, polling: 100 });
}

await page.goto(url);
await page.waitForSelector('.title-screen', { timeout: 20000 });
await wait(1500);
await shot('01-title');
await page.click('[data-a=play]');
await page.waitForSelector('.setup');
await wait(1500);
await shot('02-setup');

async function setup(slots, scenario) {
  await page.evaluate(({ slots, scenario }) => {
    const m = window.__duburi.menu;
    m.setup.scenario = scenario;
    m.setup.minutes = 15;
    m.setup.slots.forEach((s, i) => { s.type = slots[i]?.type ?? 'off'; if (slots[i]?.bot) s.bot = slots[i].bot; });
    m.show('setup');
  }, { slots, scenario });
  await wait(400);
  await page.click('[data-a=start]');
  await page.waitForSelector('.hud', { timeout: 20000 });
}
const fps = () => page.evaluate(() => window.__duburi.fps);
const state = () => page.evaluate(() => { const g = window.__duburi.game; return { t: g.time, players: g.players.map((p) => ({ bot: p.bot, depth: p.veh.p[2], pos: p.veh.p.map((x) => +x.toFixed(2)), run: p.run.state, reason: p.run.reason, total: g.total(p), best: p.best })) }; });
const toMenu = () => page.evaluate(() => window.__duburi.toMenu());

// --- single player, keyboard, each scenario ---
for (const sc of ['pool', 'pacific', 'arctic', 'atlantic']) {
  await setup([{ type: 'kbA', bot: 'duburi' }], sc);
  await wait(800);
  await holdSim(['KeyF'], 2.0); // dive
  await holdSim(['KeyW'], 2.0);
  await shot(`10-${sc}-chase`);
  await page.keyboard.press('Digit1'); await wait(500); await shot(`11-${sc}-front`);
  await page.keyboard.press('Digit1'); await wait(500); await shot(`12-${sc}-down`);
  await page.keyboard.press('Digit1');
  const s = await state();
  results.push({ test: `1P keyboard ${sc}`, fps: +(await fps()).toFixed(1), depth: +s.players[0].depth.toFixed(2), run: s.players[0].run });
  if (!(s.players[0].depth > 1.0)) errors.push(`${sc}: vehicle did not dive (depth ${s.players[0].depth})`);
  await toMenu();
  await wait(300);
}

// --- every vehicle visible: 4 CPU vehicles + 1 viewer ---
await quality('medium');
await setup([{ type: 'kbA', bot: 'duburi' }, { type: 'cpu', bot: 'barracuda' }, { type: 'cpu', bot: 'kraken' }, { type: 'cpu', bot: 'manta' }], 'pool');
await page.evaluate(() => { const a = window.__duburi; a.cams[0] = 'chase'; const p = a.game.players[0]; p.veh.reset([-18.5, -1.2, 1.4], 0.4); p.veh.depthTarget = 1.4; });
await waitSim(6);
await shot('20-pool-cpus');
results.push({ test: '1P + 3 CPU', fps: +(await fps()).toFixed(1), ...(await state()) });
await toMenu();

// --- four local players split screen ---
await quality('low');
await setup([{ type: 'kbA', bot: 'duburi' }, { type: 'kbB', bot: 'barracuda' }, { type: 'pad0', bot: 'kraken' }, { type: 'pad1', bot: 'dubomini' }], 'pacific');
await holdSim(['KeyF', 'KeyK'], 2.0);
await holdSim(['KeyW', 'ArrowUp', 'KeyD', 'ArrowRight'], 1.5);
await shot('30-4p-split');
const s4 = await state();
results.push({ test: '4P split', fps: +(await fps()).toFixed(1), ...s4 });
if (!(s4.players[1].depth > 0.8)) errors.push('keyboard B did not dive player 2');
await toMenu();

// --- three players: spectator quadrant ---
await setup([{ type: 'kbA', bot: 'manta' }, { type: 'kbB', bot: 'dubomini' }, { type: 'pad0', bot: 'duburi' }], 'arctic');
await holdSim(['KeyF', 'KeyK'], 1.5);
await shot('31-3p-spectator');
await toMenu();

// --- fast-forward a CPU run to the results screen ---
await setup([{ type: 'cpu', bot: 'duburi' }], 'atlantic');
await page.evaluate(() => { const a = window.__duburi; const g = a.game; const ap = a.pilots[0]; while (!g.over && g.time < 900) { ap.update(1 / 120); g.step(1 / 120); } });
await wait(3500);
await page.waitForSelector('table.results', { timeout: 10000 });
await shot('40-results');
results.push({ test: 'CPU full run (Atlantic)', ...(await state()) });

// --- pause menu: skip a task from the menu (keyboard navigation) ---
await quality('high');
await page.click('[data-a=again]');
await page.waitForSelector('.hud');
await wait(800);
await page.keyboard.press('Escape');
await page.waitForSelector('.pause-menu');
await wait(300);
await shot('41-pause');
await page.keyboard.press('ArrowDown'); // Resume -> Skip task
await page.keyboard.press('Enter');
await wait(500);
const sk = await page.evaluate(() => { const a = window.__duburi, g = a.game, p = g.players[0]; return { paused: a.paused, task: g.currentTask(p), skipped: [...(p.run.skipped || [])] }; });
results.push({ test: 'pause menu → skip task', ...sk });
if (sk.paused || sk.task !== 'slalom' || !sk.skipped.includes('gate')) errors.push(`skip from the pause menu did not work: ${JSON.stringify(sk)}`);
await toMenu();

// --- lobby: join with the keyboards, then one player leaves mid-match ---
await quality('low');
await page.evaluate(() => { const m = window.__duburi.menu; m.setup.slots.forEach((s) => (s.type = 'off')); m.show('setup'); });
await wait(300);
await page.keyboard.press('Space'); // left keyboard joins
await page.keyboard.press('Enter'); // right keyboard joins
await wait(300);
const joined = await page.evaluate(() => window.__duburi.menu.setup.slots.map((s) => s.type));
results.push({ test: 'lobby join (Space / Enter)', joined });
if (joined[0] !== 'kbA' || joined[1] !== 'kbB') errors.push(`keyboard join failed: ${joined}`);
await page.keyboard.press('KeyD'); // P1 next vehicle
await wait(300);
await shot('03-lobby');
await page.click('[data-a=start]');
await page.waitForSelector('.hud');
await holdSim(['KeyF', 'KeyK'], 1.0);
await shot('32-2p-split');
await page.keyboard.press('Backspace'); // P2's pause menu
await page.waitForSelector('.pause-menu');
const items = await page.$$eval('.pause-menu .mi', (els) => els.map((e) => e.dataset.a));
const leaveIdx = items.indexOf('leave');
for (let k = 0; k < leaveIdx; k++) await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await wait(600);
const lv = await page.evaluate(() => { const a = window.__duburi; return { views: a.views.length, left: a.game.players.map((p) => !!p.left), running: a.game.players[0].run.state }; });
results.push({ test: 'player 2 leaves', ...lv });
if (lv.views !== 1 || !lv.left[1] || lv.running !== 'running') errors.push(`leave failed: ${JSON.stringify(lv)}`);
await waitSim(1);
await shot('33-after-leave');
await page.keyboard.press('Escape');
await page.waitForSelector('.pause-menu');
const items2 = await page.$$eval('.pause-menu .mi', (els) => els.map((e) => e.dataset.a));
for (let k = 0; k < items2.indexOf('forfeit'); k++) await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await wait(400);
const ff = await page.evaluate(() => { const g = window.__duburi.game, p = g.players[0]; return { run: p.run.state, total: g.total(p), x: p.veh.p[0] }; });
results.push({ test: 'forfeit run', ...ff });
if (ff.run !== 'running' || ff.total !== 0) errors.push(`forfeit failed: ${JSON.stringify(ff)}`);

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
