/**
 * SYNAPSE v95 — Listener Registry
 *
 * Every addEventListener call must go through regListener so that
 * clearAllListeners() can guarantee zero leaked handlers before reload.
 *
 * Usage:
 *   import { regListener, clearAllListeners } from './listenerRegistry.js';
 *
 *   // Instead of: element.addEventListener('click', handler)
 *   regListener(element, 'click', handler);
 *
 *   // Before reload:
 *   clearAllListeners();
 */

/** @type {Array<{el: EventTarget, event: string, fn: Function, options: any}>} */
const _LISTENERS = [];

/**
 * Register and immediately attach an event listener.
 * @param {EventTarget} el      - DOM element or window/document
 * @param {string}      event   - event name, e.g. 'click', 'keydown'
 * @param {Function}    fn      - handler function
 * @param {object|boolean} [options] - addEventListener options
 */
export function regListener(el, event, fn, options) {
  if (!el || !event || typeof fn !== 'function') return;
  el.addEventListener(event, fn, options);
  _LISTENERS.push({ el, event, fn, options });
}

/**
 * Remove all registered listeners and clear the registry.
 * Called in the dispose chain before any location.reload().
 */
export function clearAllListeners() {
  _LISTENERS.forEach(({ el, event, fn, options }) => {
    try { el.removeEventListener(event, fn, options); } catch (_) {}
  });
  _LISTENERS.length = 0;
}

/** Debug: how many listeners are currently registered. */
export function listenerCount() {
  return _LISTENERS.length;
}

// ── Backwards-compat globals ───────────────────────────────────────────────
window._LISTENERS         = _LISTENERS;
window._regListener       = regListener;
window._clearAllListeners = clearAllListeners;
