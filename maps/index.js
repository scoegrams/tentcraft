// ═══════════════════════════════════════════════════════════
// maps/index.js — Map registry
// All playable and future maps exported here.
// ═══════════════════════════════════════════════════════════

export { MAP_GREAT_DIVIDE }     from './great-divide.js';
export { MAP_LANDFILL_CIRCUIT } from './landfill-circuit.js';
export { MAP_BREADLINE }        from './breadline.js';
export { MAP_KABOOM }           from './kaboom.js';
export { MAP_OVERFLOW }         from './overflow.js';
export { MAP_FROZEN_SIEGE }     from './frozen-siege.js';

import { MAP_GREAT_DIVIDE }     from './great-divide.js';
import { MAP_LANDFILL_CIRCUIT } from './landfill-circuit.js';
import { MAP_BREADLINE }        from './breadline.js';
import { MAP_KABOOM }           from './kaboom.js';
import { MAP_OVERFLOW }         from './overflow.js';
import { MAP_FROZEN_SIEGE }     from './frozen-siege.js';

// Ordered list for lobby map selector
export const ALL_MAPS = [
  MAP_GREAT_DIVIDE,
  MAP_LANDFILL_CIRCUIT,
  MAP_BREADLINE,
  MAP_KABOOM,
  MAP_OVERFLOW,
  MAP_FROZEN_SIEGE,
];
