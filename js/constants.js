// ═══════════════════════════════════════════════════════════
// constants.js — all shared game definitions
// Mirrors Warcraft's faction/unit/building data tables
// ═══════════════════════════════════════════════════════════

export const FAC = { SCAV: 'scav', GILD: 'gild', NEUTRAL: 'neutral' };

export const MAP_W = 120, MAP_H = 120, TILE = 2;
export const WORLD_W = MAP_W * TILE, WORLD_H = MAP_H * TILE;

// Three.js hex colors
export const COL = {
  scav:       0xea580c,
  scavDk:     0x78350f,
  scavLt:     0xfb923c,
  gild:       0x60a5fa,
  gildDk:     0x1e3a8a,
  gildLt:     0x93c5fd,
  ground:     0x141008,
  groundLt:   0x1a1610,
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
export const UNIT_DEFS = {
  worker: {
    hp: 45,  atk: 7,   range: 1.6, speed: 3.8, atkCd: 1.2,
    cost: [100, 0], pop: 1, buildTime: 3,
    label: ['The Scavenger', 'The Assistant'],
  },
  infantry: {
    hp: 90,  atk: 14,  range: 1.8, speed: 3.2, atkCd: 1.0,
    cost: [200, 0], pop: 1, buildTime: 5,
    label: ['The Hooded', 'The Enforcer'],
  },
  ranged: {
    hp: 65,  atk: 13,  range: 9,   speed: 3.0, atkCd: 1.2,
    cost: [160, 40], pop: 1, buildTime: 5,
    label: ['The Slinger', 'Tactical Guard'],
  },
  heavy: {
    hp: 150, atk: 18,  range: 1.8, speed: 2.2, atkCd: 1.0,
    cost: [300, 80], pop: 2, buildTime: 8,
    label: ['The Brute', 'The Bodyguard'],
  },
  siege: {
    hp: 75,  atk: 120, range: 2.5, speed: 2.5, atkCd: 0,
    cost: [200, 50], pop: 1, buildTime: 6,
    label: ['The Fire-Eater', 'Cancellation Drone'],
    suicide: true,
  },
  caster: {
    hp: 60,  atk: 10,  range: 8,   speed: 2.6, atkCd: 1.5,
    cost: [350, 100], pop: 1, buildTime: 10,
    label: ['The Hacker', 'Media Consultant'],
  },
};

// ── BUILDING DEFINITIONS ──────────────────────────────────────
// Scaled to Warcraft II building economy ratios.
// Housing (Farm equiv) is cheap and you build many.
// Barracks + Tech buildings cost real investment.
// label[0] = Scavenger name, label[1] = Gilded name
export const BLDG_DEFS = {
  hq: {
    hp: 1600, size: 4, cost: [0, 0], buildTime: 0, foodAdd: 4,
    label: ['The Squat', 'The Gated Manor'],
    produces: ['worker'],
  },
  housing: {
    hp: 500, size: 2, cost: [180, 0], buildTime: 4, foodAdd: 4,
    label: ['The Tent City', 'Tiny Home Cluster'],
    produces: [],
  },
  barracks: {
    hp: 1000, size: 3, cost: [400, 100], buildTime: 7, foodAdd: 0,
    label: ['The Mess Hall', 'Security HQ'],
    produces: ['infantry', 'ranged', 'siege'],
  },
  upgrade: {
    hp: 800, size: 3, cost: [500, 150], buildTime: 8, foodAdd: 0,
    label: ['The Chop Shop', 'Design Studio'],
    produces: ['heavy'],
  },
  tower: {
    // WC2 Guard Tower: 130 HP, range 6 tiles, ~10 dmg/1.0s
    // At our scale (TILE=2): range ~11–12 world units.
    // 6 infantry (~50 DPS) should kill a tower in ~5s, taking ~1 casualty.
    hp: 280, size: 2, cost: [300, 80], buildTime: 6, foodAdd: 0,
    label: ['Junk Turret', 'Microwave Emitter'],
    produces: [],
    towerRange: 11, towerDmg: 9, towerCd: 1.0,
  },
  magic: {
    hp: 700, size: 3, cost: [700, 200], buildTime: 10, foodAdd: 0,
    label: ['The Computer Lab', 'The PR Firm'],
    produces: ['caster'],
  },
};

// ── PORTRAITS — icon per faction per type ────────────────────
export const PORTRAITS = {
  worker:    { scav: '🧱', gild: '📋', col: '#78350f' },
  infantry:  { scav: '⚔️',  gild: '🛡️', col: '#7c2d12' },
  ranged:    { scav: '🏹', gild: '🎯', col: '#713f12' },
  heavy:     { scav: '🔨', gild: '💼', col: '#431407' },
  siege:     { scav: '🔥', gild: '📡', col: '#450a0a' },
  caster:    { scav: '☠️', gild: '📺', col: '#2e1065' },
  hq:        { scav: '🏚️', gild: '🏛️', col: '#1c1208' },
  housing:   { scav: '⛺', gild: '🏘️', col: '#1a1a0a' },
  barracks:  { scav: '⚒️', gild: '🚔', col: '#1c0a0a' },
  upgrade:   { scav: '🔧', gild: '🔬', col: '#1a0a1a' },
  tower:     { scav: '🗼', gild: '📶', col: '#0a0a1a' },
  magic:     { scav: '💻', gild: '📡', col: '#100820' },
  dump:      { scav: '🗑️', gild: '🗑️', col: '#1a1a1a' },
  deptstore: { scav: '🏪', gild: '☕',  col: '#0a1428' },
  cafe:      { scav: '☕',  gild: '☕',  col: '#0a1428' },
};

// ── COMMAND CARD — 9-slot action grid (Warcraft GameButton) ──
// Each entry: { icon, label, key, action } or null for empty slot

// Scavengers: raw, scrappy building names
export const CMD_WORKER = [
  { icon: '⛺', label: 'Tent City',  key: 'T', action: 'build:housing' },
  { icon: '⚒️',  label: 'Mess Hall',  key: 'M', action: 'build:barracks' },
  { icon: '🔧', label: 'Chop Shop',  key: 'C', action: 'build:upgrade' },
  { icon: '💻', label: 'Comp Lab',   key: 'L', action: 'build:magic' },
  { icon: '🗼', label: 'Turret',     key: 'J', action: 'build:tower' },
  null, null, null,
  { icon: '⛔', label: 'Stop',       key: 'S', action: 'stop', cls: 'cmd-cancel' },
];

// Gilded: polished, corporate building names
export const CMD_WORKER_GILD = [
  { icon: '🏘️', label: 'Studio Apts',    key: 'T', action: 'build:housing' },
  { icon: '🚔', label: 'Security HQ',    key: 'M', action: 'build:barracks' },
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

// Unit type → command card (Scavenger defaults; Gilded overridden in ui.js by faction)
export const CMD_BY_UNIT = {
  worker:   CMD_WORKER,
  infantry: CMD_COMBAT,
  ranged:   CMD_COMBAT,
  heavy:    CMD_COMBAT,
  siege:    CMD_COMBAT,
  caster:   CMD_COMBAT,
};

export const UNIT_DESCS = {
  worker:    'Gathers Scrap from Dumps. Right-click a Dump to harvest. Select then click Build to construct.',
  // Gilded worker overridden at display time — see ui.js _descForEnt()
  infantry:  'Frontline brawler. Melee range, high damage.',
  ranged:    'Throws glass shards from medium range.',
  heavy:     'Slow armored bruiser. Counters massed infantry.',
  siege:     'Suicide bomber. Detonates in AoE near enemies.',
  caster:    'Bio-hacker firing poison drones at range.',
  hq:        'Your base of operations. Destroy the enemy HQ to win.',
  housing:   'Increases population cap by +4.',
  barracks:  'Trains combat units: Infantry, Ranged, Siege.',
  upgrade:   'Trains heavy units: The Brute.',
  tower:     'Auto-fires at approaching enemies. Passive defense.',
  magic:     'Trains Hackers and unlocks advanced abilities.',
  dump:      'Abandoned waste site. Workers gather Scrap here. Each trip yields 20 Scrap.',
  deptstore: 'Luxury Cafe. Assistants gather Salvage here. Push into enemy territory to secure it.',
  cafe:      'Gilded Cafe. Assistants gather Salvage here. Push into enemy territory to secure it.',
};

// Faction-specific overrides for unit descriptions
export const UNIT_DESCS_GILD = {
  worker:    'Gathers Salvage from Cafes. Right-click a Cafe to collect. Select then click Build to construct.',
  infantry:  'Armored Enforcer. Corporate security, melee trained.',
  ranged:    'Tactical Guard. Long-range precision shooter.',
  heavy:     'Private Bodyguard. Heavily armored close-protection unit.',
  siege:     'Cancellation Drone. Remote-detonated suppression weapon.',
  caster:    'Media Consultant. Broadcast propaganda at range.',
};
