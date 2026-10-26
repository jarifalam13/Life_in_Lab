// Controls screen: a drawing of the player's controller with what every
// button does (live — pressed buttons light up), the stick layout, and a
// list of every action that can be re-bound by pressing a new button or key.
// Also the small "your controls" card shown at the start of a match.

import { ACTIONS, PAD_HOLDS, KEY_AXES, STICK_PRESETS, getBindings, buttonName, keyName, padStyle } from './input.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// button positions on the drawing (standard mapping indices)
const BTN = {
  0: { x: 560, y: 232, r: 15, face: true }, 1: { x: 593, y: 199, r: 15, face: true }, 2: { x: 527, y: 199, r: 15, face: true }, 3: { x: 560, y: 166, r: 15, face: true },
  4: { x: 262, y: 108, w: 76, h: 16 }, 5: { x: 538, y: 108, w: 76, h: 16 }, 6: { x: 262, y: 80, w: 70, h: 20 }, 7: { x: 538, y: 80, w: 70, h: 20 },
  8: { x: 352, y: 150, w: 22, h: 12 }, 9: { x: 448, y: 150, w: 22, h: 12 },
  10: { x: 345, y: 262, r: 26, stick: true }, 11: { x: 455, y: 262, r: 26, stick: true },
  12: { x: 262, y: 172, w: 18, h: 22 }, 13: { x: 262, y: 226, w: 18, h: 22 }, 14: { x: 235, y: 199, w: 22, h: 18 }, 15: { x: 289, y: 199, w: 22, h: 18 },
  16: { x: 400, y: 236, r: 10 },
};
// where each button's label goes (side, y)
const CALLOUT = { 6: ['L', 60], 4: ['L', 96], 12: ['L', 150], 14: ['L', 186], 13: ['L', 222], 8: ['L', 258], 7: ['R', 60], 5: ['R', 96], 3: ['R', 140], 2: ['R', 172], 1: ['R', 204], 0: ['R', 236], 9: ['R', 268], 15: ['R', 300] };
const PS_SYMBOL = { 0: '✕', 1: '○', 2: '□', 3: '△' };
const PS_COLOR = { 0: '#7aa7ff', 1: '#ff6b6b', 2: '#f08ad8', 3: '#3fd6a6' };
const XB_SYMBOL = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y' };
const XB_COLOR = { 0: '#4fd36b', 1: '#ff5d5d', 2: '#4f9bff', 3: '#ffd24a' };

const ACTION_LABEL = Object.fromEntries([...ACTIONS, ...PAD_HOLDS].map((a) => [a.id, a.label]));
const SHORT = { marker: 'Marker', torpedo: 'Torpedo', grip: 'Gripper', camera: 'Camera', depthHold: 'Depth hold', skip: 'Skip task', endRun: 'End run', restart: 'Forfeit', pause: 'Pause menu', rollLeft: 'Roll left', rollRight: 'Roll right', pitchUp: 'Pitch up', pitchDown: 'Pitch down' };

function stickText(b, side) {
  const map = STICK_PRESETS[b.sticks].map;
  const names = { surge: 'fwd / back', sway: 'strafe', heave: 'up / down', yaw: 'turn' };
  const parts = [];
  for (const [ax, [i]] of Object.entries(map)) if ((side === 'L' && (i === 0 || i === 1)) || (side === 'R' && (i === 2 || i === 3))) parts.push(`${i % 2 ? '↕' : '↔'} ${names[ax]}`);
  return parts.sort().reverse().join(' · ');
}

// SVG drawing of a gamepad with the current bindings as callouts
export function controllerSVG(device, { style = 'ps', compact = false } = {}) {
  const b = getBindings(device);
  const what = {};
  for (const [id, i] of Object.entries(b.buttons)) if (i >= 0) (what[i] = what[i] || []).push(SHORT[id] || id);
  if (b.triggersHeave) { (what[6] = what[6] || []).push('Down'); (what[7] = what[7] || []).push('Up'); }
  const L = stickText(b, 'L'), R = stickText(b, 'R');
  let s = `<svg class="pad-svg ${compact ? 'compact' : ''}" viewBox="0 0 800 430" role="img" aria-label="controller layout">`;
  // body
  s += '<path class="pad-body" d="M250 120 C 300 112, 500 112, 550 120 C 640 130, 680 200, 700 290 C 712 345, 660 372, 620 340 C 585 312, 560 290, 500 288 L 300 288 C 240 290, 215 312, 180 340 C 140 372, 88 345, 100 290 C 120 200, 160 130, 250 120 Z"/>';
  s += '<rect class="pad-pad" x="330" y="128" width="140" height="80" rx="16"/>';
  for (const [i, p] of Object.entries(BTN)) {
    const id = `pb${i}`;
    if (p.r) {
      s += `<circle id="${id}" class="pad-btn-g ${p.stick ? 'stick' : ''} ${p.face ? 'face' : ''}" cx="${p.x}" cy="${p.y}" r="${p.r}" ${p.face ? `style="--fc:${(style === 'ps' ? PS_COLOR : XB_COLOR)[i]}"` : ''}/>`;
      if (p.face) s += `<text class="pad-sym" x="${p.x}" y="${p.y + 5}" style="fill:${(style === 'ps' ? PS_COLOR : XB_COLOR)[i]}">${(style === 'ps' ? PS_SYMBOL : XB_SYMBOL)[i]}</text>`;
    } else s += `<rect id="${id}" class="pad-btn-g" x="${p.x - p.w / 2}" y="${p.y - p.h / 2}" width="${p.w}" height="${p.h}" rx="5"/>`;
  }
  // callouts
  for (const [i, [side, y]] of Object.entries(CALLOUT)) {
    const p = BTN[i];
    const text = (what[i] || []).join(' + ');
    if (!text) continue;
    const lx = side === 'L' ? 150 : 650;
    const name = `${buttonName(+i, style)} `;
    s += `<polyline class="pad-line" points="${p.x},${p.y} ${side === 'L' ? Math.min(p.x - 30, 200) : Math.max(p.x + 30, 600)},${y} ${lx},${y}"/>`;
    s += `<text class="pad-label" x="${side === 'L' ? lx - 6 : lx + 6}" y="${y + 4}" text-anchor="${side === 'L' ? 'end' : 'start'}"><tspan class="pad-key">${esc(name)}</tspan>${esc(text)}</text>`;
  }
  // sticks: labels under the controller
  for (const [i, side, text] of [[10, 'L', L], [11, 'R', R]]) {
    const p = BTN[i];
    const click = (what[i] || []).join(' + ');
    const lx = side === 'L' ? 385 : 415, ly = 412;
    s += `<polyline class="pad-line" points="${p.x},${p.y + p.r} ${p.x},${ly - 22} ${side === 'L' ? lx - 10 : lx + 10},${ly - 22}"/>`;
    s += `<text class="pad-label" x="${lx}" y="${ly - 18}" text-anchor="${side === 'L' ? 'end' : 'start'}"><tspan class="pad-key">${side} stick </tspan>${esc(text)}</text>`;
    if (click) s += `<text class="pad-label dim" x="${lx}" y="${ly + 2}" text-anchor="${side === 'L' ? 'end' : 'start'}">press ${side}3: ${esc(click)}</text>`;
  }
  s += '</svg>';
  return s;
}

// light up the pressed buttons on a drawing (called every frame while visible)
export function highlightPad(root, pad) {
  if (!root || !pad) return;
  for (let i = 0; i <= 16; i++) {
    const el = root.querySelector(`#pb${i}`);
    if (!el) continue;
    const on = pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4);
    el.classList.toggle('on', !!on);
  }
  for (const [k, ax] of [[10, 0], [11, 2]]) {
    const el = root.querySelector(`#pb${k}`);
    if (el) el.setAttribute('transform', `translate(${(pad.axes[ax] || 0) * 9} ${(pad.axes[ax + 1] || 0) * 9})`);
  }
}

// keyboard drawing: the keys in use, grouped
export function keyboardHTML(device) {
  const b = getBindings(device);
  const row = (k, t) => `<div class="kb-row"><kbd>${esc(k)}</kbd><span>${esc(t)}</span></div>`;
  const pair = (a, c) => `${keyName(b.axes[a])} / ${keyName(b.axes[c])}`;
  return `<div class="kb-grid">
    <div><h4>Move</h4>${row(pair('surge+', 'surge-'), 'forward / back')}${row(pair('yaw-', 'yaw+'), 'turn left / right')}${row(pair('sway-', 'sway+'), 'strafe left / right')}${row(pair('heave+', 'heave-'), 'up / down')}${row(pair('roll-', 'roll+'), 'roll')}${row(pair('pitch+', 'pitch-'), 'pitch')}${row(keyName(b.fine), 'hold: fine control')}</div>
    <div><h4>Actions</h4>${ACTIONS.map((a) => row(keyName(b.actions[a.id]), a.label)).join('')}</div></div>`;
}

// the full controls screen body (the host wraps it in an overlay)
export function controlsScreenHTML(device, { devices, pad }) {
  const isPad = device.startsWith('pad');
  const style = isPad ? padStyle(pad) : 'ps';
  const tabs = devices.map((d) => `<button class="ctab ${d.id === device ? 'on' : ''}" data-nav data-dev="${d.id}">${esc(d.label)}${d.connected === false ? ' <small>(not connected)</small>' : ''}</button>`).join('');
  const b = getBindings(device);
  let body;
  if (isPad) {
    const rows = [...PAD_HOLDS, ...ACTIONS].map((a) => `<button class="bind" data-nav data-bind="${a.id}"><span>${esc(ACTION_LABEL[a.id])}</span><kbd>${esc(buttonName(b.buttons[a.id], style))}</kbd></button>`).join('');
    body = `<div class="ctrl-cols"><div class="ctrl-draw">${controllerSVG(device, { style })}<p class="note">${pad ? `Connected: ${esc(pad.id)} — press buttons to see them light up.` : 'Connect this controller and press any button.'}</p></div>
      <div class="ctrl-list"><h4>Sticks</h4>
        ${Object.entries(STICK_PRESETS).map(([k, p]) => `<button class="bind preset ${b.sticks === k ? 'on' : ''}" data-nav data-preset="${k}"><span><b>${p.label}</b><small>${p.desc}</small></span><kbd>${b.sticks === k ? '●' : '○'}</kbd></button>`).join('')}
        <button class="bind" data-nav data-toggle="invertY"><span>Invert stick Y (up / down and forward / back)</span><kbd>${b.invertY ? 'ON' : 'off'}</kbd></button>
        <button class="bind" data-nav data-toggle="triggersHeave"><span>Triggers move up / down</span><kbd>${b.triggersHeave ? 'ON' : 'off'}</kbd></button>
        <h4>Buttons <small>select one, then press the new button</small></h4>${rows}</div></div>`;
  } else {
    const rows = [...KEY_AXES.map((a) => ({ id: `ax:${a.id}`, label: a.label, key: b.axes[a.id] })), ...ACTIONS.map((a) => ({ id: `ac:${a.id}`, label: a.label, key: b.actions[a.id] })), { id: 'fine', label: 'Fine control (hold)', key: b.fine }]
      .map((r) => `<button class="bind" data-nav data-bind="${r.id}"><span>${esc(r.label)}</span><kbd>${esc(keyName(r.key))}</kbd></button>`).join('');
    body = `<div class="ctrl-cols"><div class="ctrl-draw">${keyboardHTML(device)}</div><div class="ctrl-list"><h4>Keys <small>select one, then press the new key</small></h4>${rows}</div></div>`;
  }
  return `<header><h2>Controls</h2><div class="ctabs">${tabs}</div></header>
    <div class="scroll">${body}
    <div class="pause-btns"><button class="btn" data-nav data-reset="1">Reset ${isPad ? 'this controller' : 'these keys'} to default</button><button class="btn primary" data-nav data-close="1">Done</button></div>
    <p class="note nav-hint">↑ ↓ / D-pad to choose · Enter / ✕ / A to change · Esc / ○ / B to go back. A button already in use is swapped.</p></div>`;
}

// small card shown in a player's view at the start of a match
export function quickCardHTML(device, pad) {
  if (device.startsWith('pad')) return `<div class="qc-title">Your controller · <small>Options/Start → Controls to change</small></div>${controllerSVG(device, { style: padStyle(pad), compact: true })}`;
  const b = getBindings(device);
  const k = (id) => keyName(b.axes[id]);
  const a = (id) => keyName(b.actions[id]);
  return `<div class="qc-title">Your keys · <small>${a('pause')} → Controls to change</small></div><div class="qc-keys">
    <span><kbd>${k('surge+')}${k('yaw-')}${k('surge-')}${k('yaw+')}</kbd> drive</span><span><kbd>${k('sway-')} ${k('sway+')}</kbd> strafe</span><span><kbd>${k('heave+')} ${k('heave-')}</kbd> up / down</span>
    <span><kbd>${k('roll-')} ${k('roll+')}</kbd> roll</span><span><kbd>${k('pitch+')} ${k('pitch-')}</kbd> pitch</span><span><kbd>${a('marker')}</kbd> marker</span><span><kbd>${a('torpedo')}</kbd> torpedo</span>
    <span><kbd>${a('grip')}</kbd> gripper</span><span><kbd>${a('camera')}</kbd> camera</span><span><kbd>${a('skip')}</kbd> skip task</span><span><kbd>${a('pause')}</kbd> menu</span></div>`;
}
