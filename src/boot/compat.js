import { bootRuntime, continueLatestSave, launchRun, startGame } from './runController.js';
import { bindKeyboardShortcuts } from '../input/hotkeys.js';
import { doPulse, currentPulseCooldownRemaining } from '../gameplay/actions.js';
import { setMode, setNodeType, setLinkType, checkPhase, checkObjectives, updateObjectiveLine } from '../gameplay/progression.js';
import {
  updateCombo, resetCombo, tickComboDecay,
  showAgentMsg, emitAgentMessage,
  maybeShowDraftAdvisory, triggerDraft, triggerMilestoneDraft,
  skipDraft, checkQuestlineProgress,
  onChainComplete, onSyncCapture, onBossDefeated,
  initQuestlineForProfile, draftCap,
} from '../meta/flow.js';
import {
  renderHistoryPanel, populateTitleMetaBox, updateHistoryToggle,
  resetMetaTelemetry, restoreMetaTelemetry, tickMetaScreens,
  recordBossWindowOpen, recordBossWindowHit, recordChainComplete,
  finalizeRunVictory, initMetaScreens,
} from '../meta/screens.js';
import {
  showSettings, closeSettings, applySettings,
  showInfo, closeInfo,
  togglePause, toggleHistory, switchHistTab,
  toggleDiag, debugSnapshot,
  setDiff, setMotion, setGraphics, setLang,
  toggleSfx, updateBloomVal, updateVolumeVal,
  initShellControls,
} from '../gameplay/shellControls.js';
import { onboarding } from '../meta/onboarding.js';
import { touchActionTime } from './activity.js';
import {
  initDOMCache, showToast, showTip, showConditionChip, hideConditionChip, hideTip,
  refreshAll, updateHUD, setLayerTag, setPhaseName,
  initL3HUDUI, updateL3ClusterHUDUI, updateL3ObjectivesUI,
  startSyncDecayBarUI, stopSyncDecayBarUI,
} from '../ui/hud/index.js';
import {
  updateProtocolChipUI, triggerProtocolSignatureUI, showProtocolOverlayUI, markProtocolSelectionUI, closeProtocolOverlayUI,
  setBossProfileUI, showBossIntroUI, transitionBossFightUI, hideBossUI,
  setBossHudVisible, updateBossHUDUI, setBossVulnerabilityUI, flashBossAttackUI,
} from '../ui/overlays.js';


// ── Dev-mode bridge access tracker ──────────────────────────────────────────
// In __DEV__ builds, every window._ call logs a trace so we can see which
// callers still go through the legacy compat layer instead of direct imports.
// In production this is a no-op.
function wrapBridgeForDev(name, fn) {
  if (!__DEV__) return fn;
  return function (...args) {
    console.debug(`[compat] window.${name}() called — migrate to direct import`, new Error().stack?.split('\n')[2]?.trim() ?? '');
    return fn.apply(this, args);
  };
}

let bound = false;

export function bindCompatAliases() {
  if (bound) return;
  bound = true;

  Object.assign(window, {
    _bootRuntime: bootRuntime,
    _continueGame: continueLatestSave,
    _doLaunch: launchRun,
    _startGame: startGame,
    _bindKeyboardShortcuts: bindKeyboardShortcuts,
    _pulse: doPulse,
    _getPulseCooldownRemaining: currentPulseCooldownRemaining,
    _mode: setMode,
    _ntype: setNodeType,
    _ltype: setLinkType,
    checkPhase,
    checkObjectives,
    updateObjLine: updateObjectiveLine,

    _updateCombo: updateCombo,
    _resetCombo: resetCombo,
    tickComboDecay,
    showAgentMsg,
    emitAgentMessage,
    _maybeShowDraftAdvisory: maybeShowDraftAdvisory,
    _triggerDraft: triggerDraft,
    _triggerMilestoneDraft: triggerMilestoneDraft,
    _skipDraftFlow: skipDraft,
    _skipDraft: skipDraft,
    checkQuestlineProgress,
    _onChainComplete: onChainComplete,
    _onSyncCapture: onSyncCapture,
    _onBossDefeated: onBossDefeated,
    _initQuestlineForProfile: initQuestlineForProfile,
    _draftCap: draftCap,

    _renderHistoryPanel: renderHistoryPanel,
    _populateTitleMetaBox: populateTitleMetaBox,
    _updateHistoryToggle: updateHistoryToggle,
    _resetMetaTelemetry: resetMetaTelemetry,
    _restoreMetaTelemetry: restoreMetaTelemetry,
    _tickMetaScreens: tickMetaScreens,
    _recordBossWindowOpen: recordBossWindowOpen,
    _recordBossWindowHit: recordBossWindowHit,
    _recordChainComplete: recordChainComplete,
    _finalizeRunVictory: finalizeRunVictory,
    _initMetaScreens: initMetaScreens,

    _showSettings: showSettings,
    _closeSettings: closeSettings,
    _applySettings: applySettings,
    _showInfo: showInfo,
    _closeInfo: closeInfo,
    _togglePause: togglePause,
    _toggleHistory: toggleHistory,
    _switchHistTab: switchHistTab,
    _toggleDiag: toggleDiag,
    _debugSnapshot: debugSnapshot,
    _setDiff: setDiff,
    _setMotion: setMotion,
    _setGraphics: setGraphics,
    _setLang: setLang,
    _toggleSfx: toggleSfx,
    _updateBloomVal: updateBloomVal,
    _updateVolumeVal: updateVolumeVal,
    _initShellControls: initShellControls,

    _onboard: onboarding,
    _touchActionTime: touchActionTime,

    initDOMCache,
    showToast,
    _showToast: showToast,
    showTip,
    showCondChip: showConditionChip,
    hideCondChip: hideConditionChip,
    hideTip,
    refreshAll,
    updateHUD,
    setLayerTag,
    setPhaseName,
    initL3HUDUI,
    updateL3ClusterHUDUI,
    updateL3ObjectivesUI,
    startSyncDecayBarUI,
    stopSyncDecayBarUI,

    updateProtocolChipUI,
    triggerProtocolSignatureUI,
    showProtocolOverlayUI,
    markProtocolSelectionUI,
    closeProtocolOverlayUI,
    setBossProfileUI,
    showBossIntroUI,
    transitionBossFightUI,
    hideBossUI,
    setBossHudVisible,
    updateBossHUDUI,
    setBossVulnerabilityUI,
    flashBossAttackUI,
  });
}
