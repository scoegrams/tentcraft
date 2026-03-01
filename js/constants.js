// ═══════════════════════════════════════════════════════════
// constants.js — all shared game definitions
// Mirrors Warcraft's faction/unit/building data tables
// ═══════════════════════════════════════════════════════════

export const FAC = { SCAV: 'scav', GILD: 'gild', NEUTRAL: 'neutral' };

export const MAP_W = 120, MAP_H = 120, TILE = 2;
export const WORLD_W = MAP_W * TILE, WORLD_H = MAP_H * TILE;

// Three.js hex colors
export const COL = {
  scav:       0xe03010,
  scavDk:     0x801800,
  scavLt:     0xf06030,
  gild:       0x3399bb,
  gildDk:     0x184060,
  gildLt:     0x60bbdd,
  ground:     0x0a0a0a,
  groundLt:   0x141414,
  dump:       0x52525b,
  deptStore:  0x1d4ed8,
  select:     0x22c55e,
  perimeter:  0x7c3aed,
  neutral:    0x6b7280,
};

// ── UNIT DEFINITIONS (1-for-1 with Warcraft unit types) ──────
// Scaled to match Warcraft II's feel: ~5-8 workers needed for full army,
// first unit train ~5s, peak army takes 3-4 mins to assemble.
// label[0] = Scavenger name, label[1] = Gilded name
// cost = default [scrap, salvage]; costByFaction can override per faction if needed
export const UNIT_DEFS = {
  worker: {
    hp: 45,  atk: 7,   range: 1.6, speed: 3.8, atkCd: 1.2,
    cost: [100, 0], pop: 1, buildTime: 3,
    label: ['The Scavenger', 'The Assistant'],
  },
  infantry: {
    hp: 90,  atk: 14,  range: 1.8, speed: 3.2, atkCd: 1.0,
    cost: [200, 0], pop: 1, buildTime: 5,
    label: ['The Piper', 'The Enforcer'],
  },
  ranged: {
    hp: 80,  atk: 13,  range: 9,   speed: 3.4, atkCd: 1.2,
    cost: [160, 40], pop: 1, buildTime: 5,
    kite: true,   // backs away when melee closes
    label: ['The Slinger', 'Tactical Guard'],
  },
  heavy: {
    hp: 150, atk: 18,  range: 1.8, speed: 2.2, atkCd: 1.0,
    cost: [300, 80], pop: 2, buildTime: 8,
    label: ['The Toyota', 'The Bodyguard'],
  },
  siege: {
    hp: 75,  atk: 120, range: 2.5, speed: 2.5, atkCd: 0,
    cost: [200, 50], pop: 1, buildTime: 6,
    label: ['DraKo', 'Cancellation Drone'],
    suicide: true,
  },
  caster: {
    hp: 65,  atk: 14,  range: 11,  speed: 2.8, atkCd: 1.3,
    cost: [260, 70], pop: 1, buildTime: 9,
    kite: true,   // backs away when melee closes
    label: ['The Hacker', 'Media Consultant'],
  },
  transport: {
    hp: 220, atk: 0, range: 0, speed: 5.8, atkCd: 0,
    cost: [350, 120], pop: 2, buildTime: 12,
    capacity: 8,      // max boarding passengers
    canTraverse: true, // ignores passability — drives over water/trash
    label: ['The Sprinter', 'Gilded Transit'],
  },
};

/** Unit cost for a faction. */
export function getUnitCost(unitType, faction) {
  const def = UNIT_DEFS[unitType];
  if (!def) return [0, 0];
  const c = def.costByFaction?.[faction];
  return c ? [...c] : (def.cost ? [...def.cost] : [0, 0]);
}

// ── BUILDING DEFINITIONS ──────────────────────────────────────
// Scaled to Warcraft II building economy ratios.
// Housing (Farm equiv) is cheap and you build many.
// Barracks + Tech buildings cost real investment.
// label[0] = Scavenger name, label[1] = Gilded name
// ── Building prerequisite chains ─────────────────────────
// requires: [subtype, …] — player must own at least one completed (non-building)
// instance of each listed subtype before this building's button is enabled.
// This is exactly how WC2 grayed/locked build options in the UI.
//
//   Tier 0 (always available):  hq, housing, barracks, extractor
//   Tier 1 (needs barracks):    upgrade, tower
//   Tier 2 (needs upgrade):     magic

export const BLDG_DEFS = {
  hq: {
    hp: 1600, size: 4, cost: [0, 0], buildTime: 0, foodAdd: 4,
    label: ['The Squat', 'The Gated Manor'],
    produces: ['worker'],
    requires: [],
  },
  housing: {
    hp: 500, size: 2, cost: [180, 0], buildTime: 4, foodAdd: 4,
    label: ['The Tent City', 'Tiny Home Cluster'],
    produces: [],
    requires: [],
  },
  barracks: {
    hp: 1000, size: 3, cost: [400, 100], buildTime: 7, foodAdd: 0,
    label: ['The Mess Hall', 'Security HQ'],
    produces: ['infantry', 'ranged', 'siege'],
    requires: [],
  },
  upgrade: {
    hp: 800, size: 3, cost: [500, 150], buildTime: 8, foodAdd: 0,
    label: ['The Chop Shop', 'Design Studio'],
    produces: ['heavy', 'transport'],
    requires: ['barracks'],   // needs a completed Mess Hall / Security HQ
  },
  tower: {
    hp: 280, size: 2, cost: [300, 80], buildTime: 6, foodAdd: 0,
    label: ['Junk Turret', 'Microwave Emitter'],
    produces: [],
    towerRange: 11, towerDmg: 9, towerCd: 1.0,
    requires: ['barracks'],   // can't build towers without a barracks
  },
  magic: {
    hp: 700, size: 3, cost: [700, 200], buildTime: 10, foodAdd: 0,
    label: ['The Computer Lab', 'The PR Firm'],
    produces: ['caster'],
    requires: ['upgrade'],    // needs Chop Shop / Design Studio first
  },
  extractor: {
    hp: 600, size: 2, cost: [250, 0], buildTime: 5, foodAdd: 0,
    label: ['Salvage Extractor', 'Salvage Extractor'],
    produces: [],
    isExtractor: true,
    requires: [],
  },
};

// ── PORTRAITS — icon per faction per type ────────────────────
export const PORTRAITS = {
  worker:    { scav: '🧱', gild: '📋', col: '#78350f' },
  infantry:  { scav: '🪛',  gild: '🛡️', col: '#7c2d12' },
  ranged:    { scav: '🔫', gild: '🎯', col: '#713f12' },
  heavy:     { scav: '🛻', gild: '💼', col: '#431407' },
  siege:     { scav: '💥', gild: '📡', col: '#450a0a' },
  caster:    { scav: '☠️', gild: '📺', col: '#2e1065' },
  transport: { scav: '🚐', gild: '🚌', col: '#1a2a0a' },
  hq:        { scav: '🏚️', gild: '🏛️', col: '#1c1208' },
  housing:   { scav: '⛺', gild: '🏘️', col: '#1a1a0a' },
  barracks:  { scav: '⚒️', gild: '🚔', col: '#1c0a0a' },
  upgrade:   { scav: '🔧', gild: '🔬', col: '#1a0a1a' },
  tower:     { scav: '🗼', gild: '📶', col: '#0a0a1a' },
  magic:     { scav: '💻', gild: '📡', col: '#100820' },
  extractor: { scav: '⛏️',  gild: '⛏️',  col: '#3a2800' },
  dump:      { scav: '🗑️', gild: '🗑️', col: '#1a1a1a' },
  deptstore: { scav: '🏪', gild: '☕',  col: '#0a1428' },
  cafe:      { scav: '☕',  gild: '☕',  col: '#0a1428' },
};

// ── COMMAND CARD — 9-slot action grid (Warcraft GameButton) ──
// Each entry: { icon, label, key, action } or null for empty slot

// Scavengers: raw, scrappy building names
export const CMD_WORKER = [
  { icon: '⛺', label: 'Tent City',  key: 'T', action: 'build:housing' },
  { icon: '⚒️',  label: 'Mess Hall',  key: 'B', action: 'build:barracks' },
  { icon: '🔧', label: 'Chop Shop',  key: 'C', action: 'build:upgrade' },
  { icon: '💻', label: 'Comp Lab',   key: 'L', action: 'build:magic' },
  { icon: '🗼', label: 'Turret',     key: 'J', action: 'build:tower' },
  { icon: '⛏️',  label: 'Extractor', key: 'E', action: 'build:extractor' },
  null, null,
  { icon: '⛔', label: 'Stop',       key: 'S', action: 'stop', cls: 'cmd-cancel' },
];

// Gilded: polished, corporate building names
export const CMD_WORKER_GILD = [
  { icon: '🏘️', label: 'Studio Apts',    key: 'T', action: 'build:housing' },
  { icon: '🚔', label: 'Security HQ',    key: 'B', action: 'build:barracks' },
  { icon: '🔬', label: 'Design Studio',  key: 'C', action: 'build:upgrade' },
  { icon: '📡', label: 'PR Firm',        key: 'L', action: 'build:magic' },
  { icon: '📶', label: 'Emitter Tower',  key: 'J', action: 'build:tower' },
  null, null, null,
  { icon: '⛔', label: 'Stop',           key: 'S', action: 'stop', cls: 'cmd-cancel' },
];

export const CMD_COMBAT = [
  { icon: '⚔️',  label: 'Attack',    key: 'A', action: 'attack-move' },
  { icon: '🚶', label: 'Move',       key: 'M', action: 'move' },
  null, null, null, null, null, null,
  { icon: '⛔', label: 'Stop',       key: 'S', action: 'stop', cls: 'cmd-cancel' },
];

export const CMD_TRANSPORT = [
  { icon: '📦', label: 'Unload All', key: 'U', action: 'unload' },
  { icon: '🚶', label: 'Move',       key: 'M', action: 'move' },
  null, null, null, null, null, null,
  { icon: '⛔', label: 'Stop',       key: 'S', action: 'stop', cls: 'cmd-cancel' },
];

// Unit type → command card (Scavenger defaults; Gilded overridden in ui.js by faction)
export const CMD_BY_UNIT = {
  worker:    CMD_WORKER,
  infantry:  CMD_COMBAT,
  ranged:    CMD_COMBAT,
  heavy:     CMD_COMBAT,
  siege:     CMD_COMBAT,
  caster:    CMD_COMBAT,
  transport: CMD_TRANSPORT,
};

export const UNIT_DESCS = {
  worker:    'Gathers Scrap from Dumps. Right-click TRASH to dig through it — you get Scrap 2× more than Salvage and open a path to the enemy. Build an Extractor to shorten salvage runs.',
  // Gilded worker overridden at display time — see ui.js _descForEnt()
  infantry:  'The Piper. Melee scrapper with a steel pipe — hits hard up close.',
  ranged:    'The Slinger. Light gun, mid-range. Quick and cheap.',
  heavy:     'The Toyota. Pickup truck with a gun welded to the bed — slow but punishes anything in front of it.',
  siege:     'DraKo. Runs into the enemy and detonates a blast cannon — massive AoE.',
  caster:    'Bio-hacker firing poison drones at range.',
  transport: 'The Sprinter. Fast van that carries up to 8 warriors across any terrain — water, trash, you name it. Right-click friendly units onto it to board. Select it and press U (or click Unload) to drop them.',
  hq:        'Your base of operations. Destroy the enemy HQ to win.',
  housing:   'Increases population cap by +4.',
  barracks:  'Trains combat units: Infantry, Ranged, Siege.',
  upgrade:   'Trains heavy units: The Toyota & The Sprinter transport.',
  tower:     'Auto-fires at approaching enemies. Passive defense.',
  magic:     'Trains Hackers and unlocks advanced abilities.',
  dump:      'Abandoned waste site. Workers gather Scrap here. Each trip yields 20 Scrap.',
  deptstore: 'Department Store. Gilded Assistants gather Salvage here.',
  cafe:      'Gilded Cafe. Assistants gather Salvage here. Push into enemy territory to secure it.',
  extractor: 'Forward Salvage drop-off. Build it near the TRASH you’re digging through — workers deliver salvage here instead of walking to HQ. Pushes your dig toward the enemy.',
};

// Faction-specific overrides for unit descriptions
export const UNIT_DESCS_GILD = {
  worker:    'Gathers Salvage from Cafes and Department Stores. Right-click a Cafe to collect. Select then click Build to construct.',
  infantry:  'Armored Enforcer. Corporate security, melee trained.',
  ranged:    'Tactical Guard. Long-range precision shooter.',
  heavy:     'Private Bodyguard. Heavily armored close-protection unit.',
  siege:     'Cancellation Drone. Remote-detonated suppression weapon.',
  caster:    'Media Consultant. Broadcast propaganda at range.',
  transport: 'Gilded Transit. Armored shuttle carrying up to 8 operatives across any terrain. Board by right-clicking it with units selected. Press U to unload.',
};
