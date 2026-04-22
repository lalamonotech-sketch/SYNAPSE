/**
 * SYNAPSE v95 — Timer Registry
 *
 * Central registry for all setInterval / setTimeout handles.
 * Every timer in the codebase must go through _regTimer so that
 * _clearAllTimers() can guarantee a clean slate before reload.
 *
 * Usage:
 *   import { regTimer, clearTimer, clearAllTimers } from './timerRegistry.js';
 *   regTimer('autoSave', setInterval(fn, 25000), 'interval');
 *   clearTimer('autoSave');
 *   clearAllTimers(); // called in dispose chain
 */

// Internal store: key -> { id, type }
const _TIMERS = {};

/**
 * Register a timer handle under a named key.
 * If a timer already exists under that key, it is cleared first (using its stored type).
 * @param {string} key   - unique name, e.g. 'autoSave', 'diagRefresh'
 * @param {number} id    - return value of setInterval / setTimeout
 * @param {'interval'|'timeout'} type
 */
export function regTimer(key, id, type = 'interval') {
  if (_TIMERS[key]) {
    // Clear using the STORED type of the previous registration
    _TIMERS[key].type === 'interval'
      ? clearInterval(_TIMERS[key].id)
      : clearTimeout(_TIMERS[key].id);
  }
  _TIMERS[key] = { id, type };
}

/**
 * Clear and deregister a single named timer.
 * Safe to call even if the key was never registered.
 */
export function clearTimer(key) {
  if (_TIMERS[key]) {
    _TIMERS[key].type === 'interval'
      ? clearInterval(_TIMERS[key].id)
      : clearTimeout(_TIMERS[key].id);
    delete _TIMERS[key];
  }
}

/** Clear every registered timer. Call before any location.reload(). */
export function clearAllTimers() {
  Object.keys(_TIMERS).forEach(k => clearTimer(k));
}

/** Read-only snapshot of active timer keys (for debugging). */
export function activeTimerKeys() {
  return Object.keys(_TIMERS);
}

// ── Legacy window bridge (consumed by dispose chain + debug console) ──────────
// Remove these once all callsites are migrated to ES imports.
// Backwards-compat: expose flat id map for legacy code that does _TIMERS[key]
Object.defineProperty(window, '_TIMERS', {
  get: () => Object.fromEntries(Object.entries(_TIMERS).map(([k,v]) => [k, v.id])),
  configurable: true
});
window._regTimer       = regTimer;
window._clearTimer     = clearTimer;
window._clearAllTimers = clearAllTimers;
