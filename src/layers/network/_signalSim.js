import * as THREE from 'three';
import { microGroup, fxGroup, GS2, camera } from '../../engine/scene.js';
import { G } from '../../state/gameState.js';
import { TUNING } from '../../state/tuning.js';
import { upgradeState, traitState } from '../../state/actionState.js';
import { PROFILE_BONUS } from '../../systems/ai.js';
import { aiState } from '../../state/aiShared.js';
import { getLang } from '../../state/settings.js';
import { showToast } from '../../ui/hud/index.js';
import { signalEnergyChanged } from '../../platform/stateSignals.js';
import { getFxQualityStats, shouldSpawnShock, shouldSpawnPulseTrail } from '../../platform/fxQuality.js';
import { LT, SIG_TYPE_KEYS as _SIG_TYPE_KEYS, SIGNAL_BASE_OPACITY as _SIGNAL_BASE_OPACITY, SIGNAL_SOFT_OPACITY as _SIGNAL_SOFT_OPACITY } from './_constants.js';
import { gameNodes, gameLinks, signals, shockwaves, pulseTrails, _shockPool, _trailPool, _SHOCK_GEO, _TRAIL_GEO, _resonanceDegree, _getSourceNodeCount } from './_state.js';
import { _collapseLink, _linkInTri, _markLinkActive } from './_linkTopology.js';
import { getTerrainPassiveBonus } from '../../systems/economy.js';
import { getEarlyGameVisualCalmness } from './_nodeLifecycle.js';


function _lerp(a, b, t) {
  return a + (b - a) * t;
}

const _signalMats = {
  stable:    new THREE.MeshBasicMaterial({ color: 0xaabbff, transparent: true, opacity: 0.85 }),
  fast:      new THREE.MeshBasicMaterial({ color: 0x33ffee, transparent: true, opacity: 0.90 }),
  resonance: new THREE.MeshBasicMaterial({ color: 0xbb88ff, transparent: true, opacity: 0.88 }),
  fragile:   new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.80 }),
};
const _signalBatches = Object.create(null);
const _sigDummy = new THREE.Object3D();
let _signalBatchCapacity = 256;
const _RELAY_SIGNAL_CAP = 4;


function _ensureSignalBatches() {
  if (_signalBatches.stable) return;
  for (let i = 0; i < _SIG_TYPE_KEYS.length; i++) {
    const key = _SIG_TYPE_KEYS[i];
    const mesh = new THREE.InstancedMesh(GS2, _signalMats[key], _signalBatchCapacity);
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    microGroup.add(mesh);
    _signalBatches[key] = { key, mesh, signals: [] };
  }
}

function _growSignalBatches(minCapacity) {
  _ensureSignalBatches();
  let nextCap = _signalBatchCapacity;
  while (nextCap < minCapacity) nextCap *= 2;
  if (nextCap === _signalBatchCapacity) return;
  _signalBatchCapacity = nextCap;
  for (let i = 0; i < _SIG_TYPE_KEYS.length; i++) {
    const key = _SIG_TYPE_KEYS[i];
    const bucket = _signalBatches[key];
    const nextMesh = new THREE.InstancedMesh(GS2, _signalMats[key], _signalBatchCapacity);
    nextMesh.count = bucket.mesh.count;
    nextMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nextMesh.frustumCulled = false;
    microGroup.add(nextMesh);
    microGroup.remove(bucket.mesh);
    bucket.mesh.dispose();
    bucket.mesh = nextMesh;
  }
}

function _syncSignalBatchLayout() {
  _ensureSignalBatches();
  if (signals.length > _signalBatchCapacity) _growSignalBatches(signals.length);
  for (let i = 0; i < _SIG_TYPE_KEYS.length; i++) {
    const bucket = _signalBatches[_SIG_TYPE_KEYS[i]];
    bucket.signals.length = 0;
  }
  for (let i = 0; i < signals.length; i++) {
    const signal = signals[i];
    const bucket = _signalBatches[signal.type] || _signalBatches.stable;
    signal._batchKey = bucket.key;
    signal._batchIndex = bucket.signals.length;
    bucket.signals.push(signal);
  }
  for (let i = 0; i < _SIG_TYPE_KEYS.length; i++) {
    const bucket = _signalBatches[_SIG_TYPE_KEYS[i]];
    bucket.mesh.count = bucket.signals.length;
    bucket.mesh.visible = bucket.signals.length > 0;
  }
}

export function _commitSignalBatches() {
  _syncSignalBatchLayout();
  for (let bi = 0; bi < _SIG_TYPE_KEYS.length; bi++) {
    const bucket = _signalBatches[_SIG_TYPE_KEYS[bi]];
    const mesh = bucket.mesh;
    const active = bucket.signals;
    for (let i = 0; i < active.length; i++) {
      _sigDummy.position.copy(active[i].pos);
      // Type-specific signal shape: fast = elongated bullet, fragile = flickery
      const _sType = active[i].type;   // FIX-01: was active[si] — si is undefined here
      let _sigScale = 1.0;
      if (_sType === 'fast') _sigScale = 1.45;       // elongated along travel axis
      else if (_sType === 'resonance') _sigScale = 1.2; // slightly fuller
      else if (_sType === 'fragile')   _sigScale = 0.82; // smaller, less confident
      // z-axis = travel direction → more elongated = stronger directional read
      const _elongZ = _sType === 'fast' ? _sigScale * 1.6 : _sigScale * 1.1;
      // v96: Phantom signals appear dimmer / smaller
      const _isPhantom = active[i]._phantom;
      const _phantomFactor = _isPhantom ? (active[i]._phantomOpacity || 0.12) * 0.5 : 1.0;
      _sigDummy.scale.set(_sigScale * 0.72 * (_isPhantom ? 0.55 : 1.0), _sigScale * 0.72 * (_isPhantom ? 0.55 : 1.0), _elongZ * (_isPhantom ? 0.55 : 1.0)); // z = travel dir
      _sigDummy.rotation.set(0, 0, 0);
      _sigDummy.updateMatrix();
      mesh.setMatrixAt(i, _sigDummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = active.length > 0;
  }
}

export function _resetSignalBatches() {
  _ensureSignalBatches();
  for (let i = 0; i < _SIG_TYPE_KEYS.length; i++) {
    const bucket = _signalBatches[_SIG_TYPE_KEYS[i]];
    bucket.signals.length = 0;
    bucket.mesh.count = 0;
    bucket.mesh.visible = false;
    bucket.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function spawnSig(lk, boost) {
  // LT is module-scope const
  const lt  = lk.lt || LT.stable;
  // Relay cap: count how many signals currently pass through relay nodes on this link
  if (lk.a.type === 'relay' || lk.b.type === 'relay') {
    const relayNode = lk.a.type === 'relay' ? lk.a : lk.b;
    // Count signals through this relay across all its links
    let relaySignalLoad = 0;
    for (let _ri = 0; _ri < signals.length; _ri++) {
      const _rs = signals[_ri];
      if (_rs.lk.a === relayNode || _rs.lk.b === relayNode) relaySignalLoad++;
    }
    if (relaySignalLoad >= _RELAY_SIGNAL_CAP) return null; // relay at capacity
  }
  const relayMult = (lk.a.type === 'relay' || lk.b.type === 'relay') ? 1.8 : 1.0;
  const _sigSpeedEvtMult = (typeof window !== 'undefined' && window.eventMods?.signalSpeedMult) || 1.0;
  const spd = (0.005 + Math.random() * 0.007) * lt.spd * relayMult * (boost || 1) * _sigSpeedEvtMult;

  const dir = Math.random() > 0.5 ? 1 : -1;
  const s = {
    lk,
    t: 0,
    spd,
    dir,
    type: lk.type || 'stable',
    pos: new THREE.Vector3(),
    _batchKey: null,
    _batchIndex: -1,
  };
  s.pos.copy(dir === 1 ? lk.a.pos : lk.b.pos);
  signals.push(s);
  lk.sigs.push(s);
  // v96: Atrophie tracking — record last time this link carried a signal
  lk._lastActiveAt = Date.now();
  _markLinkActive(lk);
}

/**
 * Spawn a shockwave ring at world origin.
 * Reuses _SHOCK_GEO (shared) — only the material and transform are unique per instance.
 */
export function spawnShock(col, priority = 0) {
  const fx = getFxQualityStats();
  const calmness = getEarlyGameVisualCalmness();
  if (!shouldSpawnShock(priority)) return;
  let entry = null;
  if (shockwaves.length >= fx.maxShockwaves) {
    entry = shockwaves.shift() || null;
    if (entry) entry.m.visible = false;
  }
  if (!entry) entry = _shockPool.pop();
  if (!entry) {
    const mat = new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(_SHOCK_GEO, mat);
    m.visible = false;
    fxGroup.add(m);
    entry = { m, mat, r: 0 };
  }
  entry.r = 0;
  entry.mat.color.setHex(col);
  entry.mat.opacity = _lerp(0.85, 0.46, calmness);
  entry.m.position.set(0, 0, 0);
  entry.m.scale.setScalar(_lerp(1, 0.82, calmness));
  entry.m.quaternion.copy(camera.quaternion);
  entry.m.visible = true;
  shockwaves.push(entry);
}

/**
 * Spawn a pulse trail ring at a world position.
 * Reuses _TRAIL_GEO (shared) — only the material and transform are unique per instance.
 */
export function spawnPulseTrail(pos, col, priority = 0) {
  const fx = getFxQualityStats();
  const calmness = getEarlyGameVisualCalmness();
  if (!shouldSpawnPulseTrail(priority)) return;
  let entry = null;
  if (pulseTrails.length >= fx.maxPulseTrails) {
    entry = pulseTrails.shift() || null;
    if (entry) entry.m.visible = false;
  }
  if (!entry) entry = _trailPool.pop();
  if (!entry) {
    const mat = new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(_TRAIL_GEO, mat);
    m.visible = false;
    fxGroup.add(m);
    entry = { m, mat, r: 0, life: 0 };
  }
  entry.r = 0;
  entry.life = 0;
  entry.mat.color.setHex(col);
  entry.mat.opacity = _lerp(0.85, 0.52, calmness);
  entry.m.position.copy(pos);
  entry.m.scale.setScalar(_lerp(1, 0.88, calmness));
  entry.m.quaternion.copy(camera.quaternion);
  entry.m.visible = true;
  pulseTrails.push(entry);
}


// ═══════════════════════════════════════════════════════════════════════════
//  DISPOSE-AWARE REMOVERS  (P0 audit fix)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Manual memory discharge — call when player explicitly discharges a memory node.
 * Returns energy gained (0 if node not a memory type or no charge).
 * Timing bonus: ×1.5 if charge > 80% of memoryMultiplier cap.
 */
export function manualDischargeMemory(node) {
  if (!node || node.type !== 'memory' || !node.memCharge) return 0;
  const now = Date.now() / 1000;
  const cd = TUNING.memoryDischargeCd || 7;
  if (node.lastDischarge && (now - node.lastDischarge) < cd) return 0;

  const charge = node.memCharge;
  const mult = TUNING.memoryMultiplier || 1.65;
  const timingBonus = charge > 80 ? 1.5 : 1.0;  // ×1.5 when >80 charge
  const energy = Math.max(1, Math.round(charge * mult * timingBonus));

  G.energy += energy;
  node.memCharge = 0;
  node.lastDischarge = now;

  if (timingBonus > 1) {
    showToast('⬡ MEMORY-TIMING', `×1.5 Bonus · +${energy}⬡ · Perfekte Entladung`, 2200);
    spawnShock(0xcc44ff);
  } else {
    showToast('⬡ ENTLADEN', `+${energy}⬡ · Memory geleert`, 1400);
  }
  signalEnergyChanged();
  return energy;
}
window.manualDischargeMemory = manualDischargeMemory;

export function _tickSigs() {
  // LT is module-scope const
  const activeAIState = aiState;

  // Phase Link: update active/inactive state based on time
  const _phaseOn  = TUNING.phaseLinkOnDuration  || 2.0;
  const _phaseOff = TUNING.phaseLinkOffDuration || 1.0;
  const _phaseCycle = _phaseOn + _phaseOff;
  for (let _pi = 0; _pi < gameLinks.length; _pi++) {
    const _pl = gameLinks[_pi];
    if (_pl.type === 'phase') {
      const _phaseT = (Date.now() / 1000 + _pl._batchIndex * 0.7) % _phaseCycle;
      _pl._phaseActive = _phaseT < _phaseOn;
    }
  }

  // Passive signal spawn
  if (gameLinks.length && Math.random() < 0.13) {
    const lk = gameLinks[Math.floor(Math.random() * gameLinks.length)];
    // Phase link: only spawn during active phase
    if (lk.type === 'phase' && !lk._phaseActive) { /* skip — phase link inactive */ }
    else if (lk.sigs.length < 3) spawnSig(lk);
  }

  // Advance + resolve signals
  for (let i = signals.length - 1; i >= 0; i--) {
    const s = signals[i];
    s.t += s.spd;

    if (s.t >= 1) {
      const li = s.lk.sigs.indexOf(s);
      if (li >= 0) { s.lk.sigs[li] = s.lk.sigs[s.lk.sigs.length - 1]; s.lk.sigs.pop(); }
      signals[i] = signals[signals.length - 1]; signals.pop();

      // v96: Phantom signals — no energy delivery, just visual
      if (s._phantom) continue;

      const target = s.dir === 1 ? s.lk.b : s.lk.a;
      const lt     = s.lk.lt || LT.stable;
      let gain     = lt.em;
      // v95: Catalyst Node — boost nearby signals when receiving
      if (target.type === 'catalyst') {
        const _catalystBoostDur = TUNING.catalystBoostDuration || 1.5;
        const _catalystBoostMult = TUNING.catalystBoostMult || 2.2;
        // Boost all signals currently on links adjacent to this catalyst node
        for (let _ci = 0; _ci < signals.length; _ci++) {
          const _cs = signals[_ci];
          if (_cs.lk.a === target || _cs.lk.b === target) {
            _cs.spd *= _catalystBoostMult;
            _cs._catalystBoostEnd = Date.now() / 1000 + _catalystBoostDur;
          }
        }
        // Spawn up to 2 new signals outward from the catalyst using the
        // adjacency cache when available. Avoid filter/slice/forEach in this
        // hot path to reduce transient allocations during busy scenes.
        const incidentLinks = G.eco?._nodeLinkCache?.get(target._id)
          || G.eco?._nodeLinkCache?.get(String(target.id))
          || gameLinks;
        let spawned = 0;
        for (let _li = 0; _li < incidentLinks.length && spawned < 2; _li++) {
          const cl = incidentLinks[_li];
          if (cl.a !== target && cl.b !== target) continue;
          spawnSig(cl, 1.8);
          spawned++;
        }
        gain += 3; // catalyst also gives small energy bonus
      }

      if (target.type === 'amplifier')                                        gain *= 2;
      if (traitState.conservative && s.lk.type === 'stable')                gain *= 1.08;
      if (gameplayFlags.resonanceDebtActive)                                        gain *= 1.8;
      if (activeAIState?.dominantProfile === 'analyst' && s.lk.type === 'stable')
        gain *= (1 + (PROFILE_BONUS?.analyst.bridgeStabBonus || 0) * 0.5 + 0.08);
      if (activeAIState?.dominantProfile === 'mnemonic' && s.lk.type === 'resonance') gain *= 1.12;

      if (s.lk.type === 'resonance') {
        const ai = s.lk.a.id, bi = s.lk.b.id;
        if (_linkInTri(ai, bi)) gain *= 1.35;
      }

      if (target.type === 'memory') {
        let memGain = gain;
        if (activeAIState?.dominantProfile === 'mnemonic') {
          const adjRes = _resonanceDegree.get(target) || 0;
          if (adjRes > 0) memGain *= (1 + adjRes * 0.15);
        }
        target.memCharge += memGain;
        gain = 0;
      }

      if (gain > 0) G.energy += Math.max(1, Math.round(gain));
    } else {
      const fr = s.dir === 1 ? s.lk.a : s.lk.b;
      const to = s.dir === 1 ? s.lk.b : s.lk.a;
      s.pos.lerpVectors(fr.pos, to.pos, s.t);
      // Signal trail: occasionally spawn a micro trail ring at signal position
      if (Math.random() < 0.025 * (s.type === 'fast' ? 2.5 : 1.0)) {
        const trailCol = s.type === 'fast' ? 0x44ffee :
                         s.type === 'resonance' ? 0xaa66ff :
                         s.type === 'fragile' ? 0xffaa22 : 0x8899ee;
        // Use spawnPulseTrail inline equivalent — mini flash at signal pos
        if (typeof spawnPulseTrail === 'function') spawnPulseTrail(s.pos.clone(), trailCol, 0);
      }
    }
  }

  // Fragile link break check
  for (let i = gameLinks.length - 1; i >= 0; i--) {
    const lk = gameLinks[i];
    if (lk.type !== 'fragile') continue;
    const stabFactor   = 1 - (PROFILE_BONUS?.analyst.bridgeStabBonus || 0);
    const metaFactor   = (traitState.structural   ? 0.88 : 1.0)
                       * (traitState.conservative ? 0.93 : 1.0)
                       * (traitState.volatile     ? 1.07 : 1.0);
    const bridgeImmune = upgradeState.bridgeImmunity && G.backboneActive && lk.type === 'stable';
    if (!bridgeImmune && Math.random() < lk.lt.brk * (1 + lk.sigs.length) * stabFactor * metaFactor) {
      _collapseLink(i);
    }
  }
}

export function _tickShocks() {
  const fx = getFxQualityStats();
  const step = fx.shockStep || 1.4;
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const sw = shockwaves[i];
    const p  = sw.r / 42;
    sw.r += step * (1 - p * 0.6);
    sw.m.scale.setScalar(sw.r);
    sw.m.quaternion.copy(camera.quaternion);
    sw.mat.opacity = Math.max(0, 0.85 * Math.pow(1 - sw.r / 42, 1.4));
    if (sw.r >= 42) {
      sw.m.visible = false;
      _shockPool.push(sw);
      shockwaves.splice(i, 1);
    }
  }
}

export function _tickPulseTrails() {
  const fx = getFxQualityStats();
  const radiusStep = fx.trailRadiusStep || 0.18;
  const lifeStep = fx.trailLifeStep || 16;
  for (let i = pulseTrails.length - 1; i >= 0; i--) {
    const tr = pulseTrails[i];
    tr.r    += radiusStep;
    tr.life += lifeStep;
    const p  = tr.life / 600;
    tr.m.scale.setScalar(1 + tr.r * (1 - p * 0.3));
    tr.m.quaternion.copy(camera.quaternion);
    tr.mat.opacity = Math.max(0, 0.9 * Math.pow(1 - p, 1.6));
    if (tr.life >= 600) {
      tr.m.visible = false;
      _trailPool.push(tr);
      pulseTrails.splice(i, 1);
    }
  }
}

export function _tickSource(t) {
  if (t - G.srcLastTick < TUNING.sourceTick) return;
  G.srcLastTick = t;
  const cnt = _sourceNodeCount;
  if (cnt <= 0) return;
  const full     = Math.min(cnt, TUNING.sourceSoftcapCount);
  const overflow = Math.max(0, cnt - TUNING.sourceSoftcapCount);
  let gain = full + Math.ceil(overflow * TUNING.sourceSoftcapFactor);

  // v96: Apply terrain passive bonus per source node, apply interference penalty
  let terrainMult = 1.0;
  let interferingCount = 0;
  for (const n of gameNodes) {
    if (n.type !== 'source' || n.isMain) continue;
    if (n._interfering) interferingCount++;
    else terrainMult += getTerrainPassiveBonus(n) - 1.0;
  }
  // Interference: each pair reduces gain by penalty fraction
  const interferePenalty = interferingCount > 0 ? 0.30 * Math.ceil(interferingCount / 2) : 0;
  gain = Math.round(gain * Math.max(0.1, terrainMult - interferePenalty));

  G.energy += gain;
  signalEnergyChanged();
}


export function _tickAutoPulseSignals() {
  for (const link of gameLinks) {
    if (!link._autoPulseQueued) continue;
    link._autoPulseQueued = false;
    spawnSig(link, 1.6);
  }
}


export function _tickMemoryNetwork() {
  if (!upgradeState?.memoryNetwork) return;
  for (let i = 0; i < gameNodes.length; i++) {
    const a = gameNodes[i];
    if (a.type !== 'memory' || !a.memCharge) continue;
    // If overcharged (> 80), share with adjacent memory nodes
    if (a.memCharge > 80) {
      const incidentLinks = G.eco?._nodeLinkCache?.get(a._id)
        || G.eco?._nodeLinkCache?.get(String(a.id))
        || gameLinks;
      let shared = 0;
      for (let li = 0; li < incidentLinks.length && shared < 2; li++) {
        const link = incidentLinks[li];
        if (link.a !== a && link.b !== a) continue;
        const neighbor = link.a === a ? link.b : link.a;
        if (!neighbor || neighbor === a || neighbor.type !== 'memory' || neighbor.memCharge >= 60) continue;
        const transfer = Math.min(15, a.memCharge - 60);
        if (transfer <= 0) break;
        a.memCharge -= transfer;
        neighbor.memCharge += transfer;
        shared++;
      }
    }
  }
}

export function _tickTris(t) {
  if (!G.tris.size) return;
  if (t - G.triLastTick < TUNING.trianglePassiveTick) return;
  G.triLastTick = t;
  const activeAIState = aiState;
  let triGain = G.tris.size;
  if (activeAIState?.dominantProfile === 'analyst' && G.tris.size >= 2) {
    const bonus = Math.ceil(G.tris.size * 0.5);
    triGain += bonus;
    if (bonus >= 2 && Math.random() < 0.3) {
      const lang = getLang();
      showToast(
        'ANALYST-GRID',
        lang === 'de' ? `+${bonus}⬡ Dreieck-Bonus` : `+${bonus}⬡ Triangle bonus`,
        1200
      );
    }
  }
  G.energy += triGain;
  signalEnergyChanged();
}


// ═══════════════════════════════════════════════════════════════════════════
//  MAIN ANIMATE TICK — called by gameLoop._gameUpdate()
// ═══════════════════════════════════════════════════════════════════════════

export function _applySignalLook(calmness) {
  if (_lastSignalCalmness >= 0 && Math.abs(_lastSignalCalmness - calmness) < 0.02) return;
  _lastSignalCalmness = calmness;
  for (let i = 0; i < _SIG_TYPE_KEYS.length; i++) {
    const key = _SIG_TYPE_KEYS[i];
    const mat = _signalMats[key];
    mat.opacity = _lerp(_SIGNAL_BASE_OPACITY[key] || 0.92, _SIGNAL_SOFT_OPACITY[key] || 0.52, calmness);
  }
}