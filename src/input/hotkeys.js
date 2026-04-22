import { regListener } from '../registries/listenerRegistry.js';
import { G } from '../state/gameState.js';
import { cycleNodeRenderMode, gameNodes } from '../layers/network/index.js';
import { safeRestart } from '../engine/dispose.js';
import { setMode, setNodeType } from '../gameplay/progression.js';
import { doPulse } from '../gameplay/actions.js';
import { doTrainPulse } from '../systems/ai.js';
import { closeSettings, closeInfo, skipDraft, togglePause } from '../gameplay/shellControls.js';
import { THRESHOLDS } from '../ui/hud/index.js';
// v96: Diagnostic lens cycling
import { cycleLens } from '../systems/diagnostics.js';
// v98: Blueprint mode
import { toggleBlueprintMode } from '../systems/blueprint.js';
// Tactical View (Shift+L)
import { toggleTactical } from '../systems/tacticalView.js';
// Rewind (Ctrl+Z) — temporal protocol scaffold
import { consumeRewind, getRewindDepth } from '../gameplay/rewindBuffer.js';
import { restoreTopology, applyRestoredState } from '../state/saveSystem.js';
// v98: Emergency pulse (heartbeat) and Root Server
import { fireEmergencyPulse } from '../systems/heartbeat.js';
import { showRootServer, hideRootServer } from '../systems/rootServer.js';
import { autoRouter } from '../systems/autorouter.js';  // v98
// ISSUE-7 fix: use Three.js clock (same time source as gameLoop/heartbeat) instead of
// performance.now() — they diverge after tab-hide because Three.js clock can be paused,
// causing emergency-pulse cooldown miscalculation on long sessions.
import { clock } from '../engine/scene.js';

let bound = false;

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toUpperCase();
  if (target.isContentEditable) return true;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON';
}

function interactiveOverlayShown() {
  return overlayShown('draft-overlay')
    || overlayShown('protocol-overlay')
    || overlayShown('settings-overlay')
    || overlayShown('info-overlay')
    || overlayShown('history-panel');
}

function overlayShown(id) {
  const node = document.getElementById(id);
  return !!node && (node.classList.contains('show') || node.classList.contains('active') || node.classList.contains('vis') || node.classList.contains('open') || node.style.display === 'block');
}

function closeOverlay(id) {
  const node = document.getElementById(id);
  if (!node) return false;
  node.classList.remove('show', 'active');
  if (id === 'settings-overlay') closeSettings();
  else if (id === 'info-overlay') closeInfo();
  else if (id === 'draft-overlay') skipDraft();
  else if (id === 'protocol-overlay') node.classList.remove('show');
  else if (id === 'history-panel') node.classList.remove('vis');
  return true;
}

function onKeyDown(event) {
  if (event.repeat) return;

  if (event.key === 'Escape') {
    const overlayIds = ['draft-overlay', 'protocol-overlay', 'settings-overlay', 'info-overlay', 'history-panel'];
    for (const id of overlayIds) {
      if (overlayShown(id)) {
        closeOverlay(id);
        return;
      }
    }
    const pauseBtn = document.getElementById('pause-btn');
    const gameRunning = !!pauseBtn && pauseBtn.style.display !== 'none';
    // v96: Pause is the Tactical Mode — safe to plan & redesign network
    if (gameRunning && !G.runWon) togglePause();
    return;
  }

  if (isTypingTarget(event.target)) return;

  if (interactiveOverlayShown()) {
    if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') event.preventDefault();
    return;
  }

  if (event.key === 'r' || event.key === 'R') {
    if (event.shiftKey) {
      // v98: Shift+R toggles Root Server panel
      // ISSUE-3 fix: panel.style.display is now always 'block' or 'none' (set on mount),
      // so the old (!panel.style.display) fallback is no longer needed.
      const panel = document.getElementById('v97-root-server');
      if (panel) {
        if (panel.style.display === 'none') showRootServer();
        else hideRootServer();
      }
      return;
    }
    if (G.runWon) safeRestart();
    // Also allow R to restart from the fail screen
    if (document.getElementById('fail-screen')?.classList.contains('show')) safeRestart();
    return;
  }

  if (event.key === 'a' || event.key === 'A') {
    if (!event.shiftKey && !event.ctrlKey && !event.altKey) {
      // v98: Auto-Router toggle (Epoch III+)
      autoRouter.toggle();
      return;
    }
  }

  if (event.key === 'i' || event.key === 'I') {
    if (event.shiftKey || event.altKey) {
      cycleNodeRenderMode();
      return;
    }
  }

  if (G.paused) return;

  if (event.key === 'p' || event.key === 'P') {
    setMode('place');
    return;
  }
  if ((event.key === 'c' || event.key === 'C')) {
    setMode('connect');
    return;
  }

  if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') {
    event.preventDefault();
    // v98: Space is now Emergency Pulse (30s CD) — normal energy flows automatically
    // ISSUE-7 fix: use Three.js clock (same source as heartbeat.js) not performance.now()
    const t = clock.getElapsedTime();
    fireEmergencyPulse(t);
    return;
  }

  if (event.key === 't' || event.key === 'T') {
    doTrainPulse();
    return;
  }

  if (event.key === '1') return void setNodeType('source');
  if (event.key === '2') return void setNodeType('relay');
  if (event.key === '3') return void setNodeType('amplifier');
  if (event.key === '4') return void setNodeType('memory');
  if (event.key === '5') return void setNodeType('catalyst');

  // v96: Diagnostic lens (L key cycles through heatmap views)
  // Shift+L upgrades L into a true Tactical View (no bloom/glow, blueprint look)
  if (event.key === 'l' || event.key === 'L') {
    if (event.shiftKey) {
      toggleTactical();
      return;
    }
    const lens = cycleLens();
    const lensNames = { none: 'Normal', bandwidth: 'Bandbreite', energy: 'Energie', terrain: 'Terrain', infection: 'Infektion' };
    import('../ui/hud/index.js').then(({ showToast }) => {
      showToast('🔍 LENS: ' + (lensNames[lens] || lens).toUpperCase(), '', 900);
    });
    return;
  }

  // Rewind (Ctrl+Z): jump network state back ~10 seconds. Foundation for the
  // temporal protocol's player-facing Rewind upgrade — currently free in dev.
  if ((event.key === 'z' || event.key === 'Z') && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    const snap = consumeRewind(10);
    if (!snap) {
      import('../ui/hud/index.js').then(({ showToast }) => {
        showToast('⏪ REWIND', 'Kein Snapshot verfügbar', 1100);
      });
      return;
    }
    try {
      applyRestoredState(snap);
      restoreTopology(snap);
      import('../ui/hud/index.js').then(({ showToast }) => {
        showToast('⏪ REWIND', '~10s zurückgespult (' + getRewindDepth() + ')', 1400);
      });
    } catch (e) {
      import('../ui/hud/index.js').then(({ showToast }) => {
        showToast('⏪ REWIND', 'Fehlgeschlagen: ' + (e?.message || e), 1800);
      });
    }
    return;
  }

  // v98: Blueprint mode (B key)
  if (event.key === 'b' || event.key === 'B') {
    toggleBlueprintMode('highway');
    return;
  }
}

export function bindKeyboardShortcuts() {
  if (bound) return;
  bound = true;
  regListener(document, 'keydown', onKeyDown);
}

