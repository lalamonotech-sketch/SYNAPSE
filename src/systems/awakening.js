/**
 * SYNAPSE v98 — Awakening System
 *
 * This file now focuses on orchestration only:
 *   - epoch progression
 *   - run-start restoration/application of awakening bonuses
 *   - UI reveal sequencing
 *
 * Root-server persistence, daemon runtime and structure/evolution helpers live
 * in smaller modules under ./awakening/ for better maintainability.
 */

import { G } from '../state/gameState.js';
import { gameNodes, gameLinks } from '../layers/network/index.js';
import { showToast } from '../ui/hud/index.js';
import { getLang } from '../state/settings.js';
import {
  EPOCHS,
  initAwakeningState,
  loadRootServer,
  getRootServer,
  saveRootServer,
  buyRootUpgrade,
  bankAwakeningPoints,
  LS_AWAKENING,
  ENABLE_ASSIMILATION_BANK,
  ENABLE_GENETIC_MEMORY,
  saveGeneticMemory as saveGeneticMemoryState,
  getGeneticMemory,
} from './awakening/state.js';
import {
  DAEMON_TYPES,
  unlockDaemons,
  assignDaemon,
  tickDaemons,
  showDaemonUI,
} from './awakening/daemons.js';
import {
  checkNodeEvolution,
  detectMacroStructures,
  getEvolutionThresholdEnergy,
} from './awakening/structures.js';
import {
  getAwakeningDom,
  triggerAwakeningGlitch,
  updateEpochBadge as updateEpochBadgeInternal,
} from './awakening/dom.js';

export {
  EPOCHS,
  LS_AWAKENING,
  ENABLE_ASSIMILATION_BANK,
  ENABLE_GENETIC_MEMORY,
  DAEMON_TYPES,
  initAwakeningState,
  loadRootServer,
  getRootServer,
  saveRootServer,
  buyRootUpgrade,
  bankAwakeningPoints,
  unlockDaemons,
  assignDaemon,
  tickDaemons,
  checkNodeEvolution,
  detectMacroStructures,
  getGeneticMemory,
};

export function saveGeneticMemory(markedNodeIds) {
  return saveGeneticMemoryState(markedNodeIds, gameNodes, gameLinks);
}

export const EVOLUTION_THRESHOLD_ENERGY = getEvolutionThresholdEnergy();

export function tickAwakening(t) {
  if (!G.awakening) initAwakeningState();
  if (t - G.awakening.lastEpochCheckT < 1.0) return;
  G.awakening.lastEpochCheckT = t;
  processUnlockQueue();
  checkEpochAdvance();
}

function checkEpochAdvance() {
  const aw = G.awakening;
  const nextEpoch = EPOCHS[aw.epochIndex + 1];
  if (!nextEpoch) return;

  let advance = false;
  switch (nextEpoch.threshold) {
    case 'energy1000':
      advance = (G.peakEnergy >= 1000) || (aw.energyCollected >= 300);
      break;
    case 'memoryNode':
      advance = gameNodes.some((node) => node._type === 'memory');
      break;
    case 'firstResearchComplete':
      advance = (G.research?.completed instanceof Set)
        ? G.research.completed.size > 0
        : Array.isArray(G.research?.completed) && G.research.completed.length > 0;
      break;
    case 'bossAssimilated':
      advance = aw.bossAssimilated;
      break;
  }

  if (advance) advanceEpoch();
}

function advanceEpoch() {
  const aw = G.awakening;
  aw.epochIndex++;
  const epoch = EPOCHS[aw.epochIndex];
  if (!epoch) return;

  const lang = getLang();
  applyEpochBodyClass(epoch.bodyClass);

  for (let i = 0; i < epoch.unlockIDs.length; i++) {
    aw.pendingUnlockQueue.push(epoch.unlockIDs[i]);
  }

  if (epoch.id === 'reactive') {
    document.body.classList.add('epoch-breathe-on');
    setTimeout(() => {
      const panel = getAwakeningDom('active-projects-hud');
      if (panel) panel.classList.add('expanded');
      try {
        window.gameResearch && import('../systems/research.js').then((m) => m.renderResearchPanel());
      } catch (_) {}
    }, 800);
  }
  if (epoch.id === 'temporal') {
    unlockDaemons();
  }
  if (epoch.id === 'sentience') {
    triggerSentienceAscension();
  }

  showToast(
    lang === 'de' ? `✦ ${epoch.label.de}` : `✦ ${epoch.label.en}`,
    lang === 'de' ? 'Das System erwacht auf einer neuen Ebene.' : 'The system awakens to a new level.',
    4000
  );

  import('./epochReveal.js')
    .then((epochReveal) => {
      epochReveal.playEpochNarrative(epoch.id);
      epochReveal.applyEpochPalette(epoch.id);
      if (epoch.id === 'reactive') epochReveal.removeEpochIRestrictions();

      const flash = document.createElement('div');
      flash.className = `s4-epoch-flash flash-${epoch.id}`;
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 2000);

      if (epoch.id === 'reactive') {
        document.body.classList.add('s4-glitch-burst');
        setTimeout(() => document.body.classList.remove('s4-glitch-burst'), 700);
        import('../meta/onboarding.js')
          .then((module) => module.onboarding.onHeartbeat())
          .catch((error) => console.warn('[Synapse] onboarding chunk load failed:', error));
      }
    })
    .catch((error) => {
      console.warn('[Synapse] epochReveal chunk load failed — palette/narrative skipped:', error);
      if (epoch.id === 'reactive') document.body.classList.remove('s4-epoch-restricted');
    });

  triggerAwakeningGlitch(epoch.unlockIDs);

  const rootServer = getRootServer();
  if (rootServer.totalEpochsReached[aw.epochIndex] !== undefined) {
    rootServer.totalEpochsReached[aw.epochIndex]++;
    saveRootServer();
  }
}

function processUnlockQueue() {
  const aw = G.awakening;
  if (aw._unlockBusy || !aw.pendingUnlockQueue.length) return;
  aw._unlockBusy = true;

  const id = aw.pendingUnlockQueue.shift();
  const el = getAwakeningDom(id);
  if (el) {
    el.style.display = '';
    triggerAwakeningGlitch([id]);
  }

  setTimeout(() => {
    aw._unlockBusy = false;
  }, 600);
}

export function _triggerGlitch(ids) {
  triggerAwakeningGlitch(ids);
}

function triggerSentienceAscension() {
  const body = document.body;
  body.classList.add('v96-ui-glitch', 'epoch-sentience-flash');
  setTimeout(() => {
    body.classList.remove('v96-ui-glitch', 'epoch-sentience-flash');
  }, 1200);
  document.documentElement.style.setProperty('--sentience-opacity', '1');
}

function applyEpochBodyClass(bodyClass) {
  document.body.classList.remove('epoch-mechanical', 'epoch-reactive', 'epoch-temporal', 'epoch-sentience');
  document.body.classList.add(bodyClass);
}

function restoreUnlockedEpochUI(epochIndex) {
  if (epochIndex >= 1) document.body.classList.add('epoch-breathe-on');
  for (let i = 1; i <= epochIndex; i++) {
    const unlockIDs = EPOCHS[i]?.unlockIDs || [];
    for (let j = 0; j < unlockIDs.length; j++) {
      const el = getAwakeningDom(unlockIDs[j]);
      if (el) el.style.display = '';
    }
  }
}

export function initAwakeningOnRunStart(protocolId, isContinue = false) {
  loadRootServer();
  initAwakeningState();

  const restoredEpoch = EPOCHS[G.awakening.epochIndex] || EPOCHS[0];
  applyEpochBodyClass(restoredEpoch.bodyClass);
  restoreUnlockedEpochUI(G.awakening.epochIndex);

  const rs = getRootServer();
  if (protocolId === 'spine' && rs.upgrades.spine_daemons) {
    if (!isContinue) {
      G.awakening.daemonUnlocked = true;
      G.awakening.daemonSlots = [];
    } else if (!G.awakening.daemonUnlocked) {
      G.awakening.daemonUnlocked = true;
    }
    setTimeout(() => showDaemonUI(), 500);
  }

  if (protocolId === 'mnemonic' && rs.upgrades.mnemonic_research) {
    const panel = getAwakeningDom('active-projects-hud');
    if (panel) panel.style.display = '';
  }

  if (!isContinue && rs.upgrades.startWithRelay) {
    setTimeout(() => {
      try {
        if (typeof window.placeNodeAt === 'function') {
          window.placeNodeAt('relay', 1.2, 0.6);
          const lang = getLang();
          showToast(
            lang === 'de' ? '⊕ STARTBONUS' : '⊕ START BONUS',
            lang === 'de' ? 'Relay-Node vorplatziert (startWithRelay)' : 'Relay node pre-placed (startWithRelay)',
            2000
          );
        }
      } catch (_) {}
    }, 800);
  }
}

export function updateEpochBadge() {
  updateEpochBadgeInternal(EPOCHS);
}
