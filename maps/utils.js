// ═══════════════════════════════════════════════════════════
// maps/utils.js — Map helpers: resource placement from presets
// Lets map authors choose "how much trash and how many cafes"
// per base and in the contested zone without hand-placing every node.
// ═══════════════════════════════════════════════════════════

import { WORLD_W, WORLD_H } from '../js/constants.js';

// Mines give more but still burn out — TRASH is the main “dig through” economy
const DEFAULT_AMOUNT = { dump: 4000, cafe: 3500, deptstore: 3500 };

/**
 * Generate resource node list from a preset.
 * preset.perBase: { dump: 2, cafe: 1 } — nodes placed near each start
 * preset.contested: { dump: 4, cafe: 2 } — nodes placed in map center
 * Amounts default to DEFAULT_AMOUNT per type; optional preset.amounts overrides.
 */
export function resourcesFromPreset(starts, preset, worldW = WORLD_W, worldH = WORLD_H) {
  const out = [];
  const amounts = { ...DEFAULT_AMOUNT, ...preset.amounts };
  const cx = worldW / 2, cy = worldH / 2;

  // Per-base: ring around each start so they don't overlap
  const perBase = preset.perBase || {};
  const dumpPerBase = Math.max(0, perBase.dump ?? 0);
  const cafePerBase = Math.max(0, perBase.cafe ?? 0);
  const deptPerBase = Math.max(0, perBase.deptstore ?? 0);

  const baseOffsets = [
    [18, 0], [22, -8], [20, 10], [14, -14], [16, 14],
    [10, -20], [12, 20], [-6, 22], [-6, -22],
  ];

  let offsetIdx = 0;
  for (const start of starts) {
    const { wx, wz } = start;
    for (let i = 0; i < dumpPerBase; i++) {
      const [dx, dz] = baseOffsets[(offsetIdx++) % baseOffsets.length];
      out.push({ type: 'dump', wx: wx + dx, wz: wz + dz, amount: amounts.dump });
    }
    for (let i = 0; i < cafePerBase; i++) {
      const [dx, dz] = baseOffsets[(offsetIdx++) % baseOffsets.length];
      out.push({ type: 'cafe', wx: wx + dx, wz: wz + dz, amount: amounts.cafe });
    }
    for (let i = 0; i < deptPerBase; i++) {
      const [dx, dz] = baseOffsets[(offsetIdx++) % baseOffsets.length];
      out.push({ type: 'deptstore', wx: wx + dx, wz: wz + dz, amount: amounts.deptstore });
    }
  }

  // Contested: spread around map center
  const contested = preset.contested || {};
  const contestedDumps = Math.max(0, contested.dump ?? 0);
  const contestedCafes = Math.max(0, contested.cafe ?? 0);
  const contestedDept = Math.max(0, contested.deptstore ?? 0);

  const contestedSpots = [
    [0, 0], [-28, -24], [28, -24], [-28, 24], [28, 24],
    [-20, 0], [20, 0], [0, -20], [0, 20], [-16, -16], [16, -16], [-16, 16], [16, 16],
  ];

  for (let i = 0; i < contestedDumps; i++) {
    const [dx, dz] = contestedSpots[i % contestedSpots.length];
    out.push({ type: 'dump', wx: cx + dx, wz: cy + dz, amount: amounts.dump });
  }
  for (let i = 0; i < contestedCafes; i++) {
    const [dx, dz] = contestedSpots[(i + 2) % contestedSpots.length];
    out.push({ type: 'cafe', wx: cx + dx, wz: cy + dz, amount: amounts.cafe });
  }
  for (let i = 0; i < contestedDept; i++) {
    const [dx, dz] = contestedSpots[(i + 4) % contestedSpots.length];
    out.push({ type: 'deptstore', wx: cx + dx, wz: cy + dz, amount: amounts.deptstore });
  }

  return out;
}

/** Return the resources array for a map: either explicit or from preset. */
export function getMapResources(mapDef) {
  if (mapDef.resources && mapDef.resources.length > 0) return mapDef.resources;
  if (mapDef.resourcePreset && mapDef.starts)
    return resourcesFromPreset(mapDef.starts, mapDef.resourcePreset);
  return [];
}
