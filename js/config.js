// ═══════════════════════════════════════════════════════════
// config.js — lobby-set game configuration
// Populated before initMap() runs; everything reads from here
// so faction choice from the intro screen propagates everywhere.
// ═══════════════════════════════════════════════════════════

import { FAC } from './constants.js';

export const config = {
  playerFac: FAC.SCAV,   // overwritten by lobby choice
  aiFac:     FAC.GILD,
  mapName:   'The Great Divide',
};
