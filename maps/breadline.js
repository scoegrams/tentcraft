// ═══════════════════════════════════════════════════════════
// maps/breadline.js — "The Breadline"  [LOCKED]
// ═══════════════════════════════════════════════════════════

import { generateBreadline } from '../architect/mapgen.js';
import { FAC } from '../js/constants.js';

export const MAP_BREADLINE = {
  id:        'breadline',
  name:      'The Breadline',
  width:     120,
  height:    120,
  seed:      4242,
  desc:      '"One queue. Two factions. No sharing."',
  stats:     '1v1 · ECONOMIC · 64×96',
  available: false,
  playerCount: 2,

  _cache: null,
  getTiles() {
    if (!this._cache) this._cache = generateBreadline(this.width, this.height, this.seed);
    return this._cache;
  },

  starts: [
    { faction: FAC.SCAV, wx: 20,  wz: 120 },
    { faction: FAC.GILD, wx: 220, wz: 120 },
  ],
  resourcePreset: { perBase: { dump: 2, cafe: 1 }, contested: { dump: 2, cafe: 2 } },
};
