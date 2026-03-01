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
import { scene, setSceneTheme } from './renderer.js';

// ── Module state ─────────────────────────────────────────
let _tiles  = null;  // Uint8Array — current map tile data
let _mapW   = MAP_W;
let _mapH   = MAP_H;
const _terrainMeshes = [];  // meshes to dispose when map changes

// ── Tile palettes ───────────────────────────────────────
const PALETTE_DEFAULT = {
  [T.CONCRETE]: [30, 25, 18],   // Warm dark asphalt
  [T.CRACKED]:  [58, 50, 36],   // Noticeably lighter road/path
  [T.SLUDGE]:   [42, 40, 52],   // Blue-grey urban street (city ruins)
  [T.RUBBLE]:   [46, 44, 40],   // Cool grey debris
  [T.TRASH]:    [82, 58, 18],   // Yellow-orange sludge under tiles of trash
};
const PALETTE_SNOW = {
  [T.CONCRETE]: [76, 80, 88],   // Plowed dark road through snow
  [T.CRACKED]:  [180, 192, 204], // Fresh snow — grey-blue like WC2 winter
  [T.SLUDGE]:   [80, 128, 176],  // Frozen river / deep ice blue
  [T.RUBBLE]:   [96, 100, 108],  // Frozen stone rubble
  [T.TRASH]:    [38, 62, 38],    // Dark pine-green forest floor
};
let TILE_RGB = PALETTE_DEFAULT;

let _currentTheme = 'default';
export function setTerrainTheme(theme) {
  _currentTheme = theme;
  TILE_RGB = theme === 'snow' ? PALETTE_SNOW : PALETTE_DEFAULT;
}

// ── Ground texture from tile data ────────────────────────
// Renders at SCALE pixels per tile so we can paint noise and
// per-tile micro-details (crack lines, debris, shimmer) within each cell.
export function buildGroundTexture(tiles, mapW, mapH) {
  const SCALE = 4;  // pixels per tile — 4×4 lets us paint details inside each tile
  const cw = mapW * SCALE;
  const ch = mapH * SCALE;

  const cv  = document.createElement('canvas');
  cv.width  = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(cw, ch);
  const d   = img.data;

  // Fast deterministic per-pixel hash (no seeded RNG needed — position IS the seed)
  function h(x, y) {
    let v = (x * 374761393 + y * 668265263) | 0;
    v = (v ^ (v >>> 13)) * 1274126177;
    return ((v ^ (v >>> 16)) >>> 0) / 0xffffffff;
  }

  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const t = tiles[ty * mapW + tx] ?? T.CONCRETE;
      const [br, bg, bb] = TILE_RGB[t] ?? TILE_RGB[T.CONCRETE];

      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const px = tx * SCALE + dx;
          const py = ty * SCALE + dy;

          // Two noise octaves for varied detail
          const n  = h(px, py);
          const n2 = h(px + 9319, py + 5471);
          const n3 = h(px * 2 + 1, py * 2 + 3);

          let r = br + (n  - 0.5) * 16;
          let g = bg + (n  - 0.5) * 14;
          let b = bb + (n2 - 0.5) * 12;

          if (_currentTheme === 'snow') {
            // ── Snow palette per-pixel detail ──
            if (t === T.CRACKED) {
              // Snow drifts: sparkle highlights
              if (n3 > 0.80) { r += 20; g += 22; b += 24; }
              if (n2 > 0.88) { r -= 8;  g -= 6;  b -= 4; } // shadow
              if (dx === 0 && n > 0.7) { r -= 12; g -= 10; b -= 8; } // footprint groove
            } else if (t === T.TRASH) {
              // Pine forest floor: mossy green variation
              if (n3 > 0.68) { r += 8;  g += 14; b += 6; }
              if (n2 > 0.80) { r -= 8;  g -= 4;  b -= 8; }
              if (n > 0.85)  { r += 4;  g += 8;  b -= 2; } // lighter needle
            } else if (t === T.SLUDGE) {
              // Frozen river: ice shine + cracks
              if (n3 > 0.75) { r += 16; g += 18; b += 22; } // ice glint
              if (n2 > 0.82) { r -= 14; g -= 10; b -= 6; }  // deep ice
              if (dx === 0 && dy === 2 && n > 0.55) { r -= 20; g -= 16; b -= 10; } // crack
            } else if (t === T.RUBBLE) {
              if (n3 > 0.72) { r += 14; g += 16; b += 18; } // frost
              if (n2 > 0.84) { r -= 12; g -= 12; b -= 10; }
            } else {
              // CONCRETE = plowed road
              if (n3 > 0.78) { r += 8; g += 8; b += 10; }
              if (n2 > 0.86) { r -= 6; g -= 4; b -= 2; }
            }
          } else {
            // ── Default (urban/dystopian) palette detail ──
            if (t === T.CRACKED) {
              if (dx === 0 || dy === 0) { r *= 0.55; g *= 0.55; b *= 0.55; }
              if (n3 > 0.82) { r += 18; g += 15; b += 10; }
            } else if (t === T.TRASH) {
              if (n3 > 0.70) { r += 14; g += 10; b -= 4; }
              if (n2 > 0.82) { r -= 6;  g -= 4;  b -= 6; }
            } else if (t === T.SLUDGE) {
              if (dx === 0 || dy === 0) { r -= 12; g -= 12; b -= 10; }
              if (n3 > 0.78) { r += 10; g += 10; b += 18; }
              if (n2 > 0.86) { r -= 10; g -= 10; b -= 8; }
              if (dy === 2 && n > 0.60 && n < 0.62) { r += 30; g += 22; b -= 10; }
            } else if (t === T.RUBBLE) {
              if (n3 > 0.74) { r += 18; g += 16; b += 14; }
              if (n2 > 0.85) { r -= 14; g -= 14; b -= 14; }
              if (n > 0.5)   { b += 4; }
            } else {
              if (n3 > 0.8)  { r += 10; g += 7; b += 4; }
              if (n2 > 0.88) { r += 6;  g -= 2; b -= 4; }
            }
          }

          const i = (py * cw + px) * 4;
          d[i]   = Math.max(0, Math.min(255, r | 0));
          d[i+1] = Math.max(0, Math.min(255, g | 0));
          d[i+2] = Math.max(0, Math.min(255, b | 0));
          d[i+3] = 255;
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0);

  // Retain canvas so clearTrashTile can repaint individual tiles later
  _groundTexCanvas = cv;

  const tex     = new THREE.CanvasTexture(cv);
  tex.wrapS     = THREE.ClampToEdgeWrapping;
  tex.wrapT     = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
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

// Rubble pile — collapsed concrete chunks (frosted on snow maps)
function _rubbleCluster(wx, wz) {
  const snow = _currentTheme === 'snow';
  const count = 2 + Math.floor(_rng() * 3);
  for (let i = 0; i < count; i++) {
    const ox = _r(-0.7, 0.7), oz = _r(-0.7, 0.7);
    const s  = _r(0.4, 1.0);
    const chunk = new THREE.Mesh(
      new THREE.BoxGeometry(s * _r(0.8, 1.6), s * _r(0.4, 0.9), s * _r(0.8, 1.4)),
      snow ? _mat(0x8090a0, 0x506070, 0.12) : _mat(0x2a2620, 0x0a0806, 0.1)
    );
    chunk.position.set(wx + ox, s * 0.25, wz + oz);
    chunk.rotation.set(_r(-0.3, 0.3), _r(0, Math.PI), _r(-0.2, 0.2));
    scene.add(chunk);
    _terrainMeshes.push(chunk);
  }
}

// Tiles of trash — discrete collectible “stumps” like chopping trees.
// One TRASH tile = one tile of trash; when worker collects it, it disappears and salvage goes to Extractor.
function _salvageHeap(wx, wz) {
  if (_currentTheme === 'snow') {
    // Pine tree — cone (canopy) on a thin cylinder trunk, with snow caps
    const trunkH = _r(0.6, 1.0);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, trunkH, 5),
      _mat(0x4a3020, 0x2a1808, 0.1)
    );
    trunk.position.set(wx + _r(-0.1, 0.1), trunkH / 2, wz + _r(-0.1, 0.1));
    scene.add(trunk); _terrainMeshes.push(trunk);

    const coneH = _r(1.8, 3.0);
    const coneR = _r(0.6, 1.0);
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(coneR, coneH, 6),
      _mat(0x1e4a24, 0x142e16, 0.15)
    );
    canopy.position.set(trunk.position.x, trunkH + coneH * 0.4, trunk.position.z);
    canopy.rotation.y = _r(0, Math.PI * 2);
    scene.add(canopy); _terrainMeshes.push(canopy);

    // Snow cap on top
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(coneR * 0.5, coneH * 0.25, 6),
      _mat(0xe8eef4, 0xc0d0e0, 0.15)
    );
    cap.position.set(canopy.position.x, trunkH + coneH * 0.75, canopy.position.z);
    scene.add(cap); _terrainMeshes.push(cap);
    return;
  }

  // Default: brown disk/stump (tile of trash)
  const r = _r(0.55, 0.85);
  const disk = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 1.05, _r(0.25, 0.5), 8),
    _mat(0x6b5344, 0x4a3528, 0.25)
  );
  disk.position.set(wx + _r(-0.08, 0.08), disk.geometry.parameters.height / 2, wz + _r(-0.08, 0.08));
  disk.rotation.y = _r(0, Math.PI * 2);
  scene.add(disk);
  _terrainMeshes.push(disk);

  if (_rng() > 0.5) {
    const r2 = _r(0.3, 0.5);
    const disk2 = new THREE.Mesh(
      new THREE.CylinderGeometry(r2, r2 * 1.08, _r(0.15, 0.35), 6),
      _mat(0x5a4538, 0x3a2820, 0.2)
    );
    disk2.position.set(wx + _r(-0.5, 0.5), disk2.geometry.parameters.height / 2, wz + _r(-0.5, 0.5));
    disk2.rotation.y = _r(0, Math.PI * 2);
    scene.add(disk2);
    _terrainMeshes.push(disk2);
  }
}

// City ruin block / ice formations — visual decoration on SLUDGE tiles.
// SLUDGE is PASSABLE — units walk through; decorations are visual only.
function _ruinedBlock(wx, wz) {
  if (_rng() > 0.55) return;

  if (_currentTheme === 'snow') {
    // Ice formations: translucent blue shards jutting from frozen river
    const count = 1 + Math.floor(_rng() * 2);
    const iceMat = _mat(0x6098c0, 0x4878a0, 0.3);
    for (let i = 0; i < count; i++) {
      const ox = _r(-0.4, 0.4), oz = _r(-0.4, 0.4);
      const ih = _r(0.4, 1.2);
      const shard = new THREE.Mesh(
        new THREE.ConeGeometry(_r(0.15, 0.35), ih, 4),
        iceMat
      );
      shard.position.set(wx + ox, ih / 2, wz + oz);
      shard.rotation.y = _r(0, Math.PI * 2);
      shard.rotation.z = _r(-0.15, 0.15);
      scene.add(shard); _terrainMeshes.push(shard);
    }
    return;
  }

  const variant = Math.floor(_rng() * 3);

  if (variant === 0) {
    const w = _r(0.8, 1.6), h = _r(0.3, 0.9), d = _r(0.2, 0.5);
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      _mat(0x2a2830, 0x080810, 0.05)
    );
    wall.position.set(wx + _r(-0.3, 0.3), h / 2, wz + _r(-0.3, 0.3));
    wall.rotation.y = _r(0, Math.PI);
    scene.add(wall); _terrainMeshes.push(wall);

  } else if (variant === 1) {
    const fh = _r(1.2, 2.2), fw = _r(0.6, 1.0);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(fw, fh, 0.12),
      _mat(0x1e1c28, 0x050510, 0.08)
    );
    frame.position.set(wx + _r(-0.2, 0.2), fh / 2, wz + _r(-0.2, 0.2));
    frame.rotation.y = _r(0, Math.PI);
    scene.add(frame); _terrainMeshes.push(frame);

    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(fw * 0.9, 0.1, 0.14),
      _mat(0x1e1c28, 0x050510, 0.06)
    );
    bar.position.set(wx + _r(-0.2, 0.2), fh * 0.55, wz + _r(-0.2, 0.2));
    scene.add(bar); _terrainMeshes.push(bar);

  } else {
    const count = 2 + Math.floor(_rng() * 2);
    for (let i = 0; i < count; i++) {
      const ox = _r(-0.5, 0.5), oz = _r(-0.5, 0.5);
      const s  = _r(0.2, 0.55);
      const chunk = new THREE.Mesh(
        new THREE.BoxGeometry(s * _r(0.8, 1.4), s * _r(0.3, 0.7), s * _r(0.8, 1.3)),
        _mat(0x30303c, 0x080812, 0.04)
      );
      chunk.position.set(wx + ox, s * 0.2, wz + oz);
      chunk.rotation.set(_r(-0.3, 0.3), _r(0, Math.PI), _r(-0.2, 0.2));
      scene.add(chunk); _terrainMeshes.push(chunk);
    }
  }
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

  // Select colour theme based on map
  const theme = mapDef.id === 'frozen-siege' ? 'snow' : 'default';
  setTerrainTheme(theme);
  setSceneTheme(theme);

  const tiles = mapDef.getTiles();
  _tiles = tiles;
  _mapW  = mapDef.width;
  _mapH  = mapDef.height;

  // Apply ground texture and retain mesh ref for live tile repaints
  if (groundMesh) {
    _groundMeshRef = groundMesh;
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

      if (t === T.TRASH)   _salvageHeap(wx, wz);   // amber salvage heaps (outskirts)
      else if (t === T.RUBBLE) _rubbleCluster(wx, wz);
      else if (t === T.SLUDGE) _ruinedBlock(wx, wz); // city ruins (passable streets)
    }
  }
}

// ── Tile type query ───────────────────────────────────────
export function getTileType(tx, tz) {
  if (!_tiles || tx < 0 || tz < 0 || tx >= _mapW || tz >= _mapH) return -1;
  return _tiles[tz * _mapW + tx];
}

// ── TRASH = Salvage deposits ──────────────────────────────
// TRASH tiles are the Salvage resource in TentCraft.
// Each tile has a finite amount; workers harvest per-trip.
// When fully depleted the tile becomes CRACKED (now passable).
//
//  harvestTrashSalvage(tx, tz)  → returns salvage amount for one trip (0 if empty)
//  getTrashAmount(tx, tz)       → remaining salvage on this tile
//  nearestTrashWithSalvage(wx, wz, radius)  → {tx, tz, wx, wz} of nearest rich tile

let _groundTexCanvas = null;   // retained so we can patch individual tiles
let _groundMeshRef   = null;

const SALVAGE_PER_TILE = 150;  // total per tile — 5 trips then pile is gone
const SALVAGE_PER_TRIP = 30;   // one worker trip; each delivery is a real haul

// Lazy-init: populated on first access so we don't scan tiles at load time
const _trashAmounts = new Map(); // key = tz*MAP_W+tx → remaining salvage

function _trashKey(tx, tz) { return tz * _mapW + tx; }

function _initTrashAmount(tx, tz) {
  const k = _trashKey(tx, tz);
  if (!_trashAmounts.has(k)) _trashAmounts.set(k, SALVAGE_PER_TILE);
  return _trashAmounts.get(k);
}

export function getTrashAmount(tx, tz) {
  if (getTileType(tx, tz) !== T.TRASH) return 0;
  return _initTrashAmount(tx, tz);
}

/** Harvest one trip from a TRASH tile. Returns scrap 2× more often than salvage so it balances out. */
export function harvestTrash(tx, tz) {
  if (!_tiles) return { type: 'scrap', amount: 0 };
  if (getTileType(tx, tz) !== T.TRASH) return { type: 'scrap', amount: 0 };

  _initTrashAmount(tx, tz);
  const k = _trashKey(tx, tz);
  const remaining = _trashAmounts.get(k);
  if (remaining <= 0) {
    _depleteTile(tx, tz);
    return { type: 'scrap', amount: 0 };
  }

  const got = Math.min(SALVAGE_PER_TRIP, remaining);
  _trashAmounts.set(k, remaining - got);

  if (remaining - got <= 0) _depleteTile(tx, tz);

  // 2:1 scrap vs salvage so clearing paths gives both and scrap 2× more often
  const roll = (tx * 7 + tz * 13 + remaining) % 3;
  const type = roll < 2 ? 'scrap' : 'salvage';
  return { type, amount: got };
}

/** @deprecated Use harvestTrash for scrap/salvage. Kept for compatibility. */
export function harvestTrashSalvage(tx, tz) {
  const r = harvestTrash(tx, tz);
  return r.type === 'salvage' ? r.amount : 0;
}

function _depleteTile(tx, tz) {
  _tiles[tz * _mapW + tx] = T.CRACKED;

  // Remove 3D props on this tile
  const wx = tx * TILE + TILE / 2;
  const wz = tz * TILE + TILE / 2;
  const RADIUS = TILE * 1.2;
  for (let i = _terrainMeshes.length - 1; i >= 0; i--) {
    const m = _terrainMeshes[i];
    if (Math.hypot(m.position.x - wx, m.position.z - wz) < RADIUS) {
      scene.remove(m); m.geometry.dispose(); _terrainMeshes.splice(i, 1);
    }
  }

  if (_groundTexCanvas && _groundMeshRef) {
    _repaintTile(_groundTexCanvas, tx, tz, T.CRACKED);
    _groundMeshRef.material.map.needsUpdate = true;
  }
}

/**
 * Find nearest TRASH tile with salvage remaining.
 * @param {number} wx - world X origin
 * @param {number} wz - world Z origin
 * @param {number} radiusTiles - search radius in tiles (default 80)
 * @param {Set<number>} [skipKeys] - optional set of tile keys (tz*mapW+tx) to skip (claimed tiles)
 */
export function nearestTrashWithSalvage(wx, wz, radiusTiles = 80, skipKeys = null) {
  if (!_tiles) return null;
  const tx0 = Math.floor(wx / TILE), tz0 = Math.floor(wz / TILE);
  let best = null, bestD = Infinity;
  let bestFallback = null, bestFallbackD = Infinity; // fallback if all tiles are claimed
  for (let dz = -radiusTiles; dz <= radiusTiles; dz++) {
    for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
      const tx = tx0 + dx, tz = tz0 + dz;
      if (tx < 0 || tz < 0 || tx >= _mapW || tz >= _mapH) continue;
      if (getTileType(tx, tz) !== T.TRASH) continue;
      if (getTrashAmount(tx, tz) <= 0) continue;
      const d = Math.hypot(dx, dz);
      const key = tz * _mapW + tx;
      if (skipKeys?.has(key)) {
        if (d < bestFallbackD) { bestFallbackD = d; bestFallback = { tx, tz, wx: tx * TILE + TILE / 2, wz: tz * TILE + TILE / 2 }; }
      } else {
        if (d < bestD) { bestD = d; best = { tx, tz, wx: tx * TILE + TILE / 2, wz: tz * TILE + TILE / 2 }; }
      }
    }
  }
  return best ?? bestFallback; // prefer unclaimed; fall back to claimed if needed
}

/** Returns the tile key used for claiming: tz * mapW + tx */
export function trashTileKey(tx, tz) { return tz * _mapW + tx; }

// Legacy: still used if workers clear TRASH for path-making (now gives Scrap)
export function clearTrashTile(tx, tz) {
  if (!_tiles || getTileType(tx, tz) !== T.TRASH) return 0;
  _depleteTile(tx, tz);
  return 20; // small scrap bonus for forced clearing
}

// Repaint a single tile region on the texture canvas (fast — no full rebuild)
function _repaintTile(cv, tx, tz, newType) {
  const SCALE = 4;
  const ctx   = cv.getContext('2d');
  const [br, bg, bb] = TILE_RGB[newType] ?? TILE_RGB[T.CONCRETE];
  const img = ctx.createImageData(SCALE, SCALE);
  const d   = img.data;
  function h(x, y) {
    let v = (x * 374761393 + y * 668265263) | 0;
    v = (v ^ (v >>> 13)) * 1274126177;
    return ((v ^ (v >>> 16)) >>> 0) / 0xffffffff;
  }
  for (let dy = 0; dy < SCALE; dy++) {
    for (let dx = 0; dx < SCALE; dx++) {
      const px = tx * SCALE + dx, py = tz * SCALE + dy;
      const n  = h(px, py), n2 = h(px + 9319, py + 5471), n3 = h(px * 2 + 1, py * 2 + 3);
      let r = br + (n - 0.5) * 16, g = bg + (n - 0.5) * 14, b = bb + (n2 - 0.5) * 12;
      if (newType === T.CRACKED) {
        if (_currentTheme === 'snow') {
          if (n3 > 0.80) { r += 20; g += 22; b += 24; }
          if (n2 > 0.88) { r -= 8;  g -= 6;  b -= 4; }
        } else {
          if (dx === 0 || dy === 0) { r *= 0.55; g *= 0.55; b *= 0.55; }
          if (n3 > 0.82) { r += 18; g += 15; b += 10; }
        }
      }
      const i = (dy * SCALE + dx) * 4;
      d[i]   = Math.max(0, Math.min(255, r | 0));
      d[i+1] = Math.max(0, Math.min(255, g | 0));
      d[i+2] = Math.max(0, Math.min(255, b | 0));
      d[i+3] = 255;
    }
  }
  ctx.putImageData(img, tx * SCALE, tz * SCALE);
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
