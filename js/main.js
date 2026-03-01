// ═══════════════════════════════════════════════════════════
// main.js — game init, loop, map setup
// Mirrors Warcraft's GameController + Map initialization
// ═══════════════════════════════════════════════════════════

import { FAC, WORLD_W, WORLD_H } from './constants.js';
import { config } from './config.js';
import { G } from './state.js';
import { renderer, camera, scene, resizeRenderer, updateParticles,
         updateProjectiles, tickHealthBars, getGroundMesh } from './renderer.js';
import { initTerrain } from './terrain.js';
import { MAP_GREAT_DIVIDE } from '../maps/great-divide.js';
import { spawnUnit }      from './units.js';
import { spawnBuilding }  from './buildings.js';
import { spawnResource }  from './resources.js';
import { updateUnit }     from './units.js';
import { updateBuilding } from './buildings.js';
import { updateAI }       from './ai.js';
import { updateHUD, updatePanel, drawMinimap } from './ui.js';
import { updateCamera }   from './input.js';

// ── Map init ─────────────────────────────────────────────
function initMap() {
  const MID  = WORLD_H / 2;
  const pFac = config.playerFac;
  const aFac = config.aiFac;

  // ── Terrain: load map tile data, paint ground, place 3D objects ──
  initTerrain(MAP_GREAT_DIVIDE, getGroundMesh());

  // ── Player base (left side) ───────────────────────────
  const HQX = 26, HQZ = MID;
  spawnBuilding('hq', pFac, HQX, HQZ, true);

  spawnBuilding('housing', pFac, HQX - 10, HQZ - 10, true);
  spawnBuilding('housing', pFac, HQX - 10, HQZ,      true);
  spawnBuilding('housing', pFac, HQX - 10, HQZ + 10, true);
  spawnBuilding('housing', pFac, HQX,       HQZ - 14, true);
  spawnBuilding('housing', pFac, HQX,       HQZ + 14, true);
  spawnBuilding('housing', pFac, HQX + 10,  HQZ - 14, true);

  const startDump = spawnResource('dump', HQX + 20, HQZ, 2000);
  const w1 = spawnUnit('worker', pFac, HQX + 10, HQZ - 2);
  const w2 = spawnUnit('worker', pFac, HQX + 10, HQZ + 2);
  const w3 = spawnUnit('worker', pFac, HQX + 10, HQZ + 6);
  for (const w of [w1, w2, w3]) {
    if (w && startDump) { w.gatherTarget = startDump; w.state = 'gathering'; }
  }

  // ── AI base (right side) ──────────────────────────────
  const AIX = WORLD_W - 30, AIZ = MID;
  spawnBuilding('hq', aFac, AIX, AIZ, true);

  spawnBuilding('housing', aFac, AIX + 10, AIZ - 10, true);
  spawnBuilding('housing', aFac, AIX + 10, AIZ,      true);
  spawnBuilding('housing', aFac, AIX + 10, AIZ + 10, true);
  spawnBuilding('housing', aFac, AIX,       AIZ - 14, true);
  spawnBuilding('housing', aFac, AIX,       AIZ + 14, true);
  spawnBuilding('housing', aFac, AIX - 10,  AIZ + 14, true);

  // Gilded gather from Cafes; Scav AI uses dumps
  const aiStartStore = spawnResource(aFac === FAC.GILD ? 'cafe' : 'dump', AIX - 20, AIZ, 2000);
  // AI also gets a nearby dump so workers can gather scrap for unit production —
  // without scrap income the barracks can't train fast enough.
  const aiDump = spawnResource('dump', AIX - 24, AIZ + 12, 1500);
  const aiW1 = spawnUnit('worker', aFac, AIX - 10, AIZ - 3);
  const aiW2 = spawnUnit('worker', aFac, AIX - 10, AIZ + 3);
  for (const w of [aiW1, aiW2]) {
    if (w && aiStartStore) { w.gatherTarget = aiStartStore; w.state = 'gathering'; }
  }

  // ── Mid-map resource nodes ────────────────────────────
  spawnResource('dump',      HQX + 44,          MID - 28, 1500);
  spawnResource('dump',      HQX + 44,          MID + 28, 1500);
  spawnResource('dump',      WORLD_W * 0.40,    MID,      1800);
  spawnResource('dump',      WORLD_W * 0.40,    MID - 44, 1200);
  spawnResource('dump',      WORLD_W * 0.40,    MID + 44, 1200);
  spawnResource('dump',      30,                28,       1200);
  spawnResource('dump',      30,                WORLD_H - 28, 1200);
  // Contested Cafes in Gilded territory — Assistants naturally gather here,
  // but Scav workers can loot them too if they push far enough.
  spawnResource('cafe',      WORLD_W * 0.35,    MID - 20, 1200);
  spawnResource('cafe',      WORLD_W * 0.35,    MID + 20, 1200);
  spawnResource('cafe',      AIX - 44,          MID - 28, 1500);
  spawnResource('cafe',      AIX - 44,          MID + 28, 1500);

  // Camera on player HQ
  camera.position.set(HQX + 8, 100, HQZ + 60);
  camera.lookAt(HQX + 8, 0, HQZ);
}

// ── Game loop ─────────────────────────────────────────────
let _lastTime = 0;
let _hudTimer = 0;
let _mmTimer  = 0;

function loop(timestamp) {
  const dt  = Math.min((timestamp - _lastTime) / 1000, 0.1);
  _lastTime = timestamp;
  G.time    = timestamp / 1000;
  G.dt      = dt;

  if (!G.gameOver) {
    updateCamera(dt);
    for (const ent of G.entities) {
      if (ent.isUnit) updateUnit(ent, dt);
      if (ent.isBldg) updateBuilding(ent, dt);
    }
    G.entities = G.entities.filter(e => e.alive);
    updateAI(dt);
    updateParticles(dt);
    updateProjectiles(dt);
    tickHealthBars(G.entities);

    _hudTimer += dt;
    const hudRate = G.selection.length > 0 ? 0.08 : 0.25;
    if (_hudTimer > hudRate) {
      _hudTimer = 0;
      updateHUD();
      updatePanel();
    }
    _mmTimer += dt;
    if (_mmTimer > 0.4) { _mmTimer = 0; drawMinimap(); }
    _checkGameOver();
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function _checkGameOver() {
  if (G.gameOver) return;
  const pHQ = G.entities.find(e => e.alive && e.isBldg && e.subtype === 'hq' && e.faction === config.playerFac);
  const aHQ = G.entities.find(e => e.alive && e.isBldg && e.subtype === 'hq' && e.faction === config.aiFac);
  if (!pHQ) { G.gameOver = true; setTimeout(() => { alert('DEFEAT — Your base has fallen.'); location.reload(); }, 600); }
  if (!aHQ) { G.gameOver = true; setTimeout(() => { alert('VICTORY — Enemy HQ destroyed.'); location.reload(); }, 600); }
}

// ── Bootstrap — called by lobby when player clicks DEPLOY ──
export function startGame(chosenFac) {
  config.playerFac = chosenFac === FAC.GILD ? FAC.GILD : FAC.SCAV;
  config.aiFac     = chosenFac === FAC.GILD ? FAC.SCAV : FAC.GILD;
  document.getElementById('lobby').style.display = 'none';
  resizeRenderer();
  initMap();
  requestAnimationFrame(loop);
}

// Expose globally so lobby HTML can call it without module imports
window._startGame = startGame;
window._FAC       = FAC;

// Kick off the renderer (no game yet — lobby shows first)
resizeRenderer();
