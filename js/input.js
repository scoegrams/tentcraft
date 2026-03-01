// ═══════════════════════════════════════════════════════════
// input.js — mouse, keyboard, selection, camera pan
// Mirrors Warcraft's InteractionHandler + GroupSelection
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { FAC, BLDG_DEFS, TILE, WORLD_W, WORLD_H } from './constants.js';
import { config } from './config.js';
import { G, canAfford, spend } from './state.js';
import { camera, canvas, scene, spawnParticles, addSelRing, removeSelRing,
         worldFromMouse, entityToScreen, resizeRenderer } from './renderer.js';
import { entityAtWorld, findNearest, findHQ, moveTo } from './world.js';
import { getTileType, nearestTrashWithSalvage, getTrashAmount } from './terrain.js';
import { updatePanel, hideBuildNotif, setStatusBar, triggerHotkey } from './ui.js';
import { sfxSelect, sfxMove, sfxError } from './sfx.js';
import { spawnBuilding } from './buildings.js';

// ── Zoom helpers (defined early so keydown can reference them) ──
const ZOOM_MIN = 25, ZOOM_MAX = 220;
function _applyZoom(factor) {
  const next = camera.right * factor;
  if (next < ZOOM_MIN || next > ZOOM_MAX) return;
  const aspect = (camera.right - camera.left) / (camera.top - camera.bottom);
  camera.left   = -next;
  camera.right  =  next;
  camera.top    =  next / aspect;
  camera.bottom = -next / aspect;
  camera.updateProjectionMatrix();
}
window._gameZoom = dir => _applyZoom(dir > 0 ? 0.88 : 1.14);

// ── Keyboard state ────────────────────────────────────────
export const keys = {};

document.addEventListener('keydown', e => {
  // Don't intercept when typing in a real input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  keys[e.key] = true;

  // ── Zoom ─────────────────────────────────────────────────
  if (e.key === '=' || e.key === '+') { _applyZoom(0.88); return; }
  if (e.key === '-' || e.key === '_') { _applyZoom(1.14); return; }

  // ── Escape: cancel build / deselect ─────────────────────
  if (e.key === 'Escape') {
    if (G.buildMode) { _cancelBuildMode(); return; }
    G.selection.forEach(en => { en.selected = false; removeSelRing(en); });
    G.selection = [];
    updatePanel();
    return;
  }

  // ── Ctrl+A: select all player units ─────────────────────
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    G.selection.forEach(en => { en.selected = false; removeSelRing(en); });
    G.selection = G.entities.filter(en =>
      en.alive && en.isUnit && en.faction === config.playerFac
    );
    G.selection.forEach(en => { en.selected = true; addSelRing(en); });
    updatePanel();
    sfxSelect();
    return;
  }

  // ── Space: stop all selected units ──────────────────────
  if (e.key === ' ') {
    e.preventDefault();
    G.selection.forEach(en => {
      if (en.alive && en.isUnit) {
        en.state = 'idle'; en.targetEnt = null; en.targetX = null;
        en._path = null;
      }
    });
    setStatusBar('Stop.', true);
    return;
  }

  // ── F2/F3/F4: camera jump to base / AI base / center ────
  if (e.key === 'F2') {
    const hq = G.entities.find(en => en.alive && en.isBldg && en.subtype === 'hq' && en.faction === config.playerFac);
    if (hq) { camera.position.x = hq.x; camera.position.z = hq.z; }
    setStatusBar('Camera → Your Base', true);
    return;
  }
  if (e.key === 'F3') {
    const hq = G.entities.find(en => en.alive && en.isBldg && en.subtype === 'hq' && en.faction !== config.playerFac && en.faction !== 'neutral');
    if (hq) { camera.position.x = hq.x; camera.position.z = hq.z; }
    setStatusBar('Camera → Enemy Base', true);
    return;
  }
  if (e.key === 'F4') {
    const { WORLD_W: ww, WORLD_H: wh } = { WORLD_W: 240, WORLD_H: 240 };
    camera.position.x = ww / 2; camera.position.z = wh / 2;
    setStatusBar('Camera → Center', true);
    return;
  }

  // ── ? / H: toggle hotkey library ────────────────────────
  if (e.key === '?' || (e.key === 'h' && !e.ctrlKey)) {
    const lib = document.getElementById('hotkey-lib');
    if (lib) lib.classList.toggle('open');
    return;
  }

  // ── Command card hotkeys (forwarded to ui.js) ────────────
  // Only fire when there's a selection and no modifier keys
  if (!e.ctrlKey && !e.metaKey && !e.altKey && G.selection.length > 0) {
    triggerHotkey(e.key.toUpperCase());
  }
});

document.addEventListener('keyup', e => { keys[e.key] = false; });

// ── Mouse tracking ────────────────────────────────────────
// _mouseInCanvas: only true while pointer is inside the game viewport.
// Edge scroll must NEVER fire when the mouse is outside — this is
// the Warcraft rule and also fixes Mac trackpad drift.
let _mouseInCanvas = false;

// Raw canvas-relative mouse position (null = unknown, no scroll)
let _canvasMx = null;
let _canvasMy = null;

// Middle-mouse pan state
let _mmPanning  = false;
let _mmLastX    = 0;
let _mmLastY    = 0;

canvas.addEventListener('mouseenter', () => { _mouseInCanvas = true; });
canvas.addEventListener('mouseleave', () => {
  _mouseInCanvas = false;
  _canvasMx = null;
  _canvasMy = null;
  _mmPanning = false;
});

function _cancelBuildMode() {
  G.buildMode = null;
  if (G.buildGhost) { scene.remove(G.buildGhost); G.buildGhost = null; }
  hideBuildNotif();
}

// ── Selection box ─────────────────────────────────────────
const selBox = document.getElementById('selbox');

// ── Mouse down ────────────────────────────────────────────
canvas.addEventListener('mousedown', e => {
  if (G.gameOver) return;

  // Middle mouse — start camera pan
  if (e.button === 1) {
    e.preventDefault();
    _mmPanning = true;
    _mmLastX   = e.clientX;
    _mmLastY   = e.clientY;
    canvas.style.cursor = 'grabbing';
    return;
  }

  const wp = worldFromMouse(e.clientX, e.clientY);

  // ── Left click ────────────────────────────────────────
  if (e.button === 0) {
    // Place building
    if (G.buildMode) {
      const bType = G.buildMode;
      const bdef  = BLDG_DEFS[bType];
      if (bdef && !canAfford(config.playerFac, bdef.cost)) { sfxError(); return; }
      if (bdef && canAfford(config.playerFac, bdef.cost)) {
        spend(config.playerFac, bdef.cost);
        const bldg = spawnBuilding(bType, config.playerFac, wp.x, wp.z);
        const worker = findNearest(
          { x: wp.x, z: wp.z },
          o => o.alive && o.isUnit && o.subtype === 'worker' && o.faction === config.playerFac && o.state === 'idle',
          80
        );
        if (worker && bldg) { worker.targetEnt = bldg; worker.state = 'build'; }
        _cancelBuildMode();
        updatePanel();
      }
      return;
    }

    // Start drag selection
    G.isDragging   = true;
    G.dragStart    = { x: e.clientX, y: e.clientY };
    G.dragCurrent  = { x: e.clientX, y: e.clientY };

    G.selection.forEach(ent => { ent.selected = false; removeSelRing(ent); });
    G.selection = [];
  }

  // ── Right click — issue orders ────────────────────────
  if (e.button === 2) {
    e.preventDefault();
    const clicked = entityAtWorld(wp.x, wp.z);

    // Detect TRASH tile under cursor (no entity hit) for Salvage extraction
    const T_TRASH = 4;
    const clickTx = Math.floor(wp.x / TILE), clickTz = Math.floor(wp.z / TILE);
    const tileUnder = !clicked ? getTileType(clickTx, clickTz) : -1;
    const clickedTrash = tileUnder === T_TRASH;

    for (const ent of G.selection) {
      if (!ent.alive || ent.faction !== config.playerFac || !ent.isUnit) continue;

      // Pre-compute a spread destination for this unit
      const sx = wp.x + (Math.random() * 2.5 - 1.25);
      const sz = wp.z + (Math.random() * 2.5 - 1.25);

      if (clicked) {
        if (clicked.faction === config.aiFac) {
          ent.targetEnt = clicked;
          ent.state     = 'attacking';
          moveTo(ent, clicked.x, clicked.z);
        } else if (clicked.isRes && ent.subtype === 'worker') {
          ent.gatherTarget = clicked;
          ent.state        = 'gathering';
          moveTo(ent, clicked.x, clicked.z);
        } else if (clicked.isBldg && clicked.isBuilding && clicked.faction === config.playerFac && ent.subtype === 'worker') {
          ent.targetEnt = clicked;
          ent.state     = 'build';
          moveTo(ent, clicked.x, clicked.z);
        } else {
          ent.targetX = sx; ent.targetZ = sz; ent.state = 'move'; ent.targetEnt = null;
          moveTo(ent, sx, sz);
        }
      } else if (clickedTrash && ent.subtype === 'worker' && ent.faction === config.playerFac) {
        // Workers clear TRASH → get scrap or salvage (2:1), path clears
        const target = getTrashAmount(clickTx, clickTz) > 0
          ? { tx: clickTx, tz: clickTz, wx: clickTx * TILE + TILE / 2, wz: clickTz * TILE + TILE / 2 }
          : nearestTrashWithSalvage(wp.x, wp.z, 20);
        if (target) {
          ent.extractTarget  = target;
          ent._extractReady  = false;
          ent._extractTimer  = 0;
          ent.state          = 'extracting';
          ent.targetEnt      = null;
          moveTo(ent, target.wx, target.wz);
          spawnParticles(wp.x, 0.5, wp.z, 0xd4aa20, 6);
        }
      } else {
        ent.targetX = sx; ent.targetZ = sz; ent.state = 'move'; ent.targetEnt = null;
        moveTo(ent, sx, sz);
      }
    }
    spawnParticles(wp.x, 0.5, wp.z, 0x22c55e, 5);
    if (G.selection.some(e => e.isUnit)) sfxMove();
  }
});

// ── Mouse move ────────────────────────────────────────────
canvas.addEventListener('mousemove', e => {
  // Track canvas-relative position for edge scroll
  const rect = canvas.getBoundingClientRect();
  _canvasMx  = e.clientX - rect.left;
  _canvasMy  = e.clientY - rect.top;

  // Middle-mouse camera pan
  if (_mmPanning) {
    const dx = e.clientX - _mmLastX;
    const dy = e.clientY - _mmLastY;
    _mmLastX  = e.clientX;
    _mmLastY  = e.clientY;
    // Scale pan to world units based on current zoom
    const zoom = camera.right - camera.left;
    const scaleX = zoom / rect.width;
    const scaleZ = zoom / rect.width;
    camera.position.x -= dx * scaleX;
    camera.position.z -= dy * scaleZ;
    return;
  }

  const wp = worldFromMouse(e.clientX, e.clientY);
  G.mouseWorld.x = wp.x; G.mouseWorld.z = wp.z;
  G.dragCurrent  = { x: e.clientX, y: e.clientY };

  if (G.isDragging) {
    const sx = Math.min(G.dragStart.x, e.clientX);
    const sy = Math.min(G.dragStart.y, e.clientY);
    const sw = Math.abs(G.dragStart.x - e.clientX);
    const sh = Math.abs(G.dragStart.y - e.clientY);
    selBox.style.cssText = `display:block;left:${sx}px;top:${sy}px;width:${sw}px;height:${sh}px`;
  }

  // Build ghost follows cursor
  if (G.buildMode) {
    if (!G.buildGhost) {
      const def = BLDG_DEFS[G.buildMode];
      if (def) {
        const s   = def.size * TILE;
        const geo = new THREE.BoxGeometry(s - 0.4, 2, s - 0.4);
        const mat = new THREE.MeshLambertMaterial({ color: 0x22c55e, transparent: true, opacity: 0.35 });
        G.buildGhost = new THREE.Mesh(geo, mat);
        scene.add(G.buildGhost);
      }
    }
    if (G.buildGhost && wp.x !== undefined) {
      G.buildGhost.position.set(wp.x, 1, wp.z);
    }
  }
});

// ── Mouse up ─────────────────────────────────────────────
canvas.addEventListener('mouseup', e => {
  // End middle-mouse pan
  if (e.button === 1) {
    _mmPanning = false;
    canvas.style.cursor = '';
    return;
  }
  if (e.button !== 0 || !G.isDragging) return;
  G.isDragging = false;
  selBox.style.display = 'none';

  const minSX  = Math.min(G.dragStart.x, G.dragCurrent.x);
  const maxSX  = Math.max(G.dragStart.x, G.dragCurrent.x);
  const minSY  = Math.min(G.dragStart.y, G.dragCurrent.y);
  const maxSY  = Math.max(G.dragStart.y, G.dragCurrent.y);
  const isClick = (maxSX - minSX < 6) && (maxSY - minSY < 6);

  G.selection = [];

  for (const ent of G.entities) {
    if (!ent.alive || !ent.mesh) continue;

    const { x: sx, y: sy } = entityToScreen(ent);
    let hit = false;

    if (isClick) {
      hit = Math.hypot(sx - G.dragStart.x, sy - G.dragStart.y) < 22;
    } else {
      hit = sx >= minSX && sx <= maxSX && sy >= minSY && sy <= maxSY;
      // Box select only mobile units (not HQ)
      if (hit && ent.isBldg && ent.subtype === 'hq') hit = false;
    }

    const selectable = ent.faction === config.playerFac || (isClick && ent.isRes);
    if (hit && selectable) {
      ent.selected = true;
      addSelRing(ent);
      G.selection.push(ent);
    }
  }

  // Fallback: single click on HQ
  if (G.selection.length === 0 && isClick) {
    const hq = findHQ(config.playerFac);
    if (hq) {
      const { x: sx, y: sy } = entityToScreen(hq);
      if (Math.hypot(sx - G.dragStart.x, sy - G.dragStart.y) < 28) {
        hq.selected = true; addSelRing(hq); G.selection.push(hq);
      }
    }
  }

  if (G.selection.length > 0) sfxSelect();
  updatePanel();
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

// ── Mouse wheel / trackpad pinch ─────────────────────────
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  _applyZoom(e.deltaY > 0 ? 1.07 : 0.94);
}, { passive: false });

// ── Camera WASD / arrow key pan + edge scroll ─────────────
const CAM_SPEED = 45;
const EDGE_PX   = 24;   // pixels from canvas edge that trigger scroll
const EDGE_MULT = 0.55; // edge scroll speed multiplier

export function updateCamera(dt) {
  // ── Keyboard pan (always works) ──────────────────────
  if (keys['ArrowLeft']  || keys['a']) camera.position.x -= CAM_SPEED * dt;
  if (keys['ArrowRight'] || keys['d']) camera.position.x += CAM_SPEED * dt;
  if (keys['ArrowUp']    || keys['w']) camera.position.z -= CAM_SPEED * dt;
  if (keys['ArrowDown']  || keys['s']) camera.position.z += CAM_SPEED * dt;

  // ── Edge scroll — ONLY when mouse is tracked inside canvas ──
  // This prevents the "wandering camera" on Mac where stale
  // coordinates or trackpad events cause constant drift.
  if (_mouseInCanvas && _canvasMx !== null && _canvasMy !== null) {
    const rect = canvas.getBoundingClientRect();
    const w    = rect.width;
    const h    = rect.height;

    // Smooth scroll: faster the closer to the edge
    const leftRatio   = Math.max(0, 1 - _canvasMx / EDGE_PX);
    const rightRatio  = Math.max(0, 1 - (w - _canvasMx) / EDGE_PX);
    const topRatio    = Math.max(0, 1 - _canvasMy / EDGE_PX);
    const bottomRatio = Math.max(0, 1 - (h - _canvasMy) / EDGE_PX);

    camera.position.x -= leftRatio   * CAM_SPEED * EDGE_MULT * dt;
    camera.position.x += rightRatio  * CAM_SPEED * EDGE_MULT * dt;
    camera.position.z -= topRatio    * CAM_SPEED * EDGE_MULT * dt;
    camera.position.z += bottomRatio * CAM_SPEED * EDGE_MULT * dt;
  }

  // ── World bounds clamp ───────────────────────────────
  camera.position.x = Math.max(-10, Math.min(WORLD_W + 10, camera.position.x));
  camera.position.z = Math.max(-10, Math.min(WORLD_H + 70, camera.position.z));

  camera.lookAt(camera.position.x, 0, camera.position.z - 60);
}

// ── Resize ────────────────────────────────────────────────
window.addEventListener('resize', () => {
  resizeRenderer();
});
