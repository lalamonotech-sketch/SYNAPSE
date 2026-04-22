/**
 * SYNAPSE v98 — Scene Setup
 *
 * Owns the Three.js renderer, camera, scene, and EffectComposer.
 * Exports refs consumed by gameLoop.js, layers/, and dispose.js.
 */

import * as THREE from 'three';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { regListener }     from '../registries/listenerRegistry.js';

// ── Scene ──────────────────────────────────────────────────────────────────
export const scene = new THREE.Scene();

// ── Camera ─────────────────────────────────────────────────────────────────
export const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(1.5, 2.0, 18); // slight angle for immediate depth impression

// ── Renderer ───────────────────────────────────────────────────────────────
export const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // slightly lower cap: big fill-rate win with limited clarity loss
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

// ── Lights ─────────────────────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0x111e33, 1.2); // darker ambient = more contrast
scene.add(ambientLight);

const pLight = new THREE.PointLight(0x3366cc, 1.8, 45); // cooler, less intense key light
pLight.position.set(0, 8, 5);
scene.add(pLight);

const wLight = new THREE.PointLight(0xffeecc, 0.35, 70); // warm fill from below
wLight.position.set(0, -10, 8);
scene.add(wLight);

const rimLight = new THREE.PointLight(0x2244aa, 0.6, 30); // rim light for depth cueing
rimLight.position.set(-12, 3, -4);
scene.add(rimLight);

// ── Orbit Controls ─────────────────────────────────────────────────────────
export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.06;
controls.enableZoom     = true;
controls.minDistance    = 6;
controls.maxDistance    = 35;
controls.enablePan      = false;
controls.autoRotate     = false;

// ── Post-processing: Bloom ─────────────────────────────────────────────────
// P-04: Adaptive bloom — caller in gameLoop can skip every 2nd frame in calm state
export const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.95,   // strength (was 1.15) — less global bloom, more targeted
  0.32,   // radius   (was 0.42) — tighter halos, less bleed
  0.65    // threshold (was 0.58) — only genuinely bright elements bloom
);
export const renderPass = new RenderPass(scene, camera);

export const comp = new EffectComposer(renderer);
comp.addPass(renderPass);
comp.addPass(bloomPass);

// ── Shared base geometries ─────────────────────────────────────────────────
// These are SHARED across all node meshes — dispose only on full scene teardown.
export const GS  = new THREE.SphereGeometry(1, 26, 18);   // full-size nodes — lighter segment count
export const GS2 = new THREE.SphereGeometry(.11, 10, 8); // signal dots — lighter segment count

// ── Scene groups (one per layer) ───────────────────────────────────────────
export const microGroup = new THREE.Group(); scene.add(microGroup); // Layer 1
export const tGroup     = new THREE.Group(); scene.add(tGroup);     // Layer 2
export const macGroup   = new THREE.Group(); scene.add(macGroup);   // Layer 3
export const fxGroup    = new THREE.Group(); scene.add(fxGroup);    // pooled billboard FX

// ── Clock ──────────────────────────────────────────────────────────────────
export const clock = new THREE.Clock();

// ── Resize handler ─────────────────────────────────────────────────────────
regListener(window, 'resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  comp.setSize(w, h);
  bloomPass.setSize(w, h);
});

// ── Material helper ────────────────────────────────────────────────────────
/**
 * Create a standard node material.
 * @param {number} color   - hex colour
 * @param {number} emissive - hex emissive colour
 * @param {number} emissiveIntensity
 * @returns {THREE.MeshLambertMaterial}
 */
const _presentationState = { calmness: 0 };

function _lerp(a, b, t) {
  return a + (b - a) * t;
}

export function applyPresentationProfile(calmness = 0) {
  const target = Math.max(0, Math.min(1, calmness || 0));
  _presentationState.calmness += (target - _presentationState.calmness) * 0.08;
  const k = _presentationState.calmness;

  bloomPass.strength = _lerp(0.95, 0.40, k);   // updated base
  bloomPass.radius = _lerp(0.32, 0.18, k);
  bloomPass.threshold = _lerp(0.65, 0.76, k);
  renderer.toneMappingExposure = _lerp(1.1, 0.96, k);
  ambientLight.intensity = _lerp(1.2, 0.95, k);
  pLight.intensity = _lerp(1.8, 1.35, k);
  wLight.intensity = _lerp(0.35, 0.22, k);
}

export function mkMat(color, emissive, emissiveIntensity) {
  return new THREE.MeshLambertMaterial({
    color,
    emissive,
    emissiveIntensity,
    transparent: true,
    opacity: 1,
  });
}

// ── Legacy window bridges (dispose.js + debug console access) ─────────────
window._scene    = scene;
window._camera   = camera;
window._renderer = renderer;
window._comp     = comp;
