import { controls } from '../engine/scene.js';
import { regTimer, clearTimer } from '../registries/timerRegistry.js';
import { G } from '../state/gameState.js';
import { THRESHOLDS, setLayerTag, setPhaseName, showToast, updateHUD } from '../ui/hud/index.js';
import { getEarlyGameSupportSummary } from './balance.js';
import { getLang } from '../state/settings.js';
import { gameNodes, gameLinks } from '../layers/network/index.js';
import { bLinks, initLayer2, getActiveBridgeCount } from '../layers/bridge/index.js';
import { macNodes, initLayer3 } from '../layers/meta/index.js';
import { initAwakeningOnRunStart } from '../systems/awakening.js'; // v98

const N_IDS = { source: 'bn-src', relay: 'bn-rly', amplifier: 'bn-amp', memory: 'bn-mem' };
const L_IDS = { stable: 'bl-stb', fast: 'bl-fst', resonance: 'bl-res', fragile: 'bl-frg' };

let phaseLock = false;

function objLineEl() {
  return document.getElementById('obj-line');
}

function formatObjectiveProgress(entry, activeBridges) {
  if (!entry) return '';
  switch (entry.id) {
    case 'triangle': return ` (${Math.min(1, G.tris.size)}/1)`;
    case 'memFull': return ` (${Math.min(25, Math.round(G.memMaxOutput || 0))}/25)`;
    case 'bridge1': return ` (${Math.min(1, activeBridges)}/1)`;
    case 'bridge3': return ` (${Math.min(3, activeBridges)}/3)`;
    case 'pulse2': return ` (${Math.min(2, G.pulseCount || 0)}/2)`;
    // L2 objectives
    case 'bridgeEnergy':  return ` (${Math.min(50, Math.round(G.l2ObjBridgeEnergyAccum || 0))}/50)`;
    case 'bridges4':      return ` (${Math.min(4, activeBridges)}/4)`;
    case 'bridgeSustain': return ` (${Math.min(20, Math.round((G.l2ObjBridgeSustainMs || 0) / 1000))}s/20s)`;
    default: return '';
  }
}

/** Returns the localised label for an objective entry. */
function getObjectiveLabel(entry) {
  const lang = getLang();
  if (lang !== 'de' && entry.labelEN) return entry.labelEN;
  return entry.label;
}

export function updateObjectiveLine() {
  const el = objLineEl();
  if (!el) return;
  const activeBridges = getActiveBridgeCount();

  // L1 objectives first (always shown until all done)
  const activeL1 = G.objectives?.find(entry => !entry.done);
  if (activeL1) {
    el.className = '';
    el.innerText = getObjectiveLabel(activeL1) + formatObjectiveProgress(activeL1, activeBridges);
    return;
  }

  // L2 objectives: shown when L2 is active and L3 is not yet active
  if (G.l2On && !G.l3On) {
    const activeL2 = G.l2Objectives?.find(entry => !entry.done);
    if (activeL2) {
      el.className = '';
      el.innerText = getObjectiveLabel(activeL2) + formatObjectiveProgress(activeL2, activeBridges);
      return;
    }
    // All L2 objectives done but L3 not yet unlocked
    el.className = 'done';
    el.innerText = getLang() === 'de' ? '✓ Convergence abgeschlossen — Apex nähert sich' : '✓ Convergence complete — Apex approaching';
    return;
  }

  // L3 is active: show L3 objectives in the main slot (not just the L3 panel)
  if (G.l3On) {
    const activeL3 = G.l3Objectives?.find(entry => !entry.done);
    if (activeL3) {
      el.className = '';
      el.innerText = getObjectiveLabel(activeL3) + formatObjectiveProgress(activeL3, activeBridges);
      return;
    }
    el.className = 'done';
    el.innerText = getLang() === 'de' ? '✓ Apex-Ziele erreicht — Boss-Begegnung aktiv' : '✓ Apex objectives complete — Boss encounter active';
    return;
  }

  // Fallback: all L1 done, L2 not yet active
  el.className = 'done';
  el.innerText = getLang() === 'de' ? '✓ Alle Zwischenziele erreicht' : '✓ All objectives complete';
}

export function setMode(mode) {
  if (G.paused) return;
  if (mode === 'connect' && gameNodes.length < THRESHOLDS.connectAt) {
    const missing = Math.max(0, THRESHOLDS.connectAt - gameNodes.length);
    const lang = getLang();
    if (lang === 'de') {
      showToast('Verbinden noch gesperrt', `${missing} ${missing === 1 ? 'weiteres Neuron' : 'weitere Neuronen'} für den Verbindungsmodus`, 1400);
    } else {
      showToast('Connect locked', `${missing} more ${missing === 1 ? 'node' : 'nodes'} needed`, 1400);
    }
    return;
  }

  G.mode = mode;
  G.selected = null;

  document.getElementById('btn-p')?.classList.toggle('active', mode === 'place');
  document.getElementById('btn-c')?.classList.toggle('active', mode === 'connect');

  const nodeBar = document.getElementById('nb');
  const linkBar = document.getElementById('lb');
  // Always reflect the current mode in the type-bar visibility so the build
  // menu is visible from the start; lock individual disabled types via the
  // .locked class instead of hiding the whole strip.
  if (nodeBar) nodeBar.style.display = mode === 'place' ? 'flex' : 'none';
  if (linkBar) linkBar.style.display = mode === 'connect' ? 'flex' : 'none';
  document.body.dataset.mode = mode;
  updateHUD();
}

export function setNodeType(type) {
  if (G.paused) return;
  G.nType = type;
  Object.values(N_IDS).forEach(id => document.getElementById(id)?.classList.remove('on'));
  document.getElementById(N_IDS[type])?.classList.add('on');
  updateHUD();
}

export function setLinkType(type) {
  if (G.paused) return;
  G.lType = type;
  Object.values(L_IDS).forEach(id => document.getElementById(id)?.classList.remove('on'));
  document.getElementById(L_IDS[type])?.classList.add('on');
  updateHUD();
}

function ensureLayer2Init() {
  if (bLinks.length > 0) return;
  initLayer2();
}

function ensureLayer3Init() {
  if (macNodes.length > 0) return;
  initLayer3();
}

export function checkObjectives() {
  const activeBridges = getActiveBridgeCount();
  const checks = {
    triangle: G.tris.size >= 1,
    memFull:  G.memMaxOutput >= 25,
    bridge1:  activeBridges >= 1,
    bridge3:  activeBridges >= 3,
    pulse2:   G.pulseCount >= 2,
  };

  const lang = getLang();
  let changed = false;
  (G.objectives || []).forEach(entry => {
    if (!entry.done && checks[entry.id]) {
      entry.done = true;
      changed = true;
      const toastTitle = lang === 'de' ? 'ZIEL ERREICHT ✓' : 'OBJECTIVE COMPLETE ✓';
      // Strip leading icon token (e.g. "◎ ") before showing in toast body
      const toastBody = getObjectiveLabel(entry).replace(/^[^\s]+\s/, '');
      showToast(toastTitle, toastBody, 2800);
    }
  });

  if (changed) {
    updateObjectiveLine();
    updateHUD();
  }
}

/** Track and check L2 objectives. Call from bridge tick + game loop. */
export function checkL2Objectives(bridgeEnergyGainThisTick = 0, deltaMs = 0) {
  if (!G.l2On || G.l3On) return; // only active during L2 phase
  const lang = getLang();
  const activeBridges = getActiveBridgeCount();
  let changed = false;

  // Accumulate bridge energy for bridgeEnergy objective
  G.l2ObjBridgeEnergyAccum = (G.l2ObjBridgeEnergyAccum || 0) + bridgeEnergyGainThisTick;

  // Accumulate sustain time when >= 2 bridges are active
  if (activeBridges >= 2) {
    G.l2ObjBridgeSustainMs = (G.l2ObjBridgeSustainMs || 0) + deltaMs;
  }

  const checks = {
    bridgeEnergy:  (G.l2ObjBridgeEnergyAccum || 0) >= 50,
    bridges4:      activeBridges >= 4,
    bridgeSustain: (G.l2ObjBridgeSustainMs || 0) >= 20000,
  };

  (G.l2Objectives || []).forEach(entry => {
    if (!entry.done && checks[entry.id]) {
      entry.done = true;
      changed = true;
      const toastTitle = lang === 'de' ? 'L2-ZIEL ERREICHT ✓' : 'L2 OBJECTIVE COMPLETE ✓';
      const toastBody = getObjectiveLabel(entry).replace(/^[^\s]+\s/, '');
      showToast(toastTitle, toastBody, 2800);
    }
  });

  if (changed) {
    updateObjectiveLine();
    updateHUD();
  }
}

export function checkPhase() {
  if (phaseLock || G.runWon) return;
  phaseLock = true;
  regTimer('phaseLockReset', setTimeout(() => {
    phaseLock = false;
    clearTimer('phaseLockReset');
  }, 400), 'timeout');

  const nodeCount = gameNodes.length;
  const linkCount = gameLinks.length;
  const energy = G.energy;
  const activeBridges = getActiveBridgeCount();

  document.getElementById('btn-c')?.toggleAttribute('disabled', nodeCount < THRESHOLDS.connectAt);

  const lang = getLang();

  if (!G.typesOn && nodeCount >= THRESHOLDS.connectAt) {
    G.typesOn = true;
    document.getElementById('type-bar')?.classList.add('vis');
    const nodeBar = document.getElementById('nb');
    const linkBar = document.getElementById('lb');
    if (nodeBar) nodeBar.style.display = G.mode === 'place' ? 'flex' : 'none';
    if (linkBar) linkBar.style.display = G.mode === 'connect' ? 'flex' : 'none';
    showToast(
      lang === 'de' ? 'KNOTENTYPEN' : 'NODE TYPES',
      'Source · Relay · Amplifier · Memory',
      3200
    );
  }

  if (!G.autoOn && nodeCount >= THRESHOLDS.autoN && linkCount >= THRESHOLDS.autoL && energy >= THRESHOLDS.autoE) {
    G.autoOn = true;
    setLayerTag(lang === 'de' ? 'SCHICHT 01 · RESONANCE' : 'LAYER 01 · RESONANCE');
    setPhaseName('Resonance');
    const support = getEarlyGameSupportSummary(lang);
    const autoBody = lang === 'de'
      ? (support ? `Hauptneuronen expandieren selbstständig · ${support}` : 'Hauptneuronen expandieren selbstständig')
      : (support ? `Core neurons expanding autonomously · ${support}` : 'Core neurons expanding autonomously');
    showToast('AUTO-GENESIS', autoBody, 4200);
    document.getElementById('btn-pulse')?.removeAttribute('disabled');
    document.getElementById('btn-train')?.removeAttribute('disabled');
  }

  if (!G.l2On && nodeCount >= THRESHOLDS.l2N && linkCount >= THRESHOLDS.l2L) {
    G.l2On = true;
    setLayerTag(lang === 'de' ? 'SCHICHT 02 · CONVERGENCE' : 'LAYER 02 · CONVERGENCE');
    setPhaseName('Convergence');
    showToast(
      lang === 'de' ? 'SCHICHT 2' : 'LAYER 2',
      lang === 'de' ? 'Blaue Neuronen erwachen' : 'Blue neurons awakening',
      3800
    );
    regTimer('phaseUnlockL2', setTimeout(() => {
      clearTimer('phaseUnlockL2');
      ensureLayer2Init();
    }, 1400), 'timeout');
    controls.autoRotateSpeed = 0.3;
  }

  if (!G.l3On && G.l2On && nodeCount >= THRESHOLDS.l3N && activeBridges >= THRESHOLDS.l3Bridges) {
    G.l3On = true;
    setLayerTag(lang === 'de' ? 'SCHICHT 03 · APEX' : 'LAYER 03 · APEX');
    setPhaseName('Apex');
    showToast(
      lang === 'de' ? 'SCHICHT 3' : 'LAYER 3',
      lang === 'de' ? 'Globale Cluster formieren sich' : 'Global clusters forming',
      4000
    );
    regTimer('phaseUnlockL3', setTimeout(() => {
      clearTimer('phaseUnlockL3');
      ensureLayer3Init();
    }, 2200), 'timeout');
    controls.autoRotateSpeed = 0.15;
  }

  updateObjectiveLine();
  updateHUD();
}

export function syncModeTypeUI() {
  setMode(G.mode || 'place');
  setNodeType(G.nType || 'source');
  setLinkType(G.lType || 'stable');
  updateObjectiveLine();
  updateHUD();
}
