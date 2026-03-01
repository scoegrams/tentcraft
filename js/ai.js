// ═══════════════════════════════════════════════════════════
// ai.js — Gilded AI opponent
// Three systems drawn from the Warcraft reference:
//   • UnitTraitMiner.cs  → worker gather loop
//   • Radar.cs           → proximity auto-aggro for base defense
//   • AIPlayer.cs Think()→ build order + grouped attack waves
// ═══════════════════════════════════════════════════════════

import { FAC, BLDG_DEFS, UNIT_DEFS } from './constants.js';
import { config } from './config.js';
import { G, canAfford, spend } from './state.js';
import { spawnBuilding } from './buildings.js';
import { spawnUnit } from './units.js';
import { findHQ, findNearest, dist } from './world.js';

// ── Worker management (UnitTraitMiner.cs pattern) ────────
// Any idle AI worker is immediately reassigned to the nearest
// resource node — same loop as the reference miner coroutine.
// Workers are split: scrap gatherers go to dumps, salvage to cafes.
// If scrap reserves are low (common — most units need scrap), bias toward dumps.
function _manageWorkers() {
  const ai = G.ai;

  for (const w of G.entities) {
    if (!w.alive || !w.isUnit || w.faction !== config.aiFac) continue;
    if (w.subtype !== 'worker' || w.state !== 'idle') continue;

    // Adaptive dispatch: gather whichever resource the AI needs more.
    // Scrap drives unit production; salvage drives tech buildings.
    const needsScrap = ai.scrap < ai.salvage * 1.5;
    const primary    = needsScrap ? 'dump'      : 'cafe';
    const secondary  = needsScrap ? 'cafe'      : 'dump';

    const target = findNearest(w, o => o.isRes && o.subtype === primary   && o.alive, 300)
                || findNearest(w, o => o.isRes && o.subtype === secondary  && o.alive, 300)
                || findNearest(w, o => o.isRes && o.subtype === 'deptstore'&& o.alive, 300)
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
// the ENTIRE idle army at once (Warcraft's "send all" order).
// This prevents the one-at-a-time trickle the old code had.
function _launchWave(ai) {
  const playerHQ = findHQ(config.playerFac);
  if (!playerHQ) return;

  const idleArmy = G.entities.filter(
    e => e.alive && e.isUnit && e.faction === config.aiFac &&
         e.subtype !== 'worker' && e.state === 'idle'
  );

  // Don't attack unless we have a meaningful force assembled
  const minForce = Math.max(3, Math.min(ai.waveSize, 8));
  if (idleArmy.length < minForce) return;

  // Find the most forward (closest to player) enemy structure to attack —
  // not always the HQ, sometimes a barracks or tower is closer
  const target = G.entities.reduce((best, e) => {
    if (!e.alive || !e.isBldg || e.faction !== config.playerFac) return best;
    const d = dist(e, idleArmy[0]);
    return (!best || d < dist(best, idleArmy[0])) ? e : best;
  }, null) || playerHQ;

  for (const u of idleArmy) {
    u.targetEnt = target;
    u.state     = 'attacking';
  }
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

  // ── Passive scrap income ────────────────────────────────
  // Supplemental income so the AI can keep building while workers gather.
  ai.scrap += 10 * dt;

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

    // Priority 2: barracks (military production)
    if (!hasBarracks && canAfford(config.aiFac, BLDG_DEFS.barracks.cost)) {
      spend(config.aiFac, BLDG_DEFS.barracks.cost);
      spawnBuilding('barracks', config.aiFac, aiHQ.x - 16, aiHQ.z + 10, true);
    }

    // Priority 3: defensive towers (west-facing, spaced apart)
    if (towerCount < 3 && hasBarracks && canAfford(config.aiFac, BLDG_DEFS.tower.cost)) {
      const tOffsets = [[-20, -16], [-20, 16], [-30, 0]];
      const [ox, oz] = tOffsets[towerCount] || [-20, 0];
      spend(config.aiFac, BLDG_DEFS.tower.cost);
      spawnBuilding('tower', config.aiFac, aiHQ.x + ox, aiHQ.z + oz, true);
    }

    // Priority 4: upgrade + magic for tech diversity
    if (hasBarracks && !hasUpgrade && canAfford(config.aiFac, BLDG_DEFS.upgrade.cost)) {
      spend(config.aiFac, BLDG_DEFS.upgrade.cost);
      spawnBuilding('upgrade', config.aiFac, aiHQ.x - 16, aiHQ.z - 10, true);
    }
    if (hasBarracks && !hasMagic && canAfford(config.aiFac, BLDG_DEFS.magic.cost)) {
      spend(config.aiFac, BLDG_DEFS.magic.cost);
      spawnBuilding('magic', config.aiFac, aiHQ.x - 24, aiHQ.z, true);
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

  for (const b of aiBldgs) {
    if (b.isBuilding || b.prodQueue.length >= 2) continue;
    if (ai.pop >= ai.popCap) continue;

    let ut = null;

    if (b.subtype === 'hq') {
      if (workerCount < 4) ut = 'worker';
    } else if (b.subtype === 'barracks') {
      const roll = Math.random();
      ut = roll < 0.45 ? 'infantry' : roll < 0.75 ? 'ranged' : 'siege';
    } else if (b.subtype === 'upgrade') {
      ut = Math.random() < 0.5 ? 'heavy' : null;
    } else if (b.subtype === 'magic') {
      ut = Math.random() < 0.35 ? 'caster' : null;
    }

    if (ut && canAfford(config.aiFac, UNIT_DEFS[ut].cost)) {
      spend(config.aiFac, UNIT_DEFS[ut].cost);
      b.prodQueue.push(ut);
    }
  }
}
