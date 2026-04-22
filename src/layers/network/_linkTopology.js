import * as THREE from 'three';
import { microGroup } from '../../engine/scene.js';
import { G } from '../../state/gameState.js';
import { TUNING } from '../../state/tuning.js';
import { upgradeState, traitState } from '../../state/actionState.js';
import { aiState } from '../../state/aiShared.js';
import { showToast } from '../../ui/hud/index.js';
import { checkObjectives } from '../../gameplay/progression.js';
import { onboarding } from '../../meta/onboarding.js';
import { isRestoringSave } from '../../state/saveSystem.js';
import { signalTopologyChanged } from '../../platform/stateSignals.js';
import { markClustersDirty } from '../../systems/fx/clusterFX.js';
import { markTopologyDirty } from '../../systems/economy.js';
import { LT, CURVE_STRENGTH as _CURVE_STRENGTH, CURVE_SEGMENTS as _CURVE_SEGMENTS, FLOW_SEGS as _FLOW_SEGS, FLOW_SPEED as _FLOW_SPEED, AFTERGLOW_DURATION as _AFTERGLOW_DURATION } from './_constants.js';
import { LINK_VERTEX_SHADER as _LINK_VERTEX_SHADER, LINK_FRAGMENT_SHADER as _LINK_FRAGMENT_SHADER, FLOW_VERT as _FLOW_VERT, FLOW_FRAG as _FLOW_FRAG } from './_shaders.js';
import { gameNodes, gameLinks, signals, _adjSet, _triNodeCounts, _resonanceDegree, _linkCurveOffset, _fragileDashPhase, _bumpLinkVersion } from './_state.js';
import { spawnSig } from './_signalSim.js';


let _linkBatchCapacity = 512;
let _linkBatchLayoutDirty = true;
let _linkBatch = null;
let _curveLinkBatch = null;
let _curveLinkCapacity = 256;
let _curveLinkCount = 0;
let _flowBatchCapacity = 512;
let _flowBatch = null;
let _flowTex = null;
let _flowOffset = 0;
let _flowLinkCount = 0;


function _makeLinkProxyMaterial(colorHex, opacity) {
  return {
    color: new THREE.Color(colorHex),
    opacity,
    dispose() {},
  };
}

function _ensureLinkBatch() {
  if (_linkBatch) return;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(_linkBatchCapacity * 6);
  const colors = new Float32Array(_linkBatchCapacity * 8);
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  const colorAttr = new THREE.BufferAttribute(colors, 4);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('colorAlpha', colorAttr);
  geometry.setDrawRange(0, 0);
  const material = new THREE.ShaderMaterial({
    vertexShader: _LINK_VERTEX_SHADER,
    fragmentShader: _LINK_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    vertexColors: false,
    toneMapped: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  microGroup.add(lines);
  _linkBatch = { geometry, material, lines, positions, colors, positionAttr, colorAttr };
}

function _growLinkBatch(minCapacity) {
  _ensureLinkBatch();
  let nextCap = _linkBatchCapacity;
  while (nextCap < minCapacity) nextCap *= 2;
  if (nextCap === _linkBatchCapacity) return;
  _linkBatchCapacity = nextCap;
  const nextPositions = new Float32Array(_linkBatchCapacity * 6);
  const nextColors = new Float32Array(_linkBatchCapacity * 8);
  nextPositions.set(_linkBatch.positions.subarray(0, gameLinks.length * 6));
  nextColors.set(_linkBatch.colors.subarray(0, gameLinks.length * 8));
  _linkBatch.positions = nextPositions;
  _linkBatch.colors = nextColors;
  _linkBatch.positionAttr = new THREE.BufferAttribute(nextPositions, 3);
  _linkBatch.colorAttr = new THREE.BufferAttribute(nextColors, 4);
  _linkBatch.positionAttr.setUsage(THREE.DynamicDrawUsage);
  _linkBatch.colorAttr.setUsage(THREE.DynamicDrawUsage);
  _linkBatch.geometry.setAttribute('position', _linkBatch.positionAttr);
  _linkBatch.geometry.setAttribute('colorAlpha', _linkBatch.colorAttr);
}

function _markLinkBatchLayoutDirty() {
  _linkBatchLayoutDirty = true;
}

const _CURVE_VERTEX_SHADER = `
attribute vec4 colorAlpha;
varying vec4 vColor;
void main() {
  vColor = colorAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const _CURVE_FRAG_SHADER = `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}
`;

function _ensureCurveLinkBatch() {
  if (_curveLinkBatch) return;
  const maxPts = _curveLinkCapacity * (_CURVE_SEGMENTS + 2) * 2;
  const positions = new Float32Array(maxPts * 3);
  const colors    = new Float32Array(maxPts * 4);
  const posAttr   = new THREE.BufferAttribute(positions, 3);
  const colAttr   = new THREE.BufferAttribute(colors,    4);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', posAttr);
  geo.setAttribute('colorAlpha', colAttr);
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    vertexShader: _CURVE_VERTEX_SHADER,
    fragmentShader: _CURVE_FRAG_SHADER,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  microGroup.add(lines);
  _curveLinkBatch = { geo, mat, lines, positions, colors, posAttr, colAttr };
}

const _cvA = new THREE.Vector3();
const _cvB = new THREE.Vector3();
const _cvMid = new THREE.Vector3();
const _cvPerp = new THREE.Vector3();
const _cvUp = new THREE.Vector3(0, 1, 0);

/**
 * Write a curved link into the curve batch using Bezier-like arc.
 * offset: perpendicular displacement at mid-point.
 */
export function _writeCurvedLink(link, r, g, b, a, offset) {
  _ensureCurveLinkBatch();
  const segs = _CURVE_SEGMENTS;
  const posArr = _curveLinkBatch.positions;
  const colArr = _curveLinkBatch.colors;

  // Perpendicular direction
  _cvA.copy(link.a.pos);
  _cvB.copy(link.b.pos);
  _cvMid.addVectors(_cvA, _cvB).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(_cvB, _cvA);
  _cvPerp.crossVectors(dir, _cvUp).normalize();
  if (_cvPerp.lengthSq() < 0.001) {
    _cvPerp.set(1, 0, 0);
  }
  _cvMid.addScaledVector(_cvPerp, offset);

  // Generate arc points via quadratic bezier: a → mid → b
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const tt = i / segs;
    const p = new THREE.Vector3();
    // Quadratic bezier
    p.x = (1-tt)*(1-tt)*_cvA.x + 2*(1-tt)*tt*_cvMid.x + tt*tt*_cvB.x;
    p.y = (1-tt)*(1-tt)*_cvA.y + 2*(1-tt)*tt*_cvMid.y + tt*tt*_cvB.y;
    p.z = (1-tt)*(1-tt)*_cvA.z + 2*(1-tt)*tt*_cvMid.z + tt*tt*_cvB.z;
    pts.push(p);
  }

  // Write line segments (pairs of adjacent points)
  let base = _curveLinkCount * (segs + 1) * 2 * 3;
  let cbase = _curveLinkCount * (segs + 1) * 2 * 4;
  for (let i = 0; i < segs; i++) {
    posArr[base]   = pts[i].x;   posArr[base+1] = pts[i].y;   posArr[base+2] = pts[i].z;
    posArr[base+3] = pts[i+1].x; posArr[base+4] = pts[i+1].y; posArr[base+5] = pts[i+1].z;
    // Head-to-tail gradient: brighter at source, dimmer at destination
    const ht = i / segs;
    const aHead = a * (1 - ht * 0.35);
    colArr[cbase]   = r; colArr[cbase+1] = g; colArr[cbase+2] = b; colArr[cbase+3] = aHead;
    colArr[cbase+4] = r; colArr[cbase+5] = g; colArr[cbase+6] = b; colArr[cbase+7] = aHead * 0.75;
    base  += 6;
    cbase += 8;
  }
  _curveLinkCount++;
}

export function _flushCurveLinkBatch() {
  if (!_curveLinkBatch) return;
  const drawVerts = _curveLinkCount * _CURVE_SEGMENTS * 2;
  _curveLinkBatch.geo.setDrawRange(0, drawVerts);
  _curveLinkBatch.posAttr.needsUpdate = true;
  _curveLinkBatch.colAttr.needsUpdate = true;
  _curveLinkCount = 0;
}

export function _resetCurveLinkBatch() {
  if (!_curveLinkBatch) return;
  _curveLinkBatch.geo.setDrawRange(0, 0);
  _curveLinkCount = 0;
}

function _makeFlowTexture() {
  const W = 256, H = 16;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  // Background: black (transparent via texture alpha)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  // Dash pattern: white dashes, ~38% duty cycle
  const dashW = Math.round(W * 0.38);
  const gapW  = W - dashW;
  // Gradient within each dash: bright center, fades at edges
  const grad = ctx.createLinearGradient(0, 0, dashW, 0);
  grad.addColorStop(0.0,  'rgba(255,255,255,0.0)');
  grad.addColorStop(0.15, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.85, 'rgba(255,255,255,1.0)');
  grad.addColorStop(1.0,  'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, dashW, H);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}


function _ensureFlowBatch() {
  if (_flowBatch) return;
  if (!_flowTex) _flowTex = _makeFlowTexture();

  const maxPts = _flowBatchCapacity * (_FLOW_SEGS + 1) * 2;
  const positions = new Float32Array(maxPts * 3);
  const colors    = new Float32Array(maxPts * 4);
  const arcTs     = new Float32Array(maxPts);      // normalized arc position
  const speedTs   = new Float32Array(maxPts);      // per-vertex speed factor

  const posAttr   = new THREE.BufferAttribute(positions, 3);
  const colAttr   = new THREE.BufferAttribute(colors,    4);
  const arcAttr   = new THREE.BufferAttribute(arcTs,     1);
  const speedAttr = new THREE.BufferAttribute(speedTs,   1);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  arcAttr.setUsage(THREE.DynamicDrawUsage);
  speedAttr.setUsage(THREE.DynamicDrawUsage);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',   posAttr);
  geo.setAttribute('colorAlpha', colAttr);
  geo.setAttribute('arcT',       arcAttr);
  geo.setAttribute('speedT',     speedAttr);
  geo.setDrawRange(0, 0);

  const mat = new THREE.ShaderMaterial({
    vertexShader:   _FLOW_VERT,
    fragmentShader: _FLOW_FRAG,
    uniforms: {
      uFlowTex: { value: _flowTex },
      uOffset:  { value: 0.0 },
    },
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
    toneMapped:  false,
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder   = 2;   // on top of the base batch
  microGroup.add(lines);

  _flowBatch = { geo, mat, lines, positions, colors, arcTs, speedTs, posAttr, colAttr, arcAttr, speedAttr };
}

/**
 * Write one link's flow arc into the flow batch.
 * Uses the same quadratic bézier math as _writeCurvedLink for consistency.
 */
export function _writeFlowLink(link, r, g, b, a, offset, dir, speedFactor) {
  _ensureFlowBatch();
  if (_flowLinkCount >= _flowBatchCapacity) return;

  const segs   = _FLOW_SEGS;
  const posArr  = _flowBatch.positions;
  const colArr  = _flowBatch.colors;
  const arcArr  = _flowBatch.arcTs;
  const spdArr  = _flowBatch.speedTs;
  const spd     = speedFactor || 1.0;

  // Bézier control points (same logic as _writeCurvedLink)
  _cvA.copy(link.a.pos);
  _cvB.copy(link.b.pos);
  _cvMid.addVectors(_cvA, _cvB).multiplyScalar(0.5);
  const dv = new THREE.Vector3().subVectors(_cvB, _cvA);
  _cvPerp.crossVectors(dv, _cvUp).normalize();
  if (_cvPerp.lengthSq() < 0.001) _cvPerp.set(1, 0, 0);
  _cvMid.addScaledVector(_cvPerp, offset);

  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const tt = i / segs;
    const p = new THREE.Vector3();
    p.x = (1-tt)*(1-tt)*_cvA.x + 2*(1-tt)*tt*_cvMid.x + tt*tt*_cvB.x;
    p.y = (1-tt)*(1-tt)*_cvA.y + 2*(1-tt)*tt*_cvMid.y + tt*tt*_cvB.y;
    p.z = (1-tt)*(1-tt)*_cvA.z + 2*(1-tt)*tt*_cvMid.z + tt*tt*_cvB.z;
    pts.push(p);
  }

  // Write line segment pairs
  let base  = _flowLinkCount * segs * 2 * 3;
  let cbase = _flowLinkCount * segs * 2 * 4;
  let tbase = _flowLinkCount * segs * 2;

  for (let i = 0; i < segs; i++) {
    const pA = pts[i],   pB = pts[i + 1];
    // arcT: position along link (0→1 or reversed if signal goes b→a)
    const t0 = dir >= 0 ? (i     / segs) : (1 - i     / segs);
    const t1 = dir >= 0 ? ((i+1) / segs) : (1 - (i+1) / segs);

    posArr[base]   = pA.x; posArr[base+1] = pA.y; posArr[base+2] = pA.z;
    posArr[base+3] = pB.x; posArr[base+4] = pB.y; posArr[base+5] = pB.z;
    // Brightness tapers at ends (head-to-tail gradient)
    const fade0 = a * (0.65 + Math.min(t0, 1 - t0) * 0.7);
    const fade1 = a * (0.65 + Math.min(t1, 1 - t1) * 0.7);
    colArr[cbase]   = r; colArr[cbase+1] = g; colArr[cbase+2] = b; colArr[cbase+3] = fade0;
    colArr[cbase+4] = r; colArr[cbase+5] = g; colArr[cbase+6] = b; colArr[cbase+7] = fade1;
    arcArr[tbase]   = t0;
    arcArr[tbase+1] = t1;
    spdArr[tbase]   = spd;
    spdArr[tbase+1] = spd;
    base  += 6;
    cbase += 8;
    tbase += 2;
  }
  _flowLinkCount++;
}

export function _flushFlowBatch(dt) {
  if (!_flowBatch || _flowLinkCount === 0) {
    if (_flowBatch) _flowBatch.geo.setDrawRange(0, 0);
    return;
  }
  // Advance global flow offset (wraps 0→1 every ~3 seconds baseline)
  _flowOffset = (_flowOffset + dt * 0.33) % 1.0;
  _flowBatch.mat.uniforms.uOffset.value = _flowOffset;
  const drawVerts = _flowLinkCount * _FLOW_SEGS * 2;
  _flowBatch.geo.setDrawRange(0, drawVerts);
  _flowBatch.posAttr.needsUpdate  = true;
  _flowBatch.colAttr.needsUpdate  = true;
  _flowBatch.arcAttr.needsUpdate  = true;
  _flowBatch.speedAttr.needsUpdate = true;
  // uOffset advances globally — individual link speeds are encoded in speedT
  _flowBatch.mat.uniforms.uOffset.value = _flowOffset;
  _flowLinkCount = 0;
}

export function _resetFlowBatch() {
  if (_flowBatch) _flowBatch.geo.setDrawRange(0, 0);
  _flowLinkCount = 0;
}

export function _getLinkCurveOffset(link) {
  if (!_linkCurveOffset.has(link)) {
    // Assign a deterministic offset based on node IDs so it's stable across frames
    const seed = (link.a.id * 7 + link.b.id * 13) % 100;
    const sign  = seed > 50 ? 1 : -1;
    const mag   = 0.15 + (seed % 40) / 100 * _CURVE_STRENGTH;
    _linkCurveOffset.set(link, sign * mag);
  }
  return _linkCurveOffset.get(link);
}

export function _getLinkFragilePhase(link) {
  if (!_fragileDashPhase.has(link)) {
    _fragileDashPhase.set(link, Math.random() * Math.PI * 2);
  }
  return _fragileDashPhase.get(link);
}

export function _syncLinkBatchLayout() {
  _ensureLinkBatch();
  if (!_linkBatchLayoutDirty) return;
  if (gameLinks.length > _linkBatchCapacity) _growLinkBatch(gameLinks.length);
  for (let i = 0; i < gameLinks.length; i++) {
    gameLinks[i]._batchIndex = i;
  }
  _linkBatch.geometry.setDrawRange(0, gameLinks.length * 2);
  _linkBatchLayoutDirty = false;
}

// v98: Synaptic gap — links terminate slightly before node surface.
// Gap = 40% of node radius. This reads correctly in 3-D: the line "enters"
// the glowing aura zone without poking through the core geometry.
const _GAP_A = new THREE.Vector3();
const _GAP_B = new THREE.Vector3();
const _GAP_FRAC = 0.38; // 0 = at center, 1 = at far node

function _writeLinkBatchGeometry(link) {
  if (!_linkBatch || link._batchIndex == null) return;
  const base = link._batchIndex * 6;
  const p = _linkBatch.positions;
  const aSz = (link.a.sz || 0.5) * _GAP_FRAC;
  const bSz = (link.b.sz || 0.5) * _GAP_FRAC;
  // Start point: move from a toward b by aSz
  _GAP_A.subVectors(link.b.pos, link.a.pos).normalize().multiplyScalar(aSz).add(link.a.pos);
  // End point: move from b toward a by bSz
  _GAP_B.subVectors(link.a.pos, link.b.pos).normalize().multiplyScalar(bSz).add(link.b.pos);
  p[base]   = _GAP_A.x; p[base+1] = _GAP_A.y; p[base+2] = _GAP_A.z;
  p[base+3] = _GAP_B.x; p[base+4] = _GAP_B.y; p[base+5] = _GAP_B.z;
}


export function _writeLinkBatchColor(link) {
  if (!_linkBatch || link._batchIndex == null) return;
  const base = link._batchIndex * 8;
  const c = link.mat.color;
  const a = Math.max(0, Math.min(1, link.mat.opacity || 0));
  const arr = _linkBatch.colors;
  arr[base] = c.r; arr[base + 1] = c.g; arr[base + 2] = c.b; arr[base + 3] = a;
  arr[base + 4] = c.r; arr[base + 5] = c.g; arr[base + 6] = c.b; arr[base + 7] = a;
}

export function _flushLinkBatchFrame() {
  if (!_linkBatch) return;
  const active = gameLinks.length > 0;
  _linkBatch.positionAttr.needsUpdate = active;
  _linkBatch.colorAttr.needsUpdate = active;
}

export function _resetLinkBatch() {
  if (!_linkBatch) return;
  _linkBatch.geometry.setDrawRange(0, 0);
  _linkBatchLayoutDirty = true;
}

export function makeLink(a, b, ltype) {
  // LT is module-scope const
  ltype = ltype || G.lType;

  // O(1) duplicate check via adjacency set (was O(L) gameLinks.some scan)
  if (_adjSet.get(a)?.has(b)) {
    return null;
  }

  const lt = LT[ltype] || LT.stable;
  const isRestore = isRestoringSave();
  if (!isRestore && G.energy < lt.cost) {
    showToast('Zu wenig Energie', (lt.labelDe || lt.label || ltype) + ' kostet ' + lt.cost, 1400);
    return null;
  }
  if (!isRestore) G.energy -= lt.cost;

  const mat  = _makeLinkProxyMaterial(lt.color, 0.28);
  const line = { material: mat };
  const geo  = { dispose() {} };

  const lk = { a, b, line, geo, mat, sigs: [], type: ltype, lt, _colorHex: lt.color, _flashState: 0 };
  // ── Compatibility shim: systems use l._src / l._tgt (node IDs); layer1 uses l.a / l.b (objects) ──
  Object.defineProperties(lk, {
    _src: { get() { return this.a.id; }, configurable: true, enumerable: false },
    _tgt: { get() { return this.b.id; }, configurable: true, enumerable: false },
  });
  gameLinks.push(lk);
  _markLinkBatchLayoutDirty();
  linkVersion++;

  // Maintain adjacency set (bidirectional)
  if (!_adjSet.has(a)) _adjSet.set(a, new Set());
  if (!_adjSet.has(b)) _adjSet.set(b, new Set());
  _adjSet.get(a).add(b);
  _adjSet.get(b).add(a);
  if (ltype === 'resonance') {
    _resonanceDegree.set(a, (_resonanceDegree.get(a) || 0) + 1);
    _resonanceDegree.set(b, (_resonanceDegree.get(b) || 0) + 1);
  }

  a.connCount++;
  b.connCount++;
  updateLinkGeo(lk);
  if (!isRestore) spawnSig(lk);
  _checkNewTrianglesForLink(a, b, isRestore);
  markClustersDirty();
  onboarding.onLink();
  return lk;
}

/**
 * E-001 FIX: Pre-allocated Float32Array + BufferAttribute per link.
 * Avoids creating new typed arrays every frame.
 */
export function updateLinkGeo(l) {
  _syncLinkBatchLayout();
  _writeLinkBatchGeometry(l);
}

export function removeLink(idx) {
  const lk = gameLinks[idx];
  if (!lk) return;

  for (let i = signals.length - 1; i >= 0; i--) {
    if (signals[i].lk === lk) {
      const signal = signals[i];
      const li = signal.lk.sigs.indexOf(signal);
      if (li >= 0) { signal.lk.sigs[li] = signal.lk.sigs[signal.lk.sigs.length - 1]; signal.lk.sigs.pop(); }
      signals.splice(i, 1);
    }
  }
  lk.geo.dispose();
  lk.mat.dispose();
  lk.a.connCount = Math.max(0, lk.a.connCount - 1);
  lk.b.connCount = Math.max(0, lk.b.connCount - 1);
  // Remove from adjacency set (bidirectional)
  _adjSet.get(lk.a)?.delete(lk.b);
  _adjSet.get(lk.b)?.delete(lk.a);
  if (lk.type === 'resonance') {
    _resonanceDegree.set(lk.a, Math.max(0, (_resonanceDegree.get(lk.a) || 1) - 1));
    _resonanceDegree.set(lk.b, Math.max(0, (_resonanceDegree.get(lk.b) || 1) - 1));
  }
  linkVersion++;
  _invalidateTrisForLink(lk.a, lk.b);
  gameLinks.splice(idx, 1);
  _markLinkBatchLayoutDirty();
}


// ═══════════════════════════════════════════════════════════════════════════
//  TOPOLOGY — TRIANGLE DETECTION
// ═══════════════════════════════════════════════════════════════════════════


function _areLinked(a, b) {
  return _adjSet.get(a)?.has(b) ?? false;
}

export function _invalidateTrisForLink(a, b) {
  const ai = a.id, bi = b.id;
  // Iterate directly over the Set — no [...spread] needed
  for (const key of G.tris) {
    const p = key.split('-');
    const x = +p[0], y = +p[1], z = +p[2];
    if ((x === ai || y === ai || z === ai) && (x === bi || y === bi || z === bi)) {
      G.tris.delete(key);
      _triNodeCounts.set(x, Math.max(0, (_triNodeCounts.get(x) || 1) - 1));
      _triNodeCounts.set(y, Math.max(0, (_triNodeCounts.get(y) || 1) - 1));
      _triNodeCounts.set(z, Math.max(0, (_triNodeCounts.get(z) || 1) - 1));
    }
  }
}

/**
 * Check if the link between nodes ai and bi participates in any known triangle.
 * Iterates directly over G.tris without spread or map — zero heap allocation.
 */
export function _linkInTri(ai, bi) {
  if (!_triNodeCounts.get(ai) || !_triNodeCounts.get(bi)) return false;
  for (const key of G.tris) {
    const p = key.split('-');
    const x = +p[0], y = +p[1], z = +p[2];
    if ((x === ai || y === ai || z === ai) && (x === bi || y === bi || z === bi)) return true;
  }
  return false;
}

function _registerTriangle(a, b, c) {
  const ids = [a.id, b.id, c.id].sort((x, y) => x - y);
  const key = `${ids[0]}-${ids[1]}-${ids[2]}`;
  if (G.tris.has(key)) return false;
  G.tris.add(key);
  _triNodeCounts.set(ids[0], (_triNodeCounts.get(ids[0]) || 0) + 1);
  _triNodeCounts.set(ids[1], (_triNodeCounts.get(ids[1]) || 0) + 1);
  _triNodeCounts.set(ids[2], (_triNodeCounts.get(ids[2]) || 0) + 1);
  onboarding.onTri();
  return true;
}

function _getTriangleQualityMultiplier(a, b, c) {
  // Count link types between the three nodes
  let resonanceCount = 0, fragileCount = 0, stableCount = 0, fastCount = 0;
  for (const lk of gameLinks) {
    const touches = (
      (lk.a === a || lk.b === a) &&
      (lk.a === b || lk.b === b || lk.a === c || lk.b === c)
    ) || (
      (lk.a === b || lk.b === b) &&
      (lk.a === c || lk.b === c)
    );
    if (!touches) continue;
    if (lk.type === 'resonance') resonanceCount++;
    else if (lk.type === 'fragile')  fragileCount++;
    else if (lk.type === 'fast')     fastCount++;
    else                             stableCount++;
  }
  // Pure resonance triangle: ×2.0
  if (resonanceCount >= 3) return { mult: 2.0, label: 'Resonanz-Dreieck ×2' };
  // Fast triangle: ×1.4 + speed burst
  if (fastCount >= 2) return { mult: 1.4, label: 'Speed-Dreieck ×1.4' };
  // Fragile triangle: ×0.6 but extra burst
  if (fragileCount >= 2) return { mult: 0.6, burst: true, label: 'Fragile-Dreieck ×0.6 +Burst' };
  // Mixed resonance: ×1.3
  if (resonanceCount >= 1) return { mult: 1.3, label: 'Resonanz-Mix ×1.3' };
  return { mult: 1.0, label: null };
}

function _applyTriangleRewards(found, isRestore) {
  if (found <= 0) return;
  if (isRestore) {
    signalTopologyChanged();
  markTopologyDirty(); // v96
    return;
  }
  const bonus = found * TUNING.resonanceTriangleBonus;
  // Quality multiplier based on triangle link types
  // Quick heuristic: check most recently known nodes (a,b,c not available here)
  // Apply a simpler heuristic from available global data: count resonance ratio
  const totalLinks = gameLinks.length || 1;
  const resLinks   = gameLinks.filter(l => l.type === 'resonance').length;
  const resRatio   = resLinks / totalLinks;
  const qualMult   = resRatio > 0.5 ? 1.8 : resRatio > 0.25 ? 1.3 : 1.0;
  const qualBonus  = Math.round(bonus * qualMult) - bonus;
  if (qualBonus > 0) G.energy += qualBonus;
  G.energy += bonus;

  // FIX 3.1: Resonance Cascade — triangles partially discharge nearby memory nodes
  let cascadeGain = 0;
  if (upgradeState.resonanceCascade) {
    gameNodes.forEach(node => {
      if (node.type !== 'memory' || !node.memCharge) return;
      const partial = Math.floor(node.memCharge * 0.12 * found);
      if (partial <= 0) return;
      node.memCharge = Math.max(0, node.memCharge - partial);
      const gain = Math.round(partial * (window.TUNING?.memoryMultiplier || 1.0));
      cascadeGain += gain;
      G.energy += gain;
    });
  }

  const cascadeNote = cascadeGain > 0 ? ` · Cascade +${cascadeGain}⬡` : '';
  showToast(
    'RESONANZ-DREIECK',
    `+${bonus} Energie · ${G.tris.size} aktiv · Resonanz ×2.4${cascadeNote}`,
    2600
  );
  spawnShock(0xaa55ff);
  if (G.l2On) window.evalBridges?.(0);
  checkObjectives?.();
  signalTopologyChanged();
  markClustersDirty();
}

function _checkNewTrianglesForLink(a, b, isRestore = isRestoringSave()) {
  const aAdj = _adjSet.get(a);
  const bAdj = _adjSet.get(b);
  if (!aAdj?.size || !bAdj?.size) return;
  let found = 0;
  const small = aAdj.size <= bAdj.size ? aAdj : bAdj;
  const large = small === aAdj ? bAdj : aAdj;
  for (const candidate of small) {
    if (candidate === a || candidate === b) continue;
    if (!large.has(candidate)) continue;
    if (_registerTriangle(a, b, candidate)) found++;
  }
  _applyTriangleRewards(found, isRestore);
}

export function checkTris() {
  G.tris.clear();
  _triNodeCounts.clear();
  let found = 0;
  for (let i = 0; i < gameNodes.length; i++) {
    for (let j = i + 1; j < gameNodes.length; j++) {
      if (!_areLinked(gameNodes[i], gameNodes[j])) continue;
      for (let k = j + 1; k < gameNodes.length; k++) {
        if (!_areLinked(gameNodes[j], gameNodes[k])) continue;
        if (!_areLinked(gameNodes[i], gameNodes[k])) continue;
        if (_registerTriangle(gameNodes[i], gameNodes[j], gameNodes[k])) found++;
      }
    }
  }
  _applyTriangleRewards(found, isRestoringSave());
}

// Fragile link collapse — with toast + game-state side effects.
// Internal; callers outside this module should use removeLink() for clean teardown.

export function _markLinkActive(link) {
  link._lastActiveAt = Date.now();
}

export function _getLinkAfterglowStrength(link) {
  if (!link._lastActiveAt) return 0;
  const age = (Date.now() - link._lastActiveAt) / 1000;
  if (age >= _AFTERGLOW_DURATION) return 0;
  return Math.pow(1 - age / _AFTERGLOW_DURATION, 1.5);
}

export function _collapseLink(idx) {
  const lk = gameLinks[idx];
  if (lk.type === 'fragile' && aiState) aiState.fragileLinksLost++;

  // Fragile Upside: real trade-off — burst to nearest link on collapse
  if (lk.type === 'fragile') {
    // Base burst: +12⬡ guaranteed on every collapse
    const fragileBaseBurst = 12;
    G.energy += fragileBaseBurst;
    // Signal burst: spawn 3 signals on a nearby link if one exists
    const nearLink = gameLinks.find(l => l !== lk && (l.a === lk.a || l.b === lk.a || l.a === lk.b || l.b === lk.b));
    if (nearLink) {
      for (let _bi = 0; _bi < 3; _bi++) spawnSig(nearLink, 2.5);
    }
    if (traitState.fractureLogic) {
      // fractureLogic: extra +18⬡ and chain signal burst
      G.energy += 18;
      if (nearLink) for (let _bi = 0; _bi < 2; _bi++) spawnSig(nearLink, 3.5);
      showToast('⚡ BRUCH-KASKADE', `Fragile kollabiert · +${fragileBaseBurst + 18}⬡ · Signal-Burst`, 1800);
    } else {
      showToast('⬡ FRAGILE-BRUCH', `Instabilität · +${fragileBaseBurst}⬡ · Burst`, 1200);
    }
  }

  // v95: Phantom Web upgrade — broken fragile links become ghost links (50% opacity, no-break)
  if (upgradeState?.phantomWeb && lk.type === 'fragile' && (window.__synSynergyState?.phantomWebActive || false)) {
    lk.type = 'stable';        // convert to stable type
    lk.lt   = LT.stable;
    if (lk.mat) {
      lk.mat.opacity = 0.38;   // ghost appearance — half visible
      lk.mat.color?.setHex?.(0x9999cc); // muted ghost color
    }
    lk._isGhost = true;        // mark as ghost — no further break risk
    showToast('~ PHANTOM-WEB', 'Fragile Link zu Geist-Link transformiert', 1800);
    // Don't continue with normal collapse — link persists
    signalTopologyChanged();
    return;
  }

  // v95: Fragile Phoenix upgrade — spawn 2 stable links to adjacent nodes on collapse
  if (upgradeState.fragilePhoenix && lk.type === 'fragile') {
    const adjacentA = gameNodes.filter(n => n !== lk.a && n !== lk.b && _adjSet.get(lk.a)?.has(n));
    const adjacentB = gameNodes.filter(n => n !== lk.a && n !== lk.b && _adjSet.get(lk.b)?.has(n));
    const candidates = [...new Set([...adjacentA, ...adjacentB])].slice(0, 2);
    for (const candidate of candidates) {
      if (!_adjSet.get(lk.a)?.has(candidate) && lk.a !== candidate) {
        setTimeout(() => makeLink(lk.a, candidate, 'stable'), 50);
      }
    }
  }

  // PERF-003 swap-and-pop
  for (let i = signals.length - 1; i >= 0; i--) {
    if (signals[i].lk === lk) {
      const signal = signals[i];
      const li = signal.lk.sigs.indexOf(signal);
      if (li >= 0) { signal.lk.sigs[li] = signal.lk.sigs[signal.lk.sigs.length - 1]; signal.lk.sigs.pop(); }
      signals[i] = signals[signals.length - 1]; signals.pop();
    }
  }
  lk.geo.dispose();
  lk.mat.dispose();
  lk.a.connCount = Math.max(0, lk.a.connCount - 1);
  lk.b.connCount = Math.max(0, lk.b.connCount - 1);
  // Keep adjacency set consistent
  _adjSet.get(lk.a)?.delete(lk.b);
  _adjSet.get(lk.b)?.delete(lk.a);
  linkVersion++;
  _invalidateTrisForLink(lk.a, lk.b);
  gameLinks.splice(idx, 1);
  _markLinkBatchLayoutDirty();
  // v95: Entropy Drain upgrade — stable links get opacity boost + energy on fragile break
  if (upgradeState.entropyDrain && lk.type === 'fragile') {
    G.energy += 15;
    gameLinks.forEach(sl => { if (sl.type === 'stable') sl.mat.opacity = Math.min(0.95, (sl.mat.opacity || 0) + 0.4); });
    showToast('▽ ENTROPIE-DRAIN', 'Fragile kollabiert · +15⬡ · Stabile Links verstärkt', 2000);
  } else {
    showToast('LINK KOLLABIERT', 'Fragile Verbindung getrennt', 1500);
  }
  signalTopologyChanged();
}


// ═══════════════════════════════════════════════════════════════════════════
//  PER-TICK HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export function _setLinkColorHex(link, hex) {
  if (link._colorHex === hex) return;
  link._colorHex = hex;
  link.mat.color.setHex(hex);
}