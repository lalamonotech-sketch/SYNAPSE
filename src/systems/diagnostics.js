/**
 * SYNAPSE v96 — Diagnostic Heatmap & Lens System
 *
 * Provides city-builder-style overlay lenses:
 *   - BANDWIDTH: colour links by load vs capacity (green→red)
 *   - ENERGY:    colour nodes by brownout / upkeep state
 *   - TERRAIN:   show sector type overlays
 *   - INFECTION: highlight infected links (crisis mode)
 *
 * The active lens is stored in G.diagnosticLens.
 * animateLayer1 reads link._diagColor and node._diagColor when a lens is active.
 */

import { G }          from '../state/gameState.js';
import { gameNodes, gameLinks } from '../layers/network/index.js';
import { ECO_TUNING }  from './economy.js';

export const LENSES = ['none', 'bandwidth', 'energy', 'terrain', 'infection'];

export function setLens(lens) {
  G.diagnosticLens = LENSES.includes(lens) ? lens : 'none';
}

export function cycleLens() {
  const idx = LENSES.indexOf(G.diagnosticLens || 'none');
  G.diagnosticLens = LENSES[(idx + 1) % LENSES.length];
  return G.diagnosticLens;
}

// ── Per-frame update — called from animateLayer1 ──────────────────────────
export function updateDiagColors() {
  const lens = G.diagnosticLens;
  if (!lens || lens === 'none') {
    // Clear all diagnostic overrides
    for (const n of gameNodes) n._diagColor = null;
    for (const l of gameLinks) l._diagColor = null;
    return;
  }

  switch (lens) {
    case 'bandwidth': _applyBandwidthLens(); break;
    case 'energy':    _applyEnergyLens();    break;
    case 'terrain':   _applyTerrainLens();   break;
    case 'infection': _applyInfectionLens(); break;
  }
}

// Green (0x00ff88) → Yellow (0xffcc00) → Red (0xff2200) based on load/cap ratio
function _applyBandwidthLens() {
  for (const n of gameNodes) n._diagColor = null;
  for (const l of gameLinks) {
    const cap  = ECO_TUNING.linkBandwidthBase[l.type] || 3;
    const load = l._signalLoad || 0;
    const t    = Math.min(1, load / cap);
    l._diagColor = _lerpColor(0x00ff88, 0xff2200, t);
  }
}

// Blue = fine, Orange = near brownout, Red = browned out
function _applyEnergyLens() {
  for (const l of gameLinks) l._diagColor = null;
  for (const n of gameNodes) {
    if (n._brownedOut)  { n._diagColor = 0xff2200; continue; }
    const upkeep = ECO_TUNING.upkeepPerNode[n.type] || 0;
    if (upkeep > 0 && G.eco) {
      const ratio = G.eco.totalUpkeep > 0 ? Math.min(1, upkeep / G.eco.totalUpkeep * 3) : 0;
      n._diagColor = _lerpColor(0x2288ff, 0xff8800, ratio);
    } else {
      n._diagColor = 0x2288ff;
    }
  }
}

// Terrain colours
const TERRAIN_COLORS = { normal: 0x334455, corrupted: 0xff4400, resonance: 0x44ffcc, dataOcean: 0x2244ff };
function _applyTerrainLens() {
  for (const l of gameLinks) l._diagColor = null;
  for (const n of gameNodes) {
    if (!n.m) continue;
    const p = n.m.position;
    // Import inline to avoid circular dep
    const terrain = G.eco?.terrain;
    if (!terrain) { n._diagColor = TERRAIN_COLORS.normal; continue; }
    const gx = Math.floor((p.x + 5) / 10 * 8);
    const gy = Math.floor((p.y + 5) / 10 * 8);
    const sec = terrain.find(s => s.x === gx && s.y === gy);
    n._diagColor = TERRAIN_COLORS[sec?.type || 'normal'];
  }
}

// Infected links are magenta; quarantined nodes are amber
function _applyInfectionLens() {
  for (const l of gameLinks) {
    if (l._parasiteInfected) l._diagColor = 0xff00ff;
    else if (l._quarantined) l._diagColor = 0xff8800;
    else l._diagColor = null;
  }
  for (const n of gameNodes) {
    if (n._quarantined)  n._diagColor = 0xff8800;
    else if (n._isFirewall) n._diagColor = 0x00ffcc;
    else n._diagColor = null;
  }
}

function _lerpColor(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
