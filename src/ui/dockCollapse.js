/**
 * SYNAPSE — Dock Collapse & HUD Idle-Fade
 * ────────────────────────────────────────────
 * Purely additive UX layer. Touches NO existing game state, no setMode,
 * no progression — only toggles two body classes that mobile-dock.css
 * reads:
 *   body.v92-types-open   — sub-menu (#type-bar) is currently expanded
 *   body.v92-hud-idle     — no input for IDLE_MS, fade non-critical chrome
 *
 * Behaviour:
 *   • On boot the type-bar is collapsed.
 *   • Tapping the active mode button toggles the type-bar.
 *   • Switching mode briefly auto-shows the type-bar for AUTO_SHOW_MS,
 *     then collapses if the user did not pick a type.
 *   • Picking a type collapses the type-bar after PICK_COLLAPSE_MS.
 *   • Tapping anywhere outside the dock collapses immediately.
 *   • The HUD chrome fades to ~40 % after IDLE_MS of no pointer/key input
 *     and snaps back instantly on any input.
 *
 * The module is import-only and self-installing; it returns nothing.
 */

const IDLE_MS         = 4000;
const AUTO_SHOW_MS    = 2400;
const PICK_COLLAPSE_MS = 600;

const $ = (id) => document.getElementById(id);

function ready(fn) {
  if (document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn, { once: true });
}

ready(() => {
  const body     = document.body;
  const dock     = $('ctrl-dock');
  const typeZone = $('dock-type-zone');
  const btnP     = $('btn-p');
  const btnC     = $('btn-c');
  const typeBar  = $('type-bar');

  if (!dock || !typeZone) return;

  let autoCollapseTimer = null;

  function clearTimer() {
    if (autoCollapseTimer) {
      clearTimeout(autoCollapseTimer);
      autoCollapseTimer = null;
    }
  }

  function openTypes(autoMs) {
    body.classList.add('v92-types-open');
    clearTimer();
    if (autoMs) {
      autoCollapseTimer = setTimeout(() => {
        body.classList.remove('v92-types-open');
      }, autoMs);
    }
  }
  function closeTypes() {
    body.classList.remove('v92-types-open');
    clearTimer();
  }
  function toggleTypes() {
    if (body.classList.contains('v92-types-open')) closeTypes();
    else openTypes();
  }

  /* ── Active mode button: tap to toggle, also auto-show on mode switch ── */
  function wireModeButton(btn) {
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      // If this button is already active → toggle the sub-menu.
      // If it isn't, the game's own handler will switch mode; we then
      // peek-show types so the user sees what they can pick.
      if (btn.classList.contains('active')) {
        // The game handler ran first (since it was already active, no-op);
        // we just toggle.
        toggleTypes();
      } else {
        // Mode is switching — schedule a peek after the game's handler runs.
        setTimeout(() => openTypes(AUTO_SHOW_MS), 0);
      }
    }, true);
  }
  wireModeButton(btnP);
  wireModeButton(btnC);

  /* ── Type pick → keep open briefly so user sees the selection, then close ── */
  if (typeBar) {
    typeBar.addEventListener('click', (e) => {
      const t = e.target.closest('.tbtn');
      if (!t) return;
      clearTimer();
      autoCollapseTimer = setTimeout(closeTypes, PICK_COLLAPSE_MS + 800);
    });
  }

  /* ── Tap outside the dock (on the network) → collapse immediately ── */
  document.addEventListener('pointerdown', (e) => {
    if (!body.classList.contains('v92-types-open')) return;
    if (dock.contains(e.target)) return;
    // Don't collapse if click hit an overlay/modal
    if (e.target.closest('#protocol-overlay, #info-overlay, #settings-overlay, #pause-overlay, #win-screen, #onboard-card')) return;
    closeTypes();
  }, true);


  /* ════════════════════════════════════════════════════════════════════════
     HUD IDLE FADE
     ════════════════════════════════════════════════════════════════════════ */
  let idleTimer = null;
  function poke() {
    if (body.classList.contains('v92-hud-idle')) {
      body.classList.remove('v92-hud-idle');
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // never idle while an overlay is open or types are expanded
      if (body.classList.contains('is-paused')) return;
      if (body.classList.contains('v92-types-open')) return;
      const anyOverlayOpen = !!document.querySelector(
        '#protocol-overlay.show, #info-overlay.show, #settings-overlay.show, ' +
        '#pause-overlay.show, #win-screen.show, #draft-overlay.show, ' +
        '#postrun-overlay.show, #onboard-card.vis'
      );
      if (anyOverlayOpen) return;
      body.classList.add('v92-hud-idle');
    }, IDLE_MS);
  }
  ['pointerdown','pointermove','keydown','wheel','touchstart'].forEach((evt) =>
    window.addEventListener(evt, poke, { passive: true })
  );
  poke();
});
