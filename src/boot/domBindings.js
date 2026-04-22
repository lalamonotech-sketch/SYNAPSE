import { regListener } from '../registries/listenerRegistry.js';
import { safeRestart, returnToTitle } from '../engine/dispose.js';
import { startGame, continueLatestSave } from './runController.js';
import {
  showSettings, closeSettings, applySettings,
  showInfo, closeInfo,
  togglePause, toggleHistory, switchHistTab,
  toggleDiag, debugSnapshot, cycleDiagNodeRenderMode, adjustDiagNodeRenderThreshold,
  setDiff, setMotion, setGraphics, setLang,
  toggleSfx, updateBloomVal, updateVolumeVal,
  toggleColorblind, toggleTacticalSetting,
} from '../gameplay/shellControls.js';
import { setMode, setNodeType, setLinkType } from '../gameplay/progression.js';
import { doPulse } from '../gameplay/actions.js';
import { doTrainPulse } from '../systems/ai.js';
import { selectProtocol, confirmProtocol } from '../systems/protocols.js';
import { skipDraft } from '../meta/flow.js';
import { startBossFight } from '../systems/boss.js';
import { onboarding } from '../meta/onboarding.js';
import { toggleBlueprintMode } from '../systems/blueprint.js';
import { autoRouter } from '../systems/autorouter.js';  // v98

let bound = false;

function byId(id) {
  return document.getElementById(id);
}

function bindClick(id, handler) {
  const node = byId(id);
  if (!node) return;
  regListener(node, 'click', handler);
}

function bindInput(id, handler) {
  const node = byId(id);
  if (!node) return;
  regListener(node, 'input', handler);
}

function bindKeyboardClick(id, handler) {
  const node = byId(id);
  if (!node) return;
  regListener(node, 'keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler(event);
    }
  });
}

function bindHoverColor(id, baseColor, hoverColor) {
  const node = byId(id);
  if (!node) return;
  regListener(node, 'mouseenter', () => { node.style.color = hoverColor; });
  regListener(node, 'mouseleave', () => { node.style.color = baseColor; });
}

export function initDomBindings() {
  if (bound) return;
  bound = true;

  bindClick('save-card', () => continueLatestSave());
  bindKeyboardClick('save-card', () => continueLatestSave());
  bindClick('btn-continue', () => continueLatestSave());
  bindClick('btn-start', () => startGame());

  bindClick('btn-settings', showSettings);
  bindClick('btn-info', showInfo);
  bindClick('info-close', closeInfo);
  bindClick('settings-close', closeSettings);
  bindClick('settings-apply', applySettings);
  bindClick('settings-onboard-reset', () => {
    onboarding.reset();
    onboarding.open();
    closeSettings();
  });

  bindClick('diff-easy', () => setDiff('easy'));
  bindClick('diff-normal', () => setDiff('normal'));
  bindClick('diff-hard', () => setDiff('hard'));
  bindInput('bloom-slider', event => updateBloomVal(event.currentTarget.value));
  bindClick('sfx-toggle', toggleSfx);
  bindInput('volume-slider', event => updateVolumeVal(event.currentTarget.value));
  bindClick('motion-full', () => setMotion('full'));
  bindClick('motion-reduced', () => setMotion('reduced'));
  bindClick('motion-minimal', () => setMotion('minimal'));
  bindClick('graphics-low', () => setGraphics('low'));
  bindClick('graphics-medium', () => setGraphics('medium'));
  bindClick('graphics-high', () => setGraphics('high'));
  bindClick('lang-de', () => setLang('de'));
  bindClick('lang-en', () => setLang('en'));
  bindClick('colorblind-toggle', toggleColorblind);
  bindClick('tactical-toggle', toggleTacticalSetting);

  bindClick('pause-btn', togglePause);
  bindClick('diag-toggle', toggleDiag);
  bindClick('diag-node-render-toggle', cycleDiagNodeRenderMode);
  bindClick('diag-node-threshold-down', () => adjustDiagNodeRenderThreshold(-4));
  bindClick('diag-node-threshold-up', () => adjustDiagNodeRenderThreshold(4));
  bindClick('diag-snapshot-btn', debugSnapshot);
  bindHoverColor('diag-snapshot-btn', 'rgba(120,200,255,.55)', 'rgba(160,220,255,.8)');
  bindClick('history-toggle', toggleHistory);
  bindClick('htab-recent', () => switchHistTab('recent'));
  bindClick('htab-best', () => switchHistTab('best'));
  bindClick('htab-codex', () => switchHistTab('codex'));

  bindClick('btn-p', () => setMode('place'));
  bindClick('btn-c', () => setMode('connect'));
  bindClick('bn-src', () => setNodeType('source'));
  bindClick('bn-rly', () => setNodeType('relay'));
  bindClick('bn-amp', () => setNodeType('amplifier'));
  bindClick('bn-mem', () => setNodeType('memory'));
  bindClick('bl-stb', () => setLinkType('stable'));
  bindClick('bl-fst', () => setLinkType('fast'));
  bindClick('bl-res', () => setLinkType('resonance'));
  bindClick('bl-frg', () => setLinkType('fragile'));
  bindClick('btn-pulse', doPulse);
  bindClick('btn-train', doTrainPulse);
  bindClick('btn-blueprint', () => toggleBlueprintMode('highway'));
  bindClick('btn-autoroute', () => {
    autoRouter.toggle();
    const btn = document.getElementById('btn-autoroute');
    if (btn) btn.classList.toggle('ar-active', autoRouter.isActive());
  });

  const pauseResume = document.querySelector('.pause-item.p-resume');
  if (pauseResume) regListener(pauseResume, 'click', togglePause);
  document.querySelector('.pause-item.p-title') && regListener(document.querySelector('.pause-item.p-title'), 'click', returnToTitle);

  bindClick('ql-panel-toggle', () => byId('ql-panel')?.classList.toggle('collapsed'));
  const draftSkip = document.querySelector('.draft-skip');
  if (draftSkip) regListener(draftSkip, 'click', skipDraft);
  bindClick('boss-start-btn', startBossFight);
  bindClick('win-restart', safeRestart);
  bindClick('win-hardmode', safeRestart);
  bindClick('ob-skip', () => onboarding.skip());

  const protocolConfirm = byId('protocol-confirm');
  if (protocolConfirm) regListener(protocolConfirm, 'click', confirmProtocol);

  document.querySelectorAll('[data-protocol-id]').forEach(node => {
    regListener(node, 'click', () => selectProtocol(node.dataset.protocolId));
  });
}
