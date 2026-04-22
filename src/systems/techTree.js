/**
 * SYNAPSE v96 — Tech Tree & Mega-Projects
 *
 * Knowledge (◈) is spent here, not as one-off actions.
 * Win condition: complete the Mega-Project by supplying sustained energy over time.
 * Branching research unlocks new link types, node synergies, or passive abilities.
 */

import { G } from '../state/gameState.js';
import { showToast } from '../ui/hud/index.js';
import { spawnShock } from '../layers/network/index.js';
import { getLang } from '../state/settings.js';
import { signalRunStateChanged } from '../platform/stateSignals.js';

// ── Tech nodes ────────────────────────────────────────────────────────────
export const TECH_NODES = {
  resonanceLinks: {
    id: 'resonanceLinks',
    labelDe: 'Resonanz-Links freischalten',
    labelEn: 'Unlock Resonance Links',
    cost: 4,
    requires: [],
    effect() { /* unlock state lives in G.tech.unlocked Set (see techUnlocks.js) */ },
    tip: 'Resonanz-Links verfügbar · ×2 Energie, aber brüchig',
  },
  dataCompression: {
    id: 'dataCompression',
    labelDe: 'Datenkompression',
    labelEn: 'Data Compression',
    cost: 6,
    requires: ['resonanceLinks'],
    effect() { /* see techUnlocks.js */ },
    tip: '+2 Bandbreite auf allen Links',
  },
  parallelBackbone: {
    id: 'parallelBackbone',
    labelDe: 'Parallel-Backbone',
    labelEn: 'Parallel Backbone',
    cost: 8,
    requires: ['dataCompression'],
    effect() { /* see techUnlocks.js */ },
    tip: 'Backbone-Links ignorieren Bottleneck-Penalty',
  },
  memoryAmplification: {
    id: 'memoryAmplification',
    labelDe: 'Speicher-Amplifikation',
    labelEn: 'Memory Amplification',
    cost: 5,
    requires: [],
    effect() { /* see techUnlocks.js */ },
    tip: 'Flanking-Bonus von Amplifiern ×2',
  },
  adaptiveUpkeep: {
    id: 'adaptiveUpkeep',
    labelDe: 'Adaptiver Upkeep',
    labelEn: 'Adaptive Upkeep',
    cost: 7,
    requires: ['memoryAmplification'],
    effect() { /* see techUnlocks.js */ },
    tip: 'Brownout-Gnade ×2 (6 Ticks statt 3)',
  },
  firewallNodes: {
    id: 'firewallNodes',
    labelDe: 'Firewall-Nodes',
    labelEn: 'Firewall Nodes',
    cost: 10,
    // FIX P1: was ['parallelBackbone', 'adaptiveUpkeep'] — a 5-step, 35◈ chain that
    // made Firewalls unreachable before Boss-triggered infection crises. Now Tier 1.
    requires: ['resonanceLinks'],
    effect() { /* see techUnlocks.js */ },
    tip: 'Platziere Firewalls gegen Boss-Infektion',
  },
};

// ── Research state ────────────────────────────────────────────────────────
export function initTechState() {
  if (G.tech) return;
  G.tech = {
    unlocked: new Set(),
    queue:    [],
  };
}

export function canResearch(nodeId) {
  initTechState();
  const node = TECH_NODES[nodeId];
  if (!node) return false;
  if (G.tech.unlocked.has(nodeId)) return false;
  if ((G.eco?.knowledge || 0) < node.cost) return false;
  return node.requires.every(req => G.tech.unlocked.has(req));
}

export function doResearch(nodeId) {
  if (!canResearch(nodeId)) return false;
  const node = TECH_NODES[nodeId];
  G.eco.knowledge -= node.cost;
  G.tech.unlocked.add(nodeId);
  node.effect();
  const lang = getLang();
  showToast(
    '◈ FORSCHUNG ABGESCHLOSSEN',
    lang === 'de' ? node.labelDe : node.labelEn,
    2500
  );
  spawnShock(0x44ffcc);
  signalRunStateChanged();
  return true;
}

// ── Mega-Project (win condition) ───────────────────────────────────────────
/**
 * Instead of killing a boss, the player must sustain energy supply to a
 * Mega-Project for a set duration. This is the strategic win condition.
 */
export const MEGA_PROJECTS = [
  {
    id: 'ghost_protocol',
    labelDe: 'Geist-Protokoll knacken',
    labelEn: 'Crack the Ghost Protocol',
    requiredEnergy: 500,   // total ⬡ that must be channelled into the project
    duration:       120,   // seconds of sustained supply needed
    minPerTick:     5,     // minimum ⬡/tick to count as "sustained"
  },
  {
    id: 'sigma_compile',
    labelDe: 'Sigma rekompilieren',
    labelEn: 'Recompile Sigma',
    requiredEnergy: 800,
    duration:       180,
    minPerTick:     8,
  },
  {
    id: 'null_ascension',
    labelDe: 'Null Cortex Aufstieg',
    labelEn: 'Null Cortex Ascension',
    requiredEnergy: 1200,
    duration:       240,
    minPerTick:     12,
  },
];

export function initMegaProject(projectId) {
  initTechState();
  const proj = MEGA_PROJECTS.find(p => p.id === projectId);
  if (!proj) return;
  G.megaProject = {
    ...proj,
    energyChannelled: 0,
    sustainedSeconds: 0,
    lastTickT:        0,
    active:           true,
    complete:         false,
  };
  const lang = getLang();
  showToast(
    lang === 'de' ? '🔧 MEGA-PROJEKT GESTARTET' : '🔧 MEGA-PROJECT STARTED',
    lang === 'de' ? proj.labelDe : proj.labelEn,
    3000
  );
}

export function tickMegaProject(t) {
  const mp = G.megaProject;
  if (!mp || !mp.active || mp.complete) return;
  if (t - mp.lastTickT < 1.0) return;
  const dt = t - mp.lastTickT;
  mp.lastTickT = t;

  const available = Math.min(G.energy, mp.minPerTick * dt);
  if (available >= mp.minPerTick * 0.8) {
    // Supply is sufficient — count progress
    mp.sustainedSeconds += dt;
    mp.energyChannelled += available;
    G.energy -= available;
  } else {
    // Supply gap — interrupt sustained timer
    if (mp.sustainedSeconds > 0) {
      const lang = getLang();
      showToast(
        lang === 'de' ? '⚠ PROJEKT UNTERBROCHEN' : '⚠ PROJECT INTERRUPTED',
        lang === 'de' ? 'Zu wenig Energie — Fortschritt pausiert' : 'Insufficient energy — progress paused',
        2000
      );
      mp.sustainedSeconds = Math.max(0, mp.sustainedSeconds - 5); // penalty
    }
  }

  // Win check
  if (mp.energyChannelled >= mp.requiredEnergy && mp.sustainedSeconds >= mp.duration) {
    mp.complete = true;
    mp.active   = false;
    _onMegaProjectComplete(mp);
  }
}

function _onMegaProjectComplete(mp) {
  G.runWon = true;
  const lang = getLang();
  showToast(
    lang === 'de' ? '🏆 MEGA-PROJEKT ABGESCHLOSSEN!' : '🏆 MEGA-PROJECT COMPLETE!',
    lang === 'de' ? mp.labelDe + ' — Sieg!' : mp.labelEn + ' — Victory!',
    5000
  );
  spawnShock(0xffffff);
  spawnShock(0x44ffcc);
  spawnShock(0x8844ff);
  signalRunStateChanged();
}

// ── Master tick ────────────────────────────────────────────────────────────
export function tickTechTree(t) {
  initTechState();
  tickMegaProject(t);
  _updateMegaProjectPanel();
}

// ── Mega-Project Panel UI ─────────────────────────────────────────────────
// FIX P0: initMegaProject was never called from anywhere. This function
// renders the launcher in the #mega-project-section HUD element and
// calls initMegaProject() when the player clicks a project button.
let _mpPanelLastState = '';
function _updateMegaProjectPanel() {
  const section = document.getElementById('mega-project-section');
  if (!section) return;

  const mp = G.megaProject;
  const lang = typeof getLang === 'function' ? getLang() : 'de';

  // Derive a compact state fingerprint to avoid thrashing the DOM
  const stateKey = mp
    ? `${mp.id}:${mp.active}:${mp.complete}:${Math.floor(mp.energyChannelled / 10)}`
    : 'none';
  if (stateKey === _mpPanelLastState) return;
  _mpPanelLastState = stateKey;

  section.style.display = '';
  const statusEl = document.getElementById('mega-project-status');
  const btnWrap  = document.getElementById('mega-project-buttons');

  if (mp && mp.complete) {
    if (statusEl) statusEl.textContent = lang === 'de' ? '✓ Projekt abgeschlossen!' : '✓ Project complete!';
    if (btnWrap)  btnWrap.innerHTML = '';
    return;
  }

  if (mp && mp.active) {
    const pct = Math.min(100, Math.round((mp.energyChannelled / mp.requiredEnergy) * 100));
    const label = lang === 'de' ? mp.labelDe : mp.labelEn;
    if (statusEl) statusEl.textContent = `▸ ${label} — ${pct}% (${Math.round(mp.sustainedSeconds)}/${mp.duration}s)`;
    if (btnWrap)  btnWrap.innerHTML = '';
    return;
  }

  // No active project — show launcher buttons
  if (statusEl) statusEl.textContent = lang === 'de' ? 'Kein aktives Projekt' : 'No active project';
  if (btnWrap) {
    btnWrap.innerHTML = MEGA_PROJECTS.map(p => `
      <button
        class="mbtn"
        style="font-size:10px;padding:3px 6px;margin:0;text-align:left;"
        data-mpid="${p.id}"
        title="${lang === 'de' ? p.labelDe : p.labelEn}"
      >⬡ ${lang === 'de' ? p.labelDe : p.labelEn}</button>
    `).join('');
    btnWrap.querySelectorAll('button[data-mpid]').forEach(btn => {
      btn.addEventListener('click', () => {
        initMegaProject(btn.dataset.mpid);
        _mpPanelLastState = ''; // force redraw
      });
    });
  }
}
