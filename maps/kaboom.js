// ═══════════════════════════════════════════════════════════
// maps/kaboom.js — "Kaboom BNE" (4-player)
// Symmetrical 4-way: central sludge cross, one base per quadrant.
// Choose trash/cafe counts per base and contested in the middle.
// ═══════════════════════════════════════════════════════════

import { generateKaboom } from '../architect/mapgen.js';
import { FAC } from '../js/constants.js';

const MID = 120; // world 240/2

export const MAP_KABOOM = {
  id:        'kaboom',
  name:      'Kaboom BNE',
  width:     120,
  height:    120,
  seed:      9999,
  desc:      '"Four corners. One cross. No mercy."',
  stats:     '2–4 PLAYERS · 64×64',

  playerCount: 4,

  _cache: null,
  getTiles() {
    if (!this._cache) this._cache = generateKaboom(this.width, this.height, this.seed);
    return this._cache;
  },

  // One start per quadrant (world units)
  starts: [
    { faction: FAC.SCAV, wx: 30,  wz: 30  },  // top-left
    { faction: FAC.GILD, wx: 210, wz: 30  },  // top-right
    { faction: FAC.SCAV, wx: 30,  wz: 210 },  // bottom-left
    { faction: FAC.GILD, wx: 210, wz: 210 },  // bottom-right
  ],

  resourcePreset: {
    perBase:   { dump: 2, cafe: 1 },
    contested: { dump: 4, cafe: 4 },
    amounts:   { dump: 1800, cafe: 1500 },
  },

  available: true,
};
