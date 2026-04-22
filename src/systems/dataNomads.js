/**
 * SYNAPSE v98 — Data Nomads (Wild Algorithms)
 *
 * Neutral, wandering entities that traverse the grid independently.
 * They are neither boss nor friend by default — the player can choose
 * to capture them (build nodes near their path) or coexist passively.
 *
 * Nomad types:
 *   - Drifter    : slow, harmless. Captures grant +15⬡ one-time.
 *   - Pathfinder : medium speed, prefers resonance links. Symbiosis → +1⬡/beat.
 *   - Glitch     : fast, erratic. Capture dangerous (costs energy) but big reward.
 *   - Archivist  : very slow, large data store. Capture converts it to a Memory node.
 *
 * Capture mechanic:
 *   A nomad is "in capture range" when a player node is within CAPTURE_RADIUS
 *   world units of the nomad's current position.
 *   - Build a node near the nomad's path → capture score accumulates each beat.
 *   - When capture score ≥ CAPTURE_THRESHOLD → nomad captured.
 *   - Glitch nomads: 25% chance to deal 5⬡ damage per beat while in range.
 *
 * Integration:
 *   - tickNomads(t, dt) called from gameLoop._gameUpdate().
 *   - spawnNomad() called from heartbeat._fireBeat() every SPAWN_INTERVAL beats.
 *   - getNomads() for diagnostics / HUD display.
 *
 * Rendering:
 *   Nomads are Three.js meshes added directly to scene (not microGroup layers).
 *   They use a distinctive pulsing ring geometry.
 */

import * as THREE from 'three';
import { G }         from '../state/gameState.js';
import { gameNodes, gameLinks } from '../layers/network/index.js';
import { scene }     from '../engine/scene.js';
import { showToast } from '../ui/hud/index.js';
import { getLang }   from '../state/settings.js';
import { beatPhase } from './heartbeat.js';
import { signalEnergyChanged } from '../platform/stateSignals.js';

// ── Tuning ────────────────────────────────────────────────────────────────
const SPAWN_INTERVAL    = 8;    // beats between auto-spawns
const MAX_NOMADS        = 6;    // max simultaneous nomads
const CAPTURE_RADIUS    = 3.8;  // world-units — node must be this close
const CAPTURE_THRESHOLD = 4;    // beats in capture range to capture
const WANDER_RADIUS     = 22;   // keep nomads within this distance from origin
const NOMAD_TYPES = {
  drifter: {
    id: 'drifter', label: { de: 'Drifter', en: 'Drifter' },
    color: 0x44ccff, emissive: 0x1166aa,
    speed: 0.018, radius: 0.55, captureBonus: 15, symbiosis: null,
    weight: 40,
    desc: { de: '+15⬡ bei Eingrenzung', en: '+15⬡ on capture' },
  },
  pathfinder: {
    id: 'pathfinder', label: { de: 'Pfadfinder', en: 'Pathfinder' },
    color: 0x88ffcc, emissive: 0x226644,
    speed: 0.028, radius: 0.48, captureBonus: 5, symbiosis: '+1_per_beat',
    weight: 30,
    desc: { de: 'Symbiose: +1⬡/Beat', en: 'Symbiosis: +1⬡/beat' },
  },
  glitch: {
    id: 'glitch', label: { de: 'Glitch', en: 'Glitch' },
    color: 0xff4488, emissive: 0x881133,
    speed: 0.055, radius: 0.52, captureBonus: 30, symbiosis: null,
    weight: 18, dangerous: true,
    desc: { de: '+30⬡ − riskant!', en: '+30⬡ − risky!' },
  },
  archivist: {
    id: 'archivist', label: { de: 'Archivar', en: 'Archivist' },
    color: 0xaa88ff, emissive: 0x441166,
    speed: 0.008, radius: 0.70, captureBonus: 0, symbiosis: 'spawn_memory',
    weight: 12,
    desc: { de: 'Wandelt sich in Memory-Node um', en: 'Converts to a Memory node' },
  },
};

// ── Module state ──────────────────────────────────────────────────────────
const _nomads  = [];
let _beatsSinceSpawn = 0;

// Shared ring geometry (dispose on reset)
const _ringGeo  = new THREE.TorusGeometry(0.5, 0.06, 8, 24);

// ── Public API ─────────────────────────────────────────────────────────────

export function getNomads() { return _nomads; }

/** Spawn a nomad of a random type at the grid edge. */
export function spawnNomad(typeId) {
  if (_nomads.length >= MAX_NOMADS) return null;

  const type = NOMAD_TYPES[typeId] || _randomType();
  const angle  = Math.random() * Math.PI * 2;
  const startR = 16 + Math.random() * 4;

  const mat  = new THREE.MeshLambertMaterial({
    color:             type.color,
    emissive:          type.emissive,
    emissiveIntensity: 0.9,
    transparent:       true,
    opacity:           0.82,
  });
  const mesh = new THREE.Mesh(_ringGeo, mat);
  mesh.position.set(
    Math.cos(angle) * startR,
    Math.sin(angle) * startR,
    0
  );

  // Wander target — random point inside WANDER_RADIUS
  const targetAngle = Math.random() * Math.PI * 2;
  const targetR     = Math.random() * WANDER_RADIUS * 0.7;

  const nomad = {
    id:           _nomads.length + '_' + Date.now(),
    type,
    mesh,
    pos:          mesh.position,
    target:       new THREE.Vector3(
                    Math.cos(targetAngle) * targetR,
                    Math.sin(targetAngle) * targetR,
                    0
                  ),
    captureScore: 0,    // beats spent in capture range
    captured:     false,
    symbiotic:    false,
    _beatBonus:   0,    // energy provided per beat when symbiotic
    _glitchDmgCd: 0,
  };

  scene.add(mesh);
  _nomads.push(nomad);
  return nomad;
}

/**
 * Called every frame from gameLoop.
 */
export function tickNomads(t, dt) {
  if (!_nomads.length) return;

  const pulse = beatPhase;  // [0..1] — sync glow to heartbeat

  for (let i = _nomads.length - 1; i >= 0; i--) {
    const n = _nomads[i];
    if (n.captured) {
      _nomads.splice(i, 1);
      continue;
    }

    // ── Move toward current target ─────────────────────────────────────────
    const dx = n.target.x - n.pos.x;
    const dy = n.target.y - n.pos.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 0.8) {
      // Pick a new wander target
      const ang = Math.random() * Math.PI * 2;
      const r   = 4 + Math.random() * (WANDER_RADIUS * 0.6);
      n.target.set(Math.cos(ang) * r, Math.sin(ang) * r, 0);
    } else {
      const spd = n.type.speed * (n.symbiotic ? 0.5 : 1.0);
      n.pos.x += (dx / dist) * spd;
      n.pos.y += (dy / dist) * spd;
    }

    // Bounds clamp
    const posR = Math.hypot(n.pos.x, n.pos.y);
    if (posR > WANDER_RADIUS) {
      n.pos.normalize().multiplyScalar(WANDER_RADIUS);
    }

    // ── Pulse glow ────────────────────────────────────────────────────────
    const glow = 0.6 + pulse * 0.8;
    n.mesh.material.emissiveIntensity = glow;
    const scl = n.type.radius * (1.0 + pulse * 0.15);
    n.mesh.scale.setScalar(scl);

    // Rotation (makes ring spin for visual interest)
    n.mesh.rotation.z += dt * (n.type.id === 'glitch' ? 3.5 : 1.2);

    // ── Proximity to player nodes ─────────────────────────────────────────
    const nearNode = _nearestPlayerNode(n.pos);
    if (nearNode && nearNode.dist < CAPTURE_RADIUS) {
      _highlightNomad(n, true);
    } else {
      _highlightNomad(n, false);
    }
  }
}

/**
 * Called from heartbeat._fireBeat() every beat.
 * Handles capture scoring + symbiosis bonuses.
 */
export function onBeat() {
  _beatsSinceSpawn++;
  if (_beatsSinceSpawn >= SPAWN_INTERVAL) {
    _beatsSinceSpawn = 0;
    spawnNomad();
  }

  for (let i = _nomads.length - 1; i >= 0; i--) {
    const n = _nomads[i];

    // Symbiosis passive energy
    if (n.symbiotic && n.type.symbiosis === '+1_per_beat') {
      G.energy = (G.energy || 0) + 1;
      signalEnergyChanged();
    }

    // Check capture proximity
    const nearNode = _nearestPlayerNode(n.pos);
    if (!nearNode || nearNode.dist >= CAPTURE_RADIUS) {
      // Decay capture score slowly if nomad drifts away
      if (n.captureScore > 0) n.captureScore = Math.max(0, n.captureScore - 0.5);
      continue;
    }

    // Glitch damage
    if (n.type.dangerous && Math.random() < 0.25) {
      const dmg = 5;
      G.energy = Math.max(0, (G.energy || 0) - dmg);
      signalEnergyChanged();
      const lang = getLang();
      showToast(
        lang === 'de' ? '⚡ GLITCH-INTERFERENZ' : '⚡ GLITCH INTERFERENCE',
        `−${dmg}⬡`, 1000
      );
    }

    // Accumulate capture score
    n.captureScore++;

    if (n.captureScore >= CAPTURE_THRESHOLD) {
      _captureNomad(n, i);
    }
  }
}

// ── Capture resolution ────────────────────────────────────────────────────

function _captureNomad(nomad, idx) {
  nomad.captured = true;
  scene.remove(nomad.mesh);
  nomad.mesh.geometry?.dispose();
  nomad.mesh.material?.dispose();

  const lang = getLang();
  const type = nomad.type;

  if (type.symbiosis === 'spawn_memory') {
    // Archivist → convert position to a new Memory node
    const { makeNode, makeLink } = window.__layer1 || {};
    if (makeNode) {
      const memNode = makeNode(nomad.pos.clone(), false, 'memory');
      showToast(
        lang === 'de' ? '◎ ARCHIVAR ASSIMILIERT' : '◎ ARCHIVIST ASSIMILATED',
        lang === 'de' ? 'Memory-Node erschaffen' : 'Memory node created',
        2400
      );
    } else {
      // Fallback: just give a large energy bonus
      G.energy = (G.energy || 0) + 40;
      signalEnergyChanged();
      showToast(
        lang === 'de' ? '◎ ARCHIVAR ASSIMILIERT' : '◎ ARCHIVIST ASSIMILATED',
        '+40⬡', 2000
      );
    }
  } else if (type.symbiosis === '+1_per_beat') {
    // Pathfinder → switch to symbiosis mode (don't remove from array yet)
    nomad.captured  = false;
    nomad.symbiotic = true;
    nomad.captureScore = 0;
    // Dim the mesh to show it's symbiotic
    nomad.mesh.material.opacity = 0.40;
    showToast(
      lang === 'de' ? '⬡ SYMBIOSE AKTIV' : '⬡ SYMBIOSIS ACTIVE',
      lang === 'de' ? 'Pfadfinder: +1⬡/Beat' : 'Pathfinder: +1⬡/beat',
      2200
    );
    return;  // keep in array
  } else {
    // Energy reward
    const bonus = type.captureBonus || 0;
    G.energy = (G.energy || 0) + bonus;
    signalEnergyChanged();
    if (bonus > 0) {
      showToast(
        lang === 'de' ? `⬡ ${type.label.de} EINGEFANGEN` : `⬡ ${type.label.en} CAPTURED`,
        `+${bonus}⬡`, 2000
      );
    }
  }

  _nomads.splice(idx, 1);
}

// ── Visual helpers ────────────────────────────────────────────────────────

function _highlightNomad(nomad, inRange) {
  if (!nomad.mesh?.material) return;
  // Brighten ring and add outline effect when player is close
  nomad.mesh.material.emissiveIntensity = inRange ? 1.8 : undefined;  // tick will overwrite next frame
  if (inRange && !nomad._captureRing) {
    // Spawn a thin outer ring to signal "capturable"
    const geo = new THREE.TorusGeometry(0.82, 0.03, 6, 24);
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff, emissive: 0xffffff,
      emissiveIntensity: 0.6, transparent: true, opacity: 0.55,
    });
    const ring = new THREE.Mesh(geo, mat);
    nomad.mesh.add(ring);
    nomad._captureRing = ring;
  }
  if (!inRange && nomad._captureRing) {
    nomad.mesh.remove(nomad._captureRing);
    nomad._captureRing.geometry?.dispose();
    nomad._captureRing.material?.dispose();
    nomad._captureRing = null;
  }
}

function _nearestPlayerNode(pos) {
  let bestDist = Infinity;
  let bestNode = null;
  for (const n of gameNodes) {
    if (!n.pos) continue;
    const d = pos.distanceTo(n.pos);
    if (d < bestDist) { bestDist = d; bestNode = n; }
  }
  return bestNode ? { node: bestNode, dist: bestDist } : null;
}

function _randomType() {
  const pool = [];
  for (const t of Object.values(NOMAD_TYPES)) {
    for (let w = 0; w < t.weight; w++) pool.push(t);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Dispose (called on run reset) ────────────────────────────────────────

export function disposeNomads() {
  for (const n of _nomads) {
    scene.remove(n.mesh);
    n.mesh?.geometry?.dispose();
    n.mesh?.material?.dispose();
  }
  _nomads.length   = 0;
  _beatsSinceSpawn = 0;
}

// ── Nomad HUD indicator ───────────────────────────────────────────────────
// Shows active nomads with capture progress on the right edge.
// Updated from tickNomads every 12 frames (cheap DOM writes).

let _hudFrameCount = 0;
let _nomadHudEl    = null;
let _nomadHudHTML  = '';

function _ensureNomadHud() {
  if (!_nomadHudEl) {
    _nomadHudEl = document.createElement('div');
    _nomadHudEl.id = 'nomad-hud';
    document.body.appendChild(_nomadHudEl);
  }
  return _nomadHudEl;
}

export function updateNomadHUD() {
  _hudFrameCount++;
  if (_hudFrameCount % 12 !== 0) return;

  const hud  = _ensureNomadHud();
  const lang = getLang();

  if (!_nomads.length) {
    if (_nomadHudHTML !== '') {
      _nomadHudHTML = '';
      hud.innerHTML = '';
    }
    return;
  }

  const nextHTML = _nomads.map(n => {
    const pct  = Math.min(100, (n.captureScore / CAPTURE_THRESHOLD) * 100);
    const cls  = `nomad-indicator nomad-${n.type.id}${n.symbiotic ? ' nomad-symbiotic' : ''}`;
    const label = n.symbiotic
      ? (lang === 'de' ? '⬡ Symbiose' : '⬡ Symbiosis')
      : (n.type.label[lang] || n.type.label.en);
    return `
      <div class="${cls}">
        <span>${n.type.id === 'glitch' ? '⚡' : n.type.id === 'archivist' ? '◎' : n.type.id === 'pathfinder' ? '⬡' : '·'}</span>
        <span>${label}</span>
        ${!n.symbiotic ? `
        <div class="nomad-capture-bar">
          <div class="nomad-capture-fill" style="width:${pct}%"></div>
        </div>` : ''}
      </div>`;
  }).join('');

  if (nextHTML !== _nomadHudHTML) {
    _nomadHudHTML = nextHTML;
    hud.innerHTML = nextHTML;
  }
}
