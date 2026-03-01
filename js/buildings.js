// ═══════════════════════════════════════════════════════════
// buildings.js — building spawning, production queues, towers
// Mirrors Warcraft's Building class + StatusPane production logic
// ═══════════════════════════════════════════════════════════

import { BLDG_DEFS, UNIT_DEFS, FAC, TILE, WORLD_W } from './constants.js';
import { G, getRes } from './state.js';
import { Entity } from './entities.js';
import { createBldgMesh, spawnParticles, spawnProjectile, setRallyFlag,
         flashEntityOnHit, spawnDmgNumber } from './renderer.js';
import { sfxTower, sfxBuild, sfxDeath, sfxPiperSpawned } from './sfx.js';
import { spawnUnit } from './units.js';
import { findNearest, moveTo } from './world.js';
import { markBuilding } from './navmesh.js';

export function spawnBuilding(subtype, faction, x, z, instant = false) {
  const def = BLDG_DEFS[subtype];
  if (!def) return null;

  const ent       = new Entity('building', subtype, faction, x, z);
  ent.size        = def.size;
  ent.foodAdd     = def.foodAdd || 0;
  // Rally point — null means units spawn at building edge, set by right-click
  ent.rallyX      = null;
  ent.rallyZ      = null;

  if (def.towerRange) {
    ent.towerRange = def.towerRange;
    ent.towerDmg   = def.towerDmg;
    ent.towerCd    = def.towerCd;
  }

  if (instant) {
    ent.hp = def.hp; ent.maxHp = def.hp;
    ent.isBuilding = false;
  } else {
    ent.hp = 1; ent.maxHp = def.hp;
    ent.isBuilding  = true;
    ent.buildProgress = 0;
    ent.buildMax      = def.buildTime;
  }

  createBldgMesh(ent);
  G.entities.push(ent);
  getRes(faction).popCap += def.foodAdd;

  // Bake into nav grid immediately so pathfinding avoids this building
  markBuilding(x, z, def.size, true);

  // Death hook — remove food cap and unblock nav grid
  const origKill = ent._onKill;
  ent._onKill = () => {
    origKill?.call(ent);
    getRes(faction).popCap = Math.max(0, getRes(faction).popCap - def.foodAdd);
    markBuilding(ent.x, ent.z, ent.size, false);
  };

  return ent;
}

export function updateBuilding(ent, dt) {
  if (!ent.alive || !ent.isBldg) return;

  // ── Tower auto-attack ──────────────────────────────────
  if (ent.towerRange > 0 && !ent.isBuilding) {
    ent.towerTimer = Math.max(0, ent.towerTimer - dt);
    if (ent.towerTimer <= 0) {
      const enemy = findNearest(ent,
        o => o.isUnit && o.faction !== ent.faction && o.faction !== FAC.NEUTRAL,
        ent.towerRange
      );
      if (enemy) {
        const wasAlive = enemy.alive;
        enemy.damage(ent.towerDmg, ent);
        ent.towerTimer = ent.towerCd;
        flashEntityOnHit(enemy);
        spawnDmgNumber(enemy.x, enemy.z, ent.towerDmg);
        const projCol = ent.faction === FAC.SCAV ? 0xffcc00 : 0xcc44ff;
        spawnProjectile(ent, enemy, projCol, 36);
        sfxTower();
        if (wasAlive && !enemy.alive) sfxDeath();
      }
    }
  }

  // ── Production queue ───────────────────────────────────
  if (ent.prodQueue.length > 0 && !ent.isBuilding) {
    const unitType = ent.prodQueue[0];
    const udef     = UNIT_DEFS[unitType];
    if (!udef) { ent.prodQueue.shift(); return; }

    ent.prodMax    = udef.buildTime;
    ent.prodTimer += dt;

    if (ent.prodTimer >= ent.prodMax) {
      // Spawn on the side of the building that faces the enemy (toward map centre)
      const facingDir = ent.x > WORLD_W / 2 ? -1 : 1;
      const offset    = (ent.size * TILE * 0.5 + 3) * facingDir;
      const unit = spawnUnit(unitType, ent.faction,
        ent.x + offset,
        ent.z + (Math.random() * 4 - 2)
      );
      // Piper announces when spawned from SCAV Mess Hall
      if (unit && ent.faction === FAC.SCAV && unitType === 'infantry') {
        sfxPiperSpawned();
      }
      if (unit) {
        if (ent.rallyX !== null) {
          // Player-set rally point — march there
          unit.targetX = ent.rallyX; unit.targetZ = ent.rallyZ; unit.state = 'move';
          moveTo(unit, ent.rallyX, ent.rallyZ);
        } else {
          // No rally: nudge the unit clear of the building cluster so it
          // doesn't pile up at the door and block future spawns.
          const clearX = ent.x + facingDir * 16;
          unit.targetX = clearX; unit.targetZ = ent.z;
          unit.state   = 'move';
          moveTo(unit, clearX, ent.z);
        }
      }
      ent.prodQueue.shift();
      ent.prodTimer = 0;
    }
  }
}
