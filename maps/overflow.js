// ═══════════════════════════════════════════════════════════
// maps/overflow.js — "The Overflow" (resource-rich 1v1 test map)
//
// Purpose: stress-test the salvage extraction + extractor system.
// Terrain is ~55% TRASH salvage heaps with SLUDGE city-street corridors
// you can walk through. Loads of scrap dumps and cafes for both factions.
// ═══════════════════════════════════════════════════════════

import { generateOverflow } from '../architect/mapgen.js';
import { FAC } from '../js/constants.js';

export const MAP_OVERFLOW = {
  id:          'overflow',
  name:        'The Overflow',
  width:       120,
  height:      120,
  seed:        2077,
  desc:        '"Salvage piled to the skyline. SCAV heaven. Build your Extractor and get to work."',
  stats:       '1v1 · RESOURCE RICH · 64×64',

  playerCount: 2,

  _cache: null,
  getTiles() {
    if (!this._cache) this._cache = generateOverflow(this.width, this.height, this.seed);
    return this._cache;
  },

  starts: [
    { faction: FAC.SCAV, wx: 28,  wz: 120 },
    { faction: FAC.GILD, wx: 212, wz: 120 },
  ],

  // Resource-rich preset — far more than a normal map.
  // SCAV extracts Salvage from TRASH terrain tiles; these nodes are for Scrap + Gilded Salvage.
  resourcePreset: {
    perBase:   { dump: 4, cafe: 2, deptstore: 1 },  // 4 scrap dumps + 2 cafes each
    contested: { dump: 8, cafe: 6, deptstore: 2 },  // contested center is very rich
    amounts:   { dump: 3000, cafe: 2000, deptstore: 2000 },
  },

  available: true,
};
