// ═══════════════════════════════════════════════════════════
// config.js — lobby-set game configuration
// Populated before initMap() runs; everything reads from here.
// ═══════════════════════════════════════════════════════════

import { FAC } from './constants.js';

export const config = {
  playerFac: FAC.SCAV,
  aiFac:     FAC.GILD,
  mapName:   'The Great Divide',
  /** Current map definition (set by main from lobby selection). */
  mapDef:    null,
};
