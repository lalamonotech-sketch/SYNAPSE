function telemetryDefaults() {
  return {
    finalized: false,
    bossWindowsOpened: 0,
    bossWindowsHit: 0,
    totalChains: 0,
    energySampleSum: 0,
    energySampleCount: 0,
    layerTimes: { dormant: 0, l1: 0, l2: 0, l3: 0 },
    startedAt: Date.now(),
  };
}

export const metaState = window.__synMetaState || (window.__synMetaState = {
  telemetry: telemetryDefaults(),
  runTimeline: [],
  eliteResults: [],
});

function syncLegacyMetaAliases() {
  window.__synMetaState = metaState;
}

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

export function ensureMetaState() {
  if (!metaState.telemetry) metaState.telemetry = telemetryDefaults();
  if (!Array.isArray(metaState.runTimeline)) metaState.runTimeline = [];
  if (!Array.isArray(metaState.eliteResults)) metaState.eliteResults = [];
  syncLegacyMetaAliases();
  return metaState;
}

export function getTelemetryDefaults() {
  return telemetryDefaults();
}

export function resetMetaState() {
  metaState.telemetry = telemetryDefaults();
  metaState.runTimeline = [];
  metaState.eliteResults = [];
  syncLegacyMetaAliases();
}

export function restoreMetaState(save) {
  const tel = save?.telemetry;
  metaState.telemetry = tel
    ? { ...telemetryDefaults(), ...tel, layerTimes: { ...telemetryDefaults().layerTimes, ...(tel.layerTimes || {}) } }
    : telemetryDefaults();
  metaState.runTimeline = Array.isArray(save?.timeline) ? save.timeline.map(item => ({ ...item })) : [];
  metaState.eliteResults = Array.isArray(save?.eliteResults) ? save.eliteResults.map(item => ({ ...item })) : [];
  syncLegacyMetaAliases();
}

export function pushTimelineEntry(entry) {
  ensureMetaState();
  metaState.runTimeline.push({ ...entry });
  if (metaState.runTimeline.length > 160) metaState.runTimeline.splice(0, metaState.runTimeline.length - 160);
  syncLegacyMetaAliases();
}

export function pushEliteResult(entry) {
  ensureMetaState();
  metaState.eliteResults.push({ ...entry });
  if (metaState.eliteResults.length > 24) metaState.eliteResults.splice(0, metaState.eliteResults.length - 24);
  syncLegacyMetaAliases();
}

defineLegacyAlias('TELEMETRY', () => metaState.telemetry, value => {
  metaState.telemetry = value || telemetryDefaults();
  syncLegacyMetaAliases();
});
defineLegacyAlias('_runTimeline', () => metaState.runTimeline, value => {
  metaState.runTimeline = Array.isArray(value) ? value : [];
  syncLegacyMetaAliases();
});
defineLegacyAlias('_eliteResults', () => metaState.eliteResults, value => {
  metaState.eliteResults = Array.isArray(value) ? value : [];
  syncLegacyMetaAliases();
});

ensureMetaState();
