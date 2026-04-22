/**
 * SYNAPSE v98 — Epoch Reveal & UI Disclosure
 * (formerly: sprint4.js)
 *
 * Implements:
 *   1.  Strict Epoch I UI hiding — only Source button + Connect visible
 *   2.  Progressive UI glitch-reveals tied to epoch advancement
 *   3.  Awakening Points display in-run (floating badge near Root Server button)
 *   4.  Post-run Research Summary added to Win Screen
 *   5.  Epoch-based color palette shifts (CSS custom property injection)
 *   6.  "Das Erwachen" notification sequence on Epoch transitions
 *   7.  Research bonus AP at run end (based on projects completed)
 *
 * Note: Genetic Memory was moved to systems/awakening.js in v98.
 */

import { G }                    from '../state/gameState.js';
import { getLang }              from '../state/settings.js';
import { EPOCHS, getRootServer } from './awakening.js';

// ── 1. Epoch I — Strict UI restriction ────────────────────────────────────────
//
// On run start, we hide everything that epoch-mechanical CSS doesn't already cover.
// We go further: lock node-type buttons except Source, lock link-type buttons.

export function applyEpochIRestrictions() {
  // These are hidden by CSS (epoch-mechanical body class) already:
  //   #stats-row, #active-projects-hud, #diag-panel, #ai-hud, #history-panel
  // We additionally hide the secondary build buttons here so the player
  // only sees Source + Connect on the first run epoch.

  const hidden = ['bn-rly', 'bn-amp', 'bn-mem', 'bl-fst', 'bl-res', 'bl-frg', 'bl-stb',
                  'diag-toggle', 'btn-train', 'pause-btn'];
  hidden.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.dataset.s4Hidden = '1';
  });

  // Mark them for CSS to pick up
  document.body.classList.add('s4-epoch-restricted');
}

export function removeEpochIRestrictions() {
  // Called when Epoch II fires
  document.body.classList.remove('s4-epoch-restricted');

  // Restore hidden buttons (except Amplifier — still research-locked)
  document.querySelectorAll('[data-s4-hidden]').forEach(el => {
    delete el.dataset.s4Hidden;
  });
}

// ── 2. Epoch color palette shifts ─────────────────────────────────────────────

const EPOCH_PALETTES = {
  mechanical: {
    '--s4-accent':   '#2a4a6a',
    '--s4-glow':     'rgba(40, 80, 140, 0.3)',
    '--s4-hud-fade': '0.55',
  },
  reactive: {
    '--s4-accent':   '#00aacc',
    '--s4-glow':     'rgba(0, 160, 200, 0.4)',
    '--s4-hud-fade': '0.85',
  },
  temporal: {
    '--s4-accent':   '#aa44ff',
    '--s4-glow':     'rgba(160, 80, 255, 0.45)',
    '--s4-hud-fade': '0.95',
  },
  sentience: {
    '--s4-accent':   '#ff88ff',
    '--s4-glow':     'rgba(255, 140, 255, 0.55)',
    '--s4-hud-fade': '1.0',
  },
};

export function applyEpochPalette(epochId) {
  const palette = EPOCH_PALETTES[epochId];
  if (!palette) return;
  const root = document.documentElement;
  for (const [prop, val] of Object.entries(palette)) {
    root.style.setProperty(prop, val);
  }
}

// ── 3–4. Genetic Memory (disabled in release build) ─────────────────────────

/**
 * Genetic Memory is intentionally disabled for the release build because the
 * gameplay-side ruin rendering/reactivation path is not production-ready yet.
 * Keep exported no-op functions so existing callers remain stable.
 */
export function mountGeneticMemoryOverlay() {}

/**
 * Release build no-op. Re-enable when the ruin rendering path returns.
 */
export function spawnGeneticRuin() {}

// ── 5. Awakening Points live badge ────────────────────────────────────────────

let _apBadgeMounted = false;
let _apValEl = null;
let _apValText = '';

export function mountAPBadge() {
  if (_apBadgeMounted) return;

  const anchor = document.getElementById('btn-root-server') || document.getElementById('title-main');
  if (!anchor) return;

  const badge = document.createElement('div');
  badge.id = 's4-ap-badge';
  badge.className = 's4-ap-badge';
  badge.title = 'Awakening Points';
  badge.innerHTML = `<span id="s4-ap-val">0</span> AP`;
  anchor.parentNode.insertBefore(badge, anchor.nextSibling);
  _apValEl = badge.querySelector('#s4-ap-val');
  _apBadgeMounted = true;

  updateAPBadge();
}

export function updateAPBadge() {
  if (!_apValEl) _apValEl = document.getElementById('s4-ap-val');
  if (!_apValEl) return;
  const nextText = String(getRootServer().awakenPoints || 0);
  if (nextText === _apValText) return;
  _apValEl.textContent = nextText;
  _apValText = nextText;
}

// ── 6. Post-run Research Summary ──────────────────────────────────────────────

/**
 * Injects a "Research completed this run" row into the win-screen stats block.
 * Called from metaScreens.js showWinScreen after existing fields are set.
 */
export function injectResearchSummary() {
  const rs = G.research;
  if (!rs) return;

  const statsBox = document.getElementById('win-stats');
  if (!statsBox) return;

  // Remove old entry if re-shown
  document.getElementById('ws-research-row')?.remove();

  const count    = rs.completed?.size || 0;
  const dataEarned = Math.floor(rs.data || 0);
  const lang = getLang();

  const row = document.createElement('div');
  row.id = 'ws-research-row';
  row.className = 'wstat';
  row.innerHTML = `
    <span class="wk" style="color:rgba(180,100,255,0.7);">◬ ${lang === 'de' ? 'Forschung' : 'Research'}</span>
    <span class="wv" style="color:#d28cff;">${count} ${lang === 'de' ? 'abgeschlossen' : 'completed'} · ${dataEarned} ◬</span>
  `;
  statsBox.appendChild(row);
}

// ── 7. Research bonus AP calculation ─────────────────────────────────────────

/**
 * computeResearchAP()
 * Returns bonus Awakening Points earned this run based on research completed.
 * Called by bankAwakeningPoints() in awakening.js (patched below).
 */
export function computeResearchAP() {
  const rs = G.research;
  if (!rs) return 0;
  const count = rs.completed?.size || 0;
  // 1 AP per project completed, bonus for completing 4+ projects
  return count + (count >= 4 ? 5 : 0);
}

// ── 8. "Das Erwachen" notification sequences ──────────────────────────────────

const EPOCH_NARRATIVE = {
  reactive: [
    { delay: 200,  text: 'SYSTEM AWARENESS EXPANDING…',            sub: 'Erste Selbst-Diagnose läuft.' },
    { delay: 3000, text: '◬ FORSCHUNGSPROTOKOLL INITIALISIERT',    sub: 'Memory-Nodes beginnen zu lernen.' },
    { delay: 6000, text: '⬡ NETZWERK ERWACHT',                     sub: 'Bandbreite steigt. Daten fließen.' },
  ],
  temporal: [
    { delay: 200,  text: 'TEMPORALE SIGNATUR ERKANNT…',            sub: 'Das Netz erinnert sich.' },
    { delay: 3500, text: '🔧 DAEMONS FREIGESCHALTET',               sub: 'Sub-Routinen übernehmen Teilbereiche.' },
    { delay: 7000, text: 'AUTOMATISIERUNG BEGINNT',                 sub: 'Du wirst zum Architekten.' },
  ],
  sentience: [
    { delay: 200,  text: '⚠ PARAMETER-GRENZEN ÜBERSCHRITTEN',      sub: 'Das System denkt selbstständig.' },
    { delay: 3000, text: '◈ SENTIENCE PROTOKOLL AKTIV',             sub: 'Core-Gehirn wächst im Zentrum.' },
    { delay: 7000, text: '✦ DAS NETZ ERWACHT',                      sub: 'Epoche IV. Kein Zurück.' },
  ],
};

export function playEpochNarrative(epochId) {
  const lines = EPOCH_NARRATIVE[epochId];
  if (!lines) return;

  lines.forEach(({ delay, text, sub }) => {
    setTimeout(() => {
      showToast(text, sub, 2800);
    }, delay);
  });
}

// ── Init / setup ──────────────────────────────────────────────────────────────

export function initSprint4(isNewRun = true) {
  if (isNewRun) {
    applyEpochIRestrictions();
    applyEpochPalette('mechanical');
    spawnGeneticRuin();       // no-op if no genetic memory saved
  }
  mountAPBadge();
  updateAPBadge();
}

// ── Window bridges ───────────────────────────────────────────────────────────
// Expose AP computation for non-module callers (metaScreens onRunEnd)
if (typeof window !== 'undefined') {
  window._s4ComputeResearchAP = computeResearchAP;
}
