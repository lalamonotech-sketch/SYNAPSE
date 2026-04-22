/**
 * SYNAPSE v98 — Tuning Constants (Awakening Update patch)
 *
 * TUNING is the single source of truth for all balance values.
 * BASE_TUNING is an immutable snapshot taken at module load.
 * resetTuning() restores TUNING to BASE_TUNING before each run —
 * this prevents modifier accumulation across runs (FIX L-04).
 */

export const TUNING = {
  // ── Pulse ──────────────────────────────────────────────────
  pulseCost:              18,
  pulseCd:                8500,

  // ── Memory ─────────────────────────────────────────────────
  memoryMultiplier:       1.65,
  memoryDischargeCd:      7,      // seconds

  // ── Source passive ──────────────────────────────────────────
  sourceSoftcapCount:     4,
  sourceSoftcapFactor:    0.35,   // FIX P2: was 0.22 — too punishing (mid-game energy wall)
  sourceTick:             5,      // seconds

  // ── Triangle ────────────────────────────────────────────────
  resonanceTriangleBonus: 10,
  trianglePassiveTick:    3,      // seconds

  // ── Bridge (L2) ─────────────────────────────────────────────
  bridgeReward:           2,

  // ── Layer 3 passive ─────────────────────────────────────────
  l3PassiveGain:          2,
  l3PassiveTick:          3,      // seconds

  // ── Sync window ─────────────────────────────────────────────
  syncWindowDuration:     5,      // seconds — shorter = more pressure
  syncWindowCooldownMin:  15,
  syncWindowCooldownMax:  26,

  // ── Auto-genesis ────────────────────────────────────────────
  autoGenesisCooldown:    5.5,    // seconds

  // ── v95: Catalyst Node ──────────────────────────────────────────────
  catalystBoostDuration:  1.5,    // seconds of signal boost on receipt
  catalystBoostMult:      2.2,    // signal speed multiplier during boost
  catalystCost:           15,     // energy cost to place

  // ── v95: Phase Link ─────────────────────────────────────────────────
  phaseLinkOnDuration:    2.0,    // seconds active
  phaseLinkOffDuration:   1.0,    // seconds inactive

  // ── v96: Strategic Economy ──────────────────────────────────────────────
  ecoAutoPulseInterval:   5.0,    // seconds between automatic network pulses
  ecoBrownoutGrace:       3,      // ticks before brownout triggers cascade
  ecoUpkeepMult:          1.0,    // global upkeep multiplier (boss events scale this)
  ecoRefinementEnabled:   true,   // enable Raw→Processed→Knowledge chain
  ecoTerrainEnabled:      true,   // enable sector terrain properties
  ecoTacticalPause:       true,   // pause is a strategic tool, not just cosmetic

  // ── v98: Heartbeat (Global Metronome Tick) ───────────────────────────────────
  heartbeatInterval:      2.0,    // seconds between system heartbeats
  emergencyPulseCd:      30.0,    // seconds cooldown for manual emergency pulse
  nodeUpkeepTable: {              // energy cost per node type per heartbeat
    source: 0, relay: 1, amplifier: 2, memory: 2, catalyst: 3,
  },
  linkCapacity: {                 // max energy units through link per beat
    stable: 4, fast: 7, resonance: 5, fragile: 2,
  },
  sourceOutputPerBeat:    8,      // base energy a source emits per heartbeat
  cortexAuraRadius:       4.0,    // Cortex Cell aura distribution radius
  aoeEnergyRadius:        2.5,    // Pulsing Source AoE radius
  brownoutGraceBeats:     3,      // beats before brownout hits underpowered node
  nodeEvolutionThreshold: 400,    // FIX P2: was 1000 — softcapped sources took 17min to evolve

  // ── v98: Awakening Epoch Progression ────────────────────────────────────────
  awakeningEnergyThreshold: 1000, // cumulative energy to trigger Epoch II
  awakeningCheckInterval:   1.0,  // seconds between epoch advancement checks

};

/**
 * Immutable baseline — captured once at startup.
 * resetTuning() copies these values back into TUNING.
 */
export const BASE_TUNING = Object.freeze(
  JSON.parse(JSON.stringify(TUNING))
);

/**
 * Reset TUNING to the baseline snapshot.
 * Call before applyDifficulty() + applyProtocolModifiers() at each run start.
 *
 * M-6 fix: shallow Object.assign was insufficient — nested objects like
 * nodeUpkeepTable and linkCapacity are reference-copied, so research effects
 * (e.g. bandwidth_compression mutating linkCapacity.stable) would persist
 * across runs. JSON round-trip gives a clean deep clone per key.
 */
export function resetTuning() {
  Object.keys(BASE_TUNING).forEach(k => {
    const v = BASE_TUNING[k];
    // Deep-clone objects; primitives assign directly
    TUNING[k] = (v !== null && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  });
}

// ── Backwards-compat globals ───────────────────────────────────────────────
window.TUNING      = TUNING;
window.BASE_TUNING = BASE_TUNING;
window.resetTuning = resetTuning;
