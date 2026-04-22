/**
 * SYNAPSE — Central State Singleton (Foundation)
 *
 * Goal: replace ~199 `window.*` assignments with explicit ES imports.
 * Strategy: re-export existing modules through one canonical entry, so
 * new code reads `import { gameState, settings, sfx } from '@/state/store.js'`
 * instead of `window.G`, `window._synSettings`, `window.SFX`, etc.
 *
 * Existing legacy globals stay in place for backward-compat; new code
 * MUST consume them through this store.
 */

import { G } from './gameState.js';
import { synSettings, saveSettings, getLang, getDifficulty } from './settings.js';
import { metaState } from './metaState.js';
import { gameplayFlags } from './gameplayFlags.js';
import { actionState, getActionStateSnapshot } from './actionState.js';
import { aiState } from './aiShared.js';
import { SFX } from '../audio/sfx.js';

export const store = Object.freeze({
  game:    G,
  meta:    metaState,
  ai:      aiState,
  flags:   gameplayFlags,
  action:  actionState,
  settings: synSettings,
  sfx:     SFX,

  // Helpers
  saveSettings,
  getLang,
  getDifficulty,
  getActionStateSnapshot,
});

// Convenience named re-exports
export { G as gameState, synSettings as settings, SFX as sfx, metaState, aiState, gameplayFlags };
