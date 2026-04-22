/**
 * SYNAPSE v96 — Strategic Economy System
 *
 * Implements the city-builder / engine-builder shift:
 *   1. Tick-based automatic Pulse economy (no more timing pressure)
 *   2. Bandwidth limits & bottleneck detection on links
 *   3. Upkeep costs (Brownouts when income < upkeep)
 *   4. Resource refinement chain: Raw Data → Processed Data → Knowledge
 *   5. Adjacency bonuses & interference penalties
 *   6. Terrain / sector properties on the grid
 */

import { G } from '../state/gameState.js';
import { TUNING } from '../state/tuning.js';
import { gameNodes, gameLinks, spawnShock } from '../layers/network/index.js';
import { eventMods } from '../state/gameplayFlags.js';
import { showToast } from '../ui/hud/index.js';
import { signalEnergyChanged } from '../platform/stateSignals.js';
import { getLang } from '../state/settings.js';

// ── Economy state (attached to G on init) ─────────────────────────────────
export function initEconomyState() {
  if (G.eco) return;
  G.eco = {
    rawData:          0,
    processedData:    0,
    knowledge:        0,
    totalUpkeep:      0,
    brownoutActive:   false,
    brownoutSince:    0,
    bottlenecks:      [],
    autoPulseEnabled: true,
    lastAutoPulseTick: 0,
    lastRefineTick:   0,
    _adjCacheDirty:   true,
    _synergies:       [],
    _interferences:   [],
    _brownoutTickCount: 0,
    _lastUpkeepTick:  0,
    _bottleneckCount: 0,
    _nodeLinkCache:   new Map(),
  };
}

// ── Tuning ────────────────────────────────────────────────────────────────
export const ECO_TUNING = {
  autoPulseInterval:     5.0,
  linkBandwidthBase:     { stable: 3, fast: 5, resonance: 4, fragile: 2 },
  bottleneckDecayRate:   0.15,
  upkeepPerNode:         { amplifier: 1, memory: 1, catalyst: 2, relay: 0, source: 0 },
  upkeepPerCluster:      2,
  brownoutGraceTicks:    3,
  rawDataPerSource:      1,
  rawPerProcessed:       3,
  processedPerKnowledge: 4,
  synergyDistance:       2.5,
  interferenceDistance:  1.8,
  ampMemFlankBonus:      1.6,
  sourceSrcInterferePenalty: 0.30,
};

// ── 1. AUTO-PULSE TICK ─────────────────────────────────────────────────────
export function tickAutoPulse(t) {
  if (!G.eco || !G.eco.autoPulseEnabled) return;
  if (!G.l3On && !G.l2On) return;
  if (t - G.eco.lastAutoPulseTick < ECO_TUNING.autoPulseInterval) return;
  G.eco.lastAutoPulseTick = t;

  let signalsFired = 0;
  for (const link of gameLinks) {
    const cap = ECO_TUNING.linkBandwidthBase[link.type] || 3;
    if ((link._signalLoad || 0) < cap) {
      link._autoPulseQueued = true;
      signalsFired++;
    }
  }
  if (signalsFired > 0) {
    const lang = getLang();
    showToast(
      lang === 'de' ? '⟳ NETZ-PULS' : '⟳ NETWORK PULSE',
      lang === 'de' ? signalsFired + ' Link(s) aktiv' : signalsFired + ' link(s) active',
      700
    );
  }
}

// ── 2. BANDWIDTH & BOTTLENECK TRACKING ─────────────────────────────────────
export function tickBandwidth() {
  if (!G.eco) return;
  G.eco.bottlenecks = [];
  let totalDecay = 0;

  for (const link of gameLinks) {
    const cap  = ECO_TUNING.linkBandwidthBase[link.type] || 3;
    const load = link._signalLoad || 0;
    link._overCapacity = load > cap;
    if (link._overCapacity) {
      G.eco.bottlenecks.push(link);
      totalDecay += (load - cap) * ECO_TUNING.bottleneckDecayRate;
      link._bottleneckIntensity = Math.min(1, (load - cap) / cap);
    } else {
      link._bottleneckIntensity = 0;
    }
  }

  if (totalDecay > 0) {
    G.energy = Math.max(0, G.energy - totalDecay);
    signalEnergyChanged();
  }
  G.eco._bottleneckCount = G.eco.bottlenecks.length;
}

// ── 3. UPKEEP & BROWNOUTS ──────────────────────────────────────────────────
// FIX P0: tickUpkeep() disabled — heartbeat.js::_chargeUpkeep() is the single
// canonical upkeep system (v97+). Running both caused double energy drain and
// duplicate BROWNOUT toast messages. Keep export so callers don't break.
export function tickUpkeep(_t) { return; /* intentionally no-op */ }
function _tickUpkeep_DISABLED(t) {
  if (!G.eco) return;
  if (t - G.eco._lastUpkeepTick < 1.0) return;
  G.eco._lastUpkeepTick = t;

  let upkeep = 0;
  for (const node of gameNodes) {
    upkeep += ECO_TUNING.upkeepPerNode[node.type] || 0;
    if (node._brownedOut && G.energy >= upkeep) node._brownedOut = false;
  }
  upkeep += (G.l3CapturedClusters || 0) * ECO_TUNING.upkeepPerCluster;
  upkeep  = Math.ceil(upkeep * (eventMods._upkeepMult || 1.0));
  G.eco.totalUpkeep = upkeep;

  if (G.energy < upkeep) {
    G.eco._brownoutTickCount++;
    if (G.eco._brownoutTickCount >= ECO_TUNING.brownoutGraceTicks && !G.eco.brownoutActive) {
      _triggerBrownout(t);
    } else if (G.eco._brownoutTickCount === 1) {
      const lang = getLang();
      showToast(
        lang === 'de' ? '⚠ ENERGY-MANGEL' : '⚠ ENERGY DEFICIT',
        lang === 'de'
          ? 'Upkeep ' + upkeep + '⬡ > Vorrat ' + Math.floor(G.energy) + '⬡'
          : 'Upkeep ' + upkeep + '⬡ > reserve ' + Math.floor(G.energy) + '⬡',
        2000
      );
    }
  } else {
    G.eco._brownoutTickCount = 0;
    if (G.eco.brownoutActive) _recoverFromBrownout();
    G.energy -= upkeep;
    signalEnergyChanged();
  }
}

function _triggerBrownout(t) {
  G.eco.brownoutActive = true;
  G.eco.brownoutSince  = t;
  const lang = getLang();
  showToast(
    lang === 'de' ? '🔴 BROWNOUT' : '🔴 BROWNOUT',
    lang === 'de'
      ? 'Netz-Kollaps! Nicht-essentielle Nodes offline'
      : 'Network collapse! Non-essential nodes going offline',
    3500
  );
  spawnShock(0xff4400);
  spawnShock(0xaa2200);

  const candidates = gameNodes
    .filter(n => !n.isMain && (n.type === 'amplifier' || n.type === 'memory' || n.type === 'catalyst'))
    .sort((a, b) => (ECO_TUNING.upkeepPerNode[b.type] || 0) - (ECO_TUNING.upkeepPerNode[a.type] || 0));

  let relieved = 0;
  for (const node of candidates) {
    if (G.energy + relieved >= G.eco.totalUpkeep) break;
    node._brownedOut = true;
    relieved += ECO_TUNING.upkeepPerNode[node.type] || 0;
  }
}

function _recoverFromBrownout() {
  G.eco.brownoutActive    = false;
  G.eco._brownoutTickCount = 0;
  for (const node of gameNodes) node._brownedOut = false;
  const lang = getLang();
  showToast(
    lang === 'de' ? '✅ NETZ STABIL' : '✅ NETWORK STABLE',
    lang === 'de' ? 'Alle Nodes wieder online' : 'All nodes back online',
    2000
  );
}

// ── 4. RESOURCE REFINEMENT CHAIN ──────────────────────────────────────────
export function tickRefinement(t) {
  if (!G.eco) return;
  const interval = TUNING.sourceTick || 5;
  if (t - G.eco.lastRefineTick < interval) return;
  G.eco.lastRefineTick = t;

  const srcCount = gameNodes.filter(n => n.type === 'source'  && !n.isMain && !n._brownedOut).length;
  const relCount = gameNodes.filter(n => n.type === 'relay'   && !n._brownedOut).length;
  const memCount = gameNodes.filter(n => n.type === 'memory'  && !n._brownedOut).length;

  G.eco.rawData += srcCount * ECO_TUNING.rawDataPerSource;

  if (relCount > 0 && G.eco.rawData >= ECO_TUNING.rawPerProcessed) {
    const batch = Math.min(relCount, Math.floor(G.eco.rawData / ECO_TUNING.rawPerProcessed));
    G.eco.rawData       -= batch * ECO_TUNING.rawPerProcessed;
    G.eco.processedData += batch;
  }

  if (memCount > 0 && G.eco.processedData >= ECO_TUNING.processedPerKnowledge) {
    const batch = Math.min(memCount, Math.floor(G.eco.processedData / ECO_TUNING.processedPerKnowledge));
    G.eco.processedData -= batch * ECO_TUNING.processedPerKnowledge;
    G.eco.knowledge     += batch;
    if (batch >= 2) {
      const lang = getLang();
      showToast(
        lang === 'de' ? '◈ WISSEN +' + batch : '◈ KNOWLEDGE +' + batch,
        lang === 'de' ? 'Verarbeitungskette aktiv' : 'Refinement chain active',
        1200
      );
    }
  }

  if (G.eco.knowledge > 0) G._knowledgePending = true;
}

// ── 5. ADJACENCY BONUSES & INTERFERENCE ────────────────────────────────────
export function rebuildAdjacencyCache() {
  if (!G.eco || !G.eco._adjCacheDirty) return;
  G.eco._adjCacheDirty = false;
  G.eco._synergies     = [];
  G.eco._interferences = [];

  const nodeLinkCache = new Map();
  for (const node of gameNodes) {
    node._interfering = false;
    nodeLinkCache.set(node._id, []);
  }
  for (const link of gameLinks) {
    const srcLinks = nodeLinkCache.get(link._src);
    const tgtLinks = nodeLinkCache.get(link._tgt);
    if (srcLinks) srcLinks.push(link);
    if (tgtLinks && tgtLinks !== srcLinks) tgtLinks.push(link);
  }
  G.eco._nodeLinkCache = nodeLinkCache;

  const nodes = gameNodes.filter(n => !n.isMain);

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dist = _nodeDist(a, b);

      if (dist <= ECO_TUNING.synergyDistance) {
        if ((a.type === 'amplifier' && b.type === 'memory') ||
            (a.type === 'memory'    && b.type === 'amplifier')) {
          const amp = a.type === 'amplifier' ? a : b;
          const mem = a.type === 'memory'    ? a : b;
          const others = nodes.filter(n => n !== mem && n.type === 'memory' && _nodeDist(amp, n) <= ECO_TUNING.synergyDistance);
          if (others.length >= 1) {
            G.eco._synergies.push({ nodeA: amp, nodeB: mem, bonus: ECO_TUNING.ampMemFlankBonus });
          }
        }
      }

      if (dist <= ECO_TUNING.interferenceDistance && a.type === 'source' && b.type === 'source') {
        G.eco._interferences.push({ nodeA: a, nodeB: b, malus: ECO_TUNING.sourceSrcInterferePenalty });
        a._interfering = true;
        b._interfering = true;
      }
    }
  }

  // Clear stale interference flags
  for (const n of nodes) {
    if (n.type !== 'source') continue;
    if (!G.eco._interferences.some(i => i.nodeA === n || i.nodeB === n)) n._interfering = false;
  }
}

export function applyAdjacencyBonuses() {
  if (!G.eco) return;
  for (const syn of G.eco._synergies) {
    const mem = syn.nodeA.type === 'memory' ? syn.nodeA : syn.nodeB;
    if (mem.memCharge !== undefined) mem._flankingBonus = syn.bonus;
  }
}

function _nodeDist(a, b) {
  if (!a.m || !b.m) return Infinity;
  const p = a.m.position, q = b.m.position;
  return Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2);
}

// ── 6. TERRAIN / SECTOR PROPERTIES ────────────────────────────────────────
export function generateTerrain(gridSize = 8) {
  if (!G.eco) return;
  const sectors = [];
  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      const roll = Math.random();
      let type = 'normal';
      if      (roll < 0.12) type = 'corrupted';
      else if (roll < 0.20) type = 'resonance';
      else if (roll < 0.26) type = 'dataOcean';
      sectors.push({ x, y, type });
    }
  }
  G.eco.terrain = sectors;
}

export function getTerrainAt(wx, wy) {
  if (!G.eco?.terrain) return 'normal';
  const gx = Math.floor((wx + 5) / 10 * 8);
  const gy = Math.floor((wy + 5) / 10 * 8);
  return G.eco.terrain.find(s => s.x === gx && s.y === gy)?.type || 'normal';
}

export function getTerrainCostMult(wx, wy) {
  const t = getTerrainAt(wx, wy);
  return t === 'corrupted' ? 1.5 : t === 'resonance' ? 0.8 : 1.0;
}

export function getTerrainPassiveBonus(node) {
  if (!node?.m) return 1.0;
  const p = node.m.position;
  const t = getTerrainAt(p.x, p.y);
  if (t === 'resonance') return 1.35;
  if (t === 'dataOcean' && node.type === 'memory') return 1.5;
  return 1.0;
}

// ── Master tick ────────────────────────────────────────────────────────────
export function tickEconomy(t) {
  initEconomyState();
  tickAutoPulse(t);
  tickBandwidth();
  tickUpkeep(t);
  tickRefinement(t);
  rebuildAdjacencyCache();
  applyAdjacencyBonuses();
}

export function markTopologyDirty() {
  if (G.eco) G.eco._adjCacheDirty = true;
}
