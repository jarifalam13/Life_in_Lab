// Browser test of the controller support with a simulated DualSense: join
// with ✕, open the layout with Share, re-bind a button, change the stick
// preset, start with Options, check the re-bound button works in the game,
// and re-bind a key from the pause menu.
//   node tests/controls-e2e.mjs <outDir>

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = (process.argv[2] || join(here, '../dist/e2e')) + '/';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.addInitScript(() => {
  const mk = () => ({ pressed: false, value: 0, touched: false });
  window.__pad = { id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, mk) };
  navigator.getGamepads = () => [window.__pad, null, null, null];
  window.__raf = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { window.__raf++; cb(t); });
  localStorage.setItem('life-as-duburi-quality', 'low');
});
const frames = async (n) => { const f0 = await page.evaluate(() => window.__raf); await page.waitForFunction((f) => window.__raf >= f, f0 + n, { polling: 50 }); };
const press = async (i) => { await page.evaluate((i) => { window.__pad.buttons[i].pressed = true; window.__pad.buttons[i].value = 1; }, i); await frames(3); await page.evaluate((i) => { window.__pad.buttons[i].pressed = false; window.__pad.buttons[i].value = 0; }, i); await frames(3); };
const st = () => page.evaluate(() => { const a = window.__duburi; return { state: a.state, screen: a.menu.screen, ctrl: a.ctrl && a.ctrl.device, capture: !!a.capture, slots: a.menu.setup.slots.map((s) => s.type + ':' + s.bot), focus: document.activeElement?.dataset?.bind || document.activeElement?.dataset?.a || document.activeElement?.tagName }; });
await page.goto(pathToFileURL(join(here, '../dist/life-as-duburi.html')).href);
await page.waitForSelector('.title-screen');
await page.waitForTimeout(1500);
await press(0); console.log('X on title →', await st());
await page.evaluate(() => { const m = window.__duburi.menu; m.setup.slots.forEach((s) => (s.type = 'off')); m.show('setup'); });
await page.waitForTimeout(300);
await press(0); console.log('X joins →', await st());
await press(15); console.log('→ next bot →', await st());
await press(8); console.log('Share → controls', await st());
await page.screenshot({ path: OUT + 'controls-pad.png' });
// highlight check: hold R1 and screenshot
await page.evaluate(() => { window.__pad.buttons[5].pressed = true; window.__pad.axes[0] = 0.8; });
await frames(3);
const lit = await page.evaluate(() => document.querySelector('#pb5')?.classList.contains('on'));
await page.evaluate(() => { window.__pad.buttons[5].pressed = false; window.__pad.axes[0] = 0; });
console.log('R1 lights up on the drawing:', lit);
if (!lit) errs.push('pressed button not shown on the drawing');
// remap: click the "Drop marker" row, then press □ (2)
await page.click('[data-bind=marker]');
await page.waitForTimeout(300);
console.log('capturing', await st());
await press(2);
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('life-as-duburi-controls-v1')));
console.log('after remap marker→□:', JSON.stringify(after.pad0.buttons));
await page.screenshot({ path: OUT + 'controls-remapped.png' });
// change stick preset with the pad: click Game preset
await page.click('[data-preset=game]');
await page.waitForTimeout(300);
console.log('preset', await page.evaluate(() => JSON.parse(localStorage.getItem('life-as-duburi-controls-v1')).pad0.sticks));
await press(1); console.log('○ back →', JSON.stringify(await st()));
// start the match with Options, check the start card and that □ now drops a marker
await press(9);
console.log('after Options', JSON.stringify(await st()));
await page.waitForSelector('.qcard');
await page.screenshot({ path: OUT + 'match-card.png' });
await page.waitForFunction(() => window.__duburi.game && window.__duburi.game.time > 1.0);
await press(2);
const mk = await page.evaluate(() => window.__duburi.game.players[0].run.markers);
console.log('markers after pressing □ (remapped):', mk);
if (mk !== 1) errs.push(`re-bound □ did not drop a marker (markers ${mk})`);
// keyboard remap from the pause menu: Options → Controls & customise → keyboard tab
await press(9);
console.log('pause', await st(), await page.$$eval('.pause-menu .mi', (e) => e.map((x) => x.dataset.a)));
await page.click('[data-a=controls]');
await page.waitForTimeout(300);
await page.click('[data-dev=kbA]');
await page.waitForTimeout(300);
await page.click('[data-bind="ac:torpedo"]');
await page.keyboard.press('KeyP');
await page.waitForTimeout(300);
const kb = await page.evaluate(() => JSON.parse(localStorage.getItem('life-as-duburi-controls-v1')).kbA.actions);
console.log('kbA actions after torpedo→P:', JSON.stringify(kb));
if (kb.torpedo !== 'KeyP') errs.push('key re-bind failed');
await page.screenshot({ path: OUT + 'controls-kb.png' });
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
console.log('esc from controls →', await st(), !!(await page.$('.pause-menu')));
console.log('ERRORS', errs);
await b.close();
const ok = errs.length === 0;
process.exit(ok ? 0 : 1);
