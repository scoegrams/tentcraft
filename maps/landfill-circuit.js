// ═══════════════════════════════════════════════════════════
// maps/landfill-circuit.js — "Landfill Circuit"  [LOCKED]
// A circular landfill bisected by a sludge moat.
// Control the center to win; let it fall and you starve.
// ═══════════════════════════════════════════════════════════

import { generateLandfillCircuit } from '../architect/mapgen.js';

export const MAP_LANDFILL_CIRCUIT = {
  id:        'landfill-circuit',
  name:      'Landfill Circuit',
  width:     120,
  height:    120,
  seed:      8888,
  desc:      '"Control the circuit or starve. Three dumps, one path."',
  stats:     '1v1 · CONTESTED · 96×96 SECTORS',
  available: false,

  _cache: null,
  getTiles() {
    if (!this._cache) this._cache = generateLandfillCircuit(this.width, this.height, this.seed);
    return this._cache;
  },

  starts: [
    { faction: 'scav', wx: 16,  wz: 120 },
    { faction: 'gild', wx: 224, wz: 120 },
  ],
  resources: [],
};
