// ═══════════════════════════════════════════════════════════
// maps/great-divide.js — "The Great Divide"
// 1v1 standard: SCAV left, GILD right. Choose trash/cafe counts via preset.
// ═══════════════════════════════════════════════════════════

import { generateGreatDivide } from '../architect/mapgen.js';
import { FAC } from '../js/constants.js';

export const MAP_GREAT_DIVIDE = {
  id:      'great-divide',
  name:    'The Great Divide',
  width:   120,
  height:  120,
  seed:    1337,
  desc:    '"Trash wastes divide two factions. No neutral ground. No mercy."',
  stats:   '1v1 · STANDARD · 64×64',

  playerCount: 2,

  _cache: null,
  getTiles() {
    if (!this._cache) this._cache = generateGreatDivide(this.width, this.height, this.seed);
    return this._cache;
  },

  starts: [
    { faction: FAC.SCAV, wx: 26,  wz: 120 },
    { faction: FAC.GILD, wx: 210, wz: 120 },
  ],

  // Amount of trash (dumps) and cafes/stores per base and in the contested middle.
  resourcePreset: {
    perBase:    { dump: 2, cafe: 1 },   // each base gets 2 dumps, 1 cafe
    contested:  { dump: 4, cafe: 3 },   // center: 4 dumps, 3 cafes
    amounts:   { dump: 2000, cafe: 1500 },
  },

  available: true,
};
