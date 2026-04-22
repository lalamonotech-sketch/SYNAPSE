import { regTimer, clearTimer } from "../registries/timerRegistry.js";

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

export const eventMods = window.__synEventMods || (window.__synEventMods = {
  passiveMult: 1.0,
  energyMult: 1.0,
  bonusCapture: false,
  drain: 0,
  resonanceBoost: false,
  triBonus: null,
  freePulses: 0,
  pulseCdBonus: 0,
  pulseCdMalus: 0,
  syncBonus: 0,
  spineMult: 1.0,
  memMult: 1.0,
  memResonanceBoost: 1.0,
  resonanceFragile: false,
  overloadCap: false,
  syncLocked: false,
  neuroStorm: false,
  neuroStormPassiveBoost: 1.0,
});

export const eliteState = window.__synEliteState || (window.__synEliteState = {
  mirrorRelay: null,
  dormantFortress: null,
  voidAnchor: null,
  phantomNexus: null,
  temporalAnchor: null,
});

export const gameplayFlags = window.__synGameplayFlags || (window.__synGameplayFlags = {
  eliteCaptureRareChainBonus: false,
  eliteCaptureSignalNoiseDur: 0,
  eliteCaptureSignalNoiseStart: 0,
  eliteCaptureFortifiedSpine: false,
  eliteCapturePulsePenaltyEnd: null,
  phantomNexusGhostCooldownEnd: 0,
  phantomNexusEchoBonus: 0,
  phantomNexusTrainPenaltyEnd: 0,
  resonanceDebtActive: false,
  resonanceDebtPulseCount: 0,
  overclockDrainTimer: null,
});

const legacyEventAliases = {
  _eventMod_passiveMult: 'passiveMult',
  _eventMod_energyMult: 'energyMult',
  _eventMod_bonusCapture: 'bonusCapture',
  _eventMod_drain: 'drain',
  _eventMod_resonanceBoost: 'resonanceBoost',
  _eventMod_triBonus: 'triBonus',
  _eventMod_freePulses: 'freePulses',
  _eventMod_pulseCdBonus: 'pulseCdBonus',
  _eventMod_pulseCdMalus: 'pulseCdMalus',
  _eventMod_syncBonus: 'syncBonus',
  _eventMod_spineMult: 'spineMult',
  _eventMod_memMult: 'memMult',
  _eventMod_memResonanceBoost: 'memResonanceBoost',
  _eventMod_resonanceFragile: 'resonanceFragile',
  _eventMod_overloadCap: 'overloadCap',
  _eventMod_syncLocked: 'syncLocked',
  _eventMod_neuroStorm: 'neuroStorm',
  _neuroStorm_passiveBoost: 'neuroStormPassiveBoost',
};

const legacyEliteAliases = {
  _eliteCluster_mirrorRelay: 'mirrorRelay',
  _eliteCluster_dormantFortress: 'dormantFortress',
  _eliteCluster_voidAnchor: 'voidAnchor',
  _eliteCluster_phantomNexus: 'phantomNexus',
  _eliteCluster_temporalAnchor: 'temporalAnchor',
};

const legacyGameplayAliases = {
  _eliteCapture_rareChainBonus: 'eliteCaptureRareChainBonus',
  _eliteCapture_signalNoiseDur: 'eliteCaptureSignalNoiseDur',
  _eliteCapture_signalNoiseStart: 'eliteCaptureSignalNoiseStart',
  _eliteCapture_fortifiedSpine: 'eliteCaptureFortifiedSpine',
  _eliteCapture_pulsePenaltyEnd: 'eliteCapturePulsePenaltyEnd',
  _phantomNexus_ghostCooldownEnd: 'phantomNexusGhostCooldownEnd',
  _phantomNexus_echoBonus: 'phantomNexusEchoBonus',
  _phantomNexus_trainPenaltyEnd: 'phantomNexusTrainPenaltyEnd',
  _resonanceDebtActive: 'resonanceDebtActive',
  _resonanceDebtPulseCount: 'resonanceDebtPulseCount',
  _overclockDrainTimer: 'overclockDrainTimer',
};

for (const [legacyKey, stateKey] of Object.entries(legacyEventAliases)) {
  defineLegacyAlias(legacyKey, () => eventMods[stateKey], value => { eventMods[stateKey] = value; });
}
for (const [legacyKey, stateKey] of Object.entries(legacyEliteAliases)) {
  defineLegacyAlias(legacyKey, () => eliteState[stateKey], value => { eliteState[stateKey] = value || null; });
}
for (const [legacyKey, stateKey] of Object.entries(legacyGameplayAliases)) {
  defineLegacyAlias(legacyKey, () => gameplayFlags[stateKey], value => { gameplayFlags[stateKey] = value; });
}

export function clearEliteState(key) {
  eliteState[key] = null;
}

export function resetGameplayFlagsState() {
  Object.assign(eventMods, {
    passiveMult: 1.0,
    energyMult: 1.0,
    bonusCapture: false,
    drain: 0,
    resonanceBoost: false,
    triBonus: null,
    freePulses: 0,
    pulseCdBonus: 0,
    pulseCdMalus: 0,
    syncBonus: 0,
    spineMult: 1.0,
    memMult: 1.0,
    memResonanceBoost: 1.0,
    resonanceFragile: false,
    overloadCap: false,
    syncLocked: false,
    neuroStorm: false,
    neuroStormPassiveBoost: 1.0,
  });
  Object.assign(eliteState, {
    mirrorRelay: null,
    dormantFortress: null,
    voidAnchor: null,
    phantomNexus: null,
    temporalAnchor: null,
  });
  Object.assign(gameplayFlags, {
    eliteCaptureRareChainBonus: false,
    eliteCaptureSignalNoiseDur: 0,
    eliteCaptureSignalNoiseStart: 0,
    eliteCaptureFortifiedSpine: false,
    eliteCapturePulsePenaltyEnd: null,
    phantomNexusGhostCooldownEnd: 0,
    phantomNexusEchoBonus: 0,
    phantomNexusTrainPenaltyEnd: 0,
    resonanceDebtActive: false,
    resonanceDebtPulseCount: 0,
    overclockDrainTimer: null,
  });
  clearTimer('resonanceDebtActive');
}

export function triggerResonanceDebtBurst(durationMs = 400) {
  gameplayFlags.resonanceDebtActive = true;
  clearTimer('resonanceDebtActive');
  regTimer('resonanceDebtActive', setTimeout(() => {
    gameplayFlags.resonanceDebtActive = false;
  }, durationMs), 'timeout');
}
