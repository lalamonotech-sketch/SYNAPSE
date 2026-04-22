/**
 * SYNAPSE v98 — Layer 2: Bridges (Topology-Coupled Transition)
 * PHASE E
 *
 * Owns:  tNodes, tLinks, bLinks, bSigs arrays
 *        TM material pack (node / line / bs / bsDim)
 *
 * Exports:
 *   initLayer2()        – one-time setup, call after initLayer1() + L1 nodes exist
 *   evalBridges(t)      – activate / deactivate bridges on topology change;
 *                         call from protocols.js / checkPhase / checkObjectives hooks
 *   animateLayer2(t)    – per-frame update; called by gameLoop._gameUpdate()
 *
 * Dispose:
 *   TM is exposed as window.TM → disposed by dispose.js → disposeMaterialPack(window.TM)
 *   tGroup children (per-bridge Line materials) are disposed by disposeGroup(tGroup)
 *   bSigs use TM.bs / TM.bsDim (shared) → no per-signal mat to dispose
 *
 * Bridge-mode: agentOnBridge / showToast / checkObjectives / refreshAll
 *              still live in window scope until Phase G / H.
 */

import * as THREE from 'three';
import { tGroup, GS, GS2 }            from '../../engine/scene.js';
import { G }                           from '../../state/gameState.js';
import { TUNING }                      from '../../state/tuning.js';
import { regTimer, clearTimer }        from '../../registries/timerRegistry.js';
import { gameNodes, spawnShock }       from '../network/layer1.js';
import { showToast }        from '../../ui/hud/index.js';
import { signalEnergyChanged, signalTopologyChanged } from '../../platform/stateSignals.js';
import { checkObjectives, checkL2Objectives } from '../../gameplay/progression.js';
import { agentOnBridge, PROFILE_BONUS } from '../../systems/ai.js';
import { getLang }                      from '../../state/settings.js';
import { shouldCommitSignalVisual }     from '../../platform/fxQuality.js';

// ═══════════════════════════════════════════════════════════════════════════
//  SHARED STATE  (exported so dispose.js + evalBridges callers can reach them)
// ═══════════════════════════════════════════════════════════════════════════

/** Outer-sphere backdrop nodes (38 instances, shared material TM.node). */
export const tNodes = [];

/** Internal connections between tNodes (shared material TM.line). */
export const tLinks = [];

/**
 * Bridges between tNodes and L1 anchor nodes.
 * Each entry: { a: tNode mesh, b: L1 node object, geo, line, mat, active }
 * Per-bridge mat is a unique LineBasicMaterial → disposed via disposeGroup(tGroup).
 */
export const bLinks = [];

/** Active signals travelling along bridges. */
export const bSigs = [];

let _activeBridgeCount = 0;
const _activeBridgeIdx = [];
const _dormantBridgeIdx = [];
const _bridgeSignalBatches = Object.create(null);
const _bridgeSigDummy = new THREE.Object3D();
let _bridgeSignalCapacity = 128;

/**
 * Shared Layer-2 material pack.
 * Exposed as window.TM so dispose.js can call disposeMaterialPack(window.TM)
 * without importing this module directly.
 */
export const TM = {
  // Layer 2 = abstract meta-structure, NOT primary neurons
  // Much cooler, smaller, more transparent — background scaffolding feel
  node:  new THREE.MeshLambertMaterial({
    color: 0x112244, emissive: 0x0a1a44, emissiveIntensity: 0.8,
    transparent: true, opacity: 0,
  }),
  line:  new THREE.LineBasicMaterial({
    color: 0x112233, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending,
  }),
  bs:    new THREE.MeshBasicMaterial({
    color: 0x4433aa, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending,
  }),
  bsDim: new THREE.MeshBasicMaterial({
    color: 0x334466, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending,
  }),
};

function _ensureBridgeSignalBatches() {
  if (_bridgeSignalBatches.active) return;
  const activeMesh = new THREE.InstancedMesh(GS2, TM.bs, _bridgeSignalCapacity);
  activeMesh.count = 0;
  activeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  activeMesh.frustumCulled = false;
  tGroup.add(activeMesh);
  _bridgeSignalBatches.active = { mesh: activeMesh, signals: [] };

  const passiveMesh = new THREE.InstancedMesh(GS2, TM.bsDim, _bridgeSignalCapacity);
  passiveMesh.count = 0;
  passiveMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  passiveMesh.frustumCulled = false;
  tGroup.add(passiveMesh);
  _bridgeSignalBatches.passive = { mesh: passiveMesh, signals: [] };
}

function _growBridgeSignalBatches(minCapacity) {
  _ensureBridgeSignalBatches();
  let nextCap = _bridgeSignalCapacity;
  while (nextCap < minCapacity) nextCap *= 2;
  if (nextCap === _bridgeSignalCapacity) return;
  _bridgeSignalCapacity = nextCap;

  const nextActive = new THREE.InstancedMesh(GS2, TM.bs, _bridgeSignalCapacity);
  nextActive.count = _bridgeSignalBatches.active.mesh.count;
  nextActive.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nextActive.frustumCulled = false;
  tGroup.add(nextActive);
  tGroup.remove(_bridgeSignalBatches.active.mesh);
  _bridgeSignalBatches.active.mesh.dispose();
  _bridgeSignalBatches.active.mesh = nextActive;

  const nextPassive = new THREE.InstancedMesh(GS2, TM.bsDim, _bridgeSignalCapacity);
  nextPassive.count = _bridgeSignalBatches.passive.mesh.count;
  nextPassive.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nextPassive.frustumCulled = false;
  tGroup.add(nextPassive);
  tGroup.remove(_bridgeSignalBatches.passive.mesh);
  _bridgeSignalBatches.passive.mesh.dispose();
  _bridgeSignalBatches.passive.mesh = nextPassive;
}

function _commitBridgeSignalBatches() {
  _ensureBridgeSignalBatches();
  if (bSigs.length > _bridgeSignalCapacity) _growBridgeSignalBatches(bSigs.length);
  _bridgeSignalBatches.active.signals.length = 0;
  _bridgeSignalBatches.passive.signals.length = 0;
  for (let i = 0; i < bSigs.length; i++) {
    (_bridgeSignalBatches[bSigs[i].passive ? 'passive' : 'active'].signals).push(bSigs[i]);
  }

  const active = _bridgeSignalBatches.active.signals;
  const activeMesh = _bridgeSignalBatches.active.mesh;
  activeMesh.count = active.length;
  activeMesh.visible = active.length > 0;
  for (let i = 0; i < active.length; i++) {
    _bridgeSigDummy.position.copy(active[i].pos);
    _bridgeSigDummy.scale.setScalar(1);
    _bridgeSigDummy.rotation.set(0, 0, 0);
    _bridgeSigDummy.updateMatrix();
    activeMesh.setMatrixAt(i, _bridgeSigDummy.matrix);
  }
  activeMesh.instanceMatrix.needsUpdate = active.length > 0;

  const passive = _bridgeSignalBatches.passive.signals;
  const passiveMesh = _bridgeSignalBatches.passive.mesh;
  passiveMesh.count = passive.length;
  passiveMesh.visible = passive.length > 0;
  for (let i = 0; i < passive.length; i++) {
    _bridgeSigDummy.position.copy(passive[i].pos);
    _bridgeSigDummy.scale.setScalar(1);
    _bridgeSigDummy.rotation.set(0, 0, 0);
    _bridgeSigDummy.updateMatrix();
    passiveMesh.setMatrixAt(i, _bridgeSigDummy.matrix);
  }
  passiveMesh.instanceMatrix.needsUpdate = passive.length > 0;
}

function _resetBridgeSignalBatches() {
  _ensureBridgeSignalBatches();
  _bridgeSignalBatches.active.signals.length = 0;
  _bridgeSignalBatches.passive.signals.length = 0;
  _bridgeSignalBatches.active.mesh.count = 0;
  _bridgeSignalBatches.passive.mesh.count = 0;
  _bridgeSignalBatches.active.mesh.visible = false;
  _bridgeSignalBatches.passive.mesh.visible = false;
  _bridgeSignalBatches.active.mesh.instanceMatrix.needsUpdate = true;
  _bridgeSignalBatches.passive.mesh.instanceMatrix.needsUpdate = true;
}

function _initLinePositionBuffer(entry, from, to) {
  entry._posArr = new Float32Array(6);
  entry._posAttr = new THREE.BufferAttribute(entry._posArr, 3);
  entry.geo.setAttribute('position', entry._posAttr);
  const p = entry._posArr;
  p[0] = from.x; p[1] = from.y; p[2] = from.z;
  p[3] = to.x;   p[4] = to.y;   p[5] = to.z;
  entry._posAttr.needsUpdate = true;
}

function _updateLinePositionBuffer(entry, from, to) {
  const p = entry._posArr;
  p[0] = from.x; p[1] = from.y; p[2] = from.z;
  p[3] = to.x;   p[4] = to.y;   p[5] = to.z;
  entry._posAttr.needsUpdate = true;
}

function _rebuildBridgeBuckets() {
  _activeBridgeIdx.length = 0;
  _dormantBridgeIdx.length = 0;
  _activeBridgeCount = 0;
  for (let i = 0; i < bLinks.length; i++) {
    if (bLinks[i].active) {
      _activeBridgeIdx.push(i);
      _activeBridgeCount++;
    } else {
      _dormantBridgeIdx.push(i);
    }
  }
}

export function getActiveBridgeCount() {
  return _activeBridgeCount;
}

// Publish for dispose.js and compat callers (prefer ES imports going forward)
window.TM     = TM;
window.tNodes = tNodes;
window.tLinks = tLinks;
window.bLinks = bLinks;
window.bSigs  = bSigs;


// ═══════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One-time Layer-2 setup.
 * Call after initLayer1() and after the first batch of L1 nodes exist
 * (the bridge builder needs outer L1 nodes at pos.length() > 12).
 */
export function initLayer2() {
  // ── 1. Backdrop sphere nodes ────────────────────────────────────────────
  for (let i = 0; i < 38; i++) {
    const r  = 38 + Math.random() * 24;
    const ph = Math.acos(2 * Math.random() - 1);
    const th = Math.random() * Math.PI * 2;
    const p  = new THREE.Vector3(
      r * Math.sin(ph) * Math.cos(th),
      r * Math.sin(ph) * Math.sin(th) * 0.62,
      r * Math.cos(ph),
    );
    const m  = new THREE.Mesh(GS, TM.node);
    const sz = 0.16 + Math.random() * 0.38; // L2 nodes smaller — clearly background structure
    m.scale.setScalar(sz);
    m.position.copy(p);
    m.userData = {
      bp: p.clone(),
      off: Math.random() * Math.PI * 2,
      baseSz: sz,
      activeBridge: false,
      activeBridgeCount: 0,
    };
    tGroup.add(m);
    tNodes.push(m);
  }

  // ── 2. Internal tNode connections ───────────────────────────────────────
  for (let i = 0; i < tNodes.length; i++) {
    for (let j = i + 1; j < tNodes.length; j++) {
      if (
        tNodes[i].position.distanceTo(tNodes[j].position) < 27 &&
        Math.random() < 0.4
      ) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          tNodes[i].position,
          tNodes[j].position,
        ]);
        tGroup.add(new THREE.Line(geo, TM.line));
        const entry = { a: tNodes[i], b: tNodes[j], geo };
        _initLinePositionBuffer(entry, tNodes[i].position, tNodes[j].position);
        tLinks.push(entry);
      }
    }
  }

  // ── 3. Bridge connections (tNode ↔ outer L1 node) ───────────────────────
  // Each bridge gets its own LineBasicMaterial so active/dormant state can be
  // toggled independently without affecting other bridges.
  const outerL1 = gameNodes.filter(n => n.pos.length() > 12);

  for (const tn of tNodes) {
    let first = null, second = null;
    let d1 = Infinity, d2 = Infinity;
    for (let i = 0; i < outerL1.length; i++) {
      const candidate = outerL1[i];
      const d = candidate.pos.distanceToSquared(tn.position);
      if (d < d1) {
        second = first; d2 = d1;
        first = candidate; d1 = d;
      } else if (d < d2) {
        second = candidate; d2 = d;
      }
    }
    const nearest = first ? (second ? [first, second] : [first]) : [];
    for (let k = 0; k < nearest.length; k++) {
      if (nearest[k].pos.distanceToSquared(tn.position) < 1600) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          tn.position,
          nearest[k].pos,
        ]);
        const mat = new THREE.LineBasicMaterial({
          color: 0x1a2244,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
        });
        const line = new THREE.Line(geo, mat);
        tGroup.add(line);
        const entry = { a: tn, b: nearest[k], geo, line, mat, active: false };
        _initLinePositionBuffer(entry, tn.position, nearest[k].pos);
        bLinks.push(entry);
      }
    }
  }
  _rebuildBridgeBuckets();

  // ── 4. Fade-in (enrolled in _TIMERS as 'l2fade') ────────────────────────
  // The interval self-clears once opacity reaches 1.
  // It is also enrolled so clearAllTimers() catches it if a fast restart
  // interrupts before completion.
  let op = 0;
  const fi = setInterval(() => {
    op = Math.min(1, op + 0.016);
    // L2 stays subtle — max opacity much lower than L1
    TM.node.opacity = op * 0.30;  // was 1.0 → now 0.30 max
    TM.line.opacity = op * 0.10;  // was 0.30 → now 0.10 max
    TM.bs.opacity   = op * 0.35;  // bridge signals slightly brighter than lines
    bLinks.forEach(lk => { if (!lk.active) lk.mat.opacity = op * 0.04; });
    if (op >= 1) {
      clearInterval(fi);
      clearTimer('l2fade');   // deregister from _TIMERS after self-clear
    }
  }, 30);
  regTimer('l2fade', fi, 'interval');

  // ── 5. Immediate bridge eval in case player already has triangles ────────
  regTimer('l2InitialBridgeEval', setTimeout(() => {
    evalBridges(0);
    clearTimer('l2InitialBridgeEval');
  }, 200), 'timeout');
}


// ═══════════════════════════════════════════════════════════════════════════
//  BRIDGE EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Activate or deactivate each bridge based on current topology.
 * A bridge activates when its L1 anchor node is:
 *   – part of any triangle in G.tris, OR
 *   – a charged Memory node (memCharge > 5)
 *
 * Call this whenever topology changes:
 *   makeLink / removeLink → checkTris → evalBridges
 *   Also called on a 2-second cadence from animateLayer2.
 *
 * @param {number} t - elapsed time in seconds (from gameLoop clock)
 */
export function evalBridges(_t) {
  let firstActivation = false;
  const triNodeIds = G.tris.size ? new Set() : null;
  if (triNodeIds) {
    for (const key of G.tris) {
      const dash1 = key.indexOf('-');
      const dash2 = key.indexOf('-', dash1 + 1);
      triNodeIds.add(+key.slice(0, dash1));
      triNodeIds.add(+key.slice(dash1 + 1, dash2));
      triNodeIds.add(+key.slice(dash2 + 1));
    }
  }

  bLinks.forEach(lk => {
    const anchor    = lk.b;
    const inTri     = !!triNodeIds?.has(anchor.id);
    const hasMem    = anchor.type === 'memory' && anchor.memCharge > 5;
    const wasActive = lk.active;
    lk.active = inTri || hasMem;

    if (lk.active && !wasActive) {
      // Snap to active visuals
      lk.mat.color.setHex(0xcc55ff);
      lk.mat.opacity = 0.55;

      if (!G.l2BridgesActivated) {
        G.l2BridgesActivated = true;
        firstActivation = true;
        const lang = getLang();
        const why  = inTri
          ? (lang === 'de' ? 'Dreieck verankert Schicht-2-Brücke' : 'Triangle anchors Layer-2 bridge')
          : (lang === 'de' ? 'Memory verankert Schicht-2-Brücke'  : 'Memory anchors Layer-2 bridge');
        showToast('BRÜCKE AKTIV', why, 3200);
        agentOnBridge?.();
        // Dual shockwave for visual feedback
        spawnShock(0xaa44ff);
        spawnShock(0xcc66ff);
      }
      lk.a.userData.activeBridgeCount = (lk.a.userData.activeBridgeCount || 0) + 1;
    } else if (!lk.active && wasActive) {
      // Return to dormant
      lk.mat.color.setHex(0x1a2244);
      lk.mat.opacity = 0.07;
      lk.a.userData.activeBridgeCount = Math.max(0, (lk.a.userData.activeBridgeCount || 0) - 1);
    }
  });

  // Propagate activeBridge flag to tNodes (drives scale pulse in animateLayer2)
  tNodes.forEach(tn => {
    tn.userData.activeBridge = (tn.userData.activeBridgeCount || 0) > 0;
  });

  _rebuildBridgeBuckets();

  if (firstActivation) signalTopologyChanged();
  checkObjectives?.();
}


// ═══════════════════════════════════════════════════════════════════════════
//  PER-FRAME ANIMATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Full Layer-2 per-frame update.
 * Called from gameLoop._gameUpdate(t, dt) when G.l2On is true.
 *
 * @param {number} t  - elapsed time in seconds
 * @param {number} dt - frame delta in seconds (unused here, reserved)
 */
export function animateLayer2(t, dt) { // eslint-disable-line no-unused-vars
  if (!G.l2On) return;

  // ── Animate L2 backdrop nodes ──────────────────────────────────────────
  for (let i = 0; i < tNodes.length; i++) {
    const n = tNodes[i];
    const d = n.userData;
    n.position.x = d.bp.x + Math.sin(t * 0.6 + d.off) * 0.62;
    n.position.y = d.bp.y + Math.cos(t * 0.5 + d.off) * 0.62;
    n.position.z = d.bp.z + Math.sin(t * 0.8 + d.off) * 0.62;

    const targetSz = d.activeBridge
      ? d.baseSz * (1.32 + Math.sin(t * 4.2 + d.off) * 0.16)
      : d.baseSz;
    n.scale.setScalar(targetSz);
  }

  // ── Rebuild internal tLink geometry to track moving tNodes ────────────
  for (let i = 0; i < tLinks.length; i++) {
    const l = tLinks[i];
    _updateLinePositionBuffer(l, l.a.position, l.b.position);
  }

  // ── Rebuild bridge geometry + pulse opacity on active bridges ──────────
  for (let i = 0; i < bLinks.length; i++) {
    const l = bLinks[i];
    _updateLinePositionBuffer(l, l.a.position, l.b.pos);
    if (l.active) {
      l.mat.opacity = 0.50 + Math.sin(t * 3.2 + l.a.userData.off) * 0.13;
    }
  }

  // ── Re-evaluate bridge states every 2 s ────────────────────────────────
  if (t - G.l2BridgeTick > 2) {
    const tickDeltaMs = (t - G.l2BridgeTick) * 1000;
    G.l2BridgeTick = t;
    evalBridges(t);
    // FIX 2.4: Tick L2 sustain objective (no bridge energy gain here, just time tracking)
    checkL2Objectives(0, tickDeltaMs);
  }

  // ── Spawn active-bridge signals (+energy on arrival) ───────────────────
  if (Math.random() < 0.042 && _activeBridgeIdx.length) {
    const lk = bLinks[_activeBridgeIdx[(Math.random() * _activeBridgeIdx.length) | 0]];
    const sig = { lk, t: 0, spd: 0.005 + Math.random() * 0.007, passive: false, pos: new THREE.Vector3() };
    sig.pos.copy(lk.a.position);
    bSigs.push(sig);
  }

  // ── Spawn ghost signals on dormant bridges (visual hint, no reward) ─────
  if (Math.random() < 0.014 && _dormantBridgeIdx.length) {
    const lk = bLinks[_dormantBridgeIdx[(Math.random() * _dormantBridgeIdx.length) | 0]];
    const sig = { lk, t: 0, spd: 0.003 + Math.random() * 0.003, passive: true, pos: new THREE.Vector3() };
    sig.pos.copy(lk.a.position);
    bSigs.push(sig);
  }

  // ── Tick bridge signals ─────────────────────────────────────────────────
  for (let i = bSigs.length - 1; i >= 0; i--) {
    const s = bSigs[i];
    s.t += s.spd;
    if (s.t >= 1) {
      bSigs.splice(i, 1);
      if (!s.passive) {
        const brBonus = 1 + (PROFILE_BONUS.analyst?.bridgeStabBonus || 0) * 2;
        const bridgeGain = Math.round(TUNING.bridgeReward * brBonus);
        G.energy += bridgeGain;
        signalEnergyChanged();
        // FIX 2.4: Track bridge energy for L2 objectives
        checkL2Objectives(bridgeGain, 0);
      }
    } else {
      s.pos.lerpVectors(s.lk.a.position, s.lk.b.pos, s.t);
    }
  }

  if (bSigs.length === 0) _resetBridgeSignalBatches();
  else if (shouldCommitSignalVisual('bridge')) _commitBridgeSignalBatches();

  // ── Pulse emissiveIntensity on all L2 nodes ────────────────────────────
  TM.node.emissiveIntensity = _activeBridgeCount > 0
    ? 2.8 + Math.sin(t * 2.1) * 0.7
    : 2.2 + Math.sin(t * 2.1) * 0.5;
}


export function resetLayer2Runtime() {
  for (let i = 0; i < bSigs.length; i++) {
    bSigs[i].t = 1;
  }
  bSigs.length = 0;
  _resetBridgeSignalBatches();
}

// ── Legacy window bridges (compat callers — prefer ES imports) ─────────────
window._initL2      = initLayer2;
window._evalBridges = evalBridges;
window._tickL2      = animateLayer2;
window._resetLayer2Runtime = resetLayer2Runtime;
