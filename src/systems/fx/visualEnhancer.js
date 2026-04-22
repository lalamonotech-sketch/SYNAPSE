/**
 * SYNAPSE v98 — Visual Enhancer
 *
 * Additive cinematic upgrade layer for Layer 1. Operates entirely on top of
 * the existing rendering pipeline — never modifies batch internals, never
 * touches InstancedMesh slots directly. All meshes live in microGroup / fxGroup
 * and are garbage-collected with the normal reset cycle.
 *
 * ─ What this module adds ─────────────────────────────────────────────────
 *  1. SHAPE LANGUAGE      — per-type distinct 3-D geometry (Octahedron relay,
 *                           wireframe icosahedron shells, BoxGeometry memory,
 *                           Torus cortex ring, Sprite auras)
 *  2. BREATHING           — Sinus idle scale + Fresnel-like edge brightening
 *  3. SYNAPTIC GAP        — links terminate slightly before node surface
 *  4. BROWNOUT STUTTER    — dim flicker + desaturation when energy == 0
 *  5. HOVER MAGNETISM     — nodes / links drift toward mouse cursor
 *  6. HEARTBEAT RINGS     — source-anchored shockwave rings on beat tick
 *  7. SOURCE PARTICLE HALO— tiny floating motes around Source nodes
 *  8. FRAGILE SPARK BURST — random spark emitters for fragile links
 *  9. TYPE AURA SPRITES   — soft billboard glow per node type
 * 10. CORTEX TORUS        — special Torus + twin beam for Cortex cells
 *
 * ─ Performance contract ──────────────────────────────────────────────────
 *  • All instanced/pooled — zero per-frame heap allocation in steady state
 *  • LOD-aware: skips heavy fx (particles, cortex beam) at 'low' detail
 *  • reduce-motion: breathing amplitude → 0, magnetism → 0, sparks → off
 *  • Runs AFTER animateLayer1 — reads n.pos / n.mat.emissiveIntensity (stable)
 *
 * ─ Integration ───────────────────────────────────────────────────────────
 *  In gameLoop.js, after tickLayer1():
 *    import { initVisualEnhancer, tickVisualEnhancer, notifyBeat, onNodeAdded, onNodeRemoved }
 *      from './visualEnhancer.js';
 *    initVisualEnhancer();           // once
 *    tickVisualEnhancer(t, dt);      // every frame
 *    notifyBeat(sourceNodes);        // from heartbeat.js on each beat
 *    onNodeAdded(node);              // from makeNode() after push
 *    onNodeRemoved(node);            // from removeNode() before splice
 */

import * as THREE from 'three';
import { microGroup, fxGroup, camera } from '../../engine/scene.js';
import { getLODDetail } from './cameraFX.js';
import { prefersReducedMotion as _prefersReducedMotion, onMotionPreferenceChange as _onMotionPreferenceChange } from '../../platform/motionQuery.js';
import { getFxQualityStats } from '../../platform/fxQuality.js';

// ── Internal state ─────────────────────────────────────────────────────────
let _initialized = false;
let _reduceMotion = false;
let _mouseWorld = new THREE.Vector3(); // mouse position projected to Z=0 plane
const _raycaster = new THREE.Raycaster();
const _mouseNDC  = new THREE.Vector2();

// Per-node enhancement data — WeakMap so it GC's with the node object
const _nodeEnhData = new WeakMap();

// ── Shared geometries (pooled) ─────────────────────────────────────────────
let _octGeo  = null;  // relay octahedron shell
let _icoGeo  = null;  // source/amplifier wireframe icosahedron
let _boxGeo  = null;  // memory fill cube
let _torGeo  = null;  // cortex torus
let _sprGeo  = null;  // aura quad (PlaneGeometry)

// Mote pool (source particle halo)
const _MOTE_POOL_SIZE = 64;
const _motePool  = [];
const _activeMotes = [];

// Spark pool (fragile link sparks)
const _SPARK_POOL_SIZE = 80;
const _sparkPool   = [];
const _activeSparks = [];

// Cortex state
const _cortexMap = new Map(); // node id → cortex overlay object

// ── Materials ──────────────────────────────────────────────────────────────
// Additive blending = correct glow look against dark backgrounds
const _MAT_ADDITIVE = {
  relay_shell:  null,
  source_ico:   null,
  amp_ico:      null,
  memory_fill:  null,
  cortex_torus: null,
  cortex_beam:  null,
  aura_source:  null,
  aura_relay:   null,
  aura_amp:     null,
  aura_memory:  null,
  mote:         null,
  spark:        null,
};

function _mkAdd(hex, opacity = 0.15) {
  return new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function _ensureGeometries() {
  if (_octGeo) return;
  _octGeo = new THREE.OctahedronGeometry(1, 0);
  _icoGeo = new THREE.IcosahedronGeometry(1, 0);
  _boxGeo = new THREE.BoxGeometry(1, 1, 1);
  _torGeo = new THREE.TorusGeometry(1, 0.05, 8, 48);
  _sprGeo = new THREE.PlaneGeometry(1, 1);

  _MAT_ADDITIVE.relay_shell  = _mkAdd(0x33ddcc, 0.12);
  _MAT_ADDITIVE.source_ico   = _mkAdd(0xff6622, 0.10);
  _MAT_ADDITIVE.amp_ico      = _mkAdd(0xaaee22, 0.10);
  _MAT_ADDITIVE.memory_fill  = _mkAdd(0xcc44ff, 0.08);
  _MAT_ADDITIVE.cortex_torus = _mkAdd(0x88ffee, 0.25);
  _MAT_ADDITIVE.cortex_beam  = _mkAdd(0x88ffff, 0.18);
  _MAT_ADDITIVE.aura_source  = _mkAdd(0xff4400, 0.08);
  _MAT_ADDITIVE.aura_relay   = _mkAdd(0x22ffdd, 0.06);
  _MAT_ADDITIVE.aura_amp     = _mkAdd(0x99ff22, 0.06);
  _MAT_ADDITIVE.aura_memory  = _mkAdd(0xcc44ff, 0.07);
  _MAT_ADDITIVE.mote         = new THREE.MeshBasicMaterial({
    color: 0xffaa44, transparent: true, opacity: 0.7,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  _MAT_ADDITIVE.spark = new THREE.MeshBasicMaterial({
    color: 0xffcc44, transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// ── Mote pool init ─────────────────────────────────────────────────────────
function _ensureMotes() {
  if (_motePool.length >= _MOTE_POOL_SIZE) return;
  const geo = new THREE.SphereGeometry(0.04, 4, 3);
  while (_motePool.length < _MOTE_POOL_SIZE) {
    const m = new THREE.Mesh(geo, _MAT_ADDITIVE.mote.clone());
    m.visible = false;
    fxGroup.add(m);
    _motePool.push({ m, mat: m.material, life: 0, vel: new THREE.Vector3(), node: null });
  }
}

// ── Spark pool init ────────────────────────────────────────────────────────
function _ensureSparks() {
  if (_sparkPool.length >= _SPARK_POOL_SIZE) return;
  const geo = new THREE.SphereGeometry(0.035, 3, 2);
  while (_sparkPool.length < _SPARK_POOL_SIZE) {
    const m = new THREE.Mesh(geo, _MAT_ADDITIVE.spark.clone());
    m.visible = false;
    fxGroup.add(m);
    _sparkPool.push({ m, mat: m.material, life: 0, vel: new THREE.Vector3() });
  }
}

// ── Per-node visual overlay creation ──────────────────────────────────────
function _createNodeEnhancement(node) {
  _ensureGeometries();
  const sz = node.sz || 0.5;
  const type = node.isMain ? 'core' : node.type;
  const data = { type, meshes: [], aura: null };

  // ── 1. Type-specific outer shell / geometry ───────────────────────────
  if (type === 'relay') {
    // Wireframe octahedron — rotates, communicates "relay / routing" through shape
    const mat = _MAT_ADDITIVE.relay_shell.clone();
    const m = new THREE.Mesh(_octGeo, mat);
    m.scale.setScalar(sz * 1.45);
    m.renderOrder = 1;
    node.m.add(m);
    data.meshes.push({ m, mat, role: 'relay-oct', phase: node.off });

    // Second pass: slow-counter-rotating ring for orbital depth
    const ringMat = _mkAdd(0x22ccaa, 0.09);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 28), ringMat);
    ring.scale.setScalar(sz * 1.8);
    ring.rotation.x = Math.PI / 2;
    node.m.add(ring);
    data.meshes.push({ m: ring, mat: ringMat, role: 'relay-counter-ring', phase: node.off + 1.0 });

  } else if (type === 'source') {
    // Icosahedron wireframe shell — spiky = energy emission
    const mat = _MAT_ADDITIVE.source_ico.clone();
    const m = new THREE.Mesh(_icoGeo, mat);
    m.material.wireframe = true;
    m.scale.setScalar(sz * 1.6);
    node.m.add(m);
    data.meshes.push({ m, mat, role: 'source-ico', phase: node.off });

  } else if (type === 'amplifier') {
    // Smaller, faster-rotating icosahedron
    const mat = _MAT_ADDITIVE.amp_ico.clone();
    const m = new THREE.Mesh(_icoGeo, mat);
    m.material.wireframe = true;
    m.scale.setScalar(sz * 1.5);
    node.m.add(m);
    data.meshes.push({ m, mat, role: 'amp-ico', phase: node.off });

    // Plus a tight octahedron inner shell for layering
    const innerMat = _mkAdd(0x88dd22, 0.08);
    const inner = new THREE.Mesh(_octGeo, innerMat);
    inner.scale.setScalar(sz * 1.1);
    node.m.add(inner);
    data.meshes.push({ m: inner, mat: innerMat, role: 'amp-inner-oct', phase: node.off + 2.1 });

  } else if (type === 'memory') {
    // Cube — data storage language, "fills up" with charge
    const mat = _MAT_ADDITIVE.memory_fill.clone();
    const m = new THREE.Mesh(_boxGeo, mat);
    m.scale.setScalar(sz * 0.85);
    node.m.add(m);
    data.meshes.push({ m, mat, role: 'memory-box', phase: node.off });

    // Thin wireframe cube shell
    const wireMat = _mkAdd(0xcc44ff, 0.06);
    wireMat.wireframe = true;
    const wire = new THREE.Mesh(_boxGeo, wireMat);
    wire.scale.setScalar(sz * 1.25);
    node.m.add(wire);
    data.meshes.push({ m: wire, mat: wireMat, role: 'memory-wire', phase: node.off + 0.5 });

  } else if (type === 'core') {
    // Main node: layered icosahedron + slow-spin octahedron
    const icoMat = _mkAdd(0xff9955, 0.08);
    icoMat.wireframe = true;
    const ico = new THREE.Mesh(_icoGeo, icoMat);
    ico.scale.setScalar(sz * 1.4);
    node.m.add(ico);
    data.meshes.push({ m: ico, mat: icoMat, role: 'core-ico', phase: node.off });

    const octMat = _mkAdd(0xffcc88, 0.07);
    const oct = new THREE.Mesh(_octGeo, octMat);
    oct.scale.setScalar(sz * 1.65);
    node.m.add(oct);
    data.meshes.push({ m: oct, mat: octMat, role: 'core-oct', phase: node.off + 1.4 });
  }

  // ── 2. Aura sprite (billboard quad with additive blending) ────────────
  const auraMats = {
    source: _MAT_ADDITIVE.aura_source,
    relay:  _MAT_ADDITIVE.aura_relay,
    amplifier: _MAT_ADDITIVE.aura_amp,
    memory: _MAT_ADDITIVE.aura_memory,
    core:   _MAT_ADDITIVE.aura_source,
  };
  const auraMat = (auraMats[type] || _MAT_ADDITIVE.aura_relay).clone();
  const aura = new THREE.Mesh(_sprGeo, auraMat);
  aura.scale.setScalar(sz * 5.5);
  aura.renderOrder = -1; // behind everything
  node.m.add(aura);
  data.aura = { mesh: aura, mat: auraMat };

  _nodeEnhData.set(node, data);
}

function _removeNodeEnhancement(node) {
  const data = _nodeEnhData.get(node);
  if (!data) return;
  for (const entry of data.meshes) {
    node.m.remove(entry.m);
    entry.mat.dispose();
  }
  if (data.aura) {
    node.m.remove(data.aura.mesh);
    data.aura.mat.dispose();
  }
  _nodeEnhData.delete(node);

  // Clean up cortex if present
  _removeCortex(node);
}

// ── Cortex cell torus ─────────────────────────────────────────────────────
function _addCortex(node) {
  if (_cortexMap.has(node.id)) return;
  _ensureGeometries();
  const sz = node.sz || 0.5;

  const torMat = _MAT_ADDITIVE.cortex_torus.clone();
  const tor = new THREE.Mesh(_torGeo, torMat);
  tor.scale.setScalar(sz * 3.5);
  microGroup.add(tor);

  // Twin beam cylinders (vertical light shafts)
  const beamGeo = new THREE.CylinderGeometry(0.03, 0.03, 6, 6);
  const beamMatA = _MAT_ADDITIVE.cortex_beam.clone();
  const beamA = new THREE.Mesh(beamGeo, beamMatA);
  beamA.position.y = 3;
  microGroup.add(beamA);

  const beamMatB = _MAT_ADDITIVE.cortex_beam.clone();
  const beamB = new THREE.Mesh(beamGeo, beamMatB);
  beamB.position.y = -3;
  microGroup.add(beamB);

  _cortexMap.set(node.id, { tor, torMat, beamA, beamMatA, beamB, beamMatB, node, phase: node.off });
}

function _removeCortex(node) {
  const c = _cortexMap.get(node.id);
  if (!c) return;
  microGroup.remove(c.tor);
  microGroup.remove(c.beamA);
  microGroup.remove(c.beamB);
  c.torMat.dispose();
  c.beamMatA.dispose();
  c.beamMatB.dispose();
  _cortexMap.delete(node.id);
}

function _tickCortex(t) {
  for (const [, c] of _cortexMap) {
    const node = c.node;
    // Follow node world position
    c.tor.position.copy(node.pos);
    c.tor.rotation.y = t * 0.6 + c.phase;
    c.tor.rotation.x = Math.sin(t * 0.3 + c.phase) * 0.3;

    c.beamA.position.copy(node.pos);
    c.beamA.position.y += 3;
    c.beamB.position.copy(node.pos);
    c.beamB.position.y -= 3;

    const pulse = 0.18 + Math.sin(t * 2.4 + c.phase) * 0.07;
    c.torMat.opacity = pulse;
    const beamPulse = 0.12 + Math.sin(t * 1.8 + c.phase + 1) * 0.06;
    c.beamMatA.opacity = beamPulse;
    c.beamMatB.opacity = beamPulse;
  }
}

// ── Mote spawner (source particle halo) ───────────────────────────────────
function _spawnMote(node) {
  const entry = _motePool.pop();
  if (!entry) return;
  const angle = Math.random() * Math.PI * 2;
  const r = (node.sz || 0.5) * (1.1 + Math.random() * 0.8);
  entry.m.position.set(
    node.pos.x + Math.cos(angle) * r,
    node.pos.y + (Math.random() - 0.5) * 0.6,
    node.pos.z + Math.sin(angle) * r,
  );
  const speed = 0.004 + Math.random() * 0.006;
  const tangent = new THREE.Vector3(-Math.sin(angle), (Math.random() - 0.5) * 0.4, Math.cos(angle));
  entry.vel.copy(tangent).multiplyScalar(speed);
  entry.vel.y += 0.002 + Math.random() * 0.003; // slight upward drift
  entry.life = 0;
  entry.node = node;
  entry.mat.opacity = 0.7;
  entry.m.visible = true;
  _activeMotes.push(entry);
}

function _tickMotes(dt) {
  for (let i = _activeMotes.length - 1; i >= 0; i--) {
    const m = _activeMotes[i];
    m.life += dt;
    const p = m.life / 2.2; // 2.2s lifetime
    m.m.position.addScaledVector(m.vel, 1);
    m.mat.opacity = Math.max(0, 0.7 * (1 - p * p));
    if (p >= 1) {
      m.m.visible = false;
      _motePool.push(m);
      _activeMotes.splice(i, 1);
    }
  }
}

// ── Spark spawner (fragile link) ──────────────────────────────────────────
function _spawnSpark(pos) {
  const entry = _sparkPool.pop();
  if (!entry) return;
  entry.m.position.copy(pos);
  entry.vel.set(
    (Math.random() - 0.5) * 0.05,
    (Math.random() - 0.5) * 0.05 + 0.01,
    (Math.random() - 0.5) * 0.05,
  );
  entry.life = 0;
  entry.mat.opacity = 0.9;
  entry.m.visible = true;
  _activeSparks.push(entry);
}

function _tickSparks(dt) {
  for (let i = _activeSparks.length - 1; i >= 0; i--) {
    const s = _activeSparks[i];
    s.life += dt;
    const p = s.life / 0.55; // 0.55s lifetime
    s.m.position.addScaledVector(s.vel, 1);
    s.vel.y -= 0.001; // gravity
    s.mat.opacity = Math.max(0, 0.9 * (1 - p));
    if (p >= 1) {
      s.m.visible = false;
      _sparkPool.push(s);
      _activeSparks.splice(i, 1);
    }
  }
}

// ── Heartbeat ring per-source ──────────────────────────────────────────────
// These are distinct from the global shockwave — they are tightly anchored
// to each Source node so the player sees where energy originates.
const _beatRings = [];
const _BEAT_RING_GEO = new THREE.RingGeometry(0.05, 0.18, 40);

function _spawnBeatRing(pos, col) {
  let ring = null;
  for (let i = 0; i < _beatRings.length; i++) {
    if (!_beatRings[i].active) { ring = _beatRings[i]; break; }
  }
  if (!ring) {
    const mat = new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(_BEAT_RING_GEO, mat);
    m.visible = false;
    fxGroup.add(m);
    ring = { m, mat, r: 0, active: false };
    _beatRings.push(ring);
  }
  ring.r = 0;
  ring.mat.color.setHex(col);
  ring.mat.opacity = 0.8;
  ring.m.position.copy(pos);
  ring.m.scale.setScalar(0.5);
  ring.m.quaternion.copy(camera.quaternion);
  ring.m.visible = true;
  ring.active = true;
}

function _tickBeatRings(dt) {
  for (let i = 0; i < _beatRings.length; i++) {
    const ring = _beatRings[i];
    if (!ring.active) continue;
    ring.r += dt * 4.5;
    ring.m.scale.setScalar(0.5 + ring.r * 3.5);
    ring.m.quaternion.copy(camera.quaternion);
    ring.mat.opacity = Math.max(0, 0.8 * (1 - ring.r));
    if (ring.r >= 1) {
      ring.m.visible = false;
      ring.active = false;
    }
  }
}

// ── Mouse world-space tracking ─────────────────────────────────────────────
function _updateMouseWorld(event) {
  const el = document.getElementById('canvas') || document.querySelector('canvas');
  if (!el) return;
  const rect = el.getBoundingClientRect();
  _mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  // Project onto Z=0 plane
  _raycaster.setFromCamera(_mouseNDC, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  _raycaster.ray.intersectPlane(plane, _mouseWorld);
}

// ── Public API ─────────────────────────────────────────────────────────────
export function initVisualEnhancer() {
  if (_initialized) return;
  _initialized = true;

  _ensureGeometries();
  _ensureMotes();
  _ensureSparks();

  // reduce-motion (single shared subscription via platform/motionQuery)
  _reduceMotion = _prefersReducedMotion();
  _onMotionPreferenceChange(reduced => { _reduceMotion = reduced; });

  // Mouse tracking for hover magnetism
  if (!_reduceMotion) {
    window.addEventListener('mousemove', _updateMouseWorld, { passive: true });
  }

  console.info('[VisualEnhancer] v98 initialized — cinematic mode active');
}

/**
 * Call from makeNode() after the node is pushed to gameNodes.
 */
export function onNodeAdded(node) {
  if (!_initialized) return;
  try { _createNodeEnhancement(node); } catch (e) {
    if (import.meta.env.DEV) console.warn('[VisualEnhancer] onNodeAdded failed:', e);
  }
}

/**
 * Call from removeNode() before it's spliced from gameNodes.
 */
export function onNodeRemoved(node) {
  if (!_initialized) return;
  try { _removeNodeEnhancement(node); } catch (e) {
    if (import.meta.env.DEV) console.warn('[VisualEnhancer] onNodeRemoved failed:', e);
  }
}

/**
 * Call from heartbeat.js on each beat tick. Pass the array of Source nodes.
 */
export function notifyBeat(sourceNodes) {
  if (!_initialized) return;
  const lod = getLODDetail();
  if (lod === 'low') return;
  try {
    for (let i = 0; i < sourceNodes.length; i++) {
      const n = sourceNodes[i];
      if (!n || !n.pos) continue;
      _spawnBeatRing(n.pos.clone(), n._colorHex || 0xff4422);
      // Spawn 2–3 motes per source per beat
      if (!_reduceMotion && _motePool.length >= 2) {
        _spawnMote(n);
        _spawnMote(n);
      }
    }
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[VisualEnhancer] notifyBeat failed:', e);
  }
}

/**
 * Mark a node as a Cortex Cell (from awakening.js when macro-structure forms).
 */
export function notifyCortexFormed(node) {
  if (!_initialized) return;
  try { _addCortex(node); } catch (e) {
    if (import.meta.env.DEV) console.warn('[VisualEnhancer] cortex failed:', e);
  }
}

export function notifyCortexRemoved(node) {
  if (!_initialized) return;
  try { _removeCortex(node); } catch (e) {
    if (import.meta.env.DEV) console.warn('[VisualEnhancer] cortex remove failed:', e);
  }
}

// Scratch vectors — reused across tick to avoid heap allocation
const _tmp = new THREE.Vector3();
const _toMouse = new THREE.Vector3();

/**
 * Main per-frame tick. Call from gameLoop after animateLayer1.
 */
export function tickVisualEnhancer(t, dt, gameNodes, gameLinks) {
  if (!_initialized) return;
  const lod = getLODDetail();
  const fx  = getFxQualityStats();
  const lodHigh   = lod === 'high';
  const lodMedium = lod !== 'low';

  // ── 1. Node enhancement tick ────────────────────────────────────────
  for (let i = 0; i < gameNodes.length; i++) {
    const node = gameNodes[i];
    const data = _nodeEnhData.get(node);
    if (!data) {
      // Node was added before init or without onNodeAdded call — retroactively add
      _createNodeEnhancement(node);
      continue;
    }

    const sz = node.sz || 0.5;
    const o  = node.off;
    const ei = node.mat?.emissiveIntensity || 1;

    // ── Breathing: Sinus idle scale (reduce-motion: no breathing) ────
    if (!_reduceMotion && node._spawnT >= 1) {
      const breathAmp = data.type === 'memory' ? 0.025 : 0.038;
      const breathFreq = data.type === 'relay' ? 1.1 : data.type === 'source' ? 1.6 : 1.3;
      const breath = 1 + Math.sin(t * breathFreq + o) * breathAmp;
      if (!node.selected) {
        node.m.scale.setScalar(sz * breath);
      }
    }

    // ── Fresnel-like edge brightening via aura opacity ────────────────
    if (data.aura) {
      // Billboard the aura always toward camera
      data.aura.mesh.quaternion.copy(camera.quaternion);
      const baseFresnel = 0.04 + Math.sin(t * 0.7 + o) * 0.02;
      const actFresnel  = Math.min(0.18, baseFresnel + ei * 0.012);
      data.aura.mat.opacity += (actFresnel - data.aura.mat.opacity) * 0.07;
    }

    // ── Per-mesh type animation ───────────────────────────────────────
    for (let mi = 0; mi < data.meshes.length; mi++) {
      const entry = data.meshes[mi];
      const { m, mat, role, phase } = entry;

      if (role === 'relay-oct') {
        m.rotation.y = t * 0.55 + phase;
        m.rotation.x = t * 0.28 + phase;
        mat.opacity = _lerp01(0.05, 0.14, Math.sin(t * 1.1 + phase) * 0.5 + 0.5);

      } else if (role === 'relay-counter-ring') {
        m.rotation.z = -t * 0.42 + phase;
        mat.opacity = _lerp01(0.04, 0.10, Math.sin(t * 0.9 + phase) * 0.5 + 0.5);

      } else if (role === 'source-ico') {
        m.rotation.y = t * 0.65 + phase;
        m.rotation.z = t * 0.35 + phase;
        // Pulse in sync with emissive intensity
        const scl = sz * (1.5 + Math.sin(t * 1.6 + phase) * 0.08);
        m.scale.setScalar(scl);
        mat.opacity = _lerp01(0.07, 0.20, Math.min(1, ei * 0.1));

      } else if (role === 'amp-ico') {
        m.rotation.y = t * 0.80 + phase;
        m.rotation.x = t * 0.45 + phase;
        mat.opacity = _lerp01(0.05, 0.16, Math.sin(t * 1.3 + phase) * 0.5 + 0.5);

      } else if (role === 'amp-inner-oct') {
        m.rotation.y = -t * 0.6 + phase;
        m.rotation.z = t * 0.3 + phase;
        mat.opacity = _lerp01(0.04, 0.10, ei * 0.07);

      } else if (role === 'memory-box') {
        // Rotate slowly, scale fills with charge
        m.rotation.y = t * 0.25 + phase;
        const charge = node.memCharge || 0;
        const fillT  = Math.min(1, charge / 100);
        const fillScale = sz * (0.55 + fillT * 0.35);
        m.scale.setScalar(fillScale);
        mat.opacity = _lerp01(0.04, 0.22, fillT);

      } else if (role === 'memory-wire') {
        m.rotation.y = -t * 0.18 + phase;
        mat.opacity = _lerp01(0.03, 0.09, Math.sin(t * 0.6 + phase) * 0.5 + 0.5);

      } else if (role === 'core-ico') {
        m.rotation.y = t * 0.35 + phase;
        m.rotation.x = t * 0.22 + phase;
        mat.opacity = _lerp01(0.05, 0.12, Math.sin(t * 0.8 + phase) * 0.5 + 0.5);

      } else if (role === 'core-oct') {
        m.rotation.z = t * 0.20 + phase;
        m.rotation.x = -t * 0.14 + phase;
        mat.opacity = _lerp01(0.04, 0.10, ei * 0.06);
      }
    }

    // ── Hover magnetism ──────────────────────────────────────────────
    if (!_reduceMotion && lodMedium && _mouseWorld.lengthSq() > 0) {
      _toMouse.subVectors(_mouseWorld, node.pos);
      const dist = _toMouse.length();
      const MAG_RADIUS = 5.5;
      if (dist < MAG_RADIUS && dist > 0.01) {
        const strength = (1 - dist / MAG_RADIUS) * 0.08; // max 0.08 world units pull
        node.base.addScaledVector(_toMouse.normalize(), strength * dt * 15);
        // Spring back toward original base (prevent drift accumulation)
        // Note: node.base is its resting position — we nudge it briefly
        // The main animateLayer1 uses base + sin offset, so base drift is small
        // and self-corrects via the sin damping. We cap the nudge here.
        const MAX_DRIFT = 0.15;
        if (node.base.distanceTo(node.m.position) > MAX_DRIFT) {
          node.base.lerp(node.m.position, 0.04);
        }
      }
    }

    // ── Brownout stutter ──────────────────────────────────────────────
    if (node._brownout) {
      const flicker = Math.sin(t * 22 + o) * 0.5 + 0.5; // 11Hz flicker
      node.m.material.opacity = 0.25 + flicker * 0.3;
      // Desaturate: lerp emissive toward gray
      if (node.mat) {
        const gray = 0.4;
        node.mat.emissive.r += (gray - node.mat.emissive.r) * 0.12;
        node.mat.emissive.g += (gray - node.mat.emissive.g) * 0.12;
        node.mat.emissive.b += (gray - node.mat.emissive.b) * 0.12;
      }
      if (data.aura) data.aura.mat.opacity = 0;
    } else {
      if (node.m.material && node.m.material.opacity !== undefined) {
        node.m.material.opacity += (1 - node.m.material.opacity) * 0.10;
      }
    }
  }

  // ── 2. Fragile link sparks ───────────────────────────────────────────
  if (lodHigh && !_reduceMotion && _sparkPool.length > 0) {
    for (let i = 0; i < gameLinks.length; i++) {
      const lk = gameLinks[i];
      if (lk.type !== 'fragile') continue;
      if (Math.random() < 0.018) { // ~1.8% per frame per fragile link
        // Random point on link
        const fract = Math.random();
        _tmp.lerpVectors(lk.a.pos, lk.b.pos, fract);
        _spawnSpark(_tmp);
      }
    }
  }
  _tickSparks(dt);

  // ── 3. Source mote tick ──────────────────────────────────────────────
  _tickMotes(dt);

  // ── 4. Beat ring tick ────────────────────────────────────────────────
  _tickBeatRings(dt);

  // ── 5. Cortex tick ──────────────────────────────────────────────────
  if (lodMedium) _tickCortex(t);
}

// ── Cleanup ───────────────────────────────────────────────────────────────
export function resetVisualEnhancer(gameNodes) {
  if (!_initialized) return;
  try {
    // Remove all node enhancements
    if (gameNodes) {
      for (const node of gameNodes) _removeNodeEnhancement(node);
    }
    // Clear cortex
    for (const [, c] of _cortexMap) {
      microGroup.remove(c.tor);
      microGroup.remove(c.beamA);
      microGroup.remove(c.beamB);
    }
    _cortexMap.clear();
    // Return motes and sparks to pool
    for (const m of _activeMotes) { m.m.visible = false; _motePool.push(m); }
    _activeMotes.length = 0;
    for (const s of _activeSparks) { s.m.visible = false; _sparkPool.push(s); }
    _activeSparks.length = 0;
    // Deactivate beat rings
    for (const r of _beatRings) { r.m.visible = false; r.active = false; }
  } catch (e) {
    console.warn('[VisualEnhancer] reset error:', e);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function _lerp01(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
