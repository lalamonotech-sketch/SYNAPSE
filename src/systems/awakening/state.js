import { G } from '../../state/gameState.js';
import { safeStorage } from '../../platform/safeStorage.js';
import {
  ROOT_UPGRADE_REQUIRES,
  ROOT_UPGRADE_PROTOCOL_GATES,
  isProtocolGateUnlocked,
} from '../rootServerRules.js';

export const LS_AWAKENING = 'syn_awakening_v98';
export const ENABLE_ASSIMILATION_BANK = false;
export const ENABLE_GENETIC_MEMORY = false;

(function migrateV97toV98() {
  try {
    if (!localStorage.getItem(LS_AWAKENING)) {
      const legacy = localStorage.getItem('syn_awakening_v97');
      if (legacy) {
        localStorage.setItem(LS_AWAKENING, legacy);
        console.info('[Synapse] Migrated save: syn_awakening_v97 → syn_awakening_v98');
      }
    }
  } catch (_) {}
})();

export const EPOCHS = [
  {
    id: 'mechanical',
    label: { de: 'Epoche I · Mechanisch', en: 'Epoch I · Mechanical' },
    bodyClass: 'epoch-mechanical',
    unlockIDs: [],
    threshold: null,
  },
  {
    id: 'reactive',
    label: { de: 'Epoche II · Reaktiv', en: 'Epoch II · Reactive' },
    bodyClass: 'epoch-reactive',
    unlockIDs: ['stats-row', 'data-stat', 'active-projects-hud', 'diag-panel'],
    threshold: 'energy1000',
  },
  {
    id: 'temporal',
    label: { de: 'Epoche III · Temporal', en: 'Epoch III · Temporal' },
    bodyClass: 'epoch-temporal',
    unlockIDs: ['ai-hud', 'history-panel'],
    threshold: 'memoryNode',
  },
  {
    id: 'sentience',
    label: { de: 'Epoche IV · Sentience', en: 'Epoch IV · Sentience' },
    bodyClass: 'epoch-sentience',
    unlockIDs: [],
    threshold: 'bossAssimilated',
  },
];

const DEFAULT_ROOT = {
  awakenPoints: 0,
  totalRuns: 0,
  totalEpochsReached: [0, 0, 0, 0],
  upgrades: {
    startWithRelay: false,
    mnemonic_research: false,
    spine_daemons: false,
    expanded_canvas: false,
  },
  assimilatedBoss: null,
  geneticMemory: null,
};

let rootServer = null;

export function initAwakeningState() {
  if (G.awakening) return;
  G.awakening = {
    epochIndex: 0,
    energyCollected: 0,
    firstMemoryPlaced: false,
    bossAssimilated: false,
    lastEpochCheckT: 0,
    nodeEvolutions: {},
    macroStructures: [],
    daemonSlots: [],
    daemonUnlocked: false,
    daemonCount: 0,
    blueprintMode: false,
    pendingUnlockQueue: [],
    _unlockBusy: false,
  };
}

function sanitizeReleaseDisabledFeatures(rs) {
  if (!ENABLE_ASSIMILATION_BANK) {
    rs.assimilatedBoss = null;
    rs.upgrades.assimilation_bank = false;
  }
  if (!ENABLE_GENETIC_MEMORY) {
    rs.geneticMemory = null;
    rs.upgrades.persistent_seed = false;
  }
}

export function loadRootServer() {
  try {
    const raw = safeStorage.get(LS_AWAKENING);
    if (raw) {
      const parsed = JSON.parse(raw);
      rootServer = {
        ...DEFAULT_ROOT,
        ...parsed,
        upgrades: { ...DEFAULT_ROOT.upgrades, ...(parsed.upgrades || {}) },
      };
    } else {
      rootServer = { ...DEFAULT_ROOT, upgrades: { ...DEFAULT_ROOT.upgrades } };
    }
  } catch (_) {
    rootServer = { ...DEFAULT_ROOT, upgrades: { ...DEFAULT_ROOT.upgrades } };
  }

  sanitizeReleaseDisabledFeatures(rootServer);
  window._rootServer = rootServer;
  return rootServer;
}

export function getRootServer() {
  if (!rootServer) loadRootServer();
  return rootServer;
}

export function saveRootServer() {
  safeStorage.set(LS_AWAKENING, JSON.stringify(rootServer));
}

export function buyRootUpgrade(id, cost) {
  const rs = getRootServer();
  if (rs.upgrades[id]) return false;
  if (rs.awakenPoints < cost) return false;

  const reqs = ROOT_UPGRADE_REQUIRES[id] ?? [];
  for (let i = 0; i < reqs.length; i++) {
    if (!rs.upgrades[reqs[i]]) return false;
  }

  const gate = ROOT_UPGRADE_PROTOCOL_GATES[id] || null;
  if (!isProtocolGateUnlocked(gate, rs.totalRuns)) return false;

  rs.upgrades[id] = true;
  rs.awakenPoints -= cost;
  saveRootServer();
  return true;
}

export function bankAwakeningPoints(runStats) {
  const rs = getRootServer();
  rs.totalRuns++;

  let pts = 0;
  if (runStats.epochReached >= 1) pts += 2;
  if (runStats.epochReached >= 2) pts += 4;
  if (runStats.epochReached >= 3) pts += 8;
  if (runStats.megaProjectComplete) pts += 10;
  if (runStats.runDurationSecs > 300) pts += 2;
  if (runStats.researchBonus > 0) pts += Math.round(runStats.researchBonus);
  pts = Math.round(pts);

  rs.awakenPoints += pts;
  saveRootServer();
  return pts;
}

export function saveGeneticMemory(markedNodeIds, gameNodes, gameLinks) {
  if (!ENABLE_GENETIC_MEMORY) return false;
  const rs = getRootServer();
  if (!rs.upgrades.persistent_seed) return false;

  const nodes = [];
  for (let i = 0; i < gameNodes.length; i++) {
    const node = gameNodes[i];
    if (!markedNodeIds.includes(node._id)) continue;
    nodes.push({ id: node._id, type: node._type, x: node.m.position.x, y: node.m.position.y });
  }

  const links = [];
  for (let i = 0; i < gameLinks.length; i++) {
    const link = gameLinks[i];
    if (!markedNodeIds.includes(link._src) || !markedNodeIds.includes(link._tgt)) continue;
    links.push({ src: link._src, tgt: link._tgt, type: link.type });
  }

  rs.geneticMemory = { nodes, links, savedAt: Date.now() };
  saveRootServer();
  return true;
}

export function getGeneticMemory() {
  if (!ENABLE_GENETIC_MEMORY) return null;
  return getRootServer().geneticMemory || null;
}
