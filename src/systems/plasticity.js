/**
 * SYNAPSE v98 — Synaptic Plasticity
 *
 * "The network learns from experience."
 *
 * Links are no longer static. High-traffic connections strengthen over
 * time (Long-Term Potentiation), while neglected connections weaken and
 * eventually disappear (Synaptic Pruning).
 *
 * ── Plasticity model ─────────────────────────────────────────────────────
 *
 *  _plasticityScore  — [0 .. PLAST_MAX] float per link, persists across beats.
 *
 *  Every beat:
 *    • If _signalLoad > ACTIVE_THRESHOLD  → score += STRENGTHEN_RATE
 *    • Else                               → score -= DECAY_RATE
 *    • score is clamped to [0, PLAST_MAX]
 *
 *  Level thresholds (LEVEL_THRESHOLDS array):
 *    0 → level 0  (default look)
 *    1 → level 1  ("Potentiated" — thicker, brighter)
 *    2 → level 2  ("Myelinated" — maximum speed & capacity)
 *
 *  Level-up effects (applied directly to link):
 *    Level 1: +30% capacity  (stored as link._plasticityCapBonus)
 *             +15% signal speed
 *             Opacity boost → slightly brighter
 *    Level 2: +70% capacity  (total)
 *             +35% signal speed
 *             Color shift → warm gold / cyan glow
 *
 *  Pruning:
 *    score ≤ 0 AND link has existed > MIN_LINK_AGE_BEATS
 *    → link is marked for pruning (plays a fade-out, then removeLink)
 *    Protected: links connected to the Spine root (isMain), or to a
 *    Cortex Cell node (_cortexCore), or manually built in the last
 *    PRUNE_IMMUNITY_BEATS beats.
 *
 * ── Integration ──────────────────────────────────────────────────────────
 *   heartbeat.js calls tickPlasticity() once per beat, after _routeEnergy().
 *   gameLoop.js or heartbeat.js imports + calls tickPlasticityVisuals(dt)
 *   every frame for smooth visual transitions.
 *
 * ── Epoch gate ───────────────────────────────────────────────────────────
 *   Plasticity is only active in epoch-reactive or later.
 *   In epoch-mechanical it silently no-ops.
 */

import { G }           from '../state/gameState.js';
import { gameLinks, removeLink } from '../layers/network/index.js';
import { showToast }   from '../ui/hud/index.js';
import { getLang }     from '../state/settings.js';
import { spawnShock }  from '../layers/network/index.js';

// ── Tuning ────────────────────────────────────────────────────────────────

const PLAST_MAX            = 100;
const STRENGTHEN_RATE      = 12;    // score gain per active beat
const DECAY_RATE           = 4;     // score loss per idle beat
const ACTIVE_THRESHOLD     = 2.0;   // _signalLoad must exceed this to be "active"
const LEVEL_THRESHOLDS     = [0, 35, 72]; // score needed for levels 0, 1, 2
const MIN_LINK_AGE_BEATS   = 8;     // beats before pruning is possible
const PRUNE_IMMUNITY_BEATS = 6;     // newly made links are immune this many beats

// Visual interpolation speeds
const COLOR_LERP_SPEED     = 0.04;
const OPACITY_LERP_SPEED   = 0.03;

// Level visual descriptors
const LEVEL_VISUALS = [
  { opacityBoost: 0,    colorMix: 0,   label: { de: '',               en: '' } },
  { opacityBoost: 0.18, colorMix: 0.4, label: { de: 'Potenziert',     en: 'Potentiated' } },
  { opacityBoost: 0.34, colorMix: 1.0, label: { de: 'Myelinisiert',   en: 'Myelinated' } },
];

// Plasticity glow color (gold-cyan for strengthened links)
const POTENTIATED_COLOR = 0x44ffcc;
const MYELINATED_COLOR  = 0xffdd44;

// ── Module state ──────────────────────────────────────────────────────────

let _beatCounter = 0;

// ── Helpers ───────────────────────────────────────────────────────────────

function _epochActive() {
  const body = document.body;
  return (
    body.classList.contains('epoch-reactive')  ||
    body.classList.contains('epoch-temporal')  ||
    body.classList.contains('epoch-sentience')
  );
}

function _hexToRGB(hex) {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8)  & 0xff) / 255,
    b: (hex         & 0xff) / 255,
  };
}

function _lerpColor(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function _rgbToHex(c) {
  return (
    (Math.round(c.r * 255) << 16) |
    (Math.round(c.g * 255) << 8)  |
     Math.round(c.b * 255)
  );
}

function _plasticityLevel(score) {
  if (score >= LEVEL_THRESHOLDS[2]) return 2;
  if (score >= LEVEL_THRESHOLDS[1]) return 1;
  return 0;
}

function _capacityBonus(level) {
  if (level === 2) return 0.70;
  if (level === 1) return 0.30;
  return 0;
}

function _speedBonus(level) {
  if (level === 2) return 0.35;
  if (level === 1) return 0.15;
  return 0;
}

function _isPruneProtected(lk) {
  // Protect: main/spine node connections
  if (lk.a?.isMain || lk.b?.isMain) return true;
  // Protect: cortex cell connections
  if (lk.a?._cortexCore || lk.b?._cortexCore) return true;
  // Protect: very recently created links
  const age = lk._plasticityBeat ?? 0;
  if ((_beatCounter - age) < PRUNE_IMMUNITY_BEATS) return true;
  // Protect: manually tagged (player explicitly built this beat)
  if (lk._plasticityImmune) return true;
  return false;
}

// ── Per-beat tick ─────────────────────────────────────────────────────────

export function tickPlasticity() {
  if (!_epochActive()) return;

  _beatCounter++;

  const lang = getLang();
  const toPrune = [];

  for (const lk of gameLinks) {
    // Init fields on first encounter
    if (lk._plasticityScore == null) {
      lk._plasticityScore      = 0;
      lk._plasticityLevel      = 0;
      lk._plasticityBeat       = _beatCounter;
      lk._plasticityCapBonus   = 0;
      lk._plasticitySpdBonus   = 0;
      lk._plasticityTargetOpacity = null;
      lk._plasticityTargetColor   = null;
    }

    const load = lk._signalLoad ?? 0;
    const isActive = load > ACTIVE_THRESHOLD;

    if (isActive) {
      lk._plasticityScore = Math.min(PLAST_MAX, lk._plasticityScore + STRENGTHEN_RATE);
    } else {
      lk._plasticityScore = Math.max(0, lk._plasticityScore - DECAY_RATE);
    }

    const newLevel = _plasticityLevel(lk._plasticityScore);
    const prevLevel = lk._plasticityLevel;

    // Level changed → apply effects and toast
    if (newLevel !== prevLevel) {
      lk._plasticityLevel    = newLevel;
      lk._plasticityCapBonus = _capacityBonus(newLevel);
      lk._plasticitySpdBonus = _speedBonus(newLevel);

      if (newLevel > prevLevel) {
        // Level UP
        const vis = LEVEL_VISUALS[newLevel];
        showToast(
          lang === 'de'
            ? `⬆ LINK VERSTÄRKT · ${vis.label.de}`
            : `⬆ LINK STRENGTHENED · ${vis.label.en}`,
          lang === 'de'
            ? `+${Math.round(_capacityBonus(newLevel) * 100)}% Kapazität · Netz lernt`
            : `+${Math.round(_capacityBonus(newLevel) * 100)}% capacity · network learns`,
          2200
        );
        try { spawnShock(newLevel === 2 ? 0xffdd44 : 0x44ffcc, 0); } catch (_) {}
      } else {
        // Level DOWN
        showToast(
          lang === 'de' ? '⬇ SYNAPTISCHER RÜCKGANG' : '⬇ SYNAPTIC REGRESSION',
          lang === 'de' ? 'Ungenutzte Verbindung schwächt sich ab' : 'Unused connection weakens',
          1600
        );
      }
    }

    // Pruning candidate
    if (
      lk._plasticityScore <= 0 &&
      (_beatCounter - lk._plasticityBeat) > MIN_LINK_AGE_BEATS &&
      !_isPruneProtected(lk)
    ) {
      toPrune.push(lk);
    }
  }

  // Execute pruning (splice backwards to keep indices valid)
  if (toPrune.length > 0) {
    let pruned = 0;
    for (const lk of toPrune) {
      lk._pruning = true;        // triggers fade-out in tickPlasticityVisuals
      pruned++;
    }
    if (pruned > 0) {
      showToast(
        lang === 'de' ? '✂ SYNAPTISCHES PRUNING' : '✂ SYNAPTIC PRUNING',
        lang === 'de'
          ? `${pruned} ungenutzte Verbindung${pruned > 1 ? 'en' : ''} verkümmert`
          : `${pruned} unused connection${pruned > 1 ? 's' : ''} pruned`,
        2600
      );
    }
  }
}

// ── Per-frame visual tick ─────────────────────────────────────────────────

/**
 * Call every animation frame. Smoothly animates link color/opacity
 * based on plasticity level. Also handles prune-fade-out and removal.
 */
export function tickPlasticityVisuals(dt) {
  if (!_epochActive()) return;

  const toRemove = [];

  for (let i = gameLinks.length - 1; i >= 0; i--) {
    const lk = gameLinks[i];
    if (lk._plasticityScore == null) continue;

    const score = lk._plasticityScore;
    const level = lk._plasticityLevel ?? 0;

    // ── Prune fade-out ──────────────────────────────────────────────────
    if (lk._pruning) {
      lk.mat.opacity = Math.max(0, (lk.mat.opacity ?? 0.3) - dt * 1.2);
      if (lk.mat.opacity <= 0.01) {
        toRemove.push(i);
      }
      continue;
    }

    // ── Opacity ─────────────────────────────────────────────────────────
    const baseOp   = lk.lt?.opacity ?? 0.55;
    const boost    = LEVEL_VISUALS[level]?.opacityBoost ?? 0;
    const targetOp = Math.min(0.95, baseOp + boost);
    if (lk.mat.opacity != null) {
      lk.mat.opacity += (targetOp - lk.mat.opacity) * OPACITY_LERP_SPEED;
    }

    // ── Color ───────────────────────────────────────────────────────────
    if (lk.mat.color && lk._baseColorHex != null) {
      const baseRGB  = _hexToRGB(lk._baseColorHex);
      const mix      = LEVEL_VISUALS[level]?.colorMix ?? 0;

      let targetRGB;
      if (level === 2) {
        targetRGB = _lerpColor(baseRGB, _hexToRGB(MYELINATED_COLOR), mix);
      } else if (level === 1) {
        targetRGB = _lerpColor(baseRGB, _hexToRGB(POTENTIATED_COLOR), mix);
      } else {
        targetRGB = baseRGB;
      }

      const current = lk.mat.color;
      current.r += (targetRGB.r - current.r) * COLOR_LERP_SPEED;
      current.g += (targetRGB.g - current.g) * COLOR_LERP_SPEED;
      current.b += (targetRGB.b - current.b) * COLOR_LERP_SPEED;
    }
  }

  // Remove pruned links (in reverse index order)
  for (const idx of toRemove) {
    removeLink(idx);
  }
}

// ── Capacity bonus accessor (used by heartbeat._routeEnergy) ──────────────

/**
 * Returns the effective capacity for a link, including plasticity bonus.
 * Call: getEffectiveLinkCapacity(lk, baseCapacity)
 */
export function getEffectiveLinkCapacity(lk, base) {
  const bonus = lk._plasticityCapBonus ?? 0;
  return base * (1 + bonus);
}

/**
 * Returns the signal speed multiplier for a link.
 * Used by layer1.js signal animation system.
 */
export function getPlasticitySpeedMult(lk) {
  return 1 + (lk._plasticitySpdBonus ?? 0);
}

// ── Reset (called on run restart) ─────────────────────────────────────────

export function resetPlasticity() {
  _beatCounter = 0;
  for (const lk of gameLinks) {
    delete lk._plasticityScore;
    delete lk._plasticityLevel;
    delete lk._plasticityBeat;
    delete lk._plasticityCapBonus;
    delete lk._plasticitySpdBonus;
    delete lk._plasticityTargetOpacity;
    delete lk._plasticityTargetColor;
    delete lk._pruning;
  }
}

// ── Tag newly placed links as immune ─────────────────────────────────────

/**
 * Call after makeLink() to protect the new link from immediate pruning.
 */
export function tagNewLink(lk) {
  if (!lk) return;
  lk._plasticityBeat   = _beatCounter;
  lk._plasticityImmune = true;
  // Remove immunity after PRUNE_IMMUNITY_BEATS via a timeout-free counter
  // (immunity is re-checked via _isPruneProtected each beat)
}

// ── Debug export ─────────────────────────────────────────────────────────

export const plasticity = {
  tick:          tickPlasticity,
  tickVisuals:   tickPlasticityVisuals,
  reset:         resetPlasticity,
  tagNewLink,
  getEffectiveLinkCapacity,
  getPlasticitySpeedMult,
  get beatCounter() { return _beatCounter; },
};

window.__plasticity = plasticity;
