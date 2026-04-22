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

export const BOSS_PROFILES = {
  null_cortex: {
    id: 'null_cortex',
    name: 'THE NULL CORTEX',
    sub: 'Das Netz wendet sich gegen dich · Bekämpfe die Korruption',
    subEN: 'The network turns against you · Combat the corruption',
    maxHP: 6,
    attackInterval: 16,
    vulnDuration: 4.0,
    vulnInterval: 8,
    color: 0xff2200,
    winTitle: 'KERN ZERSCHLAGEN',
    winTitleEN: 'CORE SHATTERED',
    winSub: 'Null Cortex besiegt',
    winSubEN: 'Null Cortex defeated',
    winClass: 'boss-null',
  },
  ghost_matrix: {
    id: 'ghost_matrix',
    name: 'THE GHOST MATRIX',
    sub: 'Ein Echo deiner früheren Runs greift an · Erkenne das Muster',
    subEN: 'An echo of your previous runs attacks · Recognise the pattern',
    maxHP: 5,
    attackInterval: 11,
    vulnDuration: 3.5,
    vulnInterval: 7,
    color: 0x44ffcc,
    cssClass: 'ghost',
    winTitle: 'ECHO AUFGELÖST',
    winTitleEN: 'ECHO DISSOLVED',
    winSub: 'Ghost Matrix besiegt · Das Muster ist gebrochen',
    winSubEN: 'Ghost Matrix defeated · The pattern is broken',
    winClass: 'boss-ghost',
  },
  sigma_recursive: {
    id: 'sigma_recursive',
    name: 'THE SIGMA RECURSIVE',
    sub: 'Das Netz überschreibt sich selbst · Brich die Rekursionsschleife',
    subEN: 'The network overwrites itself · Break the recursion loop',
    maxHP: 7,
    attackInterval: 11,   // FIX P2: was 9 — jump from Ghost Matrix (11s) was 44% faster; now equal entry
    vulnDuration: 3.0,
    vulnInterval: 6,
    color: 0xcc44ff,
    cssClass: 'sigma',
    winTitle: 'REKURSION TERMINIERT',
    winTitleEN: 'RECURSION TERMINATED',
    winSub: 'Sigma Recursive besiegt · Alle Schleifen aufgelöst',
    winSubEN: 'Sigma Recursive defeated · All loops resolved',
    winClass: 'boss-sigma',
  },
  vortex_architect: {
    id: 'vortex_architect',
    name: 'THE VORTEX ARCHITECT',
    sub: 'Der Strudel saugt dein Netz aus · Triff den Sättigungspunkt',
    subEN: 'The vortex drains your network · Hit the saturation point',
    maxHP: 6,
    attackInterval: 14,
    vulnDuration: 3.8,
    vulnInterval: 9,
    color: 0xffaa00,
    cssClass: 'vortex',
    winTitle: 'VORTEX KOLLABIERT',
    winTitleEN: 'VORTEX COLLAPSED',
    winSub: 'Vortex Architect besiegt · Der Strudel ist aufgelöst',
    winSubEN: 'Vortex Architect defeated · The vortex is dissolved',
    winClass: 'boss-vortex',
  },
  entropy_field: {
    id: 'entropy_field',
    name: 'THE ENTROPY FIELD',
    sub: 'Das Netz verdunkelt sich · Generiere schnell genug Energie um den Zerfall zu überwinden',
    subEN: 'The network darkens · Generate energy fast enough to overcome the decay',
    maxHP: 8,
    attackInterval: 7,       // attacks frequently but differently
    vulnDuration: 4.5,
    vulnInterval: 10,
    color: 0x225599,
    cssClass: 'entropy',
    winTitle: 'ENTROPIE ÜBERWUNDEN',
    winTitleEN: 'ENTROPY OVERCOME',
    winSub: 'Entropy Field besiegt · Das Netz leuchtet wieder',
    winSubEN: 'Entropy Field defeated · The network shines again',
    winClass: 'boss-entropy',
    // Special mechanic: each attack reduces all node emissiveIntensity by 0.4
    // Player must generate energy to "recharge" the network brightness
    specialMechanic: 'emissive_decay',
    emissiveDecayPerAttack: 0.4,
    minEmissiveIntensity: 0.2,
  },

  parasite_choir: {
    id: 'parasite_choir',
    name: 'THE PARASITE CHOIR',
    sub: 'Das Netz infiziert sich selbst · Isoliere die Verbindungen',
    subEN: 'The network infects itself · Isolate the connections',
    maxHP: 5,
    attackInterval: 13,
    vulnDuration: 3.5,
    vulnInterval: 10,
    color: 0x88ff44,
    cssClass: 'parasite',
    winTitle: 'CHOR VERSTUMMT',
    winTitleEN: 'CHOIR SILENCED',
    winSub: 'Parasite Choir besiegt · Das Netz ist gereinigt',
    winSubEN: 'Parasite Choir defeated · The network is cleansed',
    winClass: 'boss-parasite',
  },
};

function createBossDefaults() {
  return {
    maxHP: 6,
    hp: 6,
    phase: 0,
    vulnOpen: false,
    vulnStart: 0,
    vulnDuration: 4.0,
    attackInterval: 16,
    lastAttack: 0,
    vulnInterval: 8,
    lastVuln: 0,
    hitsTaken: 0,
    bossStartTime: 0,
    profileId: 'null_cortex',
  };
}

function createBossStateDefaults() {
  return {
    bossTriggered: false,
    bossActive: false,
    bossP3SyncNerf: false,
    bossVortexImmune: false,
    activeBossProfile: null,
    bossWinClass: '',
  };
}

export const BOSS = window.__synBossRuntime || (window.__synBossRuntime = createBossDefaults());
export const bossState = window.__synBossState || (window.__synBossState = createBossStateDefaults());

export function syncLegacyBossState() {
  window.__synBossRuntime = BOSS;
  window.__synBossState = bossState;
}

export function getActiveBossProfile() { return bossState.activeBossProfile; }
export function getBossWinClass() { return bossState.bossWinClass; }

export function resetBossRuntimeState() {
  Object.assign(BOSS, createBossDefaults());
  Object.assign(bossState, createBossStateDefaults());
  syncLegacyBossState();
}

export function exportBossRuntimeState() {
  return {
    state: {
      bossTriggered: !!bossState.bossTriggered,
      bossActive: !!bossState.bossActive,
      bossP3SyncNerf: !!bossState.bossP3SyncNerf,
      bossVortexImmune: !!bossState.bossVortexImmune,
      activeBossProfileId: bossState.activeBossProfile?.id || null,
      bossWinClass: bossState.bossWinClass || '',
    },
    boss: {
      maxHP: BOSS.maxHP,
      hp: BOSS.hp,
      phase: BOSS.phase,
      vulnOpen: !!BOSS.vulnOpen,
      vulnStart: BOSS.vulnStart,
      vulnDuration: BOSS.vulnDuration,
      attackInterval: BOSS.attackInterval,
      lastAttack: BOSS.lastAttack,
      vulnInterval: BOSS.vulnInterval,
      lastVuln: BOSS.lastVuln,
      hitsTaken: BOSS.hitsTaken,
      bossStartTime: BOSS.bossStartTime,
      profileId: BOSS.profileId,
    },
  };
}

export function restoreBossRuntimeState(snapshot) {
  resetBossRuntimeState();
  const state = snapshot?.state || snapshot || {};
  const boss = snapshot?.boss || {};
  bossState.bossTriggered = !!state.bossTriggered;
  bossState.bossActive = !!state.bossActive;
  bossState.bossP3SyncNerf = !!state.bossP3SyncNerf;
  bossState.bossVortexImmune = !!state.bossVortexImmune;
  bossState.activeBossProfile = BOSS_PROFILES[state.activeBossProfileId || boss.profileId || ''] || null;
  bossState.bossWinClass = state.bossWinClass || '';
  Object.assign(BOSS, createBossDefaults(), boss || {});
  if (bossState.activeBossProfile && !BOSS.profileId) BOSS.profileId = bossState.activeBossProfile.id;
  syncLegacyBossState();
}

defineLegacyAlias('_bossTriggered', () => bossState.bossTriggered, value => { bossState.bossTriggered = !!value; syncLegacyBossState(); });
defineLegacyAlias('_bossActive', () => bossState.bossActive, value => { bossState.bossActive = !!value; syncLegacyBossState(); });
defineLegacyAlias('_bossP3SyncNerf', () => bossState.bossP3SyncNerf, value => { bossState.bossP3SyncNerf = !!value; syncLegacyBossState(); });
defineLegacyAlias('_bossVortexImmune', () => bossState.bossVortexImmune, value => { bossState.bossVortexImmune = !!value; syncLegacyBossState(); });
defineLegacyAlias('_activeBossProfile', () => bossState.activeBossProfile, value => {
  bossState.activeBossProfile = typeof value === 'string' ? (BOSS_PROFILES[value] || null) : (value || null);
  syncLegacyBossState();
});
defineLegacyAlias('_bossWinClass', () => bossState.bossWinClass, value => { bossState.bossWinClass = value || ''; syncLegacyBossState(); });
defineLegacyAlias('BOSS', () => BOSS, value => { if (value && typeof value === 'object') Object.assign(BOSS, value); syncLegacyBossState(); });
defineLegacyAlias('BOSS_PROFILES', () => BOSS_PROFILES, () => {});

syncLegacyBossState();
