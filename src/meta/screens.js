import { G } from '../state/gameState.js';
import { safeRestart } from '../engine/dispose.js';
import { LS_SAVE } from '../state/saveSystem.js';
import { metaState, getTelemetryDefaults, resetMetaState, restoreMetaState } from '../state/metaState.js';
import { synSettings, getLang, saveSettings } from '../state/settings.js';
import { gameNodes, gameLinks } from '../layers/network/index.js';
import { getActiveBridgeCount } from '../layers/bridge/index.js';
import { G_EVENT } from '../systems/events.js';
import { aiState, AI_STAGE_NAMES } from '../state/aiShared.js';
import { loadAIMetaCached, saveAIMeta } from '../systems/ai.js';
import { PROTOCOL_DEFS, getProtocolUnlockRules, getActiveProtocolId } from '../systems/protocols.js';
import { BOSS, BOSS_PROFILES, getActiveBossProfile, getBossWinClass } from '../state/bossShared.js';
import { G_DRAFT, getActiveQuestline } from './flow.js';
import { getActiveActionLabels } from '../state/actionState.js';
import { getActiveConditionId } from '../state/runContext.js';
// v98: Root Server meta-panel
import { mountRootServerPanel, refreshRootServerPanel } from '../systems/rootServer.js';
import { mountGeneticMemoryOverlay, injectResearchSummary, updateAPBadge } from '../systems/epochReveal.js';
import { bankAwakeningPoints, getRootServer } from '../systems/awakening.js';
// BUG-1 fix: import directly instead of relying on window._s4ComputeResearchAP bridge
// (epochReveal.js only registers that bridge after a lazy-import on Epoch II transition)
import { computeResearchAP } from '../systems/research.js';
import { el } from '../util/dom.js';
import {
  LS_RUN_HISTORY,
  LS_RUN_HISTORY_BACKUP,
  MAX_HISTORY,
  escapeHtml,
  loadRunHistory,
  saveRunHistory,
} from './_runHistory.js';

// Re-export so existing import sites (`from '../meta/screens.js'`) keep working.
export { loadRunHistory, saveRunHistory };

let _historyToggleHasData = null;
let _historyToggleProminent = null;

export function onRunEnd() {
  // v98: Bank Awakening Points at end of run, then persist history
  try {
    // BUG-1 fix: use direct ES import instead of window._s4ComputeResearchAP bridge
    const researchBonus = computeResearchAP();
    const pts = bankAwakeningPoints({ epochReached: G?.awakening?.epochIndex || 0, runDurationSecs: ((Date.now() - (G?.runStart || Date.now())) / 1000), peakEnergy: G?.peakEnergy || 0, megaProjectComplete: !!G?.megaProject?.complete, researchBonus });
    if (pts > 0) {
      import('../ui/hud/index.js').then(({ showToast }) => showToast('◈ +'+ pts +' AWAKENING POINTS', '', 2500));
      try { updateAPBadge(); } catch(e) { console.warn('[Synapse] updateAPBadge (bank) failed:', e); }
      // Animate AP badge
      setTimeout(() => {
        const badge = document.getElementById('s4-ap-badge');
        if (badge) { badge.classList.add('ap-gained'); setTimeout(() => badge.classList.remove('ap-gained'), 600); }
      }, 1000);
    }
  } catch(_) {}
}

function lang() {
  return getLang();
}

function setText(id, text) {
  const node = el(id);
  if (node) node.textContent = text ?? '';
}

function fmtDuration(sec) {
  const total = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtNum(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? String(Math.round(n)) : '0';
}

function profileLabel(profile) {
  if (!profile) return '—';
  const map = {
    analyst: lang() === 'de' ? 'Analyst' : 'Analyst',
    predator: lang() === 'de' ? 'Prädator' : 'Predator',
    architect: lang() === 'de' ? 'Architekt' : 'Architect',
    mnemonic: lang() === 'de' ? 'Mnemoniker' : 'Mnemonic',
  };
  return map[profile] || profile;
}

function protocolLabel(protocolId) {
  const p = PROTOCOL_DEFS?.[protocolId];
  if (!p) return '—';
  return lang() === 'de' ? (p.nameDe || p.id) : (p.nameEn || p.id);
}

function tierLabel(tier) {
  const t = Number(tier || 1);
  return t === 3 ? 'Tier III' : t === 2 ? 'Tier II' : 'Tier I';
}

function avgEnergy() {
  const tel = metaState.telemetry || getTelemetryDefaults();
  if (!tel.energySampleCount) return G.energy || 0;
  return tel.energySampleSum / tel.energySampleCount;
}

function getConditionId() {
  return getActiveConditionId();
}

function getConditionLabel() {
  const id = getConditionId();
  if (!id) return lang() === 'de' ? 'Keine' : 'None';
  const map = {
    low_signal: 'Low Signal',
    recursive_storm: 'Recursive Storm',
  };
  return map[id] || id;
}

function getSynergies() {
  return getActiveActionLabels(lang());
}

function getNodeMix() {
  const counts = { source: 0, relay: 0, amplifier: 0, memory: 0 };
  gameNodes.forEach(node => { counts[node.type] = (counts[node.type] || 0) + 1; });
  return counts;
}

function calculateBars(summary) {
  const aggression = Math.max(0, Math.min(100,
    Math.round(
      (summary.pulsesPerMin * 2.1)
      + (summary.capturedClusters * 4)
      + ((metaState.telemetry?.bossWindowsOpened || 0) * 5)
    )
  ));
  const precision = Math.max(0, Math.min(100,
    Math.round(
      (summary.bossAccuracy * 0.7)
      + ((aiState.trainingScores?.timing || 0) * 0.35)
      + ((aiState.trainingScores?.routing || 0) * 0.2)
    )
  ));
  const structure = Math.max(0, Math.min(100,
    Math.round(
      (G.tris.size * 8)
      + (getActiveBridgeCount() * 6)
      + (G.spineLength * 8)
      + (G.backboneActive ? 18 : 0)
    )
  ));
  const efficiency = Math.max(0, Math.min(100,
    Math.round(
      ((summary.avgEnergy / Math.max(1, summary.peakEnergy || 1)) * 55)
      + ((aiState.trainingScores?.memory || 0) * 0.25)
      + ((aiState.trainingScores?.stability || 0) * 0.2)
    )
  ));
  return { aggression, precision, structure, efficiency };
}

function overallGrade(summary, bars) {
  const score = (bars.aggression + bars.precision + bars.structure + bars.efficiency) / 4 + (summary.winTier - 1) * 8;
  if (score >= 85) return 'S';
  if (score >= 72) return 'A';
  if (score >= 58) return 'B';
  if (score >= 45) return 'C';
  return 'F';
}

function buildRunSummary() {
  const durationSec = Math.max(1, Math.round((Date.now() - (G.runStart || Date.now())) / 1000));
  const nodeMix = getNodeMix();
  const synergyNames = getSynergies();
  const bossWindowsOpened = metaState.telemetry?.bossWindowsOpened || 0;
  const bossWindowsHit = metaState.telemetry?.bossWindowsHit || 0;
  const bossAccuracy = bossWindowsOpened > 0 ? Math.round((bossWindowsHit / bossWindowsOpened) * 100) : 0;
  const bossDurationSec = BOSS?.bossStartTime ? Math.max(0, Math.round((Date.now() - BOSS.bossStartTime) / 1000)) : 0;
  const profile = aiState.dominantProfile || null;
  const protocolId = getActiveProtocolId() || null;
  const eliteResults = Array.isArray(metaState.eliteResults) ? metaState.eliteResults.map(item => ({ ...item })) : [];
  const activeQuestline = getActiveQuestline();
  const questline = activeQuestline ? {
    id: activeQuestline.id,
    profile: activeQuestline.profile,
    name: activeQuestline.name,
    completed: activeQuestline.completed === true,
  } : null;
  const condition = getConditionId();

  return {
    ts: Date.now(),
    durationSec,
    durationLabel: fmtDuration(durationSec),
    peakEnergy: Math.round(G.peakEnergy || 0),
    avgEnergy: Math.round(avgEnergy()),
    pulses: G.pulseCount || 0,
    pulsesPerMin: Math.round(((G.pulseCount || 0) / Math.max(1, durationSec)) * 60),
    triangles: G.tris?.size || 0,
    activeBridges: getActiveBridgeCount(),
    capturedClusters: G.l3CapturedClusters || 0,
    fusionPairs: G.fusedPairs?.size || 0,
    spineLength: G.spineLength || 0,
    backboneActive: !!G.backboneActive,
    upgrades: G_DRAFT?.appliedUpgrades?.length || 0,
    draftPicks: G_DRAFT?.appliedUpgrades?.length || 0,
    events: G_EVENT?.eventCount || 0,
    chains: metaState.telemetry?.totalChains || G_EVENT?.chainCount || 0,
    bossAccuracy,
    bossDurationSec,
    profile,
    protocolId,
    winTier: G.winTier || 1,
    perfect: !!G.backboneActive || (G.spineLength || 0) >= 3 || (G.fusedPairs?.size || 0) >= 2,
    condition,
    nodeMix,
    trainScores: { ...(aiState.trainingScores || {}) },
    awarenessStage: aiState.awarenessStage || 0,
    awarenessLabel: (AI_STAGE_NAMES?.[lang()] || [])[aiState.awarenessStage || 0] || String(aiState.awarenessStage || 0),
    eliteResults,
    questline,
    synergies: synergyNames,
    metaTraits: { ...(aiState.metaTraits || {}) },
    boss: {
      id: getActiveBossProfile()?.id || BOSS?.profileId || null,
      name: getActiveBossProfile()?.name || null,
    },
    layerTimes: { ...(metaState.telemetry?.layerTimes || {}) },
    timelineCount: Array.isArray(metaState.runTimeline) ? metaState.runTimeline.length : 0,
  };
}

function nextUnlockHint(meta) {
  const runs = meta.totalRuns || 0;
  if (runs < 2) return lang() === 'de' ? `Temporal-Protokoll ${runs}/2 → Freischaltung` : `Temporal protocol ${runs}/2 → unlock`;
  if (runs < 4) return lang() === 'de' ? `Mnemonic-Protokoll ${runs}/4 → Freischaltung` : `Mnemonic protocol ${runs}/4 → unlock`;

  const freq = {};
  (meta.profileHistory || []).forEach(run => {
    if (run.profile) freq[run.profile] = (freq[run.profile] || 0) + 1;
  });
  const needs = [
    ['architect', lang() === 'de' ? 'Lineares Denken' : 'Linear Thinking'],
    ['predator', lang() === 'de' ? 'Jagdinstinkt' : 'Hunt Instinct'],
    ['mnemonic', lang() === 'de' ? 'Gedächtnisrest' : 'Memory Trace'],
    ['analyst', lang() === 'de' ? 'Strukturbewusstsein' : 'Structural Awareness'],
  ];
  for (const [profile, reward] of needs) {
    if ((freq[profile] || 0) < 3) return `${profileLabel(profile)} ${(freq[profile] || 0)}/3 → ${reward}`;
  }

  const tier3Wins = (meta.profileHistory || []).filter(run => (run.tier || 0) >= 3).length;
  if (tier3Wins < 2) return `${lang() === 'de' ? 'Backbone' : 'Backbone'} ${tier3Wins}/2 → ${lang() === 'de' ? 'Backbone-Meister' : 'Backbone Master'}`;

  const fusionRuns = meta.fusionRuns || 0;
  if (fusionRuns < 2) return `${lang() === 'de' ? 'Fusion' : 'Fusion'} ${fusionRuns}/2 → ${lang() === 'de' ? 'Fusionserfahrung' : 'Fusion Experience'}`;

  return lang() === 'de' ? 'Alle Kernfreischaltungen aktiv' : 'All core unlocks active';
}

function deriveNewTraits(meta) {
  const existing = new Set(meta.unlockedTraits || []);
  const traits = [];
  const freq = {};
  (meta.profileHistory || []).forEach(run => {
    if (run.profile) freq[run.profile] = (freq[run.profile] || 0) + 1;
  });
  const pushTrait = name => { if (!existing.has(name) && !traits.includes(name)) traits.push(name); };
  if ((freq.architect || 0) >= 3) pushTrait(lang() === 'de' ? 'Lineares Denken' : 'Linear Thinking');
  if ((freq.predator || 0) >= 3) pushTrait(lang() === 'de' ? 'Jagdinstinkt' : 'Hunt Instinct');
  if ((freq.mnemonic || 0) >= 3) pushTrait(lang() === 'de' ? 'Gedächtnisrest' : 'Memory Trace');
  if ((freq.analyst || 0) >= 3) pushTrait(lang() === 'de' ? 'Strukturbewusstsein' : 'Structural Awareness');
  if ((meta.profileHistory || []).filter(run => (run.tier || 0) >= 3).length >= 2) pushTrait(lang() === 'de' ? 'Backbone-Meister' : 'Backbone Master');
  if ((meta.fusionRuns || 0) >= 2) pushTrait(lang() === 'de' ? 'Fusionserfahrung' : 'Fusion Experience');
  if ((meta.profileHistory || []).some(run => run.metaTraits?.rhythmic)) pushTrait(lang() === 'de' ? 'Rhythmisch' : 'Rhythmic');
  if ((meta.profileHistory || []).some(run => run.metaTraits?.conservative)) pushTrait(lang() === 'de' ? 'Konservativ' : 'Conservative');
  if ((meta.profileHistory || []).some(run => run.metaTraits?.volatile)) pushTrait(lang() === 'de' ? 'Volatil' : 'Volatile');
  if ((meta.profileHistory || []).some(run => run.metaTraits?.explorative)) pushTrait(lang() === 'de' ? 'Explorativ' : 'Explorative');
  return traits;
}

function generateMetaObjectives(meta, summary) {
  const objectives = [];
  if ((summary.bossAccuracy || 0) < 55) objectives.push({ de: 'Boss-Trefferquote über 55%', en: 'Boss accuracy above 55%' });
  if ((summary.capturedClusters || 0) < 8 || !summary.backboneActive) objectives.push({ de: 'Backbone im Boss-Run aktiv halten', en: 'Keep backbone active during the boss run' });
  if ((summary.trainScores?.memory || 0) < 25) objectives.push({ de: 'Memory-Training auf 25+ anheben', en: 'Raise memory training to 25+' });
  if ((meta.fusionRuns || 0) < 2) objectives.push({ de: '2+ Fusion-Paare sichern', en: 'Secure 2+ fusion pairs' });
  return objectives.slice(0, 3);
}

function updateMetaWithRun(summary) {
  const meta = loadAIMetaCached();
  const updated = {
    ...meta,
    totalRuns: (meta.totalRuns || 0) + 1,
    profileHistory: Array.isArray(meta.profileHistory) ? [...meta.profileHistory] : [],
    unlockedTraits: Array.isArray(meta.unlockedTraits) ? [...meta.unlockedTraits] : [],
    bestTrainingScores: { ...(meta.bestTrainingScores || {}) },
  };

  updated.profileHistory.push({
    ts: summary.ts,
    tier: summary.winTier,
    duration: summary.durationSec,
    profile: summary.profile,
    protocolId: summary.protocolId,
    bossId: summary.boss?.id || null,
    condition: summary.condition,
    perfect: summary.perfect,
    metaTraits: { ...(summary.metaTraits || {}) },
    questlineId: summary.questline?.id || null,
  });
  updated.profileHistory = updated.profileHistory.slice(-40);

  updated.avgSpineLength = Math.round((((meta.avgSpineLength || 0) * (updated.totalRuns - 1)) + (summary.spineLength || 0)) / updated.totalRuns);
  updated.fusionRuns = (meta.fusionRuns || 0) + ((summary.fusionPairs || 0) > 0 ? 1 : 0);
  updated.avgPulseFreq = Math.round((((meta.avgPulseFreq || 0) * (updated.totalRuns - 1)) + (summary.pulsesPerMin || 0)) / updated.totalRuns);
  const stableRatio = gameLinks.length ? (gameLinks.filter(link => link.type === 'stable').length / gameLinks.length) : 0;
  updated.avgStableRatio = Math.round((((meta.avgStableRatio || 0) * (updated.totalRuns - 1)) + stableRatio * 100) / updated.totalRuns);

  for (const key of ['routing', 'timing', 'stability', 'memory']) {
    updated.bestTrainingScores[key] = Math.max(updated.bestTrainingScores[key] || 0, summary.trainScores?.[key] || 0);
  }

  updated.questlinesCompleted = Math.max(meta.questlinesCompleted || 0, aiState.questlinesCompleted || 0);
  updated.conditionsSeen = (meta.conditionsSeen || 0) + (summary.condition ? 1 : 0);
  updated.conditionWins = (meta.conditionWins || 0) + (summary.condition ? 1 : 0);
  let eliteSuccesses = 0, eliteFailures = 0, eliteTimeouts = 0;
  for (let i = 0; i < summary.eliteResults.length; i++) {
    const result = summary.eliteResults[i]?.result || '';
    if (result === 'fail') eliteFailures++;
    else if (result === 'timeout') eliteTimeouts++;
    else if (/success|flawless|perfect/.test(result)) eliteSuccesses++;
  }
  updated.totalElitesCaptured = (meta.totalElitesCaptured || 0) + eliteSuccesses;
  updated.eliteSuccesses = (meta.eliteSuccesses || 0) + eliteSuccesses;
  updated.eliteFailures = (meta.eliteFailures || 0) + eliteFailures;
  updated.eliteTimeouts = (meta.eliteTimeouts || 0) + eliteTimeouts;
  updated.bossConditionWins = (meta.bossConditionWins || 0) + (summary.condition ? 1 : 0);

  const counts = {};
  updated.profileHistory.forEach(run => { if (run.profile) counts[run.profile] = (counts[run.profile] || 0) + 1; });
  updated.dominantOverall = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  updated.metaObjectivesGenerated = generateMetaObjectives(updated, summary);
  const newTraits = deriveNewTraits(updated);
  updated.unlockedTraits = [...new Set([...(updated.unlockedTraits || []), ...newTraits])];

  saveAIMeta(updated);
  return { meta: updated, newTraits };
}

function rowHtml(run, idx) {
  const isLast = idx === 0;
  return `<div class="hp-row">` +
    `<span class="hp-run-num">${isLast ? 'Neu' : '#' + (idx + 1)}</span>` +
    `<span class="hp-tier t${Math.max(1, Math.min(3, run.tier || 1))}">${escapeHtml(tierLabel(run.tier))}</span>` +
    `<span class="hp-profile">${escapeHtml(profileLabel(run.profile))}</span>` +
    `<span class="hp-time">${escapeHtml(fmtDuration(run.duration))}</span>` +
  `</div>`;
}

function renderProfileFrequency(history) {
  const target = el('hp-profile-freq');
  if (!target) return;
  const counts = {};
  history.forEach(run => { if (run.profile) counts[run.profile] = (counts[run.profile] || 0) + 1; });
  const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([profile, count]) => `${profileLabel(profile)} ${count}x`);
  target.innerHTML = parts.length
    ? `<div style="font-size:.32rem;letter-spacing:2px;color:rgba(180,220,255,.36);text-transform:uppercase">${parts.join(' · ')}</div>`
    : `<div style="opacity:.22">${lang() === 'de' ? 'Noch keine Profil-Daten' : 'No profile data yet'}</div>`;
}

function renderLastRunStrip(history, meta) {
  const node = el('hp-last-run');
  if (!node) return;
  if (!history.length) {
    node.style.display = 'none';
    node.textContent = '';
    return;
  }
  const last = history[history.length - 1];
  const totalTraits = (meta.unlockedTraits || []).length;
  const perfects = history.filter(run => run.perfect).length;
  node.style.display = 'block';
  node.textContent = `${lang() === 'de' ? 'Letzter' : 'Last'} · ${tierLabel(last.tier)} · ${profileLabel(last.profile)} · ${fmtDuration(last.duration || 0)} · ${lang() === 'de' ? 'Perfekt' : 'Perfect'} ${perfects} · Traits ${totalTraits}`;
}

function protocolCodexHtml(meta) {
  const totalRuns = meta.totalRuns || 0;
  const rules = getProtocolUnlockRules();
  return Object.entries(PROTOCOL_DEFS).map(([id, proto]) => {
    const need = rules[id]?.runs || 0;
    const unlocked = totalRuns >= need;
    const label = lang() === 'de' ? (proto.nameDe || id) : (proto.nameEn || id);
    const status = unlocked ? (lang() === 'de' ? 'frei' : 'open') : `${totalRuns}/${need}`;
    const color = unlocked ? 'rgba(100,255,170,.16)' : 'rgba(255,180,60,.12)';
    return `<div class="codex-trait" style="border-color:${color}"><span>${label}</span><span class="ct-run">${status}</span></div>`;
  }).join('');
}

function bossUnlockStates(history, meta) {
  const totalRuns = meta.totalRuns || 0;
  const tier2Wins = history.filter(run => (run.tier || 0) >= 2).length;
  const tier3Wins = history.filter(run => (run.tier || 0) >= 3).length;
  const perfectRuns = history.filter(run => run.perfect).length;
  const seen = new Set(history.map(run => run.bossId).filter(Boolean));
  return [
    { id: 'null_cortex', unlocked: true, seen: seen.has('null_cortex') },
    { id: 'ghost_matrix', unlocked: totalRuns >= 3 && tier2Wins >= 1, seen: seen.has('ghost_matrix') },
    { id: 'vortex_architect', unlocked: totalRuns >= 5 && perfectRuns >= 1, seen: seen.has('vortex_architect') },
    { id: 'sigma_recursive', unlocked: totalRuns >= 6 && tier2Wins >= 2, seen: seen.has('sigma_recursive') },
    { id: 'parasite_choir', unlocked: totalRuns >= 8 && tier3Wins >= 2, seen: seen.has('parasite_choir') },
  ];
}

function bossCodexHtml(history, meta) {
  return bossUnlockStates(history, meta).map(entry => {
    const boss = BOSS_PROFILES[entry.id];
    const label = boss?.name || entry.id;
    const status = entry.seen ? (lang() === 'de' ? 'besiegt/gesehen' : 'seen') : entry.unlocked ? (lang() === 'de' ? 'bereit' : 'ready') : (lang() === 'de' ? 'gesperrt' : 'locked');
    const color = entry.seen ? 'rgba(100,255,170,.16)' : entry.unlocked ? 'rgba(120,180,255,.16)' : 'rgba(255,90,90,.10)';
    return `<div class="codex-trait" style="border-color:${color}"><span>${label}</span><span class="ct-run">${status}</span></div>`;
  }).join('');
}

export function renderHistoryPanel(tab = 'recent') {
  const history = loadRunHistory();
  const meta = loadAIMetaCached();

  renderLastRunStrip(history, meta);

  const runsEl = el('hp-runs');
  if (runsEl) {
    const recent = [...history].reverse().slice(0, 6);
    runsEl.innerHTML = recent.length
      ? recent.map((run, idx) => rowHtml(run, idx)).join('')
      : `<div style="opacity:.22;font-size:.34rem;padding:4px 0">${lang() === 'de' ? 'Noch keine Runs gespeichert' : 'No runs saved yet'}</div>`;
  }
  renderProfileFrequency(history);

  const bestEl = el('hp-best-runs');
  if (bestEl) {
    const best = [...history].sort((a, b) => (b.tier || 0) - (a.tier || 0) || (a.duration || 99999) - (b.duration || 99999)).slice(0, 5);
    bestEl.innerHTML = best.length
      ? best.map((run, idx) => rowHtml(run, idx)).join('')
      : `<div style="opacity:.22;font-size:.34rem;padding:4px 0">${lang() === 'de' ? 'Noch keine Bestläufe' : 'No best runs yet'}</div>`;
  }

  const codexEl = el('hp-codex');
  if (codexEl) {
    const traits = meta.unlockedTraits || [];
    const next = nextUnlockHint(meta);
    const profileRuns = Object.entries((meta.profileHistory || []).reduce((acc, run) => {
      if (run.profile) acc[run.profile] = (acc[run.profile] || 0) + 1;
      return acc;
    }, {}));
    let html = '';
    if (!traits.length) {
      html = `<div style="opacity:.25;font-size:.34rem;letter-spacing:1px;padding:4px 0">${lang() === 'de' ? 'Noch keine Traits freigeschaltet' : 'No traits unlocked yet'}</div>`;
    } else {
      html += `<div style="font-size:.32rem;letter-spacing:2px;color:rgba(100,200,255,.3);text-transform:uppercase;margin-bottom:6px">★ ${traits.length} ${lang() === 'de' ? 'Traits freigeschaltet' : 'traits unlocked'}</div>`;
      html += traits.map(trait => `<div class="codex-trait"><span>${trait}</span><span class="ct-run">${lang() === 'de' ? 'aktiv' : 'active'}</span></div>`).join('');
    }
    if (profileRuns.length) {
      html += `<div style="font-size:.30rem;letter-spacing:2px;color:rgba(180,120,255,.3);text-transform:uppercase;margin:8px 0 4px">◈ ${lang() === 'de' ? 'Profile' : 'Profiles'}</div>`;
      html += profileRuns.sort((a, b) => b[1] - a[1]).map(([profile, count]) => `<div class="codex-trait" style="border-color:rgba(180,100,255,.15)"><span>${profileLabel(profile)}</span><span class="ct-run">${count}x</span></div>`).join('');
    }
    html += `<div style="font-size:.30rem;letter-spacing:2px;color:rgba(140,220,255,.32);text-transform:uppercase;margin:8px 0 4px">◌ ${lang() === 'de' ? 'Protokolle' : 'Protocols'}</div>`;
    html += protocolCodexHtml(meta);
    html += `<div style="font-size:.30rem;letter-spacing:2px;color:rgba(255,100,100,.32);text-transform:uppercase;margin:8px 0 4px">⚠ ${lang() === 'de' ? 'Boss-Codex' : 'Boss codex'}</div>`;
    html += bossCodexHtml(history, meta);
    html += `<div style="font-size:.30rem;letter-spacing:2px;color:rgba(255,180,80,.3);text-transform:uppercase;margin:8px 0 4px">🔓 ${lang() === 'de' ? 'Nächste Freischaltung' : 'Next unlock'}</div>`;
    html += `<div class="codex-trait" style="border-color:rgba(255,160,40,.18)"><span>${next}</span><span class="ct-run">${meta.totalRuns || 0} ${lang() === 'de' ? 'Runs' : 'runs'}</span></div>`;
    codexEl.innerHTML = html;
  }

  const traitsEl = el('hp-traits');
  if (traitsEl) {
    const traits = meta.unlockedTraits || [];
    traitsEl.style.display = tab === 'codex' ? 'none' : '';
    traitsEl.innerHTML = traits.length
      ? `<span style="opacity:.45;letter-spacing:2px">★ </span>${traits.map(trait => `<span class="hp-trait-item">${trait}</span>`).join(' ')}`
      : `<span style="opacity:.22">${lang() === 'de' ? 'Noch keine Traits' : 'No traits yet'}</span>`;
  }

  updateHistoryToggle();
}

function renderWinTimeline() {
  const rows = el('win-timeline-rows');
  const empty = el('win-timeline-empty');
  if (!rows || !empty) return;
  const items = Array.isArray(metaState.runTimeline) ? metaState.runTimeline : [];
  rows.innerHTML = items.map(item => (`<div style="display:flex;align-items:center;gap:8px;font-size:.34rem;letter-spacing:1.5px;color:${escapeHtml(item.color || 'rgba(255,255,255,.7)')};padding:2px 0"><span style="opacity:.85;min-width:14px">${escapeHtml(item.icon || '•')}</span><span style="flex:1">${escapeHtml(item.label || item.type || 'Event')}</span><span style="opacity:.35">${escapeHtml(item.tsLabel || '')}</span></div>`)).join('');
  empty.style.display = items.length ? 'none' : 'block';
}

function renderWinHistory(history, meta) {
  const rows = el('win-history-rows');
  const codex = el('win-history-codex');
  if (rows) {
    const recent = [...history].reverse().slice(0, 5);
    rows.innerHTML = recent.length ? recent.map((run, idx) => rowHtml(run, idx)).join('') : `<div style="opacity:.22">${lang() === 'de' ? 'Noch keine Historie' : 'No history yet'}</div>`;
  }
  if (codex) {
    const traits = meta.unlockedTraits || [];
    const parts = [`${lang() === 'de' ? 'Runs' : 'Runs'}: ${meta.totalRuns || 0}`, `${lang() === 'de' ? 'Traits' : 'Traits'}: ${traits.length}`];
    if (meta.dominantOverall) parts.push(`${lang() === 'de' ? 'Profil' : 'Profile'}: ${profileLabel(meta.dominantOverall)}`);
    codex.textContent = parts.join(' · ');
  }
}

function renderWinProgression(history, meta, summary) {
  const progBest = el('prog-best-runs');
  const traitList = el('prog-trait-list');
  const nextRunBox = el('prog-next-run');
  const nextObj = el('prog-next-objectives');
  const compare = el('win-run-compare');

  if (progBest) {
    const best = [...history].sort((a, b) => (b.tier || 0) - (a.tier || 0) || (a.duration || 99999) - (b.duration || 99999)).slice(0, 3);
    progBest.innerHTML = best.length ? best.map((run, idx) => `<div class="hp-row"><span class="hp-run-num">#${idx + 1}</span><span class="hp-tier t${Math.max(1, Math.min(3, run.tier || 1))}">${escapeHtml(tierLabel(run.tier))}</span><span class="hp-profile">${escapeHtml(profileLabel(run.profile))}</span><span class="hp-time">${escapeHtml(fmtDuration(run.duration))}</span></div>`).join('') : '';
  }

  if (traitList) {
    const traits = meta.unlockedTraits || [];
    traitList.innerHTML = traits.length ? traits.slice(-8).map(trait => `<span class="hp-trait-item">${escapeHtml(trait)}</span>`).join(' ') : `<span style="opacity:.22">${lang() === 'de' ? 'Noch keine Traits' : 'No traits yet'}</span>`;
  }

  if (compare) {
    const prevBest = [...history].slice(0, -1).sort((a, b) => (b.tier || 0) - (a.tier || 0) || (a.duration || 99999) - (b.duration || 99999))[0];
    const isNewBest = !prevBest || (summary.winTier > (prevBest.tier || 0)) || (summary.winTier === (prevBest.tier || 0) && summary.durationSec < (prevBest.duration || Infinity));
    compare.style.display = '';
    compare.classList.toggle('new-best', isNewBest);
    compare.textContent = isNewBest ? (lang() === 'de' ? '★ Neuer Bestlauf' : '★ New best run') : (lang() === 'de' ? `Bester Lauf bleibt ${tierLabel(prevBest?.tier || 1)}` : `Best run remains ${tierLabel(prevBest?.tier || 1)}`);
  }

  if (nextRunBox && nextObj) {
    const objectives = meta.metaObjectivesGenerated || [];
    nextRunBox.style.display = objectives.length ? '' : 'none';
    nextObj.textContent = objectives.map(obj => lang() === 'de' ? obj.de : obj.en).join(' · ');
  }
}

export function showWinScreen(summary, meta, newTraits = []) {
  const winScreen = el('win-screen');
  if (!winScreen) return;
  // Guard: don't show twice in the same run
  if (winScreen.classList.contains('show')) return;

  const bars = calculateBars(summary);
  const grade = overallGrade(summary, bars);
  const history = loadRunHistory();

  winScreen.classList.add('show');
  winScreen.classList.remove('boss-ghost', 'boss-sigma', 'boss-vortex', 'boss-parasite', 'boss-null');
  if (getBossWinClass()) winScreen.classList.add(getBossWinClass().replace(/^win-/, '').replace(/^boss-/, 'boss-'));

  setText('win-mode', `${profileLabel(summary.profile)} · ${protocolLabel(summary.protocolId)} · ${(synSettings.difficulty || 'normal').toUpperCase()}`);
  const tierEl = el('win-tier');
  if (tierEl) {
    tierEl.style.display = '';
    tierEl.textContent = tierLabel(summary.winTier);
  }
  el('win-perfect')?.classList.toggle('show', !!summary.perfect);

  setText('ws-time', summary.durationLabel);
  setText('ws-peak', `${fmtNum(summary.peakEnergy)}⬡`);
  setText('ws-tris', fmtNum(summary.triangles));
  setText('ws-bridges', fmtNum(summary.activeBridges));
  setText('ws-pulses', fmtNum(summary.pulses));
  setText('ws-clusters', `${fmtNum(summary.capturedClusters)} / ${fmtNum(summary.fusionPairs)}`);
  setText('ws-spine', `${fmtNum(summary.spineLength)} / ${summary.backboneActive ? 'ON' : 'OFF'}`);
  setText('ws-upgrades', fmtNum(summary.upgrades));
  setText('ws-events', fmtNum(summary.events));
  setText('ws-boss-acc', `${fmtNum(summary.bossAccuracy)}%`);
  setText('ws-boss-time', summary.bossDurationSec ? fmtDuration(summary.bossDurationSec) : '—');
  setText('ws-dominant-tag', profileLabel(summary.profile));
  setText('ws-synergies', summary.synergies.length ? summary.synergies.join(' · ') : '—');
  setText('ws-draft-picks', fmtNum(summary.draftPicks));
  setText('ws-train-scores', ['routing', 'timing', 'stability', 'memory'].map(key => `${key[0].toUpperCase()}:${fmtNum(summary.trainScores[key])}`).join(' · '));
  setText('ws-node-mix', `S:${summary.nodeMix.source || 0} · R:${summary.nodeMix.relay || 0} · A:${summary.nodeMix.amplifier || 0} · M:${summary.nodeMix.memory || 0}`);
  setText('ws-layer-times', `D ${fmtDuration(summary.layerTimes.dormant || 0)} · L1 ${fmtDuration(summary.layerTimes.l1 || 0)} · L2 ${fmtDuration(summary.layerTimes.l2 || 0)} · L3 ${fmtDuration(summary.layerTimes.l3 || 0)}`);
  setText('ws-awareness', summary.awarenessLabel);
  setText('ws-condition', getConditionLabel());
  setText('ws-elite-results', summary.eliteResults.length ? summary.eliteResults.map(item => `${item.name}:${item.result}`).join(' · ') : '—');
  setText('ws-protocol', protocolLabel(summary.protocolId));
  setText('ws-questline', summary.questline ? `${summary.questline.name || summary.questline.id} · ${summary.questline.completed ? '✓' : '…'}` : '—');

  setText('win-draft-summary', summary.upgrades ? `${lang() === 'de' ? 'Draft-Picks' : 'Draft picks'}: ${summary.upgrades}` : '');
  setText('win-meta-summary', `${lang() === 'de' ? 'Gesamtruns' : 'Total runs'}: ${meta.totalRuns || 0} · ${lang() === 'de' ? 'Traits' : 'Traits'}: ${(meta.unlockedTraits || []).length}`);
  setText('win-new-traits', newTraits.length ? `★ ${newTraits.join(' · ')}` : '');
  setText('win-meta-objectives', (meta.metaObjectivesGenerated || []).length ? ((lang() === 'de' ? '▶ Nächster Run: ' : '▶ Next run: ') + (meta.metaObjectivesGenerated || []).map(obj => lang() === 'de' ? obj.de : obj.en).join(' · ')) : '');
  const best = [...history].sort((a, b) => (b.tier || 0) - (a.tier || 0) || (a.duration || 99999) - (b.duration || 99999))[0];
  setText('win-best-run', best ? `${lang() === 'de' ? 'Bester Lauf' : 'Best run'} · ${tierLabel(best.tier)} · ${fmtDuration(best.duration)}` : '');
  setText('win-next-unlock', `${lang() === 'de' ? '🔓 Nächste Freischaltung: ' : '🔓 Next unlock: '}${nextUnlockHint(meta)}`);

  setText('rr-boss-acc', `${fmtNum(summary.bossAccuracy)}%`);
  setText('rr-boss-time', summary.bossDurationSec ? fmtDuration(summary.bossDurationSec) : '—');
  setText('rr-energy', `${fmtNum(summary.peakEnergy)} / ${fmtNum(summary.avgEnergy)}⬡`);
  setText('rr-event-up', fmtNum(summary.events));
  setText('rr-chain-count', fmtNum(summary.chains));
  setText('rr-profile', profileLabel(summary.profile));
  setText('rr-protocol', protocolLabel(summary.protocolId));
  setText('rr-tier-reason', `${tierLabel(summary.winTier)}${summary.perfect ? ' · PERFECT' : ''}`);
  setText('rr-condition', getConditionLabel());
  setText('rr-elite', summary.eliteResults.length ? summary.eliteResults.map(item => `${item.name}:${item.result}`).join(' · ') : '—');
  setText('rr-traits', (meta.unlockedTraits || []).length ? `★ ${(meta.unlockedTraits || []).slice(-4).join(' · ')}` : '');
  setText('rr-chains', summary.chains ? `${lang() === 'de' ? 'Ketten' : 'Chains'}: ${summary.chains}` : '');
  setText('rr-meta-summary', `${lang() === 'de' ? 'Dominantes Gesamtprofil' : 'Overall dominant'}: ${profileLabel(meta.dominantOverall)}`);
  setText('rr-run-type', summary.perfect ? (lang() === 'de' ? 'PERFEKTER STABILISIERUNGSLAUF' : 'PERFECT STABILIZATION RUN') : (lang() === 'de' ? 'STABILISIERUNGSLAUF' : 'STABILIZATION RUN'));

  const gradeEl = el('rr-overall-grade');
  if (gradeEl) {
    gradeEl.textContent = grade;
    gradeEl.className = `rr-grade ${grade}`;
  }

  const setBar = (fillId, valueId, value) => {
    const fill = el(fillId);
    const val = el(valueId);
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    if (val) val.textContent = fmtNum(value);
  };
  setBar('rrb-aggr', 'rrv-aggr', bars.aggression);
  setBar('rrb-prec', 'rrv-prec', bars.precision);
  setBar('rrb-stru', 'rrv-stru', bars.structure);
  setBar('rrb-effi', 'rrv-effi', bars.efficiency);

  renderWinProgression(history, meta, summary);
  renderWinTimeline();
  renderWinHistory(history, meta);

  const hardBtn = el('win-hardmode');
  const hardHint = el('win-hardmode-hint');
  const hardUnlocked = history.some(run => (run.tier || 0) >= 2) || summary.winTier >= 2;
  if (hardBtn) {
    if (hardUnlocked) {
      hardBtn.style.display = '';
      hardBtn.textContent = lang() === 'de' ? '★ Hard Mode starten' : '★ Start Hard Mode';
      hardBtn.onclick = () => {
        try {
          synSettings.difficulty = 'hard';
          saveSettings();
        } catch (_) {}
        safeRestart();
      };
    } else {
      hardBtn.style.display = 'none';
    }
  }
  if (hardHint) {
    hardHint.style.display = hardUnlocked ? 'none' : 'block';
    hardHint.textContent = lang() === 'de' ? 'HARD MODE FREISCHALTBAR MIT TIER-II-WIN' : 'HARD MODE UNLOCKS WITH A TIER-II WIN';
  }

  updateHistoryToggle();
}

export function populateTitleMetaBox() {
  const history = loadRunHistory();
  const box = el('title-meta-box');
  if (!box) return;
  if (!history.length) {
    box.style.display = 'none';
    return;
  }
  const last = history[history.length - 1];
  const best = [...history].sort((a, b) => (b.tier || 0) - (a.tier || 0) || (a.duration || 99999) - (b.duration || 99999))[0];
  const meta = loadAIMetaCached();
  setText('tm-last', `${lang() === 'de' ? 'Letzter Run: ' : 'Last run: '}${tierLabel(last.tier)}${last.profile ? ' · ' + profileLabel(last.profile) : ''}${last.duration ? ' · ' + fmtDuration(last.duration) : ''}`);
  setText('tm-best', `${lang() === 'de' ? 'Bester Run: ' : 'Best run: '}${tierLabel(best.tier)}`);
  setText('tm-profile', meta.dominantOverall ? `${lang() === 'de' ? 'Häufigstes Profil: ' : 'Most played: '}${profileLabel(meta.dominantOverall)}` : '');
  setText('tm-traits', (meta.unlockedTraits || []).length ? `${(meta.unlockedTraits || []).length} ${lang() === 'de' ? 'Traits freigeschaltet' : 'traits unlocked'}` : '');
  box.style.display = 'flex';
}

export function updateHistoryToggle() {
  const toggle = el('history-toggle');
  if (!toggle) return;
  const hasData = loadRunHistory().length > 0;
  const prominent = hasData && (!G.autoOn || G.runWon);
  if (_historyToggleHasData === hasData && _historyToggleProminent === prominent) return;
  _historyToggleHasData = hasData;
  _historyToggleProminent = prominent;
  toggle.classList.toggle('has-data', hasData);
  toggle.classList.toggle('ht-prominent', prominent);
}

export function resetMetaTelemetry() {
  resetMetaState();
}

export function restoreMetaTelemetry(save) {
  restoreMetaState(save);
}

export function tickMetaScreens(t, dt) {
  if (!metaState.telemetry) resetMetaState();
  if (!G.runWon && !G.paused) {
    metaState.telemetry.energySampleSum += G.energy || 0;
    metaState.telemetry.energySampleCount += 1;
    if (G.l3On) metaState.telemetry.layerTimes.l3 += dt;
    else if (G.l2On) metaState.telemetry.layerTimes.l2 += dt;
    else if (G.autoOn) metaState.telemetry.layerTimes.l1 += dt;
    else metaState.telemetry.layerTimes.dormant += dt;
  }
}

export function recordBossWindowOpen() {
  if (!metaState.telemetry) resetMetaState();
  metaState.telemetry.bossWindowsOpened += 1;
}

export function recordBossWindowHit() {
  if (!metaState.telemetry) resetMetaState();
  metaState.telemetry.bossWindowsHit += 1;
}

export function recordChainComplete(chainLength = 1) {
  if (!metaState.telemetry) resetMetaState();
  metaState.telemetry.totalChains += Math.max(1, Number(chainLength) || 1);
}

export function finalizeRunVictory() {
  if (!metaState.telemetry) resetMetaState();
  if (metaState.telemetry.finalized) return;
  metaState.telemetry.finalized = true;

  // RC-1 fix: bank Awakening Points on victory — was never called here,
  // only in finalizeRunFailed(). Victory AP (including research bonus) were silently lost.
  try { onRunEnd(); } catch(e) { console.warn('[Synapse] onRunEnd (victory) failed:', e); }

  const summary = buildRunSummary();
  const historyBefore = loadRunHistory();
  const entry = {
    ts: summary.ts,
    tier: summary.winTier,
    duration: summary.durationSec,
    profile: summary.profile,
    protocolId: summary.protocolId,
    bossId: summary.boss?.id || null,
    perfect: summary.perfect,
    metaTraits: { ...(summary.metaTraits || {}) },
    condition: summary.condition,
  };
  saveRunHistory([...historyBefore, entry]);

  const { meta, newTraits } = updateMetaWithRun(summary);
  populateTitleMetaBox();
  renderHistoryPanel('recent');
  showWinScreen(summary, meta, newTraits);

  try { localStorage.removeItem('synapse_run'); } catch (_) {}
  try { localStorage.removeItem(LS_SAVE); } catch (_) {}

  // Sprint 4: inject research summary row + genetic memory overlay
  try { injectResearchSummary(); } catch(e) { console.warn('[Synapse] injectResearchSummary failed:', e); }
  try { mountGeneticMemoryOverlay(); } catch(e) { console.warn('[Synapse] mountGeneticMemoryOverlay failed:', e); }
  try { updateAPBadge(); } catch(e) { console.warn('[Synapse] updateAPBadge failed:', e); }
}

// ── Failed Run ────────────────────────────────────────────────────────────────

function _epochLabel(idx) {
  const names = {
    0: 'Epoch I · Mechanical',
    1: 'Epoch II · Reactive',
    2: 'Epoch III · Temporal',
    3: 'Epoch IV · Sentience',
  };
  return names[idx] || `Epoch ${idx}`;
}

export function showFailScreen(stats = {}) {
  const screen = el('fail-screen');
  if (!screen || screen.classList.contains('show')) return;

  const setText = (id, v) => { const n = el(id); if (n) n.textContent = v ?? ''; };

  setText('fs-time',     stats.durationLabel || fmtDuration(stats.durationSec || 0));
  setText('fs-epoch',    _epochLabel(stats.epochReached || 0));
  setText('fs-energy',   `${fmtNum(stats.peakEnergy)}⬡`);
  setText('fs-nodes',    fmtNum(stats.nodesPlaced));
  setText('fs-research', fmtNum(stats.researchCompleted));
  setText('fs-tris',     fmtNum(stats.triangles));

  if (stats.apEarned > 0) {
    const apEl = el('fail-ap-earned');
    if (apEl) apEl.textContent = `◈ +${stats.apEarned} Awakening Points`;
  }

  const hintEl = el('fail-hint');
  if (hintEl) {
    const hints = [
      stats.epochReached < 1  ? 'Tipp: Energie schnell auf 300+ bringen — Epoch II schaltet Research frei.' : null,
      // RC-5 fix: Daemons unlock at Epoch III (first Memory node placed), not via Research.
      stats.researchCompleted < 1 ? 'Tipp: Ersten Research abschließen — jedes Projekt bringt AP und Netzwerk-Boni.' : null,
      stats.nodesPlaced < 4   ? 'Tipp: Früh mehr Memory-Nodes platzieren für stabilen Data-Flow.' : null,
    ].filter(Boolean);
    hintEl.textContent = hints[0] || '';
  }

  const btn = el('fail-restart');
  if (btn) btn.onclick = () => { try { safeRestart(); } catch(_) {} };

  screen.classList.add('show');
}

export function finalizeRunFailed() {
  if (!metaState.telemetry) resetMetaState();
  if (metaState.telemetry.finalized) return;
  metaState.telemetry.finalized = true;

  // Bank AP (partial credit for progress made)
  let apEarned = 0;
  try {
    // BUG-1 fix: use direct ES import instead of window._s4ComputeResearchAP bridge
    const researchBonus = computeResearchAP();
    apEarned = bankAwakeningPoints({
      epochReached:       G?.awakening?.epochIndex || 0,
      runDurationSecs:    ((Date.now() - (G?.runStart || Date.now())) / 1000),
      peakEnergy:         G?.peakEnergy || 0,
      megaProjectComplete: false,
      researchBonus,
    });
    if (apEarned > 0) {
      try { updateAPBadge(); } catch(_) {}
    }
  } catch(_) {}

  const durationSec = Math.max(1, Math.round((Date.now() - (G?.runStart || Date.now())) / 1000));
  const researchCompleted = G?.research?.completed instanceof Set
    ? G.research.completed.size
    : Array.isArray(G?.research?.completed) ? G.research.completed.length : 0;

  // Save partial run to history so run count / AP tracking stays consistent
  try {
    const historyBefore = loadRunHistory();
    saveRunHistory([...historyBefore, {
      ts:        Date.now(),
      tier:      0,
      duration:  durationSec,
      profile:   null,
      failed:    true,
    }]);
    populateTitleMetaBox();
  } catch(_) {}

  // Show the fail screen
  showFailScreen({
    durationSec,
    durationLabel:      fmtDuration(durationSec),
    epochReached:       G?.awakening?.epochIndex || 0,
    peakEnergy:         G?.peakEnergy || 0,
    nodesPlaced:        (G?.nodeCount || 0),
    researchCompleted,
    triangles:          G?.tris?.size || 0,
    apEarned,
  });

  try { localStorage.removeItem('synapse_run'); } catch(_) {}
}

export function initMetaScreens() {
  if (!metaState.telemetry) resetMetaState();
  populateTitleMetaBox();
  renderHistoryPanel('recent');
  updateHistoryToggle();
}



// v98: Root Server — mount on page load
document.addEventListener('DOMContentLoaded', () => {
  try { mountRootServerPanel(); } catch(e) { console.warn('[Synapse] mountRootServerPanel failed:', e); }
});
