/**
 * SYNAPSE v95 — Boss system
 * Phase G migration pass.
 *
 * This is a trimmed but operational boss port:
 *   - boss profile selection
 *   - boss intro screen / fight start
 *   - vulnerability windows + timed attacks
 *   - boss HUD updates
 *   - hit registration + win handling
 *
 * The exotic per-profile sub-mechanics from late v89 (ghost/sigma/vortex/parasite)
 * are intentionally deferred; profile identity, names, colors and stat routing are kept.
 */

import { G } from '../state/gameState.js';
import { spawnShock, gameNodes, gameLinks, spawnSig } from '../layers/network/index.js';
import { clock } from '../engine/scene.js';
import { getDifficulty, getLang } from '../state/settings.js';
import { regTimer, clearTimer } from '../registries/timerRegistry.js';
import {
  BOSS_PROFILES,
  BOSS,
  bossState,
  syncLegacyBossState,
  getActiveBossProfile,
  getBossWinClass,
  resetBossRuntimeState,
  exportBossRuntimeState,
  restoreBossRuntimeState,
} from '../state/bossShared.js';
import {
  setBossProfileUI,
  showBossIntroUI,
  transitionBossFightUI,
  hideBossUI,
  setBossHudVisible,
  updateBossHUDUI,
  setBossVulnerabilityUI,
  flashBossAttackUI,
} from '../ui/overlays.js';
import { showToast } from '../ui/hud/index.js';
import { signalBossChanged } from '../platform/stateSignals.js';
import { clearNowAction, msgStack, setNowAction } from '../ui/actionFlow.js';
import { finalizeRunVictory, recordBossWindowHit, recordBossWindowOpen } from '../meta/screens.js';
import { onBossDefeated } from '../meta/flow.js';

// FIX: Epoch IV gating — bossAssimilated was never set on boss defeat.
// Using direct G reference to avoid a circular import with awakening.js.
function _markBossAssimilated() {
  if (G.awakening) G.awakening.bossAssimilated = true;
}
import { loadAIMeta, agentOnWin } from './ai.js';

// ── Boss runtime state lives in ../state/bossShared.js ───────────────────

function shock(c) { spawnShock(c); }
function refresh() { signalBossChanged(); }

export function selectBossProfile() {
  const meta = loadAIMeta();
  const diff = getDifficulty();
  const history = Array.isArray(meta?.profileHistory) ? meta.profileHistory : [];
  const totalRuns = meta?.totalRuns || 0;
  const tier2Wins = history.filter(run => (run.tier || 0) >= 2).length;
  const tier3Wins = history.filter(run => (run.tier || 0) >= 3).length;
  const perfectRuns = history.filter(run => run.perfect).length;

  if (diff === 'hard') {
    if (tier3Wins >= 3 && totalRuns >= 10) return BOSS_PROFILES.entropy_field;
  if (tier3Wins >= 2 && totalRuns >= 8) return BOSS_PROFILES.parasite_choir;
    if (tier2Wins >= 2 && totalRuns >= 6) return BOSS_PROFILES.sigma_recursive;
    if (tier2Wins >= 1 && totalRuns >= 4) return BOSS_PROFILES.ghost_matrix;
    return BOSS_PROFILES.null_cortex;
  }

  if (perfectRuns >= 1 && totalRuns >= 5) return BOSS_PROFILES.vortex_architect;
  if (tier2Wins >= 1 && totalRuns >= 5) return BOSS_PROFILES.ghost_matrix;  // FIX 2.5: was run 3
  return BOSS_PROFILES.null_cortex;
}

export function initBossFromDifficulty() {
  // v90: difficulty scaling is fully handled via BOSS_PROFILES selected in selectBossProfile().
  // The legacy _activeDiffPreset / _DIFF_PRESETS window bridges are no longer set (removed in v95)
  // and intentionally left as no-ops here. Profile-level stat overrides (maxHP, intervals)
  // are applied in setBossProfile(). This function is retained for API compatibility.
}

function setBossProfile(profile) {
  bossState.activeBossProfile = profile;
  syncLegacyBossState();
  BOSS.profileId = profile.id;
  BOSS.maxHP = profile.maxHP;
  BOSS.hp = profile.maxHP;
  BOSS.attackInterval = profile.attackInterval;
  BOSS.vulnDuration = profile.vulnDuration;
  BOSS.vulnInterval = profile.vulnInterval;
  setBossProfileUI(profile);
}

/** FIX 2.5: Boss tension buildup at 6 clusters */
export function triggerBossWarning() {
  const lang = getLang();
  spawnShock(0xff6600);
  showToast(
    lang === 'de' ? '⚠ ETWAS BEOBACHTET DICH' : '⚠ SOMETHING WATCHES YOU',
    lang === 'de' ? '6 Cluster übernommen · Das Netz reagiert' : '6 clusters captured · The network is reacting',
    3200
  );
  // Pulse visual warning on the network (repeated amber flashes)
  let flashes = 0;
  regTimer('bossWarningFlash', setInterval(() => {
    spawnShock(0xff4400);
    if (++flashes >= 3) clearTimer('bossWarningFlash');
  }, 700), 'interval');
}

/** FIX 2.5: Stronger warning at 7 clusters — boss is imminent */
export function triggerBossWarning2() {
  const lang = getLang();
  spawnShock(0xff2200);
  showToast(
    lang === 'de' ? '⚠ FINALES CLUSTER — DER WÄCHTER ERWACHT' : '⚠ FINAL CLUSTER — THE GUARDIAN AWAKENS',
    lang === 'de' ? '7/8 Cluster · Bereite dich vor' : '7/8 clusters · Prepare yourself',
    3800
  );
}

export function triggerBossIntro() {
  if (bossState.bossTriggered) return;
  bossState.bossTriggered = true;
  syncLegacyBossState();

  const profile = selectBossProfile();
  setBossProfile(profile);
  const _lang1 = getLang();
  showToast(
    _lang1 === 'de' ? '8 CLUSTER KONTROLLIERT' : '8 CLUSTERS CAPTURED',
    _lang1 === 'de' ? 'Etwas erwacht im Netz…' : 'Something awakens in the network…',
    3800
  );
  shock(profile.color);

  clearTimer('bossIntroOpen');
  regTimer('bossIntroOpen', setTimeout(() => {
    G.paused = true;
    showBossIntroUI();
    msgStack.onBossIntroOpen();
    clearTimer('bossIntroOpen');
  }, 900), 'timeout');
}

export function updateBossHUD() {
  updateBossHUDUI({
    hp: BOSS.hp,
    maxHP: BOSS.maxHP,
    phase: BOSS.phase,
    vulnOpen: BOSS.vulnOpen,
  });
}

function openVulnerability(t) {
  BOSS.vulnOpen = true;
  recordBossWindowOpen();
  BOSS.vulnStart = t;
  setBossVulnerabilityUI({ open: true, title: 'VULNERABILITY', frac: 1 });
  msgStack.onVulnBarChange();
  setNowAction('boss', '⚔ BOSS-VERWUNDBAR — PULSE!', 'now-boss');
  signalBossChanged();
}

function closeVulnerability(missed = false) {
  BOSS.vulnOpen = false;
  setBossVulnerabilityUI({ open: false, title: 'VULNERABILITY', frac: 0 });
  msgStack.onVulnBarChange();
  clearNowAction('boss');
  signalBossChanged();
  // FIX 2.5: If window expired without a hit — notify Sigma mechanic
  if (missed) onBossWindowMissed();
}

function bossAttack(t) {
  const dmg = BOSS.phase >= 3 ? 14 : BOSS.phase === 2 ? 9 : 6;
  G.energy = Math.max(0, G.energy - dmg);
  BOSS.lastAttack = t;
  flashBossAttackUI();
  const _langAtk = getLang();
  showToast(
    _langAtk === 'de' ? 'BOSS-ANGRIFF' : 'BOSS ATTACK',
    _langAtk === 'de' ? '−' + dmg + '⬡ Integritätsdruck' : '−' + dmg + '⬡ integrity pressure',
    1200
  );
  shock(bossState.activeBossProfile?.color || 0xff2200);
  // v95: Entropy Field special mechanic — emissive decay on each attack
  if (bossState.activeBossProfile?.specialMechanic === 'emissive_decay') {
    const decayAmt = bossState.activeBossProfile.emissiveDecayPerAttack || 0.4;
    const minEI = bossState.activeBossProfile.minEmissiveIntensity || 0.2;
    const nodes = gameNodes;
    for (let _i = 0; _i < nodes.length; _i++) {
      const _n = nodes[_i];
      if (_n.mat) {
        _n.mat.emissiveIntensity = Math.max(minEI, (_n.mat.emissiveIntensity || 1) - decayAmt);
      }
    }
    showToast('▽ ENTROPIE-ANGRIFF', 'Netz verdunkelt · Generiere Energie um die Helligkeit zurückzugewinnen', 2500);
  }
  refresh();
}

// v95: Entropy Field recovery — energy gain restores node brightness
export function onEnergyGainDuringEntropy(amount) {
  if (!bossState.bossActive) return;
  if (bossState.activeBossProfile?.specialMechanic !== 'emissive_decay') return;
  const restorePerEnergy = 0.02;
  const restore = amount * restorePerEnergy;
  const nodes = gameNodes;
  for (let _i = 0; _i < nodes.length; _i++) {
    const _n = nodes[_i];
    if (_n.mat) {
      _n.mat.emissiveIntensity = Math.min(4.0, (_n.mat.emissiveIntensity || 0) + restore);
    }
  }
}
window.onEnergyGainDuringEntropy = onEnergyGainDuringEntropy;

function updatePhase() {
  const ratio = BOSS.maxHP > 0 ? BOSS.hp / BOSS.maxHP : 0;
  const prev = BOSS.phase;
  if (ratio <= 0.33) {
    BOSS.phase = 3;
    bossState.bossP3SyncNerf = true;
    syncLegacyBossState();
  } else if (ratio <= 0.66) {
    BOSS.phase = 2;
    bossState.bossP3SyncNerf = false;
    syncLegacyBossState();
  } else {
    BOSS.phase = 1;
    bossState.bossP3SyncNerf = false;
    syncLegacyBossState();
  }
  if (BOSS.phase !== prev) {
    const _langPh = getLang();
    showToast(
      (_langPh === 'de' ? 'BOSS-PHASE ' : 'BOSS PHASE ') + BOSS.phase,
      BOSS.phase === 2
        ? (_langPh === 'de' ? 'Das Muster verdichtet sich' : 'The pattern is intensifying')
        : (_langPh === 'de' ? 'Finale Eskalation' : 'Final escalation'),
      2200
    );
    shock(bossState.activeBossProfile?.color || 0xff2200);
  }
}

function endBossFight(win) {
  closeVulnerability();
  bossState.bossActive = false;
  syncLegacyBossState();
  bossState.bossP3SyncNerf = false;
  syncLegacyBossState();
  G.paused = false;
  hideBossUI();
  msgStack.onBossEnd();

  if (win) {
    bossState.bossWinClass = bossState.activeBossProfile?.winClass || '';
    syncLegacyBossState();
    G.runWon = true;
    // FIX P2: Win tier now recognises Phantom/Temporal build paths.
    // Original: spine >= 4 was the only Tier 3 route.
    // Added: perfect boss accuracy (all windows hit) OR all 8 clusters captured
    // during the boss fight — both valid non-Spine expressions of mastery.
    {
      const spine   = G.spineLength || 0;
      const fusions = G.fusedPairs?.size || 0;
      const clusters = G.l3CapturedClusters || 0;
      const telemetry = typeof metaState !== 'undefined' ? metaState.telemetry : null;
      const windowsHit    = telemetry?.bossWindowsHit    || 0;
      const windowsOpened = telemetry?.bossWindowsOpened || 0;
      const perfectBoss   = windowsOpened >= 3 && windowsHit >= windowsOpened; // hit every window
      const allClusters   = clusters >= 8;

      if (spine >= 4 || perfectBoss || allClusters) G.winTier = 3;
      else if (spine >= 3 || fusions >= 1)           G.winTier = 2;
      else                                            G.winTier = 1;
    }
    onBossDefeated();
    agentOnWin();
    _markBossAssimilated(); // FIX: unlock Epoch IV gate (bossAssimilated)
    const _bp = bossState.activeBossProfile;
    const _bl = getLang();
    showToast(
      (_bl === 'en' ? (_bp?.winTitleEN || _bp?.winTitle) : _bp?.winTitle) || (_bl === 'de' ? 'BOSS BESIEGT' : 'BOSS DEFEATED'),
      (_bl === 'en' ? (_bp?.winSubEN   || _bp?.winSub)   : _bp?.winSub)   || (_bl === 'de' ? 'Das Netz stabilisiert sich.' : 'The network stabilises.'),
      4200
    );
    finalizeRunVictory();
  }
  refresh();
}

export function startBossFight() {
  clearNowAction('event');
  clearNowAction('sync');
  msgStack.onBossFightStart();

  transitionBossFightUI();

  clearTimer('bossFightStart');
  regTimer('bossFightStart', setTimeout(() => {
    bossState.bossActive = true;
    syncLegacyBossState();
    G.paused = false;
    initBossFromDifficulty();
    if (bossState.activeBossProfile) setBossProfile(bossState.activeBossProfile);
    BOSS.hp = BOSS.maxHP;
    BOSS.phase = 1;
    BOSS.hitsTaken = 0;
    BOSS.vulnOpen = false;
    BOSS.lastAttack = clock.getElapsedTime() + 5;
    BOSS.lastVuln = clock.getElapsedTime() + 8;
    BOSS.bossStartTime = Date.now();
    updateBossHUD();
    setBossHudVisible(true);
    const _langAwk = getLang();
    showToast(
      (bossState.activeBossProfile?.name || 'THE NULL CORTEX') + (_langAwk === 'de' ? ' ERWACHT' : ' AWAKENS'),
      _langAwk === 'de'
        ? 'Treffe seine Verwundbarkeits-Fenster mit Pulse!'
        : 'Hit its vulnerability windows with Pulse!',
      3600
    );
    shock(bossState.activeBossProfile?.color || 0xff2200);
    clearTimer('bossFightStart');
  }, 700), 'timeout');
}

export function tickBoss(t) {
  if (!bossState.bossTriggered && G.l3CapturedClusters >= 8 && !G.runWon) {
    triggerBossIntro();
  }
  if (!bossState.bossActive || G.runWon || G.paused) return;

  updatePhase();

  if (BOSS.vulnOpen) {
    const frac = 1 - ((t - BOSS.vulnStart) / (BOSS.vulnDuration || 1));
    setBossVulnerabilityUI({ open: true, title: 'VULNERABILITY', frac });
    if (t - BOSS.vulnStart >= BOSS.vulnDuration) {
      closeVulnerability(true); // window expired = missed
      BOSS.lastVuln = t;
    }
  } else if (t - BOSS.lastVuln >= BOSS.vulnInterval) {
    openVulnerability(t);
  }

  const interval = BOSS.phase >= 3 ? Math.max(5, BOSS.attackInterval - 4) : BOSS.phase === 2 ? Math.max(7, BOSS.attackInterval - 2) : BOSS.attackInterval;
  if (!BOSS.vulnOpen && t - BOSS.lastAttack >= interval) {
    bossAttack(t);
  }

  // FIX 2.5: Profile-specific boss mechanics
  const profile = bossState.activeBossProfile;
  if (profile?.id === 'ghost_matrix') tickGhostMatrix(t);
  else if (profile?.id === 'sigma_recursive') { /* Sigma: miss penalty applied in bossHit */ }
  else if (profile?.id === 'vortex_architect') tickVortexArchitect(t);

  // v96: Rogue node trigger — spawned once when entering phase 2
  if (BOSS.phase >= 2 && !_rogueActive && !_rogueNodeTriggered) {
    _rogueNodeTriggered = true;
    regTimer('bossRogueDelay', setTimeout(() => {
      triggerBossRogueNode();
      clearTimer('bossRogueDelay');
    }, 2500), 'timeout');
  }

  updateBossHUD();
}
let _rogueNodeTriggered = false;

// ── FIX 2.5 / P2: Ghost Matrix — randomised fake windows ──────────────────
// Original: even-numbered windows were always fakes (trivially countable after run 1).
// New: each window has a 30% chance of being a fake, signalled by a slightly
// different colour pulse (CSS class 'ghost-fake-hint' on boss-hud).
const ghostState = { windowCount: 0, fakeOpen: false };
function tickGhostMatrix(t) {
  if (!BOSS.vulnOpen) { ghostState.fakeOpen = false; return; }
  if (!ghostState._initialized) {
    ghostState.windowCount = 0;
    ghostState._initialized = true;
  }
  // Fake flag set when the vulnerability window opens (see openVulnerability hook)
}

function _ghostDecideFake() {
  // Called at the moment a new vulnerability window opens for Ghost Matrix.
  // 30% fake chance — slightly telegraphed via CSS class 'ghost-fake-hint'.
  ghostState.windowCount = (ghostState.windowCount || 0) + 1;
  ghostState.fakeOpen = Math.random() < 0.30;
  const hudEl = document.getElementById('boss-hud');
  if (hudEl) {
    hudEl.classList.toggle('ghost-fake-hint', ghostState.fakeOpen);
  }
}

// ── FIX 2.5: Vortex Architect — capture bonus drains over time ──────────────────
const vortexState = { captureDecay: 0 };
function tickVortexArchitect(t) {
  // Every 10s of boss fight, reduce a soft "capture readiness" for the player.
  // We express this by temporarily nerfing passive cluster gain if the player delays too long.
  const elapsed = BOSS.bossStartTime ? (Date.now() - BOSS.bossStartTime) / 1000 : 0;
  if (elapsed > 30 && !vortexState.warned) {
    vortexState.warned = true;
    const lang = getLang();
    showToast(
      lang === 'de' ? '⚠ VORTEX SAUGT' : '⚠ VORTEX DRAINING',
      lang === 'de' ? 'Passive Gewinne sinken — Triff schnell' : 'Passive gains falling — hit quickly',
      2200
    );
  }
  if (elapsed > 30) {
    // Softly reduce passive gain each 15s of delay (capped at 50% reduction)
    const decaySteps = Math.min(3, Math.floor((elapsed - 30) / 15));
    G.energy = Math.max(0, G.energy - decaySteps * 0.05); // tiny but felt drain per frame
  }
}

export function bossHit() {
  if (!bossState.bossActive || !BOSS.vulnOpen) return false;
  
  // FIX P2: Ghost Matrix — random fake windows (was predictable even/odd)
  if (bossState.activeBossProfile?.id === 'ghost_matrix') {
    _ghostDecideFake();
    if (ghostState.fakeOpen) {
      const lang = getLang();
      const fakeDmg = 8;
      G.energy = Math.max(0, G.energy - fakeDmg);
      showToast(
        lang === 'de' ? '👻 GHOST-ECHO — FALSCHES MUSTER' : '👻 GHOST ECHO — WRONG PATTERN',
        lang === 'de' ? `−${fakeDmg}⬡ · Dieses Fenster war eine Falle` : `−${fakeDmg}⬡ · This window was a trap`,
        2000
      );
      // Remove hint class after penalty
      const hudEl = document.getElementById('boss-hud');
      if (hudEl) hudEl.classList.remove('ghost-fake-hint');
      spawnShock(0x44ffcc);
      return false; // no actual damage
    }
  }

  // FIX 2.5: Sigma Recursive — missed hit extends fight (handled via miss penalty below)
  recordBossWindowHit();
  BOSS.hp = Math.max(0, BOSS.hp - 1);
  BOSS.hitsTaken++;
  shock(bossState.activeBossProfile?.color || 0xff2200);
  updateBossHUD();
  if (BOSS.hp <= 0) {
    endBossFight(true);
  }
  return true;
}

/** FIX 2.5: Sigma Recursive — call when a boss window closes without being hit */
export function onBossWindowMissed() {
  if (!bossState.bossActive) return;
  if (bossState.activeBossProfile?.id !== 'sigma_recursive') return;
  // Each miss extends the fight: re-add 1 HP (max +2 extensions per fight)
  const extensions = bossState._sigmaExtensions || 0;
  if (extensions >= 2) return;
  bossState._sigmaExtensions = extensions + 1;
  BOSS.hp = Math.min(BOSS.maxHP + 2, BOSS.hp + 1);
  BOSS.maxHP = Math.max(BOSS.maxHP, BOSS.hp);
  const lang = getLang();
  showToast(
    lang === 'de' ? '∞ SIGMA-REKURSION' : '∞ SIGMA RECURSION',
    lang === 'de' ? 'Verfehltes Fenster verlängert die Schleife (+1 HP)' : 'Missed window extends the loop (+1 HP)',
    2200
  );
  spawnShock(0xcc44ff);
  updateBossHUD();
}
window.BOSS_PROFILES = BOSS_PROFILES;
window.BOSS = BOSS;
window._selectBossProfile = selectBossProfile;
window.initBossFromDifficulty = initBossFromDifficulty;
window.triggerBossIntro = triggerBossIntro;
window.updateBossHUD = updateBossHUD;
window._startBossFight = startBossFight;
window.tickBoss = tickBoss;
window.bossHit = bossHit;
window._bossHit = bossHit;
window.onBossWindowMissed = onBossWindowMissed;
window.triggerBossWarning = triggerBossWarning;
window.triggerBossWarning2 = triggerBossWarning2;
window.triggerBossRogueNode = triggerBossRogueNode;

// ── v96: Rogue Node ────────────────────────────────────────────────────────
// Boss spawns a "rogue" relay node that drains energy from nearby links.
// Lasts for ROGUE_DURATION seconds, then self-destructs.
const _ROGUE_DURATION = 14000;
let _rogueActive = false;
let _rogueNode = null;

export function triggerBossRogueNode() {
  if (_rogueActive || !bossState.bossActive) return;
  if (gameNodes.length < 3) return;

  const lang = getLang();
  _rogueActive = true;

  // Pick a random link midpoint to place the rogue node
  const candidateLink = gameLinks.length > 0
    ? gameLinks[Math.floor(Math.random() * gameLinks.length)]
    : null;

  const pos = candidateLink
    ? candidateLink.a.pos.clone().lerp(candidateLink.b.pos, 0.5).addScalar((Math.random() - 0.5) * 1.2)
    : gameNodes[Math.floor(Math.random() * gameNodes.length)].pos.clone().addScalar(1.5);

  // Visual: spawn shock at position
  spawnShock(0xff2200);

  showToast(
    lang === 'de' ? '◈ ROGUE NODE AKTIV' : '◈ ROGUE NODE ACTIVE',
    lang === 'de'
      ? 'Feindlicher Knoten drains Energie · ' + (_ROGUE_DURATION / 1000) + 's'
      : 'Hostile node draining energy · ' + (_ROGUE_DURATION / 1000) + 's',
    3500
  );

  // Drain energy every 2s while active
  regTimer('bossRogueDrain', setInterval(() => {
    if (!_rogueActive || !bossState.bossActive) { clearTimer('bossRogueDrain'); return; }
    if (G.energy > 4) {
      G.energy = Math.max(0, G.energy - 3);
      spawnShock(0xdd0000);
    }
  }, 2000), 'interval');

  // Self-destruct after ROGUE_DURATION
  regTimer('bossRogueNode', setTimeout(() => {
    _rogueActive = false;
    _rogueNode = null;
    clearTimer('bossRogueDrain');
    spawnShock(0x44ff44);
    const l2 = getLang();
    showToast(
      l2 === 'de' ? '◈ ROGUE NODE ELIMINIERT' : '◈ ROGUE NODE ELIMINATED',
      l2 === 'de' ? 'Feindlicher Einfluss entfernt' : 'Hostile influence removed',
      2000
    );
    clearTimer('bossRogueNode');
  }, _ROGUE_DURATION), 'timeout');
}

// ── v96: Phase Counter-Attack ──────────────────────────────────────────────
// Boss exploits Phase Links during vulnerability window close — briefly
// reverses a phase link's signal direction (signals flow toward the player).
export function triggerBossPhaseCounterAttack() {
  if (!bossState.bossActive) return;
  const phaseLinks = gameLinks.filter(l => l.type === 'phase' && l._phaseActive);
  if (phaseLinks.length === 0) return;

  const target = phaseLinks[Math.floor(Math.random() * phaseLinks.length)];
  const lang = getLang();
  const origActive = target._phaseActive;

  target._phaseActive = false; // force inactive = darkens
  showToast(
    lang === 'de' ? '◈ GEGENOFFENSIVE' : '◈ COUNTER-ATTACK',
    lang === 'de'
      ? 'Phase-Link umgekehrt · Drain aktiv'
      : 'Phase link reversed · Drain active',
    2400
  );
  spawnShock(BOSS.color || 0xff4400);

  // Apply drain shocks every 1s for 5s
  let ticks = 0;
  regTimer('bossPhaseAttack', setInterval(() => {
    if (!bossState.bossActive || ++ticks >= 5) {
      clearTimer('bossPhaseAttack');
      target._phaseActive = origActive;
      return;
    }
    if (G.energy > 2) G.energy = Math.max(0, G.energy - 2);
    spawnShock(0xff2200);
  }, 1000), 'interval');
}
window.triggerBossPhaseCounterAttack = triggerBossPhaseCounterAttack;

export {
  BOSS_PROFILES,
  BOSS,
  bossState,
  getActiveBossProfile,
  getBossWinClass,
  syncLegacyBossState,
  resetBossRuntimeState,
  exportBossRuntimeState,
  restoreBossRuntimeState,
};
