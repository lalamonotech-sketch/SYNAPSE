import * as THREE from 'three';

// ── Shared arrays (single source of truth for all Layer-1 state) ────────────
export const gameNodes   = [];
export const gameLinks   = [];
export const signals     = [];
export const shockwaves  = [];
export const pulseTrails = [];

export const _shockPool = [];
export const _trailPool = [];

// ── Fragile link dash pattern / curve offsets ───────────────────────────────
export const _fragileDashPhase = new WeakMap();
export const _linkCurveOffset = new WeakMap();

// ── Shared ring geometries — pooled, never reallocated per spawn ───────────
export const _SHOCK_GEO = new THREE.RingGeometry(0.1, 0.55, 80);
export const _TRAIL_GEO = new THREE.RingGeometry(0.05, 0.4,  48);

// ── Adjacency / topology caches ─────────────────────────────────────────────
export const _adjSet = new Map();
export const _triNodeCounts = new Map();
export const _resonanceDegree = new Map();
let _sourceNodeCount = 0;

// ── Link mutation counter — lets ai.js cache getLinkTypeCounts cheaply ─────
export let linkVersion = 0;

// Dirty flags shared across submodules.
let _nodeInstanceLayoutDirty = true;
let _linkBatchLayoutDirty = true;

export function _markNodeInstanceLayoutDirty() {
  _nodeInstanceLayoutDirty = true;
}

export function _consumeNodeInstanceLayoutDirty() {
  const dirty = _nodeInstanceLayoutDirty;
  _nodeInstanceLayoutDirty = false;
  return dirty;
}

export function _setNodeInstanceLayoutDirty(value) {
  _nodeInstanceLayoutDirty = !!value;
}

export function _isNodeInstanceLayoutDirty() {
  return _nodeInstanceLayoutDirty;
}

export function _markLinkBatchLayoutDirty() {
  _linkBatchLayoutDirty = true;
}

export function _consumeLinkBatchLayoutDirty() {
  const dirty = _linkBatchLayoutDirty;
  _linkBatchLayoutDirty = false;
  return dirty;
}

export function _setLinkBatchLayoutDirty(value) {
  _linkBatchLayoutDirty = !!value;
}

export function _isLinkBatchLayoutDirty() {
  return _linkBatchLayoutDirty;
}

export function _getSourceNodeCount() {
  return _sourceNodeCount;
}

export function _setSourceNodeCount(value) {
  _sourceNodeCount = Math.max(0, value | 0);
}

export function _incSourceNodeCount(delta = 1) {
  _sourceNodeCount = Math.max(0, _sourceNodeCount + delta);
}

export function _bumpLinkVersion(delta = 1) {
  linkVersion += delta;
}
