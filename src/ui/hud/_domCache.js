/**
 * SYNAPSE — HUD DOM cache + threshold table
 *
 * Centralised DOM lookup so HUD updates avoid repeated
 * document.getElementById() traffic on every tick.
 *
 * Extracted from hud.js so layout/threshold tweaks are findable and the
 * main HUD module stays focused on update logic.
 */

export const THRESHOLDS = window.T || {
  connectAt: 3,
  autoN: 5,
  autoL: 5,
  autoE: 22,
  l2N: 11,
  l2L: 10,
  l3N: 20,
  l3Bridges: 3,
  maxL1: 28,
};
window.T = THRESHOLDS;

const DOM = Object.create(null);
const DOM_IDS = [
  'toast','t-title','t-sub','node-tip',
  'layer-tag','phase-name','hint','obj-line','now-action','cond-chip',
  'vN','vL','vE','vT','vB','vBT','vL3C','vL3P','vSP','vData',
  'node-stat','link-stat','energy-stat','tri-stat','br-stat','l3-stat','spine-stat',
  'energy-mini-fill','prog-bar','prog-lbl',
  'btn-pulse','btn-train',
  'bn-src','bn-rly','bn-amp','bn-mem','bl-stb','bl-fst','bl-res','bl-frg',
  'pulse-cd-ring','pulse-cd-fill',
  'sync-decay-bar-wrap','sync-decay-fill',
  'l3-hud','l3-hud-header','l3-obj',
];

export function el(id) {
  return DOM[id] || document.getElementById(id);
}

export function initDOMCache() {
  DOM_IDS.forEach(id => {
    const node = document.getElementById(id);
    if (node) DOM[id] = node;
  });
  return DOM;
}

// ── Cached DOM-write helpers (avoid layout thrash from no-op assignments) ──
export function setNodeText(node, text) {
  if (!node) return;
  const next = text ?? '';
  if (node._txt === next) return;
  node._txt = next;
  node.textContent = next;
}

export function setNodeDisplay(node, value) {
  if (!node) return;
  const next = value || '';
  if (node._display === next) return;
  node._display = next;
  node.style.display = next;
}

export function setNodeWidth(node, value) {
  if (!node) return;
  if (node._width === value) return;
  node._width = value;
  node.style.width = value;
}

export function setNodeBackground(node, value) {
  if (!node) return;
  if (node._bg === value) return;
  node._bg = value;
  node.style.background = value;
}

export function setNodeStyle(node, prop, value) {
  if (!node) return;
  const cacheKey = '_style_' + prop;
  if (node[cacheKey] === value) return;
  node[cacheKey] = value;
  node.style[prop] = value;
}

export function fmtE(n) {
  if (n >= 10000) return Math.floor(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}
