/**
 * SYNAPSE — Safe AudioContext probe
 *
 * If the browser blocks/crashes AudioContext creation we surface ONE banner.
 * The SFX module already silently no-ops when audio fails — this complements
 * it by telling the player audio is off and why.
 */

import { getLang } from '../state/settings.js';

let _checked = false;
let _ok = null;

const MESSAGES = {
  de: 'Audio ist in diesem Browser/Modus blockiert — Soundeffekte sind deaktiviert.',
  en: 'Audio is blocked in this browser/mode — sound effects are disabled.',
};

export function checkAudioHealth() {
  if (_checked) return _ok;
  _checked = true;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) throw new Error('AudioContext unsupported');
    // Probe without keeping a context running: create + close.
    const ctx = new Ctor();
    if (ctx.state === 'closed') throw new Error('AudioContext closed immediately');
    ctx.close?.();
    _ok = true;
  } catch (e) {
    _ok = false;
    const banner = document.getElementById('prod-status-banner');
    if (banner) {
      const lang = (() => { try { return getLang(); } catch (_) { return 'de'; } })();
      // Don't override an existing banner
      if (!banner.textContent || !banner.style.display || banner.style.display === 'none') {
        banner.dataset.level = 'warn';
        banner.style.display = 'block';
        banner.textContent = MESSAGES[lang] || MESSAGES.de;
      }
    }
  }
  return _ok;
}
