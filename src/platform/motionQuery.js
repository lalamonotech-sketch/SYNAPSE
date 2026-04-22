/**
 * platform/motionQuery — single source of truth for prefers-reduced-motion.
 *
 * Replaces multiple ad-hoc `window.matchMedia('(prefers-reduced-motion: reduce)')`
 * subscriptions across cameraFX, visualEnhancer, etc.
 *
 * Usage:
 *   import { prefersReducedMotion, onMotionPreferenceChange } from '../../platform/motionQuery.js';
 *   if (prefersReducedMotion()) { ... }
 *   onMotionPreferenceChange((reduced) => { ... });
 */

const _query = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

const _listeners = new Set();

if (_query && typeof _query.addEventListener === 'function') {
  _query.addEventListener('change', (e) => {
    for (const fn of _listeners) {
      try { fn(e.matches); } catch (_) { /* swallow */ }
    }
  });
}

/** @returns {boolean} true if user prefers reduced motion (or no matchMedia). */
export function prefersReducedMotion() {
  return !!(_query && _query.matches);
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function onMotionPreferenceChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
