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

function createProfileScores() {
  return { analyst: 0, predator: 0, architect: 0, mnemonic: 0 };
}

function createTrainingScores() {
  return { routing: 0, timing: 0, stability: 0, memory: 0 };
}

function createMetaTraits() {
  return {
    explorative: false,
    rhythmic: false,
    conservative: false,
    volatile: false,
  };
}

function createStageUnlocks() {
  return { predictive: false, selfOpt: false, emergent: false };
}

function createAIState() {
  return {
    profileScores: createProfileScores(),
    dominantProfile: null,
    awarenessStage: 0,
    trainingHistory: [],
    trainingScores: createTrainingScores(),
    trainingRuns: 0,
    lastTrainTime: 0,
    lastAdvice: '',
    lastScoreDelta: null,
    bestTrainScore: 0,
    agentMood: 'dormant',
    metaTraits: createMetaTraits(),
    syncHits: 0,
    memDischargeCount: 0,
    pulseIntervals: [],
    lastPulseTime: 0,
    nodeTypesUsed: new Set(['source']),
    fragileLinksLost: 0,
    missedSyncs: 0,
    burstEvents: 0,
    recentTrains: [],
    trainSpamPenalty: 0,
    stageUnlocks: createStageUnlocks(),
    emergenceActive: false,
    questlinesCompleted: 0,
    lastAwarenessAdvance: 0,
    // v96 additions
    syncWindowOpen: false,
    trainingImmunities: [],
  };
}

export const AI_STAGE_NAMES = {
  de: ['Signalfluss', 'Mustererkennung', 'Vorhersage', 'Selbstoptimierung', 'Emergenz'],
  en: ['Signal Flow', 'Pattern Recognition', 'Prediction', 'Self-Optimization', 'Emergence'],
};

export const AI_PROFILE_LABELS = {
  de: { analyst: 'Analyst', predator: 'Prädator', architect: 'Architekt', mnemonic: 'Mnemoniker' },
  en: { analyst: 'Analyst', predator: 'Predator', architect: 'Architect', mnemonic: 'Mnemonic' },
};

export const AI_MOOD_LABELS = {
  de: {
    dormant: 'ruhend', focused: 'fokussiert', aggressive: 'aggressiv',
    expanding: 'expansiv', deep: 'tief', observing: 'beobachtend', emergent: 'emergent',
  },
  en: {
    dormant: 'dormant', focused: 'focused', aggressive: 'aggressive',
    expanding: 'expanding', deep: 'deep', observing: 'observing', emergent: 'emergent',
  },
};

export const AI_PROFILE_COLORS = {
  analyst: 'rgba(80,180,255,.92)',
  predator: 'rgba(255,80,80,.92)',
  architect: 'rgba(255,200,60,.92)',
  mnemonic: 'rgba(190,80,255,.92)',
};

export const PROFILE_BONUS = window.__synProfileBonus || (window.__synProfileBonus = {
  analyst: { warnPhaseBonus: 0, bridgeStabBonus: 0 },
  predator: { pulseCdReduction: 0, burstBonus: 0 },
  architect: { spineBonusScale: 0, macroCouplingRange: 0, backboneBonus: 0 },
  mnemonic: { memEfficiency: 0, fusionBurst: 0 },
});

export const aiState = window.__synAIState || (window.__synAIState = createAIState());

export function resetAIRuntimeState() {
  const fresh = createAIState();
  aiState.profileScores = createProfileScores();
  aiState.trainingScores = createTrainingScores();
  aiState.metaTraits = createMetaTraits();
  aiState.stageUnlocks = createStageUnlocks();
  aiState.trainingHistory = [];
  aiState.pulseIntervals = [];
  aiState.nodeTypesUsed = new Set(['source']);
  aiState.recentTrains = [];
  Object.assign(aiState, fresh);

  PROFILE_BONUS.analyst.warnPhaseBonus = 0;
  PROFILE_BONUS.analyst.bridgeStabBonus = 0;
  PROFILE_BONUS.predator.pulseCdReduction = 0;
  PROFILE_BONUS.predator.burstBonus = 0;
  PROFILE_BONUS.architect.spineBonusScale = 0;
  PROFILE_BONUS.architect.macroCouplingRange = 0;
  PROFILE_BONUS.architect.backboneBonus = 0;
  PROFILE_BONUS.mnemonic.memEfficiency = 0;
  PROFILE_BONUS.mnemonic.fusionBurst = 0;
}

export function exportAIRuntimeState() {
  return {
    profileScores: { ...(aiState.profileScores || {}) },
    dominantProfile: aiState.dominantProfile || null,
    awarenessStage: aiState.awarenessStage || 0,
    trainingHistory: Array.isArray(aiState.trainingHistory) ? aiState.trainingHistory.map(item => ({ ...item })) : [],
    trainingScores: { ...(aiState.trainingScores || {}) },
    trainingRuns: aiState.trainingRuns || 0,
    lastTrainTime: aiState.lastTrainTime || 0,
    lastAdvice: aiState.lastAdvice || '',
    lastScoreDelta: aiState.lastScoreDelta ? { ...(aiState.lastScoreDelta || {}) } : null,
    bestTrainScore: aiState.bestTrainScore || 0,
    agentMood: aiState.agentMood || 'dormant',
    metaTraits: { ...(aiState.metaTraits || {}) },
    syncHits: aiState.syncHits || 0,
    memDischargeCount: aiState.memDischargeCount || 0,
    pulseIntervals: Array.isArray(aiState.pulseIntervals) ? [...aiState.pulseIntervals] : [],
    lastPulseTime: aiState.lastPulseTime || 0,
    nodeTypesUsed: Array.from(aiState.nodeTypesUsed || []),
    fragileLinksLost: aiState.fragileLinksLost || 0,
    missedSyncs: aiState.missedSyncs || 0,
    burstEvents: aiState.burstEvents || 0,
    recentTrains: Array.isArray(aiState.recentTrains) ? [...aiState.recentTrains] : [],
    trainSpamPenalty: aiState.trainSpamPenalty || 0,
    stageUnlocks: { ...(aiState.stageUnlocks || {}) },
    emergenceActive: !!aiState.emergenceActive,
    questlinesCompleted: aiState.questlinesCompleted || 0,
    lastAwarenessAdvance: aiState.lastAwarenessAdvance || 0,
    trainingImmunities: Array.isArray(aiState.trainingImmunities) ? [...aiState.trainingImmunities] : [],
  };
}

export function restoreAIRuntimeState(snapshot) {
  resetAIRuntimeState();
  const save = snapshot || {};
  Object.assign(aiState.profileScores, save.profileScores || {});
  aiState.dominantProfile = save.dominantProfile || null;
  aiState.awarenessStage = save.awarenessStage || 0;
  aiState.trainingHistory = Array.isArray(save.trainingHistory) ? save.trainingHistory.map(item => ({ ...item })) : [];
  Object.assign(aiState.trainingScores, save.trainingScores || {});
  aiState.trainingRuns = save.trainingRuns || 0;
  aiState.lastTrainTime = save.lastTrainTime || 0;
  aiState.lastAdvice = save.lastAdvice || '';
  aiState.lastScoreDelta = save.lastScoreDelta ? { ...(save.lastScoreDelta || {}) } : null;
  aiState.bestTrainScore = save.bestTrainScore || 0;
  aiState.agentMood = save.agentMood || 'dormant';
  aiState.metaTraits = { ...createMetaTraits(), ...(save.metaTraits || {}) };
  aiState.syncHits = save.syncHits || 0;
  aiState.memDischargeCount = save.memDischargeCount || 0;
  aiState.pulseIntervals = Array.isArray(save.pulseIntervals) ? [...save.pulseIntervals] : [];
  aiState.lastPulseTime = save.lastPulseTime || 0;
  aiState.nodeTypesUsed = new Set(Array.isArray(save.nodeTypesUsed) && save.nodeTypesUsed.length ? save.nodeTypesUsed : ['source']);
  aiState.fragileLinksLost = save.fragileLinksLost || 0;
  aiState.missedSyncs = save.missedSyncs || 0;
  aiState.burstEvents = save.burstEvents || 0;
  aiState.recentTrains = Array.isArray(save.recentTrains) ? [...save.recentTrains] : [];
  aiState.trainSpamPenalty = save.trainSpamPenalty || 0;
  aiState.stageUnlocks = { ...createStageUnlocks(), ...(save.stageUnlocks || {}) };
  aiState.emergenceActive = !!save.emergenceActive;
  aiState.questlinesCompleted = save.questlinesCompleted || 0;
  aiState.lastAwarenessAdvance = save.lastAwarenessAdvance || 0;
  aiState.syncWindowOpen = false;
  aiState.trainingImmunities = Array.isArray(save.trainingImmunities) ? [...save.trainingImmunities] : [];
}

function assignAIState(value) {
  if (!value || typeof value !== 'object') return;
  restoreAIRuntimeState(value);
}

function assignProfileBonus(value) {
  if (!value || typeof value !== 'object') return;
  ['analyst', 'predator', 'architect', 'mnemonic'].forEach(key => {
    PROFILE_BONUS[key] = { ...(PROFILE_BONUS[key] || {}), ...(value[key] || {}) };
  });
}

defineLegacyAlias('aiState', () => aiState, assignAIState);
defineLegacyAlias('AI_STAGE_NAMES', () => AI_STAGE_NAMES, () => {});
defineLegacyAlias('AI_PROFILE_LABELS', () => AI_PROFILE_LABELS, () => {});
defineLegacyAlias('AI_MOOD_LABELS', () => AI_MOOD_LABELS, () => {});
defineLegacyAlias('AI_PROFILE_COLORS', () => AI_PROFILE_COLORS, () => {});
defineLegacyAlias('PROFILE_BONUS', () => PROFILE_BONUS, assignProfileBonus);
defineLegacyAlias('_emergenceActive', () => !!aiState.emergenceActive, value => { aiState.emergenceActive = !!value; });

window.__synAIState = aiState;
window.__synProfileBonus = PROFILE_BONUS;
