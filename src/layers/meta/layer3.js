/**
 * SYNAPSE v98 — Layer 3: Macro Clusters
 * MIGRATION SOURCE: v89 p0patched lines ~8558–10350 + 15947–15990
 * PHASE F
 *
 * Owns:
 *   MM            – shared material pack (7 materials)
 *   macNodes/macLinks/macCores – geometry arrays
 *   ELITE_CLUSTER_DEFS  – 5 elite encounter types
 *   STRATEGIC_PROJECTS  – 4 project definitions + runtime helpers
 *   _syncDecayRaf       – separate cancelable RAF (M-01 fix)
 *
 * Exports:
 *   initLayer3()            – one-time setup; call after G.l3On = true
 *   animateLayer3(t, dt)    – per-frame; called by gameLoop after animateLayer2
 *   startSyncDecayBar(dur, isFusion)
 *   stopSyncDecayBar()
 *   accumulateMemoryCache(gain)      – called from captureOpenClusters
 *   checkProjectTriggers()           – called after key events
 *   applyEchoBeaconEliteBoost(base)  – called from elite onCapture
 *   applyBackboneRelayBossBonus()    – called from boss window
 *   applyMemoryCacheDischargeBonus(n)
 *   getEchoBeaconRareBonus()
 *
 * Dispose:
 *   MM exposed as window.MM → disposed by dispose.js → disposeMaterialPack(window.MM)
 *   macGroup children disposed by disposeGroup(macGroup)
 *   _syncDecayRaf cancelled by stopSyncDecayBar() before reload
 *
 * Bridge-mode globals remaining in window scope (Phase G/H):
 *   showToast, spawnShock, refreshAll, checkObjectives,
 *   showSyncOverlay, hideSyncOverlay, showMissedSync, updateSyncBar,
 *   checkL3Objectives, checkSpine, logTL, getLinkTypeCounts,
 *   _updateActiveProjectsHud, loadAIMeta, updateHUD, agentOnSyncOpen,
 *   showProtocolChip, showCondChip, selectLayerCondition,
 *   checkQuestlineProgress, PROFILE_BONUS, aiState
 */

import * as THREE from 'three';
import { macGroup, GS, clock }   from '../../engine/scene.js';
import { G }                      from '../../state/gameState.js';
import { getLang }                from '../../state/settings.js';
import { TUNING }                 from '../../state/tuning.js';
import { eventMods, eliteState, gameplayFlags } from '../../state/gameplayFlags.js';
import { upgradeState, traitState, synergyState } from '../../state/actionState.js';
import { projectState, conditionState, questState, hasActiveCondition, getActiveConditionId } from '../../state/runContext.js';
import { regTimer, clearTimer }   from '../../registries/timerRegistry.js';
import {
  initL3HUDUI,
  updateL3ClusterHUDUI,
  updateL3ObjectivesUI,
  startSyncDecayBarUI,
  stopSyncDecayBarUI,
} from '../../ui/hud/index.js';
import {
  showProjectSelectionPanelUI,
  closeProjectSelectionPanelUI,
  updateActiveProjectsHudUI,
  initL3ClusterTooltipsUI,
  setClusterPhantomStateUI,
  triggerLayer3BonusFlashUI,
} from '../../ui/layer3Panels.js';
import { PROFILE_BONUS, agentOnSyncOpen, agentOnBackbone, agentOnSpine, agentOnFusion, loadAIMeta, getLinkTypeCounts } from '../../systems/ai.js';
import { aiState } from '../../state/aiShared.js';
import { protocolState, showProtocolChip } from '../../systems/protocols.js';
import { checkQuestlineProgress, getQuestProgress, onSyncCapture, triggerMilestoneDraft } from '../../meta/flow.js';
import { metaState, pushEliteResult } from '../../state/metaState.js';
import { bossState } from '../../state/bossShared.js';
import { triggerBossIntro, triggerBossWarning, triggerBossWarning2 } from '../../systems/boss.js';
import { applyEventEnergyMult, G_EVENT } from '../../systems/events.js';
import { SFX } from '../../audio/sfx.js';
import { spawnShock } from '../network/layer1.js';
import { showToast, refreshHUDSections, showConditionChip, hideConditionChip } from '../../ui/hud/index.js';
import { signalLayer3Changed } from '../../platform/stateSignals.js';
import { showSyncOverlay, hideSyncOverlay, showMissedSync, updateSyncBar, setNowAction, clearNowAction, logTL } from '../../ui/actionFlow.js';
import { onboarding } from '../../meta/onboarding.js';


// ═══════════════════════════════════════════════════════════════════════════
//  SHARED ARRAYS + MATERIAL PACK
// ═══════════════════════════════════════════════════════════════════════════

export const macNodes = [];
export const macLinks = [];
export const macCores = [];

/**
 * Shared Layer-3 material pack.
 * Exposed as window.MM so dispose.js → disposeMaterialPack(window.MM) works
 * without a direct import.
 */
export const MM = {
  core:  new THREE.MeshLambertMaterial({ color:0x4499ff, emissive:0x2255ee, emissiveIntensity:2.5, transparent:true, opacity:0 }),
  sat:   new THREE.MeshLambertMaterial({ color:0x33bbff, emissive:0x1166cc, emissiveIntensity:1.8, transparent:true, opacity:0 }),
  purp:  new THREE.MeshLambertMaterial({ color:0xcc77ff, emissive:0xaa33ee, emissiveIntensity:2.2, transparent:true, opacity:0 }),
  line:  new THREE.LineBasicMaterial({ color:0x2255dd, transparent:true, opacity:0, blending:THREE.AdditiveBlending }),
  hw:    new THREE.LineBasicMaterial({ color:0xaa44ff, transparent:true, opacity:0, blending:THREE.AdditiveBlending }),
  fuse:  new THREE.MeshLambertMaterial({ color:0xff9900, emissive:0xff6600, emissiveIntensity:4.5, transparent:true, opacity:0 }),
  spine: new THREE.MeshLambertMaterial({ color:0xffcc44, emissive:0xffaa00, emissiveIntensity:3.5, transparent:true, opacity:0 }),
};

window.MM       = MM;
window.macNodes = macNodes;
window.macLinks = macLinks;
window.macCores = macCores;

function _setCoreMaterial(mesh, material) {
  if (!mesh || mesh.material === material) return;
  mesh.material = material;
}

function _setCoreEmissiveHex(mesh, hex) {
  if (!mesh) return;
  if (mesh.userData._emissiveHex === hex) return;
  mesh.userData._emissiveHex = hex;
  mesh.material.emissive.setHex(hex);
}

let _l3HudStateSig = '';
let _l3HudStateTick = 0;

function _buildL3HudStateSig() {
  const clusters = G.l3Clusters || [];
  let sig = `${G.l3CapturedClusters}:${G.spineLength}:${G.l3BonusActive ? 1 : 0}:${G.fusedPairs.size}:${countConnectedCorePairs()}:`;
  for (let i = 0; i < clusters.length; i++) {
    const cl = clusters[i];
    if (!cl) continue;
    sig += cl.captured ? 'c' : cl.syncWindowOpen ? 'o' : cl.syncReady ? 'r' : '_';
    sig += cl._dormant ? 'd' : '-';
    sig += cl._eliteActive ? 'e' : '-';
    sig += G.spineNodes?.has?.(i) ? 's' : '-';
    sig += '|';
  }
  return sig;
}

function _signalL3HudIfChanged(t) {
  if (t - _l3HudStateTick < 0.12) return;
  _l3HudStateTick = t;
  const sig = _buildL3HudStateSig();
  if (sig === _l3HudStateSig) return;
  _l3HudStateSig = sig;
  signalLayer3Changed();
}


// ═══════════════════════════════════════════════════════════════════════════
//  ELITE CLUSTER DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export const ELITE_CLUSTER_DEFS = [

  // ── Mirror Relay ────────────────────────────────────────────────────────
  {
    id: 'mirror_relay',
    name: 'Mirror Relay', nameEN: 'Mirror Relay',
    color: 0x44ccff,
    captureWindow: 20, pulseStreak: 0, pulseStreakNeeded: 3,
    onActivate(clIdx) {
      eliteState.mirrorRelay = { clusterIdx:clIdx, active:true, startTime:clock.getElapsedTime(), pulseCount:0, failed:false };
      const lang = getLang();
      showToast('⟳ ELITE: MIRROR RELAY', lang==='de' ? 'Jeder 2. Pulse wird gespiegelt · 3 Pulses für Bonus' : 'Every 2nd pulse mirrored · 3 pulses for bonus', 4000);
      spawnShock(0x44ccff);
    },
    onCapture(clIdx) {
      const state = eliteState.mirrorRelay;
      if (!state || state.clusterIdx !== clIdx) return;
      const success = state.pulseCount >= 3;
      const lang = getLang();
      if (success) {
        const burst = applyEchoBeaconEliteBoost(32 + G.l3CapturedClusters * 4);
        G.energy += burst;
        gameplayFlags.eliteCaptureRareChainBonus = true;
        showToast('✓ MIRROR RELAY GESÄUBERT', lang==='de' ? `+${burst}⬡ · Echo-Resonanz aktiv · Seltene Kette wahrscheinlicher` : `+${burst}⬡ · Echo resonance active · Rare chain more likely`, 3500);
        spawnShock(0x44ccff); spawnShock(0xffffff);
        questState.progress = questState.progress || {};
        questState.progress.eliteClears = (questState.progress.eliteClears||0) + 1;
        questState.progress.eliteClearNoFailure = true;
        checkQuestlineProgress();
        pushEliteResult({ name:'Mirror Relay', result:'success', pulses:state.pulseCount });
      } else {
        gameplayFlags.eliteCaptureSignalNoiseDur = 15;
        gameplayFlags.eliteCaptureSignalNoiseStart = clock.getElapsedTime();
        showToast('✗ MIRROR RELAY GEFAILED', lang==='de' ? 'Nicht genug Pulses · Sync-Fenster −0.4s für 15s' : 'Not enough pulses · Sync windows −0.4s for 15s', 3000);
        G.l3SyncWindowDur = Math.max(0.8, G.l3SyncWindowDur - 0.4);
        spawnShock(0xff4444);
        questState.progress = questState.progress || {};
        questState.progress.eliteClearNoFailure = false;
        pushEliteResult({ name:'Mirror Relay', result:'fail', pulses:state.pulseCount });
      }
      eliteState.mirrorRelay = null;
    },
    onTimeout(clIdx) {
      const state = eliteState.mirrorRelay;
      if (!state || state.clusterIdx !== clIdx) return;
      state.failed = true;
      const lang = getLang();
      showToast('⚠ MIRROR RELAY ABGELAUFEN', lang==='de' ? 'Fenster geschlossen · Sync-Penalty aktiv' : 'Window expired · Sync penalty active', 2500);
      G.l3SyncWindowDur = Math.max(0.8, G.l3SyncWindowDur - 0.4);
      gameplayFlags.eliteCaptureSignalNoiseDur = 10;
      gameplayFlags.eliteCaptureSignalNoiseStart = clock.getElapsedTime();
      eliteState.mirrorRelay = null;
      spawnShock(0xff6644);
      pushEliteResult({ name:'Mirror Relay', result:'timeout' });
    },
  },

  // ── Dormant Fortress ────────────────────────────────────────────────────
  {
    id: 'dormant_fortress',
    name: 'Dormant Fortress', nameEN: 'Dormant Fortress',
    color: 0x88aaff,
    onActivate(clIdx) {
      eliteState.dormantFortress = { clusterIdx:clIdx, active:true, startTime:clock.getElapsedTime(), streak:0, failed:false };
      const lang = getLang();
      showToast('◈ ELITE: DORMANT FORTRESS', lang==='de' ? 'Stark gepanzert · 3 Pulses hintereinander für Capture-Progress' : 'Heavily fortified · 3 consecutive pulses for capture progress', 4000);
      spawnShock(0x88aaff);
    },
    onPulseHit(clIdx) {
      const state = eliteState.dormantFortress;
      if (!state || state.clusterIdx !== clIdx) return false;
      state.streak++;
      return state.streak >= 3;
    },
    onPulseMiss(clIdx) {
      const state = eliteState.dormantFortress;
      if (!state || state.clusterIdx !== clIdx) return;
      state.streak = 0;
    },
    onCapture(clIdx) {
      const state = eliteState.dormantFortress;
      if (!state || state.clusterIdx !== clIdx) return;
      gameplayFlags.eliteCaptureFortifiedSpine = true;
      if (window.TUNING) TUNING.spineEnergyMult = Math.min(1.6, (TUNING.spineEnergyMult || 1.0) * 1.20);
      const lang = getLang();
      showToast('✓ FESTUNG GEFALLEN', lang==='de' ? 'Disziplin belohnt · Backbone-Effekte +20% für diesen Run' : 'Discipline rewarded · Backbone effects +20% this run', 3500);
      spawnShock(0x88aaff); spawnShock(0xffffff);
      questState.progress = questState.progress || {};
      questState.progress.eliteClears = (questState.progress.eliteClears||0) + 1;
      questState.progress.dormantFortressClear = true;
      eliteState.dormantFortress = null;
      checkQuestlineProgress();
      pushEliteResult({ name:'Dormant Fortress', result:'success' });
    },
    onFailure(clIdx) {
      const state = eliteState.dormantFortress;
      if (!state || state.clusterIdx !== clIdx) return;
      G.pulseCost += 5;
      gameplayFlags.eliteCapturePulsePenaltyEnd = clock.getElapsedTime() + 20;
      const lang = getLang();
      showToast('✗ FESTUNG HÄLT STAND', lang==='de' ? 'Rhythmus gebrochen · Pulse-Kosten +5 für 20s' : 'Rhythm broken · Pulse cost +5 for 20s', 3000);
      spawnShock(0xff4444);
      eliteState.dormantFortress = null;
      pushEliteResult({ name:'Dormant Fortress', result:'fail' });
    },
    onTimeout(clIdx) {
      const state = eliteState.dormantFortress;
      if (state && state.clusterIdx === clIdx) {
        G.pulseCost += 5;
        gameplayFlags.eliteCapturePulsePenaltyEnd = clock.getElapsedTime() + 15;
        eliteState.dormantFortress = null;
      }
      const lang = getLang();
      showToast('◈ FESTUNG HÄLT STAND', lang==='de' ? 'Zeit abgelaufen · Pulse-Kosten +5 für 15s' : 'Time expired · Pulse cost +5 for 15s', 2500);
      spawnShock(0xff8844);
      pushEliteResult({ name:'Dormant Fortress', result:'timeout' });
    },
  },

  // ── Void Anchor ──────────────────────────────────────────────────────────
  {
    id: 'void_anchor',
    name: 'Void Anchor', nameEN: 'Void Anchor',
    color: 0xbb44ff,
    captureWindow: 18, drainPerMiss: 5,
    onActivate(clIdx) {
      eliteState.voidAnchor = { clusterIdx:clIdx, active:true, startTime:clock.getElapsedTime(), missCount:0 };
      const lang = getLang();
      showToast('⊗ ELITE: VOID ANCHOR', lang==='de' ? 'Drain-Zone aktiv · Jeder Fehlpulse kostet −5⬡ · Fokus ist alles' : 'Drain zone active · Each missed pulse costs −5⬡ · Focus is everything', 4000);
      spawnShock(0xbb44ff);
    },
    onPulseMiss(clIdx) {
      const state = eliteState.voidAnchor;
      if (!state || state.clusterIdx !== clIdx || !state.active) return;
      state.missCount++;
      G.energy = Math.max(0, G.energy - this.drainPerMiss);
      refreshHUDSections('top', 'l3');
    },
    onCapture(clIdx) {
      const state = eliteState.voidAnchor;
      if (!state || state.clusterIdx !== clIdx) return;
      const lang = getLang();
      const cleanKill = (state.missCount === 0);
      const bonus = cleanKill ? 50 : 30;
      G.energy += bonus;
      refreshHUDSections('top', 'l3');
      showToast(cleanKill ? '✓ VOID ANCHOR — FLAWLESS' : '✓ VOID ANCHOR GESÄUBERT', lang==='de' ? `+${bonus}⬡ · Drain aufgehoben${cleanKill?' · Kein Verlust!':''}` : `+${bonus}⬡ · Drain lifted${cleanKill?' · No losses!':''}`, 3500);
      spawnShock(0xbb44ff); spawnShock(0xffffff);
      questState.progress = questState.progress || {};
      questState.progress.eliteClears = (questState.progress.eliteClears||0) + 1;
      questState.progress.eliteClearNoFailure = cleanKill;
      checkQuestlineProgress();
      pushEliteResult({ name:'Void Anchor', result:cleanKill?'flawless':'success', missCount:state.missCount });
      eliteState.voidAnchor = null;
    },
    onFailure(clIdx) {
      const state = eliteState.voidAnchor;
      if (!state || state.clusterIdx !== clIdx) return;
      const lang = getLang();
      const totalDrain = (state.missCount||0) * this.drainPerMiss;
      showToast('✗ VOID ANCHOR GEFAILED', lang==='de' ? `Drain hält an · −${totalDrain}⬡ Gesamtverlust` : `Drain continues · −${totalDrain}⬡ total loss`, 3000);
      spawnShock(0xff44aa);
      questState.progress = questState.progress || {};
      questState.progress.eliteClearNoFailure = false;
      pushEliteResult({ name:'Void Anchor', result:'fail', missCount:state.missCount });
      eliteState.voidAnchor = null;
    },
    onTimeout(_clIdx) {
      eliteState.voidAnchor = null;
      const lang = getLang();
      showToast('⊗ VOID ANCHOR', lang==='de' ? 'Fenster abgelaufen · Drain endet' : 'Window expired · Drain ends', 2000);
      pushEliteResult({ name:'Void Anchor', result:'timeout' });
    },
  },

  // ── Phantom Nexus ────────────────────────────────────────────────────────
  {
    id: 'phantom_nexus',
    name: 'Phantom Nexus', nameEN: 'Phantom Nexus',
    color: 0xee88ff,
    captureWindow: 22,
    onActivate(clIdx) {
      eliteState.phantomNexus = { clusterIdx:clIdx, active:true, startTime:clock.getElapsedTime(), evasions:0, captured:false, failed:false };
      const lang = getLang();
      showToast('◈ ELITE: PHANTOM NEXUS', lang==='de' ? 'Nicht greifbar · Train zuerst — dann Pulse!' : 'Untouchable · Train first — then Pulse!', 4500);
      spawnShock(0xee88ff);
      setClusterPhantomStateUI(clIdx, true);
    },
    onPulseAttempt(clIdx) {
      const state = eliteState.phantomNexus;
      if (!state || state.clusterIdx !== clIdx) return true;
      const timeSinceTrain = Date.now() - (aiState?.lastTrainTime || 0);
      if (timeSinceTrain <= 4000) return true;
      state.evasions++;
      const drain = 8 + state.evasions * 3;
      G.energy = Math.max(0, G.energy - drain);
      gameplayFlags.phantomNexusGhostCooldownEnd = Date.now() + 8000;
      const lang = getLang();
      showToast('◈ PHANTOM EVADIERT', lang==='de' ? `−${drain}⬡ · Erst trainieren! · Trainingssperre +8s` : `−${drain}⬡ · Train first! · Training lock +8s`, 2800);
      spawnShock(0xbb44cc);
      refreshHUDSections('top', 'l3');
      return false;
    },
    onCapture(clIdx) {
      const state = eliteState.phantomNexus;
      if (!state || state.clusterIdx !== clIdx) return;
      const cleanCapture = (state.evasions === 0);
      const burst = cleanCapture ? 55 : 35;
      G.energy += burst;
      gameplayFlags.phantomNexusEchoBonus = (gameplayFlags.phantomNexusEchoBonus || 0) + 8;
      const lang = getLang();
      showToast(cleanCapture ? '✓ PHANTOM NEXUS — PERFECT' : '✓ PHANTOM NEXUS CAPTURED', lang==='de' ? `+${burst}⬡ · Phantom Echo aktiv · Jeder Train +${gameplayFlags.phantomNexusEchoBonus}⬡` : `+${burst}⬡ · Phantom Echo active · Every Train +${gameplayFlags.phantomNexusEchoBonus}⬡`, 4000);
      spawnShock(0xee88ff); spawnShock(0xffffff); spawnShock(0xcc66ff);
      questState.progress = questState.progress || {};
      questState.progress.eliteClears = (questState.progress.eliteClears||0) + 1;
      questState.progress.phantomNexusClear = true;
      eliteState.phantomNexus = null;
      setClusterPhantomStateUI(clIdx, false);
      checkQuestlineProgress();
      refreshHUDSections('top', 'l3');
      pushEliteResult({ name:'Phantom Nexus', result:cleanCapture?'perfect':'success', evasions:state.evasions });
      logTL('elite', `◈ Phantom Nexus ${cleanCapture?'PERFECT':'captured'}`, 'rgba(200,100,255,.85)', '★');
    },
    onTimeout(clIdx) {
      const state = eliteState.phantomNexus;
      if (!state || state.clusterIdx !== clIdx) return;
      const lang = getLang();
      showToast('◈ PHANTOM ENTKOMMEN', lang==='de' ? 'Fenster abgelaufen · Training-Score −15%' : 'Window expired · Training score −15%', 3000);
      gameplayFlags.phantomNexusTrainPenaltyEnd = Date.now() + 30000;
      spawnShock(0xff44aa);
      eliteState.phantomNexus = null;
      setClusterPhantomStateUI(clIdx, false);
      pushEliteResult({ name:'Phantom Nexus', result:'timeout', evasions:state.evasions||0 });
    },
  },

  // ── Temporal Anchor ──────────────────────────────────────────────────────
  {
    id: 'temporal_anchor',
    name: 'Temporal Anchor', nameEN: 'Temporal Anchor',
    color: 0x44eeff,
    captureWindow: 16, coreWindowStart: 8, coreWindowEnd: 13,
    onActivate(clIdx) {
      const baseCd = G.pulseCd;
      const slowedCd = Math.round(baseCd * 1.40);
      eliteState.temporalAnchor = { clusterIdx:clIdx, active:true, startTime:Date.now(), baseCd, slowedCd, reverted:false };
      G.pulseCd = slowedCd;
      refreshHUDSections('top', 'l3');
      const lang = getLang();
      showToast(lang==='de' ? '⧗ ELITE: TEMPORAL ANCHOR' : '⧗ ELITE: TEMPORAL ANCHOR', lang==='de' ? 'Zeitfeld aktiv · Pulse-Takt +40% · Kern-Fenster: 8–13s nach Aktivierung' : 'Time field active · Pulse rate +40% · Core window: 8–13s after activation', 4500);
      spawnShock(0x44eeff); spawnShock(0x0088cc);
    },
    onPulseHit(clIdx) {
      const state = eliteState.temporalAnchor;
      if (!state || state.clusterIdx !== clIdx || !state.active) return false;
      return true;
    },
    onCapture(clIdx) {
      const state = eliteState.temporalAnchor;
      if (!state || state.clusterIdx !== clIdx) return;
      const lang = getLang();
      const elapsed = (Date.now() - state.startTime) / 1000;
      const inCore = elapsed >= this.coreWindowStart && elapsed <= this.coreWindowEnd;
      if (!state.reverted) { G.pulseCd = state.baseCd; state.reverted = true; }
      if (inCore) {
        const cdReduction = Math.round(state.baseCd * 0.25);
        G.pulseCd = Math.max(800, state.baseCd - cdReduction);
        G.l3SyncWindowDur = Math.min(12, (G.l3SyncWindowDur || TUNING.syncWindowDuration) + 1.5);
        TUNING.syncWindowDuration = G.l3SyncWindowDur;
        const cdPct = Math.round((1 - G.pulseCd / state.baseCd) * 100);
        showToast(lang==='de' ? '✓ TEMPORAL ANCHOR — PRÄZISION' : '✓ TEMPORAL ANCHOR — PRECISION', lang==='de' ? `Kern-Fenster! Pulse-CD −${cdPct}% · Sync-Fenster +1.5s` : `Core window! Pulse CD −${cdPct}% · Sync window +1.5s`, 4000);
        spawnShock(0x44eeff); spawnShock(0xffffff); spawnShock(0x00ffcc);
        logTL('elite', `◈ Temporal Anchor PRECISION · −${cdPct}% CD`, 'rgba(80,240,255,.9)', '★');
      } else {
        const cdReduction10 = Math.round(state.baseCd * 0.10);
        G.pulseCd = Math.max(800, state.baseCd - cdReduction10);
        showToast(lang==='de' ? '✓ TEMPORAL ANCHOR GESÄUBERT' : '✓ TEMPORAL ANCHOR CLEARED', lang==='de' ? 'Zeitfeld aufgelöst · Pulse-CD −10%' : 'Time field dissolved · Pulse CD −10%', 3000);
        spawnShock(0x44eeff); spawnShock(0xffffff);
        logTL('elite', '◈ Temporal Anchor cleared · −10% CD', 'rgba(80,200,255,.7)', '✓');
      }
      refreshHUDSections('top', 'l3');
      questState.progress = questState.progress || {};
      questState.progress.eliteClears = (questState.progress.eliteClears||0) + 1;
      questState.progress.eliteClearNoFailure = inCore;
      checkQuestlineProgress();
      pushEliteResult({ name:'Temporal Anchor', result:inCore?'flawless':'success', pulses:0 });
      eliteState.temporalAnchor = null;
    },
    onPulseMiss(_clIdx) {
      // Temporal Anchor has no per-miss penalty — the slowdown IS the penalty
    },
    onFailure(clIdx) {
      const state = eliteState.temporalAnchor;
      if (!state || state.clusterIdx !== clIdx) return;
      const lang = getLang();
      if (!state.reverted) { G.pulseCd = state.baseCd; state.reverted = true; }
      refreshHUDSections('top', 'l3');
      showToast(lang==='de' ? '✗ TEMPORAL ANCHOR — VERLOREN' : '✗ TEMPORAL ANCHOR — LOST', lang==='de' ? 'Fenster abgelaufen · Kein Bonus' : 'Window expired · No bonus', 2800);
      spawnShock(0xff4444);
      logTL('elite', '✗ Temporal Anchor — verloren', 'rgba(255,100,100,.7)', '✗');
      pushEliteResult({ name:'Temporal Anchor', result:'timeout' });
      eliteState.temporalAnchor = null;
    },
    onTimeout(clIdx) {
      const state = eliteState.temporalAnchor;
      if (state && state.clusterIdx === clIdx && !state.reverted) {
        G.pulseCd = state.baseCd;
        state.reverted = true;
        refreshHUDSections('top', 'l3');
      }
      const lang = getLang();
      showToast(lang==='de' ? '⧗ TEMPORAL ANCHOR' : '⧗ TEMPORAL ANCHOR', lang==='de' ? 'Zeitfeld endet · Kein Bonus' : 'Time field ends · No bonus', 2000);
      logTL('elite', '⧗ Temporal Anchor — Timeout', 'rgba(80,200,255,.35)', '⧗');
      pushEliteResult({ name:'Temporal Anchor', result:'timeout' });
      eliteState.temporalAnchor = null;
    },
  },
];

window.ELITE_CLUSTER_DEFS = ELITE_CLUSTER_DEFS;

const LAYER_CONDITIONS = [
  {
    id: 'low_signal',
    name: 'Low Signal',
    nameDe: 'Low Signal',
    nameEn: 'Low Signal',
    desc: 'Telemetrie gedämpft · Höhere Event-Chance · Improvisation zahlt sich aus',
    descEn: 'Telemetry dampened · Higher event chance · Improvisation pays off',
    apply() {
      conditionState.lowSignal = true;
      conditionState.recursiveStorm = false;
      conditionState.activeCondition = this;
      conditionState.activeConditionId = this.id;
      if (typeof G_EVENT !== 'undefined' && G_EVENT?.nextEventIn) {
        G_EVENT.nextEventIn = Math.max(30, G_EVENT.nextEventIn * 0.75);
      }
      showToast('LOW SIGNAL', getLang() === 'de'
        ? 'Telemetrie rauscht · Events häufiger · Instinkt ist jetzt dein Werkzeug'
        : 'Telemetry noise · Events more frequent · Instinct is your tool', 4000);
      spawnShock(0x4488ff);
      showConditionChip(this);
    },
    revert() {
      conditionState.lowSignal = false;
      hideConditionChip();
      showToast('SCHICHT ABGESCHLOSSEN', getLang() === 'de'
        ? 'Low Signal · Condition beendet'
        : 'Low Signal · Condition ended', 2500);
    },
  },
  {
    id: 'recursive_storm',
    name: 'Recursive Storm',
    nameDe: 'Recursive Storm',
    nameEn: 'Recursive Storm',
    desc: 'Event-Ketten leichter · Tradeoff-Ketten häufiger · Extra Chain-Score im Run-Report',
    descEn: 'Event chains easier · Tradeoff chains more frequent · Bonus chain score',
    apply() {
      conditionState.recursiveStorm = true;
      conditionState.lowSignal = false;
      conditionState.activeCondition = this;
      conditionState.activeConditionId = this.id;
      conditionState.recursiveStormChainChanceBonus = 0.08;
      showToast('RECURSIVE STORM', getLang() === 'de'
        ? 'Ereignisstrudel dreht sich auf · Ketten brechen leichter los · Risiko = Chance'
        : 'Event vortex spinning up · Chains break loose easier · Risk = Reward', 4000);
      spawnShock(0xcc44ff);
      spawnShock(0x8800aa);
      showConditionChip(this);
    },
    revert() {
      conditionState.recursiveStorm = false;
      conditionState.recursiveStormChainChanceBonus = 0;
      hideConditionChip();
      showToast('SCHICHT ABGESCHLOSSEN', getLang() === 'de'
        ? 'Recursive Storm · Condition beendet'
        : 'Recursive Storm · Condition ended', 2500);
    },
  },
];

export function selectLayerCondition() {
  const meta = loadAIMeta();
  const totalRuns = meta?.totalRuns || 0;
  if (totalRuns < 2 || Math.random() > 0.60) return null;

  const proto = protocolState.activeProtocol;
  if (proto?.conditionAffinity?.length && Math.random() < 0.55) {
    const preferred = LAYER_CONDITIONS.find(cond => proto.conditionAffinity.includes(cond.id));
    if (preferred) return preferred;
  }
  return LAYER_CONDITIONS[Math.floor(Math.random() * LAYER_CONDITIONS.length)] || null;
}


// ═══════════════════════════════════════════════════════════════════════════
//  STRATEGIC PROJECTS
// ═══════════════════════════════════════════════════════════════════════════

const STRATEGIC_PROJECTS = [
  {
    id: 'backbone_relay', name: 'Backbone Relay', nameEN: 'Backbone Relay',
    desc: 'Frühe Energie-Investition stärkt Spine-Wachstum und Backbone-Boni dauerhaft.',
    descEN: 'Early energy investment permanently strengthens Spine growth and Backbone bonuses.',
    theme: 'structural', cost: 40, costLabel: '−40⬡',
    trigger: { type: 'spineLength', threshold: 4 },
    triggered: false, active: false,
    reward(project) {
      if (window.TUNING) TUNING.spineEnergyMult = Math.min(2.0, (TUNING.spineEnergyMult || 1.0) * 1.30);
      const lang = getLang();
      if (G.backboneActive) {
        const burst = 55;
        G.energy += burst;
        spawnShock(0xffcc44); spawnShock(0xffaa22);
        showToast('◈ BACKBONE RELAY GEERNTET', lang==='de' ? `Spine-Multiplikator ×1.3 · Backbone-Burst +${burst}⬡` : `Spine multiplier ×1.3 · Backbone burst +${burst}⬡`, 4500);
      } else {
        showToast('◈ BACKBONE RELAY GEERNTET', lang==='de' ? 'Spine-Multiplikator ×1.3 · Backbone-Bonus vorgeladen' : 'Spine multiplier ×1.3 · Backbone bonus preloaded', 4000);
        spawnShock(0xffcc44);
      }
      projectState.backboneRelayBossBonus = true;
      project.triggered = true;
    },
    rewardLabel: 'Spine ≥ 4 → Spine-Mult ×1.3 · Backbone-Burst +55⬡ · Boss-Konter',
    rewardLabelEN: 'Spine ≥ 4 → Spine mult ×1.3 · Backbone burst +55⬡ · Boss counter',
    color: 'rgba(255,200,60,.95)', colorHex: 0xffcc44,
  },
  {
    id: 'memory_cache', name: 'Memory Cache', nameEN: 'Memory Cache',
    desc: 'Speichert laufenden Ertrag aus Layer 3. Wird im nächsten kritischen Moment als Burst entladen.',
    descEN: 'Stores ongoing gains from Layer 3. Released as a burst at the next critical moment.',
    theme: 'economic', cost: 25, costLabel: '−25⬡',
    trigger: { type: 'capturedClusters', threshold: 5 },
    triggered: false, active: false, stored: 0,
    reward(project) {
      const burst = Math.max(30, project.stored);
      G.energy += burst;
      if (PROFILE_BONUS?.mnemonic) projectState.memoryCacheActive = true;
      spawnShock(0xcc44ff); spawnShock(0x8822aa);
      const lang = getLang();
      showToast('◉ MEMORY CACHE ENTLADEN', lang==='de' ? `+${burst}⬡ Gespeicherter Ertrag · Discharge-Effizienz +15%` : `+${burst}⬡ Stored output released · Discharge efficiency +15%`, 4500);
      project.triggered = true;
    },
    rewardLabel: '5 Cluster → Burst (gespeicherter Ertrag) · Discharge +15%',
    rewardLabelEN: '5 clusters → Burst (stored output) · Discharge +15%',
    color: 'rgba(200,80,255,.95)', colorHex: 0xcc44ff,
  },
  {
    id: 'quarantine_lattice', name: 'Quarantine Lattice', nameEN: 'Quarantine Lattice',
    desc: 'Schwächt negative Layer Conditions und Parasite-Effekte.',
    descEN: 'Weakens negative Layer Conditions and Parasite effects.',
    theme: 'defensive', cost: 30, costLabel: '−30⬡',
    trigger: { type: 'conditionActive', threshold: 1 },
    triggered: false, active: false,
    reward(project) {
      if (conditionState.lowSignal && typeof G_EVENT !== 'undefined') {
        G_EVENT.nextEventIn = Math.max(G_EVENT.nextEventIn, G_EVENT.nextEventIn * 1.25);
      }
      if (conditionState.recursiveStorm) {
        conditionState.recursiveStormChainChanceBonus = Math.max(0, (conditionState.recursiveStormChainChanceBonus||0) * 0.5);
      }
      G.l3SyncWindowDur = Math.min(8, (G.l3SyncWindowDur||5) + 0.8);
      const burst = 35;
      G.energy += burst;
      spawnShock(0x44ffaa); spawnShock(0x22cc88);
      const lang = getLang();
      showToast('⬡ QUARANTINE LATTICE AKTIV', lang==='de' ? `Condition mitigiert · Sync +0.8s · +${burst}⬡ Konter` : `Condition mitigated · Sync +0.8s · +${burst}⬡ counter`, 4500);
      project.triggered = true;
    },
    rewardLabel: 'Condition aktiv → Condition geschwächt · Sync-Fenster +0.8s · +35⬡',
    rewardLabelEN: 'Condition active → Condition weakened · Sync window +0.8s · +35⬡',
    color: 'rgba(60,255,170,.95)', colorHex: 0x44ffaa,
  },
  {
    id: 'echo_beacon', name: 'Echo Beacon', nameEN: 'Echo Beacon',
    desc: 'Verbessert Rare-Chain-Chancen und Elite-Cluster-Erträge für den Rest des Runs.',
    descEN: 'Improves Rare Chain chances and Elite Cluster yields for the rest of the run.',
    theme: 'economic', cost: 35, costLabel: '−35⬡',
    trigger: { type: 'eliteClear', threshold: 1 },
    triggered: false, active: false,
    reward(project) {
      projectState.echoBeaconRareBonus = 0.12;
      projectState.echoBeaconEliteMult = 1.25;
      spawnShock(0x44ccff); spawnShock(0x2299dd);
      const lang = getLang();
      showToast('⟳ ECHO BEACON AKTIV', lang==='de' ? 'Rare-Chain-Chance +12% · Elite-Erträge ×1.25 für diesen Run' : 'Rare chain chance +12% · Elite yields ×1.25 for this run', 4500);
      project.triggered = true;
    },
    rewardLabel: '1 Elite-Clear → Rare-Chain +12% · Elite-Erträge ×1.25',
    rewardLabelEN: '1 Elite clear → Rare chain +12% · Elite yields ×1.25',
    color: 'rgba(60,200,255,.95)', colorHex: 0x44ccff,
  },
];

// ── Project runtime helpers ────────────────────────────────────────────────

function updateActiveProjectsHud() {
  updateActiveProjectsHudUI({
    projects: G.activeProjects || [],
    lang: getLang(),
    capturedClusters: G.l3CapturedClusters || 0,
    energy: G.energy || 0,
    spineLength: G.spineLength || 0,
    backboneActive: !!G.backboneActive,
    conditionActive: hasActiveCondition(),
    eliteClears: getQuestProgress()?.eliteClears || 0,
  });
}

function activateProject(projectId) {
  const def = STRATEGIC_PROJECTS.find(p => p.id === projectId);
  if (!def || G.projectSlotsUsed >= 2) return;
  if (G.energy < def.cost) {
    const lang = getLang();
    showToast(lang==='de' ? 'ZU WENIG ENERGIE' : 'NOT ENOUGH ENERGY', lang==='de' ? `Projekt kostet ${def.cost}⬡` : `Project costs ${def.cost}⬡`, 2000);
    return;
  }
  G.energy -= def.cost;
  const instance = { ...def, triggered:false, active:true, stored:0, _startTime: clock.getElapsedTime() };
  G.activeProjects.push(instance);
  G.projectSlotsUsed++;
  spawnShock(instance.colorHex);
  const lang = getLang();
  showToast('◈ PROJEKT GESTARTET: ' + instance.name.toUpperCase(), lang==='de' ? `${def.costLabel} investiert · ${def.rewardLabel}` : `${def.costLabel} invested · ${def.rewardLabelEN}`, 5000);
  updateActiveProjectsHud();
}

export function checkProjectTriggers() {
  if (!G.activeProjects?.length) return;
  for (const proj of G.activeProjects) {
    if (proj.triggered || !proj.active) continue;
    const t = proj.trigger;
    let shouldFire = false;
    switch (t.type) {
      case 'spineLength':       shouldFire = G.spineLength >= t.threshold; break;
      case 'capturedClusters':
        shouldFire = G.l3CapturedClusters >= t.threshold;
        if (proj.id === 'memory_cache' && !proj.triggered && projectState.memoryCacheAccum) {
          proj.stored += projectState.memoryCacheAccum;
          projectState.memoryCacheAccum = 0;
        }
        break;
      case 'backboneActive':    shouldFire = G.backboneActive; break;
      case 'conditionActive':   shouldFire = hasActiveCondition(); break;
      case 'eliteClear':        shouldFire = (getQuestProgress()?.eliteClears || 0) >= t.threshold; break;
      case 'energy':            shouldFire = G.energy >= t.threshold; break;
    }
    if (shouldFire) proj.reward(proj);
  }
  updateActiveProjectsHud();
}

export function accumulateMemoryCache(gain) {
  const mc = G.activeProjects?.find(p => p.id === 'memory_cache' && !p.triggered);
  if (mc) {
    mc.stored = (mc.stored||0) + Math.round(gain * 0.40);
    updateActiveProjectsHud();
  }
}

export function applyEchoBeaconEliteBoost(baseBurst) {
  if (projectState.echoBeaconEliteMult && !G.activeProjects?.find(p=>p.id==='echo_beacon')?.triggered) {
    return Math.round(baseBurst * projectState.echoBeaconEliteMult);
  }
  return baseBurst;
}

export function applyBackboneRelayBossBonus() {
  if (projectState.backboneRelayBossBonus) {
    const bonus = 18;
    G.energy += bonus;
    projectState.backboneRelayBossBonus = false;
    const lang = getLang();
    showToast('◈ RELAY-KONTER', lang==='de' ? `+${bonus}⬡ Backbone-Relay-Bonus` : `+${bonus}⬡ Backbone Relay bonus`, 2200);
    updateActiveProjectsHud();
  }
}

export function applyMemoryCacheDischargeBonus(discharge) {
  return projectState.memoryCacheActive ? Math.round(discharge * 1.15) : discharge;
}

export function getEchoBeaconRareBonus() {
  return projectState.echoBeaconRareBonus || 0;
}

function rehydrateProjectInstance(project) {
  const def = STRATEGIC_PROJECTS.find(item => item.id === project?.id);
  if (!def) return null;
  return {
    ...def,
    triggered: !!project?.triggered,
    active: project?.active !== false,
    stored: project?.stored || 0,
    _startTime: project?._startTime || clock.getElapsedTime(),
  };
}

function initStrategicProjects(restoring = false) {
  if (restoring && Array.isArray(G.activeProjects) && G.activeProjects.length) {
    G.activeProjects = G.activeProjects.map(rehydrateProjectInstance).filter(Boolean);
    G.projectSlotsUsed = G.projectSlotsUsed || G.activeProjects.length;
    updateActiveProjectsHud();
    return;
  }

  G.activeProjects = [];
  G.projectSlotsUsed = 0;
  projectState.backboneRelayBossBonus = false;
  projectState.memoryCacheActive = false;
  projectState.memoryCacheAccum = 0;
  projectState.echoBeaconRareBonus = 0;
  projectState.echoBeaconEliteMult = 1.0;
  updateActiveProjectsHud();
  const meta = loadAIMeta?.();
  if (!meta || (meta.totalRuns||0) < 2) return;
  const pool = [...STRATEGIC_PROJECTS].sort(() => Math.random() - 0.5).slice(0, 3);
  const lang = getLang();
  regTimer('l3projectSelect', setTimeout(() => {
    clearTimer('l3projectSelect');
    showProjectSelectionPanel(pool, lang);
  }, 6000), 'timeout');
}

function showProjectSelectionPanel(pool, lang) {
  showProjectSelectionPanelUI({
    pool,
    lang,
    maxSlots: 2,
    getSlotsUsed: () => G.projectSlotsUsed,
    onSelect: activateProject,
    onClose: () => regTimer('l3ProjectHudRefresh', setTimeout(() => {
      updateActiveProjectsHud();
      clearTimer('l3ProjectHudRefresh');
    }, 450), 'timeout'),
  });
}

function closeProjectPanel() {
  closeProjectSelectionPanelUI({ silent: false });
}
window.closeProjectPanel = closeProjectPanel;
window._updateActiveProjectsHud = updateActiveProjectsHud;
window.selectLayerCondition = selectLayerCondition;

// ═══════════════════════════════════════════════════════════════════════════
//  ELITE CLUSTER ASSIGNMENT
// ═══════════════════════════════════════════════════════════════════════════

function assignEliteClusters(clusters) {
  // Sync protocol elite affinity before use (FIX L-07)
  if (!protocolState.protocolEliteAffinity && protocolState.activeProtocol?.eliteAffinity) {
    protocolState.protocolEliteAffinity = protocolState.activeProtocol.eliteAffinity;
  }
  regTimer('l3eliteOnboard', setTimeout(() => {
    clearTimer('l3eliteOnboard');
    onboarding.onElite();
  }, 2000), 'timeout');
  metaState.eliteResults = [];


  const meta = loadAIMeta?.();
  const totalRuns = meta?.totalRuns || 0;
  if (totalRuns < 1) return;

  const maxElites = totalRuns >= 2 ? 2 : 1;
  let defsPool = [...ELITE_CLUSTER_DEFS].sort(() => Math.random() - 0.5);
  const affinity = protocolState.protocolEliteAffinity || [];
  if (affinity.length) {
    defsPool.sort((a, b) => (affinity.includes(a.id) ? -1 : 0) - (affinity.includes(b.id) ? -1 : 0));
  }
  const slotPool = clusters.map((_, i) => i).sort(() => Math.random() - 0.5);
  let assigned = 0;
  for (let d = 0; d < defsPool.length && assigned < maxElites && assigned < slotPool.length; d++) {
    const roll = assigned === 0 ? 0.70 : 0.55;
    if (Math.random() < roll) {
      const idx = slotPool[assigned];
      clusters[idx]._eliteType   = defsPool[d].id;
      clusters[idx]._eliteDef    = defsPool[d];
      clusters[idx]._eliteActive = false;
      assigned++;
      // FIX 1.4: Dev logging for elite assignment
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug('[Elite] Assigned', defsPool[d].id, 'to cluster', idx);
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════

export function initLayer3(options = {}) {
  const restoring = !!options.restoring;
  G.l3Clusters = [];
  const hwMats = [];

  // ── Build 8 macro clusters ────────────────────────────────────────────
  for (let c = 0; c < 8; c++) {
    const r  = 112 + Math.random() * 72;
    const ph = Math.acos(2 * Math.random() - 1);
    const th = Math.random() * Math.PI * 2;
    const cx = r * Math.sin(ph) * Math.cos(th);
    const cy = r * Math.sin(ph) * Math.sin(th) * 0.54;
    const cz = r * Math.cos(ph);

    const cm = new THREE.Mesh(GS, Math.random() < 0.35 ? MM.purp : MM.core);
    cm.scale.setScalar(1.8 + Math.random() * 1.3);
    cm.position.set(cx, cy, cz);
    cm.userData = { bp: new THREE.Vector3(cx, cy, cz), off: Math.random() * Math.PI * 2, coreIdx: c };
    macGroup.add(cm); macNodes.push(cm); macCores.push(cm);

    G.l3Clusters.push({
      id: c, coreIdx: c, mesh: cm,
      captured: false, syncReady: false, syncWindowOpen: false,
      syncTimer: 0,
      syncCooldown: TUNING.syncWindowCooldownMin + Math.random() * (TUNING.syncWindowCooldownMax - TUNING.syncWindowCooldownMin),
      lastSyncOpen: -999, lastPulseCapture: -999,
      connectedTo: new Set(),
    });

    // Satellites
    const loc = [cm];
    for (let s = 0; s < 7 + Math.floor(Math.random() * 8); s++) {
      const sr = 6 + Math.random() * 22;
      const sp = Math.acos(2 * Math.random() - 1);
      const st = Math.random() * Math.PI * 2;
      const sm = new THREE.Mesh(GS, Math.random() < 0.28 ? MM.purp : MM.sat);
      sm.scale.setScalar(0.35 + Math.random() * 0.95);
      sm.position.set(cx + sr * Math.sin(sp) * Math.cos(st), cy + sr * Math.sin(sp) * Math.sin(st), cz + sr * Math.cos(sp));
      sm.userData = { bp: sm.position.clone(), off: Math.random() * Math.PI * 2 };
      macGroup.add(sm); macNodes.push(sm); loc.push(sm);
    }

    // Intra-cluster links
    for (let i = 0; i < loc.length; i++) for (let j = i + 1; j < loc.length; j++) {
      if (loc[i].position.distanceTo(loc[j].position) < 28 && (i === 0 || j === 0 || Math.random() < 0.3)) {
        const g = new THREE.BufferGeometry().setFromPoints([loc[i].position.clone(), loc[j].position.clone()]);
        macGroup.add(new THREE.Line(g, MM.line));
        macLinks.push({ a: loc[i], b: loc[j], geo: g });
      }
    }
  }

  // ── Protocol spawn-weight bias ──────────────────────────────────────
  (function applyProtocolSpawnBias() {
    const proto = protocolState.activeProtocol;
    if (!proto?.spawnWeights) return;
    const sw = proto.spawnWeights;
    function pickBias() {
      const entries = Object.entries(sw);
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let roll = Math.random() * total;
      for (const [key, w] of entries) { roll -= w; if (roll <= 0) return key; }
      return entries[entries.length - 1][0];
    }
    G.l3Clusters.forEach(cl => {
      if (Math.random() > 0.55) return;
      const bias = pickBias();
      cl._archetypeBias = bias;
      switch (bias) {
        case 'dormant':
          cl._dormant = true;
          break;
        case 'spine_node':
          cl.syncCooldown = Math.max(TUNING.syncWindowCooldownMin, cl.syncCooldown * (0.72 + Math.random() * 0.16));
          cl._protoSpineBoost = true;
          break;
        case 'temporal_anchor':
          cl._syncWindowMult = Math.min(1.55, 1.0 + (sw.temporal_anchor - 1.0) * 0.38);
          break;
        case 'phantom':
          cl.syncCooldown *= 0.80 + Math.random() * 0.65;
          cl.syncCooldown = Math.min(TUNING.syncWindowCooldownMax * 1.15, Math.max(TUNING.syncWindowCooldownMin, cl.syncCooldown));
          cl._phantomBias = true;
          break;
      }
    });
  })();

  // ── Highway links between cores (per-link materials) ─────────────────
  for (let i = 0; i < macCores.length; i++) {
    const sorted = [...macCores]
      .map((n, idx) => ({ n, idx, d: n.position.distanceTo(macCores[i].position) }))
      .filter(e => e.idx !== i)
      .sort((a, b) => a.d - b.d);
    const nh = Math.random() < 0.5 ? 2 : 1;
    for (let k = 0; k < nh && k < sorted.length; k++) {
      if (sorted[k].d < 230 && !macLinks.some(l => (l.a === macCores[i] && l.b === sorted[k].n) || (l.b === macCores[i] && l.a === sorted[k].n))) {
        const g = new THREE.BufferGeometry().setFromPoints([macCores[i].position.clone(), sorted[k].n.position.clone()]);
        const hwMat = new THREE.LineBasicMaterial({ color: 0xaa44ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
        macGroup.add(new THREE.Line(g, hwMat));
        macLinks.push({ a: macCores[i], b: sorted[k].n, geo: g, isHighway: true, coreA: i, coreB: sorted[k].idx, hwMat });
        hwMats.push(hwMat);
      }
    }
  }

  // ── Fade-in (enrolled in _TIMERS as 'l3fade') ────────────────────────
  let op = 0;
  const fi = setInterval(() => {
    op = Math.min(1, op + 0.012);
    MM.core.opacity = MM.sat.opacity = MM.purp.opacity = MM.fuse.opacity = MM.spine.opacity = op;
    MM.line.opacity = op * 0.35;
    hwMats.forEach(m => m.opacity = op * 0.55);
    if (op >= 1) {
      clearInterval(fi);
      clearTimer('l3fade');
      initL3HUD();
    }
  }, 30);
  regTimer('l3fade', fi, 'interval');

  // ── Elite assignment + strategic projects ─────────────────────────────
  assignEliteClusters(G.l3Clusters);
  initStrategicProjects(restoring);

  // ── Protocol HUD chip ────────────────────────────────────────────────
  if (protocolState.activeProtocol) {
    showProtocolChip(protocolState.activeProtocol);
    const _proto = protocolState.activeProtocol;
    const _lang  = getLang();
    regTimer('l3ProtocolHintShow', setTimeout(() => {
      if (_proto) {
        const _label = _lang === 'de' ? _proto.tagDe : _proto.tagEn;
        const _hook  = _lang === 'de' ? _proto.hookDe : _proto.hookEn;
        setNowAction('event', '◈ ' + _label + ' · ' + _hook, 'now-info');
        regTimer('l3ProtocolHintClear', setTimeout(() => {
          clearNowAction('event');
          clearTimer('l3ProtocolHintClear');
        }, 5000), 'timeout');
      }
      clearTimer('l3ProtocolHintShow');
    }, 2000), 'timeout');
  }

  // ── Layer condition selection ─────────────────────────────────────────
  regTimer('l3ConditionSelect', setTimeout(() => {
    if (getActiveConditionId()) {
      clearTimer('l3ConditionSelect');
      return;
    }
    const cond = selectLayerCondition();
    if (cond) {
      conditionState.activeCondition = cond;
      conditionState.activeConditionId = cond.id || null;
      cond.apply?.();
    }
    clearTimer('l3ConditionSelect');
  }, 3000), 'timeout');
}


// ═══════════════════════════════════════════════════════════════════════════
//  HUD
// ═══════════════════════════════════════════════════════════════════════════

function initL3HUD() {
  initL3HUDUI(G.l3Clusters, G.l3Objectives || []);
  showToast('SCHICHT 3 AKTIV', 'Cluster stehen bereit — Pulse übernehmen, Paare verbinden', 4000);
  initL3ClusterTooltipsUI({
    getCluster: idx => G.l3Clusters?.[idx],
    getTemporalState: () => eliteState.temporalAnchor,
  });
  updateActiveProjectsHud();
}

export function updateL3ClusterHUD() {
  macLinks.forEach(lk => {
    if (!lk.isHighway) return;
    const ca = G.l3Clusters[lk.coreA], cb = G.l3Clusters[lk.coreB];
    if (lk.hwMat) {
      lk.hwMat.color.setHex(ca?.captured && cb?.captured ? 0xffcc44 : 0xaa44ff);
      lk.hwMat.opacity = ca?.captured && cb?.captured ? 0.85 : 0.55;
    }
  });

  updateL3ClusterHUDUI({
    clusters: G.l3Clusters,
    capturedCount: G.l3CapturedClusters,
    spineNodes: G.spineNodes,
    spineLength: G.spineLength,
    fusedPairs: G.fusedPairs,
    macLinks,
  });
}

function updateL3ObjPanel() {
  updateL3ObjectivesUI(G.l3Objectives || []);
}


// ═══════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

export function countConnectedCorePairs() {
  let count = 0;
  macLinks.forEach(lk => {
    if (!lk.isHighway) return;
    const ca = G.l3Clusters[lk.coreA], cb = G.l3Clusters[lk.coreB];
    if (ca?.captured && cb?.captured) count++;
  });
  G.l3ConnectedCores = count;
  return count;
}

const _spineCache = { capturedKey: '', length: 0, nodes: new Set() };

function computeSpineLength() {
  const capturedIds = G.l3Clusters.filter(cl => cl.captured).map(cl => cl.id);
  if (!capturedIds.length) {
    G.spineNodes = new Set();
    _spineCache.capturedKey = '';
    _spineCache.length = 0;
    _spineCache.nodes = new Set();
    return 0;
  }

  const cacheKey = capturedIds.join('-');
  if (_spineCache.capturedKey === cacheKey) {
    G.spineNodes = new Set(_spineCache.nodes);
    return _spineCache.length;
  }

  const adjacency = new Map();
  capturedIds.forEach(id => adjacency.set(id, []));
  macLinks.forEach(lk => {
    if (!lk.isHighway) return;
    const a = lk.coreA;
    const b = lk.coreB;
    if (!G.l3Clusters[a]?.captured || !G.l3Clusters[b]?.captured) return;
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  });

  const bfsFrom = start => {
    const dist = {};
    const parent = {};
    capturedIds.forEach(id => { dist[id] = -1; parent[id] = null; });
    dist[start] = 0;
    const queue = [start];
    let farthest = start;
    while (queue.length) {
      const cur = queue.shift();
      if (dist[cur] > dist[farthest]) farthest = cur;
      (adjacency.get(cur) || []).forEach(next => {
        if (dist[next] !== -1) return;
        dist[next] = dist[cur] + 1;
        parent[next] = cur;
        queue.push(next);
      });
    }
    return { farthest, dist, parent };
  };

  const first = capturedIds[0];
  const { farthest: f1 } = bfsFrom(first);
  const { farthest: f2, dist, parent } = bfsFrom(f1);
  const maxD = dist[f2] >= 0 ? dist[f2] : 0;
  const spineSet = new Set();
  let cursor = f2;
  while (cursor != null) {
    spineSet.add(cursor);
    cursor = parent[cursor];
  }

  G.spineNodes = spineSet;
  _spineCache.capturedKey = cacheKey;
  _spineCache.length = maxD + 1;
  _spineCache.nodes = new Set(spineSet);
  return maxD + 1;
}

export function checkSpine() {
  if (!G.l3On) return;
  _spineCache.capturedKey = '';
  const len = computeSpineLength();
  G.spineLength = len;

  if (len >= 4 && !G.backboneActive) {
    G.backboneActive = true;
    G.spineBonusActive = true;
    logTL('structure', 'Backbone aktiviert', 'rgba(255,160,40,.85)', '⬟');
    showToast('BACKBONE AKTIV', 'Kerne synchronisieren sich selbst — fokus auf Außencluster', 4000);
    agentOnBackbone?.();
    spawnShock(0xff9900);
    spawnShock(0xffcc44);
    checkL3Objectives();
  } else if (len >= 3 && !G.spineBonusActive) {
    G.spineBonusActive = true;
    logTL('structure', 'Spine ×' + len + ' aktiv', 'rgba(255,210,60,.7)', '⬟');
    G.pulseCd = Math.round(TUNING.pulseCd * 0.52);
    const archBonus = PROFILE_BONUS?.architect?.spineBonusScale || 0;
    const linearBonus = traitState.linearThinking ? 0.04 : 0;
    const backboneMasterBonus = traitState.backboneMaster ? 0.03 : 0;
    const totalBonus = archBonus + linearBonus + backboneMasterBonus;
    if (totalBonus > 0) {
      const cdReduction = Math.round(TUNING.pulseCd * (0.52 + totalBonus));
      G.pulseCd = Math.max(800, TUNING.pulseCd - cdReduction);
      const cdPct = Math.round((1 - G.pulseCd / TUNING.pulseCd) * 100);
      showToast('SPINE AKTIV ⬟', `Pulse-Cooldown −${cdPct}% · Bonus aktiv`, 3200);
    } else {
      showToast('SPINE AKTIV', 'Pulse-Cooldown −48% · Feuerrhythmus erhöht', 3200);
    }
    agentOnSpine?.();
    spawnShock(0xffaa44);
    checkL3Objectives();
  } else if (len < 3 && G.spineBonusActive) {
    G.spineBonusActive = false;
    G.backboneActive = false;
    G.pulseCd = TUNING.pulseCd;
  }
}

export function tryFusion(idA, idB) {
  const key = `${Math.min(idA, idB)}-${Math.max(idA, idB)}`;
  if (G.fusedPairs.has(key)) return false;
  const connected = macLinks.some(lk => lk.isHighway && ((lk.coreA === idA && lk.coreB === idB) || (lk.coreA === idB && lk.coreB === idA)));
  if (!connected) return false;
  if (G.backboneActive && G.spineNodes && (G.spineNodes.has(idA) || G.spineNodes.has(idB))) {
    showToast('FUSION BLOCKIERT', 'Backbone-Spine-Node kann nicht fusioniert werden', 2000);
    return false;
  }

  G.fusedPairs.add(key);
  agentOnFusion?.();
  const fusionXPBonus = traitState.fusionXP && G.fusedPairs.size === 1 ? 15 : 0;
  const volatileFusionMult = traitState.volatile ? 1.12 : 1.0;
  const quantumBonus = (upgradeState.quantumSpine && G.spineLength >= 2) ? 20 : 0;
  const burst = Math.round((60 + G.l3CapturedClusters * 8 + (PROFILE_BONUS?.mnemonic?.fusionBurst || 0) + fusionXPBonus + quantumBonus) * volatileFusionMult);
  if (fusionXPBonus > 0) traitState.fusionXP = false;
  if (aiState) aiState.burstEvents += 2;
  G.energy += burst;
  showToast(`FUSION C${idA + 1}↔C${idB + 1}`, `+${burst}⬡ · Sync-Fenster jetzt gekoppelt!`, 3400);
  spawnShock(0xff6600);
  spawnShock(0xffbb00);
  spawnShock(0xff8800);

  [idA, idB].forEach(id => {
    if (!macCores[id]) return;
    macCores[id].material = MM.fuse;
    macCores[id].scale.setScalar(macCores[id].scale.x * 1.55);
  });
  macLinks.forEach(lk => {
    if (!lk.isHighway) return;
    if ((lk.coreA === idA && lk.coreB === idB) || (lk.coreA === idB && lk.coreB === idA)) {
      if (lk.hwMat) { lk.hwMat.color.setHex(0xff8800); lk.hwMat.opacity = 1.0; }
    }
  });
  checkL3Objectives();
  signalLayer3Changed();
  return true;
}

export function captureOpenClusters() {
  if (G.runWon) return 0;
  let captured = 0;
  const newlyCaptured = [];

  G.l3Clusters.forEach((cl, i) => {
    if (!cl.syncWindowOpen) return;
    if (!cl.captured) {
      cl.captured = true;
      G.l3CapturedClusters++;
      newlyCaptured.push(i);
      checkProjectTriggers();

      if (cl._eliteActive && cl._eliteDef) {
        cl._eliteActive = false;
        cl._eliteDef.onCapture(i);
        if (traitState.eliteVeteran && (traitState.eliteVeteranCaptureBonus || 0) > 0) {
          G.energy += traitState.eliteVeteranCaptureBonus;
          traitState.eliteVeteranCaptureBonus = 0;
          const lang = getLang();
          showToast('★ ELITE-VETERAN', lang === 'de' ? '+20⬡ Veteranen-Bonus' : '+20⬡ veteran bonus', 1800);
        }
      }

      const newCap = G.l3CapturedClusters;
      const passiveGain = newCap * TUNING.l3PassiveGain;
      // Cold Loop — immediate +30⬡ bonus on each capture
      const coldLoopBonus = traitState.coldLoop ? 30 : 0;
      if (coldLoopBonus > 0) {
        G.energy += coldLoopBonus;
        if (typeof spawnShock === 'function') spawnShock(0x44ddff);
      }

      if (upgradeState.chainCapture) {
        const cdReduction = upgradeState.chainCaptureCd || 1500;
        G.pulseCd = Math.max(400, G.pulseCd - cdReduction);
        TUNING.pulseCd = Math.max(400, TUNING.pulseCd - cdReduction);
      }

      showToast(`CLUSTER C${i + 1} ÜBERNOMMEN`, `Passiv +${passiveGain}⬡/${TUNING.l3PassiveTick}s · ${newCap}/8${coldLoopBonus ? ` · Kalte Schleife +${coldLoopBonus}⬡` : ''}`, 2400);
      logTL('cluster', `C${i + 1} übernommen · ${newCap}/8 · +${passiveGain}⬡/t`, 'rgba(100,255,170,.7)', '✓');
      if (window._metaObj_captureTimestamps) window._metaObj_captureTimestamps.push(Date.now());
      window.checkMetaObjectives?.();
      spawnShock(0x44ff99);
      // FIX 3.3: Milestone-based draft triggers
      const cap = G.l3CapturedClusters;
      if (cap === 1 || cap === 4 || cap === 7) {
        setTimeout(() => triggerMilestoneDraft?.(`C${cap} captured`), 1200);
      }
      // FIX 2.5: Boss warning at 6 clusters — visual + audio tension buildup
      if (cap === 6) triggerBossWarning();
      if (cap === 7) triggerBossWarning2();
    } else {
      const volatileMult = traitState.volatile ? 1.12 : 1.0;
      const burst = Math.round((30 + G.l3CapturedClusters * 5 + (PROFILE_BONUS?.predator?.burstBonus || 0)) * volatileMult);
      G.energy += burst;
      if (aiState) aiState.burstEvents++;
      showToast(`RESYNC C${i + 1}`, `+ ${burst} ⬡ Burst`, 1800);
      spawnShock(0xffcc44);
    }

    cl.syncWindowOpen = false;
    cl.syncReady = false;
    cl.lastSyncOpen = -999;
    captured++;
  });

  if (newlyCaptured.length >= 2) {
    for (let a = 0; a < newlyCaptured.length; a++) {
      for (let b = a + 1; b < newlyCaptured.length; b++) {
        tryFusion(newlyCaptured[a], newlyCaptured[b]);
      }
    }
  }
  if (newlyCaptured.length > 0) {
    checkSpine();
    checkSpineAlmost();
  }

  if (captured > 0) {
    if (aiState) aiState.syncHits += captured;
    G.l3MacroPulseCount++;
    hideSyncOverlay();
    onSyncCapture();
    const stillOpen = G.l3Clusters.filter(cluster => cluster.syncWindowOpen && !cluster.captured);
    if (stillOpen.length > 0) setNowAction('sync', '⟳ SYNC-FENSTER — PULSE JETZT!', 'now-sync');
    checkL3Objectives();
    signalLayer3Changed();
  }
  return captured;
}

export function checkSpineAlmost() {
  if (!G.spineBonusActive && G.spineLength >= 3) agentOnSpine?.();
}

export function checkL3Objectives() {
  if (G.runWon) return;
  const objectives = G.l3Objectives || [];
  const cap = G.l3Clusters.filter(cluster => cluster.captured).length;
  const pairs = countConnectedCorePairs();
  const checks = {
    capture1: cap >= 1,
    capture4: cap >= 4,
    syncWindow: G.l3Clusters.some(cluster => cluster.syncWindowOpen),
    coreConn2: pairs >= 2,
    coreBonus: G.l3BonusActive,
    spine3: G.spineLength >= 3,
    backbone4: G.spineLength >= 4,
    fusion1: G.fusedPairs.size >= 1,
    allClusters: cap >= 8,
  };

  let changed = false;
  objectives.forEach(entry => {
    if (!entry.done && checks[entry.id]) {
      entry.done = true;
      changed = true;
      const _l3lang = getLang();
      const _l3toastTitle = _l3lang === 'de' ? 'MAKRO-ZIEL ✓' : 'MACRO OBJECTIVE ✓';
      const _l3label = (_l3lang !== 'de' && entry.labelEN) ? entry.labelEN : entry.label;
      showToast(_l3toastTitle, _l3label.replace(/^[^\s]+ /, ''), 3000);
      spawnShock(0x44ff99);
    }
  });
  if (changed) {
    updateL3ObjPanel();
    signalLayer3Changed();
  }

  if (cap >= 8 && !G.runWon) {
    const spine   = G.spineLength;
    const fusions = G.fusedPairs.size;
    // FIX P2: same Phantom/Temporal Tier-3 paths as boss.js
    const clusters = G.l3CapturedClusters || 0;
    if (spine >= 4 || clusters >= 8) G.winTier = 3;
    else if (spine >= 3 || fusions >= 1) G.winTier = 2;
    else G.winTier = 1;
    if (!bossState.bossTriggered) regTimer('bossIntroDefer', setTimeout(() => {
      clearTimer('bossIntroDefer');
      triggerBossIntro();
    }, 800), 'timeout');
  }
}


// ═══════════════════════════════════════════════════════════════════════════
//  SYNC DECAY BAR  (M-01: own cancelable RAF)
// ═══════════════════════════════════════════════════════════════════════════

let _syncDecayRaf   = null;
let _syncDecayStart = 0;
let _syncDecayDur   = 0;
let _syncDecayFusion = false;

export function startSyncDecayBar(dur, isFusion) {
  _syncDecayStart = Date.now();
  _syncDecayDur = dur;
  _syncDecayFusion = isFusion;
  startSyncDecayBarUI(dur, isFusion);
}

export function stopSyncDecayBar() {
  stopSyncDecayBarUI();
  if (_syncDecayRaf) { cancelAnimationFrame(_syncDecayRaf); _syncDecayRaf = null; }
}


// ═══════════════════════════════════════════════════════════════════════════
//  PER-FRAME ANIMATION
// ═══════════════════════════════════════════════════════════════════════════

export function animateLayer3(t, dt) { // eslint-disable-line no-unused-vars
  if (!G.l3On) return;
  const gameActive = !G.runWon;

  // ── Animate macro nodes ────────────────────────────────────────────────
  macNodes.forEach(n => {
    const d = n.userData;
    n.position.x = d.bp.x + Math.sin(t * 0.3  + d.off) * 0.9;
    n.position.y = d.bp.y + Math.cos(t * 0.25 + d.off) * 0.9;
    n.position.z = d.bp.z + Math.sin(t * 0.38 + d.off) * 0.9;
  });

  // ── Update link geometry (pre-allocated BufferAttribute, PERF-004) ─────
  // geo.setAttribute is called only on first encounter (lazy-init); after that
  // we only touch the typed array values and flip needsUpdate. This avoids
  // the internal Map lookup inside BufferGeometry.setAttribute every frame.
  for (let li = 0; li < macLinks.length; li++) {
    const l = macLinks[li];
    if (!l._posArr) {
      l._posArr  = new Float32Array(6);
      l._posAttr = new THREE.BufferAttribute(l._posArr, 3);
      l.geo.setAttribute('position', l._posAttr);  // once only
    }
    const p = l._posArr;
    p[0]=l.a.position.x; p[1]=l.a.position.y; p[2]=l.a.position.z;
    p[3]=l.b.position.x; p[4]=l.b.position.y; p[5]=l.b.position.z;
    l._posAttr.needsUpdate = true;
  }

  // ── Base emissive animation + macGroup rotation ────────────────────────
  MM.core.emissiveIntensity = 2.5 + Math.sin(t * 1.4) * 0.7;
  MM.purp.emissiveIntensity = 2.2 + Math.sin(t * 1.7 + 1) * 0.6;
  macGroup.rotation.y = t * 0.012;

  // ── Cluster sync window logic ──────────────────────────────────────────
  if (gameActive) G.l3Clusters.forEach((cl, i) => {
    const sinceLastOpen = t - cl.lastSyncOpen;
    const cd = cl.syncCooldown;
    const phase = sinceLastOpen % cd;
    // FIX 3.2: Grid Lock synergy — extend sync window duration by 2s
    const gridLockBonus = synergyState.gridLock ? 2 : 0;
    const windowDur = (bossState.bossP3SyncNerf ? G.l3SyncWindowDur * 0.5 : G.l3SyncWindowDur + gridLockBonus)
                    * (cl._syncWindowMult || 1.0);
    const warnDur = 3 + (PROFILE_BONUS.analyst?.warnPhaseBonus || 0);

    if (phase >= cd - windowDur - warnDur && phase < cd - windowDur) {
      if (!cl.syncReady && !cl.syncWindowOpen) {
        cl.syncReady = true; cl.syncWindowOpen = false;
        // v95: Urgent 5s pre-warning — visual + audio cue
        const warnPct = Math.max(0, Math.min(1, (phase - (cd - windowDur - warnDur)) / warnDur));
        if (warnPct < 0.3 && macCores[i]) {
          // Pulse core color increasingly red as window approaches
          const warnColor = new THREE.Color(0.2 + warnPct * 0.8, 0.1, 0.6 - warnPct * 0.5);
          if (macCores[i].mat) macCores[i].mat.emissive?.copy?.(warnColor);
        }
        try {
          SFX?.syncWarn?.();
        } catch(err) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[Synapse] syncWarn error', err);
        }
      }
    } else if (phase >= cd - windowDur && phase < cd) {
      if (!cl.syncWindowOpen && !eventMods.syncLocked) {
        cl.syncWindowOpen = true;
        agentOnSyncOpen?.();
        cl.syncReady = false;
        cl.lastSyncOpen = t - (phase - (cd - windowDur));

        // Fusion: open partner window simultaneously
        // Iterate directly over the Set — no [...spread] or .map(Number) allocation
        let fusionPartner = -1;
        for (const key of G.fusedPairs) {
          const dash = key.indexOf('-');
          const ka = +key.slice(0, dash), kb = +key.slice(dash + 1);
          if (ka === i) { fusionPartner = kb; break; }
          if (kb === i) { fusionPartner = ka; break; }
        }
        if (fusionPartner >= 0) {
          const partner = G.l3Clusters[fusionPartner];
          if (partner && !partner.syncWindowOpen) {
            partner.syncWindowOpen = true; partner.syncReady = false; partner.lastSyncOpen = t;
            setNowAction('sync', '⟳ FUSION-SYNC — PULSE JETZT!', 'now-sync');
            SFX.syncReady?.();
          }
          showSyncOverlay(cl, i, windowDur, true);
        } else {
          showSyncOverlay(cl, i, windowDur, false);
        }

        // Backbone: schedule auto-capture for spine nodes
        if (G.backboneActive && G.spineNodes?.has(i)) {
          const autoDelay = windowDur * 0.55 * 1000;
          regTimer(`l3BackboneAuto-${i}`, setTimeout(() => {
            if (cl.syncWindowOpen && !G.runWon && G.backboneActive) {
              if (!cl.captured) {
                cl.captured = true;
                G.l3CapturedClusters++;
                showToast('AUTO-SYNC C'+(i+1), 'Backbone hält die Linie · '+G.l3CapturedClusters+'/8', 2000);
                spawnShock(0xff9900);
              } else {
                const burst = 20 + G.l3CapturedClusters * 3
                  + (PROFILE_BONUS.predator?.burstBonus||0)
                  + (traitState.huntInstinct ? 5 : 0)
                  + (PROFILE_BONUS.architect?.backboneBonus||0);
                const silentSpineMult = traitState.silentSpine ? 1.35 : 1.0;
                const finalBurst = Math.round(burst * silentSpineMult);
                G.energy += finalBurst;
                accumulateMemoryCache(finalBurst);
                checkProjectTriggers();
                showToast('BACKBONE RESYNC C'+(i+1), '+'+finalBurst+'⬡'+(traitState.silentSpine?' · Stille Wirbelsäule ×1.35':''), 1400);
                spawnShock(0xffcc44);
              }
              cl.syncWindowOpen = false; cl.syncReady = false; cl.lastSyncOpen = -999;
              hideSyncOverlay();
              checkL3Objectives();
              signalLayer3Changed();
            }
            clearTimer(`l3BackboneAuto-${i}`);
          }, autoDelay), 'timeout');
        }
        checkL3Objectives();
      }
      updateSyncBar(1 - (phase - (cd - windowDur)) / windowDur);
    } else {
      // Pre-sync warning: increasingly urgent pulse ring 5s before open
      if (cl.syncReady && !cl.syncWindowOpen && macCores[i]) {
        const warnFreq = 3.0 + (phase / (cd - windowDur - warnDur)) * 5.0;
        const warnPulse = 0.5 + Math.abs(Math.sin(t * warnFreq)) * 0.5;
        if (macCores[i].mat?.emissiveIntensity !== undefined) {
          macCores[i].mat.emissiveIntensity = 1.2 + warnPulse * 2.5;
        }
      }
      if (cl.syncWindowOpen) {
        if (!cl.captured) {
          showMissedSync();
          // v96: Notify AI of missed sync
          if (typeof window.agentOnSyncMissed === 'function') window.agentOnSyncMissed();
        }
        cl.syncWindowOpen = false; cl.syncReady = false;
        hideSyncOverlay();
      } else if (cl.syncReady) {
        cl.syncReady = false;
      }
    }

    // Captured cluster material animation
    if (cl.captured && macCores[i]) {
      // isFused: direct Set iteration — no spread/split/map allocation per frame
      let isFused = false;
      for (const key of G.fusedPairs) {
        const dash = key.indexOf('-');
        if (+key.slice(0, dash) === i || +key.slice(dash + 1) === i) { isFused = true; break; }
      }
      const isSpine = G.spineNodes?.has(i) && G.spineLength >= 3;
      if (cl._dormant) {
        _setCoreMaterial(macCores[i], MM.purp);
        MM.purp.emissiveIntensity = 0.5 + Math.sin(t * 0.6 + i) * 0.2;
      } else if (isFused) {
        _setCoreMaterial(macCores[i], MM.fuse);
        MM.fuse.emissiveIntensity = 5.5 + Math.sin(t * 3.2 + i) * 1.5;
      } else if (isSpine) {
        _setCoreMaterial(macCores[i], MM.spine);
        MM.spine.emissiveIntensity = 4.2 + Math.sin(t * 2.4 + i) * 1.0;
      } else {
        macCores[i].material.emissiveIntensity = 4.5 + Math.sin(t * 2 + i) * 0.8;
      }
    }
    // syncReady 3D cue: uncaptured cluster pulses amber (F-003 FIX)
    if (!cl.captured && cl.syncReady && macCores[i]) {
      _setCoreEmissiveHex(macCores[i], 0xffcc44);
      macCores[i].material.emissiveIntensity = 1.8 + Math.sin(t * 4 + i) * 0.9;
    } else if (!cl.captured && !cl.syncWindowOpen && macCores[i]) {
      _setCoreEmissiveHex(macCores[i], 0xaa44ff);
      macCores[i].material.emissiveIntensity = 2.2 + Math.sin(t * 1.7 + i) * 0.6;
    }
  });

  // ── Passive energy tick from captured clusters ─────────────────────────
  // FIX 4.1: Spine Protocol — backbone accrues energy passively every tick (no Pulse needed)
  if (gameActive && protocolState.activeProtocol?.modifiers?.spinePassiveTick && G.spineLength >= 2) {
    const spineGain = G.spineLength * 1.5;
    if (t - (G._spinePassiveLast || 0) > 4) {
      G._spinePassiveLast = t;
      G.energy += Math.round(spineGain);
      signalLayer3Changed();
    }
  }

  // FIX 4.1: Mnemonic — show Tap Memory button when memory nodes exist
  if (gameActive && protocolState.activeProtocol?.modifiers?.mnemonicTapEnabled) {
    const tapBtn = document.getElementById('btn-tap-memory');
    if (tapBtn) {
      const hasMemory = (typeof gameNodes !== 'undefined') && gameNodes.some(n => n.type === 'memory' && (n.memCharge || 0) > 5);
      tapBtn.style.display = hasMemory ? '' : 'none';
    }
  }

  if (gameActive && t - G.l3SyncTick > TUNING.l3PassiveTick) {
    G.l3SyncTick = t;
    // G.l3CapturedClusters is kept in sync on every capture — no filter() needed
    const cap = G.l3CapturedClusters;
    if (cap > 0) {
      const _nsPassBoost = (eventMods.neuroStorm && (eventMods.neuroStormPassiveBoost||1) > 1)
        ? (eventMods.neuroStormPassiveBoost||1) : 1.0;
      let gain = cap * TUNING.l3PassiveGain * _nsPassBoost;
      if (aiState.emergenceActive) gain = Math.round(gain * 1.11);
      if (upgradeState.resonPassive) {
        const resonLinks = getLinkTypeCounts().resonance || 0;
        gain += resonLinks * upgradeState.resonPassive * TUNING.l3PassiveTick;
      }
      if (upgradeState.fragileClusterBonus) {
        const hasFragile = (getLinkTypeCounts().fragile || 0) > 0;
        if (hasFragile) gain += upgradeState.fragileClusterBonus * cap;
      }
      if (upgradeState.gamblerMod) {
        if (G.energy < 20) gain = 0;
        else if (G.energy > 60) gain = Math.round(gain * 2.5);
      }
      gain = applyEventEnergyMult(gain);
      if ((PROFILE_BONUS.architect?.macroCouplingRange||0) > 0) gain += Math.floor(cap * PROFILE_BONUS.architect.macroCouplingRange);
      const connectedPairs = countConnectedCorePairs();
      if (connectedPairs >= 2 && cap >= 2) {
        const bonus = connectedPairs * cap * 2 + Math.round(PROFILE_BONUS.architect?.backboneBonus||0);
        gain += bonus;
        if (!G.l3BonusActive) {
          G.l3BonusActive = true;
          triggerLayer3BonusFlashUI(1200);
          showToast('VERBINDUNGSBONUS', '×'+connectedPairs+' Kern-Paar · +'+bonus+'⬡', 2400);
          checkL3Objectives();
        }
      } else {
        G.l3BonusActive = false;
      }
      // FIX 3.1: Deep Geometry — stable links give +0.5⬡ per passive tick
      if (upgradeState.deepGeometry) {
        const stableLinks = (typeof getLinkTypeCounts === 'function') ? (getLinkTypeCounts().stable || 0) : 0;
        gain += stableLinks * 0.5 * TUNING.l3PassiveTick;
      }

      G.energy += gain;
      signalLayer3Changed();
    }
  }

  // ── Elite cluster tick ─────────────────────────────────────────────────
  if (gameActive) {
    G.l3Clusters.forEach((cl, i) => {
      if (!cl._eliteType || !cl._eliteDef) {
        // FIX 1.4: Silent elite spawn failure — log in dev for debugging
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[Elite] Activation skipped — _eliteDef is null for cluster', i);
        return;
      }
      if (cl.syncWindowOpen && !cl._eliteActive && !cl.captured) {
        cl._eliteActive = true;
        cl._eliteDef.onActivate(i);
        logTL('elite', `Elite: ${cl._eliteDef.name}`, 'rgba(255,180,80,.75)', '◈');
      }
      if (cl._eliteType === 'temporal_anchor' && cl._eliteActive) {
        const _taState = eliteState.temporalAnchor;
        if (_taState && !_taState.reverted && (Date.now() - _taState.startTime)/1000 > cl._eliteDef.captureWindow) {
          cl._eliteDef.onTimeout(i); cl.captured = true;
        }
      }
      if (cl._eliteType === 'mirror_relay' && cl._eliteActive) {
        const state = eliteState.mirrorRelay;
        if (state && !state.failed && t - state.startTime > cl._eliteDef.captureWindow && !cl.captured) {
          cl._eliteActive = false; cl._eliteDef.onTimeout(i);
        }
      }
      if (cl._eliteType === 'dormant_fortress' && cl._eliteActive) {
        const state = eliteState.dormantFortress;
        if (state && !cl.syncWindowOpen && !cl.captured) { cl._eliteActive = false; cl._eliteDef.onFailure(i); }
      }
      if (cl._eliteType === 'void_anchor' && cl._eliteActive) {
        const state = eliteState.voidAnchor;
        if (state && !state.failed && t - state.startTime > cl._eliteDef.captureWindow && !cl.captured) {
          cl._eliteActive = false; cl._eliteDef.onTimeout(i);
        }
      }
      if (cl._eliteType === 'phantom_nexus' && cl._eliteActive) {
        const state = eliteState.phantomNexus;
        if (state && !state.failed && !state.captured && t - state.startTime > cl._eliteDef.captureWindow && !cl.captured) {
          cl._eliteActive = false; cl._eliteDef.onTimeout(i);
        }
      }
    });

    // Signal Noise: recover sync window duration
    if (gameplayFlags.eliteCaptureSignalNoiseDur > 0) {
      const noiseElapsed = t - (gameplayFlags.eliteCaptureSignalNoiseStart||0);
      if (noiseElapsed >= gameplayFlags.eliteCaptureSignalNoiseDur) {
        G.l3SyncWindowDur = Math.min(TUNING.syncWindowDuration, G.l3SyncWindowDur + 0.4);
        gameplayFlags.eliteCaptureSignalNoiseDur = 0;
      }
    }

    // Dormant Fortress pulse penalty recovery
    if (gameplayFlags.eliteCapturePulsePenaltyEnd && t >= gameplayFlags.eliteCapturePulsePenaltyEnd) {
      G.pulseCost = Math.max(TUNING.pulseCost, G.pulseCost - 5);
      gameplayFlags.eliteCapturePulsePenaltyEnd = null;
      const lang = getLang();
      showToast('PULSE-PENALTY ENDET', lang==='de'?'Kosten normalisiert':'Cost normalized', 1600);
    }
  }

  // ── checkSpine every 5s (BUG-007 FIX) ─────────────────────────────────
  if (gameActive && (!G._lastSpineCheck || t - G._lastSpineCheck > 5)) {
    G._lastSpineCheck = t;
    checkSpine();
  }
}


// ── Backwards-compat globals ────────────────────────────────────────────────
window._initL3                          = initLayer3;
window._tickL3                          = animateLayer3;
window._startSyncDecayBar               = startSyncDecayBar;
window._stopSyncDecayBar                = stopSyncDecayBar;
window._updateL3ClusterHUD              = updateL3ClusterHUD;
window._updateL3ObjPanel                = updateL3ObjPanel;
window._accumulateMemoryCache           = accumulateMemoryCache;
window._checkProjectTriggers            = checkProjectTriggers;
window._applyEchoBeaconEliteBoost       = applyEchoBeaconEliteBoost;
window._applyBackboneRelayBossBonus     = applyBackboneRelayBossBonus;
window._applyMemoryCacheDischargeBonus  = applyMemoryCacheDischargeBonus;
window._getEchoBeaconRareBonus          = getEchoBeaconRareBonus;
window._countConnectedCorePairs         = countConnectedCorePairs;
window.captureOpenClusters            = captureOpenClusters;
window.checkL3Objectives              = checkL3Objectives;
window.checkSpine                     = checkSpine;
window.tryFusion                      = tryFusion;
window.logTL                          = window.logTL || (() => {}); // compat stub: layer3 imports logTL directly, this guards against stray callers
