/**
 * SYNAPSE v95 — Protocol system
 * Migrated from v89→v95 p0patched lines ~4759–5095
 *
 * Scope in this Phase-G pass:
 *   - protocol definitions
 *   - tuning modifiers
 *   - protocol selection overlay flow
 *   - protocol HUD chip + intro signature
 *
 * Bridge mode:
 *   HTML still calls window._selectProtocol / window._confirmProtocol.
 */

import { TUNING } from '../state/tuning.js';
import { G } from '../state/gameState.js';
import { getLang } from '../state/settings.js';
import { loadAIMeta } from './ai.js';
import {
  updateProtocolChipUI,
  triggerProtocolSignatureUI,
  showProtocolOverlayUI,
  markProtocolSelectionUI,
  closeProtocolOverlayUI,
} from '../ui/overlays.js';
import { onboarding } from '../meta/onboarding.js';
import { regTimer } from '../registries/timerRegistry.js';

export const PROTOCOL_DEFS = {
  phantom: {
    id: 'phantom',
    nameDe: 'Phantom',
    nameEn: 'Phantom',
    tagDe: 'Phantom Protocol',
    tagEn: 'Phantom Protocol',
    hookDe: 'Der Trickster-Build',
    hookEn: 'The Trickster Build',
    color: 'rgba(200,80,255,.92)',
    hudColor: 'rgba(200,80,255,.85)',
    eliteAffinity: ['phantom_nexus'],
    spawnWeights: { phantom: 1.55, spine_node: 0.75, dormant: 1.0, temporal_anchor: 0.85 },
    modifiers: {
      // FIX 4.1: Phantom — shorter windows but open more frequently (high skill floor)
      syncWindowDuration: 0.80,        // 20% shorter — demands precise timing
      syncWindowCooldownMin: 0.72,     // opens ~28% more often
      syncWindowCooldownMax: 0.72,
      l3PassiveGain: 1.10,
    },
    conditionAffinity: ['low_signal'],
    unlocked: true,
  },
  spine: {
    id: 'spine',
    nameDe: 'Spine',
    nameEn: 'Spine',
    tagDe: 'Spine Protocol',
    tagEn: 'Spine Protocol',
    hookDe: 'Der Builder-Build',
    hookEn: 'The Builder Build',
    color: 'rgba(255,200,60,.92)',
    hudColor: 'rgba(255,200,60,.85)',
    eliteAffinity: ['dormant_fortress'],
    spawnWeights: { phantom: 0.75, spine_node: 1.55, dormant: 1.2, temporal_anchor: 0.85 },
    modifiers: {
      // FIX 4.1: Spine — backbone accrues energy passively (no Pulse required)
      syncWindowCooldownMin: 0.9,
      syncWindowCooldownMax: 0.9,
      bridgeReward: 1.2,
      spinePassiveTick: true,          // handled in layer3.js Spine backbone tick
    },
    conditionAffinity: [],
    unlocked: true,
  },
  temporal: {
    id: 'temporal',
    nameDe: 'Temporal',
    nameEn: 'Temporal',
    tagDe: 'Temporal Protocol',
    tagEn: 'Temporal Protocol',
    hookDe: 'Der Timing-Build',
    hookEn: 'The Timing Build',
    color: 'rgba(0,220,255,.92)',
    hudColor: 'rgba(0,220,255,.85)',
    eliteAffinity: ['temporal_anchor'],
    spawnWeights: { phantom: 0.85, spine_node: 0.9, dormant: 0.85, temporal_anchor: 1.7 },
    modifiers: {
      // FIX 4.1: Temporal — perfect hit (early window) halves next pulse CD
      syncWindowDuration: 1.18,
      pulseCd: 0.93,
      temporalComboReward: true,       // handled in gameplayActions.js on pulse hit
    },
    conditionAffinity: ['recursive_storm'],
    unlocked: true,
  },
  mnemonic: {
    id: 'mnemonic',
    nameDe: 'Mnemonic',
    nameEn: 'Mnemonic',
    tagDe: 'Mnemonic Protocol',
    tagEn: 'Mnemonic Protocol',
    hookDe: 'Der Snowball-Build',
    hookEn: 'The Snowball Build',
    color: 'rgba(120,255,160,.92)',
    hudColor: 'rgba(120,255,160,.85)',
    eliteAffinity: ['void_anchor'],
    spawnWeights: { phantom: 1.0, spine_node: 0.9, dormant: 1.1, temporal_anchor: 0.85 },
    modifiers: {
      // FIX 4.1: Mnemonic — Memory-Nodes can be manually tapped (new UI action)
      memoryMultiplier: 1.15,
      l3PassiveGain: 1.2,
      l3PassiveTick: 0.9,
      mnemonicTapEnabled: true,        // shows Tap-Memory button when memory nodes exist
    },
    conditionAffinity: [],
    unlocked: true,
  },
};

export const protocolState = window.__synProtocolState || (window.__synProtocolState = {
  activeProtocol: null,
  activeProtocolId: null,
  pendingProtocolId: null,
  protocolEliteAffinity: null,
});

function syncLegacyProtocolState() {
  window.__synProtocolState = protocolState;
}

function defineLegacyAlias(key, getter, setter) {
  const desc = Object.getOwnPropertyDescriptor(window, key);
  if (desc && (desc.get || desc.set)) return;
  Object.defineProperty(window, key, { configurable: true, enumerable: false, get: getter, set: setter });
}

defineLegacyAlias('_activeProtocol', () => protocolState.activeProtocol, value => { protocolState.activeProtocol = value || null; if (value?.id) protocolState.activeProtocolId = value.id; syncLegacyProtocolState(); });
defineLegacyAlias('_activeProtocolId', () => protocolState.activeProtocolId, value => { protocolState.activeProtocolId = value || null; syncLegacyProtocolState(); });
defineLegacyAlias('_pendingProtocolId', () => protocolState.pendingProtocolId, value => { protocolState.pendingProtocolId = value || null; syncLegacyProtocolState(); });
defineLegacyAlias('_protocolEliteAffinity', () => protocolState.protocolEliteAffinity, value => { protocolState.protocolEliteAffinity = value || null; syncLegacyProtocolState(); });
syncLegacyProtocolState();

export function getActiveProtocol() { return protocolState.activeProtocol; }
export function getActiveProtocolId() { return protocolState.activeProtocolId; }
export function getProtocolUnlockRules() {
  return {
    phantom: { runs: 0, labelDE: 'Immer verfügbar', labelEN: 'Always available' },
    spine: { runs: 0, labelDE: 'Immer verfügbar', labelEN: 'Always available' },
    temporal: { runs: 2, labelDE: 'Freischaltung: 2 Runs', labelEN: 'Unlock: 2 runs' },
    mnemonic: { runs: 4, labelDE: 'Freischaltung: 4 Runs', labelEN: 'Unlock: 4 runs' },
  };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

export function applyProtocolModifiers(proto) {
  if (!proto?.modifiers) return;
  const mods = proto.modifiers;
  if (mods.syncWindowDuration != null) {
    TUNING.syncWindowDuration = round2(TUNING.syncWindowDuration * mods.syncWindowDuration);
  }
  if (mods.syncWindowCooldownMin != null) {
    TUNING.syncWindowCooldownMin = round2(TUNING.syncWindowCooldownMin * mods.syncWindowCooldownMin);
  }
  if (mods.syncWindowCooldownMax != null) {
    TUNING.syncWindowCooldownMax = round2(TUNING.syncWindowCooldownMax * mods.syncWindowCooldownMax);
  }
  if (mods.pulseCd != null) {
    TUNING.pulseCd = Math.round(TUNING.pulseCd * mods.pulseCd);
  }
  if (mods.l3PassiveGain != null) {
    TUNING.l3PassiveGain = round2(TUNING.l3PassiveGain * mods.l3PassiveGain);
  }
  if (mods.l3PassiveTick != null) {
    TUNING.l3PassiveTick = round2(TUNING.l3PassiveTick * mods.l3PassiveTick);
  }
  if (mods.bridgeReward != null) {
    TUNING.bridgeReward = round2(TUNING.bridgeReward * mods.bridgeReward);
  }
  if (mods.memoryMultiplier != null) {
    TUNING.memoryMultiplier = round2(TUNING.memoryMultiplier * mods.memoryMultiplier);
  }

  // Sprint 3: Protocol class bonuses for Research system
  if (proto.id === 'mnemonic' && mods.mnemonicTapEnabled) {
    // Mnemonic: starts with research panel already open + bonus Data rate
    setTimeout(() => {
      try {
        import('./research.js').then(({ renderResearchPanel }) => {
          if (!G.research) return;
          G.research.data = (G.research.data || 0) + 20; // head-start Data
          G._research_memDataMult = 2;                    // built-in resonance
          renderResearchPanel();
          // Force Epoch II reveal immediately for Mnemonic
          const panel = document.getElementById('active-projects-hud');
          const dataStat = document.getElementById('data-stat');
          if (panel) { panel.style.display = ''; panel.classList.add('expanded'); }
          if (dataStat) dataStat.style.display = '';
        });
      } catch(e) {}
    }, 1500);

    // FIX P1: Wire up the Tap-Memory button that was referenced but never bound
    setTimeout(() => {
      const tapBtn = document.getElementById('btn-tap-memory');
      if (!tapBtn || tapBtn._mnemonicBound) return;
      tapBtn._mnemonicBound = true;
      tapBtn.addEventListener('click', () => {
        // Drain all charged memory nodes → convert to energy burst
        let harvested = 0;
        if (typeof gameNodes !== 'undefined') {
          for (const n of gameNodes) {
            if (n.type === 'memory' && (n.memCharge || 0) > 0) {
              harvested += n.memCharge;
              n.memCharge = 0;
              if (n.m?.material?.emissiveIntensity !== undefined)
                n.m.material.emissiveIntensity = 0.3;
            }
          }
        }
        if (harvested > 0) {
          G.energy = (G.energy || 0) + Math.round(harvested * 0.6);
          const lang = getLang ? getLang() : 'de';
          if (typeof showToast === 'function') {
            showToast(
              lang === 'de' ? '◬ MEMORY ANGEZAPFT' : '◬ MEMORY TAPPED',
              lang === 'de' ? `+${Math.round(harvested * 0.6)}⬡ aus ${Math.round(harvested)} Speicherpunkten` : `+${Math.round(harvested * 0.6)}⬡ from ${Math.round(harvested)} memory charge`,
              2000
            );
          }
        }
      });
    }, 2000);
  }

  if (proto.id === 'spine' && mods.spinePassiveTick) {
    // Spine: starts with 1 Daemon slot pre-unlocked
    setTimeout(() => {
      try {
        import('./awakening.js').then(({ unlockDaemons }) => unlockDaemons());
      } catch(e) {}
    }, 1200);
  }
}

export function biasEliteAffinityForProtocol(clusters) {
  const proto = protocolState.activeProtocol;
  if (!proto?.eliteAffinity?.length) return clusters;
  protocolState.protocolEliteAffinity = [...proto.eliteAffinity];
  syncLegacyProtocolState();
  return clusters;
}

export function showProtocolChip(proto = protocolState.activeProtocol) {
  if (!proto) return;
  updateProtocolChipUI(proto, getLang());
}

export function triggerProtocolSignature(protoId, lang = getLang()) {
  triggerProtocolSignatureUI(protoId, lang);
}

export function showProtocolScreen() {
  onboarding.onProtocol();
  protocolState.pendingProtocolId = null;
  syncLegacyProtocolState();

  const lang = getLang();
  const meta = loadAIMeta() || { totalRuns: 0 };
  const totalRuns = meta.totalRuns || 0;
  const unlockRules = getProtocolUnlockRules();

  showProtocolOverlayUI({ totalRuns, unlockRules, lang, defaultId: 'spine' });
  regTimer('protocolDefaultSelect', setTimeout(() => selectProtocol('spine'), 80), 'timeout');
}

export function selectProtocol(id) {
  if (!PROTOCOL_DEFS[id]) return;

  const meta = loadAIMeta() || { totalRuns: 0 };
  const rules = getProtocolUnlockRules();
  const locked = (meta.totalRuns || 0) < (rules[id]?.runs || 0);
  if (locked) return;

  protocolState.pendingProtocolId = id;
  syncLegacyProtocolState();
  markProtocolSelectionUI(id);
}

export function confirmProtocol() {
  const id = protocolState.pendingProtocolId;
  if (!id || !PROTOCOL_DEFS[id]) return;

  const proto = PROTOCOL_DEFS[id];
  protocolState.activeProtocol = proto;
  protocolState.activeProtocolId = id;
  protocolState.pendingProtocolId = null;
  syncLegacyProtocolState();
  biasEliteAffinityForProtocol();
  showProtocolChip(proto);

  closeProtocolOverlayUI();
  window._srAnnounce?.('Protokoll bestätigt');

  const sigLang = getLang();
  regTimer('protocolSignature', setTimeout(() => triggerProtocolSignature(id, sigLang), 600), 'timeout');
  regTimer('protocolLaunch', setTimeout(() => window._doLaunch?.(), 420), 'timeout');
}

// ── Backwards-compat globals ───────────────────────────────────────────────
window.PROTOCOL_DEFS = PROTOCOL_DEFS;
window.applyProtocolModifiers = applyProtocolModifiers;
window.biasEliteAffinityForProtocol = biasEliteAffinityForProtocol;
window.showProtocolChip = showProtocolChip;
window.triggerProtocolSignature = triggerProtocolSignature;
window._showProtocolScreen = showProtocolScreen;
window._selectProtocol = selectProtocol;
window._confirmProtocol = confirmProtocol;

