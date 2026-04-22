/**
 * SYNAPSE v98 — Root Server (Inter-Run Tech Tree UI)
 *
 * The Root Server is the persistent meta-progression screen shown on the
 * title screen. Players spend Awakening Points to unlock permanent upgrades
 * that carry into every future run.
 *
 * This module renders and manages the Root Server UI panel.
 * State is stored in localStorage via awakening.js (loadRootServer / saveRootServer).
 */

import { getRootServer, buyRootUpgrade } from './awakening.js';
import { getLang } from '../state/settings.js';
import { ROOT_UPGRADE_REQUIRES, isProtocolGateUnlocked, protocolGateLabel } from './rootServerRules.js';

// ── Root Server upgrade catalogue ─────────────────────────────────────────────

export const ROOT_UPGRADES = [
  {
    id:       'startWithRelay',
    cost:     5,
    icon:     '↔',
    label:    { de: 'Erster Relay', en: 'Head Start Relay' },
    desc:     { de: 'Startet jeden Run mit 1 platzierten Relay-Node.', en: 'Every run starts with 1 pre-placed Relay node.' },
    requires: [],
  },
  {
    id:       'mnemonic_research',
    cost:     8,
    icon:     '◉',
    label:    { de: 'Mnemonic Forschung', en: 'Mnemonic Research' },
    desc:     { de: 'Mnemonic-Protokoll startet mit Forschungspanel geöffnet.', en: 'Mnemonic Protocol starts with research panel open.' },
    requires: [],
    protocolGate: 'mnemonic',
  },
  {
    id:       'spine_daemons',
    cost:     8,
    icon:     '🔧',
    label:    { de: 'Spine Daemons', en: 'Spine Daemons' },
    desc:     { de: 'Spine-Protokoll startet mit 1 freigeschaltetem Repair-Daemon.', en: 'Spine Protocol starts with 1 unlocked Repair Daemon.' },
    requires: [],
    protocolGate: 'spine',
  },
  // assimilation_bank and persistent_seed removed for this release —
  // persistence model is not complete. Re-enable in a later milestone.
  {
    id:       'expanded_canvas',
    cost:     25,
    icon:     '⬡⬡',
    label:    { de: 'Erweitertes Canvas', en: 'Expanded Canvas' },
    desc:     { de: 'Grid erweitert sich auf 50×50 nach dem ersten Boss-Kill.', en: 'Grid expands to 50×50 after first boss kill.' },
    requires: ['startWithRelay'],
  },
];


// ── Panel rendering ────────────────────────────────────────────────────────────

let _panelMounted = false;
let _panelEl = null;
let _panelHTML = '';

export function mountRootServerPanel() {
  if (_panelMounted) return;

  // Look for the title meta box (where run history is shown)
  const anchor = document.getElementById('title-meta-box') || document.getElementById('title-main');
  if (!anchor) return;

  const panel = document.createElement('div');
  panel.id = 'v97-root-server';
  panel.className = 'v97-root-server';
  // ISSUE-3 fix: set explicit display so the Shift+R toggle comparison
  // ('none' vs 'block') is always reliable — omitting this left display=''
  // which made the toggle call showRootServer() twice instead of toggling.
  panel.style.display = 'block';
  _panelEl = panel;
  _renderRootServerPanel();
  panel.addEventListener('click', _onRootServerPanelClick);
  anchor.parentNode.insertBefore(panel, anchor.nextSibling);

  _panelMounted = true;
}

// ISSUE-9 fix: reset flag so title-screen remount after safeRestart works
export function resetRootServerPanel() {
  if (_panelEl) {
    _panelEl.removeEventListener('click', _onRootServerPanelClick);
  }
  _panelMounted = false;
  _panelEl = null;
  _panelHTML = '';
}

function _buildPanelHTML() {
  const rs   = getRootServer();
  const lang = getLang();

  const upgradeRows = ROOT_UPGRADES.map(upg => {
    const owned = rs.upgrades[upg.id];
    const protocolGateUnlocked = isProtocolGateUnlocked(upg.protocolGate, rs.totalRuns);
    const canBuy = !owned
      && rs.awakenPoints >= upg.cost
      && (ROOT_UPGRADE_REQUIRES[upg.id] || upg.requires || []).every(r => rs.upgrades[r])
      && protocolGateUnlocked;
    const locked = !owned && !canBuy;

    return `
      <div class="rs-upgrade ${owned ? 'rs-owned' : ''} ${locked ? 'rs-locked' : ''} ${canBuy ? 'rs-buyable' : ''}"
           data-upg-id="${upg.id}" data-upg-cost="${upg.cost}">
        <span class="rs-icon">${upg.icon}</span>
        <div class="rs-upg-info">
          <div class="rs-upg-name">${upg.label[lang] || upg.label.en}</div>
          <div class="rs-upg-desc">${upg.desc[lang] || upg.desc.en}</div>
          ${upg.protocolGate && !protocolGateUnlocked ? `<div class="rs-gate-note">${protocolGateLabel(upg.protocolGate, lang, rs.totalRuns)}</div>` : ''}
        </div>
        <div class="rs-cost">
          ${owned
            ? `<span class="rs-owned-label">✓</span>`
            : `<button class="rs-buy-btn" ${!canBuy ? 'disabled' : ''} data-upg-id="${upg.id}" data-upg-cost="${upg.cost}">
                ${upg.cost} AP
               </button>`}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="rs-header">
      <span class="rs-title">◈ ROOT SERVER</span>
      <span class="rs-ap">${rs.awakenPoints} AP</span>
    </div>
    <div class="rs-stats">
      <span>${lang === 'de' ? 'Runs' : 'Runs'}: ${rs.totalRuns}</span>
      <span>${lang === 'de' ? 'Epochen' : 'Epochs'}: ${rs.totalEpochsReached.join(' / ')}</span>
    </div>
    <div class="rs-upgrades">${upgradeRows}</div>`;
}

function _renderRootServerPanel() {
  if (!_panelEl) return;
  const nextHTML = _buildPanelHTML();
  if (nextHTML === _panelHTML) return;
  _panelEl.innerHTML = nextHTML;
  _panelHTML = nextHTML;
}

function _onRootServerPanelClick(e) {
  const btn = e.target.closest('.rs-buy-btn');
  if (!btn || btn.disabled) return;

  const id = btn.dataset.upgId;
  const cost = parseInt(btn.dataset.upgCost, 10);
  if (buyRootUpgrade(id, cost)) {
    _renderRootServerPanel();
  }
}

export function refreshRootServerPanel() {
  if (!_panelEl) _panelEl = document.getElementById('v97-root-server');
  if (!_panelEl) return;
  _renderRootServerPanel();
}

// ── Toggle visibility ──────────────────────────────────────────────────────────

export function showRootServer() {
  if (!_panelEl) _panelEl = document.getElementById('v97-root-server');
  if (_panelEl) _panelEl.style.display = 'block';
}

export function hideRootServer() {
  if (!_panelEl) _panelEl = document.getElementById('v97-root-server');
  if (_panelEl) _panelEl.style.display = 'none';
}
