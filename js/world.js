// ═══════════════════════════════════════════════════════════
// world.js — spatial helpers, pathfinding primitives
// Mirrors Warcraft's MapGrid + pathfinding utilities
// ═══════════════════════════════════════════════════════════

import { WORLD_W, WORLD_H, FAC } from './constants.js';
import { G } from './state.js';
import { isPassable } from './terrain.js';

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Move entity toward (tx, tz). Returns true when within stopDist.
 *  Slides along impassable tiles rather than stopping dead — units
 *  pick the X or Z component that IS passable, like WC2's simple slide. */
export function moveToward(ent, tx, tz, stopDist, dt) {
  const dx = tx - ent.x;
  const dz = tz - ent.z;
  const d  = Math.hypot(dx, dz);
  if (d <= stopDist) return true;

  const step = ent.speed * dt;
  const nx   = ent.x + (dx / d) * step;
  const nz   = ent.z + (dz / d) * step;

  // Check terrain passability; slide if blocked
  if (isPassable(nx, nz)) {
    ent.x = nx; ent.z = nz;
  } else if (isPassable(nx, ent.z)) {
    ent.x = nx;
  } else if (isPassable(ent.x, nz)) {
    ent.z = nz;
  }
  // (fully blocked corner — unit stops, which is correct WC2 behavior)
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

/** Simple entity-entity separation (no grid, mirrors Warcraft's push logic). */
export function separateUnits(ent) {
  if (!ent.isUnit) return;
  for (const other of G.entities) {
    if (other === ent || !other.alive || other.isRes) continue;
    const minD = other.isBldg ? other.size * 2 * 0.5 + 1 : 1.5;
    const d = dist(ent, other);
    if (d < minD && d > 0.01) {
      const push = (minD - d) * 0.3;
      const dx = (ent.x - other.x) / d;
      const dz = (ent.z - other.z) / d;
      ent.x += dx * push;
      ent.z += dz * push;
      if (other.isUnit) {
        other.x -= dx * push * 0.5;
        other.z -= dz * push * 0.5;
      }
    }
  }
  // World clamp
  ent.x = Math.max(1, Math.min(WORLD_W - 1, ent.x));
  ent.z = Math.max(1, Math.min(WORLD_H - 1, ent.z));
}

/** Pick entity at a world position within an interaction radius. */
export function entityAtWorld(wx, wz, maxDist = 6) {
  let best = null, bestD = maxDist;
  for (const e of G.entities) {
    if (!e.alive) continue;
    // Hit radius by type — resources are large cones/boxes, need bigger radius
    const r = e.isBldg ? e.size * 2 * 0.55 : (e.isRes ? 5.0 : 1.8);
    const d = Math.hypot(e.x - wx, e.z - wz);
    if (d < r && d < bestD) { bestD = d; best = e; }
  }
  return best;
}
