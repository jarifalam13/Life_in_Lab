// Small WebAudio sound set: hydrophone pings (the real pingers are 25-40 kHz,
// shifted down here so you can hear them), thruster whine, score chimes and
// the breach buzzer. Everything is synthesised; nothing is downloaded.

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.6;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    // thruster whine: filtered sawtooth + noise, gain follows thrust
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = 90;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 4;
    this.motorGain = this.ctx.createGain();
    this.motorGain.gain.value = 0;
    o.connect(f).connect(this.motorGain).connect(this.master);
    o.start();
    this.motorOsc = o; this.motorFilter = f;
    return true;
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume; }

  motor(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const l = Math.min(1, Math.max(0, level));
    this.motorGain.gain.setTargetAtTime(0.05 * l, t, 0.08);
    this.motorOsc.frequency.setTargetAtTime(70 + 160 * l, t, 0.1);
    this.motorFilter.frequency.setTargetAtTime(300 + 1400 * l, t, 0.1);
  }

  tone(freq, dur, { type = 'sine', gain = 0.25, when = 0, slide = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  ping(freqKHz, loud, pan = 0) {
    if (!this.ctx || this.muted || loud < 0.02) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    o.frequency.value = 1400 + (freqKHz - 25) * 60;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18 * loud, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); o.connect(g).connect(p).connect(this.master); } else o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.12);
  }

  score() { this.tone(660, 0.12, { type: 'triangle', gain: 0.2 }); this.tone(990, 0.18, { type: 'triangle', gain: 0.2, when: 0.09 }); }
  bad() { this.tone(180, 0.45, { type: 'square', gain: 0.12, slide: 0.6 }); }
  click() { this.tone(1200, 0.05, { type: 'square', gain: 0.05 }); }
  launch() { this.tone(300, 0.25, { type: 'sawtooth', gain: 0.08, slide: 2.5 }); }
  drop() { this.tone(500, 0.15, { type: 'sine', gain: 0.12, slide: 0.5 }); }
  bump(k) { this.tone(90, 0.12, { type: 'sine', gain: Math.min(0.3, 0.1 * k) }); }
}
