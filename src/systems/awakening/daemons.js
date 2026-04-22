import { G } from '../../state/gameState.js';
import { gameNodes, gameLinks } from '../../layers/network/index.js';
import { showToast } from '../../ui/hud/index.js';
import { getLang } from '../../state/settings.js';
import { getAwakeningDom, setAwakeningDom } from './dom.js';

export const DAEMON_TYPES = {
  repair: {
    id: 'repair',
    label: { de: 'Repair-Daemon', en: 'Repair Daemon' },
    desc: { de: 'Repariert beschädigte Links im Sektor automatisch', en: 'Auto-repairs damaged links in the assigned sector' },
    icon: '🔧',
  },
  builder: {
    id: 'builder',
    label: { de: 'Builder-Daemon', en: 'Builder Daemon' },
    desc: { de: 'Baut eine vordefinierte Struktur sobald Ressourcen verfügbar sind', en: 'Builds a predefined structure when resources are available' },
    icon: '🏗',
  },
  optimizer: {
    id: 'optimizer',
    label: { de: 'Optimizer-Daemon', en: 'Optimizer Daemon' },
    desc: { de: 'Balanciert Traffic automatisch für maximale Bandbreite', en: 'Auto-balances traffic for maximum bandwidth' },
    icon: '⚡',
  },
};

const BUILDER_TICK_RATE = 30;
const BUILDER_ENERGY_GATE = 40;
const BUILDER_RELAY_COST = 12;
const SECTOR_LABELS = ['NW', 'NE', 'SW', 'SE'];
const DAEMON_PANEL_ID = 'v97-daemon-panel';
let daemonPanelEl = null;
let nodeByIdCache = null;
let nodeByIdCacheSize = -1;
let daemonPanelHandlerBound = false;

function getNodeById(id) {
  if (!nodeByIdCache || nodeByIdCacheSize !== gameNodes.length) {
    nodeByIdCache = new Map();
    nodeByIdCacheSize = gameNodes.length;
    for (let i = 0; i < gameNodes.length; i++) {
      const node = gameNodes[i];
      nodeByIdCache.set(node._id, node);
    }
  }
  return nodeByIdCache.get(id) || null;
}

export function unlockDaemons() {
  if (!G.awakening || G.awakening.daemonUnlocked) return;
  G.awakening.daemonUnlocked = true;
  G.awakening.daemonSlots = [];

  const lang = getLang();
  showToast(
    lang === 'de' ? '◈ DAEMONS FREIGESCHALTET' : '◈ DAEMONS UNLOCKED',
    lang === 'de' ? 'Sub-Routinen können jetzt Sektoren zugewiesen werden' : 'Sub-routines can now be assigned to sectors',
    3000
  );
  showDaemonUI();
}

export function assignDaemon(type, sectorId) {
  if (!G.awakening?.daemonUnlocked) return false;
  if (G.awakening.daemonSlots.length >= 3) return false;
  G.awakening.daemonSlots.push({ type, sectorId, assignedAt: Date.now(), ticksRun: 0 });
  return true;
}

export function tickDaemons() {
  if (!G.awakening?.daemonUnlocked) return;
  for (let i = 0; i < G.awakening.daemonSlots.length; i++) {
    const daemon = G.awakening.daemonSlots[i];
    daemon.ticksRun++;
    if (daemon.type === 'repair') tickRepairDaemon(daemon);
    if (daemon.type === 'optimizer') tickOptimizerDaemon(daemon);
    if (daemon.type === 'builder') tickBuilderDaemon(daemon);
  }
}

function tickRepairDaemon(daemon) {
  for (let i = 0; i < gameNodes.length; i++) {
    const node = gameNodes[i];
    if (!node._brownout || !nodeInSector(node, daemon.sectorId)) continue;
    node._brownout = false;
    node._brownoutGrace = 0;
    if (node.m?.material) node.m.material.opacity = 1.0;
  }
}

function tickOptimizerDaemon(daemon) {
  let count = 0;
  let totalLoad = 0;
  for (let i = 0; i < gameLinks.length; i++) {
    const link = gameLinks[i];
    if (!linkInSector(link, daemon.sectorId)) continue;
    count++;
    totalLoad += link._signalLoad || 0;
  }
  if (!count) return;

  const avgLoad = totalLoad / count;
  for (let i = 0; i < gameLinks.length; i++) {
    const link = gameLinks[i];
    if (!linkInSector(link, daemon.sectorId)) continue;
    const current = link._signalLoad || 0;
    link._signalLoad = Math.max(0, current - Math.max(0, current - avgLoad) * 0.2);
  }
}

function tickBuilderDaemon(daemon) {
  if ((daemon.ticksRun % BUILDER_TICK_RATE) !== 0) return;
  if ((G.energy || 0) < BUILDER_ENERGY_GATE) return;

  const sectorNodes = [];
  const linkCounts = new Map();
  for (let i = 0; i < gameNodes.length; i++) {
    const node = gameNodes[i];
    if (node._brownout || !nodeInSector(node, daemon.sectorId)) continue;
    sectorNodes.push(node);
    linkCounts.set(node._id, 0);
  }
  if (!sectorNodes.length) return;

  for (let i = 0; i < gameLinks.length; i++) {
    const link = gameLinks[i];
    if (linkCounts.has(link._src)) linkCounts.set(link._src, linkCounts.get(link._src) + 1);
    if (linkCounts.has(link._tgt)) linkCounts.set(link._tgt, linkCounts.get(link._tgt) + 1);
  }

  let target = null;
  let lowestCount = Infinity;
  for (let i = 0; i < sectorNodes.length; i++) {
    const node = sectorNodes[i];
    const count = linkCounts.get(node._id) || 0;
    if (count < lowestCount) {
      lowestCount = count;
      target = node;
    }
  }
  if (!target || typeof window.placeNodeAt !== 'function') return;

  const px = (target.m?.position.x || 0) + (Math.random() - 0.5) * 1.5;
  const py = (target.m?.position.y || 0) + (Math.random() - 0.5) * 1.5;
  if (!window.placeNodeAt('relay', px, py)) return;

  G.energy -= BUILDER_RELAY_COST;
  daemon._lastBuild = Date.now();
  const lang = getLang();
  showToast(
    lang === 'de' ? '🔧 BUILDER-DAEMON' : '🔧 BUILDER DAEMON',
    lang === 'de' ? `Relay-Node in Sektor ${daemon.sectorId} platziert` : `Relay node placed in sector ${daemon.sectorId}`,
    1800
  );
}

function nodeInSector(node, sectorId) {
  if (sectorId === null || sectorId === undefined) return true;
  const x = node.m?.position.x || 0;
  const y = node.m?.position.y || 0;
  const q = (x >= 0 ? 1 : 0) + (y >= 0 ? 2 : 0);
  return q === sectorId;
}

function linkInSector(link, sectorId) {
  const srcNode = getNodeById(link._src);
  if (!srcNode) return false;
  return nodeInSector(srcNode, sectorId);
}

function buildDaemonPanelHTML() {
  return `
    <div class="daemon-title">◈ DAEMONS</div>
    <div class="daemon-slots">
      ${['repair', 'builder', 'optimizer'].map((type) => `
        <div class="daemon-slot" data-dtype="${type}">
          <span class="daemon-icon">${DAEMON_TYPES[type].icon}</span>
          <span class="daemon-label">${DAEMON_TYPES[type].label.en.split(' ')[0]}</span>
          <div class="daemon-assign-btns">
            ${SECTOR_LABELS.map((quad, sector) => `<button class="daemon-assign-btn" data-dtype="${type}" data-sector="${sector}">${quad}</button>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}

function onDaemonPanelClick(e) {
  const btn = e.target.closest('.daemon-assign-btn');
  if (!btn) return;
  const dtype = btn.dataset.dtype;
  const sector = parseInt(btn.dataset.sector, 10);
  const ok = assignDaemon(dtype, sector);
  const lang = getLang();
  showToast(
    ok
      ? (lang === 'de'
        ? `${DAEMON_TYPES[dtype].label.de} → Sektor ${SECTOR_LABELS[sector]}`
        : `${DAEMON_TYPES[dtype].label.en} → Sector ${SECTOR_LABELS[sector]}`)
      : (lang === 'de' ? '⚠ Max 3 Daemons aktiv' : '⚠ Max 3 daemons active'),
    '',
    1200
  );
}

export function showDaemonUI() {
  let panel = daemonPanelEl;
  if (!panel || !document.body.contains(panel)) {
    panel = getAwakeningDom(DAEMON_PANEL_ID);
    daemonPanelEl = panel || null;
  }
  if (panel) {
    panel.style.display = '';
    return;
  }

  panel = document.createElement('div');
  panel.id = DAEMON_PANEL_ID;
  panel.className = 'v97-daemon-panel';
  panel.innerHTML = buildDaemonPanelHTML();

  const dock = getAwakeningDom('ctrl-dock')
    || getAwakeningDom('active-projects-hud')
    || getAwakeningDom('hud-sidebar')
    || getAwakeningDom('game-hud');
  if (dock) {
    dock.parentNode.insertBefore(panel, dock.nextSibling);
  } else {
    document.body.appendChild(panel);
    console.warn('[Synapse] Daemon panel fallback — no anchor found. Panel appended to body.');
  }

  if (!daemonPanelHandlerBound) {
    panel.addEventListener('click', onDaemonPanelClick);
    daemonPanelHandlerBound = true;
  }

  daemonPanelEl = panel;
  setAwakeningDom(DAEMON_PANEL_ID, panel);
}

export function resetDaemonUiCache() {
  if (daemonPanelEl && daemonPanelHandlerBound) {
    daemonPanelEl.removeEventListener('click', onDaemonPanelClick);
  }
  daemonPanelEl = null;
  daemonPanelHandlerBound = false;
  nodeByIdCache = null;
  nodeByIdCacheSize = -1;
}
