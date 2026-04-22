/**
 * SYNAPSE v95 — UI HUD / shared DOM bridge
 * Phase H migration pass.
 *
 * Goal:
 *   - centralise common HUD / toast / tooltip / progress DOM writes
 *   - expose stable window bridges for not-yet-migrated gameplay code
 *   - reduce repeated document.getElementById() traffic in systems/layers
 */

import { G } from '../../state/gameState.js';
import { getLang } from '../../state/settings.js';
import { aiState, PROFILE_BONUS } from '../../state/aiShared.js';
import { bossState } from '../../state/bossShared.js';
import { gameNodes, gameLinks } from '../../layers/network/layer1.js';
import { bLinks, getActiveBridgeCount } from '../../layers/bridge/layer2.js';
import { updateAIHud } from '../../systems/ai.js';
import { updateBossHUD } from '../../systems/boss.js';
import { updateL3ClusterHUD } from '../../layers/meta/layer3.js';
import { regTimer, clearTimer } from '../../registries/timerRegistry.js';
import { HUD_SECTION_MASK } from '../../platform/stateSignals.js';
import { getEffectivePulseCooldownBase, getEffectivePulseCost, getEffectiveTrainCost, getEarlyGameSupportSummary } from '../../gameplay/balance.js';
import {
  THRESHOLDS, el, initDOMCache,
  setNodeText, setNodeDisplay, setNodeWidth, setNodeBackground, setNodeStyle, fmtE,
} from './_domCache.js';
import {
  showToast, showConditionChip, hideConditionChip,
  showTip, hideTip, setLayerTag, setPhaseName,
} from './_notify.js';

// Re-export the moved primitives so existing import sites keep working.
export { THRESHOLDS, el, initDOMCache };
export { showToast, showConditionChip, hideConditionChip, showTip, hideTip, setLayerTag, setPhaseName };

let prevEnergy = 0;
let pulseWasReady = false;
let lastSpineLen = -1;

function updateEnergyMiniBar(energy, cost) {
  const fill = el('energy-mini-fill');
  const bar = el('energy-mini-bar') || document.getElementById('energy-mini-bar');
  if (!fill) return;
  const peak = Math.max(G.peakEnergy || 1, Math.max(1, cost) * 4, 60);
  const pct = Math.min(100, (energy / peak) * 100);
  fill.style.width = pct + '%';
  fill.classList.remove('low', 'high');
  if (energy < cost) fill.classList.add('low');
  else if (pct > 75) fill.classList.add('high');
  // Fix #15: Keep aria-valuenow in sync for screen readers
  if (bar) bar.setAttribute('aria-valuenow', Math.round(pct));
}

function updatePulseCdRing(remaining, total, isFusion, isCapture, isReady) {
  const ring = el('pulse-cd-ring');
  const fill = el('pulse-cd-fill');
  if (!ring || !fill) return;
  const PERIM = 256;
  if (!G.autoOn) {
    ring.classList.remove('vis');
    return;
  }
  ring.classList.add('vis');
  ring.classList.remove('rdy', 'cap', 'fus', 'cd');
  if (remaining > 0) {
    const frac = Math.max(0, Math.min(1, 1 - (remaining / Math.max(1, total))));
    fill.style.strokeDashoffset = (PERIM * (1 - frac)).toFixed(1);
    ring.classList.add('cd');
  } else if (isFusion) {
    fill.style.strokeDashoffset = '0';
    ring.classList.add('fus');
  } else if (isCapture) {
    fill.style.strokeDashoffset = '0';
    ring.classList.add('cap');
  } else if (isReady) {
    fill.style.strokeDashoffset = '0';
    ring.classList.add('rdy');
  } else {
    ring.classList.remove('vis');
  }
}

function updatePulseButton() {
  const btn = el('btn-pulse');
  if (!btn) return;
  if (!G.autoOn) {
    btn.disabled = true;
    return;
  }
  btn.disabled = false;

  const pulseCost = getEffectivePulseCost();
  const pulseCdBase = getEffectivePulseCooldownBase();
  const cd = pulseCdBase - (Date.now() - G.pulseMs);
  const openWindows = G.l3On ? G.l3Clusters.filter(c => c.syncWindowOpen).length : 0;
  // fusionWindows: direct Set iteration — no [...spread] or .map(Number) per call
  let fusionWindows = 0;
  if (G.l3On && openWindows > 0) {
    for (let ci = 0; ci < G.l3Clusters.length; ci++) {
      if (!G.l3Clusters[ci].syncWindowOpen) continue;
      for (const key of G.fusedPairs) {
        const dash = key.indexOf('-');
        if (+key.slice(0, dash) === ci || +key.slice(dash + 1) === ci) { fusionWindows++; break; }
      }
    }
  }
  const predatorBonus = openWindows > 0 ? (PROFILE_BONUS?.predator?.pulseCdReduction || 0) : 0;
  const effectiveCd = cd - Math.round(pulseCdBase * predatorBonus);
  const canFire = effectiveCd <= 0 && G.energy >= pulseCost;
  const nowReady = canFire && openWindows === 0;

  if (nowReady && !pulseWasReady) {
    btn.classList.add('pulse-ping');
    clearTimer('hudPulsePing');
    regTimer('hudPulsePing', setTimeout(() => {
      btn.classList.remove('pulse-ping');
      clearTimer('hudPulsePing');
    }, 560), 'timeout');
  }
  pulseWasReady = canFire;

  btn.classList.remove('pulse-rdy','pulse-cd','pulse-low','pulse-capture','pulse-spine','pulse-fusion');
  const lang = getLang();
  const support = getEarlyGameSupportSummary(lang);
  btn.title = '';
  if (effectiveCd > 0) {
    const cdSec = Math.ceil(effectiveCd / 1000);
    const predTag = predatorBonus > 0 ? ' ▸' : '';
    btn.innerText = G.spineBonusActive ? `⚡ ${cdSec}s ⬟${predTag}` : `⚡ ${cdSec}s${predTag}`;
    btn.title = lang === 'de' ? `Pulse bereit in ${cdSec}s` : `Pulse ready in ${cdSec}s`;
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('aria-label', lang === 'de' ? `Pulse — ${cdSec}s Cooldown` : `Pulse — ${cdSec}s cooldown`);
    btn.classList.add('pulse-cd');
  } else if (fusionWindows > 0 && G.energy >= pulseCost) {
    btn.innerText = lang === 'de' ? '⚡ Fusion!' : '⚡ Fusion!';
    btn.title = lang === 'de'
      ? 'Mindestens ein offenes Sync-Fenster ist fusionierbar'
      : 'At least one open sync window can be fused';
    btn.setAttribute('aria-disabled', 'false');
    btn.setAttribute('aria-label', lang === 'de' ? 'Pulse — Fusion verfügbar' : 'Pulse — fusion available');
    btn.classList.add('pulse-fusion');
  } else if (openWindows > 0 && G.energy >= pulseCost) {
    btn.innerText = lang === 'de'
      ? (G.backboneActive ? '⚡ Capture ◈' : '⚡ Capture!')
      : (G.backboneActive ? '⚡ Capture ◈' : '⚡ Capture!');
    btn.title = lang === 'de' ? 'Offenes Sync-Fenster · jetzt pulsen' : 'Open sync window · pulse now';
    btn.setAttribute('aria-disabled', 'false');
    btn.setAttribute('aria-label', lang === 'de' ? 'Pulse — Sync-Fenster offen' : 'Pulse — sync window open');
    btn.classList.add('pulse-capture');
  } else if (G.energy >= pulseCost) {
    btn.innerText = G.spineBonusActive ? '⚡ Pulse ⬟' : '⚡ Pulse';
    btn.title = lang === 'de'
      ? `Pulse kostet ${pulseCost}⬡ · Leertaste`
      : `Pulse costs ${pulseCost}⬡ · Space`;
    btn.setAttribute('aria-disabled', 'false');
    btn.setAttribute('aria-label', lang === 'de' ? 'Pulse — bereit' : 'Pulse — ready');
    btn.classList.add(G.spineBonusActive ? 'pulse-spine' : 'pulse-rdy');
  } else {
    btn.innerText = `⚡ −${Math.max(0, Math.ceil(pulseCost - G.energy))}⬡`;
    btn.title = lang === 'de'
      ? `Pulse kostet ${pulseCost}⬡ · Leertaste`
      : `Pulse costs ${pulseCost}⬡ · Space`;
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('aria-label', lang === 'de'
      ? `Pulse — zu wenig Energie (${Math.ceil(pulseCost - G.energy)}⬡ fehlen)`
      : `Pulse — not enough energy (${Math.ceil(pulseCost - G.energy)}⬡ needed)`);
    btn.classList.add('pulse-low');
  }

  if (support) btn.title += (btn.title ? `
` : '') + support;
  updatePulseCdRing(effectiveCd, pulseCdBase, !!fusionWindows, !!(openWindows && G.energy >= pulseCost), G.energy >= pulseCost);
}

function getTrainingLevel(profile) {
  const scores = aiState?.trainingScores || {};
  const map = { analyst: 'routing', predator: 'timing', architect: 'stability', mnemonic: 'memory' };
  const key = map[profile] || 'routing';
  return Math.min(5, Math.floor((scores[key] || 0) / 20));
}

function updateTrainButton() {
  const btn = el('btn-train');
  if (!btn) return;
  if (!G.autoOn) {
    btn.disabled = true;
    return;
  }

  btn.disabled = false;
  const cd = G.trainCd - (Date.now() - G.trainMs);
  btn.classList.remove('train-rdy', 'train-cd', 'train-low', 'train-ping');
  if (cd > 0) {
    const lang = getLang();
    const supportCd = getEarlyGameSupportSummary(lang);
    btn.title = lang === 'de'
      ? `Verbessert Routing-Effizienz & KI-Evolution
Nächster Slot in ${Math.ceil(cd / 1000)}s${supportCd ? `
${supportCd}` : ''}`
      : `Improves routing & AI evolution
Ready in ${Math.ceil(cd / 1000)}s${supportCd ? `
${supportCd}` : ''}`;
    btn.innerText = '◈ ' + Math.ceil(cd / 1000) + 's';
    btn.classList.add('train-cd');
    return;
  }

  const trainCost = getEffectiveTrainCost();
  if (G.energy < trainCost) {
    btn.innerText = `◈ −${Math.max(0, Math.ceil(trainCost - G.energy))}⬡`;
    btn.title = getEarlyGameSupportSummary(getLang()) || (getLang() === 'de' ? `Training kostet ${trainCost}⬡` : `Training costs ${trainCost}⬡`);
    btn.classList.add('train-low');
    return;
  }

  const now = Date.now();
  const ai = aiState || {};
  const recentPulse = ai.lastPulseTime > 0 && (now - ai.lastPulseTime) < 8000;
  const activeBr = _cachedActiveBr;
  const lang = getLang();
  let hint = lang === 'de' ? '◈ Training' : '◈ Train';
  if (!recentPulse && ai.lastPulseTime > 0) {
    hint = lang === 'de' ? '◈ Training · erst Pulse' : '◈ Train · pulse first';
  } else if (recentPulse && activeBr >= 2 && G.tris.size >= 1) {
    hint = lang === 'de' ? '◈ Training ★' : '◈ Train ★';
  } else if (recentPulse) {
    hint = lang === 'de' ? '◈ Training ✓' : '◈ Train ✓';
  }

  const lvl = getTrainingLevel(ai.dominantProfile || 'analyst');
  const nextAt = lvl < 5 ? (lvl + 1) * 20 : 100;
  const supportReady = getEarlyGameSupportSummary(lang);
  btn.title = lang === 'de'
    ? `Training verbessert Routing & KI-Evolution.
Nächste Stufe bei Score ${nextAt}${supportReady ? `
${supportReady}` : ''}`
    : `Training improves routing & AI evolution.
Next level at score ${nextAt}${supportReady ? `
${supportReady}` : ''}`;
  btn.innerText = hint;
  btn.classList.add('train-rdy');
}

function updateTypeButtons() {
  const e = G.energy;
  const nodeCosts = { source: 0, relay: 5, amplifier: 8, memory: 10 };
  const linkCosts = { stable: 0, fast: 5, resonance: 4, fragile: 0 };
  const lang = getLang();
  for (const [type, cost] of Object.entries(nodeCosts)) {
    const id = { source: 'bn-src', relay: 'bn-rly', amplifier: 'bn-amp', memory: 'bn-mem' }[type];
    const btn = el(id);
    if (!btn) continue;
    const cantAfford = cost > 0 && e < cost;
    btn.classList.toggle('tbtn-disabled', cantAfford);
    btn.title = cantAfford
      ? (lang === 'de' ? `${cost}⬡ nötig (aktuell: ${e}⬡)` : `Need ${cost}⬡ (current: ${e}⬡)`)
      : (cost > 0 ? `${cost}⬡` : '');
    btn.style.opacity = '';
  }
  for (const [type, cost] of Object.entries(linkCosts)) {
    const id = { stable: 'bl-stb', fast: 'bl-fst', resonance: 'bl-res', fragile: 'bl-frg' }[type];
    const btn = el(id);
    if (!btn) continue;
    const cantAfford = cost > 0 && e < cost;
    btn.classList.toggle('tbtn-disabled', cantAfford);
    btn.title = cantAfford
      ? (lang === 'de' ? `${cost}⬡ nötig (aktuell: ${e}⬡)` : `Need ${cost}⬡ (current: ${e}⬡)`)
      : (cost > 0 ? `${cost}⬡` : '');
    btn.style.opacity = '';
  }
}

function refreshHint() {
  const hint = el('hint');
  if (!hint) return;
  const n = gameNodes.length;
  const l = gameLinks.length;
  let next = '';

  if (G.runWon) next = '★ Alle 8 Cluster übernommen · R für Neustart';
  else if (n >= THRESHOLDS.maxL1 - 2 && !G.l3On) next = `Knotenlimit fast erreicht (${n}/${THRESHOLDS.maxL1})`;
  else if (G.mode === 'connect') next = G.selected ? `Ziel wählen · ${G.lType}` : 'Quell-Neuron wählen · P = Platzieren';
  else if (n === 0) next = 'Tippe um ein Neuron zu platzieren';
  else if (n < THRESHOLDS.connectAt) next = `${n}/${THRESHOLDS.connectAt} Neuronen · noch ${THRESHOLDS.connectAt - n} bis Verbinden`;
  else if (l < 2) next = 'C = Verbinden · jetzt erste sichere Links ziehen';
  else if (l < 3) next = 'Noch 1 Link bis zum ersten Dreieck';
  else if (G.l2On && !G.l3On) {
    const active = _cachedActiveBr;
    if (active === 0) next = 'Dreieck oder Memory verankert Schicht-2-Brücken';
    else if (active < THRESHOLDS.l3Bridges) next = `${active}/${THRESHOLDS.l3Bridges} Brücken aktiv · mehr Dreiecke bauen`;
    else next = `Brücken ✓ · N ${n}/${THRESHOLDS.l3N} für Schicht 3`;
  } else if (!G.autoOn) next = `N ${n}/${THRESHOLDS.autoN} · L ${l}/${THRESHOLDS.autoL} · Auto-Genesis nähert sich`;
  else if (G.l3On) {
    let open = 0, syncing = 0;
    for (const c of G.l3Clusters) {
      if (c.syncWindowOpen) open++;
      else if (c.syncReady) syncing++;
    }
    const cap = G.l3CapturedClusters;
    const sl = G.spineLength;
    if (open > 0) next = open === 1 ? 'Sync-Fenster offen — Spc / Pulse!' : `${open} Fenster offen — Pulse für Fusion!`;
    else if (syncing > 0) next = `${syncing} Cluster nähern sich — Pulse bereit halten`;
    else if (sl >= 4) next = `Backbone (${sl} Kerne) · Kerne synchronisieren sich selbst`;
    else if (sl >= 3) next = `Spine aktiv · Pulse ×2 schneller · noch ${4 - sl} Kern${4 - sl > 1 ? 'e' : ''} bis Backbone`;
    else next = `${cap}/8 Cluster · Kerne verbinden für Spine-Bonus`;
  } else {
    const support = getEarlyGameSupportSummary(getLang());
    next = support ? `Auto-Genesis aktiv · ${support}` : 'Auto-Genesis aktiv · Spc = Pulse';
  }

  setNodeText(hint, next);
}

function updateSpineBanner() {
  const node = document.getElementById('spine-banner');
  if (!node) return;
  const len = G.spineLength || 0;
  const lang = getLang();
  if (len < 3) {
    node.classList.remove('vis', 'spn', 'bb');
    return;
  }
  if (len === lastSpineLen) return;
  lastSpineLen = len;
  node.classList.remove('spn', 'bb');
  if (len >= 4) {
    node.classList.add('bb', 'vis');
    node.innerText = lang === 'de' ? `⬟ BACKBONE ×${len}` : `⬟ BACKBONE ×${len}`;
  } else {
    node.classList.add('spn', 'vis');
    node.innerText = lang === 'de' ? `⬟ SPINE ×${len}` : `⬟ SPINE ×${len}`;
  }
}

function updateProgressBar(n, l, e) {
  const bar = el('prog-bar');
  const lbl = el('prog-lbl');
  if (!bar || !lbl) return;
  let width = '0%';
  let bg = '';
  let label = '';

  if (!G.autoOn) {
    const p = Math.min(1, ((n / THRESHOLDS.autoN) + (l / THRESHOLDS.autoL) + (e / THRESHOLDS.autoE)) / 3);
    width = (p * 100) + '%';
    bg = `rgba(${80 + p * 140},${180 + p * 60},255,.75)`;
    label = 'Energie für Auto-Genesis';
  } else if (!G.l2On) {
    const p = Math.min(n / THRESHOLDS.l2N, l / THRESHOLDS.l2L);
    width = Math.min(100, p * 100) + '%';
    bg = 'rgba(60,200,255,.75)';
    label = `Schicht 2 · N ${n}/${THRESHOLDS.l2N} · L ${l}/${THRESHOLDS.l2L}`;
  } else if (!G.l3On) {
    const activeBr = _cachedActiveBr;
    const p = Math.min(n / THRESHOLDS.l3N, activeBr / THRESHOLDS.l3Bridges);
    width = Math.min(100, p * 100) + '%';
    bg = 'rgba(160,90,255,.75)';
    const nDone = n >= THRESHOLDS.l3N ? '✓' : `${n}/${THRESHOLDS.l3N}`;
    const bDone = activeBr >= THRESHOLDS.l3Bridges ? '✓' : `${activeBr}/${THRESHOLDS.l3Bridges}`;
    label = `Schicht 3 · N ${nDone} · Brücken ${bDone}`;
  } else {
    const cap = G.l3CapturedClusters;
    const pairs = window.countConnectedCorePairs?.() || 0;
    const p = Math.min(1, cap / 8);
    width = (p * 100) + '%';
    bg = G.spineLength >= 4 ? 'rgba(255,120,40,.85)' : G.spineLength >= 3 ? 'rgba(255,200,60,.8)' : 'rgba(80,255,160,.75)';
    const spineHint = G.spineLength >= 4 ? ' · Backbone!' : G.spineLength >= 3 ? ' · Spine!' : '';
    label = cap > 0 ? `Cluster ${cap}/8 · Paare ${pairs}${spineHint}` : 'Makro-Netz aktiv ✓';
  }
  if (G.runWon) {
    const tier = G.winTier || 1;
    width = '100%';
    bg = tier === 3 ? 'rgba(255,100,30,.9)' : tier === 2 ? 'rgba(255,190,40,.9)' : 'rgba(80,255,160,.9)';
    label = tier === 3 ? '★★ Backbone Nexus — 8 Cluster ✓' : tier === 2 ? '★ Spine-Formation — 8 Cluster ✓' : '★ Netz stabilisiert — 8 Cluster ✓';
  }

  setNodeWidth(bar, width);
  setNodeBackground(bar, bg);
  setNodeText(lbl, label);
}

// Cached within a single updateTopHUD call — all sub-functions that need
// activeBr read this instead of each calling bLinks.filter() independently.
let _cachedActiveBr = 0;

export function updateTopHUD() {
  const n = gameNodes.length;
  const l = gameLinks.length;
  const e = G.energy;
  if (e > G.peakEnergy) G.peakEnergy = e;

  // Compute once — used by updateTrainButton, refreshHint, updateProgressBar
  _cachedActiveBr = G.l2On ? getActiveBridgeCount() : 0;

  setNodeText(el('vN'), String(n));
  setNodeText(el('vL'), String(l));
  setNodeDisplay(el('link-stat'), G.l2On ? '' : 'none');

  const eEl = el('vE');
  if (eEl) {
    setNodeText(eEl, fmtE(e));
    if (e - prevEnergy >= 10 && prevEnergy > 0) {
      eEl.classList.remove('e-flash');
      // Intentional forced reflow: reading offsetWidth flushes pending style
      // changes so the browser registers the class removal before we re-add it,
      // restarting the CSS animation from frame 0. Without this the animation
      // would not replay if triggered faster than its duration.
      // eslint-disable-next-line no-unused-expressions
      void eEl.offsetWidth;
      eEl.classList.add('e-flash');
      const eStat = el('energy-stat');
      if (eStat) {
        eStat.classList.remove('stat-active');
        void eStat.offsetWidth;
        eStat.classList.add('stat-active');
        clearTimer('hudEnergyStatActive');
        regTimer('hudEnergyStatActive', setTimeout(() => {
          eStat.classList.remove('stat-active');
          clearTimer('hudEnergyStatActive');
        }, 800), 'timeout');
      }
    }
  }
  prevEnergy = e;
  updateEnergyMiniBar(e, getEffectivePulseCost());
  updateSpineBanner();

  const triCount = G.tris.size;
  setNodeDisplay(el('tri-stat'), triCount > 0 ? '' : 'none');
  if (triCount > 0) setNodeText(el('vT'), String(triCount));

  const brStat = el('br-stat');
  if (brStat) {
    if (G.l2On && bLinks.length) {
      const active = _cachedActiveBr;
      setNodeDisplay(brStat, '');
      setNodeText(el('vB'), String(active));
      setNodeText(el('vBT'), String(bLinks.length));
    } else {
      setNodeDisplay(brStat, 'none');
    }
  }

  const l3Stat = el('l3-stat');
  const spineStat = el('spine-stat');
  if (l3Stat && spineStat) {
    if (G.l3On) {
      setNodeDisplay(l3Stat, '');
      setNodeText(el('vL3C'), String(G.l3CapturedClusters));
      setNodeText(el('vL3P'), String(window.countConnectedCorePairs?.() || 0));
      if (G.spineLength >= 3) {
        setNodeDisplay(spineStat, '');
        const sp = el('vSP');
        if (sp) {
          setNodeText(sp, G.spineLength >= 4 ? 'Backbone×' + G.spineLength : 'Spine×' + G.spineLength);
          setNodeStyle(sp, 'color', G.spineLength >= 4 ? 'rgba(255,130,40,.95)' : 'rgba(255,200,60,.9)');
        }
      } else {
        setNodeDisplay(spineStat, 'none');
      }
    } else {
      setNodeDisplay(l3Stat, 'none');
      setNodeDisplay(spineStat, 'none');
    }
  }

  refreshHint();
  updatePulseButton();
  updateTrainButton();
  updateTypeButtons();
  updateProgressBar(n, l, e);
  _updateEcoHUD(); // v96: Strategic economy panel
  _updateHeartbeatGlow(); // v97: Beat-phase glow on energy display
}


// ── v97: Heartbeat beat-phase helpers ───────────────────────────────────────
// window.__hbPhase is used instead of a direct import to avoid a circular
// dependency: hud.js → heartbeat.js → showToast → hud.js
function _getBeatPhase() {
  try { return window.__hbPhase || 0; } catch(_) { return 0; }
}

function _updateHeartbeatGlow() {
  const phase = _getBeatPhase();
  if (phase < 0.85) return;
  const row = document.getElementById('stats-row');
  if (!row) return;
  row.classList.remove('hb-beat');
  // Force reflow so the browser treats the re-add as a new animation start.
  // eslint-disable-next-line no-unused-expressions
  void row.offsetWidth; // intentional reflow — required to restart CSS animation
  row.classList.add('hb-beat');
  // Use animationend instead of a fixed timeout so the class is removed exactly
  // when the animation finishes, even if the beat fires in rapid succession.
  row.addEventListener('animationend', () => row.classList.remove('hb-beat'), { once: true });
}

// ── v96: Strategic Economy HUD ────────────────────────────────────────────
function _updateEcoHUD() {
  const eco = G.eco;
  if (!eco) {
    // Remove the class so the eco panel is hidden when eco data is absent.
    document.body.classList.remove('eco-active');
    return;
  }

  // Panel is now statically defined in index.html (#v96-eco-panel).
  // Visibility is controlled via body.eco-active in CSS — no inline styles,
  // so theming, colorblind-mode, and mobile breakpoints all work correctly.
  document.body.classList.add('eco-active');

  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

  if (eco.totalUpkeep > 0) {
    set('v96-upkeep', '⚙ ' + eco.totalUpkeep + '⬡/s');
  } else {
    set('v96-upkeep', '');
  }

  set('v96-raw',  eco.rawData       > 0 ? '▣ ' + eco.rawData       : '');
  set('v96-proc', eco.processedData > 0 ? '⟳ '  + eco.processedData : '');
  set('v96-know', eco.knowledge     > 0 ? '◈ '  + eco.knowledge     : '');

  set('v96-bottleneck',
    eco._bottleneckCount > 0
      ? '▲ ' + eco._bottleneckCount + ' Stau'
      : ''
  );

  // Fix #6: Escalate brownout visually via body class so CSS can apply
  // multi-level pulsing effects (topbar border, stats-row flash, banner).
  const wasBrownout = document.body.classList.contains('brownout-active');
  if (eco.brownoutActive !== wasBrownout) {
    document.body.classList.toggle('brownout-active', !!eco.brownoutActive);
  }
  set('v96-brownout',
    eco.brownoutActive ? '◉ BROWNOUT' : ''
  );

  const lens = G.diagnosticLens;
  set('v96-lens',
    (lens && lens !== 'none') ? '◐ ' + lens.toUpperCase() : ''
  );

  // Mega-project progress
  const mp = G.megaProject;
  if (mp && mp.active && !mp.complete) {
    const pct = Math.round((mp.energyChannelled / mp.requiredEnergy) * 100);
    set('v96-proj', '▸ ' + pct + '% (' + Math.round(mp.sustainedSeconds) + '/' + mp.duration + 's)');
  } else {
    set('v96-proj', '');
  }
}

export function updateAIHudPanel({
  awarenessStage = 0,
  dominantProfile = null,
  profileScores = {},
  mood = '',
  lang = 'de',
  stageNames = {},
  profileLabels = {},
  moodLabels = {},
  profileColors = {},
  trainingLevel = 0,
}) {
  const panel = document.getElementById('ai-hud');
  if (!panel) return;
  if (awarenessStage === 0) {
    panel.classList.remove('vis');
    setNodeDisplay(panel, 'none');
    setNodeStyle(panel, 'opacity', '');
    panel._visQueued = false;
    return;
  }

  setNodeDisplay(panel, 'block');
  setNodeStyle(panel, 'opacity', '');

  const stageEl = document.getElementById('ai-stage-lbl');
  const profileEl = document.getElementById('ai-profile-lbl');
  const moodEl = document.getElementById('ai-mood-lbl');
  const bonusEl = document.getElementById('ai-bonus-lbl');

  const stageList = stageNames[lang] || stageNames.de || [];
  setNodeText(stageEl, `STUFE ${awarenessStage + 1} · ${(stageList[awarenessStage] || '—').toUpperCase()}`);

  if (profileEl) {
    if (dominantProfile) {
      setNodeText(profileEl, profileLabels[lang]?.[dominantProfile] || profileLabels.de?.[dominantProfile] || dominantProfile);
      setNodeStyle(profileEl, 'color', profileColors[dominantProfile] || 'rgba(255,255,255,.9)');
      setNodeStyle(profileEl, 'textShadow', `0 0 16px ${(profileColors[dominantProfile] || 'rgba(255,255,255,.9)').replace('.92', '.5')}`);
      profileEl.classList.toggle('profile-locked', (profileScores[dominantProfile] || 0) >= 60);
    } else {
      setNodeText(profileEl, '—');
      setNodeStyle(profileEl, 'color', 'rgba(255,255,255,.22)');
      setNodeStyle(profileEl, 'textShadow', 'none');
      profileEl.classList.remove('profile-locked');
    }
  }

  if (moodEl) {
    const txt = moodLabels[lang]?.[mood] || moodLabels.de?.[mood] || mood;
    const idle = mood === 'idle' || mood === 'ruhend' || !mood;
    setNodeText(moodEl, idle ? '' : txt);
    moodEl.classList.toggle('mood-idle', idle);
  }

  if (bonusEl) {
    let bonusText = '';
    if (trainingLevel > 0 && dominantProfile) {
      const bonusDesc = {
        analyst: lang === 'de' ? `Lv${trainingLevel} · Warn +${(trainingLevel * 0.5).toFixed(1)}s` : `Lv${trainingLevel} · Warn +${(trainingLevel * 0.5).toFixed(1)}s`,
        predator: `Lv${trainingLevel} · Burst +${trainingLevel * 2}⬡ · CD −${trainingLevel * 8}%`,
        architect: `Lv${trainingLevel} · Spine ×${(1 + trainingLevel * 0.06).toFixed(2)}`,
        mnemonic: `Lv${trainingLevel} · Mem +${trainingLevel * 10}%`,
      };
      bonusText = bonusDesc[dominantProfile] || '';
    }
    setNodeText(bonusEl, bonusText);
  }

  const keys = ['analyst', 'predator', 'architect', 'mnemonic'];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const fill = document.getElementById(`ai-bar-${key}`);
    const val = document.getElementById(`ai-val-${key}`);
    const row = document.getElementById(`ai-row-${key}`);
    const score = Math.max(0, Math.min(100, profileScores[key] || 0));
    setNodeWidth(fill, `${score}%`);
    setNodeText(val, String(score));
    if (row) row.classList.toggle('dominant', key === dominantProfile);
  }

  if (!panel.classList.contains('vis') && !panel._visQueued) {
    panel._visQueued = true;
    requestAnimationFrame(() => {
      // Guard: if the panel was hidden again before this frame fired, bail out.
      if (!panel._visQueued) return;
      panel._visQueued = false;
      panel.classList.add('vis');
    });
  }
}

export function initL3HUDUI(clusters, objectives = []) {
  const hud = el('l3-hud');
  if (!hud) return;
  _l3HudCache.headerEl = null;
  _l3HudCache.objLabelEl = null;
  _l3HudCache.headerText = '';
  _l3HudCache.headerClass = '';
  _l3HudCache.objectiveSig = '';
  _l3HudCache.slots = [];
  hud.style.display = 'flex';
  hud.innerHTML = '<div id="l3-hud-label">L3 · CLUSTER</div><div id="l3-hud-header">0 / 8</div><div id="l3-hud-sep"></div>';
  clusters.forEach((_, i) => {
    const div = document.createElement('div');
    div.className = 'cl-slot';
    div.id = 'cl-' + i;
    div.innerHTML = '<span class="cl-state"></span><span class="cl-id">C' + (i + 1) + '</span><div class="cl-dot"></div>';
    hud.appendChild(div);
  });
  const obj = el('l3-obj');
  if (obj) {
    obj.style.display = 'flex';
    if (!document.getElementById('l3-obj-label')) {
      const lbl = document.createElement('div');
      lbl.id = 'l3-obj-label';
      lbl.textContent = 'ZIELE';
      obj.prepend(lbl);
    }
  }
  updateL3ObjectivesUI(objectives);
}

const _l3HudCache = {
  headerEl: null,
  objLabelEl: null,
  headerText: '',
  headerClass: '',
  objectiveSig: '',
  slots: [],
};

export function updateL3ClusterHUDUI({ clusters, capturedCount, spineNodes, spineLength, fusedPairs, macLinks }) {
  const hdr = _l3HudCache.headerEl || (_l3HudCache.headerEl = document.getElementById('l3-hud-header'));
  if (hdr) {
    const nextText = `${capturedCount} / 8`;
    const nextClass = capturedCount >= 6 ? 'near-win' : '';
    if (_l3HudCache.headerText !== nextText) {
      _l3HudCache.headerText = nextText;
      hdr.innerText = nextText;
    }
    if (_l3HudCache.headerClass !== nextClass) {
      _l3HudCache.headerClass = nextClass;
      hdr.className = nextClass;
    }
  }

  const pairedIdx = new Set();
  const fusedIdx = new Set();
  (macLinks || []).forEach(lk => {
    if (!lk.isHighway) return;
    const ca = clusters[lk.coreA];
    const cb = clusters[lk.coreB];
    if (ca?.captured && cb?.captured) {
      pairedIdx.add(lk.coreA);
      pairedIdx.add(lk.coreB);
    }
  });
  for (const key of fusedPairs || []) {
    const dash = key.indexOf('-');
    fusedIdx.add(+key.slice(0, dash));
    fusedIdx.add(+key.slice(dash + 1));
  }

  clusters.forEach((cl, i) => {
    const slotCache = _l3HudCache.slots[i] || (_l3HudCache.slots[i] = { cls: '', state: '', node: null, stateEl: null });
    const node = slotCache.node || (slotCache.node = document.getElementById('cl-' + i));
    if (!node) return;
    const isPaired = pairedIdx.has(i);
    const isSpine = spineNodes?.has?.(i) && spineLength >= 3;
    const isFused = fusedIdx.has(i);
    let cls = 'cl-slot';
    if (cl._dormant) cls += ' dormant';
    else if (cl.syncWindowOpen) cls += ' open';
    else if (cl.syncReady) cls += ' syncing';
    else if (isFused) cls += ' fused';
    else if (isSpine) cls += ' spine-node';
    else if (isPaired) cls += ' pair-linked';
    else if (cl.captured) cls += ' captured';
    if (slotCache.cls !== cls) {
      slotCache.cls = cls;
      node.className = cls;
    }

    const stateEl = slotCache.stateEl || (slotCache.stateEl = node.querySelector('.cl-state'));
    if (!stateEl) return;
    let s = '';
    if (cl._dormant) s = '—';                        // gedimmt via CSS (.dormant .cl-state)
    else if (cl._eliteType === 'phantom_nexus' && cl._eliteActive && cl.syncWindowOpen) s = '◉phn';
    else if (cl.syncWindowOpen) s = '◉';             // pulsierend (sync window offen)
    else if (cl._eliteType === 'phantom_nexus' && !cl.captured) s = 'phn';
    else if (cl.syncReady) s = '◎';                  // sync bereit
    else if (isFused) s = '⬡⬡';                     // fusioniert
    else if (isSpine) s = '⬟';                       // spine node
    else if (isPaired) s = '⬡';                      // gepaart / verlinkt
    else if (cl.captured) s = '✦';                   // übernommen
    if (slotCache.state !== s) {
      slotCache.state = s;
      stateEl.textContent = s;
    }
  });
}

function formatL3Progress(entry) {
  if (!entry || entry.done) return '';
  const g = G;
  if (!g) return '';
  switch (entry.id) {
    case 'capture1': return ` (${Math.min(1, g.l3CapturedClusters || 0)}/1)`;
    case 'capture4': return ` (${Math.min(4, g.l3CapturedClusters || 0)}/4)`;
    case 'coreConn2': return ` (${Math.min(2, g.l3ConnectedCores || 0)}/2)`;
    case 'spine3': return ` (${Math.min(3, g.spineLength || 0)}/3)`;
    case 'backbone4': return ` (${Math.min(4, g.spineLength || 0)}/4)`;
    case 'allClusters': return ` (${Math.min(8, g.l3CapturedClusters || 0)}/8)`;
    default: return '';
  }
}

export function updateL3ObjectivesUI(objectives = []) {
  const obj = el('l3-obj');
  if (!obj) return;
  const lang = getLang();
  const getLabel = entry => (lang !== 'de' && entry.labelEN) ? entry.labelEN : entry.label;
  const sig = objectives.map((entry, i) => {
    const active = !entry.done && (i === 0 || objectives[i - 1].done);
    return `${entry.done ? 1 : 0}:${active ? 1 : 0}:${lang}:${getLabel(entry)}:${formatL3Progress(entry)}`;
  }).join('|');
  if (_l3HudCache.objectiveSig === sig) return;
  _l3HudCache.objectiveSig = sig;

  const label = _l3HudCache.objLabelEl || (_l3HudCache.objLabelEl = document.getElementById('l3-obj-label'));
  obj.innerHTML = '';
  if (label) obj.appendChild(label);
  objectives.forEach((entry, i) => {
    const row = document.createElement('div');
    const active = !entry.done && (i === 0 || objectives[i - 1].done);
    row.className = 'l3o' + (entry.done ? ' done' : active ? ' active' : '');
    row.innerText = getLabel(entry) + formatL3Progress(entry);
    obj.appendChild(row);
  });
}

let syncDecayRaf = null;
let syncDecayStart = 0;
let syncDecayDuration = 0;
let syncDecayFusion = false;

export function startSyncDecayBarUI(duration, isFusion) {
  const wrap = el('sync-decay-bar-wrap');
  const fill = el('sync-decay-fill');
  if (!wrap || !fill) return;
  syncDecayStart = Date.now();
  syncDecayDuration = duration;
  syncDecayFusion = !!isFusion;
  fill.classList.remove('critical', 'fusion');
  if (syncDecayFusion) fill.classList.add('fusion');
  fill.style.width = '100%';
  wrap.classList.add('vis');
  if (syncDecayRaf) cancelAnimationFrame(syncDecayRaf);

  const tick = () => {
    const elapsed = Date.now() - syncDecayStart;
    const frac = Math.max(0, 1 - (elapsed / Math.max(1, syncDecayDuration)));
    fill.style.width = (frac * 100).toFixed(1) + '%';
    fill.classList.toggle('critical', frac < 0.25 && !syncDecayFusion);
    if (frac > 0 && wrap.classList.contains('vis')) {
      syncDecayRaf = requestAnimationFrame(tick);
    } else {
      wrap.classList.remove('vis');
      syncDecayRaf = null;
    }
  };
  syncDecayRaf = requestAnimationFrame(tick);
}

export function stopSyncDecayBarUI() {
  el('sync-decay-bar-wrap')?.classList.remove('vis');
  if (syncDecayRaf) {
    cancelAnimationFrame(syncDecayRaf);
    syncDecayRaf = null;
  }
}

// ── HUD scheduler — section-level dirty bits, coalesced per frame ─────────
let _hudDirtyMask = 0;
let _hudRaf = null;
const _hudPerf = {
  queuedMasks: 0,
  rafFlushes: 0,
  directFlushes: 0,
  lastMask: 0,
  topFlushes: 0,
  aiFlushes: 0,
  l3Flushes: 0,
  bossFlushes: 0,
};

function _normalizeHudMask(sections) {
  if (!sections || sections.length === 0) return HUD_SECTION_MASK.all;
  let mask = 0;
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section) continue;
    if (typeof section === 'number') { mask |= section; continue; }
    if (Array.isArray(section)) { mask |= _normalizeHudMask(section); continue; }
    mask |= HUD_SECTION_MASK[section] || 0;
  }
  return mask || HUD_SECTION_MASK.all;
}

function _flushHudMask(mask, source = 'direct') {
  _hudPerf.lastMask = mask;
  if (source === 'raf') _hudPerf.rafFlushes++;
  else _hudPerf.directFlushes++;
  if (mask & HUD_SECTION_MASK.top) { _hudPerf.topFlushes++; updateTopHUD(); }
  if (mask & HUD_SECTION_MASK.ai) { _hudPerf.aiFlushes++; updateAIHud(); }
  if ((mask & HUD_SECTION_MASK.l3) && G.l3On) { _hudPerf.l3Flushes++; updateL3ClusterHUD(); }
  if ((mask & HUD_SECTION_MASK.boss) && bossState.bossTriggered) { _hudPerf.bossFlushes++; updateBossHUD(); }
}

function _queueHudMask(mask) {
  if (!mask) return;
  _hudDirtyMask |= mask;
  _hudPerf.queuedMasks++;
  if (_hudRaf !== null) return;
  _hudRaf = requestAnimationFrame(() => {
    const maskNow = _hudDirtyMask || HUD_SECTION_MASK.all;
    _hudDirtyMask = 0;
    _hudRaf = null;
    _flushHudMask(maskNow, 'raf');
  });
}

export function refreshHUDSections(...sections) {
  _queueHudMask(_normalizeHudMask(sections));
}

export function refreshHUDMask(mask) {
  _queueHudMask(mask);
}

export function shouldTickTopHUD(now = Date.now()) {
  if (!G.autoOn) return false;
  if (Math.max(0, G.pulseCd - (now - G.pulseMs)) > 0) return true;
  if (Math.max(0, G.trainCd - (now - G.trainMs)) > 0) return true;
  if (G.l3On) {
    const clusters = G.l3Clusters || [];
    for (let i = 0; i < clusters.length; i++) {
      const cl = clusters[i];
      if (cl?.syncWindowOpen || cl?.syncReady) return true;
    }
  }
  return !!(G.backboneActive || bossState.bossTriggered);
}

export function refreshTopHUD() { refreshHUDSections('top'); }
export function refreshAIHUD() { refreshHUDSections('ai'); }
export function refreshL3HUD() { refreshHUDSections('l3'); }
export function refreshBossHUD() { refreshHUDSections('boss'); }

export function refreshAll() {
  _queueHudMask(HUD_SECTION_MASK.all);
}

export function updateHUD(...sections) {
  _flushHudMask(_normalizeHudMask(sections), 'direct');
}

export function getHUDPerfStats() {
  return {
    ..._hudPerf,
    pendingMask: _hudDirtyMask,
    hasQueuedFlush: _hudRaf !== null,
  };
}
