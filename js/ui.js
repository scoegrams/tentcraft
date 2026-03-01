// ═══════════════════════════════════════════════════════════
// ui.js — HUD, portrait panel, command card (3×3), minimap
// Mirrors Warcraft's StatusPane + GameButton + Minimap classes
// ═══════════════════════════════════════════════════════════

import {
  FAC, BLDG_DEFS, UNIT_DEFS, PORTRAITS, getUnitCost,
  CMD_BY_UNIT, CMD_WORKER, CMD_WORKER_GILD,
  UNIT_DESCS, UNIT_DESCS_GILD, WORLD_W, WORLD_H,
} from './constants.js';
import { config } from './config.js';
import { G, canAfford, spend } from './state.js';
import { addSelRing, removeSelRing, camera, canvas } from './renderer.js';
import { findHQ } from './world.js';
import { spawnBuilding } from './buildings.js';
import { spawnUnit }     from './units.js';
import { findNearest }   from './world.js';

// ── DOM refs ─────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const elScrap  = $('r-scrap');
const elSalv   = $('r-salv');
const elPop    = $('r-pop');
const elWave   = $('r-wave');

const elStatusText  = $('statusbar-text');
const elBuildNotif  = $('build-notif');

const elPaneSingle  = $('pane-single');
const elPaneGroup   = $('pane-group');
const elPortFrame   = $('portrait-frame');
const elPortBg      = $('portrait-bg');
const elPortIcon    = $('portrait-icon');
const elUnitName    = $('unit-name');

const elBarHp       = $('bar-hp');
const elValHp       = $('val-hp');
const elRowMp       = $('row-mp');
const elBarMp       = $('bar-mp');
const elValMp       = $('val-mp');
const elRowProd     = $('row-prod');
const elBarProd     = $('bar-prod');
const elValProd     = $('val-prod');

const elSAtk   = $('s-atk');
const elSRng   = $('s-rng');
const elSState = $('s-state');
// s-arm, s-spd, s-pop fetched inline (added in redesign)
const elDesc   = $('pane-desc');

// 9 command buttons
const cmdBtns = Array.from({length: 9}, (_, i) => $(`cmd-${i}`));

// ── Status bar ────────────────────────────────────────────
let _statusTimeout = null;
export function setStatusBar(html, timed = false) {
  elStatusText.innerHTML = html;
  if (timed) {
    clearTimeout(_statusTimeout);
    _statusTimeout = setTimeout(() =>
      elStatusText.textContent = 'Select a unit or building...', 3500);
  }
}

// ── Resource HUD ─────────────────────────────────────────
export function updateHUD() {
  elScrap.textContent = Math.floor(G.player.scrap);
  elSalv.textContent  = Math.floor(G.player.salvage);
  elPop.textContent   = `${G.player.pop} / ${G.player.popCap}`;
  elWave.textContent  = G.ai.waveSize;
}

// ── Build mode notification ───────────────────────────────
export function showBuildNotif(bType) {
  const def = BLDG_DEFS[bType];
  elBuildNotif.innerHTML =
    `⚒ PLACE <span>${def.label[0].toUpperCase()}</span> &nbsp;|&nbsp; <span style="color:#ffd070">[ESC]</span> Cancel`;
  elBuildNotif.style.display = 'block';
}
export function hideBuildNotif() {
  elBuildNotif.style.display = 'none';
}

// ── Prerequisite check ───────────────────────────────────
// Returns null if OK, or a string "Requires: X" if locked.
function _prerequisiteMsg(action) {
  if (!action?.startsWith('build:')) return null;
  const bType = action.split(':')[1];
  const bd    = BLDG_DEFS[bType];
  if (!bd?.requires?.length) return null;

  for (const req of bd.requires) {
    const has = G.entities.some(e =>
      e.alive && e.isBldg &&
      e.subtype === req &&
      e.faction === config.playerFac &&
      !e.isBuilding    // must be fully built
    );
    if (!has) {
      const reqDef = BLDG_DEFS[req];
      const label  = reqDef ? reqDef.label[config.playerFac === FAC.GILD ? 1 : 0] : req;
      return `Requires: ${label}`;
    }
  }
  return null;
}

// ── Command card (3×3 grid) ───────────────────────────────
function fillCmdCard(cmds, ent) {
  cmdBtns.forEach((btn, i) => {
    const def = cmds?.[i] ?? null;

    // Reset btn
    btn.className    = 'cmd-btn';
    btn.disabled     = false;
    btn.onclick      = null;
    btn.onmouseenter = null;
    btn.onmouseleave = null;
    btn.querySelector('.hotkey').textContent    = '';
    btn.querySelector('.cmd-icon').textContent  = '';
    btn.querySelector('.cmd-label').textContent = '';
    const oldCost = btn.querySelector('.cmd-cost');
    if (oldCost) oldCost.remove();

    if (!def) { btn.classList.add('cmd-empty'); return; }

    if (ent?.faction === config.aiFac) btn.classList.add('gilded-style');
    if (def.cls) btn.classList.add(def.cls);

    btn.querySelector('.hotkey').textContent    = def.key   || '';
    btn.querySelector('.cmd-icon').textContent  = def.icon  || '';
    btn.querySelector('.cmd-label').textContent = def.label || '';

    if (def.cost) {
      const cs = document.createElement('span');
      cs.className   = 'cmd-cost';
      cs.textContent = `${def.cost[0]}♻ ${def.cost[1]}⚙`;
      btn.appendChild(cs);
    }

    // Check prerequisites — show lock before checking affordability
    const prereqMsg = _prerequisiteMsg(def.action);
    if (prereqMsg) {
      btn.classList.add('cmd-locked');
      btn.disabled = true;
      btn.onmouseenter = () => setStatusBar(
        `<span style="color:#e04040">${def.label}</span> — 🔒 ${prereqMsg}`
      );
      btn.onmouseleave = () => setStatusBar('Select a unit or building...');
      return;
    }

    // Disable if can't afford or pop-capped
    const ok    = def.cost ? canAfford(config.playerFac, def.cost) : true;
    const popOk = def.action?.startsWith('train:') ? G.player.pop < G.player.popCap : true;
    btn.disabled = !ok || !popOk;

    const statusMsg = () => {
      const desc = _actionDesc(def.action, def.cost);
      const warn = !ok ? ' <span style="color:#e04040">— Can\'t afford</span>'
                 : !popOk ? ' <span style="color:#e04040">— Pop cap reached</span>' : '';
      return `<span>${def.label}</span> — ${desc}${warn}`;
    };

    btn.onmouseenter = () => setStatusBar(statusMsg());
    btn.onmouseleave = () => setStatusBar('Select a unit or building...');
    btn.onclick      = () => _handleCmd(def, ent);
  });
}

function _actionDesc(action, cost) {
  if (!action) return '';
  if (action.startsWith('train:')) {
    return cost ? `Train unit — <span style="color:#e8c060">${cost[0]}♻ ${cost[1]}⚙</span>` : 'Train unit';
  }
  if (action.startsWith('build:')) {
    const bType = action.split(':')[1];
    const bd    = BLDG_DEFS[bType];
    if (!bd) return '';
    const req = bd.requires?.length ? ` | Needs: ${bd.requires.map(r => BLDG_DEFS[r]?.label[0] ?? r).join(', ')}` : '';
    return `Build — <span style="color:#e8c060">${bd.cost[0]}♻ ${bd.cost[1]}⚙</span>${req}`;
  }
  return {
    'stop':         'Stop current action',
    'attack-move':  'Attack-move — right-click enemy to attack',
    'move':         'Move — right-click to move',
    'cancel-prod':  'Cancel current production',
  }[action] || action;
}

function _handleCmd(def, ent) {
  const action = def.action;
  if (!action) return;

  if (action.startsWith('train:')) {
    const ut   = action.split(':')[1];
    const udef = UNIT_DEFS[ut];
    const cost = getUnitCost(ut, config.playerFac);
    if (!ent || !canAfford(config.playerFac, cost) || G.player.pop >= G.player.popCap) return;
    spend(config.playerFac, cost);
    ent.prodQueue.push(ut);
    setStatusBar(`<span>Training ${udef.label[0]}...</span>`, true);
    updatePanel();
    return;
  }

  if (action.startsWith('build:')) {
    const bType = action.split(':')[1];
    if (!canAfford(config.playerFac, BLDG_DEFS[bType].cost)) return;
    G.buildMode = bType;
    showBuildNotif(bType);
    setStatusBar(`<span>Build mode</span> — Click on the map to place`);
    return;
  }

  if (action === 'stop') {
    G.selection.forEach(e => {
      if (e.alive && e.isUnit) { e.state = 'idle'; e.targetEnt = null; e.targetX = null; }
    });
    return;
  }

  if (action === 'cancel-prod' && ent) {
    ent.prodQueue.shift();
    updatePanel();
    return;
  }
}

// ── Building command card (production) ───────────────────
function _buildingCmds(ent) {
  const def  = BLDG_DEFS[ent.subtype];
  if (!def?.produces?.length) return Array(9).fill(null);

  const ICONS = { worker:'🧱', infantry:'⚔️', ranged:'🏹', heavy:'🔨', siege:'🔥', caster:'☠️' };
  const KEYS  = { worker:'W', infantry:'I', ranged:'R', heavy:'H', siege:'F', caster:'C' };

  const cmds = Array(9).fill(null);
  def.produces.forEach((ut, i) => {
    const udef = UNIT_DEFS[ut];
    cmds[i] = {
      icon: ICONS[ut] || '?', label: udef.label[0],
      key: KEYS[ut]   || '?', cost: getUnitCost(ut, ent.faction),
      action: `train:${ut}`,
    };
  });

  if (ent.prodQueue.length > 0) {
    cmds[8] = { icon:'⛔', label:'Cancel', key:'ESC', action:'cancel-prod', cls:'cmd-cancel' };
  }
  return cmds;
}

// ── Portrait update (mirrors SingleStatusPane) ────────────
function _updatePortrait(ent) {
  const p      = ent.portrait();
  const isGild = ent.faction === config.aiFac;

  elPortIcon.textContent = p.icon;
  elPortBg.style.background = `linear-gradient(135deg,${p.col} 0%,#080604 100%)`;
  elPortFrame.className  = isGild ? 'gilded' : '';
  elUnitName.className   = isGild ? 'gilded' : '';
  elUnitName.textContent = ent.label().toUpperCase();

  // State badge under portrait — colour-coded like SC
  const badge = document.getElementById('portrait-badge');
  if (badge) {
    const st = ent.state || 'idle';
    badge.textContent = st.toUpperCase();
    badge.className   = `st-${st.replace('-return','').replace('extract-','extract')}`;
  }

  // HP bar
  const hpPct = ent.hp / ent.maxHp;
  elBarHp.style.width = (hpPct * 100) + '%';
  elBarHp.className   = 'bar-fill ' + (hpPct > 0.66 ? 'hp-high' : hpPct > 0.33 ? 'hp-med' : 'hp-low');
  elValHp.textContent = `${ent.hp} / ${ent.maxHp}`;

  // Resource remaining (nodes)
  if (ent.isRes) {
    elRowMp.style.display = 'flex';
    const rPct = ent.hp / ent.maxHp;
    elBarMp.style.width   = (rPct * 100) + '%';
    elValMp.textContent   = `${ent.hp} left`;
  } else {
    elRowMp.style.display = 'none';
  }

  // Production progress (buildings)
  if (ent.isBldg && ent.prodQueue.length > 0 && ent.prodMax > 0) {
    elRowProd.style.display = 'flex';
    const pPct = ent.prodTimer / ent.prodMax;
    elBarProd.style.width   = (pPct * 100) + '%';
    elValProd.textContent   = `Q:${ent.prodQueue.length}`;
  } else {
    elRowProd.style.display = 'none';
  }

  // 2×3 stat grid
  const elArm = $('s-arm'), elSpd = $('s-spd'), elPop = $('s-pop');
  elSAtk.textContent  = ent.atk    ? `${ent.atk}` : '—';
  elSRng.textContent  = ent.atkRange > 2 ? `${ent.atkRange.toFixed(0)}` : 'MEL';
  elSState.textContent = (ent.state || '—').toUpperCase();
  if (elArm) elArm.textContent = ent.armor != null ? `${ent.armor}` : '0';
  if (elSpd) elSpd.textContent = ent.speed ? `${ent.speed.toFixed(1)}` : '—';
  if (elPop) {
    const uDef = UNIT_DEFS[ent.subtype];
    elPop.textContent = uDef ? `${uDef.pop}` : '—';
  }

  // Description
  const descTable = ent.faction === FAC.GILD ? UNIT_DESCS_GILD : UNIT_DESCS;
  elDesc.textContent = descTable[ent.subtype] || UNIT_DESCS[ent.subtype] || '';
}

// ── Group pane (multiple selection) ──────────────────────
function _showGroupPane(sel) {
  elPaneSingle.style.display = 'none';
  elPaneGroup.style.display  = 'flex';
  elPaneGroup.innerHTML      = '';
  elUnitName.textContent     = `${sel.length} UNITS SELECTED`;
  elUnitName.className       = '';

  sel.forEach(ent => {
    const hpPct  = ent.hp / ent.maxHp;
    const hpCol  = hpPct > 0.66 ? '#22c55e' : hpPct > 0.33 ? '#eab308' : '#ef4444';

    const thumb = document.createElement('div');
    thumb.className = 'group-thumb' + (ent.faction === config.aiFac ? ' gilded' : '');
    thumb.title = `${ent.label()} — ${ent.hp}/${ent.maxHp} HP`;

    // Icon
    const icon = document.createElement('div');
    icon.className   = 'group-thumb-icon';
    icon.textContent = ent.portrait().icon;

    // HP text overlay
    const hpTxt = document.createElement('div');
    hpTxt.className   = 'group-hp-text';
    hpTxt.textContent = ent.hp;

    // HP bar strip at bottom
    const hpWrap = document.createElement('div');
    hpWrap.className = 'group-hp-wrap';
    const hpFill = document.createElement('div');
    hpFill.className = 'group-hp-fill';
    hpFill.style.cssText = `width:${hpPct * 100}%; background:${hpCol};`;
    hpWrap.appendChild(hpFill);

    thumb.appendChild(icon);
    thumb.appendChild(hpTxt);
    thumb.appendChild(hpWrap);

    thumb.onclick = () => {
      G.selection.forEach(e => { e.selected = false; removeSelRing(e); });
      G.selection = [ent];
      ent.selected = true; addSelRing(ent);
      updatePanel();
    };
    elPaneGroup.appendChild(thumb);
  });

  // Shared combat commands for group
  fillCmdCard([
    { icon:'⚔️', label:'Attack', key:'A', action:'attack-move' },
    { icon:'🚶', label:'Move',   key:'M', action:'move' },
    null, null, null, null, null, null,
    { icon:'⛔', label:'Stop',   key:'S', action:'stop', cls:'cmd-cancel' },
  ], sel[0]);
}

// ── Main panel update (called each tick + on selection change) ─
export function updatePanel() {
  const sel = G.selection.filter(e => e.alive);

  if (sel.length === 0) {
    elPaneSingle.style.display = 'flex';
    elPaneGroup.style.display  = 'none';
    elPortIcon.textContent     = '⛺';
    elPortBg.style.background  = 'linear-gradient(135deg,#1c1208,#080604)';
    elPortFrame.className      = '';
    elUnitName.textContent     = '— NOTHING SELECTED —';
    elUnitName.className       = '';
    elBarHp.style.width = '0%';
    elValHp.textContent = '';
    elRowMp.style.display   = 'none';
    elRowProd.style.display = 'none';
    elSAtk.textContent = '—'; elSRng.textContent = '—'; elSState.textContent = '—';
    elDesc.textContent = '';
    fillCmdCard(Array(9).fill(null), null);
    return;
  }

  if (sel.length > 1) {
    _showGroupPane(sel);
    return;
  }

  const ent = sel[0];
  elPaneSingle.style.display = 'flex';
  elPaneGroup.style.display  = 'none';
  _updatePortrait(ent);

  // Fill command card based on entity type
  if (ent.isUnit && ent.faction === config.playerFac) {
    // Gilded workers get a corporate-flavored build menu; Scav workers get the scrappy one
    const useGildCard = ent.subtype === 'worker' && ent.faction === FAC.GILD;
    const card = useGildCard ? CMD_WORKER_GILD : (CMD_BY_UNIT[ent.subtype] || Array(9).fill(null));
    fillCmdCard(card, ent);
  } else if (ent.isBldg && ent.faction === config.playerFac && !ent.isBuilding) {
    fillCmdCard(_buildingCmds(ent), ent);
  } else if (ent.isBldg && ent.isBuilding) {
    const c = Array(9).fill(null);
    c[4] = { icon:'🔨', label:'Building', key:'—', action: null };
    fillCmdCard(c, ent);
  } else {
    fillCmdCard(Array(9).fill(null), ent);
  }
}

// ── Minimap ───────────────────────────────────────────────
// Mirrors Warcraft's Minimap class — two-layer texture approach
const mmCanvas = $('minimap');
const mctx     = mmCanvas.getContext('2d');
const MM_W     = mmCanvas.width;
const MM_H     = mmCanvas.height;

export function drawMinimap() {
  const sx = MM_W / WORLD_W;
  const sz = MM_H / WORLD_H;

  // Terrain zones
  mctx.fillStyle = '#080604';
  mctx.fillRect(0, 0, MM_W, MM_H);
  mctx.fillStyle = 'rgba(60,30,10,.35)';
  mctx.fillRect(0, 0, WORLD_W * 0.65 * sx, MM_H);
  mctx.fillStyle = 'rgba(10,30,60,.35)';
  mctx.fillRect(WORLD_W * 0.65 * sx, 0, MM_W, MM_H);

  // Perimeter line
  mctx.strokeStyle = '#7c3aed';
  mctx.lineWidth   = 1;
  mctx.beginPath();
  mctx.moveTo(WORLD_W * 0.65 * sx, 0);
  mctx.lineTo(WORLD_W * 0.65 * sx, MM_H);
  mctx.stroke();

  // Entities (mirrors Minimap.ColorBuildings / ColorUnits)
  for (const ent of G.entities) {
    if (!ent.alive || !ent.mesh) continue;
    const mx = ent.x * sx;
    const mz = ent.z * sz;

    if (ent.isRes) {
      mctx.fillStyle = '#6b7280';
      mctx.fillRect(mx - 1.5, mz - 1.5, 3, 3);
    } else if (ent.faction === config.playerFac) {
      mctx.fillStyle = '#ea580c';
      ent.isBldg
        ? mctx.fillRect(mx - 2.5, mz - 2.5, 5, 5)
        : mctx.fillRect(mx - 1,   mz - 1,   2, 2);
    } else if (ent.faction === config.aiFac) {
      mctx.fillStyle = '#60a5fa';
      ent.isBldg
        ? mctx.fillRect(mx - 2.5, mz - 2.5, 5, 5)
        : mctx.fillRect(mx - 1,   mz - 1,   2, 2);
    }
  }

  // Camera viewport rectangle (mirrors Minimap.DrawRectangle)
  const rect  = canvas.getBoundingClientRect();
  const cL    = Math.max(0, (camera.position.x + camera.left)   * sx);
  const cR    = Math.min(MM_W, (camera.position.x + camera.right)  * sx);
  const cT    = Math.max(0, (camera.position.z - 60 + camera.bottom) * sz);
  const cB    = Math.min(MM_H, (camera.position.z - 60 + camera.top) * sz);
  mctx.strokeStyle = 'rgba(200,180,120,.75)';
  mctx.lineWidth   = 1;
  mctx.strokeRect(cL, cT, cR - cL, cB - cT);
}

// ── Hotkey dispatch ───────────────────────────────────────
// Called from input.js keydown with the pressed key (uppercase).
// Scans the currently-visible command card for a matching def.key
// and fires its action — exactly like WC2's GameButton key bindings.
export function triggerHotkey(key) {
  if (!key) return;

  // Collect the active command card buttons
  const hits = cmdBtns.filter(btn => {
    if (btn.classList.contains('cmd-empty') || btn.disabled) return false;
    const hk = btn.querySelector('.hotkey')?.textContent?.toUpperCase();
    return hk === key;
  });
  if (hits.length === 0) return;
  hits[0].click();   // fire the first matching button's onclick
}

// Minimap click → pan camera
mmCanvas.addEventListener('click', e => {
  const r  = mmCanvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const mz = e.clientY - r.top;
  camera.position.x = (mx / MM_W) * WORLD_W;
  camera.position.z = (mz / MM_H) * WORLD_H + 60;
});
