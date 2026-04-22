import { G } from '../state/gameState.js';
import { eventMods } from '../state/gameplayFlags.js';
import { aiState } from '../state/aiShared.js';

export function getEarlyPulseDiscount() {
  if (G.l2On || G.l3On) return 0;
  if ((G.pulseCount || 0) >= 3) return 0;
  return 4;
}

export function getEffectivePulseCost() {
  if ((eventMods.freePulses || 0) > 0) return 0;
  // FIX 8.1: Scale pulse cost with cluster count (12⬡ at 0-2 clusters, 18⬡ at 3-6, 22⬡ at 7-8)
  // This makes early L3 more accessible and late L3 appropriately costly.
  let scaledCost = G.pulseCost;
  if (G.l3On) {
    const cap = G.l3CapturedClusters || 0;
    if (cap <= 2) scaledCost = Math.min(scaledCost, 12);
    else if (cap <= 6) scaledCost = 18;
    else scaledCost = 22;
  }
  return Math.max(2, scaledCost - getEarlyPulseDiscount());
}

export function getEarlyPulseCooldownBonus() {
  if (G.l2On || G.l3On) return 0;
  if ((G.pulseCount || 0) >= 3) return 0;
  return 1200;
}

export function getEffectivePulseCooldownBase() {
  return Math.max(1200, G.pulseCd - getEarlyPulseCooldownBonus());
}

export function getEarlyTrainDiscount() {
  if (G.l2On || G.l3On) return 0;
  if ((aiState.trainingRuns || 0) > 0) return 0;
  return Math.max(0, G.trainCost - 6);
}

export function getEffectiveTrainCost() {
  return Math.max(2, G.trainCost - getEarlyTrainDiscount());
}

export function getEarlyGameSupportSummary(lang = 'de') {
  const parts = [];
  const pulseDiscount = getEarlyPulseDiscount();
  const pulseCdBonus = getEarlyPulseCooldownBonus();
  const trainDiscount = getEarlyTrainDiscount();
  if (pulseDiscount > 0) parts.push(lang === 'de' ? `erste Pulse −${pulseDiscount}⬡` : `first pulses −${pulseDiscount}⬡`);
  if (pulseCdBonus > 0) parts.push(lang === 'de' ? `Pulse schneller` : `faster pulse cooldown`);
  if (trainDiscount > 0) parts.push(lang === 'de' ? `erstes Training −${trainDiscount}⬡` : `first training −${trainDiscount}⬡`);
  return parts.join(' · ');
}
