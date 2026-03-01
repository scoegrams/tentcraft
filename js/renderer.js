// ═══════════════════════════════════════════════════════════
// renderer.js — Three.js scene, camera, mesh factories, particles
// Mirrors Warcraft's Map renderer + unit sprite system
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { COL, TILE, WORLD_W, WORLD_H, FAC, BLDG_DEFS } from './constants.js';
import { config } from './config.js';
import { G } from './state.js';

// ── Scene, Camera, Renderer ───────────────────────────────
export const scene    = new THREE.Scene();
export const raycaster = new THREE.Raycaster();
export const mouse    = new THREE.Vector2();

export const canvas   = document.getElementById('c');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const FRUSTUM = 40;
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
  const isScav = ent.faction === FAC.SCAV;
  const mat    = _unitMat(ent.faction);
  const col    = isScav ? 0xff7833 : 0xa8d8ff;

  // ── Transport / Sprinter — composite van mesh ─────────
  if (ent.subtype === 'transport') {
    const g = new THREE.Group();
    g.position.set(ent.x, 0, ent.z);
    g.userData.entityId = ent.id;

    const bodyCol  = isScav ? 0x4a6a20 : 0x204060;
    const bodyMat  = new THREE.MeshLambertMaterial({ color: bodyCol });
    const body     = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.0, 2.0), bodyMat);
    body.position.y = 1.2;
    g.add(body);

    // Windshield strip
    const windMat = new THREE.MeshLambertMaterial({ color: 0x99ccff, transparent: true, opacity: 0.7 });
    const wind    = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 1.6), windMat);
    wind.position.set(-1.97, 1.65, 0);
    g.add(wind);

    // Roof rack / gun mount bar
    const rackMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const rack    = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 0.15), rackMat);
    rack.position.set(0.2, 2.22, 0);
    g.add(rack);

    // Wheels (4 corners)
    const wGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 10);
    const wMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    for (const [wx, wz] of [[-1.2, 1.1], [-1.2, -1.1], [1.2, 1.1], [1.2, -1.1]]) {
      const w = new THREE.Mesh(wGeo, wMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.38, wz);
      g.add(w);
    }

    // Faction accent stripe along side
    const stripeMat = new THREE.MeshLambertMaterial({ color: isScav ? 0xff6600 : 0x4488ff });
    const stripe    = new THREE.Mesh(new THREE.BoxGeometry(3.82, 0.22, 0.06), stripeMat);
    stripe.position.set(0, 1.2, 1.04);
    g.add(stripe);

    scene.add(g);
    ent.mesh   = g;
    ent.hpBarY = 3.2;

    // Cargo count label (sprite updated on load/unload)
    ent._onDamage = () => spawnParticles(ent.x, 1.0, ent.z, bodyCol, 6);
    ent._onKill   = () => {
      spawnParticles(ent.x, 1.5, ent.z, 0xff4400, 28);
      if (ent.mesh)   { scene.remove(ent.mesh);  ent.mesh  = null; }
      if (ent._hpBar) { scene.remove(ent._hpBar.group); ent._hpBar = null; }
      removeSelRing(ent);
      addTombstone(ent.x, ent.z);
    };
    return;
  }

  // ── Standard unit meshes ──────────────────────────────
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

  ent.hpBarY = 2.4;

  ent._onDamage = () => spawnParticles(ent.x, 0.8, ent.z, col, 5);
  ent._onKill   = () => {
    spawnParticles(ent.x, 1.2, ent.z, isScav ? 0xff5500 : 0x4488ff, 20);
    if (ent.mesh)    { scene.remove(ent.mesh);  ent.mesh  = null; }
    if (ent._hpBar)  { scene.remove(ent._hpBar.group); ent._hpBar = null; }
    if (ent._indMesh){ scene.remove(ent._indMesh); ent._indMesh = null; }
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
export function addSelRing(ent, col) {
  if (ent.selRing) return;
  const r = ent.isBldg ? ent.size * TILE * 0.58 : (ent.isRes ? 3.2 : 1.3);
  const geo = new THREE.RingGeometry(r - 0.18, r, 28);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, getMat(col ?? COL.select));
  mesh.position.set(ent.x, 0.06, ent.z);
  scene.add(mesh);
  ent.selRing = mesh;
}

export function removeSelRing(ent) {
  if (ent.selRing) { scene.remove(ent.selRing); ent.selRing = null; }
}

// ── Melee hit flash ───────────────────────────────────────
// A quick starburst of bright lines radiating from impact point,
// like a comic-book hit effect. Fades in ~0.18 s.
const _hitFlashes = [];

export function spawnHitFlash(x, z) {
  const col  = 0xfff060;   // hot yellow-white
  const spokes = 5 + Math.floor(Math.random() * 3);   // 5–7 spikes
  for (let i = 0; i < spokes; i++) {
    const angle  = (i / spokes) * Math.PI * 2 + Math.random() * 0.4;
    const length = 0.6 + Math.random() * 0.8;
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(length, 0.09 + Math.random() * 0.06);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = angle;
    // Offset along the spoke direction so it radiates outward
    mesh.position.set(
      x + Math.cos(angle) * length * 0.5,
      0.25,
      z + Math.sin(angle) * length * 0.5
    );
    scene.add(mesh);
    _hitFlashes.push({ mesh, life: 0.18, maxLife: 0.18, sx: 1, endScale: 1.6 + Math.random() * 0.6 });
  }
  // Central bright dot
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0, side: THREE.DoubleSide })
  );
  dot.rotation.x = -Math.PI / 2;
  dot.position.set(x, 0.28, z);
  scene.add(dot);
  _hitFlashes.push({ mesh: dot, life: 0.12, maxLife: 0.12, sx: 1, endScale: 2.2 });
}

export function updateHitFlashes(dt) {
  for (let i = _hitFlashes.length - 1; i >= 0; i--) {
    const f = _hitFlashes[i];
    f.life -= dt;
    if (f.life <= 0) {
      scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      f.mesh.material.dispose();
      _hitFlashes.splice(i, 1);
      continue;
    }
    const t = f.life / f.maxLife;           // 1 → 0
    f.mesh.material.opacity = t * (f.mesh.geometry.type === 'CircleGeometry' ? 1.0 : 0.92);
    const s = f.sx + (f.endScale - f.sx) * (1 - t);
    f.mesh.scale.set(s, s, 1);
  }
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

const _defaultFogColor = 0x100e08;
const _defaultFogDensity = 0.0006;

export function setSceneTheme(theme) {
  if (theme === 'snow') {
    scene.fog = new THREE.FogExp2(0x90a0b8, 0.0004);
    dirLight.color.set(0xc8d4e0);
    fillLight.color.set(0x7090b0);
  } else {
    scene.fog = new THREE.FogExp2(_defaultFogColor, _defaultFogDensity);
    dirLight.color.set(0xfff4e0);
    fillLight.color.set(0x5580bb);
  }
}

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

const _hpDrainMat = new THREE.MeshBasicMaterial({ color: 0xcc2222, depthTest: false, transparent: true, opacity: 0.85 });

function _makeHpBar(barW) {
  const group   = new THREE.Group();
  group.renderOrder = 999;

  // Dark background track
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.32), _hpBgMat);
  bg.renderOrder = 999;
  group.add(bg);

  // Drain ghost bar — shows where HP used to be, fades to reveal actual loss
  const drain = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.24), _hpDrainMat.clone());
  drain.position.z = 0.005;
  drain.renderOrder = 999;
  group.add(drain);

  // Colored fill — scaled & offset each frame
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.24), _hpColMats.hi.clone());
  fill.position.z = 0.01;
  fill.renderOrder = 1000;
  group.add(fill);

  return { group, fill, drain, barW, drainPct: 1.0 };
}

// Camera look direction (fixed orthographic angle) — used for billboarding.
// We compute once and reuse; it never changes for our fixed camera.
const _camDir = new THREE.Vector3();

export function tickHealthBars(entities) {
  camera.getWorldDirection(_camDir);
  const dt = G.dt || 0.016;

  for (const ent of entities) {
    if (!ent.alive || !ent.mesh) {
      if (ent._hpBar) { scene.remove(ent._hpBar.group); ent._hpBar = null; }
      continue;
    }

    const isEnemy    = ent.faction === config.aiFac;
    const isDamaged  = ent.hp < ent.maxHp;
    const isSelected = ent.selected;
    const show = isEnemy || isDamaged || isSelected || (ent.isRes && isDamaged);

    if (!show) {
      if (ent._hpBar) { scene.remove(ent._hpBar.group); ent._hpBar = null; }
      continue;
    }

    if (!ent._hpBar) {
      const barW = ent.isBldg ? Math.max(3.8, ent.size * TILE * 0.8)
                 : ent.isRes  ? 4.5
                 :              3.2;
      ent._hpBar = _makeHpBar(barW);
      scene.add(ent._hpBar.group);
    }

    const bar = ent._hpBar;
    const { group, fill, drain, barW } = bar;
    const pct = Math.max(0, ent.hp / ent.maxHp);

    // Position above entity
    const y = ent.hpBarY ?? 2.4;
    group.position.set(ent.x, y, ent.z);

    // Billboard
    group.lookAt(ent.x - _camDir.x, y - _camDir.y, ent.z - _camDir.z);

    // Fill bar (instant, shows actual HP)
    fill.scale.x    = Math.max(0.001, pct);
    fill.position.x = (pct - 1) * barW / 2;
    fill.material    = _hpMat(pct);

    // Drain ghost bar — stays at the "old" HP and slowly shrinks to catch up
    if (bar.drainPct > pct) {
      // New damage just landed — drain stays where it was, revealing the red gap
      bar.drainPct = Math.max(pct, bar.drainPct - dt * 0.8); // drain speed
    } else {
      bar.drainPct = pct; // catch up / no damage in progress
    }
    drain.scale.x    = Math.max(0.001, bar.drainPct);
    drain.position.x = (bar.drainPct - 1) * barW / 2;
    drain.material.opacity = bar.drainPct > pct + 0.01 ? 0.85 : 0;
  }
}

// ── Damage flash on entity mesh ───────────────────────────
// When an entity takes damage, briefly flash its mesh white to sell the impact.
const _flashEntities = new Map(); // ent.id → { originalMats, timer }
const _flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

export function flashEntityOnHit(ent) {
  if (!ent.mesh) return;
  // If already flashing, just reset timer
  if (_flashEntities.has(ent.id)) {
    _flashEntities.get(ent.id).timer = 0.08;
    return;
  }
  // Store original materials
  const originals = [];
  ent.mesh.traverse(child => {
    if (child.isMesh && child.material) {
      originals.push({ mesh: child, mat: child.material });
      child.material = _flashMat;
    }
  });
  _flashEntities.set(ent.id, { originals, timer: 0.08 });
}

export function updateDamageFlashes(dt) {
  for (const [id, data] of _flashEntities) {
    data.timer -= dt;
    if (data.timer <= 0) {
      // Restore original materials
      for (const { mesh, mat } of data.originals) {
        if (mesh) mesh.material = mat;
      }
      _flashEntities.delete(id);
    }
  }
}

// ── Floating damage numbers ──────────────────────────────
// Each time damage is dealt, a small number pops up and floats upward.
const _dmgNumbers = [];

function _makeDmgTexture(amount) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const x = c.getContext('2d');
  x.font = 'bold 22px Rajdhani, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  // Outline
  x.strokeStyle = '#000';
  x.lineWidth = 3;
  x.strokeText(`-${amount}`, 32, 16);
  // Fill
  x.fillStyle = amount >= 40 ? '#ff3030' : amount >= 15 ? '#ffaa20' : '#ffffff';
  x.fillText(`-${amount}`, 32, 16);
  return new THREE.CanvasTexture(c);
}

export function spawnDmgNumber(x, z, amount) {
  const tex = _makeDmgTexture(amount);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 1.0, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 1.1, 1);
  sprite.position.set(x + (Math.random() - 0.5) * 1.5, 3.0, z + (Math.random() - 0.5) * 0.5);
  sprite.renderOrder = 1100;
  scene.add(sprite);
  _dmgNumbers.push({ sprite, life: 0.7, maxLife: 0.7 });
}

export function updateDmgNumbers(dt) {
  for (let i = _dmgNumbers.length - 1; i >= 0; i--) {
    const d = _dmgNumbers[i];
    d.life -= dt;
    if (d.life <= 0) {
      scene.remove(d.sprite);
      d.sprite.material.map.dispose();
      d.sprite.material.dispose();
      _dmgNumbers.splice(i, 1);
      continue;
    }
    const t = d.life / d.maxLife; // 1→0
    d.sprite.position.y += dt * 3.0; // float up
    d.sprite.material.opacity = Math.min(1, t * 2.5);
  }
}

// ── Carry / work indicator above workers ─────────────────
// A small floating diamond above the unit's head shows their current job at a glance:
//   brown  = digging TRASH
//   orange = carrying Scrap
//   green  = carrying Salvage
//   hidden = idle / fighting / building
const _IND_GEO = new THREE.OctahedronGeometry(0.38, 0);
const _indMats = {
  dig:   new THREE.MeshBasicMaterial({ color: 0x8a5010 }),
  scrap: new THREE.MeshBasicMaterial({ color: 0xf09030 }),
  salv:  new THREE.MeshBasicMaterial({ color: 0x80c030 }),
};

function _syncCarryIndicator(ent) {
  if (!ent.isUnit || ent.subtype !== 'worker') return;

  // Determine what indicator the unit should show
  let key = null;
  if (ent.carriedRes > 0) {
    key = ent.carriedType === 'salvage' ? 'salv' : 'scrap';
  } else if (ent.state === 'extracting' && ent._extractReady) {
    key = 'dig';
  }

  if (!key) {
    // Hide and remove any existing indicator
    if (ent._indMesh) { scene.remove(ent._indMesh); ent._indMesh = null; }
    return;
  }

  if (!ent._indMesh) {
    ent._indMesh = new THREE.Mesh(_IND_GEO, _indMats[key]);
    scene.add(ent._indMesh);
  } else {
    ent._indMesh.material = _indMats[key];
  }

  // Float and bob above unit head
  const bob = Math.sin(Date.now() * 0.004) * 0.18;
  ent._indMesh.position.set(ent.x, 3.2 + bob, ent.z);
  ent._indMesh.rotation.y += 0.04;
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
  _syncCarryIndicator(ent);
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

// ── Attack order markers ──────────────────────────────────
// Visual feedback when the player issues attack commands: a red crosshair
// ring pulses at the target location then fades out.
const _atkMarkers = [];

const _crossGeo = new THREE.RingGeometry(1.2, 1.6, 16);
const _crossMat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.9, side: THREE.DoubleSide });

export function spawnAttackMarker(x, z) {
  const ring = new THREE.Mesh(_crossGeo, _crossMat.clone());
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.15, z);
  scene.add(ring);

  // Inner crosshair lines (two thin quads forming an X)
  const lineGeo = new THREE.PlaneGeometry(2.8, 0.12);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const h = new THREE.Mesh(lineGeo, lineMat.clone());
  h.rotation.x = -Math.PI / 2;
  h.position.set(x, 0.16, z);
  scene.add(h);
  const v = new THREE.Mesh(lineGeo, lineMat.clone());
  v.rotation.x = -Math.PI / 2;
  v.rotation.z = Math.PI / 2;
  v.position.set(x, 0.16, z);
  scene.add(v);

  _atkMarkers.push({ ring, h, v, life: 0.7 });
}

export function updateAttackMarkers(dt) {
  for (let i = _atkMarkers.length - 1; i >= 0; i--) {
    const m = _atkMarkers[i];
    m.life -= dt;
    if (m.life <= 0) {
      scene.remove(m.ring); scene.remove(m.h); scene.remove(m.v);
      m.ring.geometry !== _crossGeo && m.ring.geometry.dispose();
      m.ring.material.dispose();
      m.h.material.dispose(); m.v.material.dispose();
      _atkMarkers.splice(i, 1);
      continue;
    }
    const t = m.life / 0.7;
    const scale = 1 + (1 - t) * 0.6;
    m.ring.scale.set(scale, scale, 1);
    m.ring.material.opacity = t * 0.9;
    m.h.material.opacity = t * 0.85;
    m.v.material.opacity = t * 0.85;
    m.h.scale.set(scale, scale, 1);
    m.v.scale.set(scale, scale, 1);
  }
}

// ── Target ring — shows under the entity being targeted by selected units ──
let _targetRing = null;
let _targetEnt  = null;
const _tgtRingGeo = new THREE.RingGeometry(1.8, 2.2, 20);
const _tgtRingMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.55, side: THREE.DoubleSide });

export function setTargetRing(ent) {
  if (_targetEnt === ent && _targetRing) return;
  clearTargetRing();
  if (!ent) return;
  _targetEnt = ent;
  const s = ent.isBldg ? Math.max(2.5, ent.size * 1.2) : 1.0;
  _targetRing = new THREE.Mesh(_tgtRingGeo, _tgtRingMat);
  _targetRing.rotation.x = -Math.PI / 2;
  _targetRing.scale.set(s, s, 1);
  _targetRing.position.set(ent.x, 0.12, ent.z);
  scene.add(_targetRing);
}

export function clearTargetRing() {
  if (_targetRing) { scene.remove(_targetRing); _targetRing = null; _targetEnt = null; }
}

export function updateTargetRing() {
  if (!_targetRing || !_targetEnt) return;
  if (!_targetEnt.alive) { clearTargetRing(); return; }
  _targetRing.position.set(_targetEnt.x, 0.12, _targetEnt.z);
  const pulse = 0.95 + Math.sin(Date.now() * 0.006) * 0.08;
  const s = (_targetEnt.isBldg ? Math.max(2.5, _targetEnt.size * 1.2) : 1.0) * pulse;
  _targetRing.scale.set(s, s, 1);
}

// ── Rally point flags ─────────────────────────────────────
// Small 3D flag-on-pole planted at each building's rally point.
// One flag per building; moving the rally replaces the old one.
const _rallyFlags = new Map(); // bldg.id → THREE.Group

const _flagPoleMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });
const _flagMat     = new THREE.MeshBasicMaterial({ color: 0xff4400, side: THREE.DoubleSide });
const _flagRingMat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.35 });

// ── Rally confirm burst ───────────────────────────────────
// Plays when a rally point is set: expanding orange ring + floating 🚩 icon.
const _rallyConfirms = [];

function _makeFlagIconTex() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const x = c.getContext('2d');
  x.font = '44px serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('🚩', 32, 32);
  return new THREE.CanvasTexture(c);
}
const _flagIconTex = _makeFlagIconTex();

export function spawnRallyConfirm(wx, wz) {
  // Expanding ring
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xff5520, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.55, 20), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(wx, 0.1, wz);
  scene.add(ring);

  // Floating 🚩 billboard
  const iconMat = new THREE.SpriteMaterial({
    map: _flagIconTex, transparent: true, opacity: 1.0,
  });
  const icon = new THREE.Sprite(iconMat);
  icon.scale.set(2.2, 2.2, 1);
  icon.position.set(wx, 2.8, wz);
  scene.add(icon);

  _rallyConfirms.push({ ring, icon, life: 0.9, maxLife: 0.9 });
}

export function updateRallyConfirms(dt) {
  for (let i = _rallyConfirms.length - 1; i >= 0; i--) {
    const rc = _rallyConfirms[i];
    rc.life -= dt;
    if (rc.life <= 0) {
      scene.remove(rc.ring); scene.remove(rc.icon);
      rc.ring.geometry.dispose(); rc.ring.material.dispose();
      rc.icon.material.dispose();
      _rallyConfirms.splice(i, 1);
      continue;
    }
    const t = rc.life / rc.maxLife; // 1→0
    // Ring expands outward and fades
    const s = 1 + (1 - t) * 3.5;
    rc.ring.scale.set(s, s, 1);
    rc.ring.material.opacity = t * 0.85;
    // Icon floats up and fades in upper half of lifetime
    rc.icon.position.y = 2.8 + (1 - t) * 1.8;
    rc.icon.material.opacity = Math.min(1, t * 2.5);
  }
}

export function setRallyFlag(bldg) {
  // Remove old flag for this building if it exists
  removeRallyFlag(bldg);

  const g = new THREE.Group();

  // Pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5),
    _flagPoleMat
  );
  pole.position.y = 1.2;
  g.add(pole);

  // Flag pennant (small triangle-ish plane)
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.55),
    _flagMat.clone()
  );
  flag.position.set(0.45, 2.3, 0);
  g.add(flag);

  // Ground ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.65, 16),
    _flagRingMat.clone()
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(ring);

  g.position.set(bldg.rallyX, 0, bldg.rallyZ);
  scene.add(g);
  _rallyFlags.set(bldg.id, g);
}

export function removeRallyFlag(bldg) {
  const old = _rallyFlags.get(bldg.id);
  if (old) {
    scene.remove(old);
    old.children.forEach(c => { c.geometry?.dispose(); c.material?.dispose(); });
    _rallyFlags.delete(bldg.id);
  }
}

export function clearAllRallyFlags() {
  for (const [id, g] of _rallyFlags) {
    scene.remove(g);
    g.children.forEach(c => { c.geometry?.dispose(); c.material?.dispose(); });
  }
  _rallyFlags.clear();
}

export function tickRallyFlags() {
  const pulse = 0.7 + Math.sin(Date.now() * 0.004) * 0.3;
  for (const g of _rallyFlags.values()) {
    // Gently pulse the ring opacity
    const ring = g.children[2];
    if (ring?.material) ring.material.opacity = 0.2 + pulse * 0.25;
  }
}

// ── Move waypoint markers ─────────────────────────────────
// Green chevron + ring that appears at the move destination when a move
// order is issued, mimicking WC2 / StarCraft feedback.
// Multiple waypoints can coexist (one per distinct destination).
const _waypoints = [];

const _wpRingGeo   = new THREE.RingGeometry(0.55, 0.82, 14);
const _wpChevGeo   = new THREE.ConeGeometry(0.48, 0.72, 3);   // downward-pointing triangle

export function spawnMoveWaypoint(x, z) {
  const col = 0x22ee66;

  const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(_wpRingGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.14, z);
  scene.add(ring);

  // Downward chevron (cone pointing down)
  const chevMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 });
  const chev = new THREE.Mesh(_wpChevGeo, chevMat);
  chev.rotation.x = Math.PI;   // flip so tip faces down toward ground
  chev.position.set(x, 1.4, z);
  scene.add(chev);

  // Thin vertical stem connecting chevron to ring
  const stemGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.1, 4);
  const stemMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6 });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.set(x, 0.75, z);
  scene.add(stem);

  _waypoints.push({ ring, chev, stem, life: 0.85, maxLife: 0.85, startY: chev.position.y });
}

export function updateMoveWaypoints(dt) {
  for (let i = _waypoints.length - 1; i >= 0; i--) {
    const w = _waypoints[i];
    w.life -= dt;
    if (w.life <= 0) {
      scene.remove(w.ring); scene.remove(w.chev); scene.remove(w.stem);
      w.ring.material.dispose(); w.chev.material.dispose(); w.stem.material.dispose();
      w.stem.geometry.dispose();
      _waypoints.splice(i, 1);
      continue;
    }
    const t = w.life / w.maxLife;           // 1→0 as it ages
    const ease = t * t;                      // accelerate fade
    w.ring.material.opacity  = ease * 0.9;
    w.chev.material.opacity  = ease * 0.85;
    w.stem.material.opacity  = ease * 0.6;
    // Chevron bobs downward as it fades (drops into the ground)
    w.chev.position.y = w.startY * (0.5 + t * 0.5);
    w.stem.scale.y    = 0.3 + t * 0.7;
    w.stem.position.y = w.chev.position.y * 0.5;
    // Ring expands slightly
    const rs = 1 + (1 - t) * 0.5;
    w.ring.scale.set(rs, rs, 1);
  }
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
