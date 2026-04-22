/**
 * SYNAPSE — Run history persistence
 *
 * Owns the localStorage layout for completed-run records: primary key,
 * backup key, retention cap, and a small XSS-safe HTML escape utility
 * used everywhere persisted profile/trait/event data is rendered.
 *
 * Extracted from meta/screens.js so cache invalidation lives in one place
 * and the much larger screen-rendering module stays focused on UI.
 */

export const LS_RUN_HISTORY = 'syn_run_history';
export const LS_RUN_HISTORY_BACKUP = 'syn_run_history_bak';
export const MAX_HISTORY = 24;

let _runHistoryCache = null;

/**
 * Escape HTML special characters in a string before embedding into
 * innerHTML. Defends against accidental markup or XSS via persisted
 * profile/trait/event data loaded from localStorage.
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function loadRunHistory() {
  if (_runHistoryCache) return _runHistoryCache;
  for (const key of [LS_RUN_HISTORY, LS_RUN_HISTORY_BACKUP]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) continue;
      _runHistoryCache = arr;
      if (key === LS_RUN_HISTORY_BACKUP) {
        try { localStorage.setItem(LS_RUN_HISTORY, raw); } catch (_) {}
      }
      return _runHistoryCache;
    } catch (_) {}
  }
  _runHistoryCache = [];
  return _runHistoryCache;
}

export function saveRunHistory(history) {
  const next = (history || []).slice(-MAX_HISTORY);
  _runHistoryCache = next;
  try {
    const raw = JSON.stringify(next);
    localStorage.setItem(LS_RUN_HISTORY, raw);
    localStorage.setItem(LS_RUN_HISTORY_BACKUP, raw);
  } catch (_) {}
}

/** Drop the in-memory cache so the next read goes back to storage. */
export function invalidateRunHistoryCache() {
  _runHistoryCache = null;
}
