// ═══════════════════════════════════════════════════════════
// entities.js — base Entity class
// Mirrors Warcraft's SpawnableSprite / Unit / Building base types
// ═══════════════════════════════════════════════════════════

import { FAC, BLDG_DEFS, UNIT_DEFS, PORTRAITS } from './constants.js';

let _nextId = 0;

export class Entity {
  constructor(type, subtype, faction, x, z) {
    this.id       = _nextId++;
    this.type     = type;      // 'unit' | 'building' | 'resource'
    this.subtype  = subtype;   // 'worker','infantry',... / 'hq','barracks',... / 'dump','deptstore'
    this.faction  = faction;
    this.x        = x;
    this.z        = z;
    this.dead     = false;

    // Combat
    this.hp       = 100;
    this.maxHp    = 100;
    this.atk      = 0;
    this.atkRange = 1.5;
    this.atkCd    = 1;
    this.atkTimer = 0;
    this.speed    = 0;
    this.size     = 1;
    this.suicide  = false;

    // State machine
    this.state      = 'idle';
    this.targetX    = null;
    this.targetZ    = null;
    this.targetEnt  = null;
    this.selected   = false;

    // Harvesting — 20 per trip mirrors Warcraft II peasant carrying 100g
    // from a ~50,000g mine scaled to our smaller resource numbers.
    this.carriedRes  = 0;
    this.carryMax    = 20;
    this.gatherTarget = null;

    // Production queue (buildings)
    this.prodQueue = [];
    this.prodTimer = 0;
    this.prodMax   = 0;

    // Building properties
    this.foodAdd      = 0;
    this.towerRange   = 0;
    this.towerDmg     = 0;
    this.towerCd      = 0;
    this.towerTimer   = 0;
    this.isBuilding   = false;  // under construction
    this.buildProgress = 0;
    this.buildMax      = 0;

    // Mesh references (managed by renderer.js)
    this.mesh    = null;
    this.selRing = null;
  }

  // ── Convenience getters ──────────────────────────────────
  get alive()  { return !this.dead && this.hp > 0; }
  get isUnit() { return this.type === 'unit'; }
  get isBldg() { return this.type === 'building'; }
  get isRes()  { return this.type === 'resource'; }

  label() {
    if (this.isRes) return this.subtype === 'dump' ? 'The Dump' : 'Department Store';
    const defs = this.isBldg ? BLDG_DEFS[this.subtype] : UNIT_DEFS[this.subtype];
    if (!defs) return this.subtype;
    return defs.label[this.faction === FAC.SCAV ? 0 : 1];
  }

  portrait() {
    const p = PORTRAITS[this.subtype];
    if (!p) return { icon: '?', col: '#111' };
    return { icon: p[this.faction === FAC.SCAV ? 'scav' : 'gild'], col: p.col };
  }

  // ── Damage — visual effects triggered via renderer callback ─
  damage(amount, attacker) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    this._onDamage?.();
    // WC2 retaliation: idle/moving units auto-target their attacker
    if (attacker?.alive && this.isUnit && !this.suicide &&
        (this.state === 'idle' || this.state === 'move')) {
      this.targetEnt = attacker;
      this.state = 'attacking';
      this._path = null;
      this._pathDest = null;
    }
    if (this.hp <= 0) this.kill();
  }

  kill() {
    this.dead = true;
    // Mesh cleanup hook — called by renderer
    this._onKill?.();
  }
}
