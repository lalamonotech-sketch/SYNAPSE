/**
 * SYNAPSE — Touch Smart-Snap
 *
 * On touch devices placing a precise link is hard because the finger covers
 * the screen. This helper finds the *nearest plausible node* within a
 * snap-radius around a touch point and returns it instead of a raw hit-test.
 *
 * It does NOT replace `hitNode`; it augments it for the connect-mode path.
 */

import { camera } from '../engine/scene.js';
import { gameNodes } from '../layers/network/index.js';
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _proj = new THREE.Vector3();

/** Project a node into screen space. */
function _screenOf(node) {
  _v.copy(node.pos);
  _v.project(camera);
  return {
    x: (_v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-_v.y * 0.5 + 0.5) * window.innerHeight,
  };
}

/**
 * Find the node nearest (in screen pixels) to a touch coordinate.
 * @param {number} cx
 * @param {number} cy
 * @param {number} [radius=72] snap radius in pixels (≈ thumb tip)
 * @returns {object|null} node or null
 */
export function snapNearestNode(cx, cy, radius = 72) {
  let best = null;
  let bestDist = radius;
  for (let i = 0; i < gameNodes.length; i++) {
    const node = gameNodes[i];
    const sp = _screenOf(node);
    const d = Math.hypot(sp.x - cx, sp.y - cy);
    if (d < bestDist) {
      best = node;
      bestDist = d;
    }
  }
  return best;
}

/** Heuristic: only enable smart-snap if the device is touch-primary. */
export function isTouchPrimary() {
  if (typeof matchMedia === 'function') {
    try {
      return matchMedia('(pointer: coarse)').matches;
    } catch (_) {}
  }
  return 'ontouchstart' in window;
}
