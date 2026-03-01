// ═══════════════════════════════════════════════════════════
// maps/great-divide.js — "The Great Divide"
// TentCraft's opening map: a 1v1 standard match across cracked concrete.
// SCAV holds the dumps on the left; GILD controls the cafes on the right.
// The central road is the only clean path — everything else is trash and sludge.
// ═══════════════════════════════════════════════════════════

import { T, generateGreatDivide } from '../architect/mapgen.js';
import { FAC } from '../js/constants.js';

export const MAP_GREAT_DIVIDE = {
  id:      'great-divide',
  name:    'The Great Divide',
  width:   120,   // tiles
  height:  120,
  seed:    1337,
  desc:    '"Trash wastes divide two factions. No neutral ground. No mercy."',
  stats:   '1v1 · STANDARD · 64×64 SECTORS',

  // Procedurally generated tile array (Uint8Array, T.* values)
  // Call getTiles() to get the cached array — lazy-generated on first access.
  _cache: null,
  getTiles() {
    if (!this._cache) this._cache = generateGreatDivide(this.width, this.height, this.seed);
    return this._cache;
  },

  // Starting positions in WORLD units (tile * TILE where TILE=2)
  starts: [
    { faction: FAC.SCAV, wx: 26,  wz: 120 },  // SCAV — left side
    { faction: FAC.GILD, wx: 210, wz: 120 },  // GILD — right side
  ],

  // Resource node placements (world coords, type, amount)
  // These are placed IN ADDITION to the base-adjacent resources in main.js.
  resources: [
    { type: 'dump',      wx: 66,  wz: 120, amount: 2000 },  // base SCAV dump (near HQ)
    { type: 'cafe',      wx: 192, wz: 120, amount: 2000 },  // base GILD cafe (near HQ)
    { type: 'dump',      wx: 198, wz: 144, amount: 1500 },  // AI dump (for scrap income)
    { type: 'dump',      wx: 114, wz: 92,  amount: 1500 },  // upper contest
    { type: 'dump',      wx: 114, wz: 148, amount: 1500 },  // lower contest
    { type: 'dump',      wx: 120, wz: 120, amount: 1800 },  // center
    { type: 'dump',      wx: 120, wz: 76,  amount: 1200 },  // upper center
    { type: 'dump',      wx: 120, wz: 164, amount: 1200 },  // lower center
    { type: 'dump',      wx: 30,  wz: 56,  amount: 1200 },  // far SCAV
    { type: 'dump',      wx: 30,  wz: 184, amount: 1200 },  // far SCAV low
    { type: 'cafe',      wx: 168, wz: 92,  amount: 1500 },  // upper GILD contest
    { type: 'cafe',      wx: 168, wz: 148, amount: 1500 },  // lower GILD contest
    { type: 'cafe',      wx: 144, wz: 100, amount: 1200 },  // mid GILD
    { type: 'cafe',      wx: 144, wz: 140, amount: 1200 },  // mid GILD
  ],

  available: true,
};
