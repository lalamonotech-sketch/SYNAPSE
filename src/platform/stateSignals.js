/**
 * SYNAPSE v95 — State signal bus
 *
 * Lightweight, allocation-free HUD/state dirty signal aggregation. Gameplay
 * systems emit semantic signals; the game loop consumes them once per frame and
 * forwards the resulting HUD mask to the scheduler. This reduces direct UI
 * coupling and cuts redundant broad refresh calls.
 */

export const HUD_SECTION_MASK = Object.freeze({
  top: 1,
  ai: 2,
  l3: 4,
  boss: 8,
  all: 15,
});

let _pendingHudMask = 0;
const _perf = {
  emits: 0,
  consumes: 0,
  lastMask: 0,
  topSignals: 0,
  aiSignals: 0,
  l3Signals: 0,
  bossSignals: 0,
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

function _recordMask(mask) {
  if (mask & HUD_SECTION_MASK.top) _perf.topSignals++;
  if (mask & HUD_SECTION_MASK.ai) _perf.aiSignals++;
  if (mask & HUD_SECTION_MASK.l3) _perf.l3Signals++;
  if (mask & HUD_SECTION_MASK.boss) _perf.bossSignals++;
}

export function signalHUDSections(...sections) {
  const mask = _normalizeHudMask(sections);
  if (!mask) return 0;
  _pendingHudMask |= mask;
  _perf.emits++;
  _perf.lastMask = mask;
  _recordMask(mask);
  return mask;
}

export function signalTopHUD() { return signalHUDSections('top'); }
export function signalAIChanged() { return signalHUDSections('top', 'ai'); }
export function signalTopologyChanged() { return signalHUDSections('top', 'ai'); }
export function signalEnergyChanged() { return signalHUDSections('top'); }
export function signalLayer3Changed() { return signalHUDSections('top', 'l3'); }
export function signalBossChanged() { return signalHUDSections('top', 'boss'); }
export function signalRunStateChanged() { return signalHUDSections('top', 'ai', 'l3', 'boss'); }

export function consumeHUDSignalMask() {
  const mask = _pendingHudMask;
  if (!mask) return 0;
  _pendingHudMask = 0;
  _perf.consumes++;
  _perf.lastMask = mask;
  return mask;
}

export function peekHUDSignalMask() {
  return _pendingHudMask;
}

export function getStateSignalStats() {
  return {
    ..._perf,
    pendingMask: _pendingHudMask,
  };
}
