// ═══════════════════════════════════════════════════════════
// maps/index.js — Map registry
// All playable and future maps exported here.
// ═══════════════════════════════════════════════════════════

export { MAP_GREAT_DIVIDE }     from './great-divide.js';
export { MAP_LANDFILL_CIRCUIT } from './landfill-circuit.js';
export { MAP_BREADLINE }        from './breadline.js';

import { MAP_GREAT_DIVIDE }     from './great-divide.js';
import { MAP_LANDFILL_CIRCUIT } from './landfill-circuit.js';
import { MAP_BREADLINE }        from './breadline.js';

// Ordered list used by the lobby map selector
export const ALL_MAPS = [
  MAP_GREAT_DIVIDE,
  MAP_LANDFILL_CIRCUIT,
  MAP_BREADLINE,
];
