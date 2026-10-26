// Keyboard (two layouts on one keyboard) and gamepads. Each player is bound
// to one device; read(device) returns the analogue axes and the action
// buttons that were pressed since the last read (edge-triggered).
// Gamepads use the ArduSub / QGroundControl default stick layout: left stick
// = heave + yaw, right stick = surge + sway.

export const DEVICES = [
  { id: 'kbA', label: 'Keyboard — left (WASD)' },
  { id: 'kbB', label: 'Keyboard — right (arrows)' },
  { id: 'pad0', label: 'Gamepad 1' },
  { id: 'pad1', label: 'Gamepad 2' },
  { id: 'pad2', label: 'Gamepad 3' },
  { id: 'pad3', label: 'Gamepad 4' },
  { id: 'cpu', label: 'CPU (autopilot)' },
];

export const KEYMAPS = {
  kbA: {
    axes: { surge: ['KeyW', 'KeyS'], yaw: ['KeyD', 'KeyA'], sway: ['KeyE', 'KeyQ'], heave: ['KeyR', 'KeyF'], roll: ['KeyX', 'KeyZ'], pitch: ['KeyT', 'KeyG'] },
    actions: { marker: 'KeyV', torpedo: 'KeyB', grip: 'KeyC', camera: 'Digit1', depthHold: 'Digit2', endRun: 'Digit3', restart: 'Digit4', skip: 'Digit5', pause: 'Tab' },
  },
  kbB: {
    axes: { surge: ['ArrowUp', 'ArrowDown'], yaw: ['ArrowRight', 'ArrowLeft'], sway: ['KeyL', 'KeyJ'], heave: ['KeyI', 'KeyK'], roll: ['KeyO', 'KeyU'], pitch: ['KeyY', 'KeyH'] },
    actions: { marker: 'KeyN', torpedo: 'KeyM', grip: 'Comma', camera: 'Digit7', depthHold: 'Digit8', endRun: 'Digit9', restart: 'Digit0', skip: 'Minus', pause: 'Backspace' },
  },
};

export const HELP = {
  kbA: [['W / S', 'forward / back'], ['A / D', 'turn left / right'], ['Q / E', 'strafe left / right'], ['R / F', 'up / down'], ['Z / X', 'roll (gate style)'], ['T / G', 'pitch (gate style)'], ['V', 'drop marker'], ['B', 'fire torpedo'], ['C', 'gripper open / close'], ['1', 'camera: chase / front / down'], ['2', 'depth hold on / off'], ['3', 'end run (keep points)'], ['4', 'forfeit: new run (lose points)'], ['5', 'skip the current task'], ['Tab / Esc', 'your pause menu']],
  kbB: [['↑ / ↓', 'forward / back'], ['← / →', 'turn left / right'], ['J / L', 'strafe left / right'], ['I / K', 'up / down'], ['U / O', 'roll (gate style)'], ['Y / H', 'pitch (gate style)'], ['N', 'drop marker'], ['M', 'fire torpedo'], [',', 'gripper open / close'], ['7', 'camera'], ['8', 'depth hold'], ['9', 'end run'], ['0', 'forfeit: new run'], ['-', 'skip task'], ['Backspace', 'your pause menu']],
  pad: [['Left stick ↕', 'up / down'], ['Left stick ↔', 'turn'], ['Right stick ↕', 'forward / back'], ['Right stick ↔', 'strafe'], ['LB / RB', 'roll'], ['D-pad ↕', 'pitch'], ['✕ / A', 'drop marker'], ['○ / B', 'fire torpedo'], ['□ / X', 'gripper'], ['△ / Y', 'camera'], ['Share / Back', 'depth hold'], ['L3', 'end run'], ['R3', 'forfeit: new run'], ['Start / Options', 'your pause menu (skip, forfeit, leave)']],
};

const PAD_ACTIONS = { 0: 'marker', 1: 'torpedo', 2: 'grip', 3: 'camera', 8: 'depthHold', 10: 'endRun', 11: 'restart', 9: 'pause' };

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

  pads() { return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : []; }

  read(device) {
    const out = { axes: { surge: 0, sway: 0, heave: 0, yaw: 0, roll: 0, pitch: 0 }, actions: [] };
    const km = KEYMAPS[device];
    if (km) {
      for (const [ax, [pos, neg]] of Object.entries(km.axes)) out.axes[ax] = (this.down.has(pos) ? 1 : 0) - (this.down.has(neg) ? 1 : 0);
      // hold Shift (left) / right Shift for fine control
      if ((device === 'kbA' && this.down.has('ShiftLeft')) || (device === 'kbB' && this.down.has('ShiftRight'))) for (const k in out.axes) out.axes[k] *= 0.35;
      for (const [act, code] of Object.entries(km.actions)) if (this.pressed.has(code)) out.actions.push(act);
      return out;
    }
    if (device.startsWith('pad')) {
      const idx = +device.slice(3);
      const pad = this.pads().find((p) => p.index === idx) ?? this.pads()[idx];
      if (!pad) return out;
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const a = pad.axes;
      out.axes.heave = -dz(a[1] || 0);
      out.axes.yaw = dz(a[0] || 0);
      out.axes.surge = -dz(a[3] || 0);
      out.axes.sway = dz(a[2] || 0);
      const b = (i) => (pad.buttons[i] ? pad.buttons[i].value > 0.5 || pad.buttons[i].pressed : false);
      out.axes.roll = (b(5) ? 1 : 0) - (b(4) ? 1 : 0);
      out.axes.pitch = (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
      // triggers also work for up / down
      const lt = pad.buttons[6]?.value || 0, rt = pad.buttons[7]?.value || 0;
      if (Math.abs(out.axes.heave) < 0.05) out.axes.heave = rt - lt;
      const prev = this.padPrev[device] || [];
      const now = pad.buttons.map((x) => x.pressed);
      for (const [i, act] of Object.entries(PAD_ACTIONS)) if (now[i] && !prev[i]) out.actions.push(act);
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
