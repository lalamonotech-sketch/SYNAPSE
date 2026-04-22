/**
 * SYNAPSE v95 — AI system
 * Phase G migration pass.
 *
 * This module ports the operational AI core from v89:
 *   - aiState + profile scoring
 *   - awareness stages
 *   - training pulse scoring
 *   - AI HUD updates
 *   - persistent AI meta cache
 *   - bridge helper messages used by layer2/layer3
 *
 * Notes:
 *   - Messaging/UI helpers remain optional via window.* bridges.
 *   - This pass intentionally keeps the public window aliases so HTML onclick
 *     handlers and not-yet-migrated code still work.
 */

import { G } from '../state/gameState.js';
import { gameplayFlags } from '../state/gameplayFlags.js';
import { TUNING } from '../state/tuning.js';
import { getLang } from '../state/settings.js';
import { regTimer, clearTimer } from '../registries/timerRegistry.js';
import {
  aiState,
  AI_STAGE_NAMES,
  AI_PROFILE_LABELS,
  AI_MOOD_LABELS,
  AI_PROFILE_COLORS,
  PROFILE_BONUS,
  resetAIRuntimeState,
  exportAIRuntimeState,
  restoreAIRuntimeState,
} from '../state/aiShared.js';
import { gameNodes, gameLinks, spawnShock, linkVersion } from '../layers/network/index.js';
import { bLinks, getActiveBridgeCount } from '../layers/bridge/index.js';
import { SFX } from '../audio/sfx.js';
import { showToast, updateAIHudPanel } from '../ui/hud/index.js';
import { signalAIChanged } from '../platform/stateSignals.js';
import { setNowAction } from '../ui/actionFlow.js';
import { showTrainScorePopup } from '../ui/actionFlow.js';
import { emitAgentMessage, showAgentMsg } from '../meta/flow.js';
import { getEffectiveTrainCost } from '../gameplay/balance.js';

// ── Persistent AI meta ─────────────────────────────────────────────────────
const LS_AI_META = 'synapse_ai_meta';
const META_DEFAULT = {
  totalRuns: 0,
  profileHistory: [],
  avgSpineLength: 0,
  fusionRuns: 0,
  avgPulseFreq: 0,
  avgStableRatio: 0,
  bestTrainingScores: { routing: 0, timing: 0, stability: 0, memory: 0 },
  unlockedTraits: [],
  dominantOverall: null,
  metaObjectivesGenerated: [],
  totalElitesCaptured: 0,
  eliteSuccesses: 0,
  eliteFailures: 0,
  eliteTimeouts: 0,
  conditionsSeen: 0,
  conditionWins: 0,
  questlinesCompleted: 0,
  bossConditionWins: 0,
};

let _aiMetaCache = null;
let _aiMetaDirty = true;

export function invalidateAIMetaCache() {
  _aiMetaDirty = true;
}

export function loadAIMeta() {
  try {
    const raw = localStorage.getItem(LS_AI_META);
    if (raw) return Object.assign({}, META_DEFAULT, JSON.parse(raw));
  } catch (_) {}
  return Object.assign({}, META_DEFAULT);
}

export function loadAIMetaCached() {
  if (_aiMetaDirty || !_aiMetaCache) {
    _aiMetaCache = loadAIMeta();
    _aiMetaDirty = false;
  }
  return _aiMetaCache;
}

export function saveAIMeta(meta) {
  invalidateAIMetaCache();
  try { localStorage.setItem(LS_AI_META, JSON.stringify(meta)); } catch (_) {}
}

// ── AI runtime state lives in ../state/aiShared.js ──────────────────────

let _linkCountCache = { key: -1, stable: 0, fragile: 0, resonance: 0, fast: 0, total: 0 };
let _lastAITick = 0;
let _lastHudTick = 0;
let _prevTrainLevel = 0;

// ── v96: Phantom Misfire state ─────────────────────────────────────────────
let _lastPhantomT = 0;
let _nextPhantomInterval = 6.0;

// ── v96: Predator SPOF state ───────────────────────────────────────────────
let _lastSpofCheck = 0;

// ── v96: Architect mirror state ────────────────────────────────────────────
let _lastArchitectMirror = 0;
const _ARCHITECT_MIRROR_COOLDOWN = 20000;

// ── v96: Behavior evaluation state ────────────────────────────────────────
let _lastBehaviorEvalT = 0;

function getRecentIntervalStats(limit, minCount = 1) {
  const arr = aiState.pulseIntervals;
  const len = arr.length;
  if (len < minCount) return null;
  const start = Math.max(0, len - limit);
  const count = len - start;
  if (count < minCount) return null;
  let sum = 0;
  for (let i = start; i < len; i++) sum += arr[i];
  const avg = count > 0 ? (sum / count) : 0;
  if (avg <= 0) return { avg: 0, varPct: 1, count };
  let dev = 0;
  for (let i = start; i < len; i++) dev += Math.abs(arr[i] - avg);
  return { avg, varPct: (dev / count) / avg, count };
}

function getCombinedProfileScore(scores) {
  return (scores.analyst || 0) + (scores.predator || 0) + (scores.architect || 0) + (scores.mnemonic || 0);
}

function pickDominantProfile(scores, explorative) {
  let bestKey = null, bestScore = -1;
  let secondScore = -1;
  const keys = ['analyst', 'predator', 'architect', 'mnemonic'];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const score = scores[key] || 0;
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestKey = key;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }
  const gap = bestScore - Math.max(0, secondScore);
  const gapThreshold = explorative ? 6 : 10;
  const qualifies = (bestScore >= 25 && gap >= gapThreshold) || (bestScore >= 40 && gap >= 5);
  return qualifies ? bestKey : null;
}

export function getLinkTypeCounts() {
  // linkVersion is a monotonic counter incremented on every makeLink/removeLink —
  // O(1) cache key, no string allocation, correctly invalidates on any mutation.
  if (linkVersion === _linkCountCache.key) return _linkCountCache;
  let stable = 0, fragile = 0, resonance = 0, fast = 0;
  for (const lk of gameLinks) {
    if      (lk.type === 'stable')    stable++;
    else if (lk.type === 'fragile')   fragile++;
    else if (lk.type === 'resonance') resonance++;
    else if (lk.type === 'fast')      fast++;
  }
  _linkCountCache = { key: linkVersion, stable, fragile, resonance, fast, total: gameLinks.length };
  return _linkCountCache;
}

export function getTrainingLevel(profile) {
  const map = { analyst: 'routing', predator: 'timing', architect: 'stability', mnemonic: 'memory' };
  const score = aiState.trainingScores[map[profile] || 'routing'] || 0;
  return Math.min(5, Math.floor(score / 20));
}

export function applyProfileBonuses() {
  PROFILE_BONUS.analyst.warnPhaseBonus = 0;
  PROFILE_BONUS.analyst.bridgeStabBonus = 0;
  PROFILE_BONUS.predator.pulseCdReduction = 0;
  PROFILE_BONUS.predator.burstBonus = 0;
  PROFILE_BONUS.architect.spineBonusScale = 0;
  PROFILE_BONUS.architect.macroCouplingRange = 0;
  PROFILE_BONUS.architect.backboneBonus = 0;
  PROFILE_BONUS.mnemonic.memEfficiency = 0;
  PROFILE_BONUS.mnemonic.fusionBurst = 0;

  const dp = aiState.dominantProfile;
  if (!dp) return;
  const level = getTrainingLevel(dp);
  if (level === 0) return;

  const stageMult = aiState.stageUnlocks?.selfOpt ? 1.2 : 1.0;
  if (dp === 'analyst') {
    PROFILE_BONUS.analyst.warnPhaseBonus = level * 0.5 * stageMult;
    PROFILE_BONUS.analyst.bridgeStabBonus = Math.min(0.3, level * 0.04 * stageMult);
  }
  if (dp === 'predator') {
    PROFILE_BONUS.predator.pulseCdReduction = Math.min(0.38, level * 0.07 * stageMult);
    PROFILE_BONUS.predator.burstBonus = Math.round(level * 2 * stageMult);
  }
  if (dp === 'architect') {
    PROFILE_BONUS.architect.spineBonusScale = level * 0.06 * stageMult;
    PROFILE_BONUS.architect.macroCouplingRange = level * 0.08 * stageMult;
    PROFILE_BONUS.architect.backboneBonus = Math.round(level * 3 * stageMult);
  }
  if (dp === 'mnemonic') {
    PROFILE_BONUS.mnemonic.memEfficiency = Math.min(0.45, level * 0.08 * stageMult);
    PROFILE_BONUS.mnemonic.fusionBurst = Math.round(level * 4 * stageMult);
  }
}

export function computeAIProfiles() {
  if (G.runWon) return;

  const ps = aiState.profileScores;
  const elapsed = Math.max(1, (Date.now() - G.runStart) / 1000);
  const ltc = getLinkTypeCounts();
  // Compute once — used for analyst + passed to checkAwarenessStage via the call below
  const activeBr = getActiveBridgeCount();
  aiState._cachedActiveBr = activeBr; // stash for checkAwarenessStage in same call chain

  let analyst = 0;
  if (ltc.total > 0) analyst += Math.min(28, (ltc.stable / ltc.total) * 38);
  analyst += Math.min(22, G.tris.size * 5);
  analyst += Math.min(20, activeBr * 4);
  analyst += Math.min(10, ltc.resonance * 2.5);
  if (ltc.total > 0) analyst -= Math.min(12, (ltc.fragile / ltc.total) * 18);
  const analystStats = getRecentIntervalStats(6, 3);
  if (analystStats) {
    analyst += Math.max(0, 20 - analystStats.varPct * 25);
  }
  ps.analyst = Math.max(0, Math.min(100, Math.round(analyst)));

  let predator = 0;
  predator += Math.min(36, aiState.syncHits * 12);
  predator += Math.min(24, G.l3CapturedClusters * 6);
  if (elapsed > 20 && G.pulseCount > 0) {
    const ppm = (G.pulseCount / elapsed) * 60;
    predator += Math.min(22, ppm * 3.5);
  }
  predator += Math.min(18, aiState.burstEvents * 4);
  ps.predator = Math.max(0, Math.min(100, Math.round(predator)));

  let architect = 0;
  architect += Math.min(36, G.spineLength * 9);
  if (G.backboneActive) architect += 22;
  architect += Math.min(24, G.l3ConnectedCores * 5);
  architect += Math.min(18, G.fusedPairs.size * 6);
  ps.architect = Math.max(0, Math.min(100, Math.round(architect)));

  let mnemonic = 0;
  mnemonic += Math.min(32, G.memMaxOutput * 0.65);
  mnemonic += Math.min(28, aiState.memDischargeCount * 5);
  mnemonic += Math.min(22, G.fusedPairs.size * 8);
  // Count memory nodes inline — avoids Array.filter allocation (runs every 2s)
  let memNodeCount = 0;
  for (const n of gameNodes) { if (n.type === 'memory') memNodeCount++; }
  mnemonic += Math.min(18, memNodeCount * 4);
  ps.mnemonic = Math.max(0, Math.min(100, Math.round(mnemonic)));

  const total = getCombinedProfileScore(ps);
  const prev = aiState.dominantProfile;

  if (total >= 22) {
    aiState.dominantProfile = pickDominantProfile(ps, aiState.metaTraits.explorative);
  } else {
    aiState.dominantProfile = null;
  }

  aiState.metaTraits.explorative = aiState.nodeTypesUsed.size >= 3;
  aiState.metaTraits.volatile = aiState.burstEvents >= 3;
  aiState.metaTraits.conservative = aiState.fragileLinksLost === 0 && ltc.fragile > 0;
  const rhythmicStats = getRecentIntervalStats(4, 4);
  if (rhythmicStats) {
    aiState.metaTraits.rhythmic = rhythmicStats.varPct < 0.28;
  }

  if (aiState.awarenessStage === 0) aiState.agentMood = 'dormant';
  else if (aiState.awarenessStage >= 4) aiState.agentMood = 'emergent';
  else {
    const moodMap = { analyst: 'focused', predator: 'aggressive', architect: 'expanding', mnemonic: 'deep' };
    aiState.agentMood = moodMap[aiState.dominantProfile] || 'observing';
  }

  if (aiState.dominantProfile && aiState.dominantProfile !== prev) {
    const lang = getLang();
    const name = AI_PROFILE_LABELS[lang][aiState.dominantProfile] || aiState.dominantProfile;
    showAgentMsg(lang === 'de' ? `Profil: ${name}.` : `Profile: ${name}.`, false, aiState.dominantProfile);
  }

  applyProfileBonuses();
  checkAwarenessStage();
  _tickArchitectMirror();
  signalAIChanged();
}

// ── v96: Architect Pattern Mirroring ──────────────────────────────────────
// When Architect is dominant and player is building triangles, the AI mimics
// the pattern — pulsing spine nodes with a visual flourish.
function _tickArchitectMirror() {
  if (aiState.dominantProfile !== 'architect') return;
  const now = Date.now();
  if (now - _lastArchitectMirror < _ARCHITECT_MIRROR_COOLDOWN) return;
  if (G.tris.size < 2) return;

  _lastArchitectMirror = now;

  const lang = getLang();
  showAgentMsg(
    lang === 'de'
      ? '◈ Strukturmuster analysiert. Repliziere.'
      : '◈ Structural pattern analysed. Replicating.',
    true, 'architect'
  );

  // Visual: pulse all spine-adjacent nodes
  for (let i = 0; i < gameNodes.length; i++) {
    const n = gameNodes[i];
    if (n._isSpine || n.type === 'relay') {
      const origSz = n.sz;
      if (n.m) {
        n.m.scale.setScalar(origSz * 1.5);
        setTimeout(() => { if (n.m) n.m.scale.setScalar(origSz); }, 280);
      }
    }
  }
  spawnShock(0xffcc44, 1);
}

export function checkAwarenessStage() {
  if (G.runWon) return;
  const s = aiState.awarenessStage;
  // Use value stashed by computeAIProfiles if called from there; otherwise recompute once
  const activeBr = (aiState._cachedActiveBr !== undefined) ? aiState._cachedActiveBr
                   : getActiveBridgeCount();
  aiState._cachedActiveBr = undefined; // consume
  const combined = Object.values(aiState.profileScores).reduce((a, b) => a + b, 0);
  let next = s;

  const lastAdvance = aiState.lastAwarenessAdvance || 0;
  if (Date.now() - lastAdvance < 45000 && s > 0) return;

  if (s < 1 && G.tris.size >= 1 && activeBr >= 1) next = 1;
  if (next >= 1 && s < 2 && G.l3CapturedClusters >= 1 && aiState.syncHits >= 2 && aiState.trainingRuns >= 2) next = 2;
  if (next >= 2 && s < 3 && (G.spineLength >= 3 || G.fusedPairs.size >= 1) && G.l3CapturedClusters >= 2) next = 3;
  if (next >= 3 && s < 4 && (G.backboneActive || (combined >= 240 && G.l3CapturedClusters >= 4))) next = 4;

  if (next !== s) {
    aiState.awarenessStage = next;
    aiState.lastAwarenessAdvance = Date.now();
    aiState.trainingHistory.push({ stage: next, profile: aiState.dominantProfile, ts: Date.now() });
    onAwarenessAdvance(next);
  }
}

function onAwarenessAdvance(stage) {
  const lang = getLang();
  const name = AI_STAGE_NAMES[lang][stage];
  const stageNum = stage + 1;
  const subtitles = {
    de: ['', 'Erste Strukturmuster erkannt · Profil formt sich', 'Vorhersagemodell aktiv · Sync-Fenster antizipiert', 'Netz optimiert sich selbst · Topologie konsolidiert', '★ Emergentes Verhalten · Identität vollständig'],
    en: ['', 'First structural patterns detected · Profile emerging', 'Prediction model active · Sync windows anticipated', 'Network self-optimizing · Topology consolidating', '★ Emergent behavior · Identity complete'],
  };
  showToast(`BEWUSSTSEIN · STUFE ${stageNum}`, `${name.toUpperCase()} — ${subtitles[lang][stage]}`, 4800);
  spawnShock([0x66ffcc, 0x66ffcc, 0x4488ff, 0xffcc44, 0xff6622][stage] || 0x66ffcc);
  applyStageEffects(stage);
}

export function applyStageEffects(stage) {
  if (stage >= 1) G.trainCd = 8500;
  if (stage >= 2) {
    G.l3SyncWindowDur = TUNING.syncWindowDuration + 0.8;
    aiState.stageUnlocks.predictive = true;
  }
  if (stage >= 3) {
    aiState.stageUnlocks.selfOpt = true;
    G.trainCost = 6;
    // v96: UI glitch when AI reaches awareness stage 3+
    _triggerUIGlitch(stage - 2);
  }
  if (stage >= 4) {
    aiState.stageUnlocks.emergent = true;
    aiState.emergenceActive = true;
    _triggerUIGlitch(2);
  }
}

// ── v96: UI Glitch Effect ──────────────────────────────────────────────────
// Momentarily corrupts the HUD elements when AI awareness escalates,
// giving the impression the AI is "overwriting" the interface.
function _triggerUIGlitch(intensity) {
  const selectors = ['#control-dock', '#hud-topbar', '.ai-panel', '#agent-line'];
  const targets = selectors.map(s => document.querySelector(s)).filter(Boolean);
  if (targets.length === 0) return;

  const duration = Math.min(3, intensity) * 500;
  targets.forEach(el => el.classList.add('v96-ui-glitch'));
  setTimeout(() => targets.forEach(el => el.classList.remove('v96-ui-glitch')), duration);
}

export function updateAIHud() {
  updateAIHudPanel({
    awarenessStage: aiState.awarenessStage,
    dominantProfile: aiState.dominantProfile,
    profileScores: aiState.profileScores,
    mood: aiState.agentMood,
    lang: getLang(),
    stageNames: AI_STAGE_NAMES,
    profileLabels: AI_PROFILE_LABELS,
    moodLabels: AI_MOOD_LABELS,
    profileColors: AI_PROFILE_COLORS,
    trainingLevel: aiState.dominantProfile ? getTrainingLevel(aiState.dominantProfile) : 0,
  });
}

export function doTrainPulse() {
  if (G.paused) return;
  const now = Date.now();
  const cd = G.trainCd - (now - G.trainMs);
  const lang = getLang();
  if (cd > 0) {
    showToast(
      lang === 'de' ? 'Training lädt' : 'Training charging',
      Math.ceil(cd / 1000) + 's',
      900
    );
    return;
  }
  const trainCost = getEffectiveTrainCost();
  if (G.energy < trainCost) {
    showToast(
      lang === 'de' ? 'Zu wenig Energie' : 'Not enough energy',
      lang === 'de'
        ? `Training kostet ${trainCost}⬡ · aktuell ${Math.round(G.energy)}⬡`
        : `Training costs ${trainCost}⬡ · current ${Math.round(G.energy)}⬡`,
      1200
    );
    return;
  }
  if (!G.autoOn) {
    showToast(
      lang === 'de' ? 'Noch nicht bereit' : 'Not ready yet',
      lang === 'de' ? 'Erst Auto-Genesis aktivieren' : 'Activate Auto-Genesis first',
      1200
    );
    return;
  }
  if (gameplayFlags.phantomNexusGhostCooldownEnd && now < gameplayFlags.phantomNexusGhostCooldownEnd) {
    const remaining = Math.ceil((gameplayFlags.phantomNexusGhostCooldownEnd - now) / 1000);
    showToast(
      lang === 'de' ? '◈ TRAINING GESPERRT' : '◈ TRAINING LOCKED',
      lang === 'de'
        ? remaining + 's · Phantom blockiert Training'
        : remaining + 's · Phantom blocking training',
      1200
    );
    return;
  }

  G.energy -= trainCost;
  G.trainMs = now;
  aiState.trainingRuns++;

  const recent = aiState.recentTrains || (aiState.recentTrains = []);
  let write = 0;
  for (let i = 0; i < recent.length; i++) {
    const ts = recent[i];
    if (now - ts < 30000) recent[write++] = ts;
  }
  recent.length = write;
  const spamCount = recent.length;
  const trainSpamPenalty = spamCount <= 2 ? 0 : spamCount === 3 ? 0.15 : spamCount === 4 ? 0.30 : 0.45;
  if (spamCount >= 3) G.trainCd = Math.min(20000, G.trainCd + Math.round((spamCount - 2) * 500));
  else G.trainCd = 10000;
  recent.push(now);

  let routingScore = 0;
  if (aiState.lastPulseTime > 0) {
    const gap = now - aiState.lastPulseTime;
    if (gap > 20000) routingScore = 0;
    else if (gap < 8000) routingScore = Math.round(Math.max(0, 25 - gap / 360));
    else routingScore = Math.max(0, 8 - Math.floor((gap - 8000) / 2000));
  }

  let timingScore = 0;
  const timingStats = getRecentIntervalStats(5, 3);
  if (timingStats) {
    timingScore = Math.round(Math.max(0, 28 * (1 - timingStats.varPct * 1.5)));
  }

  // Count active bridges with for-loop — no Array.filter allocation
  let activeBr = 0;
  for (const lk of bLinks) { if (lk.active) activeBr++; }
  const totalBr = bLinks.length;
  let stabilityScore = totalBr > 0 ? Math.round((activeBr / totalBr) * 30) : 0;
  stabilityScore += Math.min(10, G.tris.size * 3);

  let memoryScore = 0;
  memoryScore += Math.min(18, aiState.syncHits * 5);
  memoryScore += Math.min(12, aiState.burstEvents * 3);
  memoryScore += Math.min(10, aiState.memDischargeCount * 3);
  if (G.backboneActive) memoryScore += 10;
  else if (G.spineBonusActive) memoryScore += 5;

  routingScore = Math.min(100, routingScore);
  timingScore = Math.min(100, timingScore);
  stabilityScore = Math.min(100, stabilityScore);
  memoryScore = Math.min(100, memoryScore);

  const selfOptMult = (aiState.stageUnlocks?.selfOpt ? 1.12 : 1.0) * (aiState.metaTraits.rhythmic ? 1.06 : 1.0) * (1 - trainSpamPenalty);
  aiState.trainSpamPenalty = trainSpamPenalty;

  const ts = aiState.trainingScores;
  ts.routing = Math.min(100, Math.round(ts.routing * 0.7 + routingScore * 0.3 * selfOptMult));
  ts.timing = Math.min(100, Math.round(ts.timing * 0.7 + timingScore * 0.3 * selfOptMult));
  ts.stability = Math.min(100, Math.round(ts.stability * 0.7 + stabilityScore * 0.3 * selfOptMult));
  ts.memory = Math.min(100, Math.round(ts.memory * 0.7 + memoryScore * 0.3 * selfOptMult));

  const totalRun = Math.round((routingScore + timingScore + stabilityScore + memoryScore) / 4);
  aiState.bestTrainScore = Math.max(aiState.bestTrainScore || 0, totalRun);
  aiState.lastScoreDelta = {
    routing: Math.round(routingScore * 0.3 * selfOptMult),
    timing: Math.round(timingScore * 0.3 * selfOptMult),
    stability: Math.round(stabilityScore * 0.3 * selfOptMult),
    memory: Math.round(memoryScore * 0.3 * selfOptMult),
  };

  computeAIProfiles();
  const prevTrainLevel = _prevTrainLevel || 0;
  const dp = aiState.dominantProfile;
  const newTrainLevel = dp ? getTrainingLevel(dp) : 0;
  applyProfileBonuses();

  if (dp && newTrainLevel > prevTrainLevel) {
    _prevTrainLevel = newTrainLevel;
    const lang = getLang();
    const breakMsgs = {
      de: ['Trainingsdurchbruch.', 'Neues Level erreicht.', 'Kapazität gestiegen.'],
      en: ['Training breakthrough.', 'New level reached.', 'Capacity increased.'],
    };
    const pool = breakMsgs[lang] || breakMsgs.de;
    clearTimer('aiTrainBreakthroughMsg');
    regTimer('aiTrainBreakthroughMsg', setTimeout(() => {
      showAgentMsg(pool[Math.floor(Math.random() * pool.length)], false, dp);
      clearTimer('aiTrainBreakthroughMsg');
    }, 600), 'timeout');
  } else if (dp) {
    _prevTrainLevel = newTrainLevel;
  }

  if (gameplayFlags.phantomNexusEchoBonus > 0) {
    G.energy += gameplayFlags.phantomNexusEchoBonus;
    if (gameplayFlags.phantomNexusEchoBonus >= 4) showToast('◈ PHANTOM ECHO', '+' + gameplayFlags.phantomNexusEchoBonus + '⬡', 900);
  }

  const phantomPenalty = (gameplayFlags.phantomNexusTrainPenaltyEnd && now < gameplayFlags.phantomNexusTrainPenaltyEnd) ? 0.85 : 1.0;
  if (phantomPenalty < 1.0) {
    ts.routing = Math.round(ts.routing * phantomPenalty);
    ts.timing = Math.round(ts.timing * phantomPenalty);
    ts.stability = Math.round(ts.stability * phantomPenalty);
    ts.memory = Math.round(ts.memory * phantomPenalty);
  }

  aiState.lastTrainTime = now;
  spawnShock(0x44ff88);
  spawnShock(0x22cc66);
  showTrainScorePopup(routingScore, timingScore, stabilityScore, memoryScore, totalRun);
  // v96: Training Trade-off — AI learns and counters your dominant build
  _applyTrainingImmunity(now);

  computeAIProfiles();
  signalAIChanged();
}

// ── v96: Training Build Immunity ───────────────────────────────────────────
function _detectBuildSignature() {
  const counts = {};
  for (let i = 0; i < gameNodes.length; i++) {
    const t = gameNodes[i].type;
    counts[t] = (counts[t] || 0) + 1;
  }
  let best = null, bestCount = 0;
  for (const [type, count] of Object.entries(counts)) {
    if (type === 'core' || type === 'source') continue;
    if (count > bestCount) { bestCount = count; best = type; }
  }
  return bestCount >= 3 ? best : null;
}

function _applyTrainingImmunity(now) {
  const buildSig = _detectBuildSignature();
  if (!buildSig) return;

  // Clean expired immunities
  aiState.trainingImmunities = (aiState.trainingImmunities || []).filter(im => im.expiresAt > now);

  // Add new immunity for this build
  const alreadyImmune = aiState.trainingImmunities.some(im => im.type === buildSig);
  if (!alreadyImmune) {
    aiState.trainingImmunities.push({ type: buildSig, expiresAt: now + 120000 });
    const lang = getLang();
    showToast(
      lang === 'de' ? '◈ KI LERNT DEINE TAKTIK' : '◈ AI LEARNS YOUR TACTIC',
      lang === 'de'
        ? `${buildSig}-Build für 2min konterkariert`
        : `${buildSig}-build countered for 2 min`,
      3200
    );
  }
}

export function isNodeTypeCountered(type) {
  const now = Date.now();
  return (aiState.trainingImmunities || []).some(im => im.type === type && im.expiresAt > now);
}


export function tickAI(t) {
  if (t - _lastAITick >= 2.0) {
    _lastAITick = t;
    computeAIProfiles();
  }
  if (t - _lastHudTick >= 0.25) {
    _lastHudTick = t;
    signalAIChanged();
  }
  // v96 features
  _tickPhantomMisfires(t);
  _tickPredatorSPOF(t);
  _tickBehaviorEval(t);
}

// ── v96: Phantom Misfires ─────────────────────────────────────────────────
// Sends ghost signals through random links when player is idle — makes the
// network feel alive even during inaction.
function _tickPhantomMisfires(t) {
  if (!G.autoOn || G.paused) return;
  if (gameLinks.length === 0) return;
  if (t - _lastPhantomT < _nextPhantomInterval) return;
  _lastPhantomT = t;
  _nextPhantomInterval = 4.0 + Math.random() * 5.0;

  const lk = gameLinks[Math.floor(Math.random() * gameLinks.length)];
  if (!lk || lk.sigs.length > 2) return;

  const s = spawnSig(lk, 0.5);
  if (s) {
    s._phantom = true;
    s._phantomOpacity = 0.10 + Math.random() * 0.06;
  }
}

// ── v96: Predator SPOF Detection ──────────────────────────────────────────
// If Predator profile is dominant and >80% of signals flow through one relay,
// Predator converts the most-used link on that node to "fragile".
function _tickPredatorSPOF(t) {
  if (t - _lastSpofCheck < 4.0) return;
  _lastSpofCheck = t;
  if (aiState.dominantProfile !== 'predator') return;
  if (signals.length < 5) return;

  const nodeLoad = new Map();
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    if (s._phantom) continue;
    const a = s.lk.a, b = s.lk.b;
    if (a.type === 'relay') nodeLoad.set(a, (nodeLoad.get(a) || 0) + 1);
    if (b.type === 'relay') nodeLoad.set(b, (nodeLoad.get(b) || 0) + 1);
  }

  for (const [node, load] of nodeLoad) {
    const pct = load / signals.length;
    if (pct < 0.80) continue;

    const lang = getLang();
    showAgentMsg(
      lang === 'de'
        ? '◈ Kritischer Engpass. Destabilisierung.'
        : '◈ Critical bottleneck. Destabilising.',
      true, 'predator'
    );

    // Find and degrade the busiest link on this node
    const nodeLinks = gameLinks.filter(lk => (lk.a === node || lk.b === node) && lk.type === 'stable');
    if (nodeLinks.length > 0) {
      const target = nodeLinks[Math.floor(Math.random() * nodeLinks.length)];
      target.type = 'fragile';
      target.lt = window.LT ? window.LT.fragile : target.lt;
      showToast(
        lang === 'de' ? '⚠ ENGPASS UNTER ANGRIFF' : '⚠ BOTTLENECK UNDER ATTACK',
        lang === 'de' ? 'Relay-Node überlastet · Link fragil' : 'Relay overloaded · Link turned fragile',
        2400
      );
    }
    break;
  }
}

// ── v96: Behavior Evaluation — ticker evaluates player actions ────────────
function _tickBehaviorEval(t) {
  if (t - _lastBehaviorEvalT < 9.0) return;
  _lastBehaviorEvalT = t;

  const timeSinceLastPulse = aiState.lastPulseTime ? (Date.now() - aiState.lastPulseTime) / 1000 : 999;
  const lang = getLang();
  const ltc = getLinkTypeCounts();

  if (timeSinceLastPulse > 22 && G.autoOn) {
    const msgs = lang === 'de'
      ? ['Synaptische Stagnation. Aktion erforderlich.', 'Inaktivität registriert.', 'Netz in Ruhezustand. Intervall kritisch.']
      : ['Synaptic stagnation. Action required.', 'Inactivity threshold exceeded.', 'Network idle. Interval critical.'];
    showAgentMsg(msgs[Math.floor(Math.random() * msgs.length)], false, aiState.dominantProfile);
    return;
  }

  if (G.tris.size >= 3 && ltc.total > 0 && ltc.stable > ltc.fragile * 2) {
    const msgs = lang === 'de'
      ? ['Strukturelle Integrität bemerkenswert.', 'Effiziente Topologie erkannt.', 'Triangulation optimal.']
      : ['Structural integrity remarkable.', 'Efficient topology noted.', 'Triangulation optimal.'];
    showAgentMsg(msgs[Math.floor(Math.random() * msgs.length)], false, 'analyst');
    return;
  }

  if (ltc.total > 0 && ltc.fragile / ltc.total > 0.5 && aiState.fragileLinksLost > 3) {
    const msgs = lang === 'de'
      ? ['Ineffizienter Signalfluss registriert.', 'Energieverlust durch fragile Links.', 'Instabile Routing-Muster erkannt.']
      : ['Inefficient signal flow registered.', 'Energy overhead detected.', 'Suboptimal routing observed.'];
    showAgentMsg(msgs[Math.floor(Math.random() * msgs.length)], false, aiState.dominantProfile);
    return;
  }
}


export function recordPulseInterval(now = Date.now()) {
  if (aiState.lastPulseTime > 0) {
    const interval = now - aiState.lastPulseTime;
    aiState.pulseIntervals.push(interval);
    if (aiState.pulseIntervals.length > 8) aiState.pulseIntervals.shift();
  }
  aiState.lastPulseTime = now;
}

export function agentOnSyncOpen() {
  emitAgentMessage('sync', true);
  setNowAction('sync', '⟳ SYNC-FENSTER — PULSE JETZT!', 'now-sync');
  SFX?.syncReady?.();
  // v96: Mnemonic memory — track open windows
  aiState.syncWindowOpen = true;
}

// v96: Call this when a sync window closes WITHOUT a hit
export function agentOnSyncMissed() {
  if (!aiState.syncWindowOpen) return;
  aiState.syncWindowOpen = false;
  aiState.missedSyncs = (aiState.missedSyncs || 0) + 1;

  if (aiState.dominantProfile === 'mnemonic' && aiState.missedSyncs >= 2) {
    const lang = getLang();
    showAgentMsg(
      lang === 'de'
        ? `◈ Verzögerung antizipiert. Toleranz reduziert. [${aiState.missedSyncs}×]`
        : `◈ Delay anticipated. Tolerance reduced. [${aiState.missedSyncs}×]`,
      true, 'mnemonic'
    );
    // Tighten the player's next sync window slightly (clamp at 1.2s minimum)
    if (G.l3SyncWindowDur !== undefined) {
      G.l3SyncWindowDur = Math.max(1.2, (G.l3SyncWindowDur || 2.0) - 0.15);
    }
  }
}
export function agentOnPulse() { emitAgentMessage('pulse', false); }
export function agentOnWin() { emitAgentMessage('win', true); }
export function agentOnBridge() { emitAgentMessage('bridge', false); }
export function agentOnMemory() { emitAgentMessage('memory', false); }
export function agentOnBackbone() { emitAgentMessage('backbone', true); }
export function agentOnSpine() { emitAgentMessage('spine', false); }
export function agentOnFusion() { emitAgentMessage('fusion', false); }

// ── Globals for bridge mode ────────────────────────────────────────────────
window.invalidateAIMetaCache = invalidateAIMetaCache;
window.loadAIMeta = loadAIMeta;
window.loadAIMetaCached = loadAIMetaCached;
window.saveAIMeta = saveAIMeta;
window.getLinkTypeCounts = getLinkTypeCounts;
window.getTrainingLevel = getTrainingLevel;
window.applyProfileBonuses = applyProfileBonuses;
window.computeAIProfiles = computeAIProfiles;
window.checkAwarenessStage = checkAwarenessStage;
window.applyStageEffects = applyStageEffects;
window.updateAIHud = updateAIHud;
window._trainPulse = doTrainPulse;
window.tickAI = tickAI;
window.recordPulseInterval = recordPulseInterval;
window.agentOnSyncOpen = agentOnSyncOpen;
window.agentOnSyncMissed = agentOnSyncMissed;
window.isNodeTypeCountered = isNodeTypeCountered;
window.agentOnPulse = agentOnPulse;
window.agentOnWin = agentOnWin;
window.agentOnBridge = agentOnBridge;
window.agentOnMemory = agentOnMemory;
window.agentOnBackbone = agentOnBackbone;
window.agentOnSpine = agentOnSpine;
window.agentOnFusion = agentOnFusion;

export {
  aiState,
  AI_STAGE_NAMES,
  AI_PROFILE_LABELS,
  AI_MOOD_LABELS,
  AI_PROFILE_COLORS,
  PROFILE_BONUS,
  resetAIRuntimeState,
  exportAIRuntimeState,
  restoreAIRuntimeState,
};
