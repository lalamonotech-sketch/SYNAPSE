/**
 * SYNAPSE v98 — Blueprint Drag-Build System
 *
 * Allows the player to drag a line on the canvas and have the game
 * automatically build Source → Relay → Relay → Memory (or any
 * registered blueprint template) along that line.
 *
 * Architecture:
 *   - enterBlueprintMode() / exitBlueprintMode() toggle the mode.
 *   - Drag start + end positions define the build axis.
 *   - After drag-release a preview ghost is shown; confirm with Tap or
 *     reject with Escape / second-tap outside.
 *   - The actual node/link creation is deferred one rAF so the preview
 *     UI has time to render.
 *
 * Blueprint Templates (BLUEPRINT_TEMPLATES):
 *   Each template is an ordered array of node types. The system places
 *   them evenly spaced along the drag vector, then wires links between
 *   consecutive nodes. Total energy cost is shown before confirm.
 *
 * State:
 *   G.awakening.blueprintMode  — boolean (public flag consumed by input.js)
 *   _bp.*                      — module-private drag state
 *
 * Integration points:
 *   - input.js onPointerDown/Move/Up must call handleBlueprintPointer*()
 *   - hotkeys.js maps B key → toggleBlueprintMode()
 *   - ctrl-dock gets a ⊡ Blueprint button that calls toggleBlueprintMode()
 */

import * as THREE from 'three';
import { G }          from '../state/gameState.js';
import { TUNING }     from '../state/tuning.js';
import { gameNodes, makeNode, makeLink } from '../layers/network/index.js';
import { camera }     from '../engine/scene.js';
import { showToast }  from '../ui/hud/index.js';
import { getLang }    from '../state/settings.js';
import { placePos }   from '../input/pointer.js';

// ── Blueprint templates ────────────────────────────────────────────────────
export const BLUEPRINT_TEMPLATES = {
  highway: {
    id:    'highway',
    label: { de: 'Highway', en: 'Highway' },
    desc:  { de: 'Source → Relay → Relay → Memory', en: 'Source → Relay → Relay → Memory' },
    icon:  '→',
    nodes: ['source', 'relay', 'relay', 'memory'],
    linkType: 'stable',
  },
  spine: {
    id:    'spine',
    label: { de: 'Spine', en: 'Spine' },
    desc:  { de: 'Relay → Amp → Amp → Relay', en: 'Relay → Amp → Amp → Relay' },
    icon:  '⬟',
    nodes: ['relay', 'amplifier', 'amplifier', 'relay'],
    linkType: 'resonance',
  },
  cortex_seed: {
    id:    'cortex_seed',
    label: { de: 'Cortex-Seed', en: 'Cortex Seed' },
    desc:  { de: 'Source → Memory + 3× Amp (Kreuz)', en: 'Source → Memory + 3× Amp (cross)' },
    icon:  '✦',
    nodes: ['source', 'memory', 'amplifier', 'amplifier', 'amplifier'],
    linkType: 'stable',
    cross: true,   // special: amp nodes arranged around memory
  },
};

// Node build costs (mirror TUNING / LT costs)
const NODE_COSTS = { source: 0, relay: 5, amplifier: 8, memory: 10, catalyst: 15 };
const LINK_COSTS = { stable: 0, resonance: 4, fast: 5, fragile: 0 };

// ── Module-private drag state ──────────────────────────────────────────────
const _bp = {
  active:       false,
  dragging:     false,
  confirmed:    false,
  startX:       0,
  startY:       0,
  endX:         0,
  endY:         0,
  startWorld:   new THREE.Vector3(),
  endWorld:     new THREE.Vector3(),
  template:     BLUEPRINT_TEMPLATES.highway,
  ghosts:       [],    // DOM ghost elements for preview
  previewNodes: [],    // { pos: Vector3, type: string }
  totalCost:    0,
};

// ── Public API ─────────────────────────────────────────────────────────────

export function enterBlueprintMode(templateId) {
  const tpl = BLUEPRINT_TEMPLATES[templateId] || BLUEPRINT_TEMPLATES.highway;
  _bp.template = tpl;
  _bp.active   = true;
  if (G.awakening) G.awakening.blueprintMode = true;
  _showBlueprintHint();
  _mountBlueprintOverlay();
  document.body.classList.add('blueprint-mode');
}

export function exitBlueprintMode() {
  _bp.active    = false;
  _bp.dragging  = false;
  _bp.confirmed = false;
  if (G.awakening) G.awakening.blueprintMode = false;
  _clearGhosts();
  _removeBlueprintOverlay();
  document.body.classList.remove('blueprint-mode');
  document.body.classList.remove('blueprint-dragging');
}

export function toggleBlueprintMode(templateId) {
  if (_bp.active) exitBlueprintMode();
  else enterBlueprintMode(templateId || 'highway');
}

export function isBlueprintActive() { return _bp.active; }

/** Called by input.js on pointerdown when blueprintMode is active */
export function handleBlueprintPointerDown(cx, cy) {
  if (!_bp.active) return;
  _bp.dragging = true;
  _bp.startX   = cx;
  _bp.startY   = cy;
  _bp.endX     = cx;
  _bp.endY     = cy;
  _bp.startWorld.copy(placePos(cx, cy));
  _bp.endWorld.copy(_bp.startWorld);
  document.body.classList.add('blueprint-dragging');
  _clearGhosts();
}

/** Called by input.js on pointermove when blueprintMode is active */
export function handleBlueprintPointerMove(cx, cy) {
  if (!_bp.active || !_bp.dragging) return;
  _bp.endX = cx;
  _bp.endY = cy;
  _bp.endWorld.copy(placePos(cx, cy));
  _updatePreview();
}

/** Called by input.js on pointerup when blueprintMode is active */
export function handleBlueprintPointerUp(cx, cy) {
  if (!_bp.active || !_bp.dragging) return;
  _bp.dragging = false;
  _bp.endX     = cx;
  _bp.endY     = cy;
  _bp.endWorld.copy(placePos(cx, cy));

  const dist = _bp.startWorld.distanceTo(_bp.endWorld);

  // Too short — cancel
  if (dist < 3.0) {
    _clearGhosts();
    document.body.classList.remove('blueprint-dragging');
    const lang = getLang();
    showToast(
      lang === 'de' ? '⊡ Blueprint' : '⊡ Blueprint',
      lang === 'de' ? 'Länger ziehen für Vorschau' : 'Drag further for preview',
      1200
    );
    return;
  }

  _updatePreview();
  _showConfirmBanner();
  document.body.classList.remove('blueprint-dragging');
}

/** Confirm and actually build the previewed blueprint. */
export function confirmBlueprint() {
  if (!_bp.previewNodes.length) return;

  const lang = getLang();
  const cost = _bp.totalCost;
  if (G.energy < cost) {
    showToast(
      lang === 'de' ? '⛔ Zu wenig Energie' : '⛔ Not enough energy',
      `${cost}⬡ ${lang === 'de' ? 'benötigt' : 'required'}`,
      1600
    );
    return;
  }

  // Charge cost upfront
  G.energy -= cost;

  // Build nodes
  const built = [];
  const tpl = _bp.template;

  if (tpl.cross && tpl.nodes.length >= 5) {
    // Special: cortex_seed — memory in center, amps around it
    const centerPos = _bp.previewNodes[1]?.pos || _bp.startWorld.clone();
    const memNode = makeNode(centerPos.clone(), false, 'memory');
    if (memNode) built.push(memNode);

    const radius = 3.0;
    const angles = [0, Math.PI * 2 / 3, Math.PI * 4 / 3];
    for (let i = 0; i < 3; i++) {
      const apos = centerPos.clone().add(new THREE.Vector3(
        Math.cos(angles[i]) * radius,
        Math.sin(angles[i]) * radius,
        0
      ));
      const amp = makeNode(apos, false, 'amplifier');
      if (amp) built.push(amp);
    }
    // Wire: source → mem
    const srcNode = makeNode(_bp.previewNodes[0].pos.clone(), false, 'source');
    if (srcNode) {
      built.unshift(srcNode);
      if (built[1]) makeLink(srcNode, built[1], tpl.linkType);
    }
    // Wire amps to memory
    for (let i = 2; i < built.length; i++) {
      if (built[1]) makeLink(built[i], built[1], tpl.linkType);
    }
  } else {
    // Standard: linear placement
    for (let i = 0; i < _bp.previewNodes.length; i++) {
      const pn  = _bp.previewNodes[i];
      // Use free placement — override type
      const nd = makeNode(pn.pos.clone(), false, pn.type);
      if (nd) built.push(nd);
    }
    // Wire consecutive pairs
    for (let i = 0; i < built.length - 1; i++) {
      makeLink(built[i], built[i + 1], tpl.linkType);
    }
  }

  _clearGhosts();
  _removeConfirmBanner();
  exitBlueprintMode();

  const lang2 = getLang();
  showToast(
    lang2 === 'de' ? `✦ ${tpl.label.de} gebaut` : `✦ ${tpl.label.en} built`,
    `${built.length} ${lang2 === 'de' ? 'Nodes platziert' : 'nodes placed'}`,
    2000
  );
}

export function cancelBlueprint() {
  _clearGhosts();
  _removeConfirmBanner();
  exitBlueprintMode();
}

// ── Preview calculation ────────────────────────────────────────────────────

function _updatePreview() {
  const tpl   = _bp.template;
  const count = tpl.nodes.length;
  const start = _bp.startWorld.clone();
  const end   = _bp.endWorld.clone();

  _bp.previewNodes = [];
  let cost = 0;

  if (tpl.cross && count >= 5) {
    // cortex_seed special layout
    _bp.previewNodes.push({ pos: start, type: 'source' });
    _bp.previewNodes.push({ pos: end,   type: 'memory' });
    cost += NODE_COSTS.source + NODE_COSTS.memory + NODE_COSTS.amplifier * 3;
    cost += LINK_COSTS[tpl.linkType] * 4;
  } else {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const pos = start.clone().lerp(end, t);
      _bp.previewNodes.push({ pos, type: tpl.nodes[i] });
      cost += NODE_COSTS[tpl.nodes[i]] || 0;
      if (i > 0) cost += LINK_COSTS[tpl.linkType] || 0;
    }
  }

  _bp.totalCost = cost;
  _renderGhosts();
}

// ── Ghost DOM rendering ────────────────────────────────────────────────────
// Ghosts are simple CSS-positioned circles projected from world → screen.

function _renderGhosts() {
  _clearGhosts();

  const w = window.innerWidth;
  const h = window.innerHeight;
  const tpl = _bp.template;

  _bp.previewNodes.forEach((pn, i) => {
    const vec = pn.pos.clone().project(camera);
    const sx  = (vec.x  * 0.5 + 0.5) * w;
    const sy  = (-vec.y * 0.5 + 0.5) * h;

    const dot = document.createElement('div');
    dot.className = 'bp-ghost-node bp-node-' + pn.type;
    dot.style.cssText = `left:${sx}px;top:${sy}px`;
    dot.textContent   = _nodeIcon(pn.type);
    document.body.appendChild(dot);
    _bp.ghosts.push(dot);

    // Draw connector line between consecutive ghosts (CSS line using transform)
    if (i > 0) {
      const prev = _bp.previewNodes[i - 1];
      const pVec = prev.pos.clone().project(camera);
      const px   = (pVec.x * 0.5 + 0.5) * w;
      const py   = (-pVec.y * 0.5 + 0.5) * h;

      const dx   = sx - px;
      const dy   = sy - py;
      const len  = Math.hypot(dx, dy);
      const ang  = Math.atan2(dy, dx) * 180 / Math.PI;

      const line = document.createElement('div');
      line.className = 'bp-ghost-link bp-link-' + (tpl.linkType || 'stable');
      line.style.cssText = `left:${px}px;top:${py}px;width:${len}px;transform:rotate(${ang}deg)`;
      document.body.appendChild(line);
      _bp.ghosts.push(line);
    }
  });

  // Cost label near end point
  const endVec = _bp.endWorld.clone().project(camera);
  const ex = (endVec.x * 0.5 + 0.5) * w;
  const ey = (-endVec.y * 0.5 + 0.5) * h;
  const costEl = document.createElement('div');
  costEl.className = 'bp-ghost-cost';
  costEl.style.cssText = `left:${ex + 14}px;top:${ey - 10}px`;
  const lang = getLang();
  costEl.textContent = `${_bp.totalCost}⬡`;
  if (_bp.totalCost > G.energy) costEl.classList.add('bp-cost-unaffordable');
  document.body.appendChild(costEl);
  _bp.ghosts.push(costEl);
}

function _clearGhosts() {
  _bp.ghosts.forEach(g => g.remove());
  _bp.ghosts = [];
}

function _nodeIcon(type) {
  const icons = { source: '◉', relay: '→', amplifier: '↑', memory: '◎', catalyst: '★' };
  return icons[type] || '·';
}

// ── Confirm Banner ─────────────────────────────────────────────────────────

function _showConfirmBanner() {
  _removeConfirmBanner();
  const lang = getLang();
  const tpl  = _bp.template;

  const banner = document.createElement('div');
  banner.id = 'bp-confirm-banner';
  banner.innerHTML = `
    <div class="bp-banner-title">⊡ ${tpl.label[lang] || tpl.label.en}</div>
    <div class="bp-banner-desc">${tpl.desc[lang] || tpl.desc.en}</div>
    <div class="bp-banner-cost ${_bp.totalCost > G.energy ? 'bp-cost-unaffordable' : ''}">${_bp.totalCost}⬡</div>
    <div class="bp-banner-btns">
      <button id="bp-confirm-btn">${lang === 'de' ? '✓ Bauen' : '✓ Build'}</button>
      <button id="bp-cancel-btn">${lang === 'de' ? '✕ Abbrechen' : '✕ Cancel'}</button>
    </div>`;
  document.body.appendChild(banner);

  document.getElementById('bp-confirm-btn').addEventListener('click', confirmBlueprint);
  document.getElementById('bp-cancel-btn').addEventListener('click', cancelBlueprint);
}

function _removeConfirmBanner() {
  document.getElementById('bp-confirm-banner')?.remove();
}

// ── Blueprint overlay (template selector) ────────────────────────────────

function _mountBlueprintOverlay() {
  if (document.getElementById('bp-template-bar')) return;
  const lang = getLang();
  const bar = document.createElement('div');
  bar.id = 'bp-template-bar';

  const btns = Object.values(BLUEPRINT_TEMPLATES).map(tpl => `
    <button class="bp-tpl-btn ${_bp.template.id === tpl.id ? 'active' : ''}"
            data-tpl="${tpl.id}" title="${tpl.desc[lang] || tpl.desc.en}">
      ${tpl.icon} ${tpl.label[lang] || tpl.label.en}
    </button>`).join('');

  bar.innerHTML = `
    <div class="bp-bar-label">${lang === 'de' ? '⊡ Blaupause' : '⊡ Blueprint'}</div>
    ${btns}
    <button class="bp-exit-btn" id="bp-exit-btn">✕</button>`;
  document.body.appendChild(bar);

  bar.querySelectorAll('.bp-tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _bp.template = BLUEPRINT_TEMPLATES[btn.dataset.tpl] || BLUEPRINT_TEMPLATES.highway;
      bar.querySelectorAll('.bp-tpl-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.getElementById('bp-exit-btn').addEventListener('click', exitBlueprintMode);
}

function _removeBlueprintOverlay() {
  document.getElementById('bp-template-bar')?.remove();
}

// ── Hint toast ────────────────────────────────────────────────────────────
function _showBlueprintHint() {
  const lang = getLang();
  showToast(
    lang === 'de' ? '⊡ Blueprint-Modus' : '⊡ Blueprint Mode',
    lang === 'de' ? 'Auf dem Grid ziehen um eine Struktur zu bauen' : 'Drag on the grid to place a structure',
    2500
  );
}
