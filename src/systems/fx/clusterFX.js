/**
 * SYNAPSE v95 — ClusterFX System
 * Visual cluster grouping with halos, regional color temperature, and group zones.
 *
 * Clusters are computed from L1 gameNodes using simple connected-component analysis.
 * Each cluster gets a semi-transparent halo ring + subtle color temperature shift.
 *
 * Exports:
 *   initClusterFX(scene, microGroup)
 *   tickClusterFX(t, dt, gameNodes, gameLinks)
 *   disposeClusterFX()
 */

import * as THREE from 'three';

const _clusters      = [];  // array of { centroid, radius, halo, mat, nodeIds, colorHex }
let   _dirtyFlag     = true;
let   _rebuildTimer  = 0;
const REBUILD_INTERVAL = 1.8; // seconds — don't rebuild every frame

const _HALO_GEO = new THREE.RingGeometry(1, 1.18, 64);
const _clusterColors = [
  0x2244aa, // blue-violet
  0x11aa88, // teal
  0x884422, // warm amber
  0x5533cc, // electric indigo
  0x338844, // forest green
];

import { fxGroup as _fxGroupRef } from '../../engine/scene.js';

let _fxGroup = null;

export function initClusterFX() {
  _fxGroup = _fxGroupRef;
}

export function markClustersDirty() {
  _dirtyFlag = true;
}

export function tickClusterFX(t, dt, gameNodes, gameLinks) {
  if (!_fxGroup) { _fxGroup = _fxGroupRef; if (!_fxGroup) return; }
  _rebuildTimer += dt;
  if (_dirtyFlag || _rebuildTimer > REBUILD_INTERVAL) {
    _rebuildTimer = 0;
    _dirtyFlag    = false;
    _rebuildClusters(gameNodes, gameLinks);
  }

  // Animate halos — slow breathing pulse
  for (let i = 0; i < _clusters.length; i++) {
    const cl = _clusters[i];
    if (!cl.halo) continue;
    const pulse = 0.85 + Math.sin(t * 0.55 + i * 1.3) * 0.08;
    cl.halo.scale.setScalar(cl.radius * pulse);
    cl.mat.opacity = 0.06 + Math.sin(t * 0.4 + i * 0.9) * 0.02;
  }
}

export function disposeClusterFX() {
  _fxGroup = _fxGroup || _fxGroupRef;
  for (const cl of _clusters) {
    if (cl.halo && _fxGroup) _fxGroup.remove(cl.halo);
    if (cl.mat) cl.mat.dispose();
  }
  _clusters.length = 0;
}

// ── Private ─────────────────────────────────────────────────────────────────

function _rebuildClusters(gameNodes, gameLinks) {
  if (!_fxGroup || gameNodes.length < 3) {
    _clearHalos();
    return;
  }

  const components = _findComponents(gameNodes, gameLinks);

  // Only show halos for clusters with >= 3 nodes
  const significant = components.filter(c => c.length >= 3);

  // Remove halos we don't need anymore
  while (_clusters.length > significant.length) {
    const cl = _clusters.pop();
    if (cl.halo) _fxGroup.remove(cl.halo);
    if (cl.mat) cl.mat.dispose();
  }

  // Update or create halos
  for (let i = 0; i < significant.length; i++) {
    const nodes = significant[i];
    const centroid = _centroid(nodes);
    const radius = _maxRadius(nodes, centroid) + 1.8;
    const colorHex = _clusterColors[i % _clusterColors.length];

    if (!_clusters[i]) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const halo = new THREE.Mesh(_HALO_GEO, mat);
      halo.renderOrder = -1;
      _fxGroup.add(halo);
      _clusters[i] = { centroid, radius, halo, mat, colorHex };
    } else {
      _clusters[i].mat.color.setHex(colorHex);
      _clusters[i].centroid  = centroid;
      _clusters[i].radius    = radius;
    }

    _clusters[i].halo.position.copy(centroid);
    _clusters[i].halo.scale.setScalar(radius);
    // Keep halo flat in XY plane
    _clusters[i].halo.rotation.set(0, 0, 0);
  }
}

function _clearHalos() {
  for (const cl of _clusters) {
    if (cl.halo && _fxGroup) _fxGroup.remove(cl.halo);
    if (cl.mat) cl.mat.dispose();
  }
  _clusters.length = 0;
}

function _findComponents(gameNodes, gameLinks) {
  const visited = new Set();
  const adj     = new Map();
  for (const n of gameNodes) adj.set(n, []);
  for (const lk of gameLinks) {
    adj.get(lk.a)?.push(lk.b);
    adj.get(lk.b)?.push(lk.a);
  }

  const components = [];
  for (const start of gameNodes) {
    if (visited.has(start)) continue;
    const comp = [];
    const stack = [start];
    while (stack.length) {
      const n = stack.pop();
      if (visited.has(n)) continue;
      visited.add(n);
      comp.push(n);
      for (const nb of (adj.get(n) || [])) {
        if (!visited.has(nb)) stack.push(nb);
      }
    }
    components.push(comp);
  }
  return components;
}

function _centroid(nodes) {
  const c = new THREE.Vector3();
  for (const n of nodes) c.add(n.pos);
  c.divideScalar(nodes.length);
  return c;
}

function _maxRadius(nodes, centroid) {
  let r = 0;
  for (const n of nodes) r = Math.max(r, centroid.distanceTo(n.pos));
  return r;
}
