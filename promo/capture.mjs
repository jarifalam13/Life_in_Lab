// Records the promo frame by frame from the built game: CPU autopilots fly
// the course, the sim is fast-forwarded to each moment, then N frames are
// rendered at a fixed 1/30 s and screenshotted with a caption overlay.
//   npm run build && node promo/capture.mjs [shotName]
//   python3 promo/music.py promo/music.wav
//   ffmpeg -framerate 30 -i promo/frames/%05d.png -i promo/music.wav -c:v libx264 -crf 20 \
//          -pix_fmt yuv420p -c:a aac -b:a 192k -shortest promo/life-as-duburi-promo.mp4
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const FR = join(here, 'frames') + '/';
mkdirSync(FR, { recursive: true });
const FPS = 30;
const ONLY = process.argv[2] || null; // capture one shot by name for testing

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(600000);
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.addInitScript(() => localStorage.setItem('life-as-duburi-quality', 'high'));
await page.goto(pathToFileURL(join(here, '../dist/life-as-duburi.html')).href);
await page.waitForSelector('.title-screen');
await page.waitForTimeout(3000);

// promo overlay + helpers in the page
await page.evaluate(() => {
  const a = window.__duburi;
  a.renderer.setAnimationLoop(null);
  const css = document.createElement('style');
  css.textContent = `
    #promo { position: fixed; inset: 0; pointer-events: none; z-index: 99; font-family: 'Saira Semi Condensed', 'Segoe UI', sans-serif; }
    #promo .cap { position: absolute; left: 0; right: 0; bottom: 118px; text-align: center; color: #fff; font-weight: 800; font-size: 64px; letter-spacing: 0.08em;
      text-shadow: 0 4px 24px rgba(0,0,0,0.75), 0 0 2px #000; text-transform: uppercase; }
    #promo .sub { position: absolute; left: 0; right: 0; bottom: 82px; text-align: center; color: #ffb547; font-weight: 600; font-size: 26px; letter-spacing: 0.22em;
      text-shadow: 0 2px 12px rgba(0,0,0,0.8); text-transform: uppercase; }
    #promo .bar { position: absolute; left: 50%; bottom: 192px; height: 4px; background: #ffb547; transform: translateX(-50%); box-shadow: 0 0 18px #ffb547; }
    #promo .card { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; }
    #promo .card img { width: 520px; border-radius: 14px; background: #fff; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
    #promo .card h1 { margin: 26px 0 4px; font-size: 92px; color: #fff; letter-spacing: 0.04em; text-shadow: 0 6px 30px rgba(0,0,0,0.7); }
    #promo .card h2 { margin: 0; font-size: 28px; color: #ffb547; letter-spacing: 0.3em; text-transform: uppercase; text-shadow: 0 2px 12px #000; }
    #promo .card p { margin: 18px 0 0; font-size: 24px; color: #dff3ff; letter-spacing: 0.12em; text-shadow: 0 2px 12px #000; }
    #promo .black { position: absolute; inset: 0; background: #000; }
    #promo .flash { position: absolute; inset: 0; background: #fff; }
    #promo .lb { position: absolute; left: 0; right: 0; height: 64px; background: #000; }
  `;
  document.head.appendChild(css);
  const o = document.createElement('div');
  o.id = 'promo';
  document.body.appendChild(o);
  window.__promo = o;
  window.__hideUI = (hideHud) => {
    document.querySelector('.menu').hidden = true;
    const hud = document.querySelector('.hud');
    if (hud) hud.style.display = hideHud ? 'none' : '';
    document.querySelectorAll('.qcard').forEach((e) => e.remove());
  };
  // run the sim forward without drawing until cond() or maxT seconds
  window.__ff = (condSrc, maxT) => {
    const g = a.game; const cond = new Function('g', 'a', 'ap', condSrc);
    const DT = 1 / 120; const t0 = g.time;
    while (!cond(g, a, a.pilots[0]) && g.time - t0 < maxT) {
      a.pilots.forEach((ap) => ap && ap.update(DT)); g.step(DT);
    }
    g.players.forEach((p, i) => { a.bots[i].prevP = p.veh.p.slice(); a.bots[i].prevQ = p.veh.q.slice(); });
    g.events.length = 0;
    a.views.forEach((v) => (v.smooth = null));
    a.acc = 0;
    return g.time;
  };
});

let frame = 0;
const shots = [];
const shot = (name, sec, setup, overlay) => shots.push({ name, sec, setup, overlay });

async function capture(s) {
  const n = Math.min(Math.round(s.sec * FPS), +(process.env.MAXF || 1e9));
  for (let i = 0; i < n; i++) {
    const t = i / FPS, u = i / n;
    const html = s.overlay ? s.overlay(t, u) : '';
    await page.evaluate(({ html, menu }) => {
      const a = window.__duburi;
      window.__promo.innerHTML = html;
      if (a.state === 'game' && a.game) a.gameFrame(1 / 30); else a.menuFrame(1 / 30);
      a.input.endFrame();
    }, { html });
    await page.screenshot({ path: `${FR}${String(frame).padStart(5, '0')}.png` });
    frame++;
  }
  console.log(s.name, 'done, frames', frame);
}

// ----- caption helpers -----
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const cap = (text, sub, t, dur, { bars = true } = {}) => {
  const a = ease(t / 0.25), out = Math.min(1, Math.max(0, (dur - t) / 0.2));
  const op = Math.min(a, out);
  const sc = 1.25 - 0.25 * a;
  return `${bars ? '<div class="lb" style="top:0"></div><div class="lb" style="bottom:0"></div>' : ''}
    <div class="bar" style="width:${Math.round(420 * a)}px;opacity:${op}"></div>
    <div class="cap" style="opacity:${op};transform:scale(${sc})">${text}</div>
    ${sub ? `<div class="sub" style="opacity:${op * ease((t - 0.15) / 0.3)}">${sub}</div>` : ''}`;
};
const flash = (t) => (t < 0.12 ? `<div class="flash" style="opacity:${0.7 * (1 - t / 0.12)}"></div>` : '');

const start = (cfg) => page.evaluate((cfg) => { const a = window.__duburi; a.start(cfg); window.__hideUI(true); }, cfg);
const ff = (cond, maxT = 300) => page.evaluate(([c, m]) => window.__ff(c, m), [cond, maxT]);
const cam = (mode, i = 0) => page.evaluate(([m, i]) => { window.__duburi.cams[i] = m; }, [mode, i]);
const cpu = (bot, color) => ({ name: 'CPU', bot, color, device: 'cpu' });

// 0-4 s: title
shot('title', 4, async () => {
  await page.evaluate(() => { const a = window.__duburi; if (a.state !== 'menu') a.toMenu(); window.__hideUI(true); a.fakeEnv.time = 0; });
}, (t) => {
  const op = ease((t - 0.8) / 1.2);
  return `<div class="black" style="opacity:${Math.max(0, 1 - t / 0.9)}"></div>
    <div class="card" style="opacity:${op};transform:scale(${1.06 - 0.06 * op})"><div><img src="${LOGO}"><h1>LIFE AS DUBURI</h1><h2 style="opacity:${ease((t - 2) / 0.8)}">An underwater robotics game</h2></div></div>`;
});

// 4-8 s: gate with a roll (pool)
shot('gate', 4, async () => {
  await start({ scenario: 'pool', runMinutes: 15, coinFlip: false, players: [cpu('duburi', '#ffb547')] });
  await ff("return ap.plan[ap.k] && ap.plan[ap.k].type === 'roll'", 120);
  await cam('chase');
}, (t) => flash(t) + cap('Pilot a real AUV', 'real ROV physics · ArduSub control', t, 4));

// 8-10 s: slalom
shot('slalom', 2, async () => {
  await ff("return ap.k >= 8", 120);
}, (t) => cap('Thread the channel', '', t, 2));

// 10-12 s: bin, down camera
shot('bin', 2, async () => {
  await ff("return ap.plan[ap.k] && ap.plan[ap.k].what === 'marker'", 120);
  await cam('down');
}, (t) => cap('Drop the markers', '', t, 2));

// 12-14 s: torpedo, front camera
shot('torpedo', 2, async () => {
  await ff("return ap.plan[ap.k] && ap.plan[ap.k].what === 'torpedo'", 120);
  await cam('front');
}, (t) => cap('Fire torpedoes', '', t, 2));

// 14-16 s: grab the cup
shot('grab', 2, async () => {
  await ff("return ap.plan[ap.k] && ap.plan[ap.k].what === 'grip'", 120);
  await cam('chase');
}, (t) => cap('Clean up the ocean', '', t, 2));

// 16-18 s: surface in the octagon (HUD on, score pops)
shot('surface', 2, async () => {
  await ff("return ap.plan[ap.k] && ap.plan[ap.k].type === 'surface'", 120);
  await ff("return a.game.players[0].veh.depth < 0.6", 30);
  await page.evaluate(() => window.__hideUI(false));
}, (t) => cap('Surface in the octagon', '', t, 2));

// 18-24 s: the other waters
for (const [sc, bot, color, label, sub] of [['pool', 'barracuda', '#4fd1c5', 'Competition pool', '7 m deep · tiled lanes'], ['pacific', 'manta', '#9f7aea', 'Pacific', '22 °C · coral reef'], ['arctic', 'kraken', '#f56565', 'Arctic', 'under the ice · −1.5 °C']]) {
  shot(sc, 2, async () => {
    await start({ scenario: sc, runMinutes: 15, coinFlip: false, players: [cpu(bot, color)] });
    await ff("return ap.k >= 6", 120);
    await cam('chase');
  }, (t) => flash(t) + cap(label, sub, t, 2));
}

// 24-28 s: four players, split screen
shot('split', 4, async () => {
  await start({ scenario: 'pool', runMinutes: 15, coinFlip: false, players: [cpu('duburi', '#ffb547'), cpu('dubomini', '#68d391'), cpu('kraken', '#f56565'), cpu('manta', '#9f7aea')] });
  await page.evaluate(() => { const a = window.__duburi; a.devices = ['kbA', 'kbB', 'pad0', 'pad1']; a.buildViews(); window.__hideUI(false); document.querySelectorAll('.qcard').forEach((e) => e.remove()); });
  await ff("return a.game.time > 7", 20);
}, (t) => flash(t) + cap('Up to 4 players', 'one screen · split-screen co-op & versus', t, 4, { bars: false }));

// 28-32 s: the five robots
const BOTS = [['duburi', '#ffb547', 'Duburi', '8 thrusters · full 6-DOF'], ['dubomini', '#68d391', 'Dubo Mini', '5 thrusters · agile'], ['barracuda', '#4fd1c5', 'Barracuda', 'torpedo AUV · fastest'], ['kraken', '#f56565', 'Kraken', '6 × T500 · heavy'], ['manta', '#9f7aea', 'Manta', 'flat wing · stunts']];
BOTS.forEach(([bot, color, name, sub], i) => {
  shot(`bot-${bot}`, 0.8, async () => {
    await start({ scenario: ['pool', 'pacific', 'arctic', 'pool', 'pacific'][i], runMinutes: 15, coinFlip: false, players: [cpu(bot, color)] });
    await ff("return ap.k >= 2", 60);
    await cam('chase');
  }, (t) => flash(t) + cap(name, sub, t, 0.8));
});

// 32-40 s: end card
shot('end', 8, async () => {
  await page.evaluate(() => { const a = window.__duburi; a.toMenu(); window.__hideUI(true); a.fakeEnv.time = 20; });
}, (t) => {
  const op = ease(t / 0.4);
  const fade = Math.max(0, Math.min(1, (t - 6.2) / 1.6));
  return `${t < 0.15 ? `<div class="flash" style="opacity:${1 - t / 0.15}"></div>` : ''}
    <div class="card" style="opacity:${op};transform:scale(${1.08 - 0.08 * op})"><div><img src="${LOGO}"><h1>LIFE AS DUBURI</h1>
    <h2>Team BRACU DUBURI</h2><p style="opacity:${ease((t - 0.8) / 0.6)}">Pool · Pacific · Arctic &nbsp;—&nbsp; 1 to 4 players</p>
    <p style="opacity:${ease((t - 1.6) / 0.6)};color:#ffb547;font-weight:700;letter-spacing:0.3em">PLAY NOW</p></div></div>
    <div class="black" style="opacity:${fade}"></div>`;
});

const LOGO = await page.evaluate(() => document.querySelector('.hdr-logo, .title-logo')?.src || '');
for (const s of shots) {
  if (ONLY && s.name !== ONLY) continue;
  await s.setup();
  await capture(s);
}
console.log('frames', frame);
await b.close();
