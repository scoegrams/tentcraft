// ═══════════════════════════════════════════════════════════
// units.js — unit spawning, state machine, combat
// Mirrors Warcraft's Unit class + UnitController
// ═══════════════════════════════════════════════════════════

import { UNIT_DEFS, FAC } from './constants.js';
import { G, getRes } from './state.js';
import { Entity } from './entities.js';
import { createUnitMesh, spawnParticles, syncMeshes, spawnProjectile } from './renderer.js';
import { COL } from './constants.js';
import { moveToward, findNearestEnemy, findNearest, findHQ, separateUnits, dist } from './world.js';
import { sfxAttack, sfxHit, sfxDeath, sfxGather, sfxBuild } from './sfx.js';

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
          ent.state = 'idle';
          ent.targetX = null;
        }
      } else {
        ent.state = 'idle';
      }
      // Auto-aggro nearby enemies while moving (not workers)
      if (ent.subtype !== 'worker') {
        const enemy = findNearestEnemy(ent, 10);
        if (enemy) { ent.targetEnt = enemy; ent.state = 'attacking'; }
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
        moveToward(ent, tgt.x, tgt.z, ent.atkRange * 0.85, dt);
      }
      break;
    }

    case 'gathering': {
      const res = ent.gatherTarget;
      if (!res || !res.alive) { ent.state = 'idle'; ent.gatherTarget = null; break; }
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
      const hq = findHQ(ent.faction);
      if (!hq) { ent.state = 'idle'; break; }
      const stopR = hq.size * 2 * 0.5 + 1.5;
      if (moveToward(ent, hq.x, hq.z, stopR, dt)) {
        // Deposit the correct resource
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
          // Auto-find same resource type first, then any dump
          const prevType = ent.gatherTarget?.subtype;
          const nextRes = findNearest(ent,
            o => o.isRes && o.alive && (prevType ? o.subtype === prevType : o.subtype === 'dump'),
            120
          ) || findNearest(ent, o => o.isRes && o.alive, 120);
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
  }

  separateUnits(ent);
  syncMeshes(ent);
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
