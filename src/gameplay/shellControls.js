import { G } from '../state/gameState.js';
import { SFX } from '../audio/sfx.js';
import { perfStats } from '../engine/gameLoop.js';
import { msgStack } from '../ui/actionFlow.js';
import { listenerCount } from '../registries/listenerRegistry.js';
import { activeTimerKeys, regTimer, clearTimer } from '../registries/timerRegistry.js';
import { synSettings, saveSettings } from '../state/settings.js';
import { metaState } from '../state/metaState.js';
import { gameNodes, gameLinks } from '../layers/network/index.js';
import { getActiveBridgeCount } from '../layers/bridge/index.js';
import { initMetaScreens, renderHistoryPanel } from '../meta/screens.js';
import { skipDraft as skipDraftFlow } from '../meta/flow.js';
import { aiState, AI_STAGE_NAMES, loadAIMetaCached } from '../systems/ai.js';
import { cycleNodeRenderMode, getNodeRenderStats, setNodeInstanceThreshold } from '../layers/network/index.js';
import { getFxQualityStats } from '../platform/fxQuality.js';
import { getHUDPerfStats } from '../ui/hud/index.js';
import { getSavePerfStats } from '../state/saveSystem.js';
import { getStateSignalStats } from '../platform/stateSignals.js';

const TRAIT_IDS = ['explorative', 'rhythmic', 'conservative', 'volatile'];

function setShow(id, visible, className = 'show') {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle(className, visible);
}

function setActive(ids, activeId, className = 'active') {
  ids.forEach(id => document.getElementById(id)?.classList.toggle(className, id === activeId));
}

function modalVisible(id) {
  const node = document.getElementById(id);
  if (!node) return false;
  return node.classList.contains('show')
    || node.classList.contains('active')
    || node.classList.contains('vis')
    || node.classList.contains('open')
    || node.style.display === 'block';
}

function anyBlockingOverlayVisible() {
  return modalVisible('draft-overlay')
    || modalVisible('protocol-overlay')
    || modalVisible('settings-overlay')
    || modalVisible('info-overlay')
    || modalVisible('boss-screen')
    || modalVisible('win-screen');
}

function syncPauseOverlay() {
  const shouldShow = !!G.paused && !anyBlockingOverlayVisible();
  setShow('pause-overlay', shouldShow);
  if (shouldShow) msgStack.onPauseOpen();
  else msgStack.onPauseClose();
  return shouldShow;
}

export function setPauseState(paused, { showOverlay = true } = {}) {
  G.paused = !!paused;
  if (!G.paused || !showOverlay) {
    setShow('pause-overlay', false);
    msgStack.onPauseClose();
    return false;
  }
  return syncPauseOverlay();
}

export function resetShellPanelsForRun() {
  ['settings-overlay', 'info-overlay', 'protocol-overlay', 'pause-overlay'].forEach(id => setShow(id, false));
  document.getElementById('history-panel')?.classList.remove('vis');
  document.getElementById('diag-panel')?.classList.remove('open');
  stopDiagRefresh();
  msgStack.onPauseClose();
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  const next = value ?? '—';
  if (node._txt === next) return;
  node._txt = next;
  node.textContent = next;
}

function fmtHeap() {
  const heap = performance?.memory?.usedJSHeapSize;
  if (!heap) return 'n/a';
  return (heap / 1048576).toFixed(1) + ' MB';
}

function fmtBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return '0 B';
  if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

function fmtPct(value) {
  return Math.round(Number(value || 0)) + '%';
}

function profileLabel(profile) {
  if (!profile) return '—';
  const map = {
    analyst: synSettings.lang === 'de' ? 'Analyst' : 'Analyst',
    predator: synSettings.lang === 'de' ? 'Prädator' : 'Predator',
    architect: synSettings.lang === 'de' ? 'Architekt' : 'Architect',
    mnemonic: synSettings.lang === 'de' ? 'Mnemoniker' : 'Mnemonic',
  };
  return map[profile] || profile;
}

function stageLabel() {
  const labels = AI_STAGE_NAMES?.[synSettings.lang] || AI_STAGE_NAMES?.en || [];
  return labels[aiState.awarenessStage || 0] || String(aiState.awarenessStage || 0);
}

function updateFxQualityDiag() {
  const stats = getFxQualityStats();
  setText('diag-fx-quality', `${stats.level.toUpperCase()} · bloom ${stats.bloomBusyStride}/${stats.bloomIdleStride} · sig ${stats.signalRenderStride}/${stats.bridgeSignalRenderStride}`);
}

function updateNodeRenderDiag() {
  const stats = getNodeRenderStats();
  const btn = document.getElementById('diag-node-render-toggle');
  setText('diag-node-render-mode', `${stats.mode.toUpperCase()} @ ${stats.threshold}`);
  setText('diag-node-render-active', stats.activeInstancing ? 'Instanced' : 'Mesh');
  setText('diag-node-render-counts', `${stats.eligibleCount} · H${stats.hysteresis}`);
  if (btn) {
    const next = synSettings.lang === 'de'
      ? `◈ Node-Render: ${stats.mode.toUpperCase()} → wechseln`
      : `◈ Node render: ${stats.mode.toUpperCase()} → cycle`;
    if (btn._txt !== next) {
      btn._txt = next;
      btn.textContent = next;
    }
  }
}

function updatePerfDiag() {
  const hud = getHUDPerfStats();
  const save = getSavePerfStats();
  const signals = getStateSignalStats();
  setText('diag-fps', String(perfStats.fps || 0));
  setText('diag-frame-budget', fmtPct(perfStats.frameBudgetPct || 0));
  setText('diag-heap', fmtHeap());
  setText('diag-nl-count', `${gameNodes.length} × ${gameLinks.length} · br ${getActiveBridgeCount()}`);
  setText('diag-anim-listeners', `${listenerCount()} / ${activeTimerKeys().length}`);
  setText('diag-hud-commits', `Q${hud.queuedMasks} · RAF ${hud.rafFlushes} · DIR ${hud.directFlushes} · SIG ${signals.emits}/${signals.consumes}`);
  const saveLabel = save.pending ? `${save.pendingLabel || 'queued'}…` : (save.lastLabel || 'idle');
  setText('diag-save-io', `${saveLabel} · ${fmtBytes(save.lastBytes)} · ${save.lastDurationMs.toFixed ? save.lastDurationMs.toFixed(2) : save.lastDurationMs}ms`);
  setText('diag-save-source', `${save.lastLoadSource} · bak ${save.backupWrites} · fail ${save.failCount}`);
}

function updateCoreDiag() {
  const meta = loadAIMetaCached();
  const tel = metaState.telemetry || {};
  const energyAvg = tel.energySampleCount ? Math.round(tel.energySampleSum / tel.energySampleCount) : Math.round(G.energy || 0);
  setText('diag-profile-lbl', `${profileLabel(aiState.dominantProfile)} · ${aiState.agentMood || 'dormant'}`);
  setText('diag-stage-v', `${aiState.awarenessStage || 0} · ${stageLabel()}`);
  setText('diag-runs-v', String(aiState.trainingRuns || 0));
  setText('diag-r', String(Math.round(aiState.trainingScores?.routing || 0)));
  setText('diag-t', String(Math.round(aiState.trainingScores?.timing || 0)));
  setText('diag-s', String(Math.round(aiState.trainingScores?.stability || 0)));
  setText('diag-m', String(Math.round(aiState.trainingScores?.memory || 0)));
  TRAIT_IDS.forEach(id => document.getElementById(`dmt-${id}`)?.classList.toggle('active', !!aiState.metaTraits?.[id]));
  setText('diag-meta-traits-global', `Runs ${meta.totalRuns || 0} · Dominant ${profileLabel(meta.dominantOverall)} · Elites ${meta.totalElitesCaptured || 0}`);
  setText('diag-draft-tags', `${(window.G_DRAFT?.appliedUpgrades?.length || 0)} · picks ${(window.G_DRAFT?.draftCount || 0)}`);
  setText('diag-event-uptime', `${tel.layerTimes?.l1 || 0}/${tel.layerTimes?.l2 || 0}/${tel.layerTimes?.l3 || 0}s`);
  setText('diag-boss-windows', `${tel.bossWindowsHit || 0}/${tel.bossWindowsOpened || 0}`);
  setText('diag-energy-m5', `${energyAvg}`);
  setText('diag-energy-m10', `${Math.round(G.peakEnergy || 0)}`);
  setText('diag-energy-m15', `${Math.round(G.energy || 0)}`);
}

function refreshDiagPanel() {
  updateCoreDiag();
  updatePerfDiag();
  updateNodeRenderDiag();
  updateFxQualityDiag();
}

function startDiagRefresh() {
  regTimer('diagRefresh', setInterval(() => {
    const panel = document.getElementById('diag-panel');
    if (!panel?.classList.contains('open')) return;
    refreshDiagPanel();
  }, 300), 'interval');
}

function stopDiagRefresh() {
  clearTimer('diagRefresh');
}

function applySettingsUI() {
  setActive(['diff-easy', 'diff-normal', 'diff-hard'], `diff-${synSettings.difficulty}`);
  setActive(['motion-full', 'motion-reduced', 'motion-minimal'], `motion-${synSettings.motion}`);
  setActive(['graphics-low', 'graphics-medium', 'graphics-high'], `graphics-${synSettings.graphics}`);
  setActive(['lang-de', 'lang-en'], `lang-${synSettings.lang}`);

  const sfxBtn = document.getElementById('sfx-toggle');
  if (sfxBtn) {
    sfxBtn.classList.toggle('active', !!synSettings.sfx);
    sfxBtn.textContent = synSettings.sfx ? (synSettings.lang === 'de' ? 'SFX aktiv' : 'SFX on') : (synSettings.lang === 'de' ? 'SFX aus' : 'SFX off');
  }

  const volumeSlider = document.getElementById('volume-slider');
  const bloomSlider = document.getElementById('bloom-slider');
  if (volumeSlider) volumeSlider.value = String(synSettings.volume);
  if (bloomSlider) bloomSlider.value = String(synSettings.bloom);
  updateVolumeVal(synSettings.volume);
  updateBloomVal(synSettings.bloom);

  document.body.dataset.graphics = synSettings.graphics;
  document.documentElement.lang = synSettings.lang;

  const diffBadge = document.getElementById('diff-badge');
  if (diffBadge) {
    diffBadge.className = synSettings.difficulty;
    diffBadge.id = 'diff-badge';
    diffBadge.textContent = synSettings.difficulty[0].toUpperCase() + synSettings.difficulty.slice(1);
  }
  window._diffDraftCap = synSettings.difficulty === 'easy' ? 4 : synSettings.difficulty === 'hard' ? 2 : 3;

  if (synSettings.sfx) SFX.enable();
  else SFX.disable();
  SFX.setVolume((synSettings.volume || 0) / 100);
  refreshDiagPanel();
}

export function showSettings() { setShow('settings-overlay', true); }
export function closeSettings() { setShow('settings-overlay', false); }
export function showInfo() { setShow('info-overlay', true); }
export function closeInfo() { setShow('info-overlay', false); }

export function togglePause() {
  setPauseState(!G.paused, { showOverlay: true });
}

export function toggleHistory() {
  document.getElementById('history-panel')?.classList.toggle('vis');
  renderHistoryPanel(document.querySelector('#history-tabs .active')?.id?.replace('htab-','') || 'recent');
}

export function switchHistTab(tab) {
  ['recent', 'best', 'codex'].forEach(name => {
    document.getElementById(`htab-${name}`)?.classList.toggle('active', name === tab);
    document.getElementById(`hpane-${name}`)?.classList.toggle('active', name === tab);
  });
  renderHistoryPanel(tab);
}

export function toggleDiag() {
  const panel = document.getElementById('diag-panel');
  if (!panel) return;
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    refreshDiagPanel();
    startDiagRefresh();
  } else {
    stopDiagRefresh();
  }
}

export function cycleDiagNodeRenderMode() {
  const stats = cycleNodeRenderMode();
  refreshDiagPanel();
  console.debug('[Synapse node render]', stats);
  return stats;
}

export function adjustDiagNodeRenderThreshold(delta) {
  const stats = setNodeInstanceThreshold(getNodeRenderStats().threshold + delta);
  refreshDiagPanel();
  console.debug('[Synapse node render threshold]', stats);
  return stats;
}

export function debugSnapshot() {
  console.debug('[Synapse debug snapshot]', {
    game: G,
    aiState,
    perf: perfStats,
    listeners: listenerCount(),
    timers: activeTimerKeys(),
    nodeRender: getNodeRenderStats(),
    fxQuality: getFxQualityStats(),
    hud: getHUDPerfStats(),
    save: getSavePerfStats(),
    stateSignals: getStateSignalStats(),
    telemetry: metaState.telemetry,
  });
  refreshDiagPanel();
}

export function skipDraft() {
  skipDraftFlow();
}

export function setDiff(value) { synSettings.difficulty = value; applySettingsUI(); }
export function setMotion(value) { synSettings.motion = value; applySettingsUI(); }
export function setGraphics(value) { synSettings.graphics = value; applySettingsUI(); }
export function setLang(value) {
  synSettings.lang = value;
  applySettingsUI();
  if (typeof window.__synRelabelButtons === 'function') window.__synRelabelButtons();
  // Update data-de / data-en elements in the title screen
  document.documentElement.lang = value;
  document.querySelectorAll('[data-de][data-en]').forEach(node => {
    node.textContent = value === 'en' ? (node.dataset.en || node.textContent) : (node.dataset.de || node.textContent);
  });
  // Save-card tag
  const scTag = document.getElementById('sc-tag');
  if (scTag) scTag.textContent = value === 'en' ? 'SAVE FOUND · RESUME' : 'SPIELSTAND GEFUNDEN · FORTSETZEN';
}
export function toggleSfx() { synSettings.sfx = !synSettings.sfx; applySettingsUI(); }

export function toggleColorblind() {
  synSettings.colorblind = !synSettings.colorblind;
  document.body.dataset.colorblind = synSettings.colorblind ? 'on' : 'off';
  const btn = document.getElementById('colorblind-toggle');
  if (btn) {
    btn.classList.toggle('active', !!synSettings.colorblind);
    const en = synSettings.lang === 'en';
    btn.textContent = synSettings.colorblind
      ? (en ? 'Colorblind mode on'  : 'Farbblind-Modus an')
      : (en ? 'Colorblind mode off' : 'Farbblind-Modus aus');
  }
}

export function toggleTacticalSetting() {
  synSettings.tactical = !synSettings.tactical;
  // Lazy-import to avoid bringing tactical module into the eager startup path
  import('../systems/tacticalView.js').then(m => m.setTactical(synSettings.tactical));
  const btn = document.getElementById('tactical-toggle');
  if (btn) {
    btn.classList.toggle('active', !!synSettings.tactical);
    const en = synSettings.lang === 'en';
    btn.textContent = synSettings.tactical
      ? (en ? 'Tactical View on'  : 'Tactical View an')
      : (en ? 'Tactical View off' : 'Tactical View aus');
  }
}
export function updateBloomVal(value) {
  const numeric = Number(value);
  synSettings.bloom = numeric;
  const val = document.getElementById('bloom-val');
  if (val) val.textContent = `${numeric}%`;
}
export function updateVolumeVal(value) {
  const numeric = Number(value);
  synSettings.volume = numeric;
  const val = document.getElementById('volume-val');
  if (val) val.textContent = `${numeric}%`;
  SFX.setVolume(numeric / 100);
}

export function applySettings() {
  applySettingsUI();
  saveSettings();
  closeSettings();
}

export function initShellControls() {
  applySettingsUI();
  switchHistTab('recent');
  initMetaScreens();
  stopDiagRefresh();
}
