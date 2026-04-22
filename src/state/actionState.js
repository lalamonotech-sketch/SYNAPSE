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

export const upgradeState = window.__synUpgradeState || (window.__synUpgradeState = {
  chainCapture: false,
  chainCaptureCd: 1500,
  bridgeImmunity: false,
  pulseEnergyBonus: 0,
  noMissedPulseCost: false,
  fragileClusterBonus: 0,
  resonPassive: 0,
  // FIX 1.3: gamblerMod removed — was never set anywhere in codebase
  // FIX 3.1: new upgrade fields
  resonanceCascade: false,
  overcharge: false,
  deepGeometry: false,
  quantumSpine: false,
  echoChamber: false,
});

export const traitState = window.__synTraitState || (window.__synTraitState = {
  structural: false,
  linearThinking: false,
  backboneMaster: false,
  silentSpine: false,
  fusionXP: false,
  eliteVeteran: false,
  eliteVeteranCaptureBonus: 0,
  fractureLogic: false,
  conservative: false,
  volatile: false,
  coldLoop: false,
  huntInstinct: false,
  resonanceDebt: false,
});

export const synergyState = window.__synSynergyState || (window.__synSynergyState = {
  drainpulse: false,
  // FIX 3.2: new synergies
  resonanceStorm: false,
  gridLock: false,
});

const legacyUpgradeAliases = {
  _upgrade_chainCapture: 'chainCapture',
  _upgrade_chainCaptureCd: 'chainCaptureCd',
  _upgrade_bridgeImmunity: 'bridgeImmunity',
  _upgrade_pulseEnergyBonus: 'pulseEnergyBonus',
  _upgrade_noMissedPulseCost: 'noMissedPulseCost',
  _upgrade_fragileClusterBonus: 'fragileClusterBonus',
  _upgrade_resonPassive: 'resonPassive',
  // FIX 1.3: _upgrade_gamblerMod alias removed,
  // FIX 3.1: new upgrade aliases
  _upgrade_resonanceCascade: 'resonanceCascade',
  _upgrade_overcharge: 'overcharge',
  _upgrade_deepGeometry: 'deepGeometry',
  _upgrade_quantumSpine: 'quantumSpine',
  _upgrade_echoChamber: 'echoChamber',
};

const legacyTraitAliases = {
  _metaTrait_structural: 'structural',
  _metaTrait_linearThinking: 'linearThinking',
  _metaTrait_backboneMaster: 'backboneMaster',
  _metaTrait_silentSpine: 'silentSpine',
  _metaTrait_fusionXP: 'fusionXP',
  _metaTrait_eliteVeteran: 'eliteVeteran',
  _eliteVeteranCaptureBonus: 'eliteVeteranCaptureBonus',
  _metaTrait_fractureLogic: 'fractureLogic',
  _metaTrait_conservative: 'conservative',
  _metaTrait_volatile: 'volatile',
  _metaTrait_coldLoop: 'coldLoop',
  _metaTrait_huntInstinct: 'huntInstinct',
  _metaTrait_resonanceDebt: 'resonanceDebt',
};

const legacySynergyAliases = {
  _synergy_drainpulse: 'drainpulse',
};

for (const [legacyKey, stateKey] of Object.entries(legacyUpgradeAliases)) {
  defineLegacyAlias(legacyKey, () => upgradeState[stateKey], value => { upgradeState[stateKey] = value; });
}
for (const [legacyKey, stateKey] of Object.entries(legacyTraitAliases)) {
  defineLegacyAlias(legacyKey, () => traitState[stateKey], value => { traitState[stateKey] = value; });
}
for (const [legacyKey, stateKey] of Object.entries(legacySynergyAliases)) {
  defineLegacyAlias(legacyKey, () => synergyState[stateKey], value => { synergyState[stateKey] = value; });
}

export function resetActionState() {
  Object.assign(upgradeState, {
    chainCapture: false,
    chainCaptureCd: 1500,
    bridgeImmunity: false,
    pulseEnergyBonus: 0,
    noMissedPulseCost: false,
    fragileClusterBonus: 0,
    resonPassive: 0,
    // FIX 1.3: gamblerMod removed — was never set anywhere in codebase
    resonanceCascade: false,
    overcharge: false,
    deepGeometry: false,
    quantumSpine: false,
    echoChamber: false,
  });
  Object.assign(traitState, {
    structural: false,
    linearThinking: false,
    backboneMaster: false,
    silentSpine: false,
    fusionXP: false,
    eliteVeteran: false,
    eliteVeteranCaptureBonus: 0,
    fractureLogic: false,
    conservative: false,
    volatile: false,
    coldLoop: false,
    huntInstinct: false,
    resonanceDebt: false,
  });
  Object.assign(synergyState, { drainpulse: false, resonanceStorm: false, gridLock: false }); // FIX 3.2
}

export function getActionStateSnapshot() {
  return {
    upgrades: { ...upgradeState },
    traits: { ...traitState },
    synergies: { ...synergyState },
  };
}

export function mergeActionStateSnapshot(snapshot) {
  if (!snapshot) return;
  const mergeInto = (target, src) => {
    if (!src || typeof src !== 'object') return;
    for (const [key, value] of Object.entries(src)) {
      if (!(key in target)) continue;
      const cur = target[key];
      if (typeof cur === 'boolean') {
        target[key] = !!(cur || value);
      } else if (typeof cur === 'number') {
        if (key.toLowerCase().endsWith('cd') && cur > 0 && Number(value) > 0) target[key] = Math.min(cur, Number(value));
        else target[key] = Math.max(Number(cur || 0), Number(value || 0));
      } else {
        target[key] = value;
      }
    }
  };
  mergeInto(upgradeState, snapshot.upgrades);
  mergeInto(traitState, snapshot.traits);
  mergeInto(synergyState, snapshot.synergies);
}

export function getActiveActionLabels(lang = 'de') {
  const labels = [];
  const push = label => { if (label && !labels.includes(label)) labels.push(label); };
  if (synergyState.drainpulse) push('Drainpulse');
  if (upgradeState.chainCapture) push('Chain Capture');
  if (upgradeState.bridgeImmunity) push(lang === 'de' ? 'Brücken-Immunität' : 'Bridge Immunity');
  if (upgradeState.noMissedPulseCost) push(lang === 'de' ? 'No Missed Cost' : 'No Missed Cost');
  if (traitState.backboneMaster) push(lang === 'de' ? 'Backbone-Meister' : 'Backbone Master');
  if (traitState.silentSpine) push('Silent Spine');
  if (traitState.fusionXP) push(lang === 'de' ? 'Fusionserfahrung' : 'Fusion Experience');
  if (traitState.fractureLogic) push('Fracture Logic');
  if (traitState.conservative) push(lang === 'de' ? 'Konservativ' : 'Conservative');
  if (traitState.volatile) push(lang === 'de' ? 'Volatil' : 'Volatile');
  if (traitState.huntInstinct) push(lang === 'de' ? 'Jagdinstinkt' : 'Hunt Instinct');
  if (traitState.resonanceDebt) push(lang === 'de' ? 'Resonanzschuld' : 'Resonance Debt');
  return labels;
}
