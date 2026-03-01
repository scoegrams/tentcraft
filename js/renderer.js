// ═══════════════════════════════════════════════════════════
// renderer.js — Three.js scene, camera, mesh factories, particles
// Mirrors Warcraft's Map renderer + unit sprite system
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { COL, TILE, WORLD_W, WORLD_H, FAC, BLDG_DEFS } from './constants.js';
import { config } from './config.js';

// ── Scene, Camera, Renderer ───────────────────────────────
export const scene    = new THREE.Scene();
export const raycaster = new THREE.Raycaster();
export const mouse    = new THREE.Vector2();

export const canvas   = document.getElementById('c');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const FRUSTUM = 60;
export const camera = new THREE.OrthographicCamera(-FRUSTUM, FRUSTUM, FRUSTUM, -FRUSTUM, 0.1, 500);
camera.position.set(WORLD_W / 2, 100, WORLD_H / 2 + 60);
camera.lookAt(WORLD_W / 2, 0, WORLD_H / 2);

// Expose frustum size for resize
export const FRUSTUM_SIZE = FRUSTUM;

// Top bar + statusbar + hud heights must match CSS vars
export const TOP_H    = 40;
export const STATUS_H = 18;
export const HUD_H    = 170;

// ── Lighting ─────────────────────────────────────────────
// Sky hemisphere gives warm amber top, cool blue-grey underside.
// Strong directional key light from NW casts clear shadows on units.
scene.add(new THREE.HemisphereLight(0xa08860, 0x303828, 1.6));
scene.add(new THREE.AmbientLight(0x605848, 2.2));
const dirLight = new THREE.DirectionalLight(0xffe8a0, 2.8);
dirLight.position.set(80, 160, 60);
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0x5580bb, 0.8);
fillLight.position.set(-60, 80, -40);
scene.add(fillLight);
// Thin warm haze — visible only at map edges, doesn't darken gameplay area
scene.fog = new THREE.FogExp2(0x100e08, 0.0006);

// ── Ground ────────────────────────────────────────────────
// White color so the CanvasTexture renders at full brightness.
// Terrain.js will swap in the map texture.
const groundMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_W, WORLD_H, 1, 1),
  groundMat
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(WORLD_W / 2, 0, WORLD_H / 2);
scene.add(ground);

// (Ground detail and debug grid removed — terrain.js texture handles all ground visuals)

// Perimeter wall divider
const perimGeo = new THREE.BoxGeometry(0.4, 8, WORLD_H);
const perimMat = new THREE.MeshLambertMaterial({ color: COL.perimeter, transparent: true, opacity: 0.25 });
const perimWall = new THREE.Mesh(perimGeo, perimMat);
perimWall.position.set(WORLD_W * 0.65, 4, WORLD_H / 2);
scene.add(perimWall);

// Glowing perimeter line at ground level
const lineGeo = new THREE.BoxGeometry(0.15, 0.15, WORLD_H);
const lineMat = new THREE.MeshLambertMaterial({ color: COL.perimeter, emissive: COL.perimeter, emissiveIntensity: 0.6 });
const perimLine = new THREE.Mesh(lineGeo, lineMat);
perimLine.position.set(WORLD_W * 0.65, 0.1, WORLD_H / 2);
scene.add(perimLine);

// ── Material cache ────────────────────────────────────────
const _matCache = {};
export function getMat(color) {
  if (!_matCache[color]) _matCache[color] = new THREE.MeshLambertMaterial({ color });
  return _matCache[color];
}

// Emissive material — units use these so they glow their faction color
// even in dark areas. Key to Warcraft readability.
const _emMatCache = {};
function _getEmMat(color, emissive, emissiveIntensity = 0.55) {
  const key = `${color}_${emissive}_${emissiveIntensity}`;
  if (!_emMatCache[key])
    _emMatCache[key] = new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity });
  return _emMatCache[key];
}

function _unitMat(faction) {
  return faction === FAC.SCAV
    ? _getEmMat(0xff7833, 0x6a2000, 0.7)   // orange unit, hot-orange glow
    : _getEmMat(0xa8d8ff, 0x003880, 0.9);  // silver-blue unit, bright blue glow
}

function _bldgMat(subtype, isScav) {
  const cols = {
    hq:       isScav ? [0x8c4a12, 0x3a1200] : [0x1a3a8a, 0x08194a],
    housing:  isScav ? [0xa07820, 0x3a2a00] : [0xe8e8e8, 0x404040],
    barracks: isScav ? [0xa03818, 0x3a0800] : [0x2860d0, 0x0e2860],
    upgrade:  isScav ? [0x7a4830, 0x2a1000] : [0x7030e0, 0x2a0880],
    tower:    isScav ? [0xc05010, 0x501800] : [0x9040f0, 0x380888],
    magic:    isScav ? [0x502060, 0x180820] : [0x0870a0, 0x023448],
  };
  const [c, e] = cols[subtype] || [0x555555, 0x111111];
  return _getEmMat(c, e, 0.5);
}

// ── Mesh factories ────────────────────────────────────────
export function createUnitMesh(ent) {
  let geo;
  switch (ent.subtype) {
    case 'worker':   geo = new THREE.SphereGeometry(0.55, 10, 7);  break;
    case 'infantry': geo = new THREE.BoxGeometry(0.9, 1.3, 0.9);   break;
    case 'ranged':   geo = new THREE.ConeGeometry(0.55, 1.3, 7);   break;
    case 'heavy':    geo = new THREE.BoxGeometry(1.4, 1.7, 1.4);   break;
    case 'siege':    geo = new THREE.OctahedronGeometry(0.7, 1);   break;
    case 'caster':   geo = new THREE.CylinderGeometry(0.32, 0.7, 1.3, 7); break;
    default:         geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  }

  const isScav = ent.faction === FAC.SCAV;
  const mat    = _unitMat(ent.faction);
  const col    = isScav ? 0xff7833 : 0xa8d8ff;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(ent.x, 0.7, ent.z);
  mesh.userData.entityId = ent.id;
  scene.add(mesh);
  ent.mesh = mesh;

  // Enemy units get a team-color flag/fin on top so you can tell them apart instantly
  if (!isScav) {
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.6, 0.6),
      _getEmMat(0x5599ff, 0x0033bb, 1.0)
    );
    fin.position.y = 0.75;
    mesh.add(fin);
  }

  ent.hpBarY = 2.4;   // world-unit height above base for the HP bar

  ent._onDamage = () => spawnParticles(ent.x, 0.8, ent.z, col, 5);
  ent._onKill   = () => {
    spawnParticles(ent.x, 1.2, ent.z, isScav ? 0xff5500 : 0x4488ff, 20);
    if (ent.mesh)  { scene.remove(ent.mesh);  ent.mesh  = null; }
    if (ent._hpBar){ scene.remove(ent._hpBar.group); ent._hpBar = null; }
    removeSelRing(ent);
    addTombstone(ent.x, ent.z);
  };
}

export function createBldgMesh(ent) {
  const isScav = ent.faction === FAC.SCAV;
  const s = ent.size * TILE - 0.4;
  let h;
  switch (ent.subtype) {
    case 'hq':       h = 4.5; break;
    case 'housing':  h = 2.0; break;
    case 'barracks': h = 3.5; break;
    case 'upgrade':  h = 3.0; break;
    case 'tower':    h = 5.2; break;
    case 'magic':    h = 3.8; break;
    default:         h = 2.2;
  }

  const mat  = _bldgMat(ent.subtype, isScav);
  const geo  = new THREE.BoxGeometry(s, h, s);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(ent.x, h / 2, ent.z);
  mesh.userData.entityId = ent.id;
  scene.add(mesh);
  ent.mesh = mesh;

  // ── Faction badge on roof (easy to distinguish at a glance) ──
  const badgeGeo  = new THREE.BoxGeometry(s * 0.4, 0.3, s * 0.4);
  const badgeCol  = isScav ? 0xff6010 : 0x3399ff;
  const badgeMat  = _getEmMat(badgeCol, badgeCol, 1.2);
  const badge     = new THREE.Mesh(badgeGeo, badgeMat);
  badge.position.y = h / 2 + 0.15;
  mesh.add(badge);

  // ── Tower details ─────────────────────────────────────────
  if (ent.subtype === 'tower') {
    if (isScav) {
      // Junk cannon barrel
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 2.8, 7),
        _getEmMat(0xccaa44, 0x443300, 0.5)
      );
      barrel.rotation.z = Math.PI / 5;
      barrel.position.y = 1.2;
      mesh.add(barrel);
    } else {
      // Microwave dish — emissive purple so you can see it across the map
      const dish = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 1.8, 14),
        _getEmMat(0xbb44ff, 0x7700cc, 1.4)
      );
      dish.rotation.x = -Math.PI / 4;
      dish.position.y = 2.8;
      mesh.add(dish);
    }
  }

  ent.hpBarY = h + 1.2;  // above rooftop

  const dmgCol = isScav ? 0xff6610 : 0x4488ff;
  ent._onDamage = () => spawnParticles(ent.x, h * 0.5, ent.z, dmgCol, 4);
  ent._onKill   = () => {
    spawnParticles(ent.x, h * 0.5, ent.z, 0xff3300, 28);
    if (ent.mesh)  { scene.remove(ent.mesh);  ent.mesh  = null; }
    if (ent._hpBar){ scene.remove(ent._hpBar); ent._hpBar = null; }
    removeSelRing(ent);
  };
}

export function createResourceMesh(ent) {
  const isDump  = ent.subtype === 'dump';
  const isCafe  = ent.subtype === 'cafe';
  const isDept  = ent.subtype === 'deptstore';

  if (isCafe) {
    _createCafeMesh(ent);
    return;
  }

  const h = isDump ? 3.6 : 4.0;
  // Scrap Dump: obvious orange-gold pile so player can see "gather Scrap here"
  const mat = isDump
    ? _getEmMat(0xe8a030, 0x8a5010, 1.0)
    : _getEmMat(0x2266ff, 0x001166, 0.9);

  const geo = isDump
    ? new THREE.ConeGeometry(4.0, h, 8)
    : new THREE.BoxGeometry(5.0, h, 4.0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(ent.x, h / 2, ent.z);
  mesh.userData.entityId = ent.id;
  scene.add(mesh);
  ent.mesh = mesh;

  // Glow disc under Dump so it reads as "right-click to gather Scrap"
  const signCol = isDump ? 0xf0b040 : 0x55aaff;
  const sign = new THREE.Mesh(
    new THREE.CylinderGeometry(isDump ? 2.2 : 1.0, isDump ? 2.2 : 1.0, 0.15, 12),
    _getEmMat(signCol, isDump ? 0xb07010 : signCol, isDump ? 1.8 : 1.5)
  );
  sign.position.y = 0.08;
  mesh.add(sign);

  ent.hpBarY = h + 1.0;

  ent._onKill = () => {
    if (ent.mesh)  { scene.remove(ent.mesh);  ent.mesh  = null; }
    if (ent._hpBar){ scene.remove(ent._hpBar.group); ent._hpBar = null; }
  };
}

// ── Cafe mesh — Gilded resource node ─────────────────────
// A glowing corner coffee shop: boxy building + striped awning + warm sign.
// Warm amber light distinguishes it from dept store blue and dump grey.
function _createCafeMesh(ent) {
  const h    = 3.6;
  const root = new THREE.Group();
  root.position.set(ent.x, 0, ent.z);
  root.userData.entityId = ent.id;

  // Main building body — warm amber/tan
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(4.4, h, 3.6),
    _getEmMat(0xc8843a, 0x5a2800, 0.5)
  );
  body.position.y = h / 2;
  root.add(body);

  // Awning — a flat box jutting out front, striped warm yellow
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(4.8, 0.22, 1.6),
    _getEmMat(0xfbbf24, 0x6a3800, 1.2)
  );
  awning.position.set(0, h * 0.65, 2.4);
  root.add(awning);

  // Glowing sign on top
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.5, 0.2),
    _getEmMat(0xfef08a, 0xd97706, 2.0)
  );
  sign.position.set(0, h + 0.5, 1.6);
  root.add(sign);

  // Coffee cup silhouette on the sign (small cylinder)
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.18, 0.4, 8),
    _getEmMat(0xfef9c3, 0xb45309, 2.5)
  );
  cup.position.set(0.9, h + 0.9, 1.6);
  root.add(cup);

  // Steam wisps (two tiny cones above cup)
  for (let i = -1; i <= 1; i += 2) {
    const steam = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.3, 5),
      _getEmMat(0xfef9c3, 0xfef9c3, 1.0)
    );
    steam.position.set(0.9 + i * 0.14, h + 1.3, 1.6);
    root.add(steam);
  }

  scene.add(root);
  ent.mesh   = root;
  ent.hpBarY = h + 1.8;

  ent._onKill = () => {
    if (ent.mesh)  { scene.remove(ent.mesh);  ent.mesh  = null; }
    if (ent._hpBar){ scene.remove(ent._hpBar.group); ent._hpBar = null; }
  };
}

// ── Selection ring ────────────────────────────────────────
export function addSelRing(ent) {
  if (ent.selRing) return;
  const r = ent.isBldg ? ent.size * TILE * 0.58 : (ent.isRes ? 3.2 : 1.3);
  const geo = new THREE.RingGeometry(r - 0.18, r, 28);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, getMat(COL.select));
  mesh.position.set(ent.x, 0.06, ent.z);
  scene.add(mesh);
  ent.selRing = mesh;
}

export function removeSelRing(ent) {
  if (ent.selRing) { scene.remove(ent.selRing); ent.selRing = null; }
}

// ── Particles ─────────────────────────────────────────────
const _particles = [];

export function spawnParticles(x, y, z, color, count) {
  for (let i = 0; i < count; i++) {
    _particles.push({
      x, y, z,
      vx: (Math.random() - 0.5) * 5,
      vy: Math.random() * 4 + 1,
      vz: (Math.random() - 0.5) * 5,
      life: 0.4 + Math.random() * 0.4,
      maxLife: 0.8,
      color,
    });
  }
}

// Batch particle points mesh
const _pGeo = new THREE.BufferGeometry();
const _pPos = new Float32Array(3000);
const _pCol = new Float32Array(3000);
_pGeo.setAttribute('position', new THREE.BufferAttribute(_pPos, 3));
_pGeo.setAttribute('color', new THREE.BufferAttribute(_pCol, 3));
const _pMat = new THREE.PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, opacity: 0.85, sizeAttenuation: true });
const _pMesh = new THREE.Points(_pGeo, _pMat);
scene.add(_pMesh);

const _tmpColor = new THREE.Color();

export function updateParticles(dt) {
  for (let i = _particles.length - 1; i >= 0; i--) {
    const p = _particles[i];
    p.life -= dt;
    if (p.life <= 0) { _particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy -= 9.8 * dt;
    if (p.y < 0) p.y = 0;
  }

  const count = Math.min(_particles.length, 1000);
  for (let i = 0; i < count; i++) {
    const p = _particles[i];
    _pPos[i * 3]     = p.x;
    _pPos[i * 3 + 1] = p.y;
    _pPos[i * 3 + 2] = p.z;
    _tmpColor.set(p.color);
    _pCol[i * 3]     = _tmpColor.r;
    _pCol[i * 3 + 1] = _tmpColor.g;
    _pCol[i * 3 + 2] = _tmpColor.b;
  }
  _pGeo.attributes.position.needsUpdate = true;
  _pGeo.attributes.color.needsUpdate = true;
  _pGeo.setDrawRange(0, count);
}

// ── Ground mesh accessor ──────────────────────────────────
// terrain.js calls this to apply the tile texture to the ground plane.
export function getGroundMesh() { return ground; }

// ── Projectile system ─────────────────────────────────────
// Purely visual — damage is already applied. Projectiles fly from
// attacker to target giving ranged combat readable screen feedback.
const _projs = [];

export function spawnProjectile(fromEnt, toEnt, color, speed = 30) {
  if (!fromEnt || !toEnt) return;
  const geo  = new THREE.SphereGeometry(0.28, 7, 5);
  const mat  = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(fromEnt.x, 1.4, fromEnt.z);
  scene.add(mesh);
  // Store a fresh target snapshot so we can track the hit position
  _projs.push({ mesh, color, toEnt, lastTx: toEnt.x, lastTz: toEnt.z, speed });
}

export function updateProjectiles(dt) {
  for (let i = _projs.length - 1; i >= 0; i--) {
    const p = _projs[i];
    // Track moving target
    if (p.toEnt?.alive) { p.lastTx = p.toEnt.x; p.lastTz = p.toEnt.z; }
    const dx = p.lastTx - p.mesh.position.x;
    const dz = p.lastTz - p.mesh.position.z;
    const d  = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.9) {
      spawnParticles(p.lastTx, 0.8, p.lastTz, p.color, 8);
      scene.remove(p.mesh);
      _projs.splice(i, 1);
    } else {
      const step = Math.min(p.speed * dt, d);
      p.mesh.position.x += (dx / d) * step;
      p.mesh.position.z += (dz / d) * step;
    }
  }
}

// ── Floating HP bars ──────────────────────────────────────
// Always visible above enemy units/buildings.
// Visible above player units when selected or damaged.
// Mirrors Warcraft's in-world health indicators.

const _hpBgMat  = new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false });
const _hpColMats = {
  hi:  new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false }),
  med: new THREE.MeshBasicMaterial({ color: 0xeab308, depthTest: false }),
  lo:  new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false }),
};

function _hpMat(pct) {
  return pct > 0.66 ? _hpColMats.hi : pct > 0.33 ? _hpColMats.med : _hpColMats.lo;
}

// ── Tombstones (when a unit dies, health bar is removed and a tombstone appears) ──
const _tombstones = [];

function _makeTombstoneTexture() {
  const W = 16, H = 24;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  // Dark outline
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, W, H);
  // Grey stone body (pixel-art tombstone shape: rounded top, wide base)
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(2, 4, 12, 18);
  ctx.fillRect(3, 2, 10, 4);
  ctx.fillRect(4, 0, 8, 3);
  // Highlight
  ctx.fillStyle = '#6a6a6a';
  ctx.fillRect(4, 6, 4, 14);
  ctx.fillRect(5, 3, 2, 3);
  // Cross or RIP hint (dark)
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(6, 8, 4, 10);
  ctx.fillRect(5, 12, 6, 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

let _tombstoneTexture = null;

function _tombstoneMesh() {
  if (!_tombstoneTexture) _tombstoneTexture = _makeTombstoneTexture();
  const W = 1.0, H = 1.5;
  const geo = new THREE.PlaneGeometry(W, H);
  const mat = new THREE.MeshLambertMaterial({
    map: _tombstoneTexture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(geo, mat);
  plane.renderOrder = 500;
  const group = new THREE.Group();
  group.add(plane);
  group.position.y = H / 2;
  return group;
}

export function addTombstone(x, z) {
  const group = _tombstoneMesh();
  group.position.set(x, 0, z);
  scene.add(group);
  _tombstones.push(group);
}

export function clearTombstones() {
  for (const g of _tombstones) {
    scene.remove(g);
    g.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
  _tombstones.length = 0;
}

export function tickTombstones() {
  camera.getWorldDirection(_camDir);
  for (const group of _tombstones) {
    group.lookAt(
      group.position.x - _camDir.x,
      group.position.y - _camDir.y,
      group.position.z - _camDir.z
    );
  }
}

function _makeHpBar(barW) {
  const group   = new THREE.Group();
  group.renderOrder = 999;

  // Dark background track
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.24), _hpBgMat);
  bg.renderOrder = 999;
  group.add(bg);

  // Colored fill — scaled & offset each frame
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.18), _hpColMats.hi.clone());
  fill.position.z = 0.01;  // just in front of bg
  fill.renderOrder = 1000;
  group.add(fill);

  return { group, fill, barW };
}

// Camera look direction (fixed orthographic angle) — used for billboarding.
// We compute once and reuse; it never changes for our fixed camera.
const _camDir = new THREE.Vector3();

export function tickHealthBars(entities) {
  // Direction the camera faces — bars rotate to face it
  camera.getWorldDirection(_camDir);

  for (const ent of entities) {
    // Remove bar if dead or no mesh
    if (!ent.alive || !ent.mesh) {
      if (ent._hpBar) { scene.remove(ent._hpBar.group); ent._hpBar = null; }
      continue;
    }

    const isEnemy   = ent.faction === config.aiFac;
    const isDamaged = ent.hp < ent.maxHp;
    const isSelected = ent.selected;

    // Show for: all enemies, damaged/selected friendlies, resource nodes being harvested
    const show = isEnemy || isDamaged || isSelected
              || (ent.isRes && isDamaged);

    if (!show) {
      if (ent._hpBar) { scene.remove(ent._hpBar.group); ent._hpBar = null; }
      continue;
    }

    // Create bar if needed
    if (!ent._hpBar) {
      const barW = ent.isBldg ? Math.max(3.0, ent.size * TILE * 0.65)
                 : ent.isRes  ? 4.0
                 :              2.6;
      ent._hpBar = _makeHpBar(barW);
      scene.add(ent._hpBar.group);
    }

    const { group, fill, barW } = ent._hpBar;
    const pct = Math.max(0, ent.hp / ent.maxHp);

    // Position above entity
    const y = ent.hpBarY ?? 2.4;
    group.position.set(ent.x, y, ent.z);

    // Billboard: face camera (negate direction so bar faces toward viewer)
    group.lookAt(
      ent.x - _camDir.x,
      y     - _camDir.y,
      ent.z - _camDir.z
    );

    // Update fill width and position (left-aligned)
    fill.scale.x = Math.max(0.001, pct);
    fill.position.x = (pct - 1) * barW / 2;

    // Update fill color
    fill.material = _hpMat(pct);
  }
}

// ── Sync mesh to entity position ──────────────────────────
export function syncMeshes(ent) {
  if (ent.mesh) {
    ent.mesh.position.x = ent.x;
    ent.mesh.position.z = ent.z;
  }
  if (ent.selRing) {
    ent.selRing.position.x = ent.x;
    ent.selRing.position.z = ent.z;
  }
}

// ── Resize / camera update ────────────────────────────────
export function resizeRenderer() {
  const w  = window.innerWidth;
  const h  = window.innerHeight - TOP_H - STATUS_H - HUD_H;
  renderer.setSize(w, h);
  canvas.style.top    = TOP_H + 'px';
  canvas.style.left   = '0';
  const a = w / h;
  camera.left   = -FRUSTUM_SIZE * a;
  camera.right  =  FRUSTUM_SIZE * a;
  camera.top    =  FRUSTUM_SIZE;
  camera.bottom = -FRUSTUM_SIZE;
  camera.updateProjectionMatrix();
}

// ── Mouse → world ray ─────────────────────────────────────
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hitPoint    = new THREE.Vector3();

export function worldFromMouse(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  mouse.x =  ((clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((clientY - rect.top)  / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  raycaster.ray.intersectPlane(_groundPlane, _hitPoint);
  return _hitPoint;   // .x, .z are world coords
}

// ── Entity screen projection (for drag-select hit test) ───
export function entityToScreen(ent) {
  const rect = canvas.getBoundingClientRect();
  const v = new THREE.Vector3(ent.x, 0.5, ent.z);
  v.project(camera);
  return {
    x: (v.x *  0.5 + 0.5) * rect.width  + rect.left,
    y: (v.y * -0.5 + 0.5) * rect.height + rect.top,
  };
}
