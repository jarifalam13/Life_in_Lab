// Keyboard (two layouts on one keyboard) and gamepads. Each player is bound
// to one device; read(device) returns the analogue axes and the action
// buttons that were pressed since the last read (edge-triggered).
// Every binding can be changed by the player (controls screen); the changes
// are kept per device in the browser. Gamepads default to the ArduSub /
// QGroundControl stick layout: left stick = heave + yaw, right = surge + sway.

export const DEVICES = [
  { id: 'kbA', label: 'Keyboard — left (WASD)' },
  { id: 'kbB', label: 'Keyboard — right (arrows)' },
  { id: 'pad0', label: 'Gamepad 1' },
  { id: 'pad1', label: 'Gamepad 2' },
  { id: 'pad2', label: 'Gamepad 3' },
  { id: 'pad3', label: 'Gamepad 4' },
  { id: 'cpu', label: 'CPU (autopilot)' },
];

// one-shot actions (buttons / keys)
export const ACTIONS = [
  { id: 'marker', label: 'Drop marker' },
  { id: 'torpedo', label: 'Fire torpedo' },
  { id: 'grip', label: 'Gripper open / close' },
  { id: 'camera', label: 'Camera: chase / front / down' },
  { id: 'depthHold', label: 'Depth hold on / off' },
  { id: 'skip', label: 'Skip the current task' },
  { id: 'endRun', label: 'End run (keep points)' },
  { id: 'restart', label: 'Forfeit: new run' },
  { id: 'pause', label: 'Pause menu' },
];
// held buttons on a gamepad that drive an axis
export const PAD_HOLDS = [
  { id: 'rollLeft', label: 'Roll left' },
  { id: 'rollRight', label: 'Roll right' },
  { id: 'pitchUp', label: 'Pitch nose up' },
  { id: 'pitchDown', label: 'Pitch nose down' },
];
// keyboard axes: [axis, sign]
export const KEY_AXES = [
  { id: 'surge+', label: 'Forward' }, { id: 'surge-', label: 'Back' },
  { id: 'yaw-', label: 'Turn left' }, { id: 'yaw+', label: 'Turn right' },
  { id: 'sway-', label: 'Strafe left' }, { id: 'sway+', label: 'Strafe right' },
  { id: 'heave+', label: 'Up' }, { id: 'heave-', label: 'Down' },
  { id: 'roll-', label: 'Roll left' }, { id: 'roll+', label: 'Roll right' },
  { id: 'pitch+', label: 'Pitch up' }, { id: 'pitch-', label: 'Pitch down' },
];

// stick layouts: axis -> [gamepad axis index, sign]
export const STICK_PRESETS = {
  ardusub: { label: 'ArduSub / QGC', desc: 'left stick: up-down + turn · right stick: forward + strafe', map: { heave: [1, -1], yaw: [0, 1], surge: [3, -1], sway: [2, 1] } },
  game: { label: 'Game', desc: 'left stick: forward + strafe · right stick: up-down + turn', map: { surge: [1, -1], sway: [0, 1], heave: [3, -1], yaw: [2, 1] } },
  racing: { label: 'Racing', desc: 'left stick: forward + turn · right stick: up-down + strafe', map: { surge: [1, -1], yaw: [0, 1], heave: [3, -1], sway: [2, 1] } },
};

export const DEFAULT_KEYS = {
  kbA: {
    axes: { 'surge+': 'KeyW', 'surge-': 'KeyS', 'yaw+': 'KeyD', 'yaw-': 'KeyA', 'sway+': 'KeyE', 'sway-': 'KeyQ', 'heave+': 'KeyR', 'heave-': 'KeyF', 'roll+': 'KeyX', 'roll-': 'KeyZ', 'pitch+': 'KeyT', 'pitch-': 'KeyG' },
    actions: { marker: 'KeyV', torpedo: 'KeyB', grip: 'KeyC', camera: 'Digit1', depthHold: 'Digit2', endRun: 'Digit3', restart: 'Digit4', skip: 'Digit5', pause: 'Tab' },
    fine: 'ShiftLeft',
  },
  kbB: {
    axes: { 'surge+': 'ArrowUp', 'surge-': 'ArrowDown', 'yaw+': 'ArrowRight', 'yaw-': 'ArrowLeft', 'sway+': 'KeyL', 'sway-': 'KeyJ', 'heave+': 'KeyI', 'heave-': 'KeyK', 'roll+': 'KeyO', 'roll-': 'KeyU', 'pitch+': 'KeyY', 'pitch-': 'KeyH' },
    actions: { marker: 'KeyN', torpedo: 'KeyM', grip: 'Comma', camera: 'Digit7', depthHold: 'Digit8', endRun: 'Digit9', restart: 'Digit0', skip: 'Minus', pause: 'Backspace' },
    fine: 'ShiftRight',
  },
};

// standard-mapping button indices
export const DEFAULT_PAD = {
  sticks: 'ardusub', invertY: false, triggersHeave: true,
  buttons: { marker: 0, torpedo: 1, grip: 2, camera: 3, rollLeft: 4, rollRight: 5, depthHold: 8, pause: 9, endRun: 10, restart: 11, pitchUp: 12, pitchDown: 13, skip: 15 },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const STORE = 'life-as-duburi-controls-v1';

function loadAll() {
  try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && typeof s === 'object') return s; } catch { /* storage unavailable */ }
  return {};
}

// the bindings of one device (defaults + the player's changes)
export function getBindings(device) {
  const saved = loadAll()[device];
  if (device.startsWith('pad')) {
    const b = clone(DEFAULT_PAD);
    if (saved) Object.assign(b, saved, { buttons: { ...b.buttons, ...(saved.buttons || {}) } });
    if (!STICK_PRESETS[b.sticks]) b.sticks = 'ardusub';
    return b;
  }
  const d = clone(DEFAULT_KEYS[device] || DEFAULT_KEYS.kbA);
  if (saved) { Object.assign(d.axes, saved.axes || {}); Object.assign(d.actions, saved.actions || {}); }
  return d;
}

export function saveBindings(device, b) {
  const all = loadAll();
  all[device] = b;
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* ignore */ }
  bindingCache.delete(device);
}

export function resetBindings(device) {
  const all = loadAll();
  delete all[device];
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* ignore */ }
  bindingCache.delete(device);
}

const bindingCache = new Map();
function cached(device) {
  if (!bindingCache.has(device)) bindingCache.set(device, getBindings(device));
  return bindingCache.get(device);
}

// ---- names for the HUD / controls screen ----
export function padStyle(pad) {
  const id = (pad && pad.id || '').toLowerCase();
  return /054c|sony|dualsense|dualshock|playstation|wireless controller/.test(id) ? 'ps' : 'xbox';
}
const PS_NAMES = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'PS'];
const XB_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Guide'];
export function buttonName(i, style = 'ps') {
  if (i == null || i < 0) return '—';
  return (style === 'ps' ? PS_NAMES : XB_NAMES)[i] ?? `Button ${i}`;
}
export function keyName(code) {
  if (!code) return '—';
  const m = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Comma: ',', Period: '.', Minus: '-', Equal: '=', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`', Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab' };
  if (m[code]) return m[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

// [[key, what]] rows for the help screens, from the current bindings
export function helpRows(device, style = 'ps') {
  const label = (id) => (ACTIONS.find((a) => a.id === id) || PAD_HOLDS.find((a) => a.id === id) || {}).label;
  if (device.startsWith('pad')) {
    const b = getBindings(device);
    const P = STICK_PRESETS[b.sticks];
    const rows = [['Sticks', `${P.label}: ${P.desc}${b.invertY ? ' (Y inverted)' : ''}`]];
    if (b.triggersHeave) rows.push([`${buttonName(6, style)} / ${buttonName(7, style)}`, 'down / up']);
    for (const h of PAD_HOLDS) rows.push([buttonName(b.buttons[h.id], style), h.label]);
    for (const a of ACTIONS) rows.push([buttonName(b.buttons[a.id], style), a.label]);
    return rows;
  }
  const b = getBindings(device);
  const rows = [];
  for (let i = 0; i < KEY_AXES.length; i += 2) rows.push([`${keyName(b.axes[KEY_AXES[i].id])} / ${keyName(b.axes[KEY_AXES[i + 1].id])}`, `${KEY_AXES[i].label.toLowerCase()} / ${KEY_AXES[i + 1].label.toLowerCase()}`]);
  for (const a of ACTIONS) rows.push([keyName(b.actions[a.id]), a.label]);
  rows.push([keyName(b.fine), 'hold for fine control']);
  return rows;
}

export const HELP = { get kbA() { return helpRows('kbA'); }, get kbB() { return helpRows('kbB'); }, get pad() { return helpRows('pad0'); } };

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    this.padPrev = {};
    this.onKey = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.code;
      if (e.type === 'keydown') {
        if (!this.down.has(k)) this.pressed.add(k);
        this.down.add(k);
        if (k.startsWith('Arrow') || k === 'Space' || k === 'Tab' || k === 'Backspace') e.preventDefault();
      } else this.down.delete(k);
    };
    this.onBlur = () => this.down.clear();
    target.addEventListener('keydown', this.onKey);
    target.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
  }

  consume(code) { const had = this.pressed.has(code); this.pressed.delete(code); return had; }
  endFrame() { this.pressed.clear(); }
  // forget cached bindings after the controls screen changed them
  reloadBindings() { bindingCache.clear(); }

  pads() { return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : []; }
  pad(device) {
    const idx = +device.slice(3);
    return this.pads().find((p) => p.index === idx) ?? null;
  }

  read(device) {
    const out = { axes: { surge: 0, sway: 0, heave: 0, yaw: 0, roll: 0, pitch: 0 }, actions: [] };
    if (device === 'kbA' || device === 'kbB') {
      const km = cached(device);
      for (const [id, code] of Object.entries(km.axes)) {
        if (!this.down.has(code)) continue;
        const ax = id.slice(0, -1), s = id.endsWith('+') ? 1 : -1;
        out.axes[ax] += s;
      }
      for (const k in out.axes) out.axes[k] = Math.max(-1, Math.min(1, out.axes[k]));
      if (km.fine && this.down.has(km.fine)) for (const k in out.axes) out.axes[k] *= 0.35;
      for (const [act, code] of Object.entries(km.actions)) if (code && this.pressed.has(code)) out.actions.push(act);
      return out;
    }
    if (device.startsWith('pad')) {
      const pad = this.pad(device);
      if (!pad) return out;
      const bnd = cached(device);
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const a = pad.axes;
      for (const [ax, [i, s]] of Object.entries(STICK_PRESETS[bnd.sticks].map)) {
        const inv = bnd.invertY && (i === 1 || i === 3) ? -1 : 1;
        out.axes[ax] = s * inv * dz(a[i] || 0);
      }
      const b = (i) => (i >= 0 && pad.buttons[i] ? pad.buttons[i].value > 0.5 || pad.buttons[i].pressed : false);
      const B = bnd.buttons;
      out.axes.roll = (b(B.rollRight) ? 1 : 0) - (b(B.rollLeft) ? 1 : 0);
      out.axes.pitch = (b(B.pitchUp) ? 1 : 0) - (b(B.pitchDown) ? 1 : 0);
      // triggers also work for up / down
      if (bnd.triggersHeave) {
        const lt = pad.buttons[6]?.value || 0, rt = pad.buttons[7]?.value || 0;
        if (Math.abs(out.axes.heave) < 0.05) out.axes.heave = rt - lt;
      }
      const prev = this.padPrev[device] || [];
      const now = pad.buttons.map((x) => x.pressed);
      for (const act of ACTIONS) { const i = B[act.id]; if (i >= 0 && now[i] && !prev[i]) out.actions.push(act.id); }
      this.padPrev[device] = now;
    }
    return out;
  }

  // New gamepad button presses on every connected pad since the last call
  // (menus and the join lobby): [{ pad: index, button }]
  padPresses() {
    const out = [];
    this.navPrev = this.navPrev || {};
    for (const pad of this.pads()) {
      const prev = this.navPrev[pad.index] || [];
      const now = pad.buttons.map((b) => b.pressed || b.value > 0.5);
      // left stick as a d-pad for menus
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      now[12] = now[12] || ay < -0.6; now[13] = now[13] || ay > 0.6; now[14] = now[14] || ax < -0.6; now[15] = now[15] || ax > 0.6;
      now.forEach((v, i) => { if (v && !prev[i]) out.push({ pad: pad.index, button: i }); });
      this.navPrev[pad.index] = now;
    }
    return out;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
  }
}
