/**
 * SYNAPSE — Rewind Buffer
 *
 * Keeps a ring buffer of state snapshots over the last ~10 seconds
 * (one snapshot per second). Used by Boss-fight Rewind feature.
 *
 * Cost: each snapshot is the same JSON the save system produces — so
 * memory cost is bounded (~10× one save string, typically 30–80 KB).
 *
 * Usage:
 *   import { snapshotNow, rewind } from './rewindBuffer.js';
 *   snapshotNow();          // call from heartbeat tick
 *   rewind(10);             // restore state from 10s ago
 */

import { exportState } from '../state/saveSystem.js';
import { regTimer, clearTimer } from '../registries/timerRegistry.js';

const MAX_SECONDS = 10;
const TICK_MS = 1000;

const _ring = []; // entries: { t, snapshot }
let _started = false;

export function snapshotNow() {
  try {
    const snap = exportState();
    _ring.push({ t: Date.now(), snapshot: snap });
    while (_ring.length > MAX_SECONDS + 1) _ring.shift();
  } catch (e) {
    // Snapshot is best-effort; skip on failure
    console.warn('[rewindBuffer] snapshot failed:', e?.message || e);
  }
}

export function startRewindBuffer() {
  if (_started) return;
  _started = true;
  regTimer('rewindBufferTick', setInterval(snapshotNow, TICK_MS), 'interval');
}

export function stopRewindBuffer() {
  _started = false;
  clearTimer('rewindBufferTick');
  _ring.length = 0;
}

export function getRewindDepth() { return _ring.length; }

/**
 * Return a snapshot from `secondsAgo` seconds in the past (clamped).
 * Caller is responsible for applying it via the save-system restore path.
 */
export function peekRewind(secondsAgo = MAX_SECONDS) {
  if (!_ring.length) return null;
  const idx = Math.max(0, _ring.length - 1 - Math.floor(secondsAgo));
  return _ring[idx]?.snapshot || _ring[0].snapshot;
}

/**
 * Pop everything newer than `secondsAgo` so subsequent snapshots write fresh.
 */
export function consumeRewind(secondsAgo = MAX_SECONDS) {
  const snap = peekRewind(secondsAgo);
  _ring.length = 0;
  return snap;
}
