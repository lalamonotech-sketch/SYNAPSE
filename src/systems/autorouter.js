/**
 * SYNAPSE v98 — Auto-Router (A* Pathfinder)
 *
 * "Your own awakened consciousness builds the path for you."
 *
 * Available from Epoch III onwards. The player selects a source node,
 * then shift-clicks a distant target node. The router:
 *
 *   1. Runs A* on a virtual grid to find the optimal path, avoiding
 *      existing nodes (treated as soft obstacles).
 *   2. Shows a holographic neon-blue preview path (ghost nodes + dashed
 *      lines) before any real nodes are placed.
 *   3. A confirm banner gives the player cost info. One click builds it;
 *      Escape cancels with no penalty.
 *
 * ── A* Grid ──────────────────────────────────────────────────────────────
 *
 *  The game world is sampled at GRID_STEP intervals within a bounding
 *  box around [startNode.pos … targetNode.pos] + GRID_PADDING.
 *
 *  Cell cost:
 *    • Occupied by an existing node  → cost ×8   (avoid, but not blocked)
 *    • Close to existing node (<1.5) → cost ×3
 *    • Empty                         → cost 1
 *
 *  Heuristic: Euclidean distance to goal.
 *
 * ── Route result ─────────────────────────────────────────────────────────
 *
 *  The A* path is a list of world-space Vector3 waypoints. The router
 *  then simplifies it (straight-line segments, max RELAY_SPACING apart)
 *  to decide how many Relay nodes to place. The result:
 *
 *    [startNode] → relay₁ → relay₂ → … → relayN → [targetNode]
 *
 *  Relays are built with type 'relay', links with 'stable' by default,
 *  upgrading to 'fast' if the research project fast_link is complete.
 *
 * ── State machine ────────────────────────────────────────────────────────
 *
 *  IDLE → SELECTING_TARGET (player pressed B or clicked "Auto-Route")
 *       → PREVIEWING       (path found, ghost shown)
 *       → BUILDING         (player confirmed)
 *       → IDLE             (done or cancelled)
 *
 * ── Integration ──────────────────────────────────────────────────────────
 *
 *  input.js:    handleAutoRouterPointerDown(node) — called when a node
 *               is clicked while in SELECTING_TARGET state.
 *
 *  hotkeys.js:  A key → toggleAutoRouter()
 *
 *  awakening.js or runController.js: call initAutoRouter() once.
 *
 * ── Epoch gate ───────────────────────────────────────────────────────────
 *
 *  Only active when body has class epoch-temporal or epoch-sentience.
 */

import * as THREE from 'three';
import { G }         from '../state/gameState.js';
import { gameNodes, gameLinks, makeNode, makeLink, spawnShock } from '../layers/network/index.js';
import { showToast } from '../ui/hud/index.js';
import { getLang }   from '../state/settings.js';
import { tagNewLink } from './plasticity.js';

// ── Tuning ────────────────────────────────────────────────────────────────

const GRID_STEP      = 1.8;    // A* grid resolution (world units)
const GRID_PADDING   = 4.0;    // bounding box padding around start/end
const RELAY_SPACING  = 3.5;    // max world-units between relays
const MAX_RELAYS     = 8;      // hard cap on intermediate relays
const OBSTACLE_RADIUS    = 1.2; // existing node exclusion radius
const SOFT_OBSTACLE_RADIUS = 2.0;

const GHOST_OPACITY      = 0.38;
const GHOST_COLOR        = 0x00aaff;
const GHOST_LINK_COLOR   = 0x0066cc;
const CONFIRM_BANNER_ID  = 'ar-confirm-banner';

// ── State ─────────────────────────────────────────────────────────────────

const STATE = { IDLE: 0, SELECTING: 1, PREVIEWING: 2, BUILDING: 3 };

let _state       = STATE.IDLE;
let _sourceNode  = null;
let _targetNode  = null;
let _ghostNodes  = [];   // THREE.Mesh preview spheres
let _ghostLinks  = [];   // SVG/canvas overlay lines
let _routeWaypoints = []; // Vector3[] — planned relay positions
let _overlayEl   = null;

// ── Epoch check ───────────────────────────────────────────────────────────

function _epochOk() {
  const body = document.body;
  return (
    body.classList.contains('epoch-temporal') ||
    body.classList.contains('epoch-sentience')
  );
}

// ── Public API ────────────────────────────────────────────────────────────

export function isAutoRouterActive() {
  return _state !== STATE.IDLE;
}

export function isSelectingTarget() {
  return _state === STATE.SELECTING;
}

export function toggleAutoRouter() {
  if (!_epochOk()) {
    const lang = getLang();
    showToast(
      lang === 'de' ? '◌ AUTO-ROUTER GESPERRT' : '◌ AUTO-ROUTER LOCKED',
      lang === 'de' ? 'Verfügbar ab Epoche III — Temporal' : 'Available from Epoch III — Temporal',
      2000
    );
    return;
  }
  if (_state !== STATE.IDLE) {
    _cancel();
  } else {
    _enterSelecting();
  }
}

/**
 * Called by input.js when a node is clicked.
 * Returns true if the auto-router consumed the click.
 */
export function handleAutoRouterNodeClick(node) {
  if (_state === STATE.IDLE) return false;

  if (_state === STATE.SELECTING) {
    if (!_sourceNode) {
      _sourceNode = node;
      const lang = getLang();
      showToast(
        lang === 'de' ? '◈ QUELLE GEWÄHLT' : '◈ SOURCE SELECTED',
        lang === 'de' ? 'Jetzt Ziel-Node anklicken' : 'Now click a target node',
        1800
      );
      _highlightNode(node, true);
      return true;
    }

    if (node === _sourceNode) {
      // Clicked source again — deselect
      _highlightNode(node, false);
      _sourceNode = null;
      return true;
    }

    // Got target — run pathfinder
    _targetNode = node;
    _state = STATE.PREVIEWING;
    _runAndPreview();
    return true;
  }

  return false;
}

export function confirmRoute() {
  if (_state !== STATE.PREVIEWING) return;
  _state = STATE.BUILDING;
  _buildRoute();
}

export function cancelAutoRouter() {
  _cancel();
}

// ── Internal ──────────────────────────────────────────────────────────────

function _enterSelecting() {
  _state = STATE.SELECTING;
  _sourceNode = null;
  _targetNode = null;
  const lang = getLang();
  showToast(
    lang === 'de' ? '◈ AUTO-ROUTER AKTIV' : '◈ AUTO-ROUTER ACTIVE',
    lang === 'de'
      ? 'Quelle anklicken, dann Ziel anklicken'
      : 'Click source node, then target node',
    2400
  );
  _mountSelectionIndicator();
}

function _cancel() {
  _clearGhosts();
  _removeConfirmBanner();
  _removeSelectionIndicator();
  _highlightNode(_sourceNode, false);
  _highlightNode(_targetNode, false);
  _state = STATE.IDLE;
  _sourceNode = null;
  _targetNode = null;
  _routeWaypoints = [];
}

function _highlightNode(node, on) {
  if (!node?.mat) return;
  if (on) {
    node._arHighlight = true;
    node.mat.emissiveIntensity = 3.5;
  } else {
    node._arHighlight = false;
  }
}

// ── A* Pathfinder ─────────────────────────────────────────────────────────

function _runAndPreview() {
  const lang = getLang();
  const path = _astar(_sourceNode.pos, _targetNode.pos);

  if (!path || path.length === 0) {
    showToast(
      lang === 'de' ? '✕ KEIN PFAD GEFUNDEN' : '✕ NO PATH FOUND',
      lang === 'de' ? 'Hindernisse blockieren alle Routen' : 'Obstacles block all routes',
      2400
    );
    _cancel();
    return;
  }

  // Simplify path → relay positions
  _routeWaypoints = _simplifyPath(path);

  // Show holographic preview
  _clearGhosts();
  _showGhostPreview(_sourceNode.pos, _targetNode.pos, _routeWaypoints);

  // Calculate cost
  const relayCost = 5; // NT.relay.cost
  const linkCost  = 0; // stable links are free
  const totalCost = _routeWaypoints.length * relayCost + ((_routeWaypoints.length + 1) * linkCost);

  _mountConfirmBanner(totalCost, _routeWaypoints.length);
}

/**
 * Minimal A* on a 2D grid (z = 0 plane).
 * Returns array of THREE.Vector3 waypoints from start to end (exclusive).
 */
function _astar(start, end) {
  const minX = Math.min(start.x, end.x) - GRID_PADDING;
  const maxX = Math.max(start.x, end.x) + GRID_PADDING;
  const minY = Math.min(start.y, end.y) - GRID_PADDING;
  const maxY = Math.max(start.y, end.y) + GRID_PADDING;

  const cols = Math.ceil((maxX - minX) / GRID_STEP) + 1;
  const rows = Math.ceil((maxY - minY) / GRID_STEP) + 1;

  // Guard: too large
  if (cols * rows > 4000) return _directPath(start, end);

  // Precompute obstacle costs
  const obstacleMap = new Float32Array(cols * rows).fill(1);
  for (const n of gameNodes) {
    if (n === _sourceNode || n === _targetNode) continue;
    const ci = Math.round((n.pos.x - minX) / GRID_STEP);
    const ri = Math.round((n.pos.y - minY) / GRID_STEP);
    for (let dc = -2; dc <= 2; dc++) {
      for (let dr = -2; dr <= 2; dr++) {
        const c = ci + dc, r = ri + dr;
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
        const d = Math.sqrt(dc * dc + dr * dr) * GRID_STEP;
        if (d < OBSTACLE_RADIUS)      obstacleMap[r * cols + c] = 8;
        else if (d < SOFT_OBSTACLE_RADIUS) obstacleMap[r * cols + c] = Math.max(obstacleMap[r * cols + c], 3);
      }
    }
  }

  const startC = Math.round((start.x - minX) / GRID_STEP);
  const startR = Math.round((start.y - minY) / GRID_STEP);
  const endC   = Math.round((end.x   - minX) / GRID_STEP);
  const endR   = Math.round((end.y   - minY) / GRID_STEP);

  const h = (c, r) => Math.sqrt((c - endC) ** 2 + (r - endR) ** 2);

  // Open set: [f, g, c, r, parentIdx]
  const open   = [];
  const closed = new Uint8Array(cols * rows);
  const gCost  = new Float32Array(cols * rows).fill(Infinity);
  const parent = new Int32Array(cols * rows).fill(-1);

  const startIdx = startR * cols + startC;
  gCost[startIdx] = 0;
  open.push([h(startC, startR), 0, startC, startR]);

  const dirs = [
    [1,0],[-1,0],[0,1],[0,-1],
    [1,1],[1,-1],[-1,1],[-1,-1],
  ];

  let found = false;
  while (open.length > 0) {
    // Pop lowest f (simple linear scan — grid is small)
    let bestI = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i][0] < open[bestI][0]) bestI = i;
    }
    const [, g, c, r] = open[bestI];
    open.splice(bestI, 1);

    const idx = r * cols + c;
    if (closed[idx]) continue;
    closed[idx] = 1;

    if (c === endC && r === endR) { found = true; break; }

    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nIdx = nr * cols + nc;
      if (closed[nIdx]) continue;
      const stepCost = (Math.abs(dc) + Math.abs(dr) === 2 ? 1.414 : 1) * obstacleMap[nIdx];
      const ng = g + stepCost;
      if (ng < gCost[nIdx]) {
        gCost[nIdx] = ng;
        parent[nIdx] = idx;
        open.push([ng + h(nc, nr), ng, nc, nr]);
      }
    }
  }

  if (!found) return _directPath(start, end);

  // Reconstruct path
  const path = [];
  let idx = endR * cols + endC;
  while (idx !== startIdx && idx !== -1) {
    const c = idx % cols;
    const r = Math.floor(idx / cols);
    path.unshift(new THREE.Vector3(
      minX + c * GRID_STEP,
      minY + r * GRID_STEP,
      0
    ));
    idx = parent[idx];
  }
  return path;
}

function _directPath(start, end) {
  // Fallback: straight line
  const dir = end.clone().sub(start);
  const len = dir.length();
  const steps = Math.ceil(len / RELAY_SPACING);
  const pts = [];
  for (let i = 1; i < steps; i++) {
    pts.push(start.clone().addScaledVector(dir.clone().normalize(), (len / steps) * i));
  }
  return pts;
}

/**
 * Simplify A* waypoints into relay placement positions.
 * Uses a greedy segment approach: walk the path, place a relay
 * every RELAY_SPACING world-units.
 */
function _simplifyPath(pathPts) {
  if (pathPts.length === 0) return [];

  const relays = [];
  let dist = 0;
  let prev = _sourceNode.pos.clone();

  for (const pt of pathPts) {
    dist += prev.distanceTo(pt);
    if (dist >= RELAY_SPACING) {
      relays.push(pt.clone());
      dist = 0;
    }
    prev = pt;
  }

  // Ensure last relay isn't too close to target
  if (relays.length > 0) {
    const last = relays[relays.length - 1];
    if (last.distanceTo(_targetNode.pos) < RELAY_SPACING * 0.5) {
      relays.pop();
    }
  }

  return relays.slice(0, MAX_RELAYS);
}

// ── Ghost preview (DOM/CSS overlay) ───────────────────────────────────────

function _showGhostPreview(startPos, endPos, relayPositions) {
  // Create a canvas overlay for the holographic path
  _removeOverlay();

  const overlay = document.createElement('canvas');
  overlay.id = 'ar-ghost-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 500;
  `;
  document.body.appendChild(overlay);
  _overlayEl = overlay;

  // Store waypoints for animation
  _ghostNodes = [startPos, ...relayPositions, endPos];

  // Animate the ghost path
  _animateGhost();
}

let _ghostAnimFrame = null;
let _ghostPhase = 0;

function _animateGhost() {
  if (_overlayEl == null) return;

  _ghostPhase = (_ghostPhase + 0.025) % 1;
  _drawGhostCanvas(_ghostPhase);
  _ghostAnimFrame = requestAnimationFrame(_animateGhost);
}

function _worldToScreen(pos3) {
  // Project world position to screen coordinates
  // We need the camera — use the window-exposed camera from scene.js
  const cam = window.__synapseCamera;
  if (!cam) return null;

  const v = pos3.clone().project(cam);
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    x: (v.x + 1) / 2 * w,
    y: (1 - (v.y + 1) / 2) * h,
  };
}

function _drawGhostCanvas(phase) {
  const canvas = _overlayEl;
  if (!canvas) return;

  const w = canvas.width  = window.innerWidth;
  const h = canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const pts2d = _ghostNodes.map(p => _worldToScreen(p)).filter(Boolean);
  if (pts2d.length < 2) return;

  // ── Draw connection lines ───────────────────────────────────────────

  // Glow layers (outer → inner)
  const glowLayers = [
    { width: 10, alpha: 0.06, color: '0, 170, 255' },
    { width: 5,  alpha: 0.15, color: '0, 170, 255' },
    { width: 2,  alpha: 0.9,  color: '100, 210, 255' },
  ];

  for (const layer of glowLayers) {
    ctx.beginPath();
    ctx.moveTo(pts2d[0].x, pts2d[0].y);
    for (let i = 1; i < pts2d.length; i++) {
      ctx.lineTo(pts2d[i].x, pts2d[i].y);
    }
    ctx.strokeStyle = `rgba(${layer.color}, ${layer.alpha})`;
    ctx.lineWidth = layer.width;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -phase * 28;
    ctx.stroke();
  }

  // ── Draw relay ghost nodes ──────────────────────────────────────────

  const pulse = 0.65 + 0.35 * Math.sin(phase * Math.PI * 2);

  for (let i = 1; i < pts2d.length - 1; i++) {
    const p = pts2d[i];
    const r = 6 * pulse;

    // Outer glow
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.5);
    grad.addColorStop(0,   `rgba(0, 180, 255, ${0.55 * pulse})`);
    grad.addColorStop(0.5, `rgba(0, 120, 220, ${0.2  * pulse})`);
    grad.addColorStop(1,   `rgba(0,  80, 180, 0)`);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 3.5, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Core dot
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(160, 230, 255, ${0.9 * pulse})`;
    ctx.fill();
  }

  // ── Source & target highlights ──────────────────────────────────────

  for (const [i, p] of [[0, pts2d[0]], [pts2d.length - 1, pts2d[pts2d.length - 1]]]) {
    const isSource = i === 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10 + 3 * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = isSource
      ? `rgba(100, 255, 200, ${0.8 * pulse})`
      : `rgba(255, 180, 80,  ${0.8 * pulse})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.stroke();
  }
}

function _clearGhosts() {
  if (_ghostAnimFrame) {
    cancelAnimationFrame(_ghostAnimFrame);
    _ghostAnimFrame = null;
  }
  _removeOverlay();
  _ghostNodes = [];
  _ghostLinks = [];
}

function _removeOverlay() {
  if (_overlayEl) {
    _overlayEl.remove();
    _overlayEl = null;
  }
  document.getElementById('ar-ghost-overlay')?.remove();
}

// ── Confirm banner ────────────────────────────────────────────────────────

function _mountConfirmBanner(cost, relayCount) {
  _removeConfirmBanner();
  const lang = getLang();
  const banner = document.createElement('div');
  banner.id = CONFIRM_BANNER_ID;
  banner.innerHTML = `
    <span class="ar-banner-info">
      ${lang === 'de' ? '◈ AUTO-ROUTE' : '◈ AUTO-ROUTE'}
      &nbsp;·&nbsp;
      ${relayCount} ${lang === 'de' ? 'Relais' : 'Relay' + (relayCount !== 1 ? 's' : '')}
      &nbsp;·&nbsp;
      <b>${cost}⬡</b>
    </span>
    <button id="ar-confirm-btn" class="ar-btn ar-btn-ok">
      ${lang === 'de' ? '✓ Bauen' : '✓ Build'}
    </button>
    <button id="ar-cancel-btn" class="ar-btn ar-btn-cancel">
      ${lang === 'de' ? '✕ Abbrechen' : '✕ Cancel'}
    </button>`;
  document.body.appendChild(banner);

  document.getElementById('ar-confirm-btn').addEventListener('click', confirmRoute);
  document.getElementById('ar-cancel-btn').addEventListener('click', cancelAutoRouter);
}

function _removeConfirmBanner() {
  document.getElementById(CONFIRM_BANNER_ID)?.remove();
}

// ── Selection indicator ───────────────────────────────────────────────────

function _mountSelectionIndicator() {
  _removeSelectionIndicator();
  const el = document.createElement('div');
  el.id = 'ar-select-hint';
  el.textContent = getLang() === 'de'
    ? '◈ AUTO-ROUTER · Quelle → Ziel wählen'
    : '◈ AUTO-ROUTER · Select source → target';
  document.body.appendChild(el);
}

function _removeSelectionIndicator() {
  document.getElementById('ar-select-hint')?.remove();
}

// ── Build (actual node + link placement) ─────────────────────────────────

function _buildRoute() {
  _clearGhosts();
  _removeConfirmBanner();
  _removeSelectionIndicator();

  const lang = getLang();

  // Determine link type: fast if research unlocked it
  const useFast = G.research?.completed?.has('fast_link') ?? false;
  const linkType = useFast ? 'fast' : 'stable';

  // Place relay nodes along the route
  const builtRelays = [];
  for (const pos of _routeWaypoints) {
    const n = makeNode(pos.clone(), false, 'relay');
    if (!n) {
      showToast(
        lang === 'de' ? '✕ BAUFEHLER' : '✕ BUILD ERROR',
        lang === 'de' ? 'Zu wenig Energie für Relais' : 'Not enough energy for relay',
        2200
      );
      break;
    }
    builtRelays.push(n);
  }

  // Wire: source → relay₁ → … → relayN → target
  const chain = [_sourceNode, ...builtRelays, _targetNode];
  let linksBuilt = 0;

  for (let i = 0; i < chain.length - 1; i++) {
    const lk = makeLink(chain[i], chain[i + 1], linkType);
    if (lk) {
      tagNewLink(lk);  // plasticity: immune to immediate pruning
      linksBuilt++;
    }
  }

  // Visual feedback
  try { spawnShock(0x00aaff, 0); } catch (_) {}

  showToast(
    lang === 'de' ? '◈ ROUTE GEBAUT' : '◈ ROUTE BUILT',
    lang === 'de'
      ? `${builtRelays.length} Relais · ${linksBuilt} Links · ${linkType === 'fast' ? 'Schnell-' : 'Stabil-'}Links`
      : `${builtRelays.length} relays · ${linksBuilt} links · ${linkType} type`,
    2800
  );

  _highlightNode(_sourceNode, false);
  _highlightNode(_targetNode, false);
  _state = STATE.IDLE;
  _sourceNode  = null;
  _targetNode  = null;
  _routeWaypoints = [];
}

// ── Init ──────────────────────────────────────────────────────────────────

export function initAutoRouter() {
  // Expose camera reference for world-to-screen projection
  import('../engine/scene.js').then(({ camera }) => {
    window.__synapseCamera = camera;
  });
}

export function resetAutoRouter() {
  _cancel();
}

// ── Public export ─────────────────────────────────────────────────────────

export const autoRouter = {
  toggle:          toggleAutoRouter,
  handleNodeClick: handleAutoRouterNodeClick,
  confirm:         confirmRoute,
  cancel:          cancelAutoRouter,
  isActive:        isAutoRouterActive,
  isSelecting:     isSelectingTarget,
  init:            initAutoRouter,
  reset:           resetAutoRouter,
};

window.__autoRouter = autoRouter;
