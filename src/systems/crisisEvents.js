/**
 * SYNAPSE v96 — Boss/Crisis Events as Systemic Infrastructure Crises
 *
 * Bosses no longer attack HP directly. Instead they trigger infrastructure crises:
 *  - Parasite/Vortex: infects sectors, player erects Firewall nodes or quarantines
 *  - Economic pressure: boss doubles upkeep for N minutes
 *  - Grid blockade: boss corrupts sectors, blocking building
 *
 * These run ALONGSIDE the existing boss system — they augment, not replace.
 */

import { G } from '../state/gameState.js';
import { bossState } from '../state/bossShared.js';
import { eventMods } from '../state/gameplayFlags.js';
import { gameNodes, gameLinks, spawnShock } from '../layers/network/index.js';
import { showToast } from '../ui/hud/index.js';
import { signalRunStateChanged } from '../platform/stateSignals.js';
import { getLang } from '../state/settings.js';
import { hasTech } from './techUnlocks.js';

// ── Crisis state ───────────────────────────────────────────────────────────
export function initCrisisState() {
  if (G.crisis) return;
  G.crisis = {
    infectedSectors:    [],   // { x, y } grid positions
    quarantinedNodes:   [],   // node objects cut from spine
    firewallNodes:      [],   // node objects acting as firewalls
    upkeepPressureEnd:  0,    // timestamp when upkeep crisis ends
    upkeepPressureMult: 1.0,
    spreadTick:         0,
    active:             false,
    crisisType:         null, // 'infection' | 'economic' | 'blockade'
  };
}

// ── Trigger a crisis based on active boss ─────────────────────────────────
export function triggerCrisis(type) {
  initCrisisState();
  G.crisis.active     = true;
  G.crisis.crisisType = type;

  const lang = getLang();
  switch (type) {
    case 'infection':
      spawnShock(0xaa00ff);
      spawnShock(0x660099);
      showToast(
        lang === 'de' ? '🧬 INFEKTION GESTARTET' : '🧬 INFECTION SPREADING',
        lang === 'de' ? 'Boss infiziert Sektoren — Firewalls errichten!' : 'Boss infects sectors — build Firewalls!',
        3500
      );
      // Mark 1–2 random links as initially infected
      _infectRandomLinks(2);
      break;

    case 'economic':
      G.crisis.upkeepPressureMult = 2.0;
      G.crisis.upkeepPressureEnd  = Date.now() + 3 * 60 * 1000; // 3 minutes
      eventMods._upkeepMult = 2.0;
      spawnShock(0xff8800);
      showToast(
        lang === 'de' ? '💸 WIRTSCHAFTSDRUCK' : '💸 ECONOMIC PRESSURE',
        lang === 'de' ? 'Upkeep ×2 für 3 Minuten — Notfall-Sources bauen!' : 'Upkeep ×2 for 3 minutes — build emergency sources!',
        3500
      );
      break;

    case 'blockade':
      spawnShock(0xff2200);
      showToast(
        lang === 'de' ? '🚧 SEKTOR BLOCKIERT' : '🚧 SECTOR BLOCKADE',
        lang === 'de' ? 'Korrupte Sektoren blockieren Bau' : 'Corrupted sectors block construction',
        3000
      );
      _corruptRandomSectors(3);
      break;
  }
  signalRunStateChanged();
}

// ── Infection spread ───────────────────────────────────────────────────────
function _infectRandomLinks(count) {
  const candidates = gameLinks.filter(l => !l._parasiteInfected);
  for (let i = 0; i < Math.min(count, candidates.length); i++) {
    const link = candidates[Math.floor(Math.random() * candidates.length)];
    link._parasiteInfected = true;
    link._parasiteOrigColor = link.line?.material?.color?.getHex?.() || 0x4466ff;
    if (link.line?.material) {
      link.line.material.color.setHex(0xaa00ff);
      link.line.material.opacity = 0.6;
    }
  }
}

export function tickInfectionSpread(t) {
  if (!G.crisis?.active || G.crisis.crisisType !== 'infection') return;
  if (t - G.crisis.spreadTick < 8.0) return; // spread every 8 seconds
  G.crisis.spreadTick = t;

  // Spread to one adjacent link
  const infected    = gameLinks.filter(l => l._parasiteInfected);
  const uninfected  = gameLinks.filter(l => !l._parasiteInfected);
  if (infected.length === 0 || uninfected.length === 0) return;

  // Find a link adjacent to an infected one (shares a node)
  const spreadTargets = uninfected.filter(ul =>
    infected.some(il => il.a === ul.a || il.a === ul.b || il.b === ul.a || il.b === ul.b)
  );
  if (spreadTargets.length === 0) return;

  const target = spreadTargets[Math.floor(Math.random() * spreadTargets.length)];

  // Check if a Firewall node is on this link's path
  const hasFirewall = G.crisis.firewallNodes.some(fw =>
    fw === target.a || fw === target.b
  );
  if (hasFirewall) {
    const lang = getLang();
    showToast(
      lang === 'de' ? '🛡 FIREWALL HÄLT' : '🛡 FIREWALL HOLDS',
      lang === 'de' ? 'Infektion blockiert' : 'Infection blocked',
      1800
    );
    return; // Firewall stops spread
  }

  target._parasiteInfected = true;
  target._parasiteOrigColor = target.line?.material?.color?.getHex?.() || 0x4466ff;
  if (target.line?.material) {
    target.line.material.color.setHex(0xaa00ff);
    target.line.material.opacity = 0.6;
  }

  const lang = getLang();
  showToast(
    lang === 'de' ? '🧬 INFEKTION BREITET SICH AUS' : '🧬 INFECTION SPREADING',
    lang === 'de' ? infected.length + 1 + ' Links infiziert' : infected.length + 1 + ' links infected',
    1500
  );

  // If >50% of links infected → crisis escalation
  if (infected.length + 1 > gameLinks.length * 0.5) {
    spawnShock(0xff00ff);
    showToast(
      lang === 'de' ? '💀 KRITISCHE INFEKTION' : '💀 CRITICAL INFECTION',
      lang === 'de' ? 'Netz zu 50%+ infiziert!' : 'Network 50%+ infected!',
      3000
    );
  }
}

// ── Quarantine: cut an infected section from the spine ────────────────────
export function quarantineNode(node) {
  if (!G.crisis) return;
  G.crisis.quarantinedNodes.push(node);
  node._quarantined = true;
  // Mark all links to this node as isolated
  gameLinks.forEach(link => {
    if (link.a === node || link.b === node) {
      link._quarantined = true;
      // Reduce bandwidth on quarantined links
      link._bandwidthMod = 0.5;
    }
  });
  const lang = getLang();
  showToast(
    lang === 'de' ? '🔒 QUARANTÄNE' : '🔒 QUARANTINE',
    lang === 'de' ? 'Node isoliert — temporär kein Einkommen' : 'Node isolated — no income temporarily',
    2200
  );
  signalRunStateChanged();
}

export function liftQuarantine(node) {
  if (!G.crisis) return;
  G.crisis.quarantinedNodes = G.crisis.quarantinedNodes.filter(n => n !== node);
  node._quarantined = false;
  gameLinks.forEach(link => {
    if (link.a === node || link.b === node) {
      link._quarantined = false;
      link._bandwidthMod = 1.0;
    }
  });
  signalRunStateChanged();
}

// ── Firewall placement ─────────────────────────────────────────────────────
export function designateFirewall(node) {
  if (!G.crisis) return;
  if (G.crisis.firewallNodes.includes(node)) return;
  if (!hasTech('firewallNodes') && !G._devMode) {
    const lang = getLang();
    showToast(
      lang === 'de' ? '🔒 TECH BENÖTIGT' : '🔒 TECH REQUIRED',
      lang === 'de' ? 'Forsche "Firewall-Nodes" im Tech-Baum' : 'Research "Firewall Nodes" in tech tree',
      2000
    );
    return;
  }
  G.crisis.firewallNodes.push(node);
  node._isFirewall = true;
  const lang = getLang();
  showToast(
    lang === 'de' ? '🛡 FIREWALL ERRICHTET' : '🛡 FIREWALL ERECTED',
    lang === 'de' ? 'Dieser Node blockt Infektion' : 'This node blocks infection spread',
    2000
  );
  signalRunStateChanged();
}

// ── Economic pressure tick ─────────────────────────────────────────────────
export function tickEconomicPressure(t) {
  if (!G.crisis?.active || G.crisis.crisisType !== 'economic') return;
  if (Date.now() < G.crisis.upkeepPressureEnd) return;

  // Pressure ended
  G.crisis.upkeepPressureMult = 1.0;
  eventMods._upkeepMult       = 1.0;
  G.crisis.active             = false;
  const lang = getLang();
  showToast(
    lang === 'de' ? '✅ DRUCK VORBEI' : '✅ PRESSURE LIFTED',
    lang === 'de' ? 'Upkeep zurück auf normal' : 'Upkeep back to normal',
    2500
  );
  spawnShock(0x44ff88);
  signalRunStateChanged();
}

// ── Sector corruption ──────────────────────────────────────────────────────
function _corruptRandomSectors(count) {
  if (!G.eco?.terrain) return;
  const normal = G.eco.terrain.filter(s => s.type === 'normal');
  for (let i = 0; i < Math.min(count, normal.length); i++) {
    const idx = Math.floor(Math.random() * normal.length);
    normal[idx].type = 'corrupted';
    normal.splice(idx, 1);
  }
}

// ── Resolve infection (all links purged) ──────────────────────────────────
export function checkInfectionResolved() {
  if (!G.crisis?.active || G.crisis.crisisType !== 'infection') return;
  const remaining = gameLinks.filter(l => l._parasiteInfected).length;
  if (remaining === 0) {
    G.crisis.active = false;
    const lang = getLang();
    showToast(
      lang === 'de' ? '✅ INFEKTION BEENDET' : '✅ INFECTION CLEARED',
      lang === 'de' ? 'Netz vollständig gesäubert' : 'Network fully cleansed',
      3000
    );
    spawnShock(0x44ff44);
    signalRunStateChanged();
  }
}

// ── Auto-trigger crisis when boss becomes active ───────────────────────────
let _lastBossId = null;
export function tickCrisisFromBoss(t) {
  initCrisisState();
  if (!bossState.bossActive) {
    _lastBossId = null;
    return;
  }
  const bossId = bossState.activeBossProfile?.id;
  if (bossId === _lastBossId) {
    // Boss already triggered its crisis — just tick ongoing effects
    tickInfectionSpread(t);
    tickEconomicPressure(t);
    checkInfectionResolved();
    return;
  }
  _lastBossId = bossId;

  if (!G.crisis || !G.crisis.active) {
    switch (bossId) {
      case 'parasite_choir':
      case 'vortex_architect':
        triggerCrisis('infection');
        break;
      case 'ghost_matrix':
      case 'sigma_recursive':
        triggerCrisis('economic');
        break;
      case 'null_cortex':
      case 'entropy_field':
        triggerCrisis('blockade');
        break;
      default:
        triggerCrisis('economic');
    }
  }
}

// ── Master tick ────────────────────────────────────────────────────────────
export function tickCrisis(t) {
  initCrisisState();
  tickCrisisFromBoss(t);
}
