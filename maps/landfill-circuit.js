// ═══════════════════════════════════════════════════════════
// maps/landfill-circuit.js — "Landfill Circuit"  [LOCKED]
// ═══════════════════════════════════════════════════════════

import { generateLandfillCircuit } from '../architect/mapgen.js';
import { FAC } from '../js/constants.js';

export const MAP_LANDFILL_CIRCUIT = {
  id:        'landfill-circuit',
  name:      'Landfill Circuit',
  width:     120,
  height:    120,
  seed:      8888,
  desc:      '"Control the circuit or starve. Three dumps, one path."',
  stats:     '1v1 · CONTESTED · 96×96',
  available: false,
  playerCount: 2,

  _cache: null,
  getTiles() {
    if (!this._cache) this._cache = generateLandfillCircuit(this.width, this.height, this.seed);
    return this._cache;
  },

  starts: [
    { faction: FAC.SCAV, wx: 16,  wz: 120 },
    { faction: FAC.GILD, wx: 224, wz: 120 },
  ],
  resourcePreset: { perBase: { dump: 2, cafe: 1 }, contested: { dump: 3, cafe: 2 } },
};
