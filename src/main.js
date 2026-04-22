/**
 * SYNAPSE v98 — Main Entry Point
 *
 * Import order is intentional:
 *   1. CSS (Vite processes and injects into <head>)
 *   2. Registries — must be first so timer/listener systems are available
 *      to everything that imports after them
 *   3. Engine — scene, game loop, dispose (wires _safeRestart, _returnToTitle)
 *   4. State  — tuning, game state, save system
 *   5. Audio  — SFX (lazy AudioContext, safe to init early)
 *   6. Layers + Systems + UI — fully modular runtime/gameplay stack
 *   7. Prod-ready layer — accessibility, lifecycle events, runtime monitoring
 *   8. Boot  — DOM-ready gate, start loop
 */

// ── 1. Styles ──────────────────────────────────────────────────────────────
import './styles/index.css';

// ── 2. Registries ─────────────────────────────────────────────────────────
import './registries/timerRegistry.js';
import './registries/listenerRegistry.js';
import { regListener } from './registries/listenerRegistry.js';

// ── 3. Engine ──────────────────────────────────────────────────────────────
import './engine/scene.js';
import { stopLoop }  from './engine/gameLoop.js';
import './engine/dispose.js';

// ── 4. State ───────────────────────────────────────────────────────────────
import { persistSave } from './state/saveSystem.js';
import { G }            from './state/gameState.js';

// ── 5. Audio ───────────────────────────────────────────────────────────────
import './audio/sfx.js';
import { checkAudioHealth } from './platform/safeAudio.js';
import './platform/safeStorage.js';
import { startRewindBuffer } from './gameplay/rewindBuffer.js';
import { autoDetectGraphicsQuality } from './platform/fxQuality.js';
import { initTelemetryOverlay } from './platform/telemetryOverlay.js';

// ── 6. Layers + Systems + UI ───────────────────────────────────────────────
import './layers/network/index.js';
import './layers/bridge/index.js';
import './layers/meta/index.js';
import './systems/protocols.js';
import './systems/ai.js';
import './systems/events.js';
import './systems/boss.js';
import './ui/hud/index.js';
import './ui/overlays.js';
import './ui/dockCollapse.js';
import './ui/actionFlow.js';
import './gameplay/actions.js';
import './meta/flow.js';
import './meta/screens.js';
import './boot/activity.js';
import { initOnboarding } from './meta/onboarding.js';
import { initDomBindings } from './boot/domBindings.js';
import { bindCompatAliases } from './boot/compat.js';
import { bootRuntime } from './boot/runController.js';
import { setPauseState } from './gameplay/shellControls.js';
import { synSettings }   from './state/settings.js';

// ── 7. Prod-ready layer ────────────────────────────────────────────────────


const PROD_VERSION = 'v98.0';

(function initProdLayer() {
  if (window.__SYNAPSE_PROD_READY__) return;
  window.__SYNAPSE_PROD_READY__ = true;

  const banner = document.getElementById('prod-status-banner');
  const mql    = {
    motion:       window.matchMedia?.('(prefers-reduced-motion: reduce)'),
    transparency: window.matchMedia?.('(prefers-reduced-transparency: reduce)'),
  };

  function showBanner(message, level) {
    if (!banner || !message) return;
    banner.textContent  = message;
    banner.dataset.level = level || 'error';
    banner.style.display = 'block';
  }

  function hideBanner() {
    if (banner) banner.style.display = 'none';
  }

  function syncAccessibility() {
    document.body.classList.toggle('reduce-motion', !!mql.motion?.matches);
    document.body.classList.add('prod-ready');
    if (mql.transparency?.matches) {
      document.documentElement.style.setProperty('--hud-panel-blur', 'none');
    }
  }

  function labelButtons() {
    const de = document.documentElement.lang !== 'en' && (synSettings?.lang || 'de') === 'de';
    const labels = {
      'pause-btn':       de ? 'Pause-Menü' : 'Pause menu',
      'history-toggle':  de ? 'Spielverlauf öffnen' : 'Open run history',
      'ob-skip':         de ? 'Einführung überspringen' : 'Skip onboarding',
      'boss-start-btn':  de ? 'Boss-Kampf starten' : 'Start boss encounter',
      'win-restart':     de ? 'Neuen Run starten' : 'Start a new run',
    };
    Object.entries(labels).forEach(([id, label]) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('aria-label', label);
    });
  }
  window.__synRelabelButtons = labelButtons;

  function wireLifecycle() {
    regListener(document, 'visibilitychange', () => {
      if (document.hidden) {
        try { persistSave('visibility-hidden'); } catch (_) {}
        if (G?.autoOn && !G.runWon) setPauseState(true, { showOverlay: true });
      }
    }, { passive: true });

    regListener(window, 'beforeunload', () => {
      try { persistSave('beforeunload'); } catch (_) {}
      stopLoop();
    });

    regListener(window, 'pagehide', () => {
      try { persistSave('pagehide'); } catch (_) {}
    }, { passive: true });
  }

  function wireRuntimeMonitoring() {
    regListener(window, 'error', event => {
      const msg = event?.message || 'Unexpected runtime error';
      showBanner('A runtime error occurred. Progress was kept locally where possible. Details: ' + msg, 'error');
      try { persistSave('runtime-error'); } catch (_) {}
    });

    regListener(window, 'unhandledrejection', event => {
      const reason = event?.reason && (event.reason.message || String(event.reason));
      showBanner('An unexpected async error occurred. Details: ' + (reason || 'Unknown'), 'error');
      try { persistSave('unhandled-rejection'); } catch (_) {}
    });
  }

  function stampBuildMeta() {
    document.documentElement.setAttribute('data-build', PROD_VERSION);
    document.documentElement.setAttribute('data-runtime', 'production');

  // ── Internal API boundary ─────────────────────────────────────────────────
  // The following window._ and window.__ names are INTERNAL bridges.
  // They exist for legacy callers that cannot yet use ES imports.
  // PUBLIC surface: window.SYNAPSE_BUILD only.
  //
  // Internal bridges (defined in their owning module, listed here for audit):
  //   window._makeNode, _makeLink, _spawnSig, _spawnShock       → layer1.js
  //   window._spawnPulseTrail, _checkTris, _removeNode, _removeLink
  //   window._resetLayer1Runtime, _getNodeRenderStats            → layer1.js
  //   window._setNodeRenderMode, _cycleNodeRenderMode            → layer1.js
  //   window._setNodeInstanceThreshold                           → layer1.js
  //   window._evalBridges, _resetLayer2Runtime, _initL2          → layer2.js
  //   window._updateActiveProjectsHud                            → layer3.js
  //   window._disposeAllSceneObjects, _safeRestart, _returnToTitle → dispose.js
  //   window._cancelGameLoop, _startGameLoop                     → gameLoop.js
  //   window._scene, _camera, _renderer, _comp                   → scene.js
  //   window._pulseTrails, NT, LT                                → layer1.js
  //   window.TM                                                  → layer2.js
  //   window.MM, ELITE_CLUSTER_DEFS                              → layer3.js
  //   window.TUNING                                              → tuning.js
  //   window.G                                                   → gameState.js
  //   window.G_DRAFT, _combo                                     → metaFlow.js
  //   window.signals, gameNodes, gameLinks                       → layer1.js
  //   window.SFX                                                 → sfx.js
  //   window.__synRelabelButtons                                 → main.js (below)
  //   window.__syn* state singletons                             → state/*.js
  //   window._synSettings                                        → settings.js
  //   window._flushPendingSave, _startAutoSave, _cancelAutoSave  → saveSystem.js
  //   window._bindPointerInput                                   → input.js
  //   window._getFxQualityStats                                  → fxQuality.js
  //   window._clearAllListeners                                  → listenerRegistry.js
  //   window._clearAllTimers                                     → timerRegistry.js
  //   window._diffDraftCap                                       → shellControls.js
  //   window._resumeRestoring                                    → saveSystem.js
  //   window._msgStack                                           → (toast/overlay runtime)
  //   window.logTL                                               → actionFlow.js (compat stub)
  //   window.T, window.TM, window.MM                             → (timer/material packs)
  //   window.__l3TooltipCfg                                      → layer3Panels.js
  //   window.countConnectedCorePairs                             → layer1.js
  //   window._selectProtocol, _confirmProtocol                   → protocols.js
  //   window._metaObj_captureTimestamps                          → metaFlow.js
  //
  // Goal: reduce this list to zero over time. Prefer ES imports.
  // ─────────────────────────────────────────────────────────────────────────
    window.SYNAPSE_BUILD = Object.freeze({
      version:    PROD_VERSION,
      mode:       import.meta.env.MODE,
      builtAt:    __BUILD_TIME__,   // baked in at build time by Vite — reliable for QA/debugging
      commitSha:  __COMMIT_SHA__,   // git short hash, 'unknown' in environments without git
      launchedAt: new Date().toISOString(), // page-load time — use for session timing only
    });
  }

  function normalizeTitle() {
    document.title = 'Synapse ' + PROD_VERSION + ' — Final Build';
    const el = document.getElementById('title-version');
    if (el) el.textContent = '© 2026 · Synapse ' + PROD_VERSION + ' · Final Build';
  }

  stampBuildMeta();
  syncAccessibility();
  normalizeTitle();
  labelButtons();
  wireLifecycle();
  wireRuntimeMonitoring();
  hideBanner();

  if (mql.motion?.addEventListener) regListener(mql.motion, 'change', syncAccessibility);
  if (mql.transparency?.addEventListener) regListener(mql.transparency, 'change', syncAccessibility);
})();

// ── 8. Boot ────────────────────────────────────────────────────────────────

function revealApp() {
  // Reveal body only after fonts + styles are ready — eliminates FOUC
  const doReveal = () => document.body.classList.add('synapse-ready');
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(doReveal).catch(doReveal);
  } else {
    // fallback: small delay ensures styles are applied
    setTimeout(doReveal, 80);
  }
}

function boot() {
  bindCompatAliases();
  initOnboarding();
  initDomBindings();
  initTelemetryOverlay();
  bootRuntime();
  // Probe AudioContext on user-gestured boot path; surfaces a banner if blocked.
  try { checkAudioHealth(); } catch (_) {}
  // Start the 10s rewind ring buffer (used by Ctrl+Z and the Rewind upgrade).
  try { startRewindBuffer(); } catch (_) {}
  // Restore Colorblind / Tactical preferences from settings.
  try {
    if (synSettings.colorblind) document.body.dataset.colorblind = 'on';
    if (synSettings.tactical)   document.body.dataset.tactical   = 'on';
  } catch (_) {}
  // v98: Auto-detect low-end devices and set graphics quality before reveal
  autoDetectGraphicsQuality();
  revealApp();
}

if (document.readyState === 'loading') {
  regListener(document, 'DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
