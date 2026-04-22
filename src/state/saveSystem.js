/**
 * SYNAPSE v98 — Save System
 * Migrated from v89→v95 p0patched (lines 5406–5600)
 *
 * Schema version: v98-save-1 (bumped from v95-save-1)
 * Active key:     synapse_save_v98
 *
 * MIGRATION NOTES:
 *   - Legacy keys (v57, v58, v81_1) are read for one-time migration then DELETED.
 *   - exportState() converts Sets to arrays (JSON-safe).
 *   - importState() converts arrays back to Sets.
 *   - QuotaExceededError surfaces a user-visible toast (J-04).
 */

import { Vector3 as _Vector3 } from 'three';
import { G } from './gameState.js';
import { synSettings, getLang } from './settings.js';
import { metaState } from './metaState.js';
import { exportRunContextState, restoreRunContextState } from './runContext.js';
import { gameplayFlags } from './gameplayFlags.js';
import { getActionStateSnapshot } from './actionState.js';
import { aiState, exportAIRuntimeState, restoreAIRuntimeState } from './aiShared.js';
import { G_DRAFT, comboState, getActiveQuestline, getQuestProgress } from '../meta/flow.js';
import { protocolState, PROTOCOL_DEFS } from '../systems/protocols.js';
import { exportBossRuntimeState, restoreBossRuntimeState } from './bossShared.js';
import { G_EVENT } from '../systems/events.js';
import { makeNode, makeLink, gameNodes, gameLinks, checkTris, resetLayer1Runtime } from '../layers/network/index.js';
import { showToast } from '../ui/hud/index.js';
import { regTimer, clearTimer } from '../registries/timerRegistry.js';

// Probe storage health early so the player gets a banner instead of silently
// losing progress when the browser blocks localStorage.
import { checkStorageHealth } from '../platform/safeStorage.js';
try { checkStorageHealth(); } catch (_) {}

// ── Schema constants ──────────────────────────────────────────────────────
// v98 adds: G.awakening, G._epochIndex, Genetic Memory, Daemons-State.
// Tech unlocks moved into G.tech.unlocked Set (legacy _techUnlocked_* flags removed).
export const SAVE_SCHEMA_VERSION = 'v98-save-1';
export const LS_SAVE             = 'synapse_save_v98';
export const LS_SAVE_BACKUP      = 'synapse_save_v95_bak';

const SAVE_WRITE_DEBOUNCE_MS = 180;
const SAVE_BACKUP_INTERVAL_MS = 90_000;
const URGENT_SAVE_LABELS = new Set([
  'migration',
  'safe-restart',
  'return-to-title',
  'visibility-hidden',
  'beforeunload',
  'pagehide',
  'runtime-error',
  'unhandled-rejection',
]);

const _saveStats = {
  pending: false,
  pendingLabel: '',
  lastLabel: '',
  lastSaveAt: 0,
  lastDurationMs: 0,
  lastBytes: 0,
  flushCount: 0,
  queuedCount: 0,
  skipCount: 0,
  failCount: 0,
  backupWrites: 0,
  lastBackupAt: 0,
  lastLoadSource: 'none',
  lastError: '',
};

let _pendingSaveLabel = '';
let _lastSerialized = '';

// Legacy keys — read once for migration, then deleted
// v90 keys added so existing saves forward-migrate to v95 on first load
const LS_LEGACY_KEYS = [
  'synapse_save_v95',
  'synapse_save_v90',
  'synapse_save_v90_bak',
  'synapse_save_v81_1',
  'synapse_save_v58',
  'synapse_save_v57',
];
const ACCEPTED_VERSIONS = ['v57', 'v58', 'v85-save-1', 'v90-save-1', 'v90-save-2', 'v95-save-1', SAVE_SCHEMA_VERSION];

// ── Serialisers ───────────────────────────────────────────────────────────

/** Convert a Set to a plain array for JSON. */
const setToArr = s => [...s];
/** Convert an array (or Set) back to a Set. */
const toSet    = a => new Set(Array.isArray(a) ? a : [...(a || [])]);

function _setRunMeta(ts = Date.now()) {
  try {
    localStorage.setItem('synapse_run', JSON.stringify({
      active: !G.runWon,
      difficulty: synSettings.difficulty || 'normal',
      ts,
      hasSave: !G.runWon,
    }));
    return true;
  } catch (e) {
    _saveStats.lastError = e?.message || String(e || 'run-meta-failed');
    return false;
  }
}

function _showSaveFailure(e) {
  _saveStats.failCount++;
  _saveStats.lastError = e?.message || String(e || 'unknown');
  if (e?.name === 'QuotaExceededError') {
    const lang = getLang();
    const msg  = lang === 'de'
      ? 'Speicherplatz voll — Fortschritt konnte nicht gesichert werden.'
      : 'Storage full — progress could not be saved.';
    try {
      showToast(lang === 'de' ? 'Speicher voll' : 'Storage full', msg, 4000);
    } catch (_) {
      console.error('[Synapse save] QuotaExceededError:', e.message);
    }
    return;
  }
  console.warn('[Synapse save] Persist failed:', e?.message || e);
}

function _shouldWriteBackup(label, now) {
  return URGENT_SAVE_LABELS.has(label)
    || label === 'manual'
    || label === 'migration'
    || !_saveStats.lastBackupAt
    || (now - _saveStats.lastBackupAt) >= SAVE_BACKUP_INTERVAL_MS;
}

function _writeSaveNow(label = 'manual', forceBackup = false) {
  const startedAt = performance.now();
  const ts = Date.now();
  try {
    const state = exportState();
    const serialized = JSON.stringify(state);
    const bytes = serialized.length;
    const shouldWriteBackup = forceBackup || _shouldWriteBackup(label, ts);

    if (serialized === _lastSerialized && !shouldWriteBackup) {
      _saveStats.skipCount++;
      _saveStats.lastLabel = label;
      _saveStats.lastSaveAt = ts;
      _saveStats.lastDurationMs = +(performance.now() - startedAt).toFixed(2);
      _saveStats.lastBytes = bytes;
      _saveStats.lastError = '';
      _setRunMeta(ts);
      return true;
    }

    localStorage.setItem(LS_SAVE, serialized);

    let backupFailed = null;
    if (shouldWriteBackup) {
      try {
        localStorage.setItem(LS_SAVE_BACKUP, serialized);
        _saveStats.backupWrites++;
        _saveStats.lastBackupAt = ts;
      } catch (e) {
        backupFailed = e;
      }
    }

    const runMetaOk = _setRunMeta(ts);

    _lastSerialized = serialized;
    _saveStats.flushCount++;
    _saveStats.lastLabel = label;
    _saveStats.lastSaveAt = ts;
    _saveStats.lastDurationMs = +(performance.now() - startedAt).toFixed(2);
    _saveStats.lastBytes = bytes;
    _saveStats.lastError = '';

    if (backupFailed) _showSaveFailure(backupFailed);
    else if (!runMetaOk && !_saveStats.lastError) _saveStats.lastError = 'run-meta-failed';

    return true;
  } catch (e) {
    _showSaveFailure(e);
    return false;
  }
}

function _clearPendingSaveTimer() {
  clearTimer('queuedSaveFlush');
  _saveStats.pending = false;
  _saveStats.pendingLabel = '';
}

function _scheduleSave(label) {
  _pendingSaveLabel = label || _pendingSaveLabel || 'queued';
  _saveStats.pending = true;
  _saveStats.pendingLabel = _pendingSaveLabel;
  _saveStats.queuedCount++;
  regTimer('queuedSaveFlush', setTimeout(() => {
    const flushLabel = _pendingSaveLabel || 'queued';
    _pendingSaveLabel = '';
    _clearPendingSaveTimer();
    _writeSaveNow(flushLabel);
  }, SAVE_WRITE_DEBOUNCE_MS), 'timeout');
}

export function flushPendingSave(reason = 'flush') {
  if (!_saveStats.pending && !_pendingSaveLabel) return false;
  const label = _pendingSaveLabel || reason || 'flush';
  _pendingSaveLabel = '';
  _clearPendingSaveTimer();
  return _writeSaveNow(label, true);
}

export function getSavePerfStats() {
  return {
    ..._saveStats,
    backupKey: LS_SAVE_BACKUP,
    saveKey: LS_SAVE,
  };
}

// ── Export ────────────────────────────────────────────────────────────────

/**
 * Produce a serialisable snapshot of the current run state.
 * Called by persistSave() and by the migration validator.
 * @returns {object}
 */
export function exportState() {
  // Nodes: position + type (Three.js mesh is rebuilt on load)
  const nodes = gameNodes.map(n => ({
    x: n.base.x, y: n.base.y, z: n.base.z,
    type: n.type, isMain: n.isMain,
    memCharge: n.memCharge || 0,
    createdAt: n.createdAt || Date.now(),
  }));

  // Links: node index pairs + type
  const links = gameLinks.map(lk => ({
    a: gameNodes.indexOf(lk.a),
    b: gameNodes.indexOf(lk.b),
    type: lk.type,
  })).filter(lk => lk.a !== -1 && lk.b !== -1);

  return {
    _v: SAVE_SCHEMA_VERSION,
    _savedAt: Date.now(),

    // Core game state (Sets → arrays)
    G: {
      energy:       G.energy,
      autoOn:       G.autoOn,
      l2On:         G.l2On,
      l3On:         G.l3On,
      pulseCount:   G.pulseCount,
      peakEnergy:   G.peakEnergy,
      runStart:     G.runStart,
      mode:         G.mode,
      nType:        G.nType,
      lType:        G.lType,
      typesOn:      G.typesOn,
      l3CapturedClusters: G.l3CapturedClusters,
      spineLength:  G.spineLength,
      objectives:   G.objectives,
      l3Objectives: G.l3Objectives,
      l3Clusters:   G.l3Clusters,
      fusedPairs:   setToArr(G.fusedPairs),
      spineNodes:   setToArr(G.spineNodes),
    },

    // Sprint 3: Research & Projects state
    research: G.research ? {
      data:      G.research.data,
      completed: [...(G.research.completed || [])],
      activeId:  G.research.activeId,
      activeBeats: G.research.activeBeats,
    } : null,

    // FIX: v98 Awakening state — epochIndex, bossAssimilated, daemonSlots
    awakening: G.awakening ? {
      epochIndex:       G.awakening.epochIndex       || 0,
      bossAssimilated:  G.awakening.bossAssimilated  || false,
      energyCollected:  G.awakening.energyCollected  || 0,
      daemonUnlocked:   G.awakening.daemonUnlocked   || false,
      daemonSlots:      JSON.parse(JSON.stringify(G.awakening.daemonSlots || [])),
      nodeEvolutions:   Object.assign({}, G.awakening.nodeEvolutions || {}),
    } : null,

    // AI meta state
    aiState: aiState ? exportAIRuntimeState() : null,

    // Draft / upgrade state
    draft: {
      appliedUpgrades: G_DRAFT?.appliedUpgrades || [],
      draftCount:      G_DRAFT?.draftCount      || 0,
      lastDraftTime:   G_DRAFT?.lastDraftTime   || 0,
      firstDraftDone:  !!G_DRAFT?.firstDraftDone,
      nextDraftIn:     G_DRAFT?.nextDraftIn     || 0,
      active:          !!G_DRAFT?.active,
    },

    questProgress: getQuestProgress() ? { ...getQuestProgress() } : {},
    activeQuestline: getActiveQuestline() ? {
      ...getActiveQuestline(),
      steps: Array.isArray(getActiveQuestline().steps)
        ? getActiveQuestline().steps.map(step => ({ ...step }))
        : [],
    } : null,
    combo: comboState ? { ...comboState } : null,
    runContext: exportRunContextState(),
    layer3Runtime: {
      activeProjects: Array.isArray(G.activeProjects) ? G.activeProjects.map(project => ({
        id: project.id,
        triggered: !!project.triggered,
        active: !!project.active,
        stored: project.stored || 0,
        _startTime: project._startTime || 0,
      })) : [],
      projectSlotsUsed: G.projectSlotsUsed || 0,
    },

    // Event state
    events: {
      eventCount:  G_EVENT?.eventCount  || 0,
      nextEventIn: G_EVENT?.nextEventIn || 0,
    },

    // Boss state
    boss: exportBossRuntimeState(),

    gameplayFlags: {
      eliteCaptureRareChainBonus: !!gameplayFlags.eliteCaptureRareChainBonus,
      eliteCaptureFortifiedSpine: !!gameplayFlags.eliteCaptureFortifiedSpine,
      phantomNexusEchoBonus: gameplayFlags.phantomNexusEchoBonus || 0,
      resonanceDebtPulseCount: gameplayFlags.resonanceDebtPulseCount || 0,
    },

    actionState: getActionStateSnapshot(),
    protocolId: protocolState.activeProtocolId || null,
    telemetry: metaState.telemetry ? JSON.parse(JSON.stringify(metaState.telemetry)) : null,
    timeline: Array.isArray(metaState.runTimeline) ? metaState.runTimeline.map(item => ({ ...item })) : [],
    eliteResults: Array.isArray(metaState.eliteResults) ? metaState.eliteResults.map(item => ({ ...item })) : [],

    nodes,
    links,
  };
}

// ── Persist ───────────────────────────────────────────────────────────────

/**
 * Serialise and write the current state to localStorage.
 * Non-urgent writes are coalesced to avoid repeated stringify + localStorage churn.
 * @param {string} [label='manual'] - context label for debugging
 * @param {object|boolean} [opts]
 */
export function persistSave(label = 'manual', opts = undefined) {
  const immediate = opts === true || opts?.immediate === true || URGENT_SAVE_LABELS.has(label);
  if (immediate) {
    flushPendingSave(label);
    return _writeSaveNow(label, true);
  }
  _scheduleSave(label);
  return true;
}

// ── Restore ───────────────────────────────────────────────────────────────

/**
 * Check whether a saved state exists and is structurally valid.
 * Falls back to the mirrored backup key when the primary save is missing/corrupt.
 * @returns {object|null} parsed save or null
 */
export function loadSave() {
  for (const key of [LS_SAVE, LS_SAVE_BACKUP, ...LS_LEGACY_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const save = JSON.parse(raw);
      if (!ACCEPTED_VERSIONS.includes(save._v)) continue;
      _saveStats.lastLoadSource = key;
      if (key === LS_SAVE_BACKUP) {
        try { localStorage.setItem(LS_SAVE, raw); } catch (_) {}
      }
      return { save, key };
    } catch (_) {}
  }
  _saveStats.lastLoadSource = 'none';
  return null;
}

/**
 * Apply a save object back onto G and the global game state.
 * Also deletes legacy localStorage keys after successful migration.
 * @param {object} save - parsed save object from loadSave()
 */
export function applyRestoredState(save) {
  if (!save || !save.G) return;

  const src = save.G;
  G.energy      = src.energy     ?? 0;
  G.autoOn      = src.autoOn     ?? false;
  G.l2On        = src.l2On       ?? false;
  G.l3On        = src.l3On       ?? false;
  G.pulseCount  = src.pulseCount ?? 0;
  G.peakEnergy  = src.peakEnergy ?? 0;
  G.runStart    = src.runStart   ?? Date.now();
  G.mode        = src.mode       ?? 'place';
  G.nType       = src.nType      ?? 'source';
  G.lType       = src.lType      ?? 'stable';
  G.typesOn     = src.typesOn    ?? false;
  G.l3CapturedClusters = src.l3CapturedClusters ?? 0;
  G.spineLength = src.spineLength ?? 0;

  if (Array.isArray(src.objectives))   G.objectives   = src.objectives;
  if (Array.isArray(src.l3Objectives)) G.l3Objectives = src.l3Objectives;
  if (Array.isArray(src.l3Clusters))   G.l3Clusters   = src.l3Clusters;
  if (Array.isArray(src.fusedPairs))   G.fusedPairs   = toSet(src.fusedPairs);
  if (Array.isArray(src.spineNodes))   G.spineNodes   = toSet(src.spineNodes);

  if (save.protocolId) {
    protocolState.activeProtocolId = save.protocolId;
    protocolState.activeProtocol = PROTOCOL_DEFS?.[save.protocolId] || null;
  }

  restoreRunContextState(save);

  if (save.boss) {
    restoreBossRuntimeState(save.boss);
  }

  if (save.layer3Runtime) {
    G.activeProjects = Array.isArray(save.layer3Runtime.activeProjects)
      ? save.layer3Runtime.activeProjects.map(project => ({ ...project }))
      : [];
    G.projectSlotsUsed = save.layer3Runtime.projectSlotsUsed || 0;
  }

  // Sprint 3: Restore research state
  if (save.research) {
    G.research = {
      data:        save.research.data        ?? 0,
      completed:   new Set(Array.isArray(save.research.completed) ? save.research.completed : []),
      activeId:    save.research.activeId    ?? null,
      activeBeats: save.research.activeBeats ?? 0,
    };
  }

  // FIX: Restore v98 Awakening state
  if (save.awakening) {
    if (!G.awakening) G.awakening = {};
    G.awakening.epochIndex      = save.awakening.epochIndex      ?? 0;
    G.awakening.bossAssimilated = save.awakening.bossAssimilated ?? false;
    G.awakening.energyCollected = save.awakening.energyCollected ?? 0;
    G.awakening.daemonUnlocked  = save.awakening.daemonUnlocked  ?? false;
    G.awakening.daemonSlots     = Array.isArray(save.awakening.daemonSlots) ? save.awakening.daemonSlots : [];
    G.awakening.nodeEvolutions  = save.awakening.nodeEvolutions  || {};
  }

  if (save.gameplayFlags) {
    gameplayFlags.eliteCaptureRareChainBonus = !!save.gameplayFlags.eliteCaptureRareChainBonus;
    gameplayFlags.eliteCaptureFortifiedSpine = !!save.gameplayFlags.eliteCaptureFortifiedSpine;
    gameplayFlags.phantomNexusEchoBonus = save.gameplayFlags.phantomNexusEchoBonus || 0;
    gameplayFlags.resonanceDebtPulseCount = save.gameplayFlags.resonanceDebtPulseCount || 0;
  }

  if (save.aiState && aiState) {
    restoreAIRuntimeState(save.aiState);
  }

  // Write back to current-schema key if loaded from a legacy key
  persistSave('migration', { immediate: true });

  // Clean up legacy keys
  LS_LEGACY_KEYS.forEach(k => {
    try { localStorage.removeItem(k); } catch (_) {}
  });
}

export function restoreTopology(save) {
  if (!save) return;

  resetLayer1Runtime();

  const nodes = Array.isArray(save.nodes) ? save.nodes : [];
  const links = Array.isArray(save.links) ? save.links : [];

  window._resumeRestoring = true;
  try {
    nodes.forEach(sn => {
      const node = makeNode(new _Vector3(sn.x || 0, sn.y || 0, sn.z || 0), !!sn.isMain, sn.type || 'source');
      if (!node) return;
      node.memCharge = sn.memCharge || 0;
      node.createdAt = sn.createdAt || Date.now();
    });

    links.forEach(sl => {
      const a = gameNodes[sl.a];
      const b = gameNodes[sl.b];
      if (!a || !b) return;
      makeLink(a, b, sl.type || 'stable');
    });
  } finally {
    window._resumeRestoring = false;
  }

  checkTris();
}

export function isRestoringSave() {
  return !!window._resumeRestoring;
}

// ── Auto-save ─────────────────────────────────────────────────────────────

/** Start 25s auto-save checkpoint timer. */
export function startAutoSave() {
  regTimer('autoSave', setInterval(() => {
    if (!G.autoOn || G.runWon || G.paused) return;
    persistSave('auto-tick');
  }, 25000), 'interval');
}

/** Stop the auto-save timer. */
export function stopAutoSave() {
  clearTimer('autoSave');
  _clearPendingSaveTimer();
  _pendingSaveLabel = '';
}

// ── Backwards-compat globals ──────────────────────────────────────────────
window._saveGame      = persistSave;
window._persistSave   = persistSave;
window._flushPendingSave = flushPendingSave;
window._startAutoSave = startAutoSave;
window._stopAutoSave  = stopAutoSave;
window._restoreTopology = restoreTopology;
