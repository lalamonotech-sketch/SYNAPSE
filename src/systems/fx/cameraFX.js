/**
 * SYNAPSE v95 — CameraFX System
 * Smooth camera focus moves, dolly animations, and LOD management.
 *
 * Exports:
 *   initCameraFX()             – call once after scene is ready
 *   triggerFocusMove(target)   – smooth dolly to a world position
 *   triggerSelectionFocus(node)– focus on a selected node with pull-in
 *   triggerEventFocus(pos, priority) – event-driven focus (boss, shock, etc.)
 *   tickCameraFX(t, dt)        – call every frame from gameLoop
 *   getCameraZoomFactor()      – returns 0 (far) … 1 (close)
 *   getLODDetail()             – 'low' | 'medium' | 'high'
 */

import * as THREE from 'three';
import { camera, controls } from '../../engine/scene.js';

// ── State ──────────────────────────────────────────────────────────────────
const _camTarget   = new THREE.Vector3();  // where controls.target should go
const _camPos      = new THREE.Vector3();  // where camera.position should go
let   _animating   = false;
let   _animT       = 0;        // 0→1
let   _animDur     = 0;        // seconds
let   _priority    = 0;        // 0=low 1=normal 2=high
let   _fromPos     = new THREE.Vector3();
let   _fromTarget  = new THREE.Vector3();
let   _toPos       = new THREE.Vector3();
let   _toTarget    = new THREE.Vector3();

// prefers-reduced-motion — set by initCameraFX, updated on change
let _reduceMotion = false;

// Track last focus time per priority so we don't spam
const _lastFocusTime = { 0: -999, 1: -999, 2: -999 };
const _FOCUS_COOLDOWN = { 0: 5.0, 1: 3.0, 2: 1.0 };

// Idle drift — very subtle auto-rotation when nothing is happening
let _idleDriftT = 0;
let _lastInteraction = 0;
const IDLE_DRIFT_DELAY = 12.0;  // seconds before idle drift activates
const IDLE_DRIFT_SPEED = 0.004;

import { prefersReducedMotion, onMotionPreferenceChange } from '../../platform/motionQuery.js';

export function initCameraFX() {
  _camTarget.copy(controls.target);
  _camPos.copy(camera.position);
  // Respect prefers-reduced-motion — single shared subscription via platform/motionQuery
  _reduceMotion = prefersReducedMotion();
  onMotionPreferenceChange(reduced => { _reduceMotion = reduced; });
}

/**
 * Smooth camera dolly + target move.
 * duration in seconds, priority 0-2.
 */
export function triggerFocusMove(targetPos, cameraPos, duration = 1.4, priority = 1) {
  const now = _getT();
  if (priority < _priority && _animating) return;
  if (now - _lastFocusTime[priority] < _FOCUS_COOLDOWN[priority]) return;
  _lastFocusTime[priority] = now;

  _fromPos.copy(camera.position);
  _fromTarget.copy(controls.target);
  _toPos.copy(cameraPos || camera.position);
  _toTarget.copy(targetPos);
  _animating  = true;
  _animT      = 0;
  _animDur    = duration;
  _priority   = priority;
}

/**
 * Focus on a selected node with a gentle pull-in dolly.
 */
export function triggerSelectionFocus(node) {
  if (!node) return;
  const pos = node.pos || node.m?.position;
  if (!pos) return;

  // Pull camera toward the node, slightly offset
  const dir = new THREE.Vector3().subVectors(camera.position, pos).normalize();
  const dist = camera.position.distanceTo(pos);
  const pullDist = Math.max(10, dist * 0.72);
  const newCamPos = new THREE.Vector3().addVectors(pos, dir.multiplyScalar(pullDist));
  newCamPos.y = Math.max(pos.y + 2, newCamPos.y);

  triggerFocusMove(pos, newCamPos, 1.1, 1);
}

/**
 * Event-driven focus (boss spawn, cluster capture, etc.)
 */
export function triggerEventFocus(worldPos, priority = 2) {
  const dir = new THREE.Vector3().subVectors(camera.position, worldPos).normalize();
  const newCamPos = new THREE.Vector3().addVectors(worldPos, dir.multiplyScalar(16));
  triggerFocusMove(worldPos, newCamPos, 0.9, priority);
}

export function notifyInteraction() {
  _lastInteraction = _getT();
}

let _tClock = 0;
function _getT() { return _tClock; }

export function tickCameraFX(t, dt) {
  _tClock = t;

  if (_animating) {
    _animT += dt / Math.max(0.01, _animDur);
    if (_animT >= 1) {
      _animT = 1;
      _animating = false;
      _priority = 0;
    }
    // Smooth step easing
    const ease = _smoothstep(_animT);
    camera.position.lerpVectors(_fromPos, _toPos, ease);
    controls.target.lerpVectors(_fromTarget, _toTarget, ease);
    controls.update();
    return;
  }

  // Idle drift — subtle slow orbit when player hasn't interacted
  const idleFor = t - _lastInteraction;
  if (!_reduceMotion && idleFor > IDLE_DRIFT_DELAY) {
    _idleDriftT += dt * IDLE_DRIFT_SPEED;
    const r = camera.position.distanceTo(controls.target);
    // Orbit gently around current target
    camera.position.x = controls.target.x + r * Math.sin(_idleDriftT) * 0.8;
    camera.position.z = controls.target.z + r * Math.cos(_idleDriftT) * 0.8;
    controls.update();
  } else {
    _idleDriftT = 0;
  }
}

/**
 * Returns 0 = fully zoomed out (z≈35) … 1 = fully zoomed in (z≈6)
 */
export function getCameraZoomFactor() {
  const dist = camera.position.distanceTo(controls.target);
  return 1 - Math.min(1, Math.max(0, (dist - 6) / (35 - 6)));
}

/**
 * Returns 'low' | 'medium' | 'high' detail level based on zoom.
 */
export function getLODDetail() {
  const z = getCameraZoomFactor();
  if (z < 0.25) return 'low';
  if (z < 0.65) return 'medium';
  return 'high';
}

function _smoothstep(x) {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}
