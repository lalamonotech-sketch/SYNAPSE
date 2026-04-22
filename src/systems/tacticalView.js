/**
 * SYNAPSE — Tactical View toggle
 *
 * Adds a flat-blueprint mode that disables bloom/glow/blur for at-a-glance
 * network analysis (driven entirely by `body[data-tactical]`).
 *
 * Also tries to dim the WebGL bloom pass when the renderer exposes a
 * `setStrength(n)` hook, but works as pure CSS otherwise.
 */

import { showToast } from '../ui/hud/index.js';

let _on = false;
let _previousBloom = null;

function _setBloomStrength(value) {
  // Bloom pass lives on window._comp (legacy bridge from scene.js)
  const comp = window._comp;
  if (!comp) return null;
  const passes = comp.passes || [];
  for (const pass of passes) {
    if (pass && typeof pass.strength === 'number') {
      const prev = pass.strength;
      pass.strength = value;
      return prev;
    }
  }
  return null;
}

export function isTacticalOn() { return _on; }

export function setTactical(on) {
  _on = !!on;
  document.body.dataset.tactical = _on ? 'on' : 'off';
  if (_on) {
    _previousBloom = _setBloomStrength(0.05);
  } else if (_previousBloom !== null) {
    _setBloomStrength(_previousBloom);
    _previousBloom = null;
  }
  try {
    showToast(_on ? '◇ TACTICAL VIEW' : '◆ NORMAL VIEW', '', 700);
  } catch (_) {}
}

export function toggleTactical() { setTactical(!_on); }
