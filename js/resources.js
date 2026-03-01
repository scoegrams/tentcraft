// ═══════════════════════════════════════════════════════════
// resources.js — resource node spawning (Dumps / Dept Stores)
// Warcraft equivalent: Gold Mine / Oil Patch
// ═══════════════════════════════════════════════════════════

import { FAC } from './constants.js';
import { G } from './state.js';
import { Entity } from './entities.js';
import { createResourceMesh } from './renderer.js';

export function spawnResource(subtype, x, z, amount = 800) {
  const ent    = new Entity('resource', subtype, FAC.NEUTRAL, x, z);
  ent.hp       = amount;
  ent.maxHp    = amount;

  createResourceMesh(ent);
  G.entities.push(ent);
  return ent;
}
