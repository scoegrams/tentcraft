// ═══════════════════════════════════════════════════════════
// units.js — unit spawning, state machine, combat
// Mirrors Warcraft's Unit class + UnitController
// ═══════════════════════════════════════════════════════════

import { UNIT_DEFS, FAC, COL, TILE } from './constants.js';
import { G, getRes } from './state.js';
import { Entity } from './entities.js';
import { createUnitMesh, spawnParticles, syncMeshes, spawnProjectile, spawnHitFlash,
         flashEntityOnHit, spawnDmgNumber } from './renderer.js';
import { moveToward, moveTo, findNearestEnemy, findNearest, findHQ, separateUnits, dist } from './world.js';
import { sfxSword, sfxShoot, sfxAttack, sfxHit, sfxDeath, sfxGather, sfxBuild,
         sfxPipeHit, sfxSlingerShot, sfxDrakoBlast, sfxHammer, sfxPiperKill } from './sfx.js';
import { clearTrashTile, getTileType, harvestTrash, getTrashAmount, nearestTrashWithSalvage, trashTileKey } from './terrain.js';

// ── TRASH tile claiming ───────────────────────────────────
// Prevents all workers from piling onto the same pile.
// key = trashTileKey(tx,tz) → Set of entity ids working it.
const _trashClaims = new Map(); // key → Set<id>

function _claimTrash(ent, tile) {
  _unclaimTrash(ent);
  if (!tile) return;
  const k = trashTileKey(tile.tx, tile.tz);
  if (!_trashClaims.has(k)) _trashClaims.set(k, new Set());
  _trashClaims.get(k).add(ent.id);
  ent._claimedKey = k;
}
function _unclaimTrash(ent) {
  if (ent._claimedKey != null) {
    const s = _trashClaims.get(ent._claimedKey);
    if (s) { s.delete(ent.id); if (s.size === 0) _trashClaims.delete(ent._claimedKey); }
    ent._claimedKey = null;
  }
}
// Returns keys currently occupied by other workers (not ent itself)
function _claimedByOthers(ent) {
  const out = new Set();
  for (const [k, ids] of _trashClaims) {
    if (ids.size > 1 || (ids.size === 1 && !ids.has(ent.id))) out.add(k);
  }
  return out;
}
// Find nearest unclaimed TRASH tile; falls back to claimed if nothing else available
function _bestTrash(ent, radius = 80) {
  return nearestTrashWithSalvage(ent.x, ent.z, radius, _claimedByOthers(ent));
}

export function spawnUnit(subtype, faction, x, z) {
  const def = UNIT_DEFS[subtype];
  if (!def) return null;

  const ent    = new Entity('unit', subtype, faction, x, z);
  ent.hp       = def.hp; ent.maxHp = def.hp;
  ent.atk          = def.atk;
  ent.atkRange     = def.range;
  ent.atkCd        = def.atkCd;
  ent.speed        = def.speed;
  ent.suicide      = !!def.suicide;
  ent.kite         = !!def.kite;
  ent.canTraverse  = !!def.canTraverse;
  ent.capacity     = def.capacity ?? 0;
  ent.cargo        = [];   // units currently aboard (transport only)
  ent.boarded      = false; // true while this unit is riding inside a transport
  ent.boardTarget  = null;  // transport this unit is heading to

  createUnitMesh(ent);
  G.entities.push(ent);

  const popCost = def.pop || 1;
  getRes(faction).pop += popCost;

  // Wrap the renderer's kill hook so pop is returned on death
  const _rendererKill = ent._onKill;
  ent._onKill = () => {
    _rendererKill?.call(ent);
    getRes(faction).pop = Math.max(0, getRes(faction).pop - popCost);
    _unclaimTrash(ent); // release any TRASH tile this worker was digging
    const idx = G.selection.indexOf(ent);
    if (idx !== -1) G.selection.splice(idx, 1);
  };

  return ent;
}

// ── Transport unload helper (exported for ui.js / input.js) ──
export function unloadTransport(transport) {
  if (!transport || !transport.cargo) return;
  const cargo = [...transport.cargo];
  transport.cargo = [];
  const count = cargo.length;
  cargo.forEach((u, i) => {
    if (!u || !u.alive) return;
    const angle = (i / Math.max(count, 1)) * Math.PI * 2;
    u.x = transport.x + Math.cos(angle) * 3.5;
    u.z = transport.z + Math.sin(angle) * 3.5;
    u.boarded     = false;
    u.boardTarget = null;
    u.state       = 'idle';
    if (u.mesh) {
      u.mesh.visible = true;
      u.mesh.position.set(u.x, u.mesh.position.y || 0.7, u.z);
    }
    if (u._hpBar)  u._hpBar.group.visible  = true;
    if (u.selRing) u.selRing.visible = true;
  });
}

export function updateUnit(ent, dt) {
  if (!ent.alive || !ent.isUnit) return;

  // Boarded units are frozen inside transport — don't process their state
  if (ent.boarded) return;

  // Wave stagger — unit holds position until its delay expires
  if (ent._waveDelay > 0) {
    ent._waveDelay -= dt;
    return;
  }

  // Transport: eject cargo if destroyed
  if (ent.subtype === 'transport' && ent.hp <= 0 && ent.cargo.length > 0) {
    unloadTransport(ent);
  }

  ent.atkTimer = Math.max(0, ent.atkTimer - dt);

  switch (ent.state) {

    case 'boarding': {
      // Walk toward the transport and disappear inside when close enough
      const tr = ent.boardTarget;
      if (!tr || !tr.alive || tr.cargo.length >= tr.capacity) {
        ent.state = 'idle'; ent.boardTarget = null; break;
      }
      if (dist(ent, tr) < 2.8) {
        tr.cargo.push(ent);
        ent.boarded = true;
        ent.state   = 'aboard';
        if (ent.mesh)   ent.mesh.visible   = false;
        if (ent._hpBar) ent._hpBar.group.visible = false;
        if (ent.selRing) ent.selRing.visible = false;
        ent.selected = false;
      } else {
        moveToward(ent, tr.x, tr.z, 2.8, dt);
      }
      break;
    }

    case 'aboard':
      // Frozen inside transport — boarded flag handles skip at top of updateUnit
      break;

    case 'idle': {
      // Transports don't auto-aggro
      if (ent.subtype === 'transport') break;
      const aggroR = ent.subtype === 'worker' ? 8 : 18;
      const enemy = findNearestEnemy(ent, aggroR);
      if (enemy) {
        ent.targetEnt = enemy; ent.state = 'attacking'; ent._path = null; ent._pathDest = null;
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
      // Workers only snap to attack if enemy is right on top; combat units use 10
      const moveAggroR = ent.subtype === 'worker' ? 5 : 10;
      const enemy = findNearestEnemy(ent, moveAggroR);
      if (enemy) { ent.targetEnt = enemy; ent.state = 'attacking'; ent._path = null; ent._pathDest = null; }
      break;
    }

    case 'attacking': {
      const tgt = ent.targetEnt;
      if (!tgt || !tgt.alive) {
        // Workers return to their job after the enemy is dead
        if (ent.subtype === 'worker') {
          if (ent._prevState && (ent.gatherTarget?.alive || ent.extractTarget)) {
            ent.state = ent._prevState;
          } else {
            ent.state = 'idle';
          }
          ent._prevState = null;
        } else {
          ent.state = 'idle';
        }
        ent.targetEnt = null;
        break;
      }

      if (ent.suicide) {
        // Fire-Eater / Cancellation Drone: run in and explode
        if (dist(ent, tgt) <= 2.5) {
          _explode(ent);
          return;
        }
        moveToward(ent, tgt.x, tgt.z, 2, dt);
        break;
      }

      // WC2 target-switch: if current target is far, but a closer enemy is in weapon range, switch
      const d = dist(ent, tgt);
      // For buildings, measure distance to their edge, not center
      const bldgEdge = tgt.isBldg ? (tgt.size ?? 2) * TILE * 0.5 : 0;
      const effectiveD = Math.max(0, d - bldgEdge);

      if (effectiveD > ent.atkRange * 1.5 && ent.subtype !== 'worker') {
        const closer = findNearestEnemy(ent, ent.atkRange + bldgEdge);
        if (closer && closer !== tgt) {
          ent.targetEnt = closer;
          ent._path = null; ent._pathDest = null;
          break;
        }
      }
      // ── Kiting — ranged/caster back away when melee closes in ──
      // Fires while retreating so long as the target is still in atkRange.
      const KITE_DIST = 3.8;
      if (ent.kite && !tgt.isBldg && effectiveD < KITE_DIST) {
        const dx = ent.x - tgt.x, dz = ent.z - tgt.z;
        const dlen = Math.hypot(dx, dz) || 1;
        const spd = ent.speed * dt * 1.1;
        const kx = ent.x + (dx / dlen) * spd;
        const kz = ent.z + (dz / dlen) * spd;
        // Move away — fall back on axis-aligned nudge if fully blocked
        ent.x = kx; ent.z = kz;
        ent._path = null; ent._pathDest = null;
      }

      if (effectiveD <= ent.atkRange) {
        if (ent.atkTimer <= 0) {
          const wasAlive = tgt.alive;
          tgt.damage(ent.atk, ent);
          ent.atkTimer = ent.atkCd;

          // Visual feedback — flash + floating damage number
          flashEntityOnHit(tgt);
          spawnDmgNumber(tgt.x, tgt.z, ent.atk);

          const isRanged = ent.atkRange > 3;
          const projCol  = ent.faction === FAC.SCAV ? 0xffcc22 : 0x55aaff;

          if (isRanged) {
            spawnProjectile(ent, tgt, projCol, 32);
            if (ent.faction === FAC.SCAV && ent.subtype === 'ranged') sfxSlingerShot();
            else sfxShoot();
          } else {
            spawnParticles(tgt.x, 0.8, tgt.z, projCol, 6);
            spawnHitFlash(tgt.x, tgt.z);
            if (ent.subtype === 'heavy') sfxAttack(false);
            else if (ent.faction === FAC.SCAV && ent.subtype === 'infantry') sfxPipeHit();
            else sfxSword();
          }

          if (wasAlive && !tgt.alive) {
            sfxDeath();
            // Piper taunts on kill
            if (ent.faction === FAC.SCAV && ent.subtype === 'infantry') sfxPiperKill();
          }
          else if (wasAlive) sfxHit();
        }
      } else {
        // Path to building edge + a little inside attack range
        // For units, path straight at them — separation handles spread
        let gx = tgt.x, gz = tgt.z;
        if (tgt.isBldg) {
          const angle = (ent.id * 97.5 * Math.PI / 180) % (2 * Math.PI);
          const r = bldgEdge + ent.atkRange * 0.3;
          gx = tgt.x + Math.cos(angle) * r;
          gz = tgt.z + Math.sin(angle) * r;
        }
        moveToward(ent, gx, gz, ent.atkRange * 0.8, dt);
      }
      break;
    }

    case 'gathering': {
      ent._prevState = 'gathering'; // remember job so worker can return after fighting
      const res = ent.gatherTarget;
      if (!res || !res.alive) { ent.state = 'idle'; ent.gatherTarget = null; break; }

      // SCAV workers: only gather Scrap from dumps — NOT salvage nodes (they use extracting for that)
      // GILD workers: gather Scrap from dumps, Salvage from cafes/deptstores
      if (ent.faction === FAC.SCAV &&
          (res.subtype === 'cafe' || res.subtype === 'deptstore')) {
        ent.state = 'idle'; ent.gatherTarget = null; break;
      }

      // Fight back if attacked while walking to resource
      const gEnemy = findNearestEnemy(ent, 5);
      if (gEnemy) { ent.targetEnt = gEnemy; ent.state = 'attacking'; break; }

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

    // ── Extracting: workers loot TRASH piles like WC2 lumber — approach, dig, haul ──
    case 'extracting': {
      ent._prevState = 'extracting';
      let et = ent.extractTarget;

      // If no target or tile is gone, find the nearest unclaimed pile immediately
      if (!et || getTrashAmount(et.tx, et.tz) <= 0) {
        _unclaimTrash(ent);
        ent._extractReady = false;
        ent._extractTimer = 0;
        const next = _bestTrash(ent);
        if (next) { ent.extractTarget = next; et = next; _claimTrash(ent, next); }
        else { ent.state = 'idle'; ent.extractTarget = null; break; }
      }

      // Claim the tile (idempotent if already claimed)
      if (ent._claimedKey == null) _claimTrash(ent, et);

      // Fight back if attacked while walking to pile
      if (!ent._extractReady) {
        const eEnemy = findNearestEnemy(ent, 5);
        if (eEnemy) {
          ent._extractReady = false; // force re-approach after fight
          ent.targetEnt = eEnemy; ent.state = 'attacking'; break;
        }
        // TRASH is impassable — stop at passable edge (generous dist so workers land cleanly)
        if (moveToward(ent, et.wx, et.wz, TILE * 3.0, dt)) {
          ent._extractReady = true;
          ent._extractTimer = 0;
          ent._digParticleTimer = 0;
        }
        break;
      }

      // Digging — show progress particles every 0.6 s
      ent._extractTimer = (ent._extractTimer ?? 0) + dt;
      ent._digParticleTimer = (ent._digParticleTimer ?? 0) + dt;
      if (ent._digParticleTimer >= 0.6) {
        ent._digParticleTimer = 0;
        spawnParticles(et.wx, 0.6, et.wz, 0x8a6020, 4); // brown dust puffs
      }

      if (ent._extractTimer < 1.8) break; // 1.8 s dig (down from 3 s)

      const result = harvestTrash(et.tx, et.tz);
      if (result.amount > 0) {
        spawnParticles(et.wx, 1.2, et.wz, result.type === 'scrap' ? 0xe8a030 : 0xa0c040, 12);
        sfxGather();
        ent.carriedRes    = result.amount;
        ent.carriedType   = result.type;
        ent._extractReady = false;
        ent._extractTimer = 0;
        ent.state = 'extract-return';
      } else {
        // Pile depleted — unclaim and find the next best unclaimed pile
        _unclaimTrash(ent);
        ent._extractReady = false;
        ent._extractTimer = 0;
        const next = _bestTrash(ent);
        if (next) { ent.extractTarget = next; _claimTrash(ent, next); }
        else { ent.state = 'idle'; ent.extractTarget = null; }
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

        // Go back to same pile if still has resource, otherwise find best unclaimed
        const et = ent.extractTarget;
        if (et && getTrashAmount(et.tx, et.tz) > 0) {
          ent.state = 'extracting';
        } else {
          _unclaimTrash(ent);
          const next = _bestTrash(ent);
          if (next) { ent.extractTarget = next; _claimTrash(ent, next); ent.state = 'extracting'; }
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

        // Hammering sound — play every ~0.75s while actively building
        ent._hammerTimer = (ent._hammerTimer ?? 0) - dt;
        if (ent._hammerTimer <= 0) {
          sfxHammer();
          ent._hammerTimer = 0.72 + Math.random() * 0.18; // slight variation
        }

        if (tgt.buildProgress >= tgt.buildMax) {
          tgt.hp = tgt.maxHp;
          tgt.isBuilding = false;
          ent.state = 'idle';
          ent.targetEnt = null;
          ent._hammerTimer = 0;
          sfxBuild(); // completion fanfare
        }
      } else {
        // Worker still walking to site — reset timer so hammer plays immediately on arrival
        ent._hammerTimer = 0;
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

  if (!ent.boarded) separateUnits(ent);
  syncMeshes(ent);
}

/** Public helper: assign an extract target (handles claiming + state reset). */
export function assignExtractTarget(ent, tile) {
  _claimTrash(ent, tile);
  ent.extractTarget  = tile;
  ent._extractReady  = false;
  ent._extractTimer  = 0;
  ent._digParticleTimer = 0;
  ent.state          = 'extracting';
  ent.targetEnt      = null;
  moveTo(ent, tile.wx, tile.wz);
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
  const blastR = 3.5;
  for (const other of G.entities) {
    if (!other.alive || other === ent) continue;
    if (other.faction === ent.faction) continue;   // never friendly-fire
    if (other.isRes) continue;                      // don't destroy resources
    if (dist(ent, other) <= blastR) {
      other.damage(ent.atk, ent);
      flashEntityOnHit(other);
      spawnDmgNumber(other.x, other.z, ent.atk);
    }
  }
  spawnParticles(ent.x, 2, ent.z, 0xff6600, 32);
  spawnParticles(ent.x, 1, ent.z, 0xffcc00, 20);
  // DraKo (SCAV) gets the big blast cannon sound; GILD Drone gets a different one
  if (ent.faction === FAC.SCAV) sfxDrakoBlast(); else sfxAttack(false);
  ent.kill();
}
