/**
 * SYNAPSE — Safe localStorage Wrapper
 *
 * Replaces silent try/catch around localStorage. Detects:
 *   - Private/Incognito mode (storage throws on write)
 *   - Quota exhaustion
 *   - Disabled storage (SecurityError)
 *
 * Surfaces ONE persistent, dismissible banner via #prod-status-banner so the
 * player learns their progress will not survive a refresh — instead of finding
 * out the hard way.
 */

import { getLang } from '../state/settings.js';

let _healthy = null;        // tri-state: null = unknown, true = ok, false = broken
let _bannerShown = false;
let _lastError = '';

const MESSAGES = {
  de: {
    title: 'Speicher-Warnung',
    body: 'Dein Browser blockiert lokalen Speicher (z. B. Inkognito-Modus). ' +
          'Fortschritt und Einstellungen können in dieser Sitzung nicht dauerhaft gesichert werden.',
    dismiss: 'Verstanden',
  },
  en: {
    title: 'Storage warning',
    body: 'Your browser is blocking local storage (e.g. Private mode). ' +
          'Progress and settings cannot be persisted across reloads in this session.',
    dismiss: 'Got it',
  },
};

function _showBanner() {
  if (_bannerShown) return;
  _bannerShown = true;
  const banner = document.getElementById('prod-status-banner');
  if (!banner) return;
  const lang = (() => { try { return getLang(); } catch (_) { return 'de'; } })();
  const m = MESSAGES[lang] || MESSAGES.de;
  banner.dataset.level = 'warn';
  banner.style.display = 'block';
  banner.textContent = '';
  const title = document.createElement('strong');
  title.textContent = m.title + ' · ';
  const body  = document.createElement('span');
  body.textContent = m.body;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '  ' + m.dismiss;
  close.style.marginLeft = '12px';
  close.style.background = 'transparent';
  close.style.border = '1px solid currentColor';
  close.style.color = 'inherit';
  close.style.padding = '2px 10px';
  close.style.borderRadius = '4px';
  close.style.cursor = 'pointer';
  close.addEventListener('click', () => { banner.style.display = 'none'; });
  banner.appendChild(title);
  banner.appendChild(body);
  banner.appendChild(close);
}

/**
 * Probe storage with a no-op write. Caches result.
 */
export function checkStorageHealth() {
  if (_healthy !== null) return _healthy;
  try {
    const k = '__syn_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    _healthy = true;
  } catch (e) {
    _healthy = false;
    _lastError = e?.message || String(e);
    _showBanner();
  }
  return _healthy;
}

export function isStorageHealthy() { return _healthy === true; }
export function lastStorageError() { return _lastError; }

export const safeStorage = {
  get(key, fallback = null) {
    try { return localStorage.getItem(key); }
    catch (e) {
      _healthy = false;
      _lastError = e?.message || String(e);
      _showBanner();
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      if (_healthy === false) _healthy = true; // recovery
      return true;
    } catch (e) {
      _healthy = false;
      _lastError = e?.message || String(e);
      _showBanner();
      return false;
    }
  },
  remove(key) {
    try { localStorage.removeItem(key); return true; }
    catch (e) { _lastError = e?.message || String(e); return false; }
  },
};

// Probe immediately so the banner appears within the first frame if needed.
if (typeof window !== 'undefined' && document.readyState !== 'loading') {
  queueMicrotask(checkStorageHealth);
} else if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', checkStorageHealth, { once: true });
}
