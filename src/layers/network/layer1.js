import * as THREE from 'three';

export { gameNodes, gameLinks, signals, shockwaves, pulseTrails, linkVersion, _SHOCK_GEO, _TRAIL_GEO } from './_state.js';
export {
  makeNode,
  removeNode,
  getNodeRenderStats,
  setNodeRenderMode,
  cycleNodeRenderMode,
  setNodeInstanceThreshold,
  getEarlyGameVisualCalmness,
} from './_nodeLifecycle.js';
export { makeLink, removeLink, updateLinkGeo, checkTris } from './_linkTopology.js';
export { spawnSig, spawnShock, spawnPulseTrail, manualDischargeMemory } from './_signalSim.js';
export { animateLayer1, resetLayer1Runtime } from './_render.js';

import { gameNodes, gameLinks, signals, shockwaves, pulseTrails } from './_state.js';
import {
  makeNode,
  removeNode,
  getNodeRenderStats,
  setNodeRenderMode,
  cycleNodeRenderMode,
  setNodeInstanceThreshold,
} from './_nodeLifecycle.js';
import { makeLink, removeLink, updateLinkGeo, checkTris } from './_linkTopology.js';
import { spawnSig, spawnShock, spawnPulseTrail, manualDischargeMemory } from './_signalSim.js';
import { resetLayer1Runtime } from './_render.js';
import { NT, LT } from './_constants.js';

window.gameNodes = gameNodes;
window.gameLinks = gameLinks;
window.signals = signals;
window.shockwaves = shockwaves;
window._pulseTrails = pulseTrails;
window.NT = NT;
window.LT = LT;

window._makeNode = makeNode;
window._makeLink = makeLink;
window._spawnSig = spawnSig;
window.spawnShock = spawnShock;
window._spawnShock = spawnShock;
window.spawnPulseTrail = spawnPulseTrail;
window._spawnPulseTrail = spawnPulseTrail;
window.manualDischargeMemory = manualDischargeMemory;
window.checkTris = checkTris;
window._checkTris = checkTris;
window._removeNode = removeNode;
window._removeLink = removeLink;
window.updateLinkGeo = updateLinkGeo;
window._resetLayer1Runtime = resetLayer1Runtime;
window._getNodeRenderStats = getNodeRenderStats;
window._setNodeRenderMode = setNodeRenderMode;
window._cycleNodeRenderMode = cycleNodeRenderMode;
window._setNodeInstanceThreshold = setNodeInstanceThreshold;

window.placeNodeAt = function placeNodeAt(type, wx, wy) {
  try {
    const pos = new THREE.Vector3(wx, wy, 0);
    const node = makeNode(pos, false, type);
    return node || null;
  } catch (e) {
    console.warn('[Synapse] placeNodeAt failed:', e);
    return null;
  }
};
