// ═══════════════════════════════════════════════════════════
// maps/frozen-siege.js — "Frozen Siege"
// Snow-themed WC2 homage: two bases separated by a frozen river.
// Fight across the bridge or push through the pine-trash forests.
// ═══════════════════════════════════════════════════════════

import { generateFrozenSiege } from '../architect/mapgen.js';
import { FAC } from '../js/constants.js';

export const MAP_FROZEN_SIEGE = {
  id:      'frozen-siege',
  name:    'Frozen Siege',
  width:   120,
  height:  120,
  seed:    6060,
  desc:    '"The river froze. The war didn\'t."',
  stats:   '1v1 · WINTER · BRIDGE',

  playerCount: 2,

  _cache: null,
  getTiles() {
    if (!this._cache) this._cache = generateFrozenSiege(this.width, this.height, this.seed);
    return this._cache;
  },

  starts: [
    { faction: FAC.SCAV, wx: 120, wz: 28  },
    { faction: FAC.GILD, wx: 120, wz: 212 },
  ],

  resourcePreset: {
    perBase:   { dump: 2, cafe: 1 },
    contested: { dump: 3, cafe: 2 },
  },

  available: true,
};
