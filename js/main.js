// ═══════════════════════════════════════════════════════════
// main.js — game init, loop, map setup
// Mirrors Warcraft's GameController + Map initialization
// ═══════════════════════════════════════════════════════════

import { FAC, WORLD_W, WORLD_H } from './constants.js';
import { config } from './config.js';
import { G } from './state.js';
import { renderer, camera, scene, resizeRenderer, updateParticles,
         updateProjectiles, tickHealthBars, tickTombstones, clearTombstones, getGroundMesh } from './renderer.js';
import { initTerrain } from './terrain.js';
import { initNavMesh } from './navmesh.js';
import { MAP_GREAT_DIVIDE } from '../maps/great-divide.js';
import { ALL_MAPS } from '../maps/index.js';
import { getMapResources } from '../maps/utils.js';
import { nearestTrashWithSalvage } from './terrain.js';
import { spawnUnit }      from './units.js';
import { spawnBuilding }  from './buildings.js';
import { spawnResource }  from './resources.js';
import { updateUnit }     from './units.js';
import { updateBuilding } from './buildings.js';
import { updateAI }       from './ai.js';
import { updateHUD, updatePanel, drawMinimap, setStatusBar } from './ui.js';
import { updateCamera }   from './input.js';

// ── Map init ─────────────────────────────────────────────
// Uses config.mapDef (set by lobby) or MAP_GREAT_DIVIDE. Supports 1–4 players:
// starts[0] = player, starts[1..] = AI. Each base gets HQ, housing, workers; resources from map preset.
function initMap() {
  clearTombstones();
  const mapDef = config.mapDef || MAP_GREAT_DIVIDE;
  const pFac   = config.playerFac;
  const aFac   = config.aiFac;
  const starts = mapDef.starts || [];
  // 1v1: spawn one base per faction (player + AI). For 4p later, use all starts.
  const toSpawn = [
    starts.find(s => s.faction === pFac),
    starts.find(s => s.faction === aFac),
  ].filter(Boolean);

  initTerrain(mapDef, getGroundMesh());
  initNavMesh(); // Nav mesh = this map’s terrain + buildings; NPCs/players path on it

  const resources = getMapResources(mapDef);
  for (const r of resources) {
    spawnResource(r.type, r.wx, r.wz, r.amount ?? 1800);
  }

  for (const start of toSpawn) {
    const { wx: HQX, wz: HQZ, faction } = start;
    const isPlayer = faction === pFac;
    const isAI    = faction === aFac;
    const fac     = faction;

    spawnBuilding('hq', fac, HQX, HQZ, true);

    const off = fac === FAC.GILD ? 10 : -10;
    spawnBuilding('housing', fac, HQX - 10, HQZ - 10, true);
    spawnBuilding('housing', fac, HQX - 10, HQZ,      true);
    spawnBuilding('housing', fac, HQX - 10, HQZ + 10, true);
    spawnBuilding('housing', fac, HQX,       HQZ - 14, true);
    spawnBuilding('housing', fac, HQX,       HQZ + 14, true);
    spawnBuilding('housing', fac, HQX + off, HQZ - 14, true);

    const workerCount = isAI ? 2 : 3;
    const dx = fac === FAC.GILD ? -10 : 10;
    const workers = [];
    for (let k = 0; k < workerCount; k++)
      workers.push(spawnUnit('worker', fac, HQX + dx, HQZ - 2 + k * 4));

    // New model: prefer digging TRASH (path to enemy); mines give more but still burn out
    const nearestTrash = nearestTrashWithSalvage(HQX, HQZ, 55);
    const nearestRes = G.entities
      .filter(e => e.alive && e.isRes && Math.hypot(e.x - HQX, e.z - HQZ) < 55)
      .sort((a, b) => Math.hypot(a.x - HQX, a.z - HQZ) - Math.hypot(b.x - HQX, b.z - HQZ))[0];
    for (const w of workers) {
      if (!w) continue;
      if (nearestTrash) {
        w.extractTarget = nearestTrash;
        w.state = 'extracting';
      } else if (nearestRes) {
        w.gatherTarget = nearestRes;
        w.state = 'gathering';
      }
    }
  }

  const playerStart = starts.find(s => s.faction === pFac) || starts[0];
  const camX = playerStart ? playerStart.wx + 8 : WORLD_W / 2;
  const camZ = playerStart ? playerStart.wz : WORLD_H / 2;
  camera.position.set(camX, 100, camZ + 60);
  camera.lookAt(camX, 0, camZ);

  // Obvious hint: Scrap comes from Dumps (orange pile). Right-click to gather.
  const scrapHint = pFac === FAC.SCAV
    ? 'Dig through <span>TRASH</span> for scrap & salvage — and a path to the enemy. Right-click TRASH or the orange Dump with workers.'
    : 'Dig through <span>TRASH</span> to open a path to the enemy. Right-click TRASH or Cafes with workers.';
  setStatusBar(scrapHint, true);
  setTimeout(() => setStatusBar('Select a unit or building...'), 7000);
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
    tickTombstones();

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
export function startGame(chosenFac, mapIndex = 0) {
  config.playerFac = chosenFac === FAC.GILD ? FAC.GILD : FAC.SCAV;
  config.aiFac     = chosenFac === FAC.GILD ? FAC.SCAV : FAC.GILD;
  config.mapDef    = (ALL_MAPS[mapIndex] != null) ? ALL_MAPS[mapIndex] : MAP_GREAT_DIVIDE;
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
