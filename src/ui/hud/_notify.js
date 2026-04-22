/**
 * SYNAPSE — HUD notification primitives
 *
 * Toasts, condition chips, hover tips and layer/phase headers.
 * These are leaf helpers that only touch the cached DOM nodes — they
 * never read game state directly.
 *
 * Extracted from hud.js to keep that file focused on the per-tick
 * HUD update pipeline.
 */

import { getLang } from '../../state/settings.js';
import { regTimer, clearTimer } from '../../registries/timerRegistry.js';
import { el } from './_domCache.js';

export function showToast(title, sub = '', dur = 2000) {
  const titleEl = el('t-title');
  const subEl = el('t-sub');
  const toastEl = el('toast');
  if (!titleEl || !subEl || !toastEl) return;
  titleEl.innerText = title || '';
  subEl.innerText = sub || '';
  toastEl.classList.add('show');
  clearTimer('hudToast');
  regTimer('hudToast', setTimeout(() => {
    toastEl.classList.remove('show');
    clearTimer('hudToast');
  }, dur), 'timeout');
}

export function showConditionChip(cond, lang = getLang()) {
  const chip = el('cond-chip');
  if (!chip) return;
  if (!cond) {
    chip.className = '';
    chip.textContent = '';
    return;
  }
  const isStorm = cond.id === 'recursive_storm';
  chip.className = 'vis ' + (isStorm ? 'cc-storm' : 'cc-signal');
  const label = lang === 'de' ? (cond.nameDe || cond.name || cond.id) : (cond.nameEn || cond.name || cond.id);
  chip.textContent = '⟁ ' + label;
}

export function hideConditionChip() {
  const chip = el('cond-chip');
  if (!chip) return;
  chip.className = '';
  chip.textContent = '';
}

export function showTip(cx, cy, txt) {
  const tip = el('node-tip');
  if (!tip) return;
  tip.innerText = txt || '';
  tip.style.left = (cx + 14) + 'px';
  tip.style.top = (cy - 28) + 'px';
  tip.style.visibility = 'visible';
  tip.style.opacity = '1';
}

export function hideTip() {
  const tip = el('node-tip');
  if (!tip) return;
  tip.style.opacity = '0';
  tip.style.visibility = 'hidden';
}

export function setLayerTag(text) {
  const node = el('layer-tag');
  if (!node) return;
  node.innerText = text || '';
  node.classList.remove('shimmer');
  void node.offsetWidth;
  node.classList.add('shimmer');
  clearTimer('hudLayerTagShimmer');
  regTimer('hudLayerTagShimmer', setTimeout(() => {
    node.classList.remove('shimmer');
    clearTimer('hudLayerTagShimmer');
  }, 700), 'timeout');
}

export function setPhaseName(text) {
  const node = el('phase-name');
  if (node) node.innerText = text || '';
}
