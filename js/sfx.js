// ═══════════════════════════════════════════════════════════
// sfx.js — Web Audio sound effects (procedural + file-backed)
// File assets: audio/sword.wav, audio/gun2.mp3, audio/dead.m4a
// ═══════════════════════════════════════════════════════════

let _ctx = null;
let _masterGain = null;   // all sounds route through this so volume slider works

function _ac() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = _sfxVol;
    _masterGain.connect(_ctx.destination);
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function _dest() {
  _ac(); // ensures _masterGain exists
  return _masterGain;
}

function _safe(fn) {
  try { fn(_ac(), _dest()); } catch (_) {}
}

// ── Master SFX volume (0–1) ───────────────────────────────
let _sfxVol = 0.7; // default slightly under full to give headroom

export function setSfxVolume(v) {
  _sfxVol = Math.max(0, Math.min(1, v));
  if (_masterGain) _masterGain.gain.value = _sfxVol;
}

export function getSfxVolume() { return _sfxVol; }

// ── File-backed audio buffer cache ───────────────────────
const _bufCache = {};

function _loadBuf(url, cb) {
  if (_bufCache[url]) { cb(_bufCache[url]); return; }
  const ctx = _ac();
  fetch(url)
    .then(r => r.arrayBuffer())
    .then(ab => ctx.decodeAudioData(ab))
    .then(buf => { _bufCache[url] = buf; cb(buf); })
    .catch(() => {}); // silent fallback if file missing
}

function _playFile(url, vol = 1.0, pitch = 1.0) {
  _loadBuf(url, buf => {
    const ctx = _ac();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g); g.connect(_dest()); // route through master
    src.start(ctx.currentTime);
  });
}

// Preload on first user interaction so there's no lag on first swing
export function preloadAudio() {
  _loadBuf('audio/sword.wav',                       () => {});
  _loadBuf('audio/gun2.mp3',                        () => {});
  _loadBuf('audio/dead.m4a',                        () => {});
  _loadBuf('audio/construction.mp3',                () => {});
  _loadBuf('audio/whack.mp3',                       () => {});
  _loadBuf('audio/clickgun.mp3',                    () => {});
  _loadBuf('audio/gun blast.mp3',                   () => {});
  _loadBuf('audio/character-tent/pipehitter.mp3',   () => {});
  _loadBuf('audio/character-tent/imonit.mp3',       () => {});
  _loadBuf('audio/character-tent/comingforus.mp3',  () => {});
  _loadBuf('audio/character-tent/pickingtrash.mp3', () => {});
  _loadBuf('audio/character-tent/piper gets kill.mp3', () => {});
  _loadBuf('audio/character-tent/piper spawned.mp3',   () => {});
}

// ── SCAV character attack sounds ─────────────────────────

// Piper — steel pipe whack on hit
export function sfxPipeHit() {
  _playFile('audio/whack.mp3', 0.85, 0.90 + Math.random() * 0.20);
}

// Slinger — light gun click/pop
export function sfxSlingerShot() {
  _playFile('audio/clickgun.mp3', 0.80, 0.92 + Math.random() * 0.16);
}

// DraKo — heavy blast cannon detonation
export function sfxDrakoBlast() {
  _playFile('audio/gun blast.mp3', 1.0, 0.88 + Math.random() * 0.14);
}

// ── SCAV character voice lines ────────────────────────────
// Each fires with a random throttle so voices don't stack every click.
let _lastVoice = 0;
const VOICE_COOLDOWN = 2.5; // seconds between voice barks

export function sfxVoiceSelect(subtype) {
  const now = performance.now() / 1000;
  if (now - _lastVoice < VOICE_COOLDOWN) return;
  _lastVoice = now;
  if (subtype === 'infantry') {
    _playFile('audio/character-tent/pipehitter.mp3', 0.9);
  } else if (subtype === 'worker') {
    _playFile('audio/character-tent/pickingtrash.mp3', 0.85);
  }
}

export function sfxVoiceMove() {
  const now = performance.now() / 1000;
  if (now - _lastVoice < VOICE_COOLDOWN) return;
  _lastVoice = now;
  _playFile('audio/character-tent/imonit.mp3', 0.9, 0.95 + Math.random() * 0.10);
}

export function sfxVoiceAttack() {
  const now = performance.now() / 1000;
  if (now - _lastVoice < VOICE_COOLDOWN) return;
  _lastVoice = now;
  _playFile('audio/character-tent/comingforus.mp3', 0.9);
}

// Piper gets a kill — taunt line
export function sfxPiperKill() {
  const now = performance.now() / 1000;
  if (now - _lastVoice < VOICE_COOLDOWN) return;
  _lastVoice = now;
  _playFile('audio/character-tent/piper gets kill.mp3', 0.95);
}

// Piper spawned from Mess Hall
export function sfxPiperSpawned() {
  _playFile('audio/character-tent/piper spawned.mp3', 0.9);
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
  _safe((ctx, dest) => {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(840, t + 0.05);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.09);
  });
}

// ── Move order confirmed ──────────────────────────────────
export function sfxMove() {
  _safe((ctx, dest) => {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(280, t + 0.1);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.13);
  });
}

// ── Melee sword swing — real audio file ──────────────────
export function sfxSword() {
  // Slight random pitch variation so repeated hits don't sound robotic
  _playFile('audio/sword.wav', 0.9, 0.92 + Math.random() * 0.16);
}

// ── Ranged gun shot — real audio file ────────────────────
export function sfxShoot() {
  _playFile('audio/gun2.mp3', 0.38, 0.95 + Math.random() * 0.10); // tamed down
}

// ── Legacy alias kept for tower / buildings ───────────────
export function sfxAttack(isRanged = false) {
  if (isRanged) sfxShoot(); else sfxSword();
}

// ── Impact hit (melee landing on flesh/armour) ────────────
export function sfxHit() {
  _safe((ctx, dest) => {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.07);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.1);
  });
}

// ── Unit or building destroyed ────────────────────────────
export function sfxDeath() {
  _playFile('audio/dead.m4a', 0.85, 0.90 + Math.random() * 0.20);
}

// ── Hammering — plays periodically while a worker is building ──
export function sfxHammer() {
  _playFile('audio/construction.mp3', 0.7, 0.92 + Math.random() * 0.16);
}

// ── Building construction complete ───────────────────────
export function sfxBuild() {
  _safe((ctx, dest) => {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = _noiseBuf(ctx, 0.18, 0.4);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    src.connect(f); f.connect(g); g.connect(dest);
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
    o.connect(g2); g2.connect(dest);
    o.start(t); o.stop(t + 0.28);
  });
}

// ── Resource gathered ─────────────────────────────────────
export function sfxGather() {
  _safe((ctx, dest) => {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = _noiseBuf(ctx, 0.14, 0.45);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400;
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t);
  });
}

// ── Can't afford / invalid action ────────────────────────
export function sfxError() {
  _safe((ctx, dest) => {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 140;
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.24);
  });
}

// ── Tower/cannon fire ─────────────────────────────────────
export function sfxTower() {
  _safe((ctx, dest) => {
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
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t);
    // Punch
    const o = ctx.createOscillator();
    const g2 = ctx.createGain();
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.1);
    g2.gain.setValueAtTime(0.2, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g2); g2.connect(dest);
    o.start(t); o.stop(t + 0.13);
  });
}
