/**
 * SYNAPSE v98 — Sprint 3: Research & Projects System
 *
 * Implements the in-run Tech Tree powered by the "Data" (◬) currency.
 *
 * Architecture:
 *   - ResearchSystem is instantiated once per run and attached to window.gameResearch
 *   - tickResearch(beatCount) is called by heartbeat.js after every beat
 *   - Memory nodes feed addData() through the heartbeat refinement step
 *   - Projects have a "durationBeats" cooldown; research completes after N beats
 *   - Effects mutate TUNING / G flags / DOM — exactly like techTree.js does
 *
 * Integration points:
 *   heartbeat.js   → call tickResearch(beatCount) at end of _fireBeat()
 *                  → call addDataFromMemory(amount) in _tickRefinement()
 *   runController.js → call initResearchSystem() on launchRun / continueRun
 *   index.html     → data-stat span + #active-projects-hud panel (see sprint3.css)
 *   hud.js         → updateResearchHUD() for the ◬ counter
 *
 * Design notes:
 *   - "Data" is the Sprint 3 exclusive currency.  It is SEPARATE from
 *     G.eco.knowledge (Sprint 1/2 resource chain) to avoid breaking existing
 *     balance while layering the new economy on top.
 *   - The existing techTree.js and economy.js are NOT modified — this module
 *     is purely additive.
 *   - All effects are idempotent: calling effect() twice is safe.
 */

import { G }         from '../state/gameState.js';
import { TUNING }    from '../state/tuning.js';
import { showToast } from '../ui/hud/index.js';
import { getLang }   from '../state/settings.js';
import { unlockDaemons } from './awakening.js';
import { spawnShock }    from '../layers/network/index.js';
import { unlockTech }    from './techUnlocks.js';

// ── Tech Tree Definition ────────────────────────────────────────────────────

export const RESEARCH_PROJECTS = {
  // Tier 0 — always available from the start
  bandwidth_compression: {
    id:    'bandwidth_compression',
    tier:  0,
    name:  { de: 'Bandbreiten-Kompression',     en: 'Bandwidth Compression' },
    desc:  { de: 'Stabile Links transportieren +2 Energie pro Tick.',
             en: 'Stable links carry +2 energy per tick.' },
    cost:  15,
    durationBeats: 5,
    req:   [],
    effect() {
      if (TUNING.linkCapacity) {
        TUNING.linkCapacity.stable = (TUNING.linkCapacity.stable || 4) + 2;
      }
    },
  },

  memory_resonance: {
    id:    'memory_resonance',
    tier:  0,
    name:  { de: 'Speicher-Resonanz',            en: 'Memory Resonance' },
    desc:  { de: 'Memory-Nodes generieren 2× mehr Daten pro Beat.',
             en: 'Memory nodes generate 2× more Data per beat.' },
    cost:  20,
    durationBeats: 6,
    req:   [],
    effect() {
      G._research_memDataMult = 2;
    },
  },

  // Tier 1 — requires at least one Tier 0 project completed
  amplifier_protocol: {
    id:    'amplifier_protocol',
    tier:  1,
    name:  { de: 'Verstärker-Protokoll',         en: 'Amplifier Protocol' },
    desc:  { de: 'Schaltet Amplifier-Nodes frei.',
             en: 'Unlocks Amplifier nodes.' },
    cost:  30,
    durationBeats: 8,
    req:   ['bandwidth_compression'],
    effect() {
      G._research_amplifierUnlocked = true;
      const btn = document.getElementById('bn-amp');
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('tbtn-disabled', 'tbtn-research-locked');
        btn.style.pointerEvents = '';
        btn.style.opacity = '';
        btn.classList.add('tbtn-research-unlocked');
        setTimeout(() => btn.classList.remove('tbtn-research-unlocked'), 1200);
      }
    },
  },

  deep_sleep: {
    id:    'deep_sleep',
    tier:  1,
    name:  { de: 'Deep Sleep Mode',              en: 'Deep Sleep Mode' },
    desc:  { de: 'Memory-Upkeep -1 pro Tick (min 1).',
             en: 'Memory upkeep -1 per tick (min 1).' },
    cost:  35,
    durationBeats: 8,
    req:   ['memory_resonance'],
    effect() {
      if (TUNING.nodeUpkeepTable) {
        TUNING.nodeUpkeepTable.memory = Math.max(1, (TUNING.nodeUpkeepTable.memory || 2) - 1);
      }
    },
  },

  parallel_routing: {
    id:    'parallel_routing',
    tier:  1,
    name:  { de: 'Paralleles Routing',           en: 'Parallel Routing' },
    desc:  { de: 'Fast-Links: +3 Kapazität. Resonanz-Links: +2.',
             en: 'Fast links +3 capacity. Resonance links +2.' },
    cost:  40,
    durationBeats: 9,
    req:   ['bandwidth_compression'],
    effect() {
      if (TUNING.linkCapacity) {
        TUNING.linkCapacity.fast      = (TUNING.linkCapacity.fast      || 7) + 3;
        TUNING.linkCapacity.resonance = (TUNING.linkCapacity.resonance || 5) + 2;
      }
    },
  },

  // Tier 2 — requires two Tier 1 projects completed
  daemon_protocol: {
    id:    'daemon_protocol',
    tier:  2,
    name:  { de: 'Sub-Routinen (Daemons)',        en: 'Sub-Routines (Daemons)' },
    desc:  { de: 'Schaltet Automatisierungs-Daemons für Sektoren frei.',
             en: 'Unlocks automation Daemons for sectors.' },
    cost:  80,
    durationBeats: 15,
    req:   ['amplifier_protocol'],
    effect() {
      unlockDaemons();
      G._research_daemonsUnlocked = true;
    },
  },

  firewall_protocol: {
    id:    'firewall_protocol',
    tier:  2,
    name:  { de: 'Firewall-Nodes',                en: 'Firewall Nodes' },
    desc:  { de: 'Schütze Sektoren vor Boss-Korruption.',
             en: 'Protect sectors from boss corruption.' },
    cost:  60,
    durationBeats: 10,
    req:   ['parallel_routing'],
    effect() {
      unlockTech('firewallNodes');
    },
  },

  cortex_amplification: {
    id:    'cortex_amplification',
    tier:  2,
    name:  { de: 'Cortex-Amplifikation',          en: 'Cortex Amplification' },
    desc:  { de: 'Cortex-Aura-Radius +2. Cortex-Zellen feuern doppelt schnell.',
             en: 'Cortex aura radius +2. Cortex cells fire twice as fast.' },
    cost:  100,
    durationBeats: 18,
    req:   ['amplifier_protocol', 'memory_resonance'],
    effect() {
      if (TUNING.cortexAuraRadius !== undefined) TUNING.cortexAuraRadius += 2;
      G._research_cortexAmped = true;
    },
  },
};

// ── Research State ─────────────────────────────────────────────────────────

/**
 * initResearchSystem() — call at the start of every run (launchRun / continueRun).
 * Resets transient state but respects G._research_* flags that may have been
 * restored from a save file.
 *
 * FIX: If G.research is already populated (continueRun restored it via
 * applyRestoredState), we MUST NOT overwrite it. The previous behaviour
 * wiped completed research and active progress on every continue.
 */
export function initResearchSystem() {
  // If a save was just restored, G.research is already the correct state —
  // just re-apply completed-project effects and refresh the UI.
  if (G.research && (G.research.completed?.size > 0 || G.research.activeId || G.research.data > 0)) {
    // Ensure completed is a Set (save/load may have serialised it as an array)
    if (Array.isArray(G.research.completed)) {
      G.research.completed = new Set(G.research.completed);
    }
    // Re-apply effects so TUNING values and flags are correct after Continue
    for (const id of G.research.completed || []) {
      const proj = RESEARCH_PROJECTS[id];
      if (proj?.effect) {
        try { proj.effect(); } catch (_) {}
      }
    }
    _updateHUD();
    renderResearchPanel();
    return;
  }

  G.research = {
    data:           0,          // ◬ Data currency
    completed:      new Set(),  // IDs of completed projects
    activeId:       null,       // ID of project being researched
    activeBeats:    0,          // beats elapsed on active project
  };

  // Apply idempotent effects for any already-completed projects (save restore)
  // This ensures TUNING values are correct even after a page refresh + load.
  // (effects are a no-op if already applied — all use Math.max / flag checks)

  _updateHUD();
  renderResearchPanel();
}

/** Called every beat from heartbeat.js */
export function tickResearch(beatCount) {
  if (!G.research) return;
  const rs = G.research;

  if (!rs.activeId) {
    _updateHUD();
    renderResearchPanel();
    return;
  }

  rs.activeBeats++;
  const proj = RESEARCH_PROJECTS[rs.activeId];

  // Update progress bar
  const bar = document.querySelector(`[data-research-id="${rs.activeId}"] .ri-progress-fill`);
  if (bar) {
    bar.style.width = Math.min(100, (rs.activeBeats / proj.durationBeats) * 100) + '%';
  }

  if (rs.activeBeats >= proj.durationBeats) {
    _completeResearch(rs.activeId);
  }

  _updateHUD();
}

/** Called from heartbeat.js refinement step for each active Memory node */
export function addDataFromMemory(baseAmount = 1) {
  if (!G.research) return;
  const mult = G._research_memDataMult || 1;
  G.research.data += baseAmount * mult;
  _updateHUD();
}

/** Called from button onclick in the panel */
export function startResearch(id) {
  if (!G.research) return;
  const proj = RESEARCH_PROJECTS[id];
  if (!proj)                              return;
  if (G.research.completed.has(id))      return;
  if (G.research.activeId)               return;
  if (G.research.data < proj.cost)       return;
  if (!_prereqsMet(proj))                return;

  G.research.data -= proj.cost;
  G.research.activeId   = id;
  G.research.activeBeats = 0;

  _updateHUD();
  renderResearchPanel();

  const lang = getLang();
  showToast(
    lang === 'de' ? `◬ FORSCHUNG GESTARTET` : `◬ RESEARCH STARTED`,
    lang === 'de' ? proj.name.de : proj.name.en,
    1600
  );
}

/** Cancel active research — refunds 80% of cost */
export function cancelResearch() {
  if (!G.research?.activeId) return;
  const proj = RESEARCH_PROJECTS[G.research.activeId];
  if (proj) G.research.data += Math.floor(proj.cost * 0.8);
  G.research.activeId    = null;
  G.research.activeBeats = 0;
  _updateHUD();
  renderResearchPanel();
}

// ── Internal ────────────────────────────────────────────────────────────────

function _prereqsMet(proj) {
  if (!G.research) return false;
  return proj.req.every(reqId => G.research.completed.has(reqId));
}

function _visibleProjects() {
  if (!G.research) return [];
  return Object.values(RESEARCH_PROJECTS).filter(p => {
    if (G.research.completed.has(p.id)) return true;
    if (G.research.activeId === p.id)   return true;
    return _prereqsMet(p);
  });
}

function _completeResearch(id) {
  const rs   = G.research;
  const proj = RESEARCH_PROJECTS[id];
  if (!proj) return;

  rs.completed.add(id);
  rs.activeId    = null;
  rs.activeBeats = 0;

  // v98: advance onboarding on first research completion
  if (rs.completed.size === 1) {
    try { import('../meta/onboarding.js').then(ob => ob.onboarding.onResearch()); } catch(_) {}
  }

  try { proj.effect(); } catch(e) { console.warn('[Research] effect error:', e); }

  const lang = getLang();
  showToast(
    lang === 'de' ? `✦ FORSCHUNG ABGESCHLOSSEN` : `✦ RESEARCH COMPLETE`,
    lang === 'de' ? proj.name.de : proj.name.en,
    3000
  );
  try { spawnShock(0, 0, 0xaa44ff, 1.2); } catch(_) {}

  renderResearchPanel();
  _updateHUD();
}

function _updateHUD() {
  const el = document.getElementById('vData');
  if (el && G.research) el.textContent = Math.floor(G.research.data);
}

// ── Panel Renderer ─────────────────────────────────────────────────────────

export function renderResearchPanel() {
  const container = document.getElementById('ap-hud-rows');
  if (!container || !G.research) return;

  const rs       = G.research;
  const visible  = _visibleProjects();
  const lang     = getLang();

  if (!visible.length) {
    container.innerHTML = `
      <div style="padding:14px;text-align:center;color:rgba(255,255,255,0.25);font-size:10px;font-family:'Share Tech Mono',monospace;">
        ${lang === 'de' ? 'Baue Memory-Nodes, um Daten zu generieren.' : 'Build Memory nodes to generate Data.'}
      </div>`;
    return;
  }

  const html = visible.map(proj => {
    const isCompleted  = rs.completed.has(proj.id);
    const isResearching = rs.activeId === proj.id;
    const canAfford    = rs.data >= proj.cost && !rs.activeId && !isCompleted;
    const nameStr      = lang === 'de' ? proj.name.de : proj.name.en;
    const descStr      = lang === 'de' ? proj.desc.de : proj.desc.en;
    const tierDots     = '◈'.repeat(proj.tier + 1);

    if (isCompleted) {
      return `
        <div class="research-item completed" data-research-id="${proj.id}">
          <div class="ri-title"><span>${nameStr}</span><span style="color:#50ffa0;font-size:10px;">✓</span></div>
          <div class="ri-desc">${descStr}</div>
        </div>`;
    }

    if (isResearching) {
      const pct = Math.min(100, (rs.activeBeats / proj.durationBeats) * 100);
      return `
        <div class="research-item researching" data-research-id="${proj.id}">
          <div class="ri-title"><span>${nameStr}</span><span class="ri-tier">${tierDots}</span></div>
          <div class="ri-desc">${descStr}</div>
          <div class="ri-progress-bg" style="display:block;">
            <div class="ri-progress-fill" style="width:${pct}%"></div>
          </div>
          <div style="text-align:right;font-size:9px;color:rgba(180,100,255,0.6);margin-top:3px;">
            ${rs.activeBeats}/${proj.durationBeats} beats
          </div>
          <button class="ri-btn ri-btn-cancel" onclick="window.gameResearch?.cancelResearch()">
            ${lang === 'de' ? '✕ Abbrechen (80% Rückerstattung)' : '✕ Cancel (80% refund)'}
          </button>
        </div>`;
    }

    return `
      <div class="research-item available" data-research-id="${proj.id}">
        <div class="ri-title">
          <span>${nameStr}</span>
          <span class="ri-cost">◬ ${proj.cost}</span>
        </div>
        <div class="ri-desc">${descStr}</div>
        <div style="display:flex;gap:6px;align-items:center;margin-top:2px;">
          <span class="ri-tier">${tierDots}</span>
          <span style="font-size:9px;color:rgba(255,255,255,0.2);">${proj.durationBeats} beats</span>
        </div>
        <button class="ri-btn" ${canAfford ? '' : 'disabled'}
          onclick="window.gameResearch?.startResearch('${proj.id}')">
          ${lang === 'de' ? 'Forschen' : 'Research'}
        </button>
      </div>`;
  }).join('');

  container.innerHTML = html;
}

// ── Research AP calculation (called at run end) ────────────────────────────
//
// Returns the AP bonus earned from completed research this run.
// 1 AP per completed project, +5 bonus if ≥4 projects completed.
// Exported directly so meta/screens.js can import without relying on
// the window._s4ComputeResearchAP bridge (BUG-1 fix).

export function computeResearchAP() {
  try {
    if (!G.research) return 0;
    const completed = G.research.completed instanceof Set
      ? G.research.completed.size
      : Array.isArray(G.research.completed)
        ? G.research.completed.length
        : 0;
    if (completed <= 0) return 0;
    return completed + (completed >= 4 ? 5 : 0);
  } catch (_) {
    return 0;
  }
}

// ── Window bridge (inline onclick compatibility) ───────────────────────────
// Exposed as window.gameResearch so panel buttons work without import.

if (typeof window !== 'undefined') {
  window.gameResearch = {
    startResearch,
    cancelResearch,
    get data() { return G.research?.data ?? 0; },
  };
}
