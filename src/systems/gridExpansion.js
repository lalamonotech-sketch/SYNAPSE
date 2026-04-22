/**
 * SYNAPSE v98 — Grid Expansion System
 *
 * When the player kills the first boss AND has unlocked the
 * "expanded_canvas" Root Server upgrade, the playfield
 * expands from a ~10×10 world-unit zone to a ~50×50 zone.
 *
 * Visual treatment:
 *   1. A "firewall breach" glitch runs for 1.2s.
 *   2. The camera animates outward (Z: 18 → 52) with an ease-out curve.
 *   3. The placement radius in input.js expands (placeSphere radius 22 → 46).
 *   4. A new Three.js GridHelper (faint) replaces or supplements the old one.
 *   5. Sector "biome" overlays (corrupted / resonance / data-ocean) populate
 *      the outer ring — purely cosmetic in v98, mechanical hooks for v99.
 *
 * Integration:
 *   - Call triggerGridExpansion() from boss.js / metaFlow.js after boss kill
 *     when rootServer.upgrades.expanded_canvas is true.
 *   - tickGridExpansion(t, dt) must be called each frame from gameLoop.js.
 *
 * State persisted to G.awakening.gridExpanded (boolean).
 */

import * as THREE from 'three';
import { G }         from '../state/gameState.js';
import { camera, scene, controls } from '../engine/scene.js';
import { showToast } from '../ui/hud/index.js';
import { getLang }   from '../state/settings.js';
import { getRootServer } from './awakening.js';
import { _triggerGlitch } from './awakening.js';

// ── Constants ──────────────────────────────────────────────────────────────
const SMALL_GRID_RADIUS  = 22;   // original placeSphere radius
const LARGE_GRID_RADIUS  = 46;   // post-expansion radius
const SMALL_CAM_Z        = 18;
const LARGE_CAM_Z        = 52;
const TRANSITION_DURATION = 3.2; // seconds

// ── Module state ──────────────────────────────────────────────────────────
let _expanding    = false;
let _expanded     = false;
let _transStart   = -1;
let _gridHelper   = null;
let _biomeMarkers = [];

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Trigger the grid expansion sequence.
 * Safe to call multiple times — no-ops if already expanded.
 */
export function triggerGridExpansion() {
  if (_expanded || _expanding) return;

  const rs = getRootServer?.() || {};
  if (!rs.upgrades?.expanded_canvas) {
    // Not unlocked yet — still show a hint
    const lang = getLang();
    showToast(
      lang === 'de' ? '⬡⬡ Grid-Erweiterung gesperrt' : '⬡⬡ Grid Expansion Locked',
      lang === 'de' ? 'Kaufe "Erweitertes Canvas" im Root Server' : 'Buy "Expanded Canvas" in Root Server',
      2200
    );
    return;
  }

  _expanding  = true;
  _transStart = -1;   // will be set on first tickGridExpansion call after trigger

  // 1. Glitch effect
  if (typeof _triggerGlitch === 'function') {
    _triggerGlitch(['stats-row', 'active-projects-hud', 'ctrl-dock']);
  }
  document.body.classList.add('v96-ui-glitch');
  setTimeout(() => document.body.classList.remove('v96-ui-glitch'), 1200);

  // 2. Toast
  const lang = getLang();
  showToast(
    lang === 'de' ? '💥 FIREWALL GEBROCHEN' : '💥 FIREWALL BREACHED',
    lang === 'de' ? 'Das Grid expandiert…' : 'The grid is expanding…',
    3500
  );

  if (G.awakening) G.awakening.gridExpanded = true;
}

/**
 * Per-frame tick — drives the camera animation and biome spawn.
 * Call from gameLoop._gameUpdate().
 */
export function tickGridExpansion(t) {
  if (!_expanding && !_expanded) return;

  if (_expanding) {
    if (_transStart < 0) _transStart = t;

    const elapsed  = t - _transStart;
    const progress = Math.min(1, elapsed / TRANSITION_DURATION);
    const eased    = _easeOutCubic(progress);

    // Animate camera Z outward
    const targetZ = SMALL_CAM_Z + (LARGE_CAM_Z - SMALL_CAM_Z) * eased;
    camera.position.z = targetZ;

    // Expand OrbitControls max distance
    controls.maxDistance = SMALL_CAM_Z + (LARGE_CAM_Z + 10 - SMALL_CAM_Z) * eased;

    // Gradually update placement sphere via global (picked up by input.js)
    window._gridExpansionRadius = SMALL_GRID_RADIUS + (LARGE_GRID_RADIUS - SMALL_GRID_RADIUS) * eased;

    if (progress >= 1) {
      _expanding = false;
      _expanded  = true;
      window._gridExpansionRadius = LARGE_GRID_RADIUS;
      controls.maxDistance = LARGE_CAM_Z + 12;
      _spawnExpandedGrid();
      _spawnBiomeMarkers();
      const lang = getLang();
      showToast(
        lang === 'de' ? '⬡⬡ Grid: 50×50 aktiv' : '⬡⬡ Grid: 50×50 active',
        lang === 'de' ? 'Neue Sektoren entdeckt' : 'New sectors discovered',
        2800
      );
    }
  }
}

export function isGridExpanded() { return _expanded; }

// ── Visual helpers ─────────────────────────────────────────────────────────

function _spawnExpandedGrid() {
  // Remove old grid helper if present
  if (_gridHelper) { scene.remove(_gridHelper); _gridHelper.dispose?.(); }

  // Outer faint grid — 50 divisions, 100 world-unit size
  const grid = new THREE.GridHelper(100, 50, 0x0a1a2e, 0x0d2040);
  grid.rotation.x = Math.PI / 2;  // lay flat in XY plane (we work in XY, not XZ)
  grid.material.opacity    = 0.18;
  grid.material.transparent = true;
  scene.add(grid);
  _gridHelper = grid;
}

function _spawnBiomeMarkers() {
  // Scatter a handful of glowing "biome indicator" sprites in the outer ring
  const BIOMES = [
    { color: 0xff4400, label: 'corrupted',  count: 4 },
    { color: 0x44ffcc, label: 'resonance',  count: 3 },
    { color: 0x2244ff, label: 'data-ocean', count: 2 },
  ];

  BIOMES.forEach(biome => {
    for (let i = 0; i < biome.count; i++) {
      const angle  = Math.random() * Math.PI * 2;
      const radius = 28 + Math.random() * 18;  // outer ring only
      const x      = Math.cos(angle) * radius;
      const y      = Math.sin(angle) * radius;

      const geo  = new THREE.SphereGeometry(0.45, 8, 6);
      const mat  = new THREE.MeshLambertMaterial({
        color:             biome.color,
        emissive:          biome.color,
        emissiveIntensity: 0.7,
        transparent:       true,
        opacity:           0.55,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, 0);
      mesh.userData.biome = biome.label;
      scene.add(mesh);
      _biomeMarkers.push(mesh);
    }
  });

  // Mount CSS labels for biome markers (projected each frame would be expensive;
  // spawn once near their screen positions instead via a one-shot projection)
  setTimeout(() => _projectBiomeLabels(), 400);
}

function _projectBiomeLabels() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  _biomeMarkers.forEach(mesh => {
    const vec = mesh.position.clone().project(camera);
    const sx  = (vec.x * 0.5 + 0.5) * w;
    const sy  = (-vec.y * 0.5 + 0.5) * h;
    // Only label markers currently visible on screen
    if (sx < 0 || sx > w || sy < 0 || sy > h) return;

    const label = document.createElement('div');
    label.className  = 'biome-label biome-' + mesh.userData.biome;
    label.textContent = mesh.userData.biome.replace('-', '\u00A0');
    label.style.cssText = `left:${sx + 8}px;top:${sy}px`;
    document.body.appendChild(label);
    // Labels are static after first spawn — remove if grid collapses (shouldn't happen in v98)
  });
}

function _easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// ── Dispose ────────────────────────────────────────────────────────────────
export function disposeGridExpansion() {
  if (_gridHelper) { scene.remove(_gridHelper); _gridHelper = null; }
  _biomeMarkers.forEach(m => { scene.remove(m); m.geometry?.dispose(); m.material?.dispose(); });
  _biomeMarkers = [];
  _expanding = false;
  _expanded  = false;
  window._gridExpansionRadius = SMALL_GRID_RADIUS;
}

// ── Window bridge (boss.js calls this after first kill) ──────────────────
window._triggerGridExpansion = triggerGridExpansion;
