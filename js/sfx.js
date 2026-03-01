// ═══════════════════════════════════════════════════════════
// sfx.js — procedural Web Audio sound effects
// All sounds synthesized at runtime — no asset files needed.
// Mirrors Warcraft's audio feedback loop: every action has a sound.
// ═══════════════════════════════════════════════════════════

let _ctx = null;

function _ac() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function _safe(fn) {
  try { fn(_ac()); } catch (_) {}
}

// Shared noise buffer helper — brown-ish noise burst
function _noiseBuf(ctx, dur, decay = 0.3) {
  const n    = Math.ceil(ctx.sampleRate * dur);
  const buf  = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++)
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * decay));
  return buf;
}

// ── Unit selected ─────────────────────────────────────────
export function sfxSelect() {
  _safe(ctx => {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(840, t + 0.05);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.09);
  });
}

// ── Move order confirmed ──────────────────────────────────
export function sfxMove() {
  _safe(ctx => {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(280, t + 0.1);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.13);
  });
}

// ── Ranged / melee attack fired ───────────────────────────
export function sfxAttack(isRanged = false) {
  _safe(ctx => {
    const t   = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = _noiseBuf(ctx, 0.1, 0.25);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = isRanged ? 900 : 350;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(isRanged ? 0.22 : 0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    src.start(t);
  });
}

// ── Impact hit ────────────────────────────────────────────
export function sfxHit() {
  _safe(ctx => {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.07);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.1);
  });
}

// ── Unit or building destroyed ────────────────────────────
export function sfxDeath() {
  _safe(ctx => {
    const t = ctx.currentTime;
    // Noise burst
    const src = ctx.createBufferSource();
    src.buffer = _noiseBuf(ctx, 0.5, 0.2);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 250;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.38, t);
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    src.start(t);
    // Low boom
    const o = ctx.createOscillator();
    const g2 = ctx.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(18, t + 0.35);
    g2.gain.setValueAtTime(0.28, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g2); g2.connect(ctx.destination);
    o.start(t); o.stop(t + 0.42);
  });
}

// ── Building construction complete ───────────────────────
export function sfxBuild() {
  _safe(ctx => {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = _noiseBuf(ctx, 0.18, 0.4);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    src.start(t);
    // Rising ping
    const o = ctx.createOscillator();
    const g2 = ctx.createGain();
    o.type = 'triangle';
    [0.04, 0.10, 0.17].forEach((dt, i) => {
      const freq = [440, 550, 660][i];
      o.frequency.setValueAtTime(freq, t + dt);
      g2.gain.setValueAtTime(0.09, t + dt);
      g2.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.06);
    });
    o.connect(g2); g2.connect(ctx.destination);
    o.start(t); o.stop(t + 0.28);
  });
}

// ── Resource gathered ─────────────────────────────────────
export function sfxGather() {
  _safe(ctx => {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = _noiseBuf(ctx, 0.14, 0.45);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400;
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    src.start(t);
  });
}

// ── Can't afford / invalid action ────────────────────────
export function sfxError() {
  _safe(ctx => {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 140;
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.24);
  });
}

// ── Tower/cannon fire ─────────────────────────────────────
export function sfxTower() {
  _safe(ctx => {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = _noiseBuf(ctx, 0.14, 0.15);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 600;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    src.start(t);
    // Punch
    const o = ctx.createOscillator();
    const g2 = ctx.createGain();
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.1);
    g2.gain.setValueAtTime(0.2, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g2); g2.connect(ctx.destination);
    o.start(t); o.stop(t + 0.13);
  });
}
