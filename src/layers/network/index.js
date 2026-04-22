/**
 * layers/network — Layer 1 public API.
 *
 * The Layer 1 monolith is now split into:
 *   - _state.js
 *   - _nodeLifecycle.js
 *   - _linkTopology.js
 *   - _signalSim.js
 *   - _render.js
 *   - layer1.js (compat + public re-exports)
 */
export * from './layer1.js';
