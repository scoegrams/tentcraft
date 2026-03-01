// ═══════════════════════════════════════════════════════════
// maps/breadline.js — "The Breadline"  [LOCKED]
// Narrow horizontal map. Resources cluster at the center queue.
// Race to control the breadline before the other side does.
// ═══════════════════════════════════════════════════════════

import { generateBreadline } from '../architect/mapgen.js';

export const MAP_BREADLINE = {
  id:        'breadline',
  name:      'The Breadline',
  width:     120,
  height:    120,
  seed:      4242,
  desc:      '"One queue. Two factions. No sharing."',
  stats:     '1v1 · ECONOMIC · 64×96 SECTORS',
  available: false,

  _cache: null,
  getTiles() {
    if (!this._cache) this._cache = generateBreadline(this.width, this.height, this.seed);
    return this._cache;
  },

  starts: [
    { faction: 'scav', wx: 20,  wz: 120 },
    { faction: 'gild', wx: 220, wz: 120 },
  ],
  resources: [],
};
