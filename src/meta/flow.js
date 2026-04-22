import { G } from '../state/gameState.js';
import { TUNING } from '../state/tuning.js';
import { metaState } from '../state/metaState.js';
import { aiState, PROFILE_BONUS } from '../state/aiShared.js';
import { bossState, getActiveBossProfile } from '../state/bossShared.js';
import { gameLinks, gameNodes } from '../layers/network/index.js';
import { showToast, updateHUD } from '../ui/hud/index.js';
import { spawnShock } from '../layers/network/index.js';
import { logTL } from '../ui/actionFlow.js';
import { synSettings } from '../state/settings.js';
import { SFX } from '../audio/sfx.js';
import { upgradeState, traitState, synergyState, resetActionState, mergeActionStateSnapshot } from '../state/actionState.js';
import { questState } from '../state/runContext.js';
import { regTimer, clearTimer } from '../registries/timerRegistry.js';
import { el } from '../util/dom.js';

const COMBO_LEVELS = [1.0, 1.2, 1.5, 2.0];
const COMBO_LABELS = ['', 'x1.2 COMBO', 'x1.5 COMBO', 'x2.0 MAX COMBO'];
export const comboState = window._combo = window._combo || { mult: 1.0, lastPulse: 0, count: 0 };

export const G_DRAFT = window.G_DRAFT = window.G_DRAFT || {
  lastDraftTime: 0,
  nextDraftIn: 95 + Math.random() * 30,
  active: false,
  draftCount: 0,
  appliedUpgrades: [],
  firstDraftDone: false,
};


const UPGRADE_DEFS = [
  {
    id: 'predator_blitz', tag: 'predator', icon: '⚡',
    name: 'Blitz Doctrine', desc: 'Pulse-CD −0.9s und aggressiveres Tempo.',
    descEN: 'Pulse cooldown −0.9s and more aggressive tempo.',
    apply() { TUNING.pulseCd = Math.max(1800, TUNING.pulseCd - 900); G.pulseCd = TUNING.pulseCd; },
  },
  {
    id: 'predator_chain', tag: 'predator', icon: '⟳',
    name: 'Chain Capture', desc: 'Ermöglicht Ketten-Captures nach schnellen Treffern.',
    descEN: 'Enables chain captures after rapid hits.',
    apply() { upgradeState.chainCapture = true; upgradeState.chainCaptureCd = 900; },
  },
  {
    id: 'analyst_bridge', tag: 'analyst', icon: '↔',
    name: 'Bridge Immunity', desc: 'Stabile Backbone-Links werden immunisiert.',
    descEN: 'Stable backbone links become immune to disruption.',
    apply() { upgradeState.bridgeImmunity = true; },
  },
  {
    id: 'analyst_geometry', tag: 'analyst', icon: '△',
    name: 'Structural Audit', desc: 'Struktur- und Linear-Traits werden aktiv.',
    descEN: 'Structural and linear traits activate.',
    apply() { traitState.structural = true; traitState.linearThinking = true; },
  },
  {
    id: 'mnemonic_flood', tag: 'mnemonic', icon: '◉',
    name: 'Memory Flood', desc: 'Memory-Entladung effizienter und stärker.',
    descEN: 'Memory discharge becomes more efficient and powerful.',
    apply() { TUNING.memoryMultiplier += 0.28; },
  },
  {
    id: 'mnemonic_echo', tag: 'mnemonic', icon: '⬢',
    name: 'Pulse Echo', desc: 'Pulses geben zusätzliche Energie beim Feuern.',
    descEN: 'Pulses grant bonus energy on fire.',
    apply() { upgradeState.pulseEnergyBonus = (upgradeState.pulseEnergyBonus || 0) + 2; },
  },
  {
    id: 'architect_backbone', tag: 'architect', icon: '◈',
    name: 'Backbone Master', desc: 'Backbone-Boni und Projektkopplung steigen.',
    descEN: 'Backbone bonuses and project coupling increase.',
    apply() { traitState.backboneMaster = true; },
  },
  {
    id: 'architect_spine', tag: 'architect', icon: '⬟',
    name: 'Silent Spine', desc: 'Spine-Erträge steigen bei sauberer Führung.',
    descEN: 'Spine yields increase with clean routing.',
    apply() { traitState.silentSpine = true; },
  },
  {
    id: 'architect_fusion', tag: 'architect', icon: '✶',
    name: 'Fusion Primer', desc: 'Erste Fusion liefert mehr Fortschritt.',
    descEN: 'First fusion delivers more progress.',
    apply() { traitState.fusionXP = true; },
  },
  {
    id: 'wild_precision', tag: 'wild', icon: '◎',
    name: 'Precision Synapse', desc: 'Verfehlte Pulses kosten keine Energie.',
    descEN: 'Missed pulses cost no energy.',
    apply() { upgradeState.noMissedPulseCost = true; },
  },
  {
    id: 'wild_elite', tag: 'wild', icon: '★',
    name: 'Elite Veteran', desc: 'Elite-Captures geben zusätzliche Belohnungen.',
    descEN: 'Elite captures grant additional rewards.',
    apply() { traitState.eliteVeteran = true; },
  },
  {
    id: 'wild_fragile', tag: 'wild', icon: '~',
    name: 'Fragile Harvest', desc: 'Fragile Cluster geben zusätzlichen Burst.',
    descEN: 'Fragile clusters deliver an extra burst.',
    apply() { upgradeState.fragileClusterBonus = Math.max(upgradeState.fragileClusterBonus || 0, 1); traitState.fractureLogic = true; },
  },
  // FIX 1.3: resonanceDebt is fully coded in gameplayActions.js but had no unlock path.
  // Adding it as a Wildcard upgrade so players can actually access this mechanic.
  {
    id: 'wild_resonance_debt', tag: 'wild', icon: '⬡',
    name: 'Resonance Debt', desc: 'Alle 3 Pulses: ×1.8 Energie-Burst + Memory −30. Hohes Risiko, hoher Reward.',
    descEN: 'Every 3rd pulse: ×1.8 energy burst + Memory −30. High risk, high reward.',
    apply() { traitState.resonanceDebt = true; },
  },

  // ── FIX 3.1: New upgrades — pool expanded from 12 → 19 ──────────────────
  {
    id: 'mnemonic_cascade', tag: 'mnemonic', icon: '◌',
    name: 'Resonance Cascade', desc: 'Triangles entladen Memory-Nodes partiell bei Aktivierung.',
    descEN: 'Triangles partially discharge Memory nodes on activation.',
    apply() { upgradeState.resonanceCascade = true; },
  },
  {
    id: 'predator_overcharge', tag: 'predator', icon: '⚡⚡',
    name: 'Overcharge', desc: 'Pulse kann doppelt gefeuert werden — kostet ×2 Energie, gibt sofort 2 Captures.',
    descEN: 'Pulse can double-fire — costs ×2 energy, grants 2 immediate captures.',
    apply() { upgradeState.overcharge = true; },
  },
  {
    id: 'analyst_deep_geometry', tag: 'analyst', icon: '◇',
    name: 'Deep Geometry', desc: 'Jeder stabile Link gibt passiv +0.5⬡/s.',
    descEN: 'Each stable link grants +0.5⬡/s passively.',
    apply() { upgradeState.deepGeometry = true; },
  },
  {
    id: 'architect_quantum_spine', tag: 'architect', icon: '⬡↑',
    name: 'Quantum Spine', desc: 'Spine-Nodes geben +20⬡ Bonus auf nächste Fusion.',
    descEN: 'Spine-nodes grant +20⬡ bonus on next fusion.',
    apply() { upgradeState.quantumSpine = true; },
  },
  {
    id: 'mnemonic_echo_chamber', tag: 'mnemonic', icon: '⬢⬢',
    name: 'Echo Chamber', desc: 'Jeder Pulse wiederholt den letzten Memory-Discharge zu 40%.',
    descEN: 'Each pulse repeats the last memory discharge at 40%.',
    apply() { upgradeState.echoChamber = true; },
  },
  {
    id: 'wild_cold_loop', tag: 'wild', icon: '❄',
    name: 'Cold Loop', desc: 'Jeder Cluster-Capture gibt sofort +30⬡ Kältebonus.',
    descEN: 'Each cluster capture gives an immediate +30⬡ cold bonus.',
    apply() { traitState.coldLoop = true; },
  },
  {
    id: 'wild_hunt_instinct', tag: 'wild', icon: '◉',
    name: 'Hunt Instinct', desc: 'Pulsgeschwindigkeit steigt nach jedem Capture für 5 Sekunden.',
    descEN: 'Pulse speed increases for 5 seconds after each capture.',
    apply() { traitState.huntInstinct = true; },
  },

  // ── v95: BUILD-DEFINING upgrades — mindestens 1 pro Draft sichtbar ──────
  {
    id: 'v95_fragile_phoenix', tag: 'wild', icon: '🔥', tier: 'build',
    name: 'Fragile Phoenix', desc: 'Fragile-Bruch spawnt sofort 2 neue stabile Links zu benachbarten Nodes. Hohes Risiko, strukturelle Regeneration.',
    descEN: 'Fragile break instantly spawns 2 stable links to adjacent nodes.',
    apply() { upgradeState.fragilePhoenix = true; },
  },
  {
    id: 'v95_relay_overdrive', tag: 'predator', icon: '⚡↑', tier: 'build',
    name: 'Relay Overdrive', desc: 'Relays verarbeiten bis zu 8 Signale gleichzeitig (statt 4) — aber ×1.5 Bruchrisiko für Fragile-Links in Reichweite.',
    descEN: 'Relays handle up to 8 signals simultaneously, but +1.5× fragile break risk in range.',
    apply() { upgradeState.relayOverdrive = true; },
  },
  {
    id: 'v95_memory_network', tag: 'mnemonic', icon: '◉◉', tier: 'build',
    name: 'Memory Network', desc: 'Memory-Nodes teilen Ladung automatisch — vollgeladene Nodes entladen in benachbarte Memories statt zu verschwenden.',
    descEN: 'Memory nodes share charge automatically — overcharged nodes offload to neighbors.',
    apply() { upgradeState.memoryNetwork = true; },
  },
  {
    id: 'v95_entropy_drain', tag: 'analyst', icon: '▽', tier: 'build',
    name: 'Entropy Drain', desc: 'Jeder Fragile-Bruch gibt allen stabilen Links temporären +0.4 Opacity-Boost und +15⬡. Das Chaos stärkt das Fundament.',
    descEN: 'Each fragile break gives all stable links a +0.4 opacity boost and +15⬡.',
    apply() { upgradeState.entropyDrain = true; },
  },
  {
    id: 'v95_phantom_web', tag: 'architect', icon: '~◈', tier: 'build',
    name: 'Phantom Web', desc: 'Silent Spine + Fragile Cluster: gebrochene Fragile Links werden zu Geist-Links (50% Leistung, können nicht weiter brechen).',
    descEN: 'Broken fragile links become ghost links with 50% performance that cannot break again.',
    apply() { upgradeState.phantomWeb = true; synergyState.phantomWebActive = true; },
  },
];

const QUESTLINE_DEFS = {
  analyst: {
    id: 'pattern_audit',
    name: 'Pattern Audit',
    reward: 'Bridge-Stabilität permanent erhöht',
    rewardEN: 'Bridge stability permanently increased',
    steps: [
      { id: 'chainsNoLoss', threshold: 2, label: '2 Ketten ohne Ressourcenverlust', labelEN: '2 chains without loss' },
      { id: 'eliteClearNoFailure', equals: true, label: 'Elite sauber abschließen', labelEN: 'Clear one elite cleanly' },
      { id: 'bossAccuracy', threshold: 0.6, label: 'Boss mit hoher Präzision schlagen', labelEN: 'Defeat boss with high accuracy' },
    ],
    rewardApply() { PROFILE_BONUS.analyst.bridgeStabBonus = Math.max(PROFILE_BONUS.analyst.bridgeStabBonus || 0, 0.14); },
  },
  predator: {
    id: 'burst_doctrine',
    name: 'Burst Doctrine',
    reward: 'Pulse-Ketten und Capture-Druck verstärkt',
    rewardEN: 'Pulse chains and capture pressure improved',
    steps: [
      { id: 'fastSyncs', threshold: 2, label: '2 schnelle Sync-Treffer', labelEN: '2 fast sync hits' },
      { id: 'eliteClears', threshold: 1, label: '1 Elite-Cluster säubern', labelEN: 'Clear 1 elite cluster' },
      { id: 'bossWindowsOpened', threshold: 3, label: '3 Boss-Fenster öffnen', labelEN: 'Open 3 boss windows' },
    ],
    rewardApply() { PROFILE_BONUS.predator.pulseCdReduction = Math.max(PROFILE_BONUS.predator.pulseCdReduction || 0, 0.18); },
  },
  architect: {
    id: 'structural_proof',
    name: 'Structural Proof',
    reward: 'Spine- und Backbone-Synergien steigen',
    rewardEN: 'Spine and backbone synergies improve',
    steps: [
      { id: 'stableRatio2', threshold: 2, label: '2 stabile Strukturphasen halten', labelEN: 'Hold 2 stable structure phases' },
      { id: 'dormantFortressClear', equals: true, label: 'Dormant Fortress sauber räumen', labelEN: 'Clear Dormant Fortress cleanly' },
      { id: 'parasiteCleanKill', equals: true, label: 'Parasite Choir fast sauber töten', labelEN: 'Defeat Parasite Choir cleanly' },
    ],
    rewardApply() { PROFILE_BONUS.architect.backboneBonus = Math.max(PROFILE_BONUS.architect.backboneBonus || 0, 10); },
  },
  mnemonic: {
    id: 'recall_thread',
    name: 'Recall Thread',
    reward: 'Memory-Output und Resonanz werden dichter',
    rewardEN: 'Memory output and resonance become denser',
    steps: [
      { id: 'rareChainWithMemory', equals: true, label: 'Rare Chain unter Memory-Druck überstehen', labelEN: 'Survive rare chain with memory pressure' },
      { id: 'chain3StepComplete', threshold: 1, label: 'Eine 3er-Kette abschließen', labelEN: 'Complete one 3-step chain' },
      { id: 'totalChains', threshold: 4, label: '4 Ketten insgesamt abschließen', labelEN: 'Complete 4 chains total' },
    ],
    rewardApply() { PROFILE_BONUS.mnemonic.memEfficiency = Math.max(PROFILE_BONUS.mnemonic.memEfficiency || 0, 0.18); },
  },
};

const AGENT_MSGS = {
  sync: ['SYNC-Fenster offen.', 'Jetzt pingen.', 'Timingfenster stabil.'],
  pulse: ['Pulse registriert.', 'Signalwelle bestätigt.', 'Rhythmus gehalten.'],
  win: ['Netz stabilisiert.', 'Lauf abgeschlossen.', 'Abschluss bestätigt.'],
  bridge: ['Brücke aktiv.', 'Konvergenz steigt.', 'Topologie verdichtet sich.'],
  memory: ['Memory entladen.', 'Archiv freigegeben.', 'Langzeitspur aktiv.'],
  backbone: ['Backbone online.', 'Makro-Spine reagiert.', 'Netzachse verriegelt.'],
  spine: ['Spine wächst.', 'Achse verlängert.', 'Makrofeld verdichtet.'],
  fusion: ['Fusion bestätigt.', 'Cluster verschmelzen.', 'Überlagerung stabil.'],
  stage: ['Awareness steigt.', 'Die KI lernt sichtbar.', 'Ein neuer Zustand formt sich.'],
  draft: ['Upgrade-Fenster in Kürze.', 'Ein Draft nähert sich.', 'Entwurfslot wird vorbereitet.'],
  // v96 additions
  rogue: ['Feindlicher Einfluss erkannt.', 'Rogue-Node aktiv.', 'Netzwerk unter Beschuss.'],
  phantom: ['Geistimpuls registriert.', 'Phantomsignal im Netz.', 'Anomalie detektiert.'],
  counter: ['Taktik analysiert.', 'Muster gespeichert.', 'Gegenmaßnahme aktiv.'],
};

const AGENT_MSGS_EN = {
  sync: ['SYNC window open.', 'Ping now.', 'Timing window stable.'],
  pulse: ['Pulse registered.', 'Signal wave confirmed.', 'Rhythm maintained.'],
  win: ['Network stabilised.', 'Run complete.', 'Completion confirmed.'],
  bridge: ['Bridge active.', 'Convergence rising.', 'Topology densifying.'],
  memory: ['Memory discharged.', 'Archive released.', 'Long-term trace active.'],
  backbone: ['Backbone online.', 'Macro-spine responding.', 'Network axis locked.'],
  spine: ['Spine growing.', 'Axis extending.', 'Macrofield condensing.'],
  fusion: ['Fusion confirmed.', 'Clusters merging.', 'Superposition stable.'],
  stage: ['Awareness rising.', 'The AI is visibly learning.', 'A new state is forming.'],
  draft: ['Upgrade window approaching.', 'A draft is near.', 'Draft slot being prepared.'],
  // v96 additions
  rogue: ['Hostile influence detected.', 'Rogue node active.', 'Network under attack.'],
  phantom: ['Ghost impulse registered.', 'Phantom signal in network.', 'Anomaly detected.'],
  counter: ['Tactic analysed.', 'Pattern memorised.', 'Counter-measure active.'],
};

let agentCooldown = 0;
let qlStableTickAt = 0;

function currentLang() {
  return synSettings.lang || 'de';
}

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function draftCap() {
  // FIX 3.3: Updated draft caps — Easy 5, Normal 4, Hard 3 (was 4/3/2)
  const diff = synSettings.difficulty || 'normal';
  return diff === 'easy' ? 5 : diff === 'hard' ? 3 : 4;
}

function updateComboHUD() {
  const node = el('combo-hud');
  if (!node) return;
  if (comboState.count > 0) {
    node.textContent = '⚡ ×' + comboState.mult.toFixed(1) + ' COMBO';
    node.style.opacity = '1';
    node.style.transform = 'translateX(-50%) scale(1)';
  } else {
    node.style.opacity = '0';
    node.style.transform = 'translateX(-50%) scale(.9)';
  }
}

export function updateCombo() {
  const now = Date.now();
  const gap = now - (comboState.lastPulse || 0);
  comboState.lastPulse = now;
  comboState.count = gap <= 2000 ? Math.min(3, comboState.count + 1) : 0;
  const nextMult = COMBO_LEVELS[comboState.count];
  if (nextMult > comboState.mult && COMBO_LABELS[comboState.count]) {
    const _langCo = currentLang();
    showToast(
      '⚡ ' + COMBO_LABELS[comboState.count],
      _langCo === 'de' ? 'Nächster Pulse ×' + nextMult : 'Next pulse ×' + nextMult,
      1400
    );
  }
  comboState.mult = nextMult;
  // v95: at ×2.0 combo trigger visual explosion
  if (nextMult >= 2.0) {
    window.spawnShock?.(0xffcc00, 2);
    window.spawnShock?.(0xff8800, 2);
  }
  updateComboHUD();
}

export function resetCombo() {
  comboState.count = 0;
  comboState.mult = 1.0;
  updateComboHUD();
}

export function tickComboDecay() {
  if (comboState.count > 0 && (Date.now() - comboState.lastPulse) > 2000) {
    resetCombo();
  }
}

export function showAgentMsg(text, urgent = false, profile = null, ttl = 3200) {
  const node = el('agent-line');
  if (!node) return;
  clearTimer('agentMsgFade');
  clearTimer('agentMsgTicker');
  clearTimer('agentMsgClear');
  node.textContent = text || '';
  node.className = '';
  node.classList.add('ticker-in');
  if (urgent) node.classList.add('urgent');
  const p = profile || aiState?.dominantProfile;
  if (p) node.classList.add('profile-' + p);
  regTimer('agentMsgFade', setTimeout(() => {
    node.classList.add('fade-out');
    clearTimer('agentMsgFade');
  }, Math.max(1200, ttl - 420)), 'timeout');
  regTimer('agentMsgTicker', setTimeout(() => {
    node.classList.remove('ticker-in');
    clearTimer('agentMsgTicker');
  }, 420), 'timeout');
  regTimer('agentMsgClear', setTimeout(() => {
    if (node.classList.contains('fade-out')) {
      node.textContent = '';
      node.className = '';
    }
    clearTimer('agentMsgClear');
  }, ttl), 'timeout');
}

export function emitAgentMessage(kind, urgent = false) {
  const now = Date.now();
  if (!urgent && now < agentCooldown) return;
  agentCooldown = now + (urgent ? 350 : 1400);
  const profile = aiState?.dominantProfile || null;
  const msgBank = currentLang() === 'en' ? AGENT_MSGS_EN : AGENT_MSGS;
  const pool = msgBank[kind] || msgBank.pulse;
  showAgentMsg(rand(pool), urgent, profile, urgent ? 3600 : 2600);
}

export function maybeShowDraftAdvisory() {
  if (questState.advisoryDraftShown || G_DRAFT.active) return;
  questState.advisoryDraftShown = true;
  emitAgentMessage('draft', true);
  const _langDa = currentLang();
  showToast(
    _langDa === 'de' ? '◈ DRAFT NÄHERT SICH' : '◈ DRAFT INCOMING',
    _langDa === 'de' ? 'Upgrade-Fenster öffnet bald' : 'Upgrade window opening soon',
    2400
  );
}

function filteredUpgradePool() {
  const picked = new Set(G_DRAFT.appliedUpgrades || []);
  const pool = UPGRADE_DEFS.filter(up => !picked.has(up.id));
  // v95: ensure at least 1 build-defining upgrade appears per draft window if available
  const buildDefining = pool.filter(up => up.tier === 'build');
  const regular = pool.filter(up => up.tier !== 'build');
  // Shuffle and interleave: put 1 build-defining at front if available
  if (buildDefining.length > 0) {
    const pick = buildDefining[Math.floor(Math.random() * buildDefining.length)];
    return [pick, ...regular.filter(u => u !== pick)];
  }
  return pool;
}

function renderDraftOverlay(reason = '') {
  const overlay = el('draft-overlay');
  const cards = el('draft-cards');
  const sub = el('draft-sub');
  if (!overlay || !cards || !sub) return;

  sub.textContent = reason || 'Wähle eine Verbesserung für diesen Run';
  const shuffled = [...filteredUpgradePool()].sort(() => Math.random() - 0.5);
  const picks = [];
  const tagCount = {};
  for (const up of shuffled) {
    if (picks.length >= 3) break;
    const tag = up.tag || 'wild';
    const max = tag === 'wild' ? 1 : 2;
    if ((tagCount[tag] || 0) >= max) continue;
    picks.push(up);
    tagCount[tag] = (tagCount[tag] || 0) + 1;
  }
  if (picks.length < 3) {
    shuffled.forEach(up => {
      if (picks.length >= 3 || picks.includes(up)) return;
      picks.push(up);
    });
  }

  const tagLabel = { predator: 'PREDATOR', analyst: 'ANALYST', mnemonic: 'MNEMONIC', architect: 'ARCHITEKT', wild: 'WILDCARD' };
  cards.innerHTML = '';
  picks.forEach(up => {
    const card = document.createElement('div');
    card.className = 'draft-card' + (up.tag ? ' dc-tag-' + up.tag : '');
    const synergyHint = getSynergyHint(up.id);
    card.innerHTML = `
      <div class="dc-icon">${up.icon}</div>
      <div class="dc-tag">${tagLabel[up.tag] || String(up.tag || '').toUpperCase()}</div>
      <div class="dc-name">${up.name}</div>
      <div class="dc-desc">${up.desc}</div>
      ${synergyHint ? `<div style="margin-top:6px;font-size:.3rem;letter-spacing:2px;color:rgba(255,220,80,.88);text-transform:uppercase;text-shadow:0 0 10px rgba(255,200,40,.5)">${synergyHint}</div>` : ''}
    `;
    card.onclick = () => pickDraft(up.id);
    cards.appendChild(card);
  });
  overlay.classList.add('show');
}

function getSynergyHint(id) {
  const picked = new Set(G_DRAFT.appliedUpgrades || []);
  if (id === 'predator_blitz' && picked.has('mnemonic_flood')) return '◉⚡ SYNERGIE · Drain Pulse';
  if (id === 'mnemonic_flood' && picked.has('predator_blitz')) return '◉⚡ SYNERGIE · Drain Pulse';
  if (id === 'analyst_geometry' && picked.has('analyst_bridge')) return '↔ SYNERGIE · Vollstruktur';
  if (id === 'analyst_bridge' && picked.has('analyst_geometry')) return '↔ SYNERGIE · Vollstruktur';
  if (id === 'architect_backbone' && picked.has('architect_spine')) return '⬟ SYNERGIE · Silent Backbone';
  if (id === 'architect_spine' && picked.has('architect_backbone')) return '⬟ SYNERGIE · Silent Backbone';
  // FIX 3.2: New synergies
  if (id === 'mnemonic_flood' && picked.has('mnemonic_echo')) return '⬢◉ SYNERGIE · Resonance Storm';
  if (id === 'mnemonic_echo' && picked.has('mnemonic_flood')) return '⬢◉ SYNERGIE · Resonance Storm';
  if (id === 'architect_backbone' && picked.has('predator_chain')) return '◈⟳ SYNERGIE · Grid Lock';
  if (id === 'predator_chain' && picked.has('architect_backbone')) return '◈⟳ SYNERGIE · Grid Lock';
  return '';
}

function applyUpgradeById(id) {
  const up = UPGRADE_DEFS.find(entry => entry.id === id);
  if (!up) return false;
  up.apply?.();
  return true;
}

function applyUpgradeSynergies() {
  const picked = new Set(G_DRAFT.appliedUpgrades || []);
  if (picked.has('predator_blitz') && picked.has('mnemonic_flood')) {
    synergyState.drainpulse = true;
  }
  if (picked.has('analyst_geometry') && picked.has('analyst_bridge')) {
    traitState.conservative = true;
  }
  if (picked.has('architect_backbone') && picked.has('architect_spine')) {
    traitState.backboneMaster = true;
    traitState.silentSpine = true;
  }
  // FIX 3.2: Resonance Storm — Memory Flood + Pulse Echo: each pulse charges Memory +15
  if (picked.has('mnemonic_flood') && picked.has('mnemonic_echo')) {
    synergyState.resonanceStorm = true;
  }
  // FIX 3.2: Grid Lock — Backbone Master + Chain Capture: lock cluster windows +2s
  if (picked.has('architect_backbone') && picked.has('predator_chain')) {
    synergyState.gridLock = true;
  }
}

export function closeDraft(forceUnpause = true) {
  G_DRAFT.active = false;
  el('draft-overlay')?.classList.remove('show');
  if (forceUnpause && !bossState.bossActive) G.paused = false;
}

export function pickDraft(id) {
  const up = UPGRADE_DEFS.find(entry => entry.id === id);
  if (!up) return false;
  if (!G_DRAFT.appliedUpgrades.includes(id)) G_DRAFT.appliedUpgrades.push(id);
  G_DRAFT.draftCount += 1;
  applyUpgradeById(id);
  applyUpgradeSynergies();
  closeDraft(true);
  spawnShock(0xcc66ff);
  const _langUp = currentLang();
  showToast(
    'UPGRADE AKTIV · ' + up.name,
    _langUp === 'de' ? up.desc : (up.descEN || up.desc),
    3200
  );
  updateHUD();
  return true;
}

export function skipDraft() {
  closeDraft(true);
  const _langSk = currentLang();
  showToast(
    _langSk === 'de' ? 'ÜBERSPRUNGEN' : 'SKIPPED',
    _langSk === 'de' ? 'Kein Upgrade gewählt' : 'No upgrade selected',
    1400
  );
}

export function triggerDraft(reason = '') {
  if (G_DRAFT.active || G.runWon) return false;
  if (G_DRAFT.draftCount >= draftCap()) return false;
  if (filteredUpgradePool().length === 0) return false;
  G_DRAFT.active = true;
  G_DRAFT.firstDraftDone = true;
  G_DRAFT.lastDraftTime = (Date.now() - G.runStart) / 1000;
  G_DRAFT.nextDraftIn = 90 + Math.random() * 35;
  G.paused = true;
  questState.advisoryDraftShown = false;
  SFX?.draft?.();
  renderDraftOverlay(reason);
  logTL('draft', 'Upgrade Draft', 'rgba(200,100,255,.72)', '◈');
  emitAgentMessage('draft', true);
  return true;
}

export function shouldTriggerDraft() {
  // FIX 3.3: First draft is now milestone-triggered (C1/C4/C7 captures in layer3.js).
  // The time-fallback (75s) is kept as a safety net in case player reaches L3 slowly.
  if (!G.autoOn || G.runWon || G_DRAFT.active) return false;
  const elapsed = (Date.now() - G.runStart) / 1000;
  if (!G_DRAFT.firstDraftDone && G.l3On) {
    if (!questState.advisoryDraftShown && elapsed >= 65) maybeShowDraftAdvisory();
    return elapsed >= 120; // extended fallback — milestone triggers come first
  }
  const sinceLast = elapsed - (G_DRAFT.lastDraftTime || 0);
  if (!questState.advisoryDraftShown && sinceLast >= Math.max(15, G_DRAFT.nextDraftIn - 10)) maybeShowDraftAdvisory();
  return sinceLast > G_DRAFT.nextDraftIn;
}

/** Trigger a draft on cluster milestone (called from layer3.js or gameplayActions.js). */
export function triggerMilestoneDraft(reason) {
  if (!G.autoOn || G.runWon || G_DRAFT.active) return false;
  if (G_DRAFT.draftCount >= draftCap()) return false;
  if (filteredUpgradePool().length === 0) return false;
  const elapsed = (Date.now() - G.runStart) / 1000;
  if ((elapsed - (G_DRAFT.lastDraftTime || 0)) < 30) return false;
  return triggerDraft(reason || 'Meilenstein erreicht');
}

function renderQuestlinePanel() {
  const ql = questState.activeQuestline;
  const panel = el('ql-panel');
  const name = el('ql-name');
  const steps = el('ql-steps');
  const reward = el('ql-reward');
  if (!panel || !name || !steps || !reward) return;
  if (!ql) {
    panel.classList.remove('vis');
    return;
  }
  panel.classList.add('vis');
  name.textContent = 'QUESTLINE · ' + ql.name.toUpperCase();
  steps.innerHTML = ql.steps.map(step => `<div class="ql-step${step.done ? ' done' : ''}">${currentLang() === 'de' ? step.label : step.labelEN}</div>`).join('');
  reward.textContent = (currentLang() === 'de' ? 'Belohnung · ' + ql.reward : 'Reward · ' + ql.rewardEN);
  reward.classList.toggle('vis', !!ql.completed);
}

export function initQuestlineForProfile(profile) {
  if (!profile || questState.activeQuestline) return null;
  const def = QUESTLINE_DEFS[profile];
  if (!def) return null;
  questState.activeQuestline = {
    id: def.id,
    profile,
    name: def.name,
    reward: def.reward,
    rewardEN: def.rewardEN,
    steps: def.steps.map(step => ({ ...step, done: false })),
    completed: false,
  };
  questState.progress = questState.progress || {};
  renderQuestlinePanel();
  showToast('QUESTLINE: ' + def.name.toUpperCase(), currentLang() === 'de' ? 'Profil-Arc aktiv · 3 Ziele' : 'Profile arc active · 3 objectives', 3600);
  return questState.activeQuestline;
}

function bossAccuracy() {
  const opened = metaState.telemetry?.bossWindowsOpened || 0;
  const hit = metaState.telemetry?.bossWindowsHit || 0;
  return opened > 0 ? hit / opened : 0;
}

export function getActiveQuestline() {
  return questState.activeQuestline || null;
}

export function getQuestProgress() {
  return questState.progress || {};
}

export function checkQuestlineProgress() {
  const ql = questState.activeQuestline;
  if (!ql || ql.completed) {
    renderQuestlinePanel();
    return;
  }
  const qp = questState.progress || {};
  const lang = currentLang();
  let changed = false;
  ql.steps.forEach(step => {
    if (step.done) return;
    let complete = false;
    switch (step.id) {
      case 'chainsNoLoss': complete = (qp.chainsNoLoss || 0) >= step.threshold; break;
      case 'eliteClearNoFailure': complete = qp.eliteClearNoFailure === true; break;
      case 'bossAccuracy': complete = bossAccuracy() >= step.threshold && bossState.bossActive === false; break;
      case 'fastSyncs': complete = (qp.fastSyncs || 0) >= step.threshold; break;
      case 'eliteClears': complete = (qp.eliteClears || 0) >= step.threshold; break;
      case 'bossWindowsOpened': complete = (metaState.telemetry?.bossWindowsOpened || 0) >= step.threshold; break;
      case 'stableRatio2': complete = (qp._archStableCount || 0) >= step.threshold; break;
      case 'dormantFortressClear': complete = qp.dormantFortressClear === true; break;
      case 'parasiteCleanKill': complete = qp.parasiteCleanKill === true; break;
      case 'rareChainWithMemory': complete = qp.rareChainWithMemory === true; break;
      case 'chain3StepComplete': complete = (qp.chain3StepComplete || 0) >= step.threshold; break;
      case 'totalChains': complete = (metaState.telemetry?.totalChains || 0) >= step.threshold; break;
      default:
        if (typeof step.threshold === 'number') complete = (qp[step.id] || 0) >= step.threshold;
        else if ('equals' in step) complete = qp[step.id] === step.equals;
    }
    if (!complete) return;
    step.done = true;
    changed = true;
    showToast('QUESTLINE ✓ ' + ql.name, lang === 'de' ? step.label : step.labelEN, 2800);
    spawnShock(profileColor(ql.profile));
  });

  if (!ql.completed && ql.steps.every(step => step.done)) {
    ql.completed = true;
    QUESTLINE_DEFS[ql.profile]?.rewardApply?.();
    showToast('★ QUESTLINE ABGESCHLOSSEN!', lang === 'de' ? ql.reward : ql.rewardEN, 4600);
    spawnShock(0xffd700);
    spawnShock(0xffffff);
    const panel = el('ql-panel');
    panel?.classList.add('ql-complete');
    regTimer('questlineCompleteFlash', setTimeout(() => {
      panel?.classList.remove('ql-complete');
      clearTimer('questlineCompleteFlash');
    }, 900), 'timeout');
    aiState.questlinesCompleted = (aiState.questlinesCompleted || 0) + 1;
    logTL('quest', 'Questline abgeschlossen', 'rgba(255,215,90,.8)', '★');
    changed = true;
  }

  if (changed) renderQuestlinePanel();
  else renderQuestlinePanel();
}

function profileColor(profile) {
  return profile === 'predator' ? 0xff6644 : profile === 'analyst' ? 0x44aaff : profile === 'architect' ? 0x44ffbb : 0xcc66ff;
}

export function onChainComplete(chainLength = 1) {
  window._recordChainComplete?.(chainLength);
  const qp = questState.progress || {};
  if (chainLength >= 3) qp.chain3StepComplete = (qp.chain3StepComplete || 0) + 1;
  if (G.energy >= 0) qp.chainsNoLoss = (qp.chainsNoLoss || 0) + 1;
  const hasMemPressure = gameNodes.some(node => node.type === 'memory' && (node.memCharge || 0) > 20);
  if (hasMemPressure) qp.rareChainWithMemory = true;
  questState.progress = qp;
  checkQuestlineProgress();
}

export function onSyncCapture() {
  const qp = questState.progress || {};
  const now = Date.now();
  if (qp._lastSyncTime && now - qp._lastSyncTime < 15000) qp.fastSyncs = (qp.fastSyncs || 0) + 1;
  else qp.fastSyncs = 1;
  qp._lastSyncTime = now;
  questState.progress = qp;
  checkQuestlineProgress();
}

export function onBossDefeated() {
  // v98: Grid expansion trigger on first boss kill
  const _bossKillCount = (window._bossKillCount || 0) + 1;
  window._bossKillCount = _bossKillCount;
  if (_bossKillCount === 1 && typeof window._triggerGridExpansion === 'function') {
    setTimeout(() => window._triggerGridExpansion(), 800);
  }

  const qp = questState.progress || {};
  if (getActiveBossProfile()?.id === 'parasite_choir') {
    const infected = gameLinks.filter(link => link._parasiteInfected).length;
    if (infected < 4) qp.parasiteCleanKill = true;
  }
  questState.progress = qp;
  checkQuestlineProgress();
}

function tickArchitectQuest(elapsed) {
  const ql = questState.activeQuestline;
  if (!ql || ql.profile !== 'architect' || elapsed < qlStableTickAt) return;
  qlStableTickAt = elapsed + 6;
  if (gameLinks.length < 8) return;
  const stableRatio = gameLinks.filter(link => link.type === 'stable').length / gameLinks.length;
  const qp = questState.progress || {};
  qp._archStableCount = stableRatio >= 0.7 ? (qp._archStableCount || 0) + 1 : 0;
  questState.progress = qp;
  checkQuestlineProgress();
}

export function tickMetaFlow(elapsed) {
  tickComboDecay();
  if (aiState?.awarenessStage > 0 && G.l3On) {
    initQuestlineForProfile(aiState?.dominantProfile);
  }
  tickArchitectQuest(elapsed);
  if (shouldTriggerDraft()) triggerDraft();
}

export function resetMetaFlowRuntime() {
  resetActionState();
  comboState.mult = 1.0;
  comboState.lastPulse = 0;
  comboState.count = 0;
  G_DRAFT.lastDraftTime = 0;
  G_DRAFT.nextDraftIn = 95 + Math.random() * 30;
  G_DRAFT.active = false;
  G_DRAFT.draftCount = 0;
  G_DRAFT.appliedUpgrades = [];
  G_DRAFT.firstDraftDone = false;
  questState.activeQuestline = null;
  questState.progress = {};
  questState.advisoryDraftShown = false;
  agentCooldown = 0;
  updateComboHUD();
  renderQuestlinePanel();
  closeDraft(false);
  const agent = el('agent-line');
  if (agent) { agent.textContent = ''; agent.className = ''; }
}

export function restoreMetaFlow(save) {
  resetMetaFlowRuntime();
  const draft = save?.draft || {};
  G_DRAFT.appliedUpgrades = Array.isArray(draft.appliedUpgrades) ? [...draft.appliedUpgrades] : [];
  G_DRAFT.draftCount = draft.draftCount || 0;
  G_DRAFT.lastDraftTime = draft.lastDraftTime || 0;
  G_DRAFT.nextDraftIn = draft.nextDraftIn || (95 + Math.random() * 30);
  G_DRAFT.firstDraftDone = !!draft.firstDraftDone;
  G_DRAFT.active = !!draft.active;
  G_DRAFT.appliedUpgrades.forEach(applyUpgradeById);
  applyUpgradeSynergies();
  mergeActionStateSnapshot(save?.actionState);
  if (save?.questProgress) questState.progress = { ...save.questProgress };
  if (save?.activeQuestline) {
    questState.activeQuestline = {
      ...save.activeQuestline,
      steps: Array.isArray(save.activeQuestline.steps) ? save.activeQuestline.steps.map(step => ({ ...step })) : [],
    };
  }
  if (save?.combo) {
    comboState.mult = save.combo.mult || 1.0;
    comboState.lastPulse = save.combo.lastPulse || 0;
    comboState.count = save.combo.count || 0;
  }
  updateComboHUD();
  renderQuestlinePanel();
  if (G_DRAFT.active) {
    G.paused = true;
    renderDraftOverlay('Fortsetzung · Draft noch offen');
  }
}

