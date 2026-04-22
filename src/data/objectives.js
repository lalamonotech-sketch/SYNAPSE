/**
 * SYNAPSE v98 — Objective definitions.
 *
 * Pure content data extracted from gameState.js — no runtime/state logic.
 * Lets objectives be edited, localized, and (in the future) hot-swapped
 * independently of the game state factory.
 *
 * createFreshState() in gameState.js maps these defs to runtime objects
 * with `done: false` baked in.
 */

export const L1_OBJECTIVE_DEFS = [
  { id: 'triangle', label: '◎ Bau dein erstes Dreieck',           labelEN: '◎ Build your first triangle' },
  { id: 'memFull',  label: '◉ Entlade einen Memory (+25⬡ Output)', labelEN: '◉ Discharge a Memory (+25⬡ output)' },
  { id: 'bridge1',  label: '⬡ Aktiviere 1 Brücke',                 labelEN: '⬡ Activate 1 bridge' },
  { id: 'bridge3',  label: '⬡⬡⬡ Halte 3 Brücken gleichzeitig',     labelEN: '⬡⬡⬡ Hold 3 bridges simultaneously' },
  { id: 'pulse2',   label: '⚡ Feuere 2 Pulses',                    labelEN: '⚡ Fire 2 pulses' },
];

export const L2_OBJECTIVE_DEFS = [
  { id: 'bridgeEnergy',  label: '⬡ Generiere 50⬡ aus Brücken',               labelEN: '⬡ Generate 50⬡ from bridges' },
  { id: 'bridges4',      label: '⬡×4 Halte 4 Brücken gleichzeitig',           labelEN: '⬡×4 Hold 4 bridges simultaneously' },
  { id: 'bridgeSustain', label: '⏱ Halte 2 Brücken 20 Sekunden gleichzeitig', labelEN: '⏱ Hold 2 bridges for 20 seconds' },
];

export const L3_OBJECTIVE_DEFS = [
  { id: 'capture1',    label: '◎ Übernimm 1 Cluster',                labelEN: '◎ Capture 1 cluster' },
  { id: 'capture4',    label: '◎◎◎◎ Halte 4 Cluster gleichzeitig',   labelEN: '◎◎◎◎ Hold 4 clusters simultaneously' },
  { id: 'syncWindow',  label: '⟳ Triff ein Synchronisationsfenster', labelEN: '⟳ Hit a sync window' },
  { id: 'coreConn2',   label: '⬡⬡ Verbinde 2 Makro-Kerne',           labelEN: '⬡⬡ Connect 2 macro cores' },
  { id: 'coreBonus',   label: '★ Aktiviere den Verbindungsbonus',     labelEN: '★ Activate the connection bonus' },
  { id: 'spine3',      label: '⬟ Bilde einen Spine (3 Kerne)',        labelEN: '⬟ Form a spine (3 cores)' },
  { id: 'fusion1',     label: '⬟⬟ Löse eine Fusion aus',             labelEN: '⬟⬟ Trigger a fusion' },
  { id: 'backbone4',   label: '◈ Backbone: 4+ Kerne verbunden',       labelEN: '◈ Backbone: 4+ cores connected' },
  { id: 'allClusters', label: '⬡×8 Halte alle 8 Cluster',            labelEN: '⬡×8 Hold all 8 clusters' },
];

/** Helper: hydrate a def list into runtime objective objects with `done: false`. */
export function instantiateObjectives(defs) {
  return defs.map(d => ({ ...d, done: false }));
}
