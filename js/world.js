// ═══════════════════════════════════════════════════════════
// world.js — spatial helpers, pathfinding primitives
// Mirrors Warcraft's MapGrid + pathfinding utilities
// ═══════════════════════════════════════════════════════════

import { WORLD_W, WORLD_H, FAC, TILE } from './constants.js';
import { G } from './state.js';
import { isPassable } from './navmesh.js';
import { findPath } from './pathfinding.js';

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Issue a new move order with A* path to (tx, tz).
 *  Transports that can traverse any terrain skip A* and go direct. */
export function moveTo(ent, tx, tz) {
  if (ent.canTraverse) {
    // Direct single-waypoint path — no navmesh needed
    ent._path     = [{ x: tx, z: tz }];
  } else {
    ent._path     = findPath(ent.x, ent.z, tx, tz);
  }
  ent._pathDest = { x: tx, z: tz };
}

const STUCK_TIME = 0.5;  // seconds without progress → consider stuck and nudge

const REPATH_INTERVAL = 0.12; // throttle auto-repaths so A* isn't called every frame

/** Move entity toward (tx, tz) following the A* path if one exists.
 *  Returns true when within stopDist of the final destination.
 *  Detects stuck (no progress) and nudges + repaths so blobs don’t block forever. */

export function moveToward(ent, tx, tz, stopDist, dt) {
  // If destination changed significantly, repath — throttled to REPATH_INTERVAL
  const dest = ent._pathDest;
  const destMoved = !dest || Math.hypot(dest.x - tx, dest.z - tz) > TILE * 2;
  const now = G.time ?? 0;
  // No existing path → repath immediately (new target, just went idle, etc.).
  // Existing path but dest moved → throttle so A* isn't called every frame.
  if (!dest || (destMoved && (now - (ent._pathTime ?? -999)) >= REPATH_INTERVAL)) {
    moveTo(ent, tx, tz);
    ent._pathTime = now;
  }

  // Follow waypoints
  if (ent._path && ent._path.length > 0) {
    const wp = ent._path[0];
    const dx = wp.x - ent.x, dz = wp.z - ent.z;
    const d  = Math.hypot(dx, dz);

    // Stuck detection: not getting closer to current waypoint
    const now = (typeof G !== 'undefined' && G.time) ? G.time : 0;
    if (ent._lastMoveDist !== undefined && d >= ent._lastMoveDist - 0.01) {
      ent._stuckAccum = (ent._stuckAccum ?? 0) + dt;
      if (ent._stuckAccum >= STUCK_TIME) {
        ent._path = null;
        ent._pathDest = null;
        ent._stuckAccum = 0;
        // Nudge perpendicular to movement to break out of blob
        const nudge = 2.5;
        const perpX = -dz / (d || 1);
        const perpZ = dx / (d || 1);
        const flip = (ent.id % 2) ? 1 : -1;
        const nx = ent.x + perpX * nudge * flip;
        const nz = ent.z + perpZ * nudge * flip;
        if (isPassable(nx, nz)) { ent.x = nx; ent.z = nz; }
        moveTo(ent, tx, tz);
      }
    } else {
      ent._stuckAccum = 0;
    }
    ent._lastMoveDist = d;

    // Reached this waypoint — advance
    if (d < TILE * 0.8) {
      ent._path.shift();
      ent._lastMoveDist = undefined;
      if (ent._path.length === 0) {
        return Math.hypot(ent.x - tx, ent.z - tz) <= stopDist;
      }
      return false;
    }

    const step = ent.speed * dt;
    const nx   = ent.x + (dx / d) * step;
    const nz   = ent.z + (dz / d) * step;

    if (ent.canTraverse || isPassable(nx, nz)) { ent.x = nx; ent.z = nz; }
    else if (isPassable(nx, ent.z)) { ent.x = nx; }
    else if (isPassable(ent.x, nz)) { ent.z = nz; }
    else {
      ent._path     = null;
      ent._pathDest = null;
    }

    return Math.hypot(ent.x - tx, ent.z - tz) <= stopDist;
  }

  // No path — direct slide
  ent._lastMoveDist = undefined;
  ent._stuckAccum   = 0;
  const dx = tx - ent.x, dz = tz - ent.z;
  const d  = Math.hypot(dx, dz);
  if (d <= stopDist) return true;
  const step = ent.speed * dt;
  const nx   = ent.x + (dx / d) * step;
  const nz   = ent.z + (dz / d) * step;
  if (isPassable(nx, nz)) { ent.x = nx; ent.z = nz; }
  else if (isPassable(nx, ent.z)) { ent.x = nx; }
  else if (isPassable(ent.x, nz)) { ent.z = nz; }
  return false;
}

/** Find nearest living entity passing the filter, within maxDist. */
export function findNearest(origin, filter, maxDist = 999) {
  let best = null, bestD = maxDist;
  for (const e of G.entities) {
    if (!e.alive || !filter(e)) continue;
    const d = dist(origin, e);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

export function findNearestEnemy(ent, maxDist = 20) {
  return findNearest(ent,
    o => o !== ent && o.faction !== ent.faction && o.faction !== FAC.NEUTRAL,
    maxDist
  );
}

export function findHQ(faction) {
  return G.entities.find(e => e.alive && e.isBldg && e.subtype === 'hq' && e.faction === faction) || null;
}

/** Simple entity-entity separation so units don’t stack and get stuck. */
export function separateUnits(ent) {
  if (!ent.isUnit) return;
  for (const other of G.entities) {
    if (other === ent || !other.alive || other.isRes) continue;

    // Never push apart units that are in melee with each other —
    // separation distance (2.0) exceeds melee atkRange (1.8) which
    // would prevent damage from ever landing.
    const entAttacking  = ent.state === 'attacking'   && ent.targetEnt === other;
    const otherAttacking = other.isUnit && other.state === 'attacking' && other.targetEnt === ent;
    if (entAttacking || otherAttacking) continue;

    const minD = other.isBldg ? other.size * 2 * 0.5 + 1.2 : 2.0;
    const d = dist(ent, other);
    if (d < minD && d > 0.01) {
      const push = (minD - d) * 0.5;
      const dx = (ent.x - other.x) / d;
      const dz = (ent.z - other.z) / d;
      // Only push to passable tiles — never shove into TRASH/walls
      const nx = ent.x + dx * push;
      const nz = ent.z + dz * push;
      if (isPassable(nx, nz)) { ent.x = nx; ent.z = nz; }
      else if (isPassable(nx, ent.z)) { ent.x = nx; }
      else if (isPassable(ent.x, nz)) { ent.z = nz; }
      if (other.isUnit) {
        const ox = other.x - dx * push * 0.5;
        const oz = other.z - dz * push * 0.5;
        if (isPassable(ox, oz)) { other.x = ox; other.z = oz; }
        else if (isPassable(ox, other.z)) { other.x = ox; }
        else if (isPassable(other.x, oz)) { other.z = oz; }
      }
    }
  }
  ent.x = Math.max(1, Math.min(WORLD_W - 1, ent.x));
  ent.z = Math.max(1, Math.min(WORLD_H - 1, ent.z));
}

/** Pick entity at a world position within an interaction radius. */
export function entityAtWorld(wx, wz, maxDist = 8) {
  let best = null, bestD = maxDist;
  for (const e of G.entities) {
    if (!e.alive) continue;
    const r = e.isBldg ? e.size * TILE * 0.6 : (e.isRes ? 9.0 : 4.0);
    const d = Math.hypot(e.x - wx, e.z - wz);
    if (d < r && d < bestD) { bestD = d; best = e; }
  }
  return best;
}
