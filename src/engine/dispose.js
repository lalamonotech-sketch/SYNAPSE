/**
 * SYNAPSE v98 — Scene Disposal
 * Migrated from P0-FIX DISPOSE-01 in v89 p0patched (lines 4462–4534)
 *
 * disposeAll() must be called before EVERY location.reload().
 * It releases all GPU memory and clears all registries.
 *
 * Call order enforced by _safeRestart() and _returnToTitle():
 *   1. stopLoop()             ← cancel RAF
 *   2. clearAllTimers()       ← clear setInterval / setTimeout
 *   3. disposeAll()           ← GPU memory + listeners
 *   4. location.reload()
 */

import { stopLoop }          from './gameLoop.js';
import { clearAllTimers }    from '../registries/timerRegistry.js';
import { clearAllListeners } from '../registries/listenerRegistry.js';
import { G }                 from '../state/gameState.js';
import { persistSave }       from '../state/saveSystem.js';
import { getLang }           from '../state/settings.js';
import { _SHOCK_GEO, _TRAIL_GEO } from '../layers/network/index.js';
import { TM }                from '../layers/bridge/index.js';
import { stopSyncDecayBar, MM }  from '../layers/meta/index.js';
import {
  microGroup, tGroup, macGroup, fxGroup,
  GS, GS2,
  comp, renderer,
} from './scene.js';

/**
 * Recursively dispose geometry + material on every object in a Group,
 * then call group.clear().
 * @param {THREE.Group} group
 */
function disposeGroup(group) {
  if (!group) return;
  const children = [...group.children];
  children.forEach(obj => {
    if (obj.geometry)  obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
    if (obj.children?.length) disposeGroup(obj);
  });
  group.clear();
}

/**
 * Dispose a plain object whose values are THREE.Material instances.
 * Used for the shared material packs TM (Layer 2) and MM (Layer 3).
 * @param {Record<string, THREE.Material>} pack
 */
function disposeMaterialPack(pack) {
  if (!pack) return;
  Object.values(pack).forEach(m => { if (m?.dispose) m.dispose(); });
}

/**
 * Full teardown. Releases all GPU memory and clears registries.
 * Non-fatal: catches and logs errors so reload() always proceeds.
 */
export function disposeAll() {
  try {
    // 1. Stop the game loop (cancel RAF)
    stopLoop();

    // 1b. Cancel sync decay bar RAF (M-01 fix — own RAF independent of main loop)
    stopSyncDecayBar();

    // 2. Dispose layer groups
    disposeGroup(microGroup);
    disposeGroup(tGroup);
    disposeGroup(macGroup);
    disposeGroup(fxGroup);

    // 3. Dispose shared geometries (node sphere, signal sphere, ring pools)
    GS?.dispose();
    GS2?.dispose();
    _SHOCK_GEO?.dispose();
    _TRAIL_GEO?.dispose();

    // 4. Dispose shared material packs (TM = Layer 2, MM = Layer 3)
    disposeMaterialPack(TM);
    disposeMaterialPack(MM);


    // 5. Dispose EffectComposer and WebGL renderer (releases GL context)
    comp?.dispose?.();
    renderer?.dispose?.();

    // 6. Clear all registries
    clearAllListeners();
    clearAllTimers();

    if (import.meta.env.DEV) {
      console.warn('[Synapse dispose] GPU memory released.');
    }
  } catch (e) {
    console.warn('[Synapse dispose] Non-fatal error during teardown:', e.message);
  }
}

// ── Reload helpers ─────────────────────────────────────────────────────────

/**
 * Safe restart: confirm dialog → dispose → reload.
 * Exported as window._safeRestart for compat callers.
 */
export function safeRestart() {
  const lang = getLang();
  const msg  = lang === 'de'
    ? 'Spiel neu starten? Aktueller Fortschritt geht verloren.'
    : 'Restart game? Current progress will be lost.';
  if (!confirm(msg)) return;

  // State cleanup
  G.runWon = false;
  G.paused = false;

  try { persistSave('safe-restart'); } catch (_) {}

  disposeAll();
  location.reload();
}

/**
 * Return to title: mark run abandoned → dispose → reload.
 * Exported as window._returnToTitle for compat callers.
 */
export function returnToTitle() {
  try { localStorage.removeItem('synapse_run'); } catch (_) {}
  try { persistSave('return-to-title'); } catch (_) {}
  disposeAll();
  location.reload();
}

// ── Legacy window bridges (invoked by some overlay/meta callers) ─────────────
window._disposeAllSceneObjects = disposeAll;
window._safeRestart            = safeRestart;
window._returnToTitle          = returnToTitle;
