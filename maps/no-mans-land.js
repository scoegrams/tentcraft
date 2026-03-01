// ═══════════════════════════════════════════════════════════
// maps/no-mans-land.js — "No Man's Land"
// Standard 120×120 arena. Both bases on opposite sides.
// ALL dumps are dead centre — workers clash from minute one.
// ═══════════════════════════════════════════════════════════

import { generateNoMansLand } from '../architect/mapgen.js';
import { FAC } from '../js/constants.js';

// Standard world size: 120 tiles × TILE(2) = 240 world units.
// Centre = (120, 120). Both HQs are equidistant from the dumps.
const CX = 120, CZ = 120;

export const MAP_NO_MANS_LAND = {
  id:          'no-mans-land',
  name:        'No Man\'s Land',
  width:       120,
  height:      120,
  seed:        4242,
  desc:        '"One open field. Eight dumps. Nowhere to hide."',
  stats:       '1v1 · ALL-IN · 120×120',
  available:   true,
  playerCount: 2,

  // Workers travel ~half the map to reach dumps — triple yield compensates
  // for the long round-trip so economy pacing stays competitive.
  workerYield: 3,

  _cache: null,
  getTiles() {
    if (!this._cache) this._cache = generateNoMansLand(this.width, this.height, this.seed);
    return this._cache;
  },
  // Force cache reset when map file reloads
  _v: 2,

  // Standard start positions — same as Great Divide so buildings have room
  starts: [
    { faction: FAC.SCAV, wx: 26,  wz: CZ },
    { faction: FAC.GILD, wx: 210, wz: CZ },
  ],

  // NO per-base resources — everything is in the dead centre.
  // 8 dumps in a tight 3×3 grid (centre cell empty for unit traffic).
  // Small amounts (1800) so they deplete fast and the fight never stops.
  resources: [
    { type: 'dump', wx: CX - 16, wz: CZ - 16, amount: 1800 },
    { type: 'dump', wx: CX,      wz: CZ - 16, amount: 1800 },
    { type: 'dump', wx: CX + 16, wz: CZ - 16, amount: 1800 },
    { type: 'dump', wx: CX - 16, wz: CZ,      amount: 1800 },
    { type: 'dump', wx: CX + 16, wz: CZ,      amount: 1800 },
    { type: 'dump', wx: CX - 16, wz: CZ + 16, amount: 1800 },
    { type: 'dump', wx: CX,      wz: CZ + 16, amount: 1800 },
    { type: 'dump', wx: CX + 16, wz: CZ + 16, amount: 1800 },
  ],
};
