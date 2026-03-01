// ═══════════════════════════════════════════════════════════
// units.js — unit spawning, state machine, combat
// Mirrors Warcraft's Unit class + UnitController
// ═══════════════════════════════════════════════════════════

import { UNIT_DEFS, FAC, COL, TILE } from './constants.js';
import { G, getRes } from './state.js';
import { Entity } from './entities.js';
import { createUnitMesh, spawnParticles, syncMeshes, spawnProjectile } from './renderer.js';
import { moveToward, moveTo, findNearestEnemy, findNearest, findHQ, separateUnits, dist } from './world.js';
import { sfxAttack, sfxHit, sfxDeath, sfxGather, sfxBuild } from './sfx.js';
import { clearTrashTile, getTileType, harvestTrash, getTrashAmount, nearestTrashWithSalvage } from './terrain.js';

export function spawnUnit(subtype, faction, x, z) {
  const def = UNIT_DEFS[subtype];
  if (!def) return null;

  const ent    = new Entity('unit', subtype, faction, x, z);
  ent.hp       = def.hp; ent.maxHp = def.hp;
  ent.atk      = def.atk;
  ent.atkRange = def.range;
  ent.atkCd    = def.atkCd;
  ent.speed    = def.speed;
  ent.suicide  = !!def.suicide;

  createUnitMesh(ent);
  G.entities.push(ent);

  const popCost = def.pop || 1;
  getRes(faction).pop += popCost;

  // Wrap the renderer's kill hook so pop is returned on death
  const _rendererKill = ent._onKill;
  ent._onKill = () => {
    _rendererKill?.call(ent);
    getRes(faction).pop = Math.max(0, getRes(faction).pop - popCost);
    // Remove from selection if selected
    const idx = G.selection.indexOf(ent);
    if (idx !== -1) G.selection.splice(idx, 1);
  };

  return ent;
}

export function updateUnit(ent, dt) {
  if (!ent.alive || !ent.isUnit) return;

  ent.atkTimer = Math.max(0, ent.atkTimer - dt);

  switch (ent.state) {

    case 'idle': {
      if (ent.subtype !== 'worker') {
        const enemy = findNearestEnemy(ent, 18);
        if (enemy) { ent.targetEnt = enemy; ent.state = 'attacking'; }
      }
      break;
    }

    case 'move': {
      if (ent.targetX !== null) {
        if (moveToward(ent, ent.targetX, ent.targetZ, 1.5, dt)) {
          ent.state   = 'idle';
          ent.targetX = null;
          ent._path   = null;
        }
      } else {
        ent.state = 'idle';
      }
      // Auto-aggro nearby enemies while moving (not workers)
      if (ent.subtype !== 'worker') {
        const enemy = findNearestEnemy(ent, 10);
        if (enemy) { ent.targetEnt = enemy; ent.state = 'attacking'; ent._path = null; }
      }
      break;
    }

    case 'attacking': {
      const tgt = ent.targetEnt;
      if (!tgt || !tgt.alive) { ent.state = 'idle'; ent.targetEnt = null; break; }

      if (ent.suicide) {
        // Fire-Eater / Cancellation Drone: run in and explode
        if (dist(ent, tgt) <= 2.5) {
          _explode(ent);
          return;
        }
        moveToward(ent, tgt.x, tgt.z, 2, dt);
        break;
      }

      const d = dist(ent, tgt);
      if (d <= ent.atkRange) {
        if (ent.atkTimer <= 0) {
          const wasAlive = tgt.alive;
          tgt.damage(ent.atk, ent);
          ent.atkTimer = ent.atkCd;

          const isRanged = ent.atkRange > 3;
          const projCol  = ent.faction === FAC.SCAV ? 0xffcc22 : 0x55aaff;

          if (isRanged) {
            // Spawn a visible projectile (visual only — damage already applied)
            spawnProjectile(ent, tgt, projCol, 32);
            sfxAttack(true);
          } else {
            // Melee — instant impact particles + sound
            spawnParticles(tgt.x, 0.8, tgt.z, projCol, 6);
            sfxAttack(false);
          }

          if (wasAlive && !tgt.alive) sfxDeath();
          else if (wasAlive) sfxHit();
        }
      } else {
        // Spread destination so units don’t all path to the same tile and get stuck
        const radius = tgt.isBldg ? (tgt.size ?? 2) * TILE * 0.6 : 2;
        const angle = (ent.id * 137.5 * Math.PI / 180) % (2 * Math.PI);
        const destX = tgt.x + Math.cos(angle) * radius;
        const destZ = tgt.z + Math.sin(angle) * radius;
        moveToward(ent, destX, destZ, ent.atkRange * 0.85, dt);
      }
      break;
    }

    case 'gathering': {
      const res = ent.gatherTarget;
      if (!res || !res.alive) { ent.state = 'idle'; ent.gatherTarget = null; break; }

      // SCAV workers: only gather Scrap from dumps — NOT salvage nodes (they use extracting for that)
      // GILD workers: gather Scrap from dumps, Salvage from cafes/deptstores
      if (ent.faction === FAC.SCAV &&
          (res.subtype === 'cafe' || res.subtype === 'deptstore')) {
        ent.state = 'idle'; ent.gatherTarget = null; break;
      }

      if (moveToward(ent, res.x, res.z, 3.5, dt)) {
        ent.carriedRes    = ent.carryMax;
        ent.carriedType   = (res.subtype === 'deptstore' || res.subtype === 'cafe') ? 'salvage' : 'scrap';
        res.damage(ent.carryMax);
        ent.state = 'returning';
        sfxGather();
      }
      break;
    }

    case 'returning': {
      // Deposit point: Extractor (if one exists nearby) or HQ
      const depot = _findDepot(ent);
      if (!depot) { ent.state = 'idle'; break; }
      const stopR = (depot.size ?? 2) * 2 * 0.5 + 1.5;
      if (moveToward(ent, depot.x, depot.z, stopR, dt)) {
        const r = getRes(ent.faction);
        if (ent.carriedType === 'salvage') {
          r.salvage += ent.carriedRes;
        } else {
          r.scrap   += ent.carriedRes;
        }
        ent.carriedRes  = 0;
        ent.carriedType = null;

        if (ent.gatherTarget?.alive) {
          ent.state = 'gathering';
        } else {
          const prevType = ent.gatherTarget?.subtype;
          const nextRes = findNearest(ent,
            o => o.isRes && o.alive && (prevType ? o.subtype === prevType : o.subtype === 'dump'),
            120
          ) || findNearest(ent, o => o.isRes && o.alive && o.subtype === 'dump', 120);
          if (nextRes) {
            ent.gatherTarget = nextRes;
            ent.state = 'gathering';
          } else {
            ent.state = 'idle';
            ent.gatherTarget = null;
          }
        }
      }
      break;
    }

    // ── Extracting: workers clear TRASH for scrap or salvage (2:1 scrap:salvage) ──
    // Right-click TRASH → path there, extract, return to HQ (scrap) or Extractor/HQ (salvage).
    case 'extracting': {
      const et = ent.extractTarget;
      if (!et) { ent.state = 'idle'; break; }

      if (!ent._extractReady) {
        if (moveToward(ent, et.wx, et.wz, TILE * 1.4, dt)) {
          ent._extractReady = true;
          ent._extractTimer = 0;
        }
        break;
      }

      ent._extractTimer = (ent._extractTimer ?? 0) + dt;
      if (ent._extractTimer < 3.0) break;

      const result = harvestTrash(et.tx, et.tz);
      if (result.amount > 0) {
        spawnParticles(et.wx, 1, et.wz, result.type === 'scrap' ? 0xe8a030 : 0xd4aa20, 8);
        sfxGather();
        ent.carriedRes   = result.amount;
        ent.carriedType  = result.type;
        ent._extractReady = false;
        ent._extractTimer = 0;
        ent.state = 'extract-return';
      } else {
        // Tile depleted — find next TRASH tile
        const next = nearestTrashWithSalvage(ent.x, ent.z, 30);
        if (next) {
          ent.extractTarget = next;
          ent._extractReady = false;
          ent._extractTimer = 0;
        } else {
          ent.state = 'idle';
          ent.extractTarget = null;
        }
      }
      break;
    }

    case 'extract-return': {
      const depot = _findDepot(ent);
      if (!depot) { ent.state = 'idle'; break; }
      const stopR = (depot.size ?? 2) * 2 * 0.5 + 1.5;
      if (moveToward(ent, depot.x, depot.z, stopR, dt)) {
        const r = getRes(ent.faction);
        if (ent.carriedType === 'salvage') r.salvage += ent.carriedRes;
        else r.scrap += ent.carriedRes;
        ent.carriedRes  = 0;
        ent.carriedType = null;

        const et = ent.extractTarget;
        if (et && getTrashAmount(et.tx, et.tz) > 0) {
          ent.state = 'extracting';
        } else {
          const next = nearestTrashWithSalvage(ent.x, ent.z, 30);
          if (next) { ent.extractTarget = next; ent.state = 'extracting'; }
          else { ent.state = 'idle'; ent.extractTarget = null; }
        }
      }
      break;
    }

    case 'build': {
      const tgt = ent.targetEnt;
      if (!tgt || !tgt.alive || !tgt.isBuilding) { ent.state = 'idle'; break; }
      const stopR = tgt.size * 2 * 0.5 + 2;
      if (moveToward(ent, tgt.x, tgt.z, stopR, dt)) {
        tgt.buildProgress += dt;
        tgt.hp = Math.max(1, Math.floor(tgt.maxHp * Math.min(1, tgt.buildProgress / tgt.buildMax)));
        if (tgt.buildProgress >= tgt.buildMax) {
          tgt.hp = tgt.maxHp;
          tgt.isBuilding = false;
          ent.state = 'idle';
          ent.targetEnt = null;
          sfxBuild();
        }
      }
      break;
    }

    // ── Trash-clearing: workers rummage TRASH tiles like WC2 lumber ──
    case 'clearing': {
      if (!ent.clearTarget) { ent.state = 'idle'; break; }
      const ct = ent.clearTarget;
      if (moveToward(ent, ct.wx, ct.wz, TILE * 1.2, dt)) {
        // Adjacent — spend 2 s per tile (clearTimer counts down)
        ent.clearTimer = (ent.clearTimer ?? 0) + dt;
        if (ent.clearTimer >= 2.0) {
          // Check the tile is still TRASH (another worker may have cleared it)
          const T_TRASH = 4; // numeric value of T.TRASH in terrain constants
          if (getTileType(ct.tx, ct.tz) === T_TRASH) {
            const scrap = clearTrashTile(ct.tx, ct.tz);
            getRes(ent.faction).scrap += scrap;
            spawnParticles(ct.wx, 1, ct.wz, 0xaa7733, 10);
            sfxGather();
          }
          ent.clearTimer = 0;
          ent.clearTarget = null;
          ent.state = 'idle';
        }
      }
      break;
    }
  }

  separateUnits(ent);
  syncMeshes(ent);
}

/** Find depot: scrap → HQ; salvage → Extractor (SCAV) or HQ. */
function _findDepot(ent) {
  if (ent.carriedType === 'salvage') {
    const extractor = findNearest(ent,
      o => o.alive && o.isBldg && o.subtype === 'extractor' && o.faction === ent.faction && !o.isBuilding,
      200
    );
    if (extractor) return extractor;
  }
  return findHQ(ent.faction);
}

function _explode(ent) {
  const blastR = 8;
  for (const other of G.entities) {
    if (!other.alive || other === ent) continue;
    if (dist(ent, other) <= blastR) other.damage(ent.atk, ent);
  }
  spawnParticles(ent.x, 2, ent.z, 0xff6600, 32);
  spawnParticles(ent.x, 1, ent.z, 0xffcc00, 20);
  ent.kill();
}
