/**
 * Tech-unlock query helpers (improvement #5).
 *
 * Replaces the parallel `G._techUnlocked_*` boolean flags with a single
 * source of truth: the existing `G.tech.unlocked` Set populated by
 * techTree.doResearch(). The legacy flag setters in TECH_NODES.effect()
 * are now no-ops; consumers read through hasTech(id).
 *
 * Tech IDs (canonical, see TECH_NODES in techTree.js):
 *   resonanceLinks · dataCompression · parallelBackbone
 *   memoryAmplification · adaptiveUpkeep · firewallNodes
 *
 * Special case: research.js can grant the firewall unlock as a milestone
 * reward without going through doResearch() — it calls unlockTech() here.
 */

import { G } from '../state/gameState.js';

/** True if the given tech node id has been researched. */
export function hasTech(id) {
  return !!(G.tech && G.tech.unlocked && G.tech.unlocked.has(id));
}

/**
 * Force-grant a tech unlock outside the normal research flow
 * (e.g. crisis-event reward, debug toggle). Initialises G.tech if needed.
 */
export function unlockTech(id) {
  if (!G.tech) G.tech = { unlocked: new Set(), queue: [] };
  if (!G.tech.unlocked) G.tech.unlocked = new Set();
  G.tech.unlocked.add(id);
}
