// Per-player heads-up display laid over that player's split-screen viewport,
// plus the shared competition clock. Plain DOM, refreshed ~15 times a second.

import { TASK_KEYS, TASK_LABEL } from '../sim/game.js';
import { animalIcon } from '../render/art.js';
import { ARENA } from '../sim/course.js';
import { SCENARIOS } from '../sim/scenarios.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const deg = (r) => ((r * 180) / Math.PI + 360) % 360;

export class HUD {
  constructor(root, game, { logoUrl, cams }) {
    this.game = game;
    this.cams = cams;
    this.root = h('div', 'hud');
    root.appendChild(this.root);
    this.top = h('div', 'hud-clock');
    this.top.innerHTML = `${logoUrl ? `<img src="${logoUrl}" alt="DUBURI">` : ''}<div><b class="clock">15:00</b><span>${SCENARIOS[game.scenario].name} · ${game.depth} m deep</span></div>`;
    // leaderboard for the TV-camera quarter (3 players)
    this.board = h('div', 'lboard');
    this.board.hidden = true;
    this.root.appendChild(this.board);
    this.clock = this.top.querySelector('.clock');
    this.root.appendChild(this.top);
    this.icons = { shark: animalIcon('shark', 28), sawfish: animalIcon('sawfish', 28) };
    this.panels = game.players.map((p) => this.makePanel(p));
    this.acc = 1;
    this.minimapBg = this.drawMinimapBg();
  }

  makePanel(p) {
    const el = h('div', 'pp');
    el.style.setProperty('--pc', p.color);
    el.innerHTML = `
      <div class="pp-tl"><i class="dot"></i><div><b class="nm"></b><span class="bot"></span></div><div class="sc"><b class="score">0</b><span class="best"></span></div></div>
      <div class="pp-tr"><div class="row"><span>Depth</span><b class="depth">0.00 m</b></div><div class="row"><span>Heading</span><b class="hdg">000°</b></div><div class="row"><span>Speed</span><b class="spd">0.00 m/s</b></div><div class="row"><span>Net buoy.</span><b class="buoy"></b></div><div class="tags"><em class="hold">DEPTH HOLD</em><em class="cam">CHASE</em></div><svg class="att" viewBox="-30 -30 60 60"><circle r="27" class="att-ring"/><g class="att-g"><rect x="-40" y="0" width="80" height="40" class="att-ground"/><line x1="-27" x2="27" y1="0" y2="0"/></g><path d="M-14 0 h9 l5 5 l5 -5 h9" class="att-ac"/></svg></div>
      <div class="pp-bl"><div class="tasks"></div></div>
      <div class="pp-br"><canvas class="mm" width="200" height="110"></canvas><div class="pay"><span>Markers <b class="mk"></b></span><span>Torpedoes <b class="tp"></b></span><span>Gripper <b class="gp"></b></span></div></div>
      <div class="pp-bc"><svg class="hydro" viewBox="-50 -50 100 100"><circle r="44" class="ring"/><text y="-34" class="n">FWD</text><g class="pg pg0"><path d="M0 -40 L6 -28 L-6 -28 Z"/></g><g class="pg pg1"><path d="M0 -40 L6 -28 L-6 -28 Z"/></g><circle r="3" class="me"/></svg><div class="hydro-l"><span class="l0"></span><span class="l1"></span></div></div>
      <div class="pp-toasts"></div>
      <div class="pp-banner" hidden></div>`;
    this.root.appendChild(el);
    const q = (s) => el.querySelector(s);
    const P = { el, p, q, toasts: q('.pp-toasts'), banner: q('.pp-banner'), mm: q('.mm'), last: {} };
    q('.nm').textContent = p.name;
    q('.bot').textContent = p.design.name;
    P.tasks = {};
    const tl = q('.tasks');
    for (const k of TASK_KEYS) {
      const r = h('div', 'task', `<i></i><span>${TASK_LABEL[k]}</span><b>0</b>`);
      tl.appendChild(r);
      P.tasks[k] = r;
    }
    P.chosen = h('div', 'chosen');
    tl.prepend(P.chosen);
    return P;
  }

  layout(rects) {
    this.panels.forEach((P, i) => {
      const r = rects[i];
      Object.assign(P.el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      P.el.classList.toggle('small', r.w < 700 || r.h < 420);
      P.el.classList.toggle('tiny', r.w < 480 || r.h < 300);
    });
    // split screen: the shared clock sits where the viewports meet
    this.top.classList.toggle('center', rects.filter((r) => r.w > 0).length > 1);
  }

  toast(i, text, pts, kind) {
    const P = this.panels[i];
    if (!P) return;
    const t = h('div', `toast ${kind}`, `${pts ? `<b>+${pts}</b>` : ''}<span></span>`);
    t.querySelector('span').textContent = text;
    P.toasts.prepend(t);
    while (P.toasts.children.length > 4) P.toasts.lastChild.remove();
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3800);
  }

  update(dt) {
    const g = this.game;
    this.clock.textContent = fmtTime(g.remaining());
    this.clock.classList.toggle('low', g.remaining() < 60);
    this.acc += dt;
    const full = this.acc > 1 / 20;
    if (full) this.acc = 0;
    if (full && this.boardRect) this.drawBoard();
    this.panels.forEach((P, i) => {
      const p = P.p, v = p.veh, r = p.run;
      if (!full || P.el.hidden) return;
      const [roll, pitch, yaw] = v.euler();
      P.q('.att-g').setAttribute('transform', `rotate(${(-roll * 180) / Math.PI}) translate(0 ${pitch * 40})`);
      for (let k = 0; k < 2; k++) {
        const b = g.pingerBearing(p, g.course.pingers[k].id);
        P.q(`.pg${k}`).setAttribute('transform', `rotate(${(b.rel * 180) / Math.PI})`);
        P.q(`.l${k}`).textContent = `${g.course.pingers[k].freq} kHz ${g.course.pingers[k].id === 'octagon' ? 'Octagon' : 'Torpedo'} · ${b.dist.toFixed(1)} m`;
      }
      this.drawMinimap(P, p);
      const total = g.total(p);
      P.q('.score').textContent = total.toLocaleString();
      P.q('.best').textContent = p.runs.length ? `best ${Math.max(p.best, total).toLocaleString()}` : `run ${p.runs.length + 1}`;
      P.q('.depth').textContent = `${Math.max(0, v.depth).toFixed(2)} m`;
      P.q('.hdg').textContent = `${String(Math.round(deg(yaw)) % 360).padStart(3, '0')}°`;
      P.q('.spd').textContent = `${v.speed().toFixed(2)} m/s`;
      const net = v.diag.net ?? 0;
      P.q('.buoy').textContent = `${net >= 0 ? '+' : ''}${(v.diag.submerged > 0.98 ? net : (v.volume * v.diag.rho * g.env.g - v.mass * g.env.g)).toFixed(1)} N`;
      P.q('.hold').classList.toggle('off', !v.depthHold);
      P.q('.cam').textContent = (this.cams[i] || 'chase').toUpperCase();
      P.q('.mk').textContent = '▮'.repeat(r.markers) + '▯'.repeat(2 - r.markers);
      P.q('.tp').textContent = '▮'.repeat(r.torpedoes) + '▯'.repeat(2 - r.torpedoes);
      P.q('.gp').textContent = r.held ? `holding ${r.held.kind}` : 'open';
      for (const k of TASK_KEYS) {
        const val = r.scores[k] || 0;
        const row = P.tasks[k];
        if (P.last[k] !== val) { row.querySelector('b').textContent = val; row.classList.toggle('done', val > 0); P.last[k] = val; }
      }
      const slOk = r.slalomBest.filter((x) => x > 0).length;
      P.tasks.slalom.querySelector('span').textContent = `Slalom ${slOk}/3`;
      if (P.last.chosen !== r.chosen) {
        P.last.chosen = r.chosen;
        P.chosen.innerHTML = r.chosen ? `Chosen: <img src="${this.icons[r.chosen]}" alt=""> ${r.chosen === 'shark' ? 'Reef shark' : 'Sawfish'}` : 'Pass the gate first';
      }
      if (r.state !== 'running') {
        P.banner.hidden = false;
        const bad = r.reason.startsWith('Breach');
        P.banner.className = `pp-banner ${bad ? 'bad' : ''}`;
        P.banner.innerHTML = `<b>${bad ? 'BREACH' : r.finished ? 'RUN COMPLETE' : 'RUN ENDED'}</b><span></span><em>${total.toLocaleString()} pts</em><small>${g.over || p.left ? '' : 'Forfeit for a new run: 4 · 0 · R3 · or your pause menu'}</small>`;
        P.banner.querySelector('span').textContent = r.reason;
      } else P.banner.hidden = true;
    });
  }

  drawMinimapBg() {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 220;
    const g = c.getContext('2d'), co = this.game.course;
    const sx = c.width / ARENA.length, sy = c.height / ARENA.width;
    // north to the right: x (north) -> canvas x, y (east) -> canvas y (down)
    const P = (x, y) => [(x + ARENA.length / 2) * sx, (y + ARENA.width / 2) * sy];
    g.fillStyle = 'rgba(8,30,44,0.75)'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.strokeRect(1, 1, c.width - 2, c.height - 2);
    const dot = (p, r, col) => { const [x, y] = P(p[0], p[1]); g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    const [dx, dy] = P(co.dock.pos[0], co.dock.pos[1]); g.strokeStyle = '#fff'; g.beginPath(); g.arc(dx, dy, co.dock.radius * sx, 0, Math.PI * 2); g.stroke();
    // gate
    const G = co.gate; g.strokeStyle = '#e33'; g.lineWidth = 4;
    const a = P(G.pos[0] - G.right[0] * 1.5, G.pos[1] - G.right[1] * 1.5), b = P(G.pos[0] + G.right[0] * 1.5, G.pos[1] + G.right[1] * 1.5);
    g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
    for (const pth of co.paths) { g.strokeStyle = '#ff7a00'; g.lineWidth = 3; const p0 = P(pth.pos[0], pth.pos[1]), p1 = P(pth.pos[0] + Math.cos(pth.heading) * 1.4, pth.pos[1] + Math.sin(pth.heading) * 1.4); g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.stroke(); }
    for (const s of co.slalom.sets) for (const pp of s.pipes) dot(pp.p, 3, pp.color === 'red' ? '#e33' : '#fff');
    dot(co.bin.pos, 6, '#ddd');
    dot(co.board.pos, 6, '#4fd1c5');
    const [ox, oy] = P(co.octagon.pos[0], co.octagon.pos[1]); g.strokeStyle = '#ff8a1f'; g.lineWidth = 3; g.beginPath(); g.arc(ox, oy, co.octagon.radius * sx, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '16px sans-serif'; g.fillText('N →', c.width - 44, 20);
    return { c, P };
  }

  drawMinimap(P, me) {
    const cv = P.mm, g = cv.getContext('2d');
    const bg = this.minimapBg;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(bg.c, 0, 0, cv.width, cv.height);
    const k = cv.width / bg.c.width;
    for (const p of this.game.players) {
      const [x, y] = bg.P(p.veh.p[0], p.veh.p[1]);
      const yaw = p.veh.euler()[2];
      g.save();
      g.translate(x * k, y * k);
      g.rotate(yaw);
      g.fillStyle = p.color;
      g.strokeStyle = p === me ? '#fff' : 'rgba(0,0,0,0.6)';
      g.lineWidth = p === me ? 2 : 1;
      g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, 5); g.lineTo(-5, -5); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  }

  // place the leaderboard over a viewport rect (or hide it)
  setBoard(rect) {
    this.boardRect = rect;
    this.board.hidden = !rect;
    if (rect) Object.assign(this.board.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  }

  drawBoard() {
    const g = this.game;
    const names = { gate: 'Gate', slalom: 'Slalom', bin: 'Bin', torpedo: 'Torpedoes', octagon: 'Octagon', home: 'Return home' };
    const rows = [...g.players].sort((a, b) => Math.max(b.best, g.total(b)) - Math.max(a.best, g.total(a))).map((p, i) => {
      const r = p.run;
      const st = p.left ? 'left' : r.state !== 'running' ? (r.finished ? 'done' : 'run ended') : names[g.currentTask(p)];
      return `<tr style="--pc:${p.color}"><td>${i + 1}</td><td><i class="dot"></i>${esc(p.name)}<small>${esc(p.design.name)}</small></td><td>${st}</td><td><b>${Math.max(p.best, g.total(p)).toLocaleString()}</b></td></tr>`;
    }).join('');
    this.board.innerHTML = `<div class="lb-in"><h3>Live standings</h3><table>${rows}</table><p>TV camera follows the leader</p></div>`;
  }

  dispose() { this.root.remove(); }
}
