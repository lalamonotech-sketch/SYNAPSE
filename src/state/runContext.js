function defineLegacyAlias(key, getter, setter) {
  const desc = Object.getOwnPropertyDescriptor(window, key);
  if (desc && (desc.get || desc.set)) return;
  Object.defineProperty(window, key, {
    configurable: true,
    enumerable: false,
    get: getter,
    set: setter,
  });
}

export const questState = window.__synQuestState || (window.__synQuestState = {
  progress: {},
  activeQuestline: null,
  advisoryDraftShown: false,
});

export const projectState = window.__synProjectState || (window.__synProjectState = {
  backboneRelayBossBonus: false,
  memoryCacheActive: false,
  memoryCacheAccum: 0,
  echoBeaconRareBonus: 0,
  echoBeaconEliteMult: 1.0,
});

export const conditionState = window.__synConditionState || (window.__synConditionState = {
  activeCondition: null,
  activeConditionId: null,
  lowSignal: false,
  recursiveStorm: false,
  recursiveStormChainChanceBonus: 0,
});

function cloneQuestline(value) {
  if (!value) return null;
  return {
    ...value,
    steps: Array.isArray(value.steps) ? value.steps.map(step => ({ ...step })) : [],
  };
}

export function hasActiveCondition() {
  return !!(conditionState.activeConditionId || conditionState.lowSignal || conditionState.recursiveStorm);
}

export function getActiveConditionId() {
  return conditionState.activeCondition?.id || conditionState.activeConditionId
    || (conditionState.recursiveStorm ? 'recursive_storm' : null)
    || (conditionState.lowSignal ? 'low_signal' : null)
    || null;
}

export function resetRunContextState() {
  questState.progress = {};
  questState.activeQuestline = null;
  questState.advisoryDraftShown = false;

  projectState.backboneRelayBossBonus = false;
  projectState.memoryCacheActive = false;
  projectState.memoryCacheAccum = 0;
  projectState.echoBeaconRareBonus = 0;
  projectState.echoBeaconEliteMult = 1.0;

  conditionState.activeCondition = null;
  conditionState.activeConditionId = null;
  conditionState.lowSignal = false;
  conditionState.recursiveStorm = false;
  conditionState.recursiveStormChainChanceBonus = 0;
}

export function exportRunContextState() {
  return {
    questProgress: { ...(questState.progress || {}) },
    activeQuestline: cloneQuestline(questState.activeQuestline),
    advisoryDraftShown: !!questState.advisoryDraftShown,
    projectState: { ...projectState },
    conditionState: {
      activeConditionId: getActiveConditionId(),
      lowSignal: !!conditionState.lowSignal,
      recursiveStorm: !!conditionState.recursiveStorm,
      recursiveStormChainChanceBonus: conditionState.recursiveStormChainChanceBonus || 0,
    },
  };
}

export function restoreRunContextState(save) {
  const state = save?.runContext || save || {};

  questState.progress = state.questProgress ? { ...state.questProgress } : {};
  questState.activeQuestline = cloneQuestline(state.activeQuestline);
  questState.advisoryDraftShown = !!state.advisoryDraftShown;

  Object.assign(projectState, {
    backboneRelayBossBonus: false,
    memoryCacheActive: false,
    memoryCacheAccum: 0,
    echoBeaconRareBonus: 0,
    echoBeaconEliteMult: 1.0,
    ...(state.projectState || {}),
  });

  const cond = state.conditionState || {};
  conditionState.lowSignal = !!cond.lowSignal;
  conditionState.recursiveStorm = !!cond.recursiveStorm;
  conditionState.recursiveStormChainChanceBonus = cond.recursiveStormChainChanceBonus || 0;
  conditionState.activeConditionId = cond.activeConditionId || null;
  conditionState.activeCondition = conditionState.activeConditionId ? { id: conditionState.activeConditionId } : null;
}

defineLegacyAlias('_questProgress', () => questState.progress, value => {
  questState.progress = value && typeof value === 'object' ? value : {};
});
defineLegacyAlias('_activeQuestline', () => questState.activeQuestline, value => {
  questState.activeQuestline = cloneQuestline(value);
});
defineLegacyAlias('_advisoryDraftShown', () => questState.advisoryDraftShown, value => {
  questState.advisoryDraftShown = !!value;
});

defineLegacyAlias('_project_backboneRelay_bossBonus', () => projectState.backboneRelayBossBonus, value => {
  projectState.backboneRelayBossBonus = !!value;
});
defineLegacyAlias('_project_memoryCacheActive', () => projectState.memoryCacheActive, value => {
  projectState.memoryCacheActive = !!value;
});
defineLegacyAlias('_project_memoryCacheAccum', () => projectState.memoryCacheAccum, value => {
  projectState.memoryCacheAccum = Number(value || 0);
});
defineLegacyAlias('_project_echoBeacon_rareBonus', () => projectState.echoBeaconRareBonus, value => {
  projectState.echoBeaconRareBonus = Number(value || 0);
});
defineLegacyAlias('_project_echoBeacon_eliteMult', () => projectState.echoBeaconEliteMult, value => {
  projectState.echoBeaconEliteMult = Number(value || 1);
});

defineLegacyAlias('_activeLayerCondition', () => conditionState.activeCondition, value => {
  conditionState.activeCondition = value || null;
  conditionState.activeConditionId = value?.id || null;
});
defineLegacyAlias('_layerCond_lowSignal', () => conditionState.lowSignal, value => {
  conditionState.lowSignal = !!value;
  if (conditionState.lowSignal && !conditionState.activeConditionId) conditionState.activeConditionId = 'low_signal';
});
defineLegacyAlias('_layerCond_recursiveStorm', () => conditionState.recursiveStorm, value => {
  conditionState.recursiveStorm = !!value;
  if (conditionState.recursiveStorm && !conditionState.activeConditionId) conditionState.activeConditionId = 'recursive_storm';
});
defineLegacyAlias('_recursiveStorm_chainChanceBonus', () => conditionState.recursiveStormChainChanceBonus, value => {
  conditionState.recursiveStormChainChanceBonus = Number(value || 0);
});
