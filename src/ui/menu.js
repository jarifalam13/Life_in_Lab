// Title, lobby (players join with their own controller, pick a vehicle and a
// colour, PS5-couch style), water, options, how-to-play and results screens.
// Plain DOM; the chosen setup is remembered per browser.

import { BOTS, BOT_ORDER, PLAYER_COLORS } from '../sim/bots.js';
import { SCENARIOS, SCENARIO_ORDER, DEPTH_CHOICES } from '../sim/scenarios.js';
import { botStats } from '../sim/stats.js';
import { waterDensity } from '../hydro/water.js';
import { DEVICES, HELP } from './input.js';
import { POINTS, TASK_KEYS, TASK_LABEL } from '../sim/game.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STORE = 'life-as-duburi-setup-v2';
export const GAME_NAME = 'Life as Duburi';

export function defaultSetup() {
  return {
    scenario: 'pool', minutes: 15, coinFlip: true, depth: 0,
    slots: [
      { type: 'kbA', name: 'Player 1', bot: 'duburi', color: PLAYER_COLORS[0] },
      { type: 'off', name: 'Player 2', bot: 'dubomini', color: PLAYER_COLORS[4] },
      { type: 'off', name: 'Player 3', bot: 'kraken', color: PLAYER_COLORS[2] },
      { type: 'off', name: 'Player 4', bot: 'manta', color: PLAYER_COLORS[3] },
    ],
  };
}

function loadSetup() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && Array.isArray(s.slots) && s.slots.length === 4 && s.slots.every((x) => BOTS[x.bot])) {
      // a water that no longer exists (e.g. an older save) falls back to the pool; the rest is kept
      return { ...defaultSetup(), ...s, scenario: SCENARIOS[s.scenario] ? s.scenario : 'pool' };
    }
  } catch { /* storage unavailable */ }
  return defaultSetup();
}
function saveSetup(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* ignore */ } }

export function rulesHTML() {
  const P = POINTS;
  return `
  <div class="rules">
    <p>You are an autonomous underwater vehicle on a real competition course: monitor ocean life, tag animals and clean up trash. Every vehicle must pass the <b>gate</b> before any other task scores. A run is one attempt: <b>end</b> it and keep the points, <b>forfeit</b> it to start again from the dock (the points are lost), or <b>skip</b> a task you can't do (no points for it, you are moved to the next one).</p>
    <ol>
      <li><b>Heading out (coin flip)</b> — you start on the surface at the dock, parallel to the gate (heads) or facing away (tails). <em>Dive before you leave the start zone</em> — surfacing anywhere except inside the octagon is a breach and ends the run. +${P.coinFlip}</li>
      <li><b>Collecting data (gate)</b> — 3 m × 1.5 m gate, red divider in the middle, a reef shark on one side and a sawfish on the other. The side you pass under is the animal you <em>choose</em> for the rest of the run. +${P.gatePass} pass, +${P.gateClean} clean (no leg touch), +${P.gateAnimal} side. <b>Style:</b> every 90° of roll or pitch inside the gate zone +${P.styleRollPitch}, yaw +${P.styleYaw} (rolling back doesn't count).</li>
      <li><b>Navigate the channel (slalom)</b> — 3 sets of white / red / white pipes near the floor. +${P.slalomSet} per set, +${P.slalomSide} for keeping the red pipe on the same side as the gate divider, +${P.slalomInside} for staying between the pipe tops and bottoms. Orange path markers point the way.</li>
      <li><b>Drop a BRUVS (bin)</b> — drop your 2 markers into the 12 × 24 in bin on the floor. +${P.binAny} each, +${P.binCorrect} in the half with your chosen animal. Use the down camera.</li>
      <li><b>Tagging (torpedoes)</b> — 2 torpedoes at the 0.6 m board with two 4 in openings. +${P.torpedoThrough} through, +${P.torpedoTouch} touching the board, +${P.torpedoAnimal} for the opening by your animal, +${P.torpedoOrder} for chosen-animal first then the other, +${P.torpedoFar} each from behind the “far” bars (2 m).</li>
      <li><b>Ocean cleanup (octagon)</b> — follow the 30 kHz pinger down to the table. Grab the cup or the spoon and drop it in its basket (+${P.basketAny}, +${P.basketCorrect} right basket), spin once per item in the baskets (+${P.octRotation} each), surface inside the octagon (+${P.octSurface}), surface holding an item (+${P.octWithItem}), face an animal image (+${P.octFaceAny}, your animal +${P.octFaceChosen}).</li>
      <li><b>Return home</b> — back through the gate under water: +${P.home}, run complete.</li>
      <li><b>Time bonus</b> — gate + (a marker in the bin or a torpedo through) + surfaced in the octagon: ${P.timePerMinute} points per minute left when the run ends.</li>
    </ol>
    <p class="note">Hydrophone ring at the bottom of your screen: the arrows point at the 30 kHz (octagon) and 25 kHz (torpedo) pingers. Physics: the DUBURI simulator's 6-DOF model with T200/T500 thrusters and EOS-80 sea water — salt and cold water make you more buoyant, current and waves push you around.</p>
  </div>`;
}

export function controlsHTML() {
  const tbl = (rows) => `<table>${rows.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  return `<div class="controls"><div><h4>Keyboard — left</h4>${tbl(HELP.kbA)}</div><div><h4>Keyboard — right</h4>${tbl(HELP.kbB)}</div><div><h4>Gamepad 1 (PS / Xbox)</h4>${tbl(HELP.pad)}</div></div><p class="note">Every button and key can be changed under <b>Controls</b> (title screen, lobby or pause menu).</p><p class="note">Roll / pitch keys spin the vehicle; let go and the stabiliser levels it again, keeping your heading. Depth hold keeps you at the depth where you let go of up / down.</p>`;
}


export class Menu {
  constructor(root, { logoUrl, thumb, onStart, sound, input, onControls }) {
    this.onControls = onControls;
    this.root = root;
    this.logoUrl = logoUrl;
    this.thumb = thumb;
    this.onStart = onStart;
    this.sound = sound;
    this.input = input;
    this.setup = loadSetup();
    this.el = h('div', 'menu');
    root.appendChild(this.el);
    this.screen = null;
    // keyboard: join / pick in the lobby, Enter on the title
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  show(screen = 'title') {
    this.el.hidden = false;
    this.el.innerHTML = '';
    this.screen = screen;
    if (screen === 'title') this.title();
    else if (screen === 'setup') this.setupScreen();
    else if (screen === 'help') this.help();
    this.input?.padPresses(); // drop presses that opened this screen
  }
  hide() { this.el.hidden = true; this.el.innerHTML = ''; this.screen = null; }
  get visible() { return !this.el.hidden && this.screen; }

  title() {
    const s = h('div', 'title-screen');
    s.innerHTML = `
      <img class="title-logo" src="${this.logoUrl}" alt="BRACU DUBURI">
      <h1>${GAME_NAME}<span>an underwater robotics game</span></h1>
      <p class="tag">Pilot a real AUV through a competition course — in a pool or the open sea. 1 to 4 players on one screen.</p>
      <div class="title-btns"><button class="btn primary" data-a="play">Play</button><button class="btn" data-a="controls">Controls</button><button class="btn" data-a="help">How to play</button></div>
      <p class="press">Press <kbd>Enter</kbd> or <span class="pad-btn">✕ / A</span> to start</p>
      <p class="small">Team BRACU DUBURI · BRAC University · physics from the DUBURI ROV simulator (ArduSub-style control, T200/T500 thrusters, EOS-80 sea water)</p>`;
    s.querySelector('[data-a=play]').onclick = () => this.go('setup');
    s.querySelector('[data-a=help]').onclick = () => { this.sound.ensure(); this.show('help'); };
    s.querySelector('[data-a=controls]').onclick = () => this.controls();
    this.el.appendChild(s);
  }

  // controls screen for a device (default: the first connected controller)
  controls(dev) {
    this.sfx('uiSelect');
    if (!dev) { const p = this.input?.pads()[0]; dev = p ? `pad${p.index}` : 'kbA'; }
    this.onControls?.(dev);
  }

  sfx(name) { this.sound.ensure(); if (typeof this.sound[name] === 'function') this.sound[name](); else this.sound.click(); }
  go(screen) { this.sfx('uiSelect'); this.show(screen); }

  help() {
    const s = h('div', 'panel help-screen');
    s.innerHTML = `<header><h2>How to play</h2><button class="btn" data-a="back">Back</button></header><div class="scroll">${rulesHTML()}<h3>Controls</h3>${controlsHTML()}</div>`;
    s.querySelector('[data-a=back]').onclick = () => this.show('title');
    this.el.appendChild(s);
  }

  setupScreen() {
    const s = h('div', 'panel setup');
    s.innerHTML = `<header><img src="${this.logoUrl}" alt="" class="hdr-logo"><h2>Lobby</h2><div class="sp"></div><button class="btn" data-a="back">Back</button><button class="btn" data-a="controls">Controls</button><button class="btn primary" data-a="start">Start match ▶</button></header>
      <div class="scroll">
      <div class="join-bar"><b>Join:</b> press <span class="pad-btn">✕ / A</span> on a controller · <kbd>Space</kbd> left keyboard · <kbd>Enter</kbd> right keyboard &nbsp;—&nbsp; <span class="pad-btn">◀ ▶</span> vehicle · <span class="pad-btn">▲ ▼</span> colour · <span class="pad-btn">○ / B</span> leave · <span class="pad-btn">△ / Y</span> add CPU · <span class="pad-btn">Share / View</span> your controls · <span class="pad-btn">Options / Start</span> start</div>
      <div class="slots"></div>
      <h3>Water</h3><div class="scen"></div>
      <h3>Match</h3><div class="opts"></div></div>`;
    s.querySelector('[data-a=back]').onclick = () => this.show('title');
    s.querySelector('[data-a=start]').onclick = () => this.start();
    s.querySelector('[data-a=controls]').onclick = () => this.controls();
    this.el.appendChild(s);
    this.slotBox = s.querySelector('.slots');
    this.drawSlots();
    this.drawScen(s.querySelector('.scen'));
    this.drawOpts(s.querySelector('.opts'));
  }

  drawSlots() {
    const box = this.slotBox;
    if (!box) return;
    box.innerHTML = '';
    this.setup.slots.forEach((sl, i) => {
      const c = h('div', `slot ${sl.type === 'off' ? 'off' : 'on'}`);
      c.style.setProperty('--pc', sl.color);
      const st = botStats(BOTS[sl.bot]);
      const bar = (label, v, max, unit) => `<div class="bar"><span>${label}</span><i style="width:${Math.min(100, (v / max) * 100)}%"></i><b>${unit}</b></div>`;
      c.innerHTML = `
        <div class="slot-top"><b>P${i + 1}</b><select class="dev">${['off', ...DEVICES.map((d) => d.id)].map((id) => `<option value="${id}" ${sl.type === id ? 'selected' : ''}>${id === 'off' ? '— press to join —' : esc(DEVICES.find((d) => d.id === id).label)}</option>`).join('')}</select></div>
        ${sl.type === 'off' ? '<div class="join-hint">Press <span class="pad-btn">✕ / A</span> to join</div>' : `<div class="ready">● ${sl.type === 'cpu' ? 'CPU' : 'Ready'}${sl.type !== 'cpu' ? ' <button class="linkbtn" data-ctl>controls</button>' : ''}</div>`}
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
      c.querySelector('.dev').onchange = (e) => { this.assign(i, e.target.value); };
      c.querySelector('[data-ctl]')?.addEventListener('click', () => this.controls(sl.type));
      c.querySelector('.name').oninput = (e) => { sl.name = e.target.value || `Player ${i + 1}`; };
      c.querySelectorAll('.arrow').forEach((b) => (b.onclick = () => this.cycleBot(i, +b.dataset.d)));
      c.querySelectorAll('.sw').forEach((b) => (b.onclick = () => { sl.color = b.dataset.c; this.drawSlots(); }));
      box.appendChild(c);
    });
  }

  // put a device in slot i (a device is only ever in one slot)
  assign(i, type) {
    const S = this.setup.slots;
    if (type !== 'off' && type !== 'cpu') S.forEach((s, k) => { if (k !== i && s.type === type) s.type = 'off'; });
    S[i].type = type;
    this.sfx(type === 'off' ? 'uiBack' : 'uiSelect');
    this.drawSlots();
  }
  join(type) {
    const S = this.setup.slots;
    const have = S.findIndex((s) => s.type === type);
    if (have >= 0) return have;
    const free = S.findIndex((s) => s.type === 'off');
    if (free < 0) return -1;
    this.assign(free, type);
    return free;
  }
  cycleBot(i, d) {
    const sl = this.setup.slots[i];
    sl.bot = BOT_ORDER[(BOT_ORDER.indexOf(sl.bot) + d + BOT_ORDER.length) % BOT_ORDER.length];
    this.sfx('uiMove');
    this.drawSlots();
  }
  cycleColor(i, d) {
    const sl = this.setup.slots[i];
    sl.color = PLAYER_COLORS[(PLAYER_COLORS.indexOf(sl.color) + d + PLAYER_COLORS.length) % PLAYER_COLORS.length];
    this.sfx('uiMove');
    this.drawSlots();
  }

  onKey(e) {
    if (!this.visible) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    if (this.screen === 'title' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); this.go('setup'); return; }
    if (this.screen !== 'setup') return;
    const S = this.setup.slots;
    const slotOf = (t) => S.findIndex((s) => s.type === t);
    if (e.code === 'Space') { e.preventDefault(); this.join('kbA'); return; }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && tag !== 'BUTTON') {
      e.preventDefault();
      if (slotOf('kbB') >= 0 && e.shiftKey) { this.start(); return; }
      this.join('kbB');
      return;
    }
    const a = slotOf('kbA'), b = slotOf('kbB');
    const map = { KeyA: [a, 'bot', -1], KeyD: [a, 'bot', 1], KeyW: [a, 'col', -1], KeyS: [a, 'col', 1], ArrowLeft: [b, 'bot', -1], ArrowRight: [b, 'bot', 1], ArrowUp: [b, 'col', -1], ArrowDown: [b, 'col', 1] };
    const m = map[e.code];
    if (m && m[0] >= 0) { e.preventDefault(); if (m[1] === 'bot') this.cycleBot(m[0], m[2]); else this.cycleColor(m[0], m[2]); }
  }

  // called every frame by the app while a menu screen is up
  poll() {
    if (!this.visible || !this.input) return;
    for (const { pad, button } of this.input.padPresses()) {
      const dev = `pad${pad}`;
      if (this.screen === 'title') { if (button === 0 || button === 9) this.go('setup'); else if (button === 8) { this.controls(dev); return; } continue; }
      if (this.screen === 'help') { if (button === 1 || button === 0) this.show('title'); continue; }
      if (this.screen !== 'setup') continue;
      const i = this.setup.slots.findIndex((s) => s.type === dev);
      if (button === 0) { if (i < 0) this.join(dev); continue; }
      if (button === 8) { this.controls(dev); return; }
      if (button === 9) { if (i >= 0) this.start(); continue; }
      if (i < 0) { if (button === 1) this.show('title'); continue; }
      if (button === 1) this.assign(i, 'off');
      else if (button === 14) this.cycleBot(i, -1);
      else if (button === 15) this.cycleBot(i, 1);
      else if (button === 12) this.cycleColor(i, -1);
      else if (button === 13) this.cycleColor(i, 1);
      else if (button === 3) { const free = this.setup.slots.findIndex((s) => s.type === 'off'); if (free >= 0) this.assign(free, 'cpu'); } // △ / Y adds a CPU
    }
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
        <dl><dt>Depth</dt><dd>${this.setup.depth > 0 ? this.setup.depth : sc.depth} m</dd><dt>Water</dt><dd>${sc.env.temperature} °C · ${sc.env.salinity} g/kg</dd><dt>Density</dt><dd>${rho.toFixed(1)} kg/m³</dd><dt>Visibility</dt><dd>~${sc.env.visibility} m</dd><dt>Current</dt><dd>${cur.toFixed(2)} m/s</dd><dt>Waves</dt><dd>${(sc.env.waves.amplitude * 2).toFixed(2)} m, ${sc.env.waves.period} s</dd></dl>`;
      c.onclick = () => { this.setup.scenario = id; this.sfx('uiMove'); this.drawScen(box); };
      box.appendChild(c);
    }
  }

  drawOpts(box) {
    const S = this.setup;
    box.innerHTML = `<label>Match clock <select class="min">${[5, 10, 15, 20].map((m) => `<option value="${m}" ${S.minutes === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
      <label>Water depth <select class="dep">${DEPTH_CHOICES.map((d) => `<option value="${d}" ${S.depth === d ? 'selected' : ''}>${d ? `${d} m` : 'water default'}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" class="coin" ${S.coinFlip ? 'checked' : ''}> Coin flip start (+${POINTS.coinFlip}, random start heading)</label>`;
    box.querySelector('.min').onchange = (e) => { S.minutes = +e.target.value; };
    box.querySelector('.dep').onchange = (e) => { S.depth = +e.target.value; this.drawScen(this.el.querySelector('.scen')); };
    box.querySelector('.coin').onchange = (e) => { S.coinFlip = e.target.checked; };
  }

  start() {
    const S = this.setup;
    const used = S.slots.filter((s) => s.type !== 'off');
    if (!used.length) { this.flash('Press ✕ / A, Space or Enter to join first'); return; }
    saveSetup(S);
    this.sfx('uiSelect');
    this.onStart({
      scenario: S.scenario, runMinutes: S.minutes, coinFlip: S.coinFlip, depth: S.depth,
      players: used.map((s) => ({ name: s.name, bot: s.bot, color: s.color, device: s.type })),
    });
  }

  flash(text) {
    const t = h('div', 'menu-flash', esc(text));
    this.el.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
}

export function resultsHTML(game) {
  const ranked = [...game.players].sort((a, b) => b.best - a.best);
  const head = `<tr><th></th><th>Player</th><th>Vehicle</th>${TASK_KEYS.map((k) => `<th>${esc(TASK_LABEL[k])}</th>`).join('')}<th>Best run</th><th>Runs</th></tr>`;
  const rows = ranked.map((p, i) => {
    const best = p.runs.reduce((a, r) => (!a || r.total > a.total ? r : a), null) || { scores: {}, total: 0 };
    return `<tr class="${i === 0 ? 'win' : ''}" style="--pc:${p.color}"><td>${i === 0 ? '🏆' : i + 1}</td><td><i class="dot"></i>${esc(p.name)}${p.left ? ' <small>(left)</small>' : ''}</td><td>${esc(p.design.name)}</td>${TASK_KEYS.map((k) => `<td>${best.scores[k] || 0}</td>`).join('')}<td><b>${best.total.toLocaleString()}</b></td><td>${p.runs.length}</td></tr>`;
  }).join('');
  return `<table class="results">${head}${rows}</table><p class="note">Each vehicle's best run counts.</p>`;
}
