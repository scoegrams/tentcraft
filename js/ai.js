// ═══════════════════════════════════════════════════════════
// ai.js — Gilded AI opponent
// Three systems drawn from the Warcraft reference:
//   • UnitTraitMiner.cs  → worker gather loop
//   • Radar.cs           → proximity auto-aggro for base defense
//   • AIPlayer.cs Think()→ build order + grouped attack waves
// ═══════════════════════════════════════════════════════════

import { FAC, BLDG_DEFS, UNIT_DEFS } from './constants.js';
import { config } from './config.js';
import { getUnitCost } from './constants.js';
import { G, canAfford, spend } from './state.js';
import { spawnBuilding } from './buildings.js';
import { spawnUnit, assignExtractTarget } from './units.js';
import { findHQ, findNearest, dist } from './world.js';
import { nearestTrashWithSalvage } from './terrain.js';

// ── Worker management: most clear TRASH (scrap/salvage 2:1), rest hit dumps/cafes ──
function _manageWorkers() {
  const ai = G.ai;

  for (const w of G.entities) {
    if (!w.alive || !w.isUnit || w.faction !== config.aiFac) continue;
    if (w.subtype !== 'worker' || w.state !== 'idle') continue;

    // Prefer TRASH so most workers clear paths (get scrap 2× more often than salvage)
    const trash = nearestTrashWithSalvage(w.x, w.z, 80);
    if (trash) {
      assignExtractTarget(w, trash); // handles claiming so workers spread across piles
      continue;
    }

    const needsScrap = ai.scrap < ai.salvage * 1.5;
    const primary   = needsScrap ? 'dump' : 'cafe';
    const secondary = needsScrap ? 'cafe' : 'dump';
    const target = findNearest(w, o => o.isRes && o.subtype === primary   && o.alive, 300)
                || findNearest(w, o => o.isRes && o.subtype === secondary && o.alive, 300)
                || findNearest(w, o => o.isRes && o.subtype === 'deptstore' && o.alive, 300)
                || findNearest(w, o => o.isRes && o.alive, 300);
    if (target) { w.gatherTarget = target; w.state = 'gathering'; }
  }
}

// ── Base defense (Radar.cs OnTriggerEnter pattern) ────────
// Checks a defense perimeter around the HQ every half-second.
// When an enemy unit enters, ALL idle combat units are rallied —
// not a subset, not one at a time: everyone goes.
const DEFEND_RADIUS = 26;

function _defendBase(aiHQ) {
  // Find the nearest threatening unit inside the perimeter
  const threat = findNearest(aiHQ,
    o => o.alive && o.isUnit && o.faction === config.playerFac && o.subtype !== 'worker',
    DEFEND_RADIUS
  );
  if (!threat) return false;

  // Rally all idle/wandering combat units immediately
  let rallied = 0;
  for (const e of G.entities) {
    if (!e.alive || !e.isUnit || e.faction !== config.aiFac) continue;
    if (e.subtype === 'worker') continue;
    if (e.state === 'idle' || e.state === 'move') {
      e.targetEnt = threat;
      e.state     = 'attacking';
      rallied++;
    }
  }
  return rallied > 0;
}

// ── Grouped attack wave ───────────────────────────────────
// Waits until a minimum army threshold is reached, then sends
// a capped group with a small per-unit stagger so they charge
// as a squad rather than teleporting to "attacking" all at once.
function _launchWave(ai) {
  const playerHQ = findHQ(config.playerFac);
  if (!playerHQ) return;

  const idleArmy = G.entities.filter(
    e => e.alive && e.isUnit && e.faction === config.aiFac &&
         e.subtype !== 'worker' && e.state === 'idle'
  );

  // Don't attack unless we have a meaningful force assembled
  const minForce = Math.max(3, Math.min(ai.waveSize, 7));
  if (idleArmy.length < minForce) return;

  // Cap wave size — excess units stay idle and join the next wave
  const WAVE_CAP = 6;
  const wave = idleArmy.slice(0, WAVE_CAP);

  // Find the most forward (closest to player) enemy structure to attack
  const target = G.entities.reduce((best, e) => {
    if (!e.alive || !e.isBldg || e.faction !== config.playerFac) return best;
    const d = dist(e, wave[0]);
    return (!best || d < dist(best, wave[0])) ? e : best;
  }, null) || playerHQ;

  // Stagger each unit by 0.3s so they charge as a squad, not a teleport
  wave.forEach((u, i) => {
    u._waveDelay    = i * 0.3;
    u._waveTarget   = target;
    u.targetEnt     = target;
    u.state         = 'attacking';
  });

  ai.waveSize = Math.min(ai.waveSize + 1, 14);
}

// ── Main AI update ────────────────────────────────────────
export function updateAI(dt) {
  if (G.gameOver) return;

  const ai = G.ai;
  ai.buildTimer   = (ai.buildTimer   || 0) + dt;
  ai.attackTimer  = (ai.attackTimer  || 0) + dt;
  ai.defendTimer  = (ai.defendTimer  || 0) + dt;
  ai.workerTimer  = (ai.workerTimer  || 0) + dt;
  ai.trainTimer   = (ai.trainTimer   || 0) + dt;

  const aiHQ = findHQ(config.aiFac);
  if (!aiHQ) return;

  // No passive income — the AI earns everything through workers, same as the player.

  // ── Worker idle check (every 1s) ───────────────────────
  if (ai.workerTimer > 1) {
    ai.workerTimer = 0;
    _manageWorkers();
  }

  // ── Base defense radar (every 0.4s) ────────────────────
  if (ai.defendTimer > 0.4) {
    ai.defendTimer = 0;
    _defendBase(aiHQ);
  }

  // ── Build order (every 3.5s tick) ──────────────────────
  if (ai.buildTimer > 3.5) {
    ai.buildTimer = 0;

    const aiBldgs    = G.entities.filter(e => e.alive && e.faction === config.aiFac && e.isBldg);
    const workerCount = G.entities.filter(e => e.alive && e.isUnit && e.faction === config.aiFac && e.subtype === 'worker').length;
    const housing     = aiBldgs.filter(e => e.subtype === 'housing').length;
    const hasBarracks = aiBldgs.some(e => e.subtype === 'barracks');
    const hasUpgrade  = aiBldgs.some(e => e.subtype === 'upgrade');
    const hasMagic    = aiBldgs.some(e => e.subtype === 'magic');
    const towerCount  = aiBldgs.filter(e => e.subtype === 'tower').length;

    // Priority 1: pop cap — always keep headroom
    if (housing < 10 && ai.pop >= ai.popCap - 2 && canAfford(config.aiFac, BLDG_DEFS.housing.cost)) {
      spend(config.aiFac, BLDG_DEFS.housing.cost);
      const ox = [-12, 12, 12, -12, 0, 14, -14, 0, 14, -14][housing] || 0;
      const oz = [-12, -12, 12, 12, -16, 0, 0, 16, -8, 8][housing]   || 0;
      spawnBuilding('housing', config.aiFac, aiHQ.x + ox, aiHQ.z + oz, true);
    }

    // All AI building offsets are relative to HQ and placed BEHIND it (away from
    // the enemy) so the gap in front stays clear for units to march through.
    // The AI's HQ is always on the far side of the map (opposite the player),
    // so "behind" means further away from map centre.
    const behindDir = aiHQ.x > 120 ? 1 : -1; // +1 = east (GILD), -1 = west (SCAV)

    // Priority 2: barracks (military production) — behind and to the side
    if (!hasBarracks && canAfford(config.aiFac, BLDG_DEFS.barracks.cost)) {
      spend(config.aiFac, BLDG_DEFS.barracks.cost);
      spawnBuilding('barracks', config.aiFac, aiHQ.x + behindDir * 14, aiHQ.z + 16, true);
    }

    // Priority 3: defensive towers — placed in FRONT of HQ (facing enemy)
    if (towerCount < 3 && hasBarracks && canAfford(config.aiFac, BLDG_DEFS.tower.cost)) {
      const tOffsets = [
        [-behindDir * 22,  0],
        [-behindDir * 22, -18],
        [-behindDir * 22,  18],
      ];
      const [ox, oz] = tOffsets[towerCount] || [-behindDir * 22, 0];
      spend(config.aiFac, BLDG_DEFS.tower.cost);
      spawnBuilding('tower', config.aiFac, aiHQ.x + ox, aiHQ.z + oz, true);
    }

    // Priority 4: upgrade + magic — behind HQ, well clear of the march lane
    if (hasBarracks && !hasUpgrade && canAfford(config.aiFac, BLDG_DEFS.upgrade.cost)) {
      spend(config.aiFac, BLDG_DEFS.upgrade.cost);
      spawnBuilding('upgrade', config.aiFac, aiHQ.x + behindDir * 14, aiHQ.z - 16, true);
    }
    if (hasBarracks && !hasMagic && canAfford(config.aiFac, BLDG_DEFS.magic.cost)) {
      spend(config.aiFac, BLDG_DEFS.magic.cost);
      spawnBuilding('magic', config.aiFac, aiHQ.x + behindDir * 26, aiHQ.z, true);
    }
  }

  // ── Attack wave (escalating, grouped) ──────────────────
  const waveInterval = Math.max(18, 50 - ai.waveSize * 3);
  if (ai.attackTimer > waveInterval) {
    ai.attackTimer = 0;
    _launchWave(ai);
  }

  // ── Train units (every 0.5s tick to avoid over-queuing) ──
  if (ai.trainTimer < 0.5) return;
  ai.trainTimer = 0;

  const aiBldgs = G.entities.filter(e => e.alive && e.faction === config.aiFac && e.isBldg);
  const workerCount = G.entities.filter(
    e => e.alive && e.isUnit && e.faction === config.aiFac && e.subtype === 'worker'
  ).length;

  // Worker target scales with game progression: start at 4, grow to 6 over time.
  // Also bump target if the treasury is running low (needs more income).
  const resourcesPoor = ai.scrap < 150 || ai.salvage < 60;
  const workerTarget = Math.min(6, 3 + Math.floor(ai.waveSize / 3)) + (resourcesPoor ? 1 : 0);

  for (const b of aiBldgs) {
    if (b.isBuilding || b.prodQueue.length >= 2) continue;
    if (ai.pop >= ai.popCap) continue;

    let ut = null;

    if (b.subtype === 'hq') {
      // Workers always come first — no military if we can't pay for it
      if (workerCount < workerTarget) ut = 'worker';
    } else if (b.subtype === 'barracks') {
      // Don't queue military units if we're broke — save up first
      if (!resourcesPoor || workerCount >= workerTarget) {
        const roll = Math.random();
        ut = roll < 0.45 ? 'infantry' : roll < 0.75 ? 'ranged' : 'siege';
      }
    } else if (b.subtype === 'upgrade') {
      if (!resourcesPoor) ut = Math.random() < 0.5 ? 'heavy' : null;
    } else if (b.subtype === 'magic') {
      if (!resourcesPoor) ut = Math.random() < 0.35 ? 'caster' : null;
    }

    const cost = getUnitCost(ut, config.aiFac);
    if (ut && canAfford(config.aiFac, cost)) {
      spend(config.aiFac, cost);
      b.prodQueue.push(ut);
    }
  }
}
