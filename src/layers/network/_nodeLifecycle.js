import * as THREE from 'three';
import { microGroup, GS, mkMat, camera } from '../../engine/scene.js';
import { G } from '../../state/gameState.js';
import { aiState } from '../../state/aiShared.js';
import { getLang } from '../../state/settings.js';
import { showToast } from '../../ui/hud/index.js';
import { onboarding } from '../../meta/onboarding.js';
import { isRestoringSave } from '../../state/saveSystem.js';
import { NODE_TYPE_KEYS as _NODE_TYPE_KEYS, NODE_BASE_COLORS as _NODE_BASE_COLORS, EARLY_GAME_LOOK_NODE_MAX, EARLY_GAME_LOOK_LINK_MAX, EARLY_GAME_LOOK_PULSE_MAX, EARLY_GAME_LOOK_TIME_MAX, NODE_INSTANCE_HYSTERESIS as _NODE_INSTANCE_HYSTERESIS, NODE_INSTANCE_THRESHOLD_DEFAULT, NODE_INSTANCE_CAPACITY_DEFAULT, NT } from './_constants.js';
import { gameNodes, gameLinks, _adjSet, _triNodeCounts, _resonanceDegree, _incSourceNodeCount } from './_state.js';
import { onNodeAdded as _enhOnNodeAdded, onNodeRemoved as _enhOnNodeRemoved } from '../../systems/fx/visualEnhancer.js';


const _colorMixA = new THREE.Color();
const _colorMixB = new THREE.Color();
let _nodeInstanceThreshold = NODE_INSTANCE_THRESHOLD_DEFAULT;
let _nodeInstanceCapacity = NODE_INSTANCE_CAPACITY_DEFAULT;
let _nodeInstanceLayoutDirty = true;
let _useNodeInstancing = false;
let _nodeInstancingMode = 'auto';
const _nodeInstancers = Object.create(null);
const _instDummy = new THREE.Object3D();
const _instColorA = new THREE.Color();
const _instColorB = new THREE.Color();
const _RING_GEO  = new THREE.TorusGeometry(1, 0.045, 8, 36);
const _SHELL_GEO = new THREE.SphereGeometry(1, 16, 12);
const _HALO_GEO  = new THREE.SphereGeometry(1, 12, 8);
let _selRing = null;


function _clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function _lerp(a, b, t) {
  return a + (b - a) * t;
}

function _blendHex(hexA, hexB, t) {
  if (t <= 0) return hexA;
  if (t >= 1) return hexB;
  _colorMixA.setHex(hexA);
  _colorMixB.setHex(hexB);
  _colorMixA.lerp(_colorMixB, t);
  return _colorMixA.getHex();
}

export function getEarlyGameVisualCalmness() {
  if (G.l2On || G.l3On) return 0;
  const elapsed = (Date.now() - (G.runStart || Date.now())) / 1000;
  const timeFactor = 1 - _clamp01(elapsed / EARLY_GAME_LOOK_TIME_MAX);
  const nodeFactor = 1 - _clamp01(Math.max(0, gameNodes.length - 2) / Math.max(1, EARLY_GAME_LOOK_NODE_MAX - 2));
  const linkFactor = 1 - _clamp01(gameLinks.length / EARLY_GAME_LOOK_LINK_MAX);
  const pulseFactor = 1 - _clamp01((G.pulseCount || 0) / EARLY_GAME_LOOK_PULSE_MAX);
  const weighted = nodeFactor * 0.36 + linkFactor * 0.26 + pulseFactor * 0.22 + timeFactor * 0.16;
  return _clamp01(Math.min(weighted, timeFactor));
}

function getInitialNodeSize(isMain, ntype) {
  const calmness = getEarlyGameVisualCalmness();
  if (isMain) return _lerp(1.1, 0.78, calmness);
  if (ntype === 'memory') return _lerp(0.56, 0.5, calmness);
  if (ntype === 'amplifier') return _lerp(0.56, 0.485, calmness);
  return _lerp(0.56, 0.465, calmness);
}

function _ensureNodeInstancers() {
  if (_nodeInstancers.source) return;
  for (let i = 0; i < _NODE_TYPE_KEYS.length; i++) {
    const key = _NODE_TYPE_KEYS[i];
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
    });
    material.vertexColors = true;
    const mesh = new THREE.InstancedMesh(GS, material, _nodeInstanceCapacity);
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    microGroup.add(mesh);
    _nodeInstancers[key] = { key, material, mesh, nodes: [] };
  }
}

function _growNodeInstancers(minCapacity) {
  _ensureNodeInstancers();
  let nextCap = _nodeInstanceCapacity;
  while (nextCap < minCapacity) nextCap *= 2;
  if (nextCap === _nodeInstanceCapacity) return;
  _nodeInstanceCapacity = nextCap;
  for (let i = 0; i < _NODE_TYPE_KEYS.length; i++) {
    const key = _NODE_TYPE_KEYS[i];
    const bucket = _nodeInstancers[key];
    const nextMesh = new THREE.InstancedMesh(GS, bucket.material, _nodeInstanceCapacity);
    nextMesh.count = bucket.mesh.count;
    nextMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nextMesh.frustumCulled = false;
    microGroup.add(nextMesh);
    microGroup.remove(bucket.mesh);
    bucket.mesh.dispose();
    bucket.mesh = nextMesh;
  }
}

function _markNodeInstanceLayoutDirty() {
  _nodeInstanceLayoutDirty = true;
}

function _getEligibleNodeInstanceCount() {
  let eligible = 0;
  for (let i = 0; i < gameNodes.length; i++) {
    if (!gameNodes[i].isMain) eligible++;
  }
  return eligible;
}

function _evaluateNodeInstancingMode() {
  const eligible = _getEligibleNodeInstanceCount();
  let nextMode = _useNodeInstancing;
  if (_nodeInstancingMode === 'off') {
    nextMode = false;
  } else if (_nodeInstancingMode === 'on') {
    nextMode = eligible > 0;
  } else if (!_useNodeInstancing) {
    nextMode = eligible >= _nodeInstanceThreshold;
  } else {
    nextMode = eligible > Math.max(0, _nodeInstanceThreshold - _NODE_INSTANCE_HYSTERESIS);
  }
  if (nextMode !== _useNodeInstancing) {
    _useNodeInstancing = nextMode;
    _nodeInstanceLayoutDirty = true;
  }
}

export function getNodeRenderStats() {
  return {
    mode: _nodeInstancingMode,
    activeInstancing: _useNodeInstancing,
    threshold: _nodeInstanceThreshold,
    eligibleCount: _getEligibleNodeInstanceCount(),
    hysteresis: _NODE_INSTANCE_HYSTERESIS,
  };
}

export function setNodeRenderMode(mode = 'auto') {
  const nextMode = mode === 'on' ? 'on' : mode === 'off' ? 'off' : 'auto';
  if (_nodeInstancingMode === nextMode) return getNodeRenderStats();
  _nodeInstancingMode = nextMode;
  _nodeInstanceLayoutDirty = true;
  _evaluateNodeInstancingMode();
  _syncNodeInstanceLayout();
  _commitNodeInstances();
  return getNodeRenderStats();
}

export function cycleNodeRenderMode() {
  const order = ['auto', 'off', 'on'];
  const idx = order.indexOf(_nodeInstancingMode);
  return setNodeRenderMode(order[(idx + 1) % order.length]);
}

export function setNodeInstanceThreshold(value) {
  const numeric = Math.max(8, Math.min(256, Number(value) || _nodeInstanceThreshold));
  if (numeric === _nodeInstanceThreshold) return getNodeRenderStats();
  _nodeInstanceThreshold = numeric;
  _nodeInstanceLayoutDirty = true;
  _evaluateNodeInstancingMode();
  _syncNodeInstanceLayout();
  _commitNodeInstances();
  return getNodeRenderStats();
}

function _syncNodeInstanceLayout() {
  _evaluateNodeInstancingMode();
  _ensureNodeInstancers();
  if (!_nodeInstanceLayoutDirty) return;

  if (!_useNodeInstancing) {
    for (let i = 0; i < _NODE_TYPE_KEYS.length; i++) {
      const bucket = _nodeInstancers[_NODE_TYPE_KEYS[i]];
      bucket.nodes.length = 0;
      bucket.mesh.count = 0;
      bucket.mesh.visible = false;
      bucket.mesh.instanceMatrix.needsUpdate = true;
      if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true;
    }
    for (let i = 0; i < gameNodes.length; i++) {
      gameNodes[i].m.visible = true;
      gameNodes[i]._instanceBucketKey = null;
      gameNodes[i]._instanceIndex = -1;
    }
    _nodeInstanceLayoutDirty = false;
    return;
  }

  if (gameNodes.length > _nodeInstanceCapacity) _growNodeInstancers(gameNodes.length);
  for (let i = 0; i < _NODE_TYPE_KEYS.length; i++) {
    const bucket = _nodeInstancers[_NODE_TYPE_KEYS[i]];
    bucket.nodes.length = 0;
    bucket.mesh.visible = true;
  }
  for (let i = 0; i < gameNodes.length; i++) {
    const node = gameNodes[i];
    if (node.isMain) {
      node.m.visible = true;
      node._instanceBucketKey = null;
      node._instanceIndex = -1;
      continue;
    }
    const bucket = _nodeInstancers[node.type] || _nodeInstancers.source;
    node._instanceBucketKey = bucket.key;
    node._instanceIndex = bucket.nodes.length;
    bucket.nodes.push(node);
    node.m.visible = false;
  }
  for (let i = 0; i < _NODE_TYPE_KEYS.length; i++) {
    const bucket = _nodeInstancers[_NODE_TYPE_KEYS[i]];
    bucket.mesh.count = bucket.nodes.length;
    bucket.mesh.visible = bucket.nodes.length > 0;
    bucket.mesh.instanceMatrix.needsUpdate = bucket.nodes.length > 0;
    if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = bucket.nodes.length > 0;
  }
  _nodeInstanceLayoutDirty = false;
}

export function _commitNodeInstances() {
  _syncNodeInstanceLayout();
  if (!_useNodeInstancing) return;
  for (let bi = 0; bi < _NODE_TYPE_KEYS.length; bi++) {
    const bucket = _nodeInstancers[_NODE_TYPE_KEYS[bi]];
    const mesh = bucket.mesh;
    const nodes = bucket.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      _instDummy.position.copy(node.m.position);
      _instDummy.scale.copy(node.m.scale);
      _instDummy.rotation.set(0, 0, 0);
      _instDummy.updateMatrix();
      mesh.setMatrixAt(i, _instDummy.matrix);

      _instColorA.setHex(node._baseColorHex || _NODE_BASE_COLORS[node.type] || _NODE_BASE_COLORS.source);
      _instColorB.copy(node.mat.emissive);
      _instColorA.lerp(_instColorB, 0.42);
      const intensity = node.mat.emissiveIntensity || 0;
      const scalar = Math.min(1.65, 0.6 + intensity * 0.14);
      _instColorA.multiplyScalar(scalar);
      mesh.setColorAt(i, _instColorA);
    }
    mesh.instanceMatrix.needsUpdate = nodes.length > 0;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = nodes.length > 0;
  }
}

export function _resetNodeInstances() {
  _ensureNodeInstancers();
  _useNodeInstancing = false;
  for (let i = 0; i < _NODE_TYPE_KEYS.length; i++) {
    const bucket = _nodeInstancers[_NODE_TYPE_KEYS[i]];
    bucket.nodes.length = 0;
    bucket.mesh.count = 0;
    bucket.mesh.visible = false;
    bucket.mesh.instanceMatrix.needsUpdate = true;
    if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true;
  }
  _nodeInstanceLayoutDirty = true;
}

function _addNodeDecorator(n, sz) {
  if (n.isMain) {
    // Core node: inner bright nucleus
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffeecc, transparent: true, opacity: 0.55, depthWrite: false,
    });
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), innerMat);
    inner.scale.setScalar(0);
    n.m.add(inner);
    n._dec = { mesh: inner, mat: innerMat, type: 'core-inner' };
    return;
  }

  if (n.type === 'relay') {
    // Orbit ring — rotates, fades in after spawn
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x33ddcc, transparent: true, opacity: 0.0,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(_RING_GEO, ringMat);
    ring.scale.setScalar(sz * 1.5);
    n.m.add(ring);
    n._dec = { mesh: ring, mat: ringMat, type: 'relay-ring' };

  } else if (n.type === 'amplifier') {
    // Outer halo sphere — BackSide rendering = inward glow surround
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xbbee44, transparent: true, opacity: 0.0,
      depthWrite: false, side: THREE.BackSide,
    });
    const halo = new THREE.Mesh(_HALO_GEO, haloMat);
    halo.scale.setScalar(sz * 1.8);
    n.m.add(halo);
    n._dec = { mesh: halo, mat: haloMat, type: 'amplifier-halo' };

  } else if (n.type === 'memory') {
    // Translucent outer shell — opacity = charge level
    const shellMat = new THREE.MeshLambertMaterial({
      color: 0xcc66ff, transparent: true, opacity: 0.0,
      depthWrite: false, side: THREE.BackSide,
    });
    const shell = new THREE.Mesh(_SHELL_GEO, shellMat);
    shell.scale.setScalar(sz * 1.55);
    n.m.add(shell);
    n._dec = { mesh: shell, mat: shellMat, type: 'memory-shell' };

  } else {
    // Source: compact inner bright core (compact nucleus feel)
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xff9966, transparent: true, opacity: 0.0, depthWrite: false,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), coreMat);
    core.scale.setScalar(sz * 0.9);
    n.m.add(core);
    n._dec = { mesh: core, mat: coreMat, type: 'source-core' };
  }
}

export function _tickNodeDecorators(t, earlyLookCalmness) {
  for (let i = 0; i < gameNodes.length; i++) {
    const n = gameNodes[i];
    if (!n._dec) continue;
    const d = n._dec;
    const o = n.off;
    const sz = n.sz;
    const sp = n._spawnT;

    if (d.type === 'core-inner') {
      const targetOp = 0.45 + Math.sin(t * 1.8 + o) * 0.08;
      d.mat.opacity += (targetOp - d.mat.opacity) * 0.05;
      d.mesh.scale.setScalar(sp < 1 ? sp * 0.38 : 0.38);

    } else if (d.type === 'relay-ring') {
      const sigBoost = Math.min(1, (n.connCount || 0) * 0.25);
      const baseOp = _lerp(0.0, 0.28 + sigBoost * 0.22, sp);
      const targetOp = n.selected ? 0.65 : _lerp(baseOp, baseOp * 0.6, earlyLookCalmness);
      d.mat.opacity += (targetOp - d.mat.opacity) * 0.06;
      d.mesh.rotation.x = t * 0.5 + o;
      d.mesh.rotation.y = t * 0.3;
      d.mesh.scale.setScalar(sz * _lerp(1.5, 1.3, earlyLookCalmness));

    } else if (d.type === 'amplifier-halo') {
      const pulse = 0.06 + Math.sin(t * 2.2 + o) * 0.04;
      const baseOp = _lerp(0.0, 0.10 + pulse, sp);
      const targetOp = n.selected ? 0.26 : _lerp(baseOp, baseOp * 0.5, earlyLookCalmness);
      d.mat.opacity += (targetOp - d.mat.opacity) * 0.05;
      d.mesh.scale.setScalar(sz * (_lerp(1.8, 1.55, earlyLookCalmness) + Math.sin(t * 1.6 + o) * 0.07));

    } else if (d.type === 'memory-shell') {
      const chargeOp = Math.min(0.40, (n.memCharge || 0) * 0.016);
      const baseOp = _lerp(0.0, chargeOp, sp);
      const targetOp = n.selected ? Math.max(0.18, chargeOp) : _lerp(baseOp, baseOp * 0.55, earlyLookCalmness);
      d.mat.opacity += (targetOp - d.mat.opacity) * 0.04;
      d.mesh.scale.setScalar(sz * (_lerp(1.55, 1.4, earlyLookCalmness) + Math.sin(t * 0.9 + o) * 0.04));

    } else if (d.type === 'source-core') {
      const baseOp = _lerp(0.0, 0.52, sp);
      const targetOp = n.selected ? 0.80 : _lerp(baseOp, baseOp * 0.7, earlyLookCalmness);
      d.mat.opacity += (targetOp - d.mat.opacity) * 0.06;
      d.mesh.scale.setScalar(sz * 0.44);
    }
  }
}


export function _ensureSelRing() {
  if (_selRing) return;
  const geo = new THREE.TorusGeometry(1, 0.04, 8, 48);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x88ccff, transparent: true, opacity: 0, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  microGroup.add(mesh);
  _selRing = { mesh, mat };
}

export function _tickSelRing(t, selectedNode) {
  _ensureSelRing();
  if (!selectedNode) {
    _selRing.mat.opacity += (0 - _selRing.mat.opacity) * 0.12;
    _selRing.mesh.visible = _selRing.mat.opacity > 0.01;
    return;
  }
  _selRing.mesh.visible = true;
  _selRing.mesh.position.copy(selectedNode.pos);
  _selRing.mesh.quaternion.copy(camera.quaternion); // billboard: always faces camera
  _selRing.mesh.scale.setScalar(selectedNode.sz * 1.95);
  const targetOp = 0.52 + Math.sin(t * 2.0) * 0.15;
  _selRing.mat.opacity += (targetOp - _selRing.mat.opacity) * 0.10;
  _selRing.mat.color.setHex(0x88ccff);
}

export function makeNode(pos, isMain, ntype) {
  // NT/LT are module-scope consts — no window lookup needed
  ntype = isMain ? 'core' : (ntype || G.nType);

  if (!isMain && ntype !== 'core' && !isRestoringSave()) {
    const cost = NT[ntype]?.cost || 0;
    if (G.energy < cost) {
      showToast('Zu wenig Energie', (NT[ntype]?.labelDe || ntype) + ' kostet ' + cost, 1400);
      return null;
    }
    // v96: Training immunity — warn if AI is countering this build type
    if (typeof window.isNodeTypeCountered === 'function' && window.isNodeTypeCountered(ntype)) {
      const _icLang = typeof getLang === 'function' ? getLang() : 'de';
      showToast(
        _icLang === 'de' ? '◈ KI KONTERKARIERT DIESEN TYP' : '◈ AI COUNTERING THIS TYPE',
        _icLang === 'de'
          ? (NT[ntype]?.labelDe || ntype) + ' · Effizienz reduziert'
          : (NT[ntype]?.labelEn || ntype) + ' · Efficiency reduced',
        1800
      );
    }
    G.energy -= cost;
  }

  let col, em, ei, sz;
  if (isMain) {
    col = 0xff9955; em = 0xff4411; ei = 3.4; sz = getInitialNodeSize(true, ntype);
  } else {
    const d = NT[ntype] || NT.source;
    col = d.color; em = d.em; ei = d.ei; sz = getInitialNodeSize(false, ntype);
  }

  const mat = mkMat(col, em, ei);
  const m   = new THREE.Mesh(GS, mat);
  m.position.copy(pos);
  m.scale.setScalar(0);

  const n = {
    m, mat, sz,
    base: pos.clone(), pos: pos.clone(),
    off:  Math.random() * Math.PI * 2,
    isMain, selected: false, connCount: 0,
    id: gameNodes.length,
    type: ntype, memCharge: 0, lastDischarge: 0,
    createdAt: Date.now(),
    _spawnT: 0,
    _emissiveHex: em,
    _visualState: '',
    _baseColorHex: col,
  };
  // ── Compatibility shim: systems (heartbeat, awakening, epochReveal) use _id/_type ──
  // Layer 1 uses id/type as canonical fields. These non-enumerable getters bridge
  // the gap so both naming conventions work without touching every consumer.
  Object.defineProperties(n, {
    _id:   { get() { return this.id; },   configurable: true, enumerable: false },
    _type: { get() { return this.type; }, configurable: true, enumerable: false },
  });
  m.userData.gn = n;
  microGroup.add(m);

  // ── Node form-decorators: shape communicates type, not just color ──
  _addNodeDecorator(n, sz);

  gameNodes.push(n);
  _markNodeInstanceLayoutDirty();
  try { _enhOnNodeAdded(n); } catch(_) {} // v98: visual enhancer hook

  if (!isMain && ntype === 'source') _incSourceNodeCount(1);

  if (!isMain && NT[ntype]) aiState?.nodeTypesUsed.add(ntype);
  onboarding.onNode();
  if (!isMain && ntype === 'memory') onboarding.onMemory();

  return n;
}

export function removeNode(node) {
  try { _enhOnNodeRemoved(node); } catch(_) {} // v98: visual enhancer hook
  microGroup.remove(node.m);
  node.mat.dispose();
  if (!node.isMain && node.type === 'source') _incSourceNodeCount(-1);
  _resonanceDegree.delete(node);
  _triNodeCounts.delete(node.id);
  _adjSet.delete(node);
  _adjSet.forEach(neighbours => neighbours.delete(node));
  const idx = gameNodes.indexOf(node);
  if (idx !== -1) {
    gameNodes.splice(idx, 1);
    _markNodeInstanceLayoutDirty();
  }
}

export function _setNodeEmissiveHex(node, hex) {
  if (node._emissiveHex === hex) return;
  node._emissiveHex = hex;
  node.mat.emissive.setHex(hex);
}

export function _setNodeBaseColorHex(node, hex) {
  if (node._baseColorHex === hex) return;
  node._baseColorHex = hex;
  node.mat.color.setHex(hex);
}

export function _resetSelRing() {
  if (_selRing) { _selRing.mat.opacity = 0; _selRing.mesh.visible = false; }
}
