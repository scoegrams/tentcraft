// ═══════════════════════════════════════════════════════════
// navmesh.js — Combined passability for pathfinding (terrain + buildings)
//
// Performance: building footprints are baked into a flat Uint8Array so
// isPassable() is two O(1) array lookups instead of looping all entities.
// Call markBuilding() whenever a building is placed or destroyed.
// ═══════════════════════════════════════════════════════════

import { TILE, MAP_W, MAP_H } from './constants.js';
import { isPassable as isTerrainPassable } from './terrain.js';

// Baked building-obstacle grid: 1 = blocked by a building, 0 = clear.
let _bldgGrid = null;

/** Call after initTerrain() — resets the building grid for the new map. */
export function initNavMesh() {
  _bldgGrid = new Uint8Array(MAP_W * MAP_H);
}

/**
 * Mark / unmark all tiles under a building footprint.
 * size matches the entity's e.size (same scale used in the old loop check).
 * blocked=true when the building is placed, false when it dies.
 */
export function markBuilding(wx, wz, size, blocked) {
  if (!_bldgGrid) return;
  const half = (size ?? 1) * TILE * 0.5;
  const tx0 = Math.max(0, Math.floor((wx - half + 0.001) / TILE));
  const tz0 = Math.max(0, Math.floor((wz - half + 0.001) / TILE));
  const tx1 = Math.min(MAP_W - 1, Math.floor((wx + half - 0.001) / TILE));
  const tz1 = Math.min(MAP_H - 1, Math.floor((wz + half - 0.001) / TILE));
  const val = blocked ? 1 : 0;
  for (let tz = tz0; tz <= tz1; tz++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      _bldgGrid[tz * MAP_W + tx] = val;
    }
  }
}

/** True if (wx, wz) is walkable: terrain allows it and no building occupies it. */
export function isPassable(wx, wz) {
  if (!isTerrainPassable(wx, wz)) return false;
  if (!_bldgGrid) return true;
  const tx = Math.floor(wx / TILE);
  const tz = Math.floor(wz / TILE);
  if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) return false;
  return _bldgGrid[tz * MAP_W + tx] === 0;
}
