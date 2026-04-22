/**
 * SYNAPSE v98 — Layer 1 render orchestration
 *
 * ── RENDER PIPELINE SOURCE-OF-TRUTH MAP ─────────────────────────────
 *
 * Node visual state lives at:
 *   n.mat.color / n.mat.emissive / n.mat.emissiveIntensity — THREE material
 *   n.m.scale — Three.js mesh scale (selection / pulse overshoot)
 *   n._dec — decorator mesh (ring, shell, secondary geometry)
 *   n.sz  — canonical base size (read-only after creation)
 *
 * Link visual state lives at:
 *   _linkBatch.mesh — InstancedMesh for all links (color, opacity per instance)
 *   lk._batchIndex  — index into the batch (stable for link lifetime)
 *   lk._lastSignalT — afterglow timestamp (written by spawnSig, read by _writeLinkBatchColor)
 *   lk._phaseActive — Phase Link on/off state (written by _tickSigs)
 *
 * Signal visual state lives at:
 *   _signalBatches[type].mesh — per-type InstancedMesh (fast, resonance, fragile, stable)
 *   s.pos / s.t / s.dir / s.spd — all signal runtime state on the signal object
 *   s.lk — back-reference to parent link (for color, type lookup)
 *   _sigDummy — scratch Object3D for matrix composition (never persisted)
 */
import * as THREE from 'three';
import { microGroup, camera } from '../../engine/scene.js';
import { G } from '../../state/gameState.js';
import { TUNING } from '../../state/tuning.js';
import { aiState } from '../../state/aiShared.js';
import { getLODDetail, getCameraZoomFactor, triggerSelectionFocus, notifyInteraction } from '../../systems/fx/cameraFX.js';
import { shouldCommitSignalVisual } from '../../platform/fxQuality.js';
import {
  NODE_BASE_COLORS as _NODE_BASE_COLORS,
  NODE_TYPE_EMISSIVE as _NODE_TYPE_EMISSIVE,
  NODE_SOFT_BASE_COLORS as _NODE_SOFT_BASE_COLORS,
  NODE_SOFT_EMISSIVE as _NODE_SOFT_EMISSIVE,
  LINK_BASE_COLORS as _LINK_BASE_COLORS,
  LINK_SOFT_COLORS as _LINK_SOFT_COLORS,
  CURVE_STRENGTH as _CURVE_STRENGTH,
  FLOW_SPEED as _FLOW_SPEED,
} from './_constants.js';
import {
  gameNodes,
  gameLinks,
  signals,
  shockwaves,
  pulseTrails,
  _shockPool,
  _trailPool,
  _adjSet,
  _triNodeCounts,
  _resonanceDegree,
  _getSourceNodeCount,
  _setSourceNodeCount,
  _bumpLinkVersion,
} from './_state.js';
import {
  _tickNodeDecorators,
  _tickSelRing,
  _commitNodeInstances,
  _resetNodeInstances,
  _setNodeEmissiveHex,
  _setNodeBaseColorHex,
  _resetSelRing,
  getEarlyGameVisualCalmness,
} from './_nodeLifecycle.js';
import {
  _syncLinkBatchLayout,
  _resetCurveLinkBatch,
  _resetFlowBatch,
  _writeLinkBatchColor,
  _flushLinkBatchFrame,
  _flushCurveLinkBatch,
  _flushFlowBatch,
  _writeCurvedLink,
  _writeFlowLink,
  _getLinkCurveOffset,
  _getLinkFragilePhase,
  _getLinkAfterglowStrength,
  _setLinkColorHex,
  _resetLinkBatch,
  updateLinkGeo,
} from './_linkTopology.js';
import {
  _tickSigs,
  _tickShocks,
  _tickPulseTrails,
  _tickSource,
  _tickAutoPulseSignals,
  _tickMemoryNetwork,
  _tickTris,
  _commitSignalBatches,
  _resetSignalBatches,
  _applySignalLook,
} from './_signalSim.js';

const _colorMixA = new THREE.Color();
const _colorMixB = new THREE.Color();
let _lastSelectedNode = null;

function _clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function _lerp(a, b, t) {
  return a + (b - a) * t;
}

function _blendHex(hexA, hexB, t) {
  if (t <= 0) return hexA;
  if (t >= 1) return hexB;
  _colorMixA.setHex(hexA);
  _colorMixB.setHex(hexB);
  _colorMixA.lerp(_colorMixB, t);
  return _colorMixA.getHex();
}

export function animateLayer1(t, dt) {
  // Cache once — avoids one Date.now() syscall per node per frame.
  const now = Date.now();
  const tMs = t * 1000; // milliseconds equivalent of Three.Clock time, for animations
  const earlyLookCalmness = getEarlyGameVisualCalmness();
  const _lodDetail = getLODDetail();          // 'low' | 'medium' | 'high'
  const _lodLow    = _lodDetail === 'low';
  const _zoomFact  = getCameraZoomFactor();   // 0=far … 1=close
  const calmEarlyNodes = earlyLookCalmness >= 0.55;
  _applySignalLook(earlyLookCalmness);

  // v96: Heartbeat — mood-driven pulsing frequency for Source nodes
  const _v96MoodFreq = {
    dormant: 0.8, observing: 1.0, focused: 1.2,
    aggressive: 2.0, expanding: 1.4, deep: 0.9, emergent: 2.4,
  }[aiState?.agentMood || 'dormant'] ?? 1.0;
  const _v96IsAggressive = aiState?.agentMood === 'aggressive' || aiState?.agentMood === 'emergent';

  // ── Node animation ───────────────────────────────────────────────────────
  for (let i = 0; i < gameNodes.length; i++) {
    const n = gameNodes[i];
    const o = n.off;

    // Spawn spring: cubic ease-out + slight overshoot
    if (n._spawnT < 1) {
      n._spawnT = Math.min(1, n._spawnT + dt * 3.8);
      const sp = n._spawnT;
      const sc = 1 - (1 - sp) * (1 - sp) * (1 - sp);
      const overshootAmp = _lerp(0.12, 0.022, earlyLookCalmness);
      const overshoot = sp < 1 ? 1 + Math.sin(sp * Math.PI) * overshootAmp : 1;
      if (!n.selected) n.m.scale.setScalar(n.sz * sc * overshoot);
    }

    n.pos.x = n.base.x + Math.sin(t * 0.7  + o) * 0.22;
    n.pos.y = n.base.y + Math.sin(t * 0.82 + o + 1) * 0.22;
    n.pos.z = n.base.z + Math.cos(t * 0.95 + o) * 0.22;
    n.m.position.copy(n.pos);

    const normalBaseHex = n.isMain ? _NODE_BASE_COLORS.core : (_NODE_BASE_COLORS[n.type] || _NODE_BASE_COLORS.source);
    // Source softcap visual: over-cap sources glow amber as efficiency warning
    const _overSoftcap = n.type === 'source' && !n.isMain && _getSourceNodeCount() > (TUNING.sourceSoftcapCount || 4);
    const softBaseHex = n.isMain ? _NODE_SOFT_BASE_COLORS.core : (_NODE_SOFT_BASE_COLORS[n.type] || _NODE_SOFT_BASE_COLORS.source);
    _setNodeBaseColorHex(n, _blendHex(normalBaseHex, softBaseHex, earlyLookCalmness));

    let emissiveHex = n.isMain ? _NODE_TYPE_EMISSIVE.core : (_NODE_TYPE_EMISSIVE[n.type] || _NODE_TYPE_EMISSIVE.source);
    // Softcap warning tint: over-capacity sources glow warm amber
    if (_overSoftcap) emissiveHex = _blendHex(emissiveHex, 0xff8800, 0.6 + Math.sin(t * 3.5) * 0.3);
    let emissiveIntensity = 0;

    if (n.selected) {
      // Calm selection: constant scale + slow gentle pulse — ring does the work
      const selectedScale = _lerp(1.12, 1.06, earlyLookCalmness);
      const selectedPulse = _lerp(0.022, 0.008, earlyLookCalmness); // much slower
      const selectedBase = _lerp(3.8, 2.2, earlyLookCalmness);      // lower base glow
      const selectedWave = _lerp(0.35, 0.10, earlyLookCalmness);    // gentle wave
      n.m.scale.setScalar(n.sz * (selectedScale + Math.sin(t * 2.5) * selectedPulse));
      emissiveIntensity = selectedBase + Math.sin(t * 2.8) * selectedWave;
      emissiveHex = _blendHex(0x99ccff, 0xcce4ff, Math.min(1, earlyLookCalmness * 0.9));
      n._visualState = calmEarlyNodes ? 'selected-calm' : 'selected';
    } else {
      const base = n.isMain
        ? _lerp(3.4, 1.08, earlyLookCalmness)
        : _lerp(1.9, 0.62, earlyLookCalmness);
      if (n.isMain && !n.selected) {
        // Hero-Core anchor: pulsing size variation + stronger bloom attractor
        const heroScale = 1.0 + Math.sin(t * 1.1 + o * 0.3) * 0.055;
        if (n._spawnT >= 1) n.m.scale.setScalar(n.sz * heroScale);
      }
      if (G.autoOn && n.isMain) {
        emissiveIntensity = _lerp(
          base + Math.sin(t * 1.7 + o) * 0.7,
          base + Math.sin(t * 1.2 + o) * 0.1,
          earlyLookCalmness
        );
        emissiveHex = _blendHex(0xff8833, 0xffa07e, Math.min(1, earlyLookCalmness * 0.95));
        n._visualState = calmEarlyNodes ? 'auto-main-calm' : 'auto-main';
      } else if (n.type === 'memory' && n.memCharge > 0) {
        emissiveIntensity = _lerp(
          base + Math.min(5, n.memCharge * 0.3) + Math.sin(t * 3 + o) * 0.25,
          base + Math.min(1.2, n.memCharge * 0.08) + Math.sin(t * 2.1 + o) * 0.08,
          earlyLookCalmness
        );
        emissiveHex = _blendHex(0xcc44ff, _NODE_SOFT_EMISSIVE.memory, Math.min(1, earlyLookCalmness * 0.9));
        n._visualState = calmEarlyNodes ? 'memory-charged-calm' : 'memory-charged';
      } else {
        emissiveIntensity = _lerp(
          base + Math.sin(t * 0.7 + o) * 0.15,
          base,
          earlyLookCalmness
        );
        n._visualState = calmEarlyNodes ? (n.isMain ? 'main-calm' : n.type + '-calm') : (n.isMain ? 'main' : n.type);
      }
      emissiveIntensity += n.connCount * _lerp(0.08, 0.018, earlyLookCalmness);

      // Node age visualisation (v78 MOD) — uses `now` cached at top of animateLayer1
      if (n.createdAt) {
        const age = (now - n.createdAt) / 1000;
        const ageBonusScale = _lerp(1, 0.45, earlyLookCalmness);
        if (age > 90) {
          emissiveIntensity += 0.9 * ageBonusScale;
        } else if (age > 30) {
          emissiveIntensity += 0.5 * ageBonusScale;
        }
      }

      if (n._spawnT >= 1) n.m.scale.setScalar(n.sz);
    }

    const softEmissiveHex = n.selected
      ? 0xcfe4f6
      : (n.isMain ? _NODE_SOFT_EMISSIVE.core : (_NODE_SOFT_EMISSIVE[n.type] || _NODE_SOFT_EMISSIVE.source));
    emissiveHex = _blendHex(emissiveHex, softEmissiveHex, Math.min(1, earlyLookCalmness * (n.selected ? 0.55 : 0.9)));
    emissiveIntensity *= _lerp(1, n.selected ? 0.7 : 0.64, earlyLookCalmness);

    // v96: Heartbeat — Source nodes pulse at mood-driven frequency
    if (!n.selected && n.type === 'source') {
      const _hbWave = Math.sin(t * _v96MoodFreq * Math.PI * 2 + n.off) * 0.5 + 0.5;
      emissiveIntensity += _hbWave * 0.55;
      if (_v96IsAggressive) {
        emissiveHex = _blendHex(emissiveHex, 0xff2200, _hbWave * 0.12);
      }
    }

    n.mat.emissiveIntensity = emissiveIntensity;
    _setNodeEmissiveHex(n, emissiveHex);

    if (!n.selected && n.createdAt) {
      const age = (now - n.createdAt) / 1000;
      if (age > 90) {
        const ec = n.mat.emissive;
        ec.r = Math.min(1, ec.r + 0.04 * _lerp(1, 0.45, earlyLookCalmness));
        ec.g = Math.min(1, ec.g + 0.04 * _lerp(1, 0.45, earlyLookCalmness));
        ec.b = Math.min(1, ec.b + 0.04 * _lerp(1, 0.45, earlyLookCalmness));
      }
    }
  }

  // ── Tick form decorators (shape-based type encoding) ──────────────────────
  // LOD: hide decorators when far out to reduce visual noise
  if (_lodLow) {
    for (let i = 0; i < gameNodes.length; i++) {
      const n = gameNodes[i];
      if (n._dec && n._dec.mesh) n._dec.mesh.visible = false;
    }
  }
  _tickNodeDecorators(t, earlyLookCalmness);

  // ── Tick selection ring (calm outer torus) ──────────────────────────────
  const _selectedNode = gameNodes.find(n => n.selected) || null;
  // Backbone visual: spine nodes get a subtle teal ring when backbone is active
  if (G.backboneActive && G.spineNodes?.size > 0) {
    for (let _bi = 0; _bi < gameNodes.length; _bi++) {
      const _bn = gameNodes[_bi];
      if (!_bn._dec || _bn.selected) continue;
      if (G.spineNodes.has(_bn.id)) {
        // Tint emissive slightly teal for spine identification
        const _spineGlow = 0.35 + Math.sin(t * 1.8 + _bi) * 0.15;
        _bn.mat.emissive.lerp(new THREE.Color(0x00ccbb), _spineGlow * 0.25);
      }
    }
  }
  _tickSelRing(t, _selectedNode);
  // Trigger camera focus on selection if changed
  if (_selectedNode !== _lastSelectedNode) {
    _lastSelectedNode = _selectedNode;
    if (_selectedNode) triggerSelectionFocus(_selectedNode);
    notifyInteraction();
  }

  _commitNodeInstances();

  // ── Link animation ───────────────────────────────────────────────────────
  _syncLinkBatchLayout();
  _resetCurveLinkBatch(); // reset curve batch each frame
  _resetFlowBatch();       // v98b: reset flow overlay each frame
  const _selNode = gameNodes.find(n => n.selected) || null;
  for (let i = 0; i < gameLinks.length; i++) {
    const l = gameLinks[i];
    updateLinkGeo(l);

    // Neighbor-highlight: links connected to selected node stay bright
    const _isNeighborLink = _selNode && (l.a === _selNode || l.b === _selNode);
    const _isDistantLink  = _selNode && !_isNeighborLink;

    // Opacity: neighbor links boosted, distant links dimmed for focus
    const sc = l.sigs.length;
    // Layer1 priority: when lots of signals active, boost overall link brightness
    const l1Priority = Math.min(1, signals.length / 12);
    let normalTgt = sc === 0 ? (0.18 + l1Priority * 0.12) : sc === 1 ? (0.40 + l1Priority * 0.1) : 0.70;
    let calmTgt   = sc === 0 ? 0.09 : sc === 1 ? 0.22 : 0.40;
    if (_isNeighborLink)  { normalTgt = Math.min(0.88, normalTgt + 0.32); calmTgt = Math.min(0.72, calmTgt + 0.24); }
    else if (_isDistantLink) { normalTgt *= 0.35; calmTgt *= 0.35; }
    const tgt = _lerp(normalTgt, calmTgt, earlyLookCalmness);
    l.mat.opacity += (tgt - l.mat.opacity) * 0.12;

    // v96: Atrophie — links not recently used grow visually "dim"
    // Memory-Echo: active links glow brighter (afterglow already handles boost)
    if (!l._resonanzFlash && l._lastActiveAt) {
      const _ageSecs = (now - l._lastActiveAt) / 1000;
      if (_ageSecs > 30) {
        const _atrophy = Math.max(0.35, 1.0 - (_ageSecs - 30) / 70);
        l.mat.opacity *= _atrophy;
      }
    } else if (!l._lastActiveAt && sc === 0) {
      // Brand new, never used — fade slightly
      l.mat.opacity *= 0.75;
    }

    // v78 Resonanz-Fenster flicker — uses tMs (no Date.now syscall)
    if (l._resonanzFlash) {
      l.mat.opacity = _lerp(0.7 + Math.sin(tMs * 0.025) * 0.3, 0.48 + Math.sin(tMs * 0.025) * 0.18, earlyLookCalmness);
      _setLinkColorHex(l, _blendHex(0x00ffee, 0x8fdede, Math.min(1, earlyLookCalmness * 0.8)));
      l._flashState = 1;
    } else {
      // Phase link: flicker out during inactive phase
    if (l.type === 'phase' && !l._phaseActive) {
      l.mat.opacity += (0.08 - l.mat.opacity) * 0.25;  // fade down fast
    }
    const baseHex = l._origColor || _LINK_BASE_COLORS[l.type] || 0x5588ff;
      const softHex = _LINK_SOFT_COLORS[l.type] || 0x9db3ee;
      _setLinkColorHex(l, _blendHex(baseHex, softHex, Math.min(1, earlyLookCalmness * 0.92)));
      if (l._resonanzFlash === false) l._resonanzFlash = undefined;
      l._flashState = 0;
    }

    _writeLinkBatchColor(l);

    // ── Curved link rendering for resonance and wide links ──────────────
    // Use curve batch for resonance (lw=1.6) — also adds head-to-tail gradient
    // Fragile links also get segmented look via flicker + curve
    const lod = getLODDetail();
    if (lod !== 'low') {
      const c = l.mat.color;
      let baseA = Math.max(0, Math.min(1, l.mat.opacity));

      // Afterglow boost: links that recently carried a signal stay brighter
      const aGlow = _getLinkAfterglowStrength(l);
      if (aGlow > 0.01) {
        baseA = Math.min(1, baseA + aGlow * 0.35);
      }

      if (l.type === 'resonance') {
        // Resonance: fat curved arc with strong head-to-tail gradient
        const offset = _getLinkCurveOffset(l) * 1.2;
        _writeCurvedLink(l, c.r, c.g, c.b, baseA * 0.65, offset);
        _writeCurvedLink(l, c.r * 1.1, c.g * 0.85, c.b * 1.2, baseA * 0.35, offset * 0.5);
      } else if (l.type === 'stable' && lod === 'high') {
        // Stable: gentle curve to avoid straight-edge monotony
        const offset = _getLinkCurveOffset(l) * 0.6;
        _writeCurvedLink(l, c.r, c.g, c.b, baseA * 0.45, offset);
      } else if (l.type === 'fast' && lod === 'high') {
        // Fast: tighter curve, elongated feel
        const offset = _getLinkCurveOffset(l) * 0.4;
        _writeCurvedLink(l, c.r, c.g, c.b, baseA * 0.40, offset);
      } else if (l.type === 'fragile') {
        // Fragile: segmented/dashed look via writing multiple short sub-segments
        // with alternating opacity to simulate broken/unstable structure
        const phase   = _getLinkFragilePhase(l);
        const flicker = 0.5 + Math.sin(t * 8.5 + phase) * 0.3;          // fast flicker
        const dashA   = baseA * flicker;
        const offset  = _getLinkCurveOffset(l) * 0.8;
        // Write 3 dashed arcs at different offsets to simulate segmentation
        _writeCurvedLink(l, c.r, c.g, c.b, dashA * 0.9, offset);
        _writeCurvedLink(l, c.r, c.g, c.b, dashA * 0.4, offset * -0.3);
        // Extra instability spark
        if (Math.random() < 0.06) {
          _writeCurvedLink(l, 1.0, 0.85, 0.2, 0.7, (Math.random() - 0.5) * _CURVE_STRENGTH);
        }
      }

      // ── v98b Flow overlay: additive animated dash stream per link ──────
      // Only render flow when link has signals or afterglow — keeps it "earned"
      const _flowActive = sc > 0 || _getLinkAfterglowStrength(l) > 0.05;
      if (lod !== 'low' && _flowActive) {
        const _flowSpd  = _FLOW_SPEED[l.type] || 0.28;
        // flow direction = majority signal direction on this link
        const _flowDir  = l.sigs.length > 0 ? (l.sigs[0].dir || 1) : 1;
        const _flowCurveOff = _getLinkCurveOffset(l) * 0.7;
        // Brightness: signal count drives intensity (capped at 0.55)
        const _flowA = Math.min(0.55, (sc > 0 ? 0.20 + sc * 0.12 : 0.12) + _getLinkAfterglowStrength(l) * 0.20);
        // speedT attribute carries per-link speed (no per-link uniform override needed)
        _writeFlowLink(l, c.r, c.g, c.b, _flowA, _flowCurveOff, _flowDir, _flowSpd);

      }
    }
  }
  _flushLinkBatchFrame();
  _flushCurveLinkBatch();
  _flushFlowBatch(dt);   // v98b: flush animated flow overlay

  // ── Sub-system ticks ─────────────────────────────────────────────────────
  _tickSigs();
  if (signals.length === 0) _resetSignalBatches();
  else if (shouldCommitSignalVisual('signal')) _commitSignalBatches();
  _tickShocks();
  _tickPulseTrails();
  _tickSource(t);
  _tickTris(t);
  _tickAutoPulseSignals(); // v96: fire queued auto-pulse signals
  _tickMemoryNetwork();
}

export function resetLayer1Runtime() {
  _resetFlowBatch(); // v98b
  for (let i = 0; i < gameLinks.length; i++) {
    const lk = gameLinks[i];
    lk.geo.dispose();
    lk.mat.dispose();
  }
  gameLinks.length = 0;

  signals.length = 0;
  _resetSignalBatches();

  for (let i = 0; i < shockwaves.length; i++) {
    shockwaves[i].m.visible = false;
    _shockPool.push(shockwaves[i]);
  }
  shockwaves.length = 0;

  for (let i = 0; i < pulseTrails.length; i++) {
    pulseTrails[i].m.visible = false;
    _trailPool.push(pulseTrails[i]);
  }
  pulseTrails.length = 0;

  for (let i = 0; i < gameNodes.length; i++) {
    const gn = gameNodes[i];
    if (gn._dec) {
      if (gn._dec.mat && gn._dec.mat.dispose) gn._dec.mat.dispose();
      gn._dec = null;
    }
    microGroup.remove(gn.m);
    gn.mat.dispose();
  }
  gameNodes.length = 0;
  _resetSelRing();
  _resetNodeInstances();
  _adjSet.clear();
  _triNodeCounts.clear();
  _resonanceDegree.clear();
  _setSourceNodeCount(0);
  _bumpLinkVersion();
  _resetLinkBatch();
  _resetCurveLinkBatch();
}
