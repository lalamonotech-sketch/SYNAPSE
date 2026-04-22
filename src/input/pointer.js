/**
 * SYNAPSE — pointer.js
 *
 * Converts pointer/touch client coordinates into world-space positions
 * on the Z=0 plane. Used by blueprint.js drag-build and any other system
 * that needs a world-space pick from a screen event.
 *
 * Implementation: NDC conversion → Raycaster → intersect Z=0 plane.
 * Matches the pattern already used in systems/fx/visualEnhancer.js.
 */

import * as THREE  from 'three';
import { camera }  from '../engine/scene.js';
import { G }       from '../state/gameState.js';

export function clearSelection() {
  G.selected = null;
}

export function bindPointerInput() {
  // Intentional no-op: no second active pointer-input system exists at this
  // stage. Stub keeps the import in runController.js clean without adding
  // spurious duplicate listeners.
  return;
}
window._bindPointerInput = bindPointerInput;

// Reusable objects — allocated once to avoid GC pressure in drag callbacks
const _raycaster = new THREE.Raycaster();
const _ndc       = new THREE.Vector2();
const _out       = new THREE.Vector3();
const _plane     = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // Z=0

/**
 * Convert canvas client coordinates (e.g. from PointerEvent.clientX/Y)
 * to a world-space position on the Z=0 plane.
 *
 * @param {number} cx  - clientX from pointer/mouse/touch event
 * @param {number} cy  - clientY from pointer/mouse/touch event
 * @returns {THREE.Vector3}  World position (z ~= 0). Returns a shared
 *                           instance — callers retaining the value must
 *                           clone it: placePos(x,y).clone()
 */
export function placePos(cx, cy) {
  const canvas = document.querySelector('canvas');
  if (!canvas) return _out.set(0, 0, 0);

  const rect = canvas.getBoundingClientRect();
  _ndc.x =  ((cx - rect.left) / rect.width)  * 2 - 1;
  _ndc.y = -((cy - rect.top)  / rect.height) * 2 + 1;

  _raycaster.setFromCamera(_ndc, camera);
  _raycaster.ray.intersectPlane(_plane, _out);

  return _out;
}
