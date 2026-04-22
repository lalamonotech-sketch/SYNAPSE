import { G } from '../state/gameState.js';
import { synSettings } from '../state/settings.js';

function el(id) {
  return document.getElementById(id);
}

export const activityState = window.__synActivityState || (window.__synActivityState = {
  lastActionTime: Date.now(),
  decayIndicatorActive: false,
});

function syncLegacy() {
  window.__synActivityState = activityState;
}

export function touchActionTime() {
  activityState.lastActionTime = Date.now();
  syncLegacy();
}

export function resetActivityState() {
  activityState.lastActionTime = Date.now();
  activityState.decayIndicatorActive = false;
  const node = el('decay-ind');
  if (node) node.style.opacity = '0';
  syncLegacy();
}

function showDecayIndicator(active) {
  activityState.decayIndicatorActive = !!active;
  const node = el('decay-ind');
  if (node) node.style.opacity = active ? '1' : '0';
}

export function tickEnergyDecay() {
  if (!G.autoOn || G.runWon || G.paused) return;

  const diff = (Date.now() - activityState.lastActionTime) / 1000;
  if (diff < 8) {
    if (activityState.decayIndicatorActive) showDecayIndicator(false);
    return;
  }

  const diffMap = { easy: 0, normal: 0.5, hard: 1.0 };
  const rate = diffMap[synSettings.difficulty || 'normal'] ?? 0.5;
  if (rate === 0) return;

  if (!activityState.decayIndicatorActive) showDecayIndicator(true);
  G.energy = Math.max(10, G.energy - rate / 60);
}

function defineLegacyAlias(key, getter, setter) {
  const desc = Object.getOwnPropertyDescriptor(window, key);
  if (desc && (desc.get || desc.set)) return;
  Object.defineProperty(window, key, {
    configurable: true,
    enumerable: false,
    get: getter,
    set: setter,
  });
}

defineLegacyAlias('_lastActionTime', () => activityState.lastActionTime, value => {
  activityState.lastActionTime = Number(value || Date.now());
  syncLegacy();
});
defineLegacyAlias('_decayIndicatorActive', () => activityState.decayIndicatorActive, value => {
  activityState.decayIndicatorActive = !!value;
  syncLegacy();
});
