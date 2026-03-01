// ═══════════════════════════════════════════════════════════
// pathfinding.js — A* tile-grid navigation
//
// Like WC2's built-in path finder:
//   • Works on the 120×120 tile grid (TILE=2 world units each)
//   • 8-directional movement (diagonal allowed)
//   • Post-processes path with string-pulling (removes zigzag)
//   • Capped at MAX_NODES for performance; falls back gracefully
//
// Usage:
//   const waypoints = findPath(startWx, startWz, endWx, endWz);
//   // returns [{x, z}, …] in world space, or [] if no path
// ═══════════════════════════════════════════════════════════

import { TILE, MAP_W, MAP_H } from './constants.js';
import { isPassable } from './navmesh.js';

// Convert world ↔ tile coordinates
const wtx = wx => Math.floor(wx / TILE);
const wtz = wz => Math.floor(wz / TILE);
const txw = tx => tx * TILE + TILE * 0.5;
const tzw = tz => tz * TILE + TILE * 0.5;

const MAX_NODES = 1200; // hard cap so pathfinding never lags the frame
const DIAG_COST = 1.4142;

// ── Tiny min-heap ─────────────────────────────────────────
// Much faster than iterating a Map for the lowest-f node.
class MinHeap {
  constructor() { this._d = []; }
  push(item, pri) { this._d.push({ item, pri }); this._up(this._d.length - 1); }
  pop()  { const t = this._d[0]; this._d[0] = this._d.at(-1); this._d.pop(); this._down(0); return t?.item; }
  get size() { return this._d.length; }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._d[p].pri <= this._d[i].pri) break;
      [this._d[p], this._d[i]] = [this._d[i], this._d[p]]; i = p;
    }
  }
  _down(i) {
    const n = this._d.length;
    while (true) {
      let m = i, l = 2*i+1, r = 2*i+2;
      if (l < n && this._d[l].pri < this._d[m].pri) m = l;
      if (r < n && this._d[r].pri < this._d[m].pri) m = r;
      if (m === i) break;
      [this._d[m], this._d[i]] = [this._d[i], this._d[m]]; i = m;
    }
  }
}

// ── A* ───────────────────────────────────────────────────
export function findPath(startWx, startWz, endWx, endWz) {
  const sx = wtx(startWx), sz = wtz(startWz);
  let   ex = wtx(endWx),   ez = wtz(endWz);

  // Snap destination to nearest passable tile if it's inside a wall
  if (!isPassable(txw(ex), tzw(ez))) {
    const snapped = _nearestPassableTile(ex, ez);
    if (!snapped) return [];
    ex = snapped.tx; ez = snapped.tz;
  }

  if (sx === ex && sz === ez) return [{ x: endWx, z: endWz }];

  const key = (x, z) => z * MAP_W + x;
  const heur = (x, z) => Math.max(Math.abs(x - ex), Math.abs(z - ez)); // Chebyshev

  const open    = new MinHeap();
  const closed  = new Uint8Array(MAP_W * MAP_H);
  const gScore  = new Float32Array(MAP_W * MAP_H).fill(Infinity);
  const parentX = new Int16Array(MAP_W * MAP_H).fill(-1);
  const parentZ = new Int16Array(MAP_W * MAP_H).fill(-1);

  const sk = key(sx, sz);
  gScore[sk] = 0;
  open.push({ x: sx, z: sz }, heur(sx, sz));

  let expanded = 0;

  while (open.size > 0 && expanded < MAX_NODES) {
    const cur = open.pop();
    if (!cur) break;
    const ck = key(cur.x, cur.z);
    if (closed[ck]) continue;
    closed[ck] = 1;
    expanded++;

    if (cur.x === ex && cur.z === ez) {
      return _reconstruct(cur.x, cur.z, sx, sz, parentX, parentZ, endWx, endWz);
    }

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cur.x + dx, nz = cur.z + dz;
        if (nx < 0 || nz < 0 || nx >= MAP_W || nz >= MAP_H) continue;
        if (!isPassable(txw(nx), tzw(nz))) continue;
        // Prevent corner-cutting (diagonal blocked by either adjacent impassable)
        if (dx !== 0 && dz !== 0) {
          if (!isPassable(txw(cur.x + dx), tzw(cur.z)) ||
              !isPassable(txw(cur.x),      tzw(cur.z + dz))) continue;
        }
        const nk = key(nx, nz);
        if (closed[nk]) continue;
        const moveCost = (dx !== 0 && dz !== 0) ? DIAG_COST : 1;
        const ng = gScore[ck] + moveCost;
        if (ng < gScore[nk]) {
          gScore[nk]  = ng;
          parentX[nk] = cur.x;
          parentZ[nk] = cur.z;
          open.push({ x: nx, z: nz }, ng + heur(nx, nz));
        }
      }
    }
  }

  // No path — return direct move (unit will slide or get stuck, handled by moveToward)
  return [{ x: endWx, z: endWz }];
}

function _reconstruct(ex, ez, sx, sz, parentX, parentZ, endWx, endWz) {
  const key = (x, z) => z * MAP_W + x;
  const raw = [];
  let cx = ex, cz = ez;
  while (!(cx === sx && cz === sz)) {
    raw.unshift({ x: txw(cx), z: tzw(cz) });
    const k  = key(cx, cz);
    const px = parentX[k], pz = parentZ[k];
    if (px === -1) break;
    cx = px; cz = pz;
  }
  // Replace last waypoint with the exact click position
  if (raw.length > 0) raw[raw.length - 1] = { x: endWx, z: endWz };
  else raw.push({ x: endWx, z: endWz });
  return _stringPull(raw);
}

// ── String-pulling ────────────────────────────────────────
// Remove redundant waypoints where there's a clear LOS between non-adjacent nodes.
// This smooths the zigzag A* path into diagonal-then-straight movement like WC2.
function _stringPull(path) {
  if (path.length <= 2) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !_los(path[i], path[j])) j--;
    out.push(path[j]);
    i = j;
  }
  return out;
}

function _los(a, b) {
  // Walk the line between two world points and check passability every TILE/2 steps
  const dx = b.x - a.x, dz = b.z - a.z;
  const steps = Math.ceil(Math.hypot(dx, dz) / (TILE * 0.5));
  for (let t = 1; t <= steps; t++) {
    const f = t / steps;
    if (!isPassable(a.x + dx * f, a.z + dz * f)) return false;
  }
  return true;
}

// ── Nearest passable tile (for clamping destinations) ─────
function _nearestPassableTile(tx0, tz0) {
  for (let r = 1; r < 16; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const tx = tx0 + dx, tz = tz0 + dz;
        if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) continue;
        if (isPassable(txw(tx), tzw(tz))) return { tx, tz };
      }
    }
  }
  return null;
}

// ── Nearest TRASH tile in world radius ────────────────────
// Used by input.js to let players right-click an area and
// assign workers to clear the nearest trash heap.
export function nearestTrashTile(wx, wz, radiusTiles = 8) {
  const tx0 = wtx(wx), tz0 = wtz(wz);
  // Lazy import to avoid circular dep; terrain module is always loaded first.
  const { getTileType, T_TRASH_VAL } = _trashApi();
  if (!getTileType) return null;
  let best = null, bestD = Infinity;
  for (let dz = -radiusTiles; dz <= radiusTiles; dz++) {
    for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
      const tx = tx0 + dx, tz = tz0 + dz;
      if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) continue;
      if (getTileType(tx, tz) !== T_TRASH_VAL) continue;
      const d = Math.hypot(dx, dz);
      if (d < bestD) { bestD = d; best = { tx, tz, wx: txw(tx), wz: tzw(tz) }; }
    }
  }
  return best;
}

// Deferred accessor so terrain.js can import pathfinding without circularity
let _trashApiCache = null;
function _trashApi() {
  if (_trashApiCache) return _trashApiCache;
  // dynamic import won't work synchronously — callers should use terrain.js directly
  return (_trashApiCache = { getTileType: null, T_TRASH_VAL: 4 });
}
