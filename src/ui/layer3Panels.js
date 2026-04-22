/**
 * SYNAPSE v95 — Layer 3 HUD / panel helpers
 * Phase I migration pass.
 *
 * Owns the remaining L3-specific DOM overlays that previously lived inside
 * layer3.js: strategic project selection, active project HUD and cluster
 * tooltip interactions.
 */

import { regListener } from '../registries/listenerRegistry.js';
import { regTimer, clearTimer } from '../registries/timerRegistry.js';
import { getLang } from '../state/settings.js';

let tooltipBooted = false;
let activeTooltipSlot = null;

let projectDelegationBooted = false;
let projectPanelState = null;

function getProjectPanel() {
  return document.getElementById('project-panel');
}

function getProjectSlotsLabel(lang = 'de', used = 0, maxSlots = 2) {
  return lang === 'de'
    ? `◈ ${used}/${maxSlots} Slots belegt`
    : `◈ ${used}/${maxSlots} slots used`;
}

function ensureTooltipDelegation() {
  if (tooltipBooted) return;
  tooltipBooted = true;

  const tooltip = () => document.getElementById('cl-tooltip');

  function hideTooltip(delay = 80) {
    clearTimer('l3TooltipHide');
    regTimer('l3TooltipHide', setTimeout(() => {
      tooltip()?.classList.remove('vis');
      activeTooltipSlot = null;
      clearTimer('l3TooltipHide');
    }, delay), 'timeout');
  }

  function showClusterTooltip(slotEl, cfg) {
    clearTimer('l3TooltipHide');
    const tip = tooltip();
    if (!tip || !slotEl || !cfg?.getCluster) return;

    const idx = Number.parseInt(String(slotEl.id || '').replace('cl-', ''), 10);
    if (!Number.isFinite(idx)) return;
    activeTooltipSlot = idx;

    const cl = cfg.getCluster(idx);
    if (!cl) return;

    let stateLabel = '—';
    if (cl._dormant) stateLabel = 'DORMANT';
    else if (cl._eliteType === 'phantom_nexus' && cl._eliteActive && cl.syncWindowOpen) stateLabel = '◈ PHANTOM — TRAIN FIRST!';
    else if (cl.syncWindowOpen) stateLabel = '⚡ SYNC OPEN';
    else if (cl._eliteType === 'temporal_anchor' && cl._eliteActive && !cl.captured) {
      const temporalState = cfg.getTemporalState?.();
      const elapsed = temporalState ? ((Date.now() - temporalState.startTime) / 1000) : 0;
      stateLabel = temporalState
        ? (elapsed >= 8 ? '⧗ TEMPORAL — KERN-FENSTER!' : '⧗ TEMPORAL — WARTE...')
        : '⧗ TEMPORAL ANCHOR';
    } else if (cl._eliteType === 'phantom_nexus' && !cl.captured) stateLabel = '◈ PHANTOM — WAITING';
    else if (cl.syncReady) stateLabel = 'READY';
    else if (cl.captured) stateLabel = '✓ CAPTURED';
    else stateLabel = 'LOCKED';

    const lang = getLang();
    const labels = lang === 'de'
      ? { state: 'Status', health: 'Health', sync: 'Letzter Sync' }
      : { state: 'State', health: 'Health', sync: 'Last Sync' };

    const hpStr = cl.health !== undefined && cl.maxHealth !== undefined
      ? `${cl.health} / ${cl.maxHealth}`
      : null;

    let syncStr = '—';
    if (cl.lastSyncTime) {
      const e = Math.round((Date.now() - cl.lastSyncTime) / 1000);
      syncStr = e < 60 ? `${e}s ago` : `${Math.round(e / 60)}m ago`;
    }

    tip.innerHTML = '<div class="clt-title">C' + (idx + 1) + ' · CLUSTER</div>'
      + '<div class="clt-row"><span class="clt-key">' + labels.state + '</span><span class="clt-val">' + stateLabel + '</span></div>'
      + (hpStr ? '<div class="clt-row"><span class="clt-key">' + labels.health + '</span><span class="clt-val">' + hpStr + '</span></div>' : '')
      + '<div class="clt-row"><span class="clt-key">' + labels.sync + '</span><span class="clt-val">' + syncStr + '</span></div>';

    const rect = slotEl.getBoundingClientRect();
    const ttW = 160;
    let left = rect.left - ttW - 8;
    if (left < 4) left = rect.right + 8;
    const top = Math.max(8, Math.min(rect.top + rect.height / 2 - 36, window.innerHeight - 100));

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.classList.add('vis');
  }

  regListener(document, 'mouseover', event => {
    const panel = document.getElementById('l3-hud');
    const slot = event.target instanceof Element ? event.target.closest('.cl-slot') : null;
    if (!panel || !slot || !panel.contains(slot) || !window.__l3TooltipCfg) return;
    if (slot.id === `cl-${activeTooltipSlot}`) return;
    showClusterTooltip(slot, window.__l3TooltipCfg);
  });

  regListener(document, 'mouseout', event => {
    const fromSlot = event.target instanceof Element ? event.target.closest('.cl-slot') : null;
    if (!fromSlot) return;
    const toSlot = event.relatedTarget instanceof Element ? event.relatedTarget.closest('.cl-slot') : null;
    if (toSlot === fromSlot) return;
    hideTooltip(80);
  });

  regListener(document, 'touchstart', event => {
    const target = event.target instanceof Element ? event.target.closest('.cl-slot') : null;
    if (!target || !window.__l3TooltipCfg) {
      hideTooltip(0);
      return;
    }
    showClusterTooltip(target, window.__l3TooltipCfg);
  }, { passive: true });

  regListener(document, 'touchend', () => {
    if (activeTooltipSlot !== null) hideTooltip(1800);
  }, { passive: true });
}

export function initL3ClusterTooltipsUI(config) {
  window.__l3TooltipCfg = config || null;
  ensureTooltipDelegation();
}

function ensureProjectDelegation() {
  if (projectDelegationBooted) return;
  projectDelegationBooted = true;

  regListener(document, 'click', event => {
    const panel = getProjectPanel();
    if (!panel || !projectPanelState) return;

    const skipBtn = event.target instanceof Element ? event.target.closest('[data-project-skip]') : null;
    if (skipBtn && panel.contains(skipBtn)) {
      closeProjectSelectionPanelUI();
      return;
    }

    const card = event.target instanceof Element ? event.target.closest('[data-project-card]') : null;
    if (!card || !panel.contains(card)) return;

    if (projectPanelState.getSlotsUsed() >= projectPanelState.maxSlots) return;

    const projectId = card.getAttribute('data-project-card');
    if (!projectId) return;

    projectPanelState.onSelect?.(projectId);
    card.style.opacity = '.45';
    card.style.pointerEvents = 'none';
    updateProjectPanelSlotsUI(projectPanelState.lang, projectPanelState.getSlotsUsed(), projectPanelState.maxSlots);

    if (projectPanelState.getSlotsUsed() >= projectPanelState.maxSlots) {
      closeProjectSelectionPanelUI();
    }
  });
}

function updateProjectPanelSlotsUI(lang, used, maxSlots) {
  const label = document.getElementById('proj-slots-used');
  if (label) label.textContent = getProjectSlotsLabel(lang, used, maxSlots);
}

export function showProjectSelectionPanelUI({
  pool = [],
  lang = 'de',
  maxSlots = 2,
  getSlotsUsed = () => 0,
  onSelect = null,
  onClose = null,
} = {}) {
  ensureProjectDelegation();
  closeProjectSelectionPanelUI({ silent: true });

  const panel = document.createElement('div');
  panel.id = 'project-panel';
  panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:25;background:rgba(1,3,10,.96);border:1px solid rgba(80,140,255,.22);border-left:2px solid rgba(80,140,255,.5);padding:18px 20px 14px;min-width:280px;max-width:340px;font-family:\'Share Tech Mono\',\'Courier New\',monospace;backdrop-filter:blur(20px);';

  const title = lang === 'de' ? 'STRATEGISCHE PROJEKTE' : 'STRATEGIC PROJECTS';
  const sub = lang === 'de' ? '2 Slots verfügbar · Investiere jetzt, ernte später' : '2 slots available · Invest now, harvest later';
  const skip = lang === 'de' ? '▸ Überspringen' : '▸ Skip';

  panel.innerHTML = `<div style="font-size:.42rem;letter-spacing:5px;color:rgba(80,160,255,.6);text-transform:uppercase;margin-bottom:3px">${title}</div>
    <div style="font-size:.35rem;letter-spacing:2px;color:rgba(255,255,255,.28);margin-bottom:12px">${sub}</div>
    <div id="proj-slots-used" style="font-size:.34rem;letter-spacing:2px;color:rgba(120,220,255,.5);margin-bottom:10px">${getProjectSlotsLabel(lang, getSlotsUsed(), maxSlots)}</div>
    <div id="proj-list"></div>
    <div style="margin-top:10px;text-align:right"><button type="button" data-project-skip="1" style="background:transparent;border:none;color:rgba(255,255,255,.28);font-family:'Share Tech Mono',monospace;font-size:.38rem;letter-spacing:2px;cursor:pointer;text-transform:uppercase;padding:4px 8px;">${skip}</button></div>`;

  const list = panel.querySelector('#proj-list');
  pool.forEach(proj => {
    const card = document.createElement('div');
    const nameStr = lang === 'de' ? proj.name : proj.nameEN;
    const descStr = lang === 'de' ? proj.desc : proj.descEN;
    const rewardStr = lang === 'de' ? proj.rewardLabel : proj.rewardLabelEN;
    card.setAttribute('data-project-card', proj.id);
    card.style.cssText = `border:1px solid rgba(255,255,255,.08);border-left:2px solid ${proj.color};padding:9px 10px;margin-bottom:7px;cursor:pointer;transition:background .18s;border-radius:2px;`;
    card.innerHTML = `<div style="font-size:.44rem;letter-spacing:3px;color:${proj.color};text-transform:uppercase;margin-bottom:3px">${nameStr}</div>
      <div style="font-size:.33rem;letter-spacing:1.5px;color:rgba(255,255,255,.38);margin-bottom:5px">${descStr}</div>
      <div style="font-size:.31rem;letter-spacing:2px;color:rgba(255,255,255,.2);text-transform:uppercase"><span style="color:rgba(255,100,80,.7)">${proj.costLabel}</span><span style="margin:0 4px;opacity:.3">→</span><span>${rewardStr}</span></div>`;
    list?.appendChild(card);
  });

  document.body.appendChild(panel);
  projectPanelState = { lang, maxSlots, getSlotsUsed, onSelect, onClose };
  regTimer('projectPanelAutoClose', setTimeout(() => {
    closeProjectSelectionPanelUI();
    clearTimer('projectPanelAutoClose');
  }, 30000), 'timeout');
}

export function closeProjectSelectionPanelUI({ silent = false } = {}) {
  clearTimer('projectPanelAutoClose');

  const panel = getProjectPanel();
  const state = projectPanelState;
  projectPanelState = null;

  if (panel) {
    panel.style.transition = 'opacity .4s';
    panel.style.opacity = '0';
    regTimer('projectPanelRemove', setTimeout(() => panel.remove(), 400), 'timeout');
  }

  if (!silent) state?.onClose?.();
}

function getProjectProgressText(project, lang, context) {
  if (project.triggered) return lang === 'de' ? '✓ aktiv' : '✓ active';
  const trigger = project.trigger || {};

  switch (trigger.type) {
    case 'spineLength':
      return `${context.spineLength || 0}/${trigger.threshold || 0}`;
    case 'capturedClusters':
      return `${context.capturedClusters || 0}/${trigger.threshold || 0}`;
    case 'eliteClear':
      return `${context.eliteClears || 0}/${trigger.threshold || 0}`;
    case 'energy':
      return `${Math.round(context.energy || 0)}/${trigger.threshold || 0}`;
    case 'backboneActive':
      return context.backboneActive ? (lang === 'de' ? 'bereit' : 'ready') : (lang === 'de' ? 'wartet' : 'waiting');
    case 'conditionActive':
      return context.conditionActive ? (lang === 'de' ? 'aktiv' : 'active') : (lang === 'de' ? 'wartet' : 'waiting');
    default:
      return '';
  }
}


export function setClusterPhantomStateUI(clusterIdx, active) {
  document.getElementById(`cl-${clusterIdx}`)?.classList.toggle('phantom', !!active);
}

export function triggerLayer3BonusFlashUI(duration = 1200) {
  const el = document.getElementById('bonus-flash');
  if (!el) return;
  el.classList.add('show');
  regTimer('layer3BonusFlash', setTimeout(() => el.classList.remove('show'), duration), 'timeout');
}

export function updateActiveProjectsHudUI({
  projects = [],
  lang = 'de',
  capturedClusters = 0,
  energy = 0,
  spineLength = 0,
  backboneActive = false,
  conditionActive = false,
  eliteClears = 0,
} = {}) {
  const panel = document.getElementById('active-projects-hud');
  const rows = document.getElementById('ap-hud-rows');
  if (!panel || !rows) return;

  if (!projects.length) {
    panel.classList.remove('vis');
    rows.innerHTML = '';
    return;
  }

  panel.classList.add('vis');
  rows.innerHTML = '';

  const context = { capturedClusters, energy, spineLength, backboneActive, conditionActive, eliteClears };

  projects.forEach(project => {
    const row = document.createElement('div');
    row.className = 'ap-hud-row' + (project.triggered ? ' triggered' : '');
    const name = (lang === 'de' ? project.name : project.nameEN) || project.id;
    const progress = getProjectProgressText(project, lang, context);
    row.innerHTML = '<div class="ap-hud-dot"></div>'
      + '<span class="ap-hud-name">' + name + '</span>'
      + (progress ? '<span class="ap-hud-progress">' + progress + '</span>' : '');
    rows.appendChild(row);
  });
}

window.showProjectSelectionPanelUI = showProjectSelectionPanelUI;
window.closeProjectSelectionPanelUI = closeProjectSelectionPanelUI;
window.updateActiveProjectsHudUI = updateActiveProjectsHudUI;
window.initL3ClusterTooltipsUI = initL3ClusterTooltipsUI;

window.setClusterPhantomStateUI = setClusterPhantomStateUI;
window.triggerLayer3BonusFlashUI = triggerLayer3BonusFlashUI;
