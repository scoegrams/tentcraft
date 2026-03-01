// ═══════════════════════════════════════════════════════════
// state.js — shared mutable game state
// Equivalent to Warcraft's GameController / ServiceLocator
// ═══════════════════════════════════════════════════════════

import { FAC } from './constants.js';

export const G = {
  entities:    [],
  particles:   [],
  time:        0,
  dt:          0,
  selection:   [],

  buildMode:   null,   // building subtype string while placing
  buildGhost:  null,   // THREE.Mesh ghost preview

  mouseWorld:  { x: 0, y: 0, z: 0 },
  isDragging:  false,
  dragStart:   { x: 0, y: 0 },
  dragCurrent: { x: 0, y: 0 },

  gameOver:    false,

  // Player (Scavengers) — start with enough for a tent + barracks,
  // matching Warcraft II's 2000g starting gold feel at our scale.
  player: { scrap: 500, salvage: 100, pop: 0, popCap: 0 },

  // AI (Gilded) — slightly larger war chest to compensate for no workers
  ai: {
    scrap: 600, salvage: 200,
    pop: 0, popCap: 0,
    buildTimer: 0,
    attackTimer: 0,
    waveSize: 1,
  },
};

export function getRes(faction) {
  return faction === FAC.SCAV ? G.player : G.ai;
}

export function canAfford(faction, costs) {
  const r = getRes(faction);
  return r.scrap >= (costs[0] || 0) && r.salvage >= (costs[1] || 0);
}

export function spend(faction, costs) {
  const r = getRes(faction);
  r.scrap   -= (costs[0] || 0);
  r.salvage -= (costs[1] || 0);
}
