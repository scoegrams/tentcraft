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
  SLUDGE   : 2,  // Ruined city streets — PASSABLE (buildings as props only)
  RUBBLE   : 3,  // Collapsed building debris — IMPASSABLE
  TRASH    : 4,  // Salvage heap (outskirts) — IMPASSABLE, harvestable for Salvage
};

// SLUDGE is now passable — it represents ruined urban streets with building ruins as props
export const T_PASSABLE = new Set([T.CONCRETE, T.CRACKED, T.SLUDGE]);

// Tile colors used by the viewer and terrain texture
export const T_COLOR = {
  [T.CONCRETE]: '#1a1612',
  [T.CRACKED]:  '#28201a',
  [T.SLUDGE]:   '#2a2830',   // Blue-grey urban street
  [T.RUBBLE]:   '#2e2820',
  [T.TRASH]:    '#524a20',   // Yellow-orange sludge; brown disk = tile of trash (collectible)
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

// ── KABOOM (4-player symmetrical) ─────────────────────────
// Central cross of sludge divides four quadrants; each quadrant gets a clear base zone.
export function generateKaboom(w, h, seed = 9999) {
  const rng  = mulberry32(seed);
  const tiles = new Uint8Array(w * h).fill(T.CONCRETE);
  const cx = w / 2, cy = h / 2;

  // Central cross: vertical and horizontal sludge band
  const band = Math.floor(Math.min(w, h) * 0.08);
  _fillRect(tiles, w, cx - band, 0, cx + band, h, T.SLUDGE);
  _fillRect(tiles, w, 0, cy - band, w, cy + band, T.SLUDGE);

  // Trash forests in each quadrant (outer 40%)
  const tGrid = _makeNoiseGrid(w, h, 0.1, rng);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] !== T.CONCRETE) continue;
      const nx = x / w, ny = y / h;
      const inQuad = (nx < 0.5 ? 1 - nx * 2 : (nx - 0.5) * 2) * (ny < 0.5 ? 1 - ny * 2 : (ny - 0.5) * 2);
      if (inQuad < 0.4 && _sampleNoise(tGrid, x, y) < 0.48) tiles[y * w + x] = T.TRASH;
    }
  }

  // Cracked roads from center to mid-edges (optional paths)
  _fillRect(tiles, w, cx - 2, 0, cx + 2, h, T.CRACKED);
  _fillRect(tiles, w, 0, cy - 2, w, cy + 2, T.CRACKED);

  // Four base zones (quadrant centers)
  const baseRadius = Math.floor(Math.min(w, h) * 0.12);
  _clearCircle(tiles, w, baseRadius + 2,     baseRadius + 2,     baseRadius, T.CONCRETE);
  _clearCircle(tiles, w, w - baseRadius - 2, baseRadius + 2,     baseRadius, T.CONCRETE);
  _clearCircle(tiles, w, baseRadius + 2,     h - baseRadius - 2, baseRadius, T.CONCRETE);
  _clearCircle(tiles, w, w - baseRadius - 2, h - baseRadius - 2, baseRadius, T.CONCRETE);

  const border = 2;
  _fillRect(tiles, w, 0, 0, w, border, T.TRASH);
  _fillRect(tiles, w, 0, h - border, w, h, T.TRASH);
  _fillRect(tiles, w, 0, 0, border, h, T.TRASH);
  _fillRect(tiles, w, w - border, 0, w, h, T.TRASH);

  return cellularSmooth(tiles, w, h, 2);
}

// ── THE OVERFLOW (resource-rich 1v1 test map) ────────────
// Designed for testing the salvage extraction system:
//   • ~55% of the map is TRASH salvage heaps
//   • SLUDGE city-street corridors cut east-west and north-south (passable)
//   • Large clear base zones with immediate dump nodes
//   • Contested central boulevard loaded with resources
//   • Rubble only at tight chokepoints — fights happen in the streets
export function generateOverflow(w, h, seed = 2077) {
  const rng  = mulberry32(seed);
  const rng2 = mulberry32(seed + 5151);
  const rng3 = mulberry32(seed + 9876);
  const tiles = new Uint8Array(w * h).fill(T.TRASH); // start TRASH-heavy

  // ── Base clearing: two large open zones ────────────────
  const baseR = Math.floor(Math.min(w, h) * 0.17);
  _clearCircle(tiles, w, Math.floor(w * 0.12), Math.floor(h * 0.5), baseR,     T.CONCRETE);
  _clearCircle(tiles, w, Math.floor(w * 0.88), Math.floor(h * 0.5), baseR,     T.CONCRETE);

  // ── Central boulevard (SLUDGE — city street, passable) ──
  const mid = Math.floor(h * 0.5);
  const bW  = Math.floor(h * 0.09); // boulevard width
  _fillRect(tiles, w, 0, mid - bW, w, mid + bW, T.SLUDGE);

  // ── North/South lateral streets (SLUDGE, passable) ─────
  const n1 = Math.floor(h * 0.25), n2 = Math.floor(h * 0.75);
  const sw = Math.floor(h * 0.05);
  _fillRect(tiles, w, 0, n1 - sw, w, n1 + sw, T.SLUDGE);
  _fillRect(tiles, w, 0, n2 - sw, w, n2 + sw, T.SLUDGE);

  // ── Vertical cross streets (SLUDGE, passable) ───────────
  const v1 = Math.floor(w * 0.33), v2 = Math.floor(w * 0.50), v3 = Math.floor(w * 0.67);
  _fillRect(tiles, w, v1 - sw, 0, v1 + sw, h, T.SLUDGE);
  _fillRect(tiles, w, v2 - sw, 0, v2 + sw, h, T.SLUDGE);
  _fillRect(tiles, w, v3 - sw, 0, v3 + sw, h, T.SLUDGE);

  // ── Rubble at intersections (tight chokepoints only) ────
  const rubGrid = _makeNoiseGrid(w, h, 0.2, rng3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] !== T.TRASH) continue;
      // Only place rubble in a thin ring around mid-map
      const cx = Math.abs(x - w / 2) / (w * 0.5);
      const inMid = cx > 0.15 && cx < 0.4;
      if (!inMid) continue;
      const n = _sampleNoise(rubGrid, x, y);
      if (n < 0.15) tiles[y * w + x] = T.RUBBLE;
    }
  }

  // ── Cellular automata: organic TRASH blob edges ─────────
  const smoothed = cellularSmooth(tiles, w, h, 2);

  // ── Re-apply streets (smoothing may blur them) ──────────
  _fillRect(smoothed, w, 0, mid - bW, w, mid + bW, T.SLUDGE);
  _fillRect(smoothed, w, 0, n1 - sw, w, n1 + sw, T.SLUDGE);
  _fillRect(smoothed, w, 0, n2 - sw, w, n2 + sw, T.SLUDGE);
  _fillRect(smoothed, w, v1 - sw, 0, v1 + sw, h, T.SLUDGE);
  _fillRect(smoothed, w, v2 - sw, 0, v2 + sw, h, T.SLUDGE);
  _fillRect(smoothed, w, v3 - sw, 0, v3 + sw, h, T.SLUDGE);

  // ── Restore base zones (never blocked) ──────────────────
  _clearCircle(smoothed, w, Math.floor(w * 0.12), Math.floor(h * 0.5), baseR,     T.CONCRETE);
  _clearCircle(smoothed, w, Math.floor(w * 0.88), Math.floor(h * 0.5), baseR,     T.CONCRETE);

  // ── Cracked road on approach to each base ───────────────
  const approach = sw + 1;
  _fillRect(smoothed, w, 0, mid - approach, Math.floor(w * 0.3), mid + approach, T.CRACKED);
  _fillRect(smoothed, w, Math.floor(w * 0.7), mid - approach, w, mid + approach, T.CRACKED);

  // ── Hard border ─────────────────────────────────────────
  const border = 2;
  _fillRect(smoothed, w, 0, 0, w, border, T.TRASH);
  _fillRect(smoothed, w, 0, h - border, w, h, T.TRASH);
  _fillRect(smoothed, w, 0, 0, border, h, T.TRASH);
  _fillRect(smoothed, w, w - border, 0, w, h, T.TRASH);

  return smoothed;
}

// ── THE BREADLINE ──────────────────────────────────────────
// One main road straight up the pipe; resources at top and bottom; trash on the outskirts.
export function generateBreadline(w, h, seed = 4242) {
  const tiles = new Uint8Array(w * h).fill(T.TRASH);   // outskirts = trash
  const cx   = Math.floor(w / 2);
  const roadW = 14;                                   // main street width in tiles
  const x0   = Math.max(0, cx - roadW / 2);
  const x1   = Math.min(w, cx + roadW / 2);

  // One main vertical road (city street) — SLUDGE = passable street
  _fillRect(tiles, w, x0, 0, x1, h, T.SLUDGE);

  // Base clearings: top (GILD) and bottom (SCAV) — CONCRETE so buildings fit
  const topBaseY  = 18;
  const botBaseY  = h - 18;
  _clearCircle(tiles, w, cx, topBaseY, 16, T.CONCRETE);
  _clearCircle(tiles, w, cx, botBaseY, 16, T.CONCRETE);

  return cellularSmooth(tiles, w, h, 1);
}

// ── FROZEN SIEGE (snow WC2 homage) ──────────────────────
// Winter tileset feel: wide snowy ground (CRACKED = snow), frozen rivers
// (SLUDGE = ice), dense trash forests on flanks. Two bases face each other
// across a frozen river with a narrow bridge crossing.
export function generateFrozenSiege(w, h, seed = 6060) {
  const rng  = mulberry32(seed);
  const rng2 = mulberry32(seed + 555);
  const rng3 = mulberry32(seed + 1111);
  // Default to snowy ground (CRACKED) instead of dark concrete
  const tiles = new Uint8Array(w * h).fill(T.CRACKED);

  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);

  // ── Frozen river running horizontally through the middle ──
  const riverGrid = _makeNoiseGrid(w, h, 0.06, rng);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ny = y / h;
      const riverDist = Math.abs(ny - 0.5);
      const n = _sampleNoise(riverGrid, x, y);
      // River band ~10% of map height with wavy edges
      if (riverDist < 0.06 + n * 0.03) tiles[y * w + x] = T.SLUDGE;
    }
  }

  // ── Bridge crossing (narrow passable strip through the river) ──
  const bridgeW = 6;
  _fillRect(tiles, w, cx - bridgeW, Math.floor(h * 0.42), cx + bridgeW, Math.floor(h * 0.58), T.CRACKED);
  // Second smaller bridge on the right
  const bx2 = Math.floor(w * 0.75);
  _fillRect(tiles, w, bx2 - 3, Math.floor(h * 0.44), bx2 + 3, Math.floor(h * 0.56), T.CRACKED);

  // ── Dense trash forests on left and right flanks (pine forests) ──
  const tGrid = _makeNoiseGrid(w, h, 0.11, rng2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] !== T.CRACKED) continue;
      const nx = x / w;
      const flanks = Math.max(0, 1 - nx / 0.22) + Math.max(0, (nx - 0.78) / 0.22);
      if (flanks <= 0) continue;
      const n = _sampleNoise(tGrid, x, y);
      if (n < 0.48 - flanks * 0.12) tiles[y * w + x] = T.TRASH;
    }
  }

  // ── Scattered rubble (frozen ruins) in the mid-field ──
  const rGrid = _makeNoiseGrid(w, h, 0.14, rng3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] !== T.CRACKED) continue;
      const ny = y / h;
      const inMid = ny > 0.3 && ny < 0.7;
      if (!inMid) continue;
      const n = _sampleNoise(rGrid, x, y);
      if (n < 0.22) tiles[y * w + x] = T.RUBBLE;
    }
  }

  // ── Concrete roads (dark paths through the snow) ──
  // Vertical road from each base to the bridge
  _fillRect(tiles, w, cx - 2, 0, cx + 2, h, T.CONCRETE);
  // Horizontal patrol road
  _fillRect(tiles, w, Math.floor(w * 0.2), cy - 1, Math.floor(w * 0.8), cy + 1, T.CONCRETE);

  // ── Cellular smoothing ──
  const smoothed = cellularSmooth(tiles, w, h, 2);

  // ── Clear base zones ──
  // SCAV base (top) — tile ~(cx, 14)
  _clearCircle(smoothed, w, cx, 14, 16, T.CRACKED);
  // GILD base (bottom) — tile ~(cx, h-14)
  _clearCircle(smoothed, w, cx, h - 14, 16, T.CRACKED);
  // Re-punch the bridge after smoothing
  _fillRect(smoothed, w, cx - bridgeW, Math.floor(h * 0.43), cx + bridgeW, Math.floor(h * 0.57), T.CRACKED);
  _fillRect(smoothed, w, bx2 - 3, Math.floor(h * 0.44), bx2 + 3, Math.floor(h * 0.56), T.CRACKED);

  // ── Border wall ──
  const border = 3;
  _fillRect(smoothed, w, 0, 0, w, border, T.TRASH);
  _fillRect(smoothed, w, 0, h - border, w, h, T.TRASH);
  _fillRect(smoothed, w, 0, 0, border, h, T.TRASH);
  _fillRect(smoothed, w, w - border, 0, w, h, T.TRASH);

  return smoothed;
}
