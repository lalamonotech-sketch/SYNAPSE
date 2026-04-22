/**
 * SYNAPSE v95 — Event system
 * Phase G migration pass.
 *
 * This is a production-safe baseline port:
 *   - shared G_EVENT runtime state
 *   - core event modifiers
 *   - timed random event triggering
 *   - per-frame event ticking + cleanup
 *   - energy multiplier bridge used by layer3 passive gains
 *
 * The rare chain/meta-event superstructure from v89 is intentionally trimmed in
 * this pass; counters and fields remain so save/load and later migrations stay
 * compatible.
 */

import { G } from '../state/gameState.js';
import { eventMods, gameplayFlags } from '../state/gameplayFlags.js';
import { gameNodes, spawnShock } from '../layers/network/index.js';
import { clock } from '../engine/scene.js';
import { showEventBanner, hideEventBanner, logTL } from '../ui/actionFlow.js';
import { showToast } from '../ui/hud/index.js';
import { signalEnergyChanged } from '../platform/stateSignals.js';
import { G_DRAFT } from '../meta/flow.js';
import { bossState } from '../state/bossShared.js';

function toast(a, b, d) { showToast(a, b, d); }
function shock(c) { spawnShock(c); }
function refresh() { signalEnergyChanged(); }

export const EVENTS = [
  {
    id: 'signal_storm', positive: false, eventClass: 'disruption', rare: false,
    name: 'Signal Storm', desc: 'Passiv-Gains halbiert · Danach Energie-Burst', duration: 12,
    color: 'rgba(255,160,40,.95)',
    onStart() { eventMods.passiveMult = 0.5; },
    onEnd() {
      eventMods.passiveMult = 1.0;
      const burst = 25 + G.l3CapturedClusters * 4;
      G.energy += burst;
      toast('STORM VORBEI', '+' + burst + '⬡ Entladungs-Burst', 2000);
      shock(0xffcc44);
      refresh();
    },
  },
  {
    id: 'energy_surge', positive: true, eventClass: 'boost', rare: false,
    name: 'Energy Surge', desc: 'Alle Energie-Gewinne ×1.6 für 15 s', duration: 15,
    color: 'rgba(80,255,160,.95)',
    onStart() { eventMods.energyMult = 1.6; },
    onEnd() {
      eventMods.energyMult = 1.0;
      toast('SURGE ENDET', 'Energie-Boost abgelaufen', 1600);
      refresh();
    },
  },
  {
    id: 'bonus_window', positive: true, eventClass: 'boost', rare: false,
    name: 'Bonus Capture Window', desc: 'Nächste Cluster-Übernahme gibt ×3 Energie-Burst', duration: 25,
    color: 'rgba(200,255,80,.95)',
    onStart() { eventMods.bonusCapture = true; },
    onEnd() {
      eventMods.bonusCapture = false;
      toast('BONUS ABGELAUFEN', 'Capture-Fenster normal', 1400);
      refresh();
    },
  },
  {
    id: 'overclock_drain', positive: null, eventClass: 'tradeoff', rare: false,
    name: 'Overclock Drain', desc: 'Energie ×1.8 — aber alle 6 s −5⬡ Basis-Drain', duration: 20,
    color: 'rgba(255,200,60,.95)',
    onStart() {
      eventMods.energyMult = 1.8;
      eventMods.drain = 5;
    },
    onEnd() {
      eventMods.energyMult = 1.0;
      eventMods.drain = 0;
      gameplayFlags.overclockDrainTimer = null;
      toast('OVERCLOCK ENDE', 'Drain gestoppt · Boost weg', 1600);
      refresh();
    },
  },
  {
    id: 'fragile_resonance', positive: null, eventClass: 'tradeoff', rare: false,
    name: 'Fragile Resonanz', desc: 'Resonanz-Links ×2.8 Energie · Brechen beim Angriff', duration: 35,
    color: 'rgba(200,100,255,.95)',
    onStart() {
      eventMods.resonanceBoost = true;
      toast('FRAGILE RESONANZ', 'Resonanz-Links maximal aktiv — aber gefährdet!', 2800);
      refresh();
    },
    onEnd() {
      eventMods.resonanceBoost = false;
      toast('RESONANZ NORMAL', 'Boost und Risiko weg', 1600);
      refresh();
    },
  },
  // ── v95: New mid-run global events ─────────────────────────────────────────
  {
    id: 'v95_signal_storm', positive: null, eventClass: 'tradeoff', rare: false,
    name: 'Signal-Sturm', desc: 'Alle Signal-Geschwindigkeiten ×2 für 20s — aber Fragile-Bruchrisiko ×2', duration: 20,
    color: 'rgba(255,120,40,.95)',
    onStart() {
      eventMods.signalSpeedMult = 2.0;
      eventMods.fragileDangerMult = 2.0;
      toast('⚡ SIGNAL-STURM', 'Signale ×2 Geschwindigkeit · Fragile-Links in Gefahr!', 3000);
      shock(0xff6600);
    },
    onEnd() {
      eventMods.signalSpeedMult = 1.0;
      eventMods.fragileDangerMult = 1.0;
      toast('STURM VORBEI', 'Signal-Speed normal · Fragile stabil', 1800);
    },
  },
  {
    id: 'v95_energy_decay', positive: false, eventClass: 'disruption', rare: false,
    name: 'Energie-Zerfall', desc: 'Alle 10s: −5⬡ Basis-Drain für 30s', duration: 30,
    color: 'rgba(100,100,200,.95)',
    onStart() {
      eventMods.decayDrain = 5;
      eventMods.decayInterval = 10;
      toast('▽ ENERGIE-ZERFALL', 'Passiver Drain aktiv − 5⬡ alle 10s', 2500);
    },
    onEnd() {
      eventMods.decayDrain = 0;
      toast('ZERFALL ENDET', 'Energie-Drain gestoppt', 1600);
      refresh();
    },
  },
  {
    id: 'v95_resonance_window', positive: true, eventClass: 'boost', rare: true,
    name: 'Resonanz-Fenster', desc: 'Nächstes Sync-Fenster öffnet 50% früher · Resonanz-Energie ×3', duration: 40,
    color: 'rgba(150,80,255,.98)',
    onStart() {
      eventMods.syncWindowAccelerated = true;
      eventMods.resonanceBoost = true;
      toast('★ RESONANZ-FENSTER', 'Sync öffnet früher · Resonanz-Energie ×3', 3500);
      shock(0xaa44ff);
      refresh();
    },
    onEnd() {
      eventMods.syncWindowAccelerated = false;
      eventMods.resonanceBoost = false;
      toast('RESONANZ ENDET', 'Sync-Timing normal · Boost weg', 1600);
      refresh();
    },
  },

  {
    id: 'memory_surge', positive: true, eventClass: 'boost', rare: true,
    name: 'Memory-Überschwemmung', desc: 'Alle Memory-Nodes entladen sofort · Bonus ×4 für 10s', duration: 10,
    color: 'rgba(200,80,255,.98)',
    onStart() {
      eventMods.memMult = 4.0;
      let totalBonus = 0;
      gameNodes.filter(n => n.type === 'memory').forEach(n => {
        const burst = Math.round((n.memCharge || 0) * 4);
        totalBonus += burst;
        n.memCharge = 0;
      });
      if (totalBonus > 0) G.energy += totalBonus;
      toast('★ MEMORY-ÜBERSCHWEMMUNG', 'Alle Nodes entladen · +' + totalBonus + '⬡ · ×4 für 10s', 4000);
      shock(0xcc00ff);
      refresh();
    },
    onEnd() {
      eventMods.memMult = 1.0;
      toast('ÜBERSCHWEMMUNG ENDET', 'Memory-Output normal', 1600);
      refresh();
    },
  },
];

export const G_EVENT = {
  active: null,
  startTime: 0,
  nextEventIn: 85 + Math.random() * 50,
  lastEventTime: 0,
  eventCount: 0,
  positiveCount: 0,
  negativeCount: 0,
  tradeoffCount: 0,
  chainPending: null,
  chainStep: 0,
  chainTotal: 0,
  lastChainId: null,
  chainCount: 0,
  recentEventTimes: [],
  neuroStormCount: 0,
  neuroStormActive: false,
};

eventMods.passiveMult = eventMods.passiveMult ?? 1.0;
eventMods.energyMult = eventMods.energyMult ?? 1.0;
eventMods.bonusCapture = eventMods.bonusCapture ?? false;
eventMods.drain = eventMods.drain ?? 0;
eventMods.resonanceBoost = eventMods.resonanceBoost ?? false;
eventMods.triBonus = eventMods.triBonus ?? null;
eventMods.freePulses = eventMods.freePulses ?? 0;
eventMods.pulseCdBonus = eventMods.pulseCdBonus ?? 0;
eventMods.pulseCdMalus = eventMods.pulseCdMalus ?? 0;
eventMods.syncBonus = eventMods.syncBonus ?? 0;
eventMods.spineMult = eventMods.spineMult ?? 1.0;
eventMods.memMult = eventMods.memMult ?? 1.0;
eventMods.memResonanceBoost = eventMods.memResonanceBoost ?? 1.0;
eventMods.resonanceFragile = eventMods.resonanceFragile ?? false;
eventMods.overloadCap = eventMods.overloadCap ?? false;
eventMods.syncLocked = eventMods.syncLocked ?? false;
eventMods.neuroStorm = eventMods.neuroStorm ?? false;
eventMods.neuroStormPassiveBoost = eventMods.neuroStormPassiveBoost ?? 1.0;

function eventPool() {
  const rareChance = 0.18 + Math.min(0.18, G.l3CapturedClusters * 0.02);
  const rare = Math.random() < rareChance;
  const pool = EVENTS.filter(ev => !!ev.rare === rare);
  return pool.length ? pool : EVENTS.filter(ev => !ev.rare);
}

export function chooseRandomEvent() {
  const pool = eventPool();
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

export function clearActiveEvent() {
  if (G_EVENT.active) {
    try { G_EVENT.active.onEnd?.(); } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[Synapse] event onEnd error', err);
    }
  }
  G_EVENT.active = null;
  G_EVENT.startTime = 0;
  hideEventBanner();
}

export function triggerEvent(ev, elapsed = clock.getElapsedTime()) {
  if (!ev) return false;
  clearActiveEvent();
  G_EVENT.active = ev;
  G_EVENT.startTime = elapsed;
  G_EVENT.lastEventTime = elapsed;
  G_EVENT.eventCount++;
  if (ev.eventClass === 'boost') G_EVENT.positiveCount++;
  else if (ev.positive === false) G_EVENT.negativeCount++;
  if (ev.eventClass === 'tradeoff') G_EVENT.tradeoffCount++;
  ev.onStart?.();
  logTL('event', ev.name, ev.eventClass === 'boost' ? 'rgba(100,255,160,.65)' : ev.positive === false ? 'rgba(255,100,100,.65)' : 'rgba(255,200,80,.65)', ev.eventClass === 'boost' ? '★' : ev.positive === false ? '⚠' : '⟳');
  showEventBanner(ev, { chainStep: G_EVENT.chainStep, chainTotal: G_EVENT.chainTotal });
  toast(ev.name.toUpperCase(), ev.desc, ev.rare ? 3600 : 2600);
  shock(parseInt(String(ev.color || '0xffaa00').replace(/[^0-9a-fA-F]/g, '').slice(0, 6), 16) || 0xffaa00);
  refresh();
  return true;
}

export function triggerEventById(id, elapsed = clock.getElapsedTime()) {
  return triggerEvent(EVENTS.find(ev => ev.id === id), elapsed);
}

export function applyEventEnergyMult(gain) {
  let out = gain;
  out *= eventMods.passiveMult || 1.0;
  out *= eventMods.energyMult || 1.0;
  out *= eventMods.spineMult || 1.0;
  if (eventMods.neuroStorm) out *= eventMods.neuroStormPassiveBoost || 1.0;
  return Math.round(out);
}

export function tickEvents(elapsed) {
  if (!G.l3On || G.runWon || G_DRAFT?.active || bossState.bossActive) return;

  if (eventMods.drain > 0 && !bossState.bossVortexImmune) {
    if (!gameplayFlags.overclockDrainTimer) gameplayFlags.overclockDrainTimer = elapsed;
    if (elapsed - gameplayFlags.overclockDrainTimer >= 6) {
      gameplayFlags.overclockDrainTimer = elapsed;
      G.energy = Math.max(0, G.energy - eventMods.drain);
      refresh();
    }
  } else if (!eventMods.drain) {
    gameplayFlags.overclockDrainTimer = null;
  }

  if (eventMods.overloadCap && G.energy > 80) {
    G.energy = 40;
    toast('OVERLOAD DRAIN', 'Energie auf 40⬡ gedeckelt', 1200);
    shock(0xff44ff);
    refresh();
  }

  const syncWindowsOpen = G.l3Clusters?.some(c => c.syncWindowOpen);
  if (syncWindowsOpen && !G_EVENT.active) return;

  if (G_EVENT.active) {
    const age = elapsed - G_EVENT.startTime;
    if (age >= (G_EVENT.active.duration || 0)) {
      const ended = G_EVENT.active;
      clearActiveEvent();
      G_EVENT.nextEventIn = 45 + Math.random() * 45;
      G_EVENT.lastEventTime = elapsed;
      if (ended.id === 'neuro_storm') G_EVENT.neuroStormActive = false;
    }
    return;
  }

  if (elapsed < (G_EVENT.lastEventTime + G_EVENT.nextEventIn)) return;
  triggerEvent(chooseRandomEvent(), elapsed);
}

window.EVENTS = EVENTS;
window.G_EVENT = G_EVENT;
window.chooseRandomEvent = chooseRandomEvent;
window.clearActiveEvent = clearActiveEvent;
window.triggerEventById = triggerEventById;
window.tickEvents = tickEvents;
window._applyEventEnergyMult = applyEventEnergyMult;

