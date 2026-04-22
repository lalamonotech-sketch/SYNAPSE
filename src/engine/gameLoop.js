/**
 * SYNAPSE v98 — Game Loop (Awakening Update patch)
 *
 * Owns the requestAnimationFrame loop and dispatches all migrated per-frame
 * gameplay/runtime systems. The old v89 bridge fallback has been removed; the
 * loop now runs exclusively through module imports.
 */

import { comp, controls, clock, renderer, scene, camera, applyPresentationProfile } from './scene.js';
import { G }                     from '../state/gameState.js';
import { animateLayer1, signals, shockwaves, pulseTrails, gameNodes, gameLinks, getEarlyGameVisualCalmness }         from '../layers/network/index.js';
import { animateLayer2, bSigs }         from '../layers/bridge/index.js';
import { animateLayer3 }         from '../layers/meta/index.js';
import { tickAI }                from '../systems/ai.js';
import { tickEvents }            from '../systems/events.js';
import { tickBoss }              from '../systems/boss.js';
import { refreshHUDMask, shouldTickTopHUD }    from '../ui/hud/index.js';
import { tickMetaFlow }          from '../meta/flow.js';
import { tickMetaScreens }       from '../meta/screens.js';
import { tickEnergyDecay }       from '../boot/activity.js';
import { tickFxFrame, updateFxQuality, getBloomFrameStride } from '../platform/fxQuality.js';
import { consumeHUDSignalMask, HUD_SECTION_MASK } from '../platform/stateSignals.js';
import { initCameraFX, tickCameraFX } from '../systems/fx/cameraFX.js';
import { initClusterFX, tickClusterFX } from '../systems/fx/clusterFX.js';
// ── v96: Strategic Economy, Tech Tree, Crisis, Diagnostics ────────────────
import { tickEconomy } from '../systems/economy.js';
import { tickTechTree }                  from '../systems/techTree.js';
import { tickCrisis }                    from '../systems/crisisEvents.js';
import { updateDiagColors }              from '../systems/diagnostics.js';
// ── v98: Heartbeat (Global Metronome) & Awakening Epoch System ──────────────
import { tickHeartbeat, resetHeartbeat, beatPhase as _hbPhase } from '../systems/heartbeat.js';
import { tickAwakening, updateEpochBadge, tickDaemons } from '../systems/awakening.js';
// ── v98: Sprint 2 — Blueprint, Grid Expansion, Nomads ──────────────────────
import { tickNomads, updateNomadHUD } from '../systems/dataNomads.js';
import { tickGridExpansion, disposeGridExpansion } from '../systems/gridExpansion.js';
// ── v98: Synaptic Plasticity + Auto-Router ──────────────────────────────────
import { tickPlasticityVisuals, resetPlasticity } from '../systems/plasticity.js';
import { initAutoRouter, resetAutoRouter } from '../systems/autorouter.js';
import { initVisualEnhancer, tickVisualEnhancer, resetVisualEnhancer } from '../systems/fx/visualEnhancer.js';

// ── State ──────────────────────────────────────────────────────────────────
let _rafId  = null;
let _lastT  = 0;
let _running = false;
let _uiAccum = 0;

// Perf sampler (P1-05)
const _perf = { _frames: 0, _acc: 0, fps: 0, frameBudgetPct: 0 };
export const perfStats = _perf;

// Bloom skip counter (P-04 adaptive bloom)
let _bloomSkip = 0;

// ── Public API ─────────────────────────────────────────────────────────────

/** Start the game loop. Safe to call multiple times — won't double-start. */
export function startLoop() {
  if (_running) return;
  _running = true;
  // Init visual FX systems
  try { initAutoRouter(); } catch(e) { console.warn('[AutoRouter] init failed:', e); }  // v98
  try { initCameraFX(); } catch(e) { console.warn('[CameraFX] init failed:', e); }
  try { initClusterFX(); } catch(e) { console.warn('[ClusterFX] init failed:', e); }
  try { initVisualEnhancer(); } catch(e) { console.warn('[VisualEnhancer] init failed:', e); }
  _lastT = clock.getElapsedTime();
  _rafId = requestAnimationFrame(_tick);
}

/** Cancel the game loop. Called by dispose chain before reload. */
export function stopLoop() {
  _running = false;
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  try { resetHeartbeat(); } catch(_) {}
  try { resetVisualEnhancer(gameNodes); } catch(e) { console.warn('[VisualEnhancer] reset failed:', e); }
  try { resetPlasticity(); }  catch(e) { console.warn('[Plasticity] reset failed:', e); }   // v98
  try { resetAutoRouter(); }  catch(e) { console.warn('[AutoRouter] reset failed:', e); }   // v98
}

export function isRunning() { return _running; }

// ── Internal tick ──────────────────────────────────────────────────────────
function _tick() {
  if (!_running) return;
  _rafId = requestAnimationFrame(_tick);

  const t  = clock.getElapsedTime();
  // Clamp dt to 100ms max (spiral-of-death guard after tab switch or long pause)
  const dt = Math.min(t - _lastT, 0.1);
  _lastT   = t;

  // ── FPS sampler (rolling 1s window) ─────────────────────────────────────
  _perf._frames++;
  _perf._acc += dt;
  if (_perf._acc >= 1.0) {
    _perf.fps            = Math.round(_perf._frames / _perf._acc);
    _perf.frameBudgetPct = Math.min(999, (_perf._acc / _perf._frames / 0.01667) * 100);
    _perf._frames = 0;
    _perf._acc    = 0;
  }

  // ── Pause: render but skip all game logic ───────────────────────────────
  if (G.paused) {
    applyPresentationProfile(getEarlyGameVisualCalmness());
    controls.update();
    comp.render();
    return;
  }

  tickFxFrame();
  updateFxQuality(t, _perf, {
    signalCount: signals.length,
    bridgeSignalCount: bSigs.length,
    shockwaveCount: shockwaves.length,
    pulseTrailCount: pulseTrails.length,
    nodeCount: gameNodes.length,
    linkCount: gameLinks.length,
  });

  // ── Game logic ───────────────────────────────────────────────────────────
  _gameUpdate(t, dt);

  // ── Adaptive bloom cadence ───────────────────────────────────────────────
  window.__hbPhase = _hbPhase;  // v98: bridge to hud.js via window to break circular dep (hud→heartbeat→showToast→hud)
  applyPresentationProfile(getEarlyGameVisualCalmness());
  controls.update();
  _bloomSkip++;
  const bloomStride = getBloomFrameStride(!!G.autoOn);
  const skipBloom = bloomStride > 1 && (_bloomSkip % bloomStride !== 0);
  if (skipBloom) {
    renderer.render(scene, camera);
  } else {
    comp.render();
  }
}

/**
 * Per-frame game-logic dispatch for the fully migrated runtime.
 */
function _gameUpdate(t, dt) {
  // ── Layer 1 — nodes, links, signals, shockwaves (✓ migrated) ────────────
  animateLayer1(t, dt);

  // ── Layer 2 — bridges, backdrop nodes (✓ migrated — Phase E) ────────────
  animateLayer2(t, dt);

  // ── Layer 3 — macro clusters (✓ migrated — Phase F) ──────────────────────
  animateLayer3(t, dt);

  // ── Systems — Phase G baseline migration ─────────────────────────────────
  tickAI(t);
  tickEvents(t);
  tickBoss(t);
  // ── v96: Strategic systems ──────────────────────────────────────────────
  tickEconomy(t);
  tickTechTree(t);
  tickCrisis(t);
  updateDiagColors();

  // ── v98: Heartbeat + Awakening ──────────────────────────────────────────
  tickHeartbeat(t, dt);
  try { tickPlasticityVisuals(dt); } catch(e) { if (import.meta.env.DEV) console.warn('[Plasticity] tick failed:', e); }  // v98: smooth link plasticity visuals
  tickAwakening(t);
  tickDaemons(t);
  tickNomads(t, dt);           // v98: Data Nomads
  updateNomadHUD();              // v98: Nomad HUD
  tickGridExpansion(t);        // v98: Grid Expansion animation
  updateEpochBadge();  // v98: update epoch badge each frame (cheap DOM text set)

  tickMetaFlow(t);
  tickMetaScreens(t, dt);
  tickEnergyDecay();

  // Visual FX systems — silent in prod, warns in dev (non-critical visual only)
  try { tickCameraFX(t, dt); } catch(e) { if (import.meta.env.DEV) console.warn('[CameraFX] tick error:', e); }
  try { tickClusterFX(t, dt, gameNodes, gameLinks); } catch(e) { if (import.meta.env.DEV) console.warn('[ClusterFX] tick error:', e); }
  try { tickVisualEnhancer(t, dt, gameNodes, gameLinks); } catch(e) { if (import.meta.env.DEV) console.warn('[VisualEnhancer] tick error:', e); }

  const hudMask = consumeHUDSignalMask();
  if (hudMask) refreshHUDMask(hudMask);

  _uiAccum += dt;
  if (_uiAccum >= 0.22) {
    _uiAccum = 0;
    if (shouldTickTopHUD()) refreshHUDMask(HUD_SECTION_MASK.top);
  }

}

// ── Legacy window bridges (invoked by shell + hotkeys callers) ───────────────
window._cancelGameLoop = stopLoop;
window._startGameLoop  = startLoop;
