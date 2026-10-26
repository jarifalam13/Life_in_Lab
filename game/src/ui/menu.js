// Title, setup (players, vehicles, water, options), how-to-play, pause and
// results screens. Plain DOM; the chosen setup is remembered per browser.

import { BOTS, BOT_ORDER, PLAYER_COLORS } from '../sim/bots.js';
import { SCENARIOS, SCENARIO_ORDER } from '../sim/scenarios.js';
import { botStats } from '../sim/stats.js';
import { waterDensity } from '../../../src/hydro/water.js';
import { DEVICES, HELP } from './input.js';
import { POINTS, TASK_KEYS, TASK_LABEL } from '../sim/game.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STORE = 'duburi-robosub-setup-v1';

export function defaultSetup() {
  return {
    scenario: 'pool', minutes: 15, coinFlip: true,
    slots: [
      { type: 'kbA', name: 'Player 1', bot: 'duburi', color: PLAYER_COLORS[0] },
      { type: 'off', name: 'Player 2', bot: 'barracuda', color: PLAYER_COLORS[1] },
      { type: 'off', name: 'Player 3', bot: 'kraken', color: PLAYER_COLORS[2] },
      { type: 'off', name: 'Player 4', bot: 'manta', color: PLAYER_COLORS[3] },
    ],
  };
}

function loadSetup() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && Array.isArray(s.slots) && s.slots.length === 4 && SCENARIOS[s.scenario]) return s;
  } catch { /* storage unavailable */ }
  return defaultSetup();
}
function saveSetup(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* ignore */ } }

export function rulesHTML() {
  const P = POINTS;
  return `
  <div class="rules">
    <p>RoboSub 2025 <b>“Protect the Deep”</b>: your AUV monitors ocean life, tags animals and cleans up trash. Every vehicle must pass the <b>gate</b> before any other task scores. One run is ${'<b>'}one attempt${'</b>'}; you can end it and keep the points, or start a new one and forfeit them (handbook 4.2).</p>
    <ol>
      <li><b>Heading out (coin flip)</b> — you start on the surface at the dock, parallel to the gate (heads) or facing away (tails). <em>Dive before you leave the start zone</em> — surfacing anywhere except inside the octagon is a breach and ends the run. +${P.coinFlip}</li>
      <li><b>Collecting data (gate)</b> — 3 m × 1.5 m gate, red divider in the middle, a reef shark on one side and a sawfish on the other. The side you pass under is the animal you <em>choose</em> for the rest of the run. +${P.gatePass} pass, +${P.gateClean} clean (no leg touch), +${P.gateAnimal} side. <b>Style:</b> every 90° of roll or pitch inside the gate zone +${P.styleRollPitch}, yaw +${P.styleYaw} (rolling back doesn't count).</li>
      <li><b>Navigate the channel (slalom)</b> — 3 sets of white / red / white pipes. +${P.slalomSet} per set, +${P.slalomSide} for keeping the red pipe on the same side as the gate divider, +${P.slalomInside} for staying between the pipe tops and bottoms. Orange path markers point the way.</li>
      <li><b>Drop a BRUVS (bin)</b> — drop your 2 markers into the 12 × 24 in bin. +${P.binAny} each, +${P.binCorrect} in the half with your chosen animal. Use the down camera.</li>
      <li><b>Tagging (torpedoes)</b> — 2 torpedoes at the 0.6 m board with two 4 in openings. +${P.torpedoThrough} through, +${P.torpedoTouch} touching the board, +${P.torpedoAnimal} for the opening by your animal, +${P.torpedoOrder} for chosen-animal first then the other, +${P.torpedoFar} each from behind the “far” bars (2 m).</li>
      <li><b>Ocean cleanup (octagon)</b> — follow the 30 kHz pinger. Grab the cup or the spoon from the table and drop it in its basket (+${P.basketAny}, +${P.basketCorrect} right basket), spin once per item in the baskets (+${P.octRotation} each), surface inside the octagon (+${P.octSurface}), surface holding an item (+${P.octWithItem}), face an animal image (+${P.octFaceAny}, your animal +${P.octFaceChosen}).</li>
      <li><b>Return home</b> — back through the gate under water: +${P.home}, run complete.</li>
      <li><b>Time bonus</b> — gate + (a marker in the bin or a torpedo through) + surfaced in the octagon: ${P.timePerMinute} points per minute left when the run ends.</li>
    </ol>
    <p class="note">Hydrophone ring at the bottom of your screen: the arrows point at the 30 kHz (octagon) and 25 kHz (torpedo) pingers. Physics: the simulator's 6-DOF model with T200/T500 thrusters and EOS-80 sea water — salt and cold water make you more buoyant, current and waves push you around. The official point table is “to be released” in the handbook; these values are the game's.</p>
  </div>`;
}

export function controlsHTML() {
  const tbl = (rows) => `<table>${rows.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  return `<div class="controls"><div><h4>Keyboard — left</h4>${tbl(HELP.kbA)}<p class="note">Hold Left Shift for fine control.</p></div><div><h4>Keyboard — right</h4>${tbl(HELP.kbB)}<p class="note">Hold Right Shift for fine control.</p></div><div><h4>Gamepad (ArduSub layout)</h4>${tbl(HELP.pad)}</div></div><p class="note">Esc pauses. Roll / pitch keys spin the vehicle; let go and the stabiliser levels it again, keeping your heading. Depth hold keeps you at the depth where you let go of up / down.</p>`;
}

export class Menu {
  constructor(root, { logoUrl, thumb, onStart, sound }) {
    this.root = root;
    this.logoUrl = logoUrl;
    this.thumb = thumb;
    this.onStart = onStart;
    this.sound = sound;
    this.setup = loadSetup();
    this.el = h('div', 'menu');
    root.appendChild(this.el);
  }

  show(screen = 'title') {
    this.el.hidden = false;
    this.el.innerHTML = '';
    if (screen === 'title') this.title();
    else if (screen === 'setup') this.setupScreen();
    else if (screen === 'help') this.help();
  }
  hide() { this.el.hidden = true; this.el.innerHTML = ''; }

  title() {
    const s = h('div', 'title-screen');
    s.innerHTML = `
      <img class="title-logo" src="${this.logoUrl}" alt="BRACU DUBURI">
      <h1>RoboSub 2025 <span>Protect the Deep</span></h1>
      <p class="tag">The RoboSub autonomy course as a game — on the DUBURI simulator's physics. 1 to 4 players, pool or open sea.</p>
      <div class="title-btns"><button class="btn primary" data-a="play">Play</button><button class="btn" data-a="help">How to play</button></div>
      <p class="small">Team DUBURI · BRAC University · built on the DUBURI ROV simulator (ArduSub-style control, T200/T500 thruster models, EOS-80 sea water)</p>`;
    s.querySelector('[data-a=play]').onclick = () => { this.sound.ensure(); this.sound.click(); this.show('setup'); };
    s.querySelector('[data-a=help]').onclick = () => { this.sound.ensure(); this.show('help'); };
    this.el.appendChild(s);
  }

  help() {
    const s = h('div', 'panel help-screen');
    s.innerHTML = `<header><h2>How to play</h2><button class="btn" data-a="back">Back</button></header><div class="scroll">${rulesHTML()}<h3>Controls</h3>${controlsHTML()}</div>`;
    s.querySelector('[data-a=back]').onclick = () => this.show('title');
    this.el.appendChild(s);
  }

  setupScreen() {
    const S = this.setup;
    const s = h('div', 'panel setup');
    s.innerHTML = `<header><img src="${this.logoUrl}" alt="" class="hdr-logo"><h2>Mission setup</h2><div class="sp"></div><button class="btn" data-a="back">Back</button><button class="btn primary" data-a="start">Start run ▶</button></header>
      <div class="scroll"><h3>Players <small>up to 4 vehicles in the same water — split screen, keyboard and gamepads, or CPU autopilots</small></h3><div class="slots"></div>
      <h3>Water</h3><div class="scen"></div>
      <h3>Run</h3><div class="opts"></div></div>`;
    s.querySelector('[data-a=back]').onclick = () => this.show('title');
    s.querySelector('[data-a=start]').onclick = () => this.start();
    this.el.appendChild(s);
    this.drawSlots(s.querySelector('.slots'));
    this.drawScen(s.querySelector('.scen'));
    this.drawOpts(s.querySelector('.opts'));
  }

  drawSlots(box) {
    box.innerHTML = '';
    this.setup.slots.forEach((sl, i) => {
      const c = h('div', `slot ${sl.type === 'off' ? 'off' : ''}`);
      c.style.setProperty('--pc', sl.color);
      const st = botStats(BOTS[sl.bot]);
      const bar = (label, v, max, unit) => `<div class="bar"><span>${label}</span><i style="width:${Math.min(100, (v / max) * 100)}%"></i><b>${unit}</b></div>`;
      c.innerHTML = `
        <div class="slot-top"><b>P${i + 1}</b><select class="dev">${['off', ...DEVICES.map((d) => d.id)].map((id) => `<option value="${id}" ${sl.type === id ? 'selected' : ''}>${id === 'off' ? '— empty —' : esc(DEVICES.find((d) => d.id === id).label)}</option>`).join('')}</select></div>
        <input class="name" maxlength="16" value="${esc(sl.name)}" ${sl.type === 'off' ? 'disabled' : ''}>
        <div class="bot-pick"><button class="arrow" data-d="-1">‹</button><img class="thumb" alt=""><button class="arrow" data-d="1">›</button></div>
        <div class="bot-name">${esc(BOTS[sl.bot].name)}</div><div class="bot-kind">${esc(BOTS[sl.bot].kind)}</div>
        <p class="bot-blurb">${esc(BOTS[sl.bot].blurb)}</p>
        ${bar('Top speed', st.surge, 2.0, `${st.surge.toFixed(2)} m/s`)}
        ${bar('Strafe', st.sway, 1.2, `${st.sway.toFixed(2)} m/s`)}
        ${bar('Turn rate', st.yawRate, 400, `${st.yawRate.toFixed(0)}°/s`)}
        ${bar('Stability', st.righting, 18, `${st.righting.toFixed(1)} N·m/rad`)}
        <div class="dof">${['Surge', 'Sway', 'Heave', 'Roll', 'Pitch', 'Yaw'].map((a) => `<em class="${st.dof.includes(a) ? 'on' : ''}">${a}</em>`).join('')}</div>
        <div class="bot-meta">${st.mass} kg · ${st.thrusters} thrusters · ${(+st.thrust).toFixed(0)} N forward</div>
        <div class="colors">${PLAYER_COLORS.map((col) => `<button class="sw ${col === sl.color ? 'on' : ''}" style="background:${col}" data-c="${col}" aria-label="colour ${col}"></button>`).join('')}</div>`;
      this.thumb(sl.bot, sl.color).then((url) => { const im = c.querySelector('.thumb'); if (im) im.src = url; });
      c.querySelector('.dev').onchange = (e) => { sl.type = e.target.value; this.sound.click(); this.drawSlots(box); };
      c.querySelector('.name').oninput = (e) => { sl.name = e.target.value || `Player ${i + 1}`; };
      c.querySelectorAll('.arrow').forEach((b) => (b.onclick = () => {
        const k = (BOT_ORDER.indexOf(sl.bot) + +b.dataset.d + BOT_ORDER.length) % BOT_ORDER.length;
        sl.bot = BOT_ORDER[k];
        this.sound.click();
        this.drawSlots(box);
      }));
      c.querySelectorAll('.sw').forEach((b) => (b.onclick = () => { sl.color = b.dataset.c; this.drawSlots(box); }));
      box.appendChild(c);
    });
  }

  drawScen(box) {
    box.innerHTML = '';
    for (const id of SCENARIO_ORDER) {
      const sc = SCENARIOS[id];
      const rho = waterDensity(sc.env.temperature, sc.env.salinity);
      const cur = Math.hypot(sc.env.current[0], sc.env.current[1]);
      const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
      const c = h('button', `scen-card ${this.setup.scenario === id ? 'on' : ''}`);
      c.style.background = `linear-gradient(180deg, ${hex(sc.look.sky)} 0%, ${hex(sc.look.surface)} 18%, ${hex(sc.look.water)} 45%, ${hex(sc.look.fog)} 100%)`;
      c.innerHTML = `<b>${sc.name}</b><span class="place">${sc.place}</span><p>${sc.blurb}</p>
        <dl><dt>Water</dt><dd>${sc.env.temperature} °C · ${sc.env.salinity} g/kg</dd><dt>Density</dt><dd>${rho.toFixed(1)} kg/m³</dd><dt>Visibility</dt><dd>~${sc.env.visibility} m</dd><dt>Current</dt><dd>${cur.toFixed(2)} m/s</dd><dt>Waves</dt><dd>${(sc.env.waves.amplitude * 2).toFixed(2)} m, ${sc.env.waves.period} s</dd></dl>`;
      c.onclick = () => { this.setup.scenario = id; this.sound.click(); this.drawScen(box); };
      box.appendChild(c);
    }
  }

  drawOpts(box) {
    const S = this.setup;
    box.innerHTML = `<label>Run clock <select class="min">${[5, 10, 15, 20].map((m) => `<option value="${m}" ${S.minutes === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" class="coin" ${S.coinFlip ? 'checked' : ''}> Request a coin flip (+${POINTS.coinFlip}, random start orientation)</label>`;
    box.querySelector('.min').onchange = (e) => { S.minutes = +e.target.value; };
    box.querySelector('.coin').onchange = (e) => { S.coinFlip = e.target.checked; };
  }

  start() {
    const S = this.setup;
    const used = S.slots.filter((s) => s.type !== 'off');
    if (!used.length) { alert('Add at least one player.'); return; }
    saveSetup(S);
    this.sound.ensure();
    this.onStart({
      scenario: S.scenario, runMinutes: S.minutes, coinFlip: S.coinFlip,
      players: used.map((s) => ({ name: s.name, bot: s.bot, color: s.color, device: s.type })),
    });
  }
}

export function resultsHTML(game) {
  const ranked = [...game.players].sort((a, b) => b.best - a.best);
  const head = `<tr><th></th><th>Player</th><th>Vehicle</th>${TASK_KEYS.map((k) => `<th>${esc(TASK_LABEL[k])}</th>`).join('')}<th>Best run</th><th>Runs</th></tr>`;
  const rows = ranked.map((p, i) => {
    const best = p.runs.reduce((a, r) => (!a || r.total > a.total ? r : a), null) || { scores: {}, total: 0 };
    return `<tr class="${i === 0 ? 'win' : ''}" style="--pc:${p.color}"><td>${i === 0 ? '🏆' : i + 1}</td><td><i class="dot"></i>${esc(p.name)}</td><td>${esc(p.design.name)}</td>${TASK_KEYS.map((k) => `<td>${best.scores[k] || 0}</td>`).join('')}<td><b>${best.total.toLocaleString()}</b></td><td>${p.runs.length}</td></tr>`;
  }).join('');
  return `<table class="results">${head}${rows}</table><p class="note">Finals rule: each vehicle's best run counts.</p>`;
}
