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
import { entityAtWorld, findNearest, findHQ } from './world.js';
import { updatePanel, hideBuildNotif, setStatusBar } from './ui.js';
import { sfxSelect, sfxMove, sfxError } from './sfx.js';
import { spawnBuilding } from './buildings.js';

// ── Keyboard state ────────────────────────────────────────
export const keys = {};
document.addEventListener('keydown', e => {
  keys[e.key] = true;
  if (e.key === 'Escape') _cancelBuildMode();
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

    for (const ent of G.selection) {
      if (!ent.alive || ent.faction !== config.playerFac || !ent.isUnit) continue;

      if (clicked) {
        if (clicked.faction === config.aiFac) {
          ent.targetEnt = clicked;
          ent.state     = 'attacking';
        } else if (clicked.isRes && ent.subtype === 'worker') {
          ent.gatherTarget = clicked;
          ent.state        = 'gathering';
        } else if (clicked.isBldg && clicked.isBuilding && clicked.faction === config.playerFac && ent.subtype === 'worker') {
          ent.targetEnt = clicked;
          ent.state     = 'build';
        } else {
          // Right-click friendly = move there
          ent.targetX  = wp.x + (Math.random() * 2.5 - 1.25);
          ent.targetZ  = wp.z + (Math.random() * 2.5 - 1.25);
          ent.state    = 'move';
          ent.targetEnt = null;
        }
      } else {
        ent.targetX  = wp.x + (Math.random() * 2.5 - 1.25);
        ent.targetZ  = wp.z + (Math.random() * 2.5 - 1.25);
        ent.state    = 'move';
        ent.targetEnt = null;
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
// On Mac: two-finger scroll = pan, pinch (ctrlKey+wheel) = zoom
canvas.addEventListener('wheel', e => {
  e.preventDefault();

  if (e.ctrlKey) {
    // Mac pinch-to-zoom or Ctrl+scroll = zoom
    const z = e.deltaY > 0 ? 1.08 : 0.93;
    camera.left   *= z; camera.right  *= z;
    camera.top    *= z; camera.bottom *= z;
    camera.updateProjectionMatrix();
  } else {
    // Plain scroll = zoom (Windows mouse wheel, or Mac scroll wheel)
    const z = e.deltaY > 0 ? 1.07 : 0.94;
    camera.left   *= z; camera.right  *= z;
    camera.top    *= z; camera.bottom *= z;
    camera.updateProjectionMatrix();
  }
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
