// ═══════════════════════════════════════════════════════════
// architect/mapgen.js — Terrain generation library
//
// Terrain vocabulary for TentCraft (replaces Warcraft's tileset):
//
//   CONCRETE  = Warcraft's  Grass    — default passable ground
//   CRACKED   = Warcraft's  Dirt     — passable, lighter patchy asphalt
//   SLUDGE    = Warcraft's  Water    — IMPASSABLE toxic waste pools
//   RUBBLE    = Warcraft's  Rock     — IMPASSABLE collapsed building debris
//   TRASH     = Warcraft's  Forest   — IMPASSABLE rummage-able trash heaps
//
// Usage (ES module in browser):
//   import { T, generateGreatDivide } from '../architect/mapgen.js';
//
// Usage (Node.js for offline generation):
//   const { T, generateGreatDivide } = require('./mapgen.cjs');
// ═══════════════════════════════════════════════════════════

// ── Terrain type enum ────────────────────────────────────
export const T = {
  CONCRETE : 0,  // Dark grey asphalt — walkable
  CRACKED  : 1,  // Light cracked concrete — walkable
  SLUDGE   : 2,  // Toxic waste pool — IMPASSABLE
  RUBBLE   : 3,  // Collapsed building debris — IMPASSABLE
  TRASH    : 4,  // Rummage-able trash heap — IMPASSABLE (harvestable)
};

export const T_PASSABLE = new Set([T.CONCRETE, T.CRACKED]);

// Tile colors used by the viewer and terrain texture
export const T_COLOR = {
  [T.CONCRETE]: '#1a1612',
  [T.CRACKED]:  '#28201a',
  [T.SLUDGE]:   '#0e1a0a',
  [T.RUBBLE]:   '#2e2820',
  [T.TRASH]:    '#1e180a',
};

// ── Seeded PRNG (Mulberry32) ──────────────────────────────
export function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Value noise (2D) ─────────────────────────────────────
// Simple grid-based value noise with bilinear interpolation.
function _makeNoiseGrid(w, h, freq, rng) {
  const gw = Math.ceil(w * freq) + 2;
  const gh = Math.ceil(h * freq) + 2;
  const g  = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return { g, gw, gh, freq };
}

function _sampleNoise(grid, x, y) {
  const { g, gw, freq } = grid;
  const fx = x * freq, fy = y * freq;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix,    ty = fy - iy;
  // Smoothstep
  const ux = tx * tx * (3 - 2 * tx);
  const uy = ty * ty * (3 - 2 * ty);
  const a = g[(iy    ) * gw + ix    ] ?? 0;
  const b = g[(iy    ) * gw + ix + 1] ?? 0;
  const c = g[(iy + 1) * gw + ix    ] ?? 0;
  const d = g[(iy + 1) * gw + ix + 1] ?? 0;
  return a + (b - a) * ux + (c - a) * uy + (d - b + a - c) * ux * uy;
}

export function noise2d(x, y, freq, rng) {
  const grid = _makeNoiseGrid(1, 1, freq, rng);
  return _sampleNoise(grid, x, y);
}

// Layered noise (octaves) for more natural-looking terrain
function _fbm(x, y, freq, octaves, rng) {
  let v = 0, amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    v     += _sampleNoise(_makeNoiseGrid(1, 1, freq * (1 << o), rng), x, y) * amp;
    total += amp;
    amp   *= 0.5;
  }
  return v / total;
}

// ── Cellular automata smoothing ───────────────────────────
// Majority-vote: a tile becomes the most common type among its 8 neighbours.
// Creates organic blob shapes from noisy initial seeds.
export function cellularSmooth(tiles, w, h, iterations = 2) {
  const out = new Uint8Array(tiles);
  for (let iter = 0; iter < iterations; iter++) {
    const src = new Uint8Array(out);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const counts = [0, 0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            counts[src[(y + dy) * w + (x + dx)]]++;
        out[y * w + x] = counts.indexOf(Math.max(...counts));
      }
    }
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────
function _fillRect(tiles, w, x0, y0, x1, y1, type) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (x >= 0 && y >= 0 && x < w && y < Math.ceil(tiles.length / w))
        tiles[y * w + x] = type;
}

// Clear a radius around a point (base-clear, start areas)
function _clearCircle(tiles, w, cx, cy, r, type) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r)
        if (x >= 0 && y >= 0 && x < w)
          tiles[y * w + x] = type;
    }
}

// ═══════════════════════════════════════════════════════════
// MAP GENERATORS
// Each returns Uint8Array of size w*h with T.* values.
// ═══════════════════════════════════════════════════════════

// ── THE GREAT DIVIDE (1v1 standard) ──────────────────────
// Layout mirrors the WC2 screenshot the user shared:
//   • SCAV base — left side, concrete clearing
//   • GILD base — right side, concrete clearing
//   • Trash heap "forests" — top/bottom flanks (like WC2 tree lines)
//   • Sludge pools — scattered central zone
//   • Rubble outcroppings — chokepoint defenders
//   • Cracked concrete roads — connecting paths
export function generateGreatDivide(w, h, seed = 1337) {
  const rng   = mulberry32(seed);
  const rng2  = mulberry32(seed + 7777);
  const rng3  = mulberry32(seed + 3131);
  const tiles = new Uint8Array(w * h).fill(T.CONCRETE);

  // ── Pass 1: Trash heap flanks (top 28%, bottom 28%) ────
  // Dense trash coverage in the flanks — like WC2's forest belts.
  const tGrid = _makeNoiseGrid(w, h, 0.12, rng);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ny   = y / h;
      // flank strength: strong at edges, fades at center
      const fTop = 1 - ny / 0.28;
      const fBot = (ny - 0.72) / 0.28;
      const fStr = Math.max(fTop, fBot, 0);
      if (fStr <= 0) continue;
      const n = _sampleNoise(tGrid, x, y);
      if (n < 0.52 - fStr * 0.18) tiles[y * w + x] = T.TRASH;
    }
  }

  // ── Pass 2: Mid-corridor sludge pools ──────────────────
  // Toxic pools cluster in the contested center — punishes crossing in a straight line.
  const sGrid = _makeNoiseGrid(w, h, 0.09, rng2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] !== T.CONCRETE) continue;
      const nx = x / w, ny = y / h;
      // Sludge only spawns in the center column, mid-height band
      const inCtr = Math.abs(nx - 0.5) < 0.22 && ny > 0.22 && ny < 0.78;
      if (!inCtr) continue;
      const n = _sampleNoise(sGrid, x, y);
      if (n < 0.32) tiles[y * w + x] = T.SLUDGE;
    }
  }

  // ── Pass 3: Rubble outcroppings at chokepoints ─────────
  const rGrid = _makeNoiseGrid(w, h, 0.15, rng3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] !== T.CONCRETE) continue;
      const nx = x / w;
      // Rubble near the quarter-lines (natural chokepoints)
      const nearChoke = Math.abs(nx - 0.26) < 0.05 || Math.abs(nx - 0.74) < 0.05;
      if (!nearChoke) continue;
      const n = _sampleNoise(rGrid, x, y);
      if (n < 0.38) tiles[y * w + x] = T.RUBBLE;
    }
  }

  // ── Pass 4: Cracked concrete roads ─────────────────────
  // Horizontal main road (mid-height)
  _fillRect(tiles, w, 0, Math.floor(h * 0.44), w, Math.floor(h * 0.56), T.CRACKED);
  // Vertical access road (mid-width)
  _fillRect(tiles, w, Math.floor(w * 0.47), 0, Math.floor(w * 0.53), h, T.CRACKED);

  // ── Pass 5: Cellular automata — organic blobs ──────────
  const smoothed = cellularSmooth(tiles, w, h, 3);
  smoothed.set(smoothed); // in-place

  // ── Pass 6: Clear base zones — ALWAYS passable ─────────
  // SCAV base (left)  — tile ~(13, 60)
  _clearCircle(smoothed, w, 13,  60, 18, T.CONCRETE);
  // GILD base (right) — tile ~(105, 60)
  _clearCircle(smoothed, w, 105, 60, 18, T.CONCRETE);
  // Also clear a strip along the main road so it never gets blocked
  _fillRect(smoothed, w, 0, Math.floor(h * 0.44), w, Math.floor(h * 0.56), T.CRACKED);

  // ── Pass 7: Border trash wall ──────────────────────────
  const border = 3;
  _fillRect(smoothed, w, 0, 0, w, border, T.TRASH);
  _fillRect(smoothed, w, 0, h - border, w, h, T.TRASH);
  _fillRect(smoothed, w, 0, 0, border, h, T.TRASH);
  _fillRect(smoothed, w, w - border, 0, w, h, T.TRASH);

  return smoothed;
}

// ── LANDFILL CIRCUIT (locked — future map) ────────────────
export function generateLandfillCircuit(w, h, seed = 8888) {
  // Circular landfill layout: sludge moat around a central resource cluster
  const rng   = mulberry32(seed);
  const tiles = new Uint8Array(w * h).fill(T.CONCRETE);
  const cx = w / 2, cy = h / 2;

  const grid = _makeNoiseGrid(w, h, 0.1, rng);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / (w * 0.5);
      const dy = (y - cy) / (h * 0.5);
      const r  = Math.sqrt(dx * dx + dy * dy);
      const n  = _sampleNoise(grid, x, y);
      // Moat ring
      if (Math.abs(r - 0.45) < 0.12 + n * 0.08) tiles[y * w + x] = T.SLUDGE;
      // Outer trash ring
      if (r > 0.75 && n < 0.45) tiles[y * w + x] = T.TRASH;
      // Central rubble island
      if (r < 0.15 && n < 0.5) tiles[y * w + x] = T.RUBBLE;
    }
  }
  _clearCircle(tiles, w, 8,    cy, 14, T.CONCRETE);
  _clearCircle(tiles, w, w-8,  cy, 14, T.CONCRETE);
  _fillRect(tiles, w, 0, 0, w, 2, T.TRASH);
  _fillRect(tiles, w, 0, h-2, w, h, T.TRASH);
  return cellularSmooth(tiles, w, h, 2);
}

// ── THE BREADLINE (locked — future map) ───────────────────
export function generateBreadline(w, h, seed = 4242) {
  // Narrow horizontal map — single central resource queue
  const rng   = mulberry32(seed);
  const tiles = new Uint8Array(w * h).fill(T.CONCRETE);
  const grid  = _makeNoiseGrid(w, h, 0.11, rng);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ny = y / h;
      const n  = _sampleNoise(grid, x, y);
      if ((ny < 0.18 || ny > 0.82) && n < 0.5) tiles[y * w + x] = T.TRASH;
      if (ny > 0.2 && ny < 0.8 && n < 0.2) tiles[y * w + x] = T.SLUDGE;
    }
  }
  _clearCircle(tiles, w, 10, Math.floor(h * 0.5), 12, T.CONCRETE);
  _clearCircle(tiles, w, w-10, Math.floor(h * 0.5), 12, T.CONCRETE);
  _fillRect(tiles, w, 0, 0, w, 2, T.TRASH);
  _fillRect(tiles, w, 0, h-2, w, h, T.TRASH);
  return cellularSmooth(tiles, w, h, 2);
}
