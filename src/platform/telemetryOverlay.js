/**
 * Telemetry Overlay — diagnostic HUD for verifying registry hygiene.
 *
 * Shows live counts of active timers, listeners, and unlocked techs in a
 * tiny fixed-position panel. Useful for confirming nothing leaks across
 * run-restart and that tech state is in sync.
 *
 * Toggle: Ctrl+Shift+D (or set window._SYN_TELEMETRY = true to force-open).
 * Updates twice per second when visible.
 */

import { activeTimerKeys } from '../registries/timerRegistry.js';
import { listenerCount } from '../registries/listenerRegistry.js';
import { regListener } from '../registries/listenerRegistry.js';
import { regTimer } from '../registries/timerRegistry.js';
import { G } from '../state/gameState.js';

let _panel = null;
let _visible = false;

function _ensurePanel() {
  if (_panel) return _panel;
  _panel = document.createElement('div');
  _panel.id = 'syn-telemetry';
  Object.assign(_panel.style, {
    position:      'fixed',
    bottom:        '8px',
    right:         '8px',
    zIndex:        99999,
    padding:       '8px 10px',
    background:    'rgba(8,12,18,0.85)',
    color:         '#9af0d4',
    font:          '11px/1.45 ui-monospace,Menlo,Consolas,monospace',
    border:        '1px solid #1f3a44',
    borderRadius:  '6px',
    pointerEvents: 'none',
    maxWidth:      '320px',
    whiteSpace:    'pre',
    letterSpacing: '0.02em',
    boxShadow:     '0 4px 18px rgba(0,0,0,0.5)',
    display:       'none',
  });
  document.body.appendChild(_panel);
  return _panel;
}

function _render() {
  if (!_visible) return;
  const p = _ensurePanel();
  const timers = activeTimerKeys();
  const techs = (G.tech && G.tech.unlocked) ? Array.from(G.tech.unlocked) : [];
  p.textContent =
    `▌ SYN TELEMETRY  (Ctrl+Shift+D)\n` +
    `─────────────────────────────\n` +
    `Timers   : ${timers.length}\n` +
    (timers.length ? `  · ${timers.join('\n  · ')}\n` : '') +
    `Listeners: ${listenerCount()}\n` +
    `Techs    : ${techs.length}\n` +
    (techs.length ? `  · ${techs.join('\n  · ')}\n` : '');
}

function _setVisible(v) {
  _visible = !!v;
  const p = _ensurePanel();
  p.style.display = _visible ? 'block' : 'none';
  if (_visible) _render();
}

export function initTelemetryOverlay() {
  if (typeof window === 'undefined') return;

  // Hotkey: Ctrl+Shift+D
  regListener(window, 'keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      _setVisible(!_visible);
    }
  });

  // Refresh loop (cheap — only paints when visible)
  regTimer('telemetryOverlay', setInterval(_render, 500), 'interval');

  // Allow programmatic open via console: window._SYN_TELEMETRY = true
  Object.defineProperty(window, '_SYN_TELEMETRY', {
    get: () => _visible,
    set: _setVisible,
    configurable: true,
  });
}
