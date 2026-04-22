/**
 * SYNAPSE v98 — Heartbeat (Global Metronome Tick)
 *
 * Replaces the APM-pressure manual Pulse with a global synchronized
 * system heartbeat. Every N seconds all Sources fire simultaneously.
 * A visible light-wave sweeps the grid on each tick.
 *
 * Manual Pulse (Space) still exists but becomes an emergency tool
 * with a much longer cooldown (configurable in tuning.js).
 *
 * Architecture:
 *   - tickHeartbeat(t, dt) is called each frame from gameLoop.js
 *   - When the next beat is due, _fireBeat() runs:
 *       1. Sources produce energy (replaces _tickSource passive drip)
 *       2. All node upkeep is charged
 *       3. Bandwidth load recalculates
 *       4. A wave-ring visual is spawned at grid center
 *   - beatPhase [0..1] is exported for layer1.js shader / glow sync
 *
 * v97 tuning defaults:
 *   BEAT_INTERVAL   = 2.0s   (configurable via TUNING.heartbeatInterval)
 *   EMERGENCY_PULSE_CD = 30s (TUNING.emergencyPulseCd)
 *
 * Bandwidth model (v97 simplified):
 *   Each link type has a max capacity per beat.
 *   Overflow = energy sent - capacity.  Overflow is destroyed.
 *   _bottleneckIntensity on a link drives the heatmap color.
 */

import { G }        from '../state/gameState.js';
import { TUNING }   from '../state/tuning.js';
import { gameNodes, gameLinks, spawnShock } from '../layers/network/index.js';
import { showToast } from '../ui/hud/index.js';
import { signalEnergyChanged } from '../platform/stateSignals.js';
import { getLang }  from '../state/settings.js';
import { checkNodeEvolution } from './awakening.js';
import { detectMacroStructures } from './awakening.js';
import { onBeat as _nomadsOnBeat } from './dataNomads.js';
import { tickResearch, addDataFromMemory } from './research.js';
import { tickPlasticity, getEffectiveLinkCapacity } from './plasticity.js';
import { notifyBeat as _enhNotifyBeat } from '../systems/fx/visualEnhancer.js';
import { finalizeRunFailed } from '../meta/screens.js';

// ── Brownout cascade failure detection ───────────────────────────────────────
// Tracks consecutive beats where every source is in brownout.
let _allSourcesBrownoutBeats = 0;
const ALL_SOURCES_BROWNOUT_THRESHOLD = 2; // beats before triggering fail

// ── Tuning defaults (also live in tuning.js TUNING object) ──────────────────
const HB_DEFAULTS = {
  beatInterval:       2.0,     // seconds between heartbeats
  emergencyPulseCd:  30.0,     // seconds cooldown for manual pulse
  nodeUpkeepTable: {           // energy cost per node type per beat
    source:     0,
    relay:      1,
    amplifier:  2,
    memory:     2,
    catalyst:   3,
  },
  linkCapacity: {              // max energy units through link per beat
    stable:    4,
    fast:      7,
    resonance: 5,
    fragile:   2,
  },
  sourceOutputPerBeat:    8,   // base energy a source emits each beat
  // BUG-3 fix: was 0.22 — synced to match TUNING.sourceSoftcapFactor (tuning.js FIX P2)
  softcapF:               0.35, // diminishing factor for sources beyond softcap
  cortexAuraRadius:       4.0, // Cortex Cell aura energy distribution radius
  aoeEnergyRadius:        2.5, // Pulsing Source AoE radius
  brownoutGraceBeats:     3,   // beats before brownout hits an underpowered node
};

// ── Module state ─────────────────────────────────────────────────────────────
let _lastBeat       = -999;
let _beatCount      = 0;
let _lastEmergency  = -999;
let _statsRowEl     = null;

// Interpolated beat phase for visual glow sync [0..1]
export let beatPhase = 0;

// ── Public API ────────────────────────────────────────────────────────────────

export function tickHeartbeat(t, dt) {
  const interval = TUNING.heartbeatInterval || HB_DEFAULTS.beatInterval;

  // Update beat phase (smooth sine — used by layer1.js for node pulse glow)
  const elapsed = t - _lastBeat;
  beatPhase = Math.max(0, 1.0 - elapsed / interval);

  if (elapsed < interval) return;
  _lastBeat = t;
  _fireBeat(t);
}

/** Emergency manual pulse — still available but long CD */
export function fireEmergencyPulse(t) {
  const cd = TUNING.emergencyPulseCd || HB_DEFAULTS.emergencyPulseCd;
  if (t - _lastEmergency < cd) {
    const remain = Math.ceil(cd - (t - _lastEmergency));
    const lang = getLang();
    showToast(
      lang === 'de' ? `⚡ NOTFALL-PULSE NOCH ${remain}s` : `⚡ EMERGENCY PULSE: ${remain}s`,
      '', 1000
    );
    return false;
  }
  _lastEmergency = t;
  _fireBeat(t, true);
  return true;
}

export function getBeatCount() { return _beatCount; }
export function getLastBeatTime() { return _lastBeat; }

export function resetHeartbeat() {
  _lastBeat               = -999;
  _beatCount              = 0;
  _lastEmergency          = -999;
  beatPhase               = 0;
  _allSourcesBrownoutBeats = 0;
}

// ── Core Beat Logic ───────────────────────────────────────────────────────────

function _fireBeat(t, isEmergency = false) {
  _beatCount++;

  // 1. Topology dirty check → adjacency & macro structures
  _updateAdjacencyCache();
  if (_beatCount % 5 === 0) detectMacroStructures();

  // 2. Source energy production
  const energyProduced = _tickSources(t);

  // 3. Bandwidth routing — distribute energy through links
  _routeEnergy(energyProduced);

  // 4. Node upkeep — charge running costs
  _chargeUpkeep();

  // 5. Refinement tick (Memory nodes produce Knowledge)
  _tickRefinement();

  // 6. Node evolution check
  for (const node of gameNodes) {
    if ((node._energyProduced || 0) >= (TUNING.nodeEvolutionThreshold || 1000)) {
      checkNodeEvolution(node);
    }
  }

  // 7. Visual beat wave
  _spawnBeatWave(t, isEmergency);

  // 8. v98 Visual enhancer — per-source beat rings + motes
  try {
    const srcNodes = [];
    for (const node of gameNodes) {
      if (node.type === 'source' && !node.isMain) srcNodes.push(node);
    }
    _enhNotifyBeat(srcNodes);
  } catch(_) {}

  // v98: Nomad beat processing
  try { _nomadsOnBeat(); } catch(e) {}

  // Sprint 3: Tick the research system every beat
  try { tickResearch(_beatCount); } catch(e) { if (import.meta.env?.DEV) console.warn('[Research] tick error:', e); }
  try { tickPlasticity(); } catch(e) { if (import.meta.env?.DEV) console.warn('[Plasticity] tick error:', e); }  // v98

  // ── Brownout cascade check ───────────────────────────────────────────────
  // If every source node is in brownout for 2 consecutive beats → run failed.
  if (!G.runWon && gameNodes.length > 0) {
    let sourceCount = 0;
    let brownoutSources = 0;
    for (const node of gameNodes) {
      if (node._type !== 'source') continue;
      sourceCount++;
      if (node._brownout) brownoutSources++;
    }
    const allBrownout = sourceCount > 0 && brownoutSources === sourceCount;
    if (allBrownout) {
      _allSourcesBrownoutBeats++;
      if (_allSourcesBrownoutBeats >= ALL_SOURCES_BROWNOUT_THRESHOLD) {
        _allSourcesBrownoutBeats = 0;
        try { finalizeRunFailed(); } catch(e) { console.warn('[Synapse] finalizeRunFailed error:', e); }
      }
    } else {
      _allSourcesBrownoutBeats = 0;
    }
  }

  signalEnergyChanged();
}

// ── Step 2: Source Production ──────────────────────────────────────────────

function _tickSources(t) {
  const base = TUNING.sourceOutputPerBeat || HB_DEFAULTS.sourceOutputPerBeat;
  let totalProduced = 0;

  // Softcap: each source beyond threshold contributes diminishing returns
  const softcapAt = TUNING.sourceSoftcapCount || 4;
  const softcapF  = TUNING.sourceSoftcapFactor || HB_DEFAULTS.softcapF;

  let sourceIndex = 0;
  for (const src of gameNodes) {
    if (src._type !== 'source' || src._brownout) continue;
    let output = base;

    // Terrain bonus
    if (src._terrainBonus) output *= src._terrainBonus;

    // Deep Source evolution
    if (src._deepSource) output *= (1 + (src._sourceRateBonus || 0));

    // Softcap
    if (sourceIndex >= softcapAt) output = Math.max(1, Math.round(output * softcapF));

    // Interference penalty
    if (src._interfering) output *= 0.70;

    output = Math.round(output);
    src._lastOutput = output;
    src._energyProduced = (src._energyProduced || 0) + output;
    totalProduced += output;
    sourceIndex++;
  }

  // Add to global energy
  G.energy = (G.energy || 0) + totalProduced;
  if (G.energy > (G.peakEnergy || 0)) G.peakEnergy = G.energy;

  // Update awakening energy tracking
  if (G.awakening) G.awakening.energyCollected += totalProduced;

  return totalProduced;
}

// ── Step 3: Bandwidth Routing ──────────────────────────────────────────────

function _routeEnergy(totalProduced) {
  const caps = TUNING.linkCapacity || HB_DEFAULTS.linkCapacity;
  const nodeLinkCache = G.eco?._nodeLinkCache;

  // Reset per-beat load counters
  for (const link of gameLinks) {
    link._lastLoad      = link._signalLoad || 0;
    link._signalLoad    = 0;
  }

  // Simple flow: each link gets proportional share of node output
  for (const node of gameNodes) {
    if (node._type !== 'source' || node._brownout) continue;
    const output = node._lastOutput || 0;
    if (!output) continue;

    const outLinks = nodeLinkCache?.get(node._id) || [];
    if (!outLinks.length) continue;

    const perLink = output / outLinks.length;
    for (const link of outLinks) {
      const cap = getEffectiveLinkCapacity(link, caps[link.type] || 4); // v98: plasticity bonus
      const load = perLink;
      const overflow = Math.max(0, load - cap);
      link._signalLoad += Math.min(load, cap);
      link._bottleneckIntensity = Math.min(1, overflow / cap);

      if (overflow > 0 && !link._bottleneckWarned) {
        link._bottleneckWarned = true;
        const lang = getLang();
        showToast(
          lang === 'de' ? '⛔ BANDBREITEN-STAU' : '⛔ BANDWIDTH BOTTLENECK',
          lang === 'de' ? 'Überschüssige Energie geht verloren. Mehr Highways nötig.' : 'Excess energy lost. Build parallel highways.',
          1800
        );
      } else if (!overflow) {
        link._bottleneckWarned = false;
      }
    }
  }
}

// ── Step 4: Node Upkeep & Brownouts ──────────────────────────────────────────

function _chargeUpkeep() {
  const table = TUNING.nodeUpkeepTable || HB_DEFAULTS.nodeUpkeepTable;
  const graceBeats = TUNING.brownoutGraceBeats || HB_DEFAULTS.brownoutGraceBeats;

  let totalUpkeep = 0;
  for (const node of gameNodes) {
    const cost = table[node._type] || 0;
    if (!cost) { node._brownoutGrace = 0; continue; }
    totalUpkeep += cost;
  }

  const canAfford = G.energy >= totalUpkeep;

  if (canAfford) {
    G.energy -= totalUpkeep;
    // Recover brownout nodes
    for (const node of gameNodes) {
      if (node._brownout) {
        node._brownout = false;
        node._brownoutGrace = 0;
        if (node.m?.material) {
          node.m.material.opacity = 1.0;
          if (node.m.material.emissiveIntensity !== undefined) node.m.material.emissiveIntensity = 0.6;
        }
      }
    }
    if (G.eco) { G.eco.brownoutActive = false; G.eco.totalUpkeep = totalUpkeep; }
  } else {
    // Not enough energy — tick brownout grace per node
    for (const node of gameNodes) {
      const cost = table[node._type] || 0;
      if (!cost) continue;
      node._brownoutGrace = (node._brownoutGrace || 0) + 1;
      if (node._brownoutGrace >= graceBeats && !node._brownout) {
        node._brownout = true;
        if (node.m?.material) {
          node.m.material.opacity = 0.35;
          if (node.m.material.emissiveIntensity !== undefined) node.m.material.emissiveIntensity = 0.05;
        }
      }
    }

    if (!G.eco?.brownoutActive) {
      if (G.eco) G.eco.brownoutActive = true;
      const lang = getLang();
      showToast(
        lang === 'de' ? '🔴 BROWNOUT' : '🔴 BROWNOUT',
        lang === 'de' ? 'Energie reicht nicht für Upkeep. Nodes gehen offline.' : 'Insufficient energy for upkeep. Nodes going offline.',
        2200
      );
    }
  }

  // Cortex Cell aura energy distribution (post-upkeep)
  _tickCortexAuras();
}

// ── Step 5: Refinement ────────────────────────────────────────────────────────

function _tickRefinement() {
  if (!G.eco) return;
  for (const mem of gameNodes) {
    if (mem._type !== 'memory' || mem._brownout) continue;
    // Sprint 3: Memory nodes generate Data (◬) every beat
    try { addDataFromMemory(1); } catch(_) {}

    // Memory absorbs energy from adjacent nodes and refines it to Knowledge
    const rate = mem._volatileMemory ? 2.0 : 1.0;
    const knowledgeMult = mem._archiveMemory ? (mem._knowledgeMult || 2.0) : 1.0;

    const absorbed = Math.min(G.energy, Math.round(3 * rate));
    if (absorbed > 0) {
      G.energy -= absorbed;
      G.eco.rawData = (G.eco.rawData || 0) + absorbed;
    }

    // Refine raw → processed → knowledge
    const rawConvert = Math.floor((G.eco.rawData || 0) / 3);
    if (rawConvert > 0) {
      G.eco.rawData -= rawConvert * 3;
      G.eco.processedData = (G.eco.processedData || 0) + rawConvert;
    }
    const procConvert = Math.floor((G.eco.processedData || 0) / 4);
    if (procConvert > 0) {
      G.eco.processedData -= procConvert * 4;
      G.eco.knowledge = (G.eco.knowledge || 0) + Math.round(procConvert * knowledgeMult);
    }
  }
}

// ── Adjacency Cache & Interference ────────────────────────────────────────────

function _updateAdjacencyCache() {
  // Economy owns the authoritative adjacency rebuild. Heartbeat only fills
  // the incident-link cache as a defensive fallback if the economy cache is
  // missing (for example during isolated debugging of the heartbeat module).
  if (!G.eco || G.eco._nodeLinkCache) return;

  const nodeLinkCache = new Map();
  for (const node of gameNodes) nodeLinkCache.set(node._id, []);
  for (const link of gameLinks) {
    const srcLinks = nodeLinkCache.get(link._src);
    const tgtLinks = nodeLinkCache.get(link._tgt);
    if (srcLinks) srcLinks.push(link);
    if (tgtLinks && tgtLinks !== srcLinks) tgtLinks.push(link);
  }
  G.eco._nodeLinkCache = nodeLinkCache;
}

function _getStatsRow() {
  if (_statsRowEl && document.body.contains(_statsRowEl)) return _statsRowEl;
  _statsRowEl = document.getElementById('stats-row');
  return _statsRowEl;
}

function _restartBeatClass(el, className, durationMs) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  setTimeout(() => el.classList.remove(className), durationMs);
}

// ── Cortex Cell Aura ──────────────────────────────────────────────────────────

function _tickCortexAuras() {
  const cortexNodes = gameNodes.filter(n => n._cortexCore && !n._brownout);
  const auraRadius  = TUNING.cortexAuraRadius || HB_DEFAULTS.cortexAuraRadius;
  const aoeRadius   = TUNING.aoeEnergyRadius  || HB_DEFAULTS.aoeEnergyRadius;

  for (const core of cortexNodes) {
    // Cortex aura: passively distributes energy to nearby nodes (no link needed)
    const nearby = gameNodes.filter(n =>
      n !== core && !n._brownout &&
      Math.hypot(n.m.position.x - core.m.position.x, n.m.position.y - core.m.position.y) <= auraRadius
    );
    // FIX P1: was Math.floor(2 / nearby.length) which = 0 for >= 3 nodes.
    // Now each nearby node receives a flat 2⬡ (total pool scales with count).
    // Aura output raised to 6–8⬡ total to make the structure economically viable.
    const AURA_PER_NODE = 2;
    const totalCost = AURA_PER_NODE * nearby.length;
    if (nearby.length > 0 && G.energy >= totalCost) {
      G.energy -= totalCost;
      // Visual: nodes in aura glow briefly
      for (const n of nearby) {
        if (n.m?.material?.emissiveIntensity !== undefined) {
          n.m.material.emissiveIntensity = Math.min(1.5, (n.m.material.emissiveIntensity || 0.6) + 0.3);
        }
      }
    }
  }

  // Pulsing Source AoE
  const aoe = gameNodes.filter(n => n._aoeEnergy && !n._brownout);
  for (const src of aoe) {
    const targets = gameNodes.filter(n =>
      n !== src && !n._brownout &&
      Math.hypot(n.m.position.x - src.m.position.x, n.m.position.y - src.m.position.y) <= aoeRadius
    );
    const bonus = Math.min(targets.length * 2, 8);
    if (bonus > 0) G.energy += bonus;
  }
}

// ── Beat Wave Visual ──────────────────────────────────────────────────────────

function _spawnBeatWave(t, isEmergency) {
  // Spawn a concentric shockwave ring from the grid centre.
  try {
    const color = isEmergency ? 0xff4422 : 0x44ccff;
    // layer1.spawnShock signature is (color, priority)
    spawnShock(color, isEmergency ? 2.0 : 1.0);
  } catch (_) {}

  // Also add a CSS pulse ring on the topbar.
  const topbar = _getStatsRow();
  if (topbar) {
    _restartBeatClass(topbar, 'hb-beat', 400);
  }
}
