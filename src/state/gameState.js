/**
 * SYNAPSE v98 — Game State (Awakening Update patch)
 *
 * G is the single mutable game state object for one run.
 * It is reset by createFreshState() at the start of each run —
 * never mutate the exported G directly from UI code; go through
 * the appropriate system module.
 *
 * NOTE: Sets, used for tris, spineNodes, fusedPairs, are NOT
 * JSON-serialisable. saveSystem.js converts them to arrays on export
 * and back on import.
 */

import { TUNING } from './tuning.js';
import {
  L1_OBJECTIVE_DEFS,
  L2_OBJECTIVE_DEFS,
  L3_OBJECTIVE_DEFS,
  instantiateObjectives,
} from '../data/objectives.js';

// ── State factory ──────────────────────────────────────────────────────────

function createFreshState() {
  return {
    // ── Interaction mode ─────────────────────────────────────
    mode:      'place',
    selected:  null,

    // ── Resources ────────────────────────────────────────────
    energy:    0,

    // ── Layer flags ──────────────────────────────────────────
    autoOn:    false,
    l2On:      false,
    l3On:      false,
    lastAuto:  -99,

    // ── Node/link type selection ──────────────────────────────
    nType:     'source',
    lType:     'stable',
    typesOn:   false,

    // ── Pulse ────────────────────────────────────────────────
    pulseMs:   0,
    pulseCd:   TUNING.pulseCd,
    pulseCost: TUNING.pulseCost,
    pulseCount: 0,

    // ── Train ────────────────────────────────────────────────
    trainMs:   0,
    trainCd:   10000,
    trainCost: 8,

    // ── Topology ─────────────────────────────────────────────
    tris:          new Set(),
    triLastTick:   0,
    srcLastTick:   0,
    l2BridgeTick:  0,
    l2BridgesActivated: false,

    // ── Memory ───────────────────────────────────────────────
    memMaxOutput:  0,

    // ── Run tracking ─────────────────────────────────────────
    runWon:    false,
    runStart:  Date.now(),
    peakEnergy: 0,

    // ── Layer 1 objectives (defs in src/data/objectives.js) ──
    objectives: instantiateObjectives(L1_OBJECTIVE_DEFS),
    objIdx: 0,

    // ── Layer 2 objectives (visible between L2-active and L3-active) ─────────
    l2Objectives: instantiateObjectives(L2_OBJECTIVE_DEFS),
    l2ObjBridgeEnergyAccum: 0,   // tracks bridge energy accumulated for l2 objective
    l2ObjBridgeSustainMs:   0,   // tracks ms with >=2 bridges active

    // ── Layer 3 ──────────────────────────────────────────────
    l3Clusters:          [],
    l3SyncTick:          0,
    l3SyncWindowDur:     TUNING.syncWindowDuration,
    l3CapturedClusters:  0,
    l3ConnectedCores:    0,
    l3MacroPulseCount:   0,
    l3BonusActive:       false,
    l3Phase:             'idle',
    activeProjects:      [],
    projectSlotsUsed:    0,

    // ── Spine & Backbone ─────────────────────────────────────
    spineLength:       0,
    spineBonusActive:  false,
    backboneActive:    false,
    spineNodes:        new Set(),

    // ── Fusion ───────────────────────────────────────────────
    fusedPairs:  new Set(),   // "minId-maxId" strings
    fusedBonus:  0,

    // ── Win tier ─────────────────────────────────────────────
    winTier: 1,

    // ── Pause ────────────────────────────────────────────────
    paused: false,

    // ── Layer 3 objectives (defs in src/data/objectives.js) ──
    l3Objectives: instantiateObjectives(L3_OBJECTIVE_DEFS),
  };
}

// ── Live game state singleton ──────────────────────────────────────────────
export const G = createFreshState();

/**
 * Reset G to a fresh state in-place (mutates the exported object).
 * Call at the start of a new run instead of reassigning the reference,
 * so all imported { G } references stay valid.
 */
export function resetG() {
  const fresh = createFreshState();
  Object.keys(fresh).forEach(k => { G[k] = fresh[k]; });
  // v96: Reset strategic economy state (re-initialised by initEconomyState on first tickEconomy)
  G.eco         = null;
  G.tech        = null;
  G.crisis      = null;
  G.megaProject = null;
  G.diagnosticLens = 'none';
  G._knowledgePending = false;
  // v98: Awakening system state (re-initialised by initAwakeningOnRunStart)
  G.awakening       = null;
  G._epochIndex     = 0;
  // v98: Research system state (re-initialised by initResearchSystem on run start).
  // ISSUE-4 fix: must be explicitly nulled — createFreshState() doesn't include it,
  // so a previous run's G.research.completed Set would persist and fire Epoch III
  // advancement check instantly on the next run.
  G.research        = null;
  // v98: Genetic ruins spawned at run start via epochReveal.spawnGeneticRuin().
  // RC-6 fix: must be nulled so ruins from a previous run can't bleed into the next.
  G.geneticRuins    = null;
}

// ── Backwards-compat global ────────────────────────────────────────────────
window.G = G;
