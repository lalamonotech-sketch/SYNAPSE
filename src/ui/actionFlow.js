import { G } from '../state/gameState.js';
import { metaState, pushTimelineEntry } from '../state/metaState.js';
import { getLang } from '../state/settings.js';
import { aiState } from '../state/aiShared.js';
import { startSyncDecayBarUI, stopSyncDecayBarUI } from './hud/index.js';
import { regTimer, clearTimer } from '../registries/timerRegistry.js';
import { el } from '../util/dom.js';

const NOW_PRIO = { boss: 3, sync: 2, event: 1, advisory: 0.5 };
let nowAction = { prio: 0, key: '' };

export function setNowAction(key, text, cls = '') {
  const prio = NOW_PRIO[key] ?? 0;
  if (prio < nowAction.prio) return;
  nowAction = { prio, key };
  const node = el('now-action');
  if (!node) return;
  node.textContent = text || '';
  node.className = cls || '';
}

export function clearNowAction(key) {
  if (nowAction.key !== key) return;
  clearAllNowAction();
}

export function clearAllNowAction() {
  nowAction = { prio: 0, key: '' };
  const node = el('now-action');
  if (!node) return;
  node.textContent = '';
  node.className = '';
}

function reconcileSyncOverlay() {
  const overlay = el('sync-overlay');
  if (!overlay) return;
  const vulnShowing = el('boss-vuln-bar')?.classList.contains('show');
  overlay.style.visibility = vulnShowing && msgStack.isBossActive() ? 'hidden' : '';
}

function reconcileGameUI() {
  const locked = msgStack.isBossIntro() || msgStack.isPaused();
  const objLine = el('obj-line');
  const hint = el('hint');
  if (objLine) objLine.style.opacity = locked ? '0' : '';
  if (!hint) return;
  if (locked) hint.style.display = 'none';
  else hint.style.display = msgStack._hintVisible ? '' : 'none';
}

export const msgStack = {
  _bossIntroActive: false,
  _bossActive: false,
  _pauseActive: false,
  _hintVisible: true,

  onBossIntroOpen() {
    this._bossIntroActive = true;
    reconcileGameUI();
  },
  onBossFightStart() {
    this._bossIntroActive = false;
    this._bossActive = true;
    reconcileGameUI();
    reconcileSyncOverlay();
  },
  onBossEnd() {
    this._bossIntroActive = false;
    this._bossActive = false;
    reconcileGameUI();
    reconcileSyncOverlay();
  },
  onPauseOpen() {
    this._pauseActive = true;
    reconcileGameUI();
  },
  onPauseClose() {
    this._pauseActive = false;
    reconcileGameUI();
  },
  onVulnBarChange() {
    reconcileSyncOverlay();
  },
  setHintVisible(visible) {
    this._hintVisible = !!visible;
    reconcileGameUI();
  },
  showMissed(duration = 1800) {
    const node = el('missed-flash');
    if (!node) return;
    node.classList.add('show');
    clearTimer('missedSyncFlash');
    regTimer('missedSyncFlash', setTimeout(() => {
      node.classList.remove('show');
      clearTimer('missedSyncFlash');
    }, duration), 'timeout');
  },
  hideMissed() {
    clearTimer('missedSyncFlash');
    el('missed-flash')?.classList.remove('show');
  },
  isBossActive() { return this._bossActive; },
  isBossIntro() { return this._bossIntroActive; },
  isPaused() { return this._pauseActive; },
};

export function showSyncOverlay(cluster, idx, durationMs, isFusionSync = false) {
  const overlay = el('sync-overlay');
  const title = el('sync-title');
  const bar = el('sync-bar');
  if (!overlay || !title || !bar) return;
  const lang = getLang();
  overlay.classList.add('show');
  if (isFusionSync) {
    title.innerText = lang === 'de'
      ? `⬟ FUSION-SYNC C${idx + 1} — 1 Puls = 2 Cluster!`
      : `⬟ FUSION SYNC C${idx + 1} — 1 pulse = 2 clusters!`;
  } else if (G.backboneActive && G.spineNodes?.has?.(idx)) {
    title.innerText = lang === 'de'
      ? `◈ AUTO-SYNC C${idx + 1} — Backbone übernimmt`
      : `◈ AUTO SYNC C${idx + 1} — backbone takes over`;
  } else {
    title.innerText = lang === 'de'
      ? `⟳ SYNC C${idx + 1} — jetzt pulsen!`
      : `⟳ SYNC C${idx + 1} — pulse now!`;
  }
  bar.style.width = '100%';
  startSyncDecayBarUI(durationMs || 4000, !!isFusionSync);
  reconcileSyncOverlay();
}

export function hideSyncOverlay() {
  el('sync-overlay')?.classList.remove('show');
  clearNowAction('sync');
  stopSyncDecayBarUI();
}

export function updateSyncBar(frac) {
  const clamped = Math.max(0, Math.min(1, frac || 0));
  const bar = el('sync-bar');
  if (bar) bar.style.width = `${(clamped * 100).toFixed(1)}%`;
  const fill = el('sync-decay-fill');
  const wrap = el('sync-decay-bar-wrap');
  if (fill && wrap?.classList.contains('vis')) {
    fill.style.width = `${(clamped * 100).toFixed(1)}%`;
    fill.classList.toggle('critical', clamped < 0.25 && !fill.classList.contains('fusion'));
  }
}

export function showMissedSync(duration = 1600) {
  msgStack.showMissed(duration);
}

export function showTrainScorePopup(routing, timing, stability, memory, total) {
  const rows = el('tsp-rows');
  const totalEl = el('tsp-total');
  const popup = el('train-score-popup');
  const title = el('tsp-title');
  if (!rows || !totalEl || !popup) return;

  const lang = getLang();
  const labels = lang === 'de'
    ? ['Routing', 'Timing', 'Stabilität', 'Memory']
    : ['Routing', 'Timing', 'Stability', 'Memory'];
  const vals = [routing, timing, stability, memory];
  const delta = aiState?.lastScoreDelta || {};
  const keys = ['routing', 'timing', 'stability', 'memory'];

  rows.innerHTML = labels.map((label, i) => {
    const d = delta[keys[i]] || 0;
    const dStr = d > 0 ? ` <em style="color:#44ff88;font-size:.75em">+${d} → Score</em>` : '';
    return `<div class="tsp-row">${label}<span>${vals[i]}${dStr}</span></div>`;
  }).join('');

  const spamPenalty = aiState?.trainSpamPenalty || 0;
  const best = aiState?.bestTrainScore || 0;
  const spamWarn = spamPenalty > 0.1
    ? `<div style="font-size:.7em;color:#ff8844;margin-top:4px">⚠ −${Math.round(spamPenalty * 100)}% ${lang === 'de' ? 'Spam-Malus' : 'Spam penalty'}</div>`
    : '';
  const bestStr = best > 0
    ? `<div style="font-size:.72em;color:rgba(255,255,255,.4);margin-top:3px">${lang === 'de' ? 'Bestes Ergebnis' : 'Best score'}: ${best}</div>`
    : '';
  totalEl.innerHTML = `${lang === 'de' ? 'Gesamt' : 'Total'}: ${total}${spamWarn}${bestStr}`;

  const dp = aiState?.dominantProfile;
  const titles = {
    analyst: lang === 'de' ? 'ANALYST-TEST' : 'ANALYST TEST',
    predator: lang === 'de' ? 'PRÄDATOR-TEST' : 'PREDATOR TEST',
    architect: lang === 'de' ? 'ARCHITEKT-TEST' : 'ARCHITECT TEST',
    mnemonic: lang === 'de' ? 'MNEMONIKER-TEST' : 'MNEMONIC TEST',
  };
  if (title) title.innerText = dp ? (titles[dp] || 'TRAINING') : 'TRAINING';

  // Force animation restart even when popup is already showing.
  popup.classList.remove('show');
  // Intentional forced reflow — ensures the browser registers the class removal
  // before re-adding it so the entrance animation plays from frame 0.
  // eslint-disable-next-line no-unused-expressions
  void popup.offsetWidth;
  popup.classList.add('show');
  clearTimer('trainScorePopupHide');
  regTimer('trainScorePopupHide', setTimeout(() => {
    popup.classList.remove('show');
    clearTimer('trainScorePopupHide');
  }, 3200), 'timeout');
}

let eventTimerRaf = null;
let eventTimerStart = 0;
let eventTimerDuration = 0;
function stopEventTimer() {
  if (eventTimerRaf) cancelAnimationFrame(eventTimerRaf);
  eventTimerRaf = null;
}

function renderEventTimeline() {
  const rows = el('win-timeline-rows');
  const empty = el('win-timeline-empty');
  if (!rows || !empty) return;
  const items = metaState.runTimeline || [];
  rows.innerHTML = items.map(item => (
    `<div style="display:flex;align-items:center;gap:8px;font-size:.34rem;letter-spacing:1.5px;color:${item.color || 'rgba(255,255,255,.7)'};padding:2px 0">` +
      `<span style="opacity:.85;min-width:14px">${item.icon || '•'}</span>` +
      `<span style="flex:1">${item.label}</span>` +
      `<span style="opacity:.35">${item.tsLabel}</span>` +
    `</div>`
  )).join('');
  empty.style.display = items.length ? 'none' : 'block';
}

export function logTL(type, label, color = 'rgba(255,255,255,.7)', icon = '•') {
  const now = Date.now();
  const elapsedSec = G.runStart ? Math.max(0, Math.round((now - G.runStart) / 1000)) : 0;
  pushTimelineEntry({
    type,
    label,
    color,
    icon,
    ts: now,
    tsLabel: `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}`,
  });
  // Keep only the latest 24 entries — remove from the front (oldest first).
  if (metaState.runTimeline.length > 24) metaState.runTimeline.splice(0, metaState.runTimeline.length - 24);
  renderEventTimeline();
}

export function showEventBanner(ev, chainInfo = null) {
  const banner = el('event-banner');
  const labelEl = el('ev-label');
  const titleEl = el('ev-title');
  const descEl = el('ev-desc');
  const orbEl = el('ev-orb');
  const pill = el('event-pill');
  const timerBar = el('event-timer-bar');
  const timerFill = el('event-timer-fill');
  if (!banner || !titleEl || !descEl) return;

  const eventClassLabel = ev.eventClass === 'boost'
    ? 'Verstärkung'
    : ev.eventClass === 'disruption'
      ? 'Anomalie'
      : ev.eventClass === 'tradeoff'
        ? 'Kompromiss'
        : (ev.positive ? 'Verstärkung' : 'Anomalie');

  const chainStep = (chainInfo && chainInfo.chainTotal > 1) ? chainInfo.chainStep : 0;
  const chainTotal = (chainInfo && chainInfo.chainTotal > 1) ? chainInfo.chainTotal : 0;
  const chainTag = chainTotal > 1 ? ` · KETTE ${chainStep}/${chainTotal}` : '';

  if (labelEl) labelEl.textContent = `◈ Netz-Störung · ${eventClassLabel}${chainTag}`;
  titleEl.textContent = String(ev.name || 'EVENT').toUpperCase();
  titleEl.style.textShadow = `0 0 60px ${ev.color},0 0 120px ${String(ev.color || 'rgba(255,180,40,.95)').replace(/\d*\.?\d+\)$/, '0.22)')}`;
  descEl.textContent = ev.desc || '';
  if (orbEl && ev.color) {
    orbEl.style.background = `radial-gradient(ellipse at 50% 50%,${String(ev.color).replace(/\d*\.?\d+\)$/, '0.05)')} 0%,transparent 65%)`;
  }

  banner.classList.add('show');
  if (pill) {
    pill.textContent = `${String(ev.name || 'EVENT').toUpperCase()} · ${ev.duration || 0}s`;
    pill.classList.add('show');
  }
  if (timerBar) timerBar.classList.add('show');
  if (timerFill) timerFill.style.width = '100%';
  setNowAction('event', '◈ EVENT: ' + String(ev.name || 'EVENT').toUpperCase(), 'now-event');

  stopEventTimer();
  eventTimerStart = Date.now();
  eventTimerDuration = Math.max(100, (ev.duration || 0) * 1000);
  const tick = () => {
    const frac = Math.max(0, 1 - ((Date.now() - eventTimerStart) / eventTimerDuration));
    if (timerFill) timerFill.style.width = `${(frac * 100).toFixed(1)}%`;
    if (timerBar) timerBar.dataset.urgent = frac < 0.2 ? '1' : '0';
    if (frac > 0) eventTimerRaf = requestAnimationFrame(tick);
    else eventTimerRaf = null;
  };
  eventTimerRaf = requestAnimationFrame(tick);
}

export function hideEventBanner() {
  el('event-banner')?.classList.remove('show');
  el('event-pill')?.classList.remove('show');
  el('event-timer-bar')?.classList.remove('show');
  if (el('event-timer-fill')) el('event-timer-fill').style.width = '0%';
  if (el('event-timer-bar')) el('event-timer-bar').dataset.urgent = '0';
  stopEventTimer();
  clearNowAction('event');
}

window._setNowAction = setNowAction;
window._clearNowAction = clearNowAction;
window._clearAllNowAction = clearAllNowAction;
window._msgStack = msgStack;
window.showSyncOverlay = showSyncOverlay;
window.hideSyncOverlay = hideSyncOverlay;
window.updateSyncBar = updateSyncBar;
window._showMissedSync = showMissedSync;
window.showMissedSync = showMissedSync;
window.showTrainScorePopup = showTrainScorePopup;
window.showEventBanner = showEventBanner;
window.hideEventBanner = hideEventBanner;
window.logTL = logTL;
