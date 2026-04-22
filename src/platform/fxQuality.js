import { synSettings } from '../state/settings.js';

const _state = {
  level: 'high',
  score: 3,
  signalRenderStride: 1,
  bridgeSignalRenderStride: 1,
  shockSpawnStride: 1,
  trailSpawnStride: 1,
  maxShockwaves: 56,
  maxPulseTrails: 24,
  shockStep: 1.4,
  trailRadiusStep: 0.18,
  trailLifeStep: 16,
  bloomBusyStride: 1,
  bloomIdleStride: 2,
  loadScore: 0,
};

let _frameId = 0;
let _lastUpdateT = -1;
let _shockSeq = 0;
let _trailSeq = 0;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function _baseScore() {
  const graphics = synSettings.graphics || 'high';
  const motion = synSettings.motion || 'full';
  let score = graphics === 'low' ? 1 : graphics === 'medium' ? 2 : 3;
  if (motion === 'reduced') score = Math.min(score, 2);
  else if (motion === 'minimal') score = 0;
  return score;
}

function _applyScore(score, loadScore) {
  _state.score = score;
  _state.level = score >= 3 ? 'high' : score === 2 ? 'medium' : score === 1 ? 'low' : 'minimal';
  _state.loadScore = loadScore;

  if (score >= 3) {
    _state.signalRenderStride = 1;
    _state.bridgeSignalRenderStride = 1;
    _state.shockSpawnStride = 1;
    _state.trailSpawnStride = 1;
    _state.maxShockwaves = 56;
    _state.maxPulseTrails = 24;
    _state.shockStep = 1.4;
    _state.trailRadiusStep = 0.18;
    _state.trailLifeStep = 16;
    _state.bloomBusyStride = 1;
    _state.bloomIdleStride = 2;
    return;
  }
  if (score === 2) {
    _state.signalRenderStride = 1;
    _state.bridgeSignalRenderStride = 1;
    _state.shockSpawnStride = 1;
    _state.trailSpawnStride = 2;
    _state.maxShockwaves = 32;
    _state.maxPulseTrails = 12;
    _state.shockStep = 1.9;
    _state.trailRadiusStep = 0.22;
    _state.trailLifeStep = 22;
    _state.bloomBusyStride = 1;
    _state.bloomIdleStride = 3;
    return;
  }
  if (score === 1) {
    _state.signalRenderStride = 2;
    _state.bridgeSignalRenderStride = 2;
    _state.shockSpawnStride = 2;
    _state.trailSpawnStride = 3;
    _state.maxShockwaves = 18;
    _state.maxPulseTrails = 6;
    _state.shockStep = 2.4;
    _state.trailRadiusStep = 0.28;
    _state.trailLifeStep = 30;
    _state.bloomBusyStride = 2;
    _state.bloomIdleStride = 4;
    return;
  }
  _state.signalRenderStride = 3;
  _state.bridgeSignalRenderStride = 3;
  _state.shockSpawnStride = 3;
  _state.trailSpawnStride = 9999;
  _state.maxShockwaves = 8;
  _state.maxPulseTrails = 0;
  _state.shockStep = 3.0;
  _state.trailRadiusStep = 0.34;
  _state.trailLifeStep = 40;
  _state.bloomBusyStride = 3;
  _state.bloomIdleStride = 5;
}

export function tickFxFrame() {
  _frameId++;
  return _frameId;
}

export function updateFxQuality(t, perfStats, load = {}) {
  if (_lastUpdateT >= 0 && (t - _lastUpdateT) < 0.45) return _state;
  _lastUpdateT = t;

  let score = _baseScore();
  const fps = perfStats?.fps || 0;
  const budgetPct = perfStats?.frameBudgetPct || 0;

  if (fps > 0) {
    if (fps < 55) score--;
    if (fps < 45) score--;
    if (fps < 35) score--;
    if (budgetPct > 105) score--;
    if (budgetPct > 135) score--;
  }

  const signalCount = load.signalCount || 0;
  const bridgeSignalCount = load.bridgeSignalCount || 0;
  const shockwaveCount = load.shockwaveCount || 0;
  const pulseTrailCount = load.pulseTrailCount || 0;
  const nodeCount = load.nodeCount || 0;
  const linkCount = load.linkCount || 0;
  const loadScore = signalCount + bridgeSignalCount + shockwaveCount * 4 + pulseTrailCount * 3 + nodeCount * 0.15 + linkCount * 0.1;

  if (loadScore > 170) score--;
  if (loadScore > 260) score--;
  if (loadScore > 360) score--;

  score = clamp(score, 0, 3);
  _applyScore(score, Math.round(loadScore));
  return _state;
}

export function shouldCommitSignalVisual(kind = 'signal') {
  const stride = kind === 'bridge' ? _state.bridgeSignalRenderStride : _state.signalRenderStride;
  return stride <= 1 || (_frameId % stride) === 0;
}

export function shouldSpawnShock(priority = 0) {
  if (_state.maxShockwaves <= 0) return false;
  if (priority >= 2) return true;
  _shockSeq++;
  const stride = priority > 0 ? Math.max(1, _state.shockSpawnStride - 1) : _state.shockSpawnStride;
  return stride <= 1 || (_shockSeq % stride) === 0;
}

export function shouldSpawnPulseTrail(priority = 0) {
  if (_state.maxPulseTrails <= 0) return false;
  if (priority >= 2) return true;
  _trailSeq++;
  const stride = priority > 0 ? Math.max(1, _state.trailSpawnStride - 1) : _state.trailSpawnStride;
  return stride <= 1 || (_trailSeq % stride) === 0;
}

export function getBloomFrameStride(isBusy = false) {
  return isBusy ? _state.bloomBusyStride : _state.bloomIdleStride;
}

export function getFxQualityStats() {
  return {
    frameId: _frameId,
    ..._state,
  };
}

window._getFxQualityStats = getFxQualityStats;

/**
 * v98: Detect low-end device at startup and pre-set graphics to 'low'.
 * Called once from main.js before the game loop starts.
 * Heuristics: deviceMemory < 2GB, hardwareConcurrency <= 2, or iOS < 14.
 * Only auto-downgrades if the user hasn't explicitly set a preference.
 */
export function autoDetectGraphicsQuality() {
  try {
    // Don't override explicit user setting
    const saved = synSettings.graphics;
    if (saved && saved !== 'high') return; // user already chose lower — respect it

    const mem = navigator.deviceMemory;         // GB, undefined on Firefox/Safari
    const cpus = navigator.hardwareConcurrency; // logical cores, may be 1 on old phones

    let isLowEnd = false;
    if (typeof mem === 'number' && mem < 2) isLowEnd = true;
    if (typeof cpus === 'number' && cpus <= 2) isLowEnd = true;

    // iOS version heuristic via userAgent (rough: iPhone with iOS < 15)
    const ua = navigator.userAgent;
    const iosMatch = ua.match(/OS (\d+)_/);
    if (iosMatch && parseInt(iosMatch[1]) < 15) isLowEnd = true;

    if (isLowEnd) {
      synSettings.graphics = 'low';
      document.documentElement.setAttribute('data-graphics', 'low');
      console.info('[Synapse] Low-end device detected — graphics set to low automatically. ' +
        `(deviceMemory=${mem}, hardwareConcurrency=${cpus})`);
    }
  } catch (e) {
    // Non-blocking — best-effort only
    if (import.meta.env.DEV) console.warn('[FxQuality] autoDetect failed:', e);
  }
}
