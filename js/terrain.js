// ═══════════════════════════════════════════════════════════
// terrain.js — Map terrain loading, rendering, and passability
//
// Terrain replaces the random spawnTrashField() call.
// Three layers:
//   1. Canvas texture on the ground plane (tile colors)
//   2. 3D mesh objects for impassable tiles (trash, rubble, sludge)
//   3. Passability query used by world.js for unit movement
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { TILE, MAP_W, MAP_H } from './constants.js';
import { T, T_PASSABLE } from '../architect/mapgen.js';
import { scene } from './renderer.js';

// ── Module state ─────────────────────────────────────────
let _tiles  = null;  // Uint8Array — current map tile data
let _mapW   = MAP_W;
let _mapH   = MAP_H;
const _terrainMeshes = [];  // meshes to dispose when map changes

// ── Tile colors ───────────────────────────────────────────
// Matched to the dystopian palette of the game
const TILE_COL = {
  [T.CONCRETE]: '#16120c',   // Dark asphalt — slightly warm black
  [T.CRACKED]:  '#201a12',   // Lighter cracked concrete
  [T.SLUDGE]:   '#0c140a',   // Toxic dark green-black
  [T.RUBBLE]:   '#1e1c18',   // Grey rubble — cool dark
  [T.TRASH]:    '#181206',   // Warm dark brown trash
};

// ── Ground texture from tile data ────────────────────────
// Paints a canvas sized to the tile grid and applies it as
// a THREE.CanvasTexture on the existing ground plane.
export function buildGroundTexture(tiles, mapW, mapH) {
  const cv  = document.createElement('canvas');
  cv.width  = mapW;
  cv.height = mapH;
  const ctx = cv.getContext('2d');

  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const t = tiles[y * mapW + x] ?? T.CONCRETE;
      ctx.fillStyle = TILE_COL[t] ?? TILE_COL[T.CONCRETE];
      ctx.fillRect(x, y, 1, 1);
    }
  }

  const tex     = new THREE.CanvasTexture(cv);
  tex.wrapS     = THREE.ClampToEdgeWrapping;
  tex.wrapT     = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

// ── 3D terrain objects ────────────────────────────────────
// Clusters of trash barrel meshes, rubble chunks, sludge pools
// placed according to tile data.  Replaces the random spawnTrashField().

const _rng = (() => {
  let s = 0xdeadbeef;
  return () => {
    s = (s ^ (s >>> 13)) | 0;
    s = (s ^ (s << 17)) | 0;
    s = (s ^ (s >>> 5))  | 0;
    return (s >>> 0) / 0x100000000;
  };
})();

function _r(min, max) { return min + _rng() * (max - min); }

const _matCache = new Map();
function _mat(hex, emissive = 0x000000, ei = 0) {
  const key = `${hex}_${emissive}_${ei}`;
  if (!_matCache.has(key))
    _matCache.set(key, new THREE.MeshLambertMaterial({ color: hex, emissive, emissiveIntensity: ei }));
  return _matCache.get(key);
}

// Trash heap cluster — 1-4 barrels + trash cones on a single tile
function _trashCluster(wx, wz) {
  const count = 1 + Math.floor(_rng() * 3);
  const mats  = [
    _mat(0x2a2018), _mat(0x1e1408), _mat(0x362a14), _mat(0x1a1208),
  ];
  for (let i = 0; i < count; i++) {
    const ox = _r(-0.6, 0.6), oz = _r(-0.6, 0.6);
    const h  = _r(1.0, 2.2);
    const m  = _mat(mats[Math.floor(_rng() * mats.length)].color.getHex());

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(_r(0.3, 0.65), _r(0.3, 0.65), h, 7),
      mats[Math.floor(_rng() * mats.length)]
    );
    barrel.position.set(wx + ox, h / 2, wz + oz);
    barrel.rotation.y = _r(0, Math.PI * 2);
    scene.add(barrel);
    _terrainMeshes.push(barrel);

    if (_rng() > 0.45) {
      const top = new THREE.Mesh(
        new THREE.ConeGeometry(_r(0.35, 0.9), _r(0.6, 1.4), 6),
        mats[Math.floor(_rng() * mats.length)]
      );
      top.position.set(wx + ox + _r(-0.2, 0.2), h + 0.4, wz + oz + _r(-0.2, 0.2));
      top.rotation.y = _r(0, Math.PI * 2);
      scene.add(top);
      _terrainMeshes.push(top);
    }
  }
}

// Rubble pile — collapsed concrete chunks
function _rubbleCluster(wx, wz) {
  const count = 2 + Math.floor(_rng() * 3);
  for (let i = 0; i < count; i++) {
    const ox = _r(-0.7, 0.7), oz = _r(-0.7, 0.7);
    const s  = _r(0.4, 1.0);
    const chunk = new THREE.Mesh(
      new THREE.BoxGeometry(s * _r(0.8, 1.6), s * _r(0.4, 0.9), s * _r(0.8, 1.4)),
      _mat(0x2a2620, 0x0a0806, 0.1)
    );
    chunk.position.set(wx + ox, s * 0.25, wz + oz);
    chunk.rotation.set(_r(-0.3, 0.3), _r(0, Math.PI), _r(-0.2, 0.2));
    scene.add(chunk);
    _terrainMeshes.push(chunk);
  }
}

// Sludge pool — flat dark disc, slightly emissive toxic green
function _sludgePool(wx, wz) {
  const r    = _r(0.7, 1.1);
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(r, 8),
    _mat(0x0c1a08, 0x0a2204, 0.4)
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(wx, 0.01, wz);
  scene.add(pool);
  _terrainMeshes.push(pool);
}

// ── Main init function ────────────────────────────────────
// Call this with a map definition after the scene is ready.
// Updates ground texture and places all terrain 3D objects.
export function initTerrain(mapDef, groundMesh) {
  // Dispose previous terrain meshes if map is changing
  for (const m of _terrainMeshes) {
    scene.remove(m);
    m.geometry.dispose();
  }
  _terrainMeshes.length = 0;

  const tiles = mapDef.getTiles();
  _tiles = tiles;
  _mapW  = mapDef.width;
  _mapH  = mapDef.height;

  // Apply ground texture
  if (groundMesh) {
    const tex = buildGroundTexture(tiles, _mapW, _mapH);
    groundMesh.material.map     = tex;
    groundMesh.material.needsUpdate = true;
  }

  // Tile-sample density: only place 3D objects on every Nth tile
  // to keep mesh count manageable (tiles are 2x2 world units).
  const STRIDE = 2; // place objects every 2 tiles

  for (let ty = 0; ty < _mapH; ty += STRIDE) {
    for (let tx = 0; tx < _mapW; tx += STRIDE) {
      const t  = tiles[ty * _mapW + tx];
      // World center of this tile
      const wx = tx * TILE + TILE / 2;
      const wz = ty * TILE + TILE / 2;

      if (t === T.TRASH)   _trashCluster(wx, wz);
      else if (t === T.RUBBLE) _rubbleCluster(wx, wz);
      else if (t === T.SLUDGE) _sludgePool(wx, wz);
    }
  }
}

// ── Passability ───────────────────────────────────────────
// Used by world.js to check if a world position can be entered.
export function isPassable(wx, wz) {
  if (!_tiles) return true;
  const tx = Math.floor(wx / TILE);
  const tz = Math.floor(wz / TILE);
  if (tx < 0 || tz < 0 || tx >= _mapW || tz >= _mapH) return false;
  return T_PASSABLE.has(_tiles[tz * _mapW + tx]);
}

// Nearest passable tile from an impassable position (snap-to-road)
export function nearestPassable(wx, wz) {
  if (isPassable(wx, wz)) return { wx, wz };
  const tx0 = Math.floor(wx / TILE);
  const tz0 = Math.floor(wz / TILE);
  for (let r = 1; r < 20; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const tx = tx0 + dx, tz = tz0 + dz;
        if (tx < 0 || tz < 0 || tx >= _mapW || tz >= _mapH) continue;
        if (T_PASSABLE.has(_tiles[tz * _mapW + tx]))
          return { wx: tx * TILE + TILE / 2, wz: tz * TILE + TILE / 2 };
      }
    }
  }
  return { wx, wz };
}
