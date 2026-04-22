import { protocolState } from '../systems/protocols.js';
import { G } from '../state/gameState.js';
import { eventMods, eliteState, gameplayFlags, triggerResonanceDebtBurst } from '../state/gameplayFlags.js';
import { TUNING } from '../state/tuning.js';
import { gameLinks, gameNodes, spawnSig, spawnShock, getEarlyGameVisualCalmness } from '../layers/network/index.js';
import {
  captureOpenClusters,
} from '../layers/meta/index.js';
import { bossHit, BOSS, bossState } from '../systems/boss.js';
import { PROFILE_BONUS, recordPulseInterval, agentOnPulse } from '../systems/ai.js';
import { checkObjectives } from './progression.js';
import { showToast, updateHUD } from '../ui/hud/index.js';
import { signalRunStateChanged } from '../platform/stateSignals.js';
import { SFX } from '../audio/sfx.js';
import { getLang } from '../state/settings.js';
import { updateCombo, onChainComplete, triggerMilestoneDraft } from '../meta/flow.js';
import { upgradeState, traitState, synergyState } from '../state/actionState.js';
import { onboarding } from '../meta/onboarding.js';
import { touchActionTime } from '../boot/activity.js';
import { getEffectivePulseCooldownBase, getEffectivePulseCost } from './balance.js';

function refresh() {
  signalRunStateChanged();
}

function shouldShowEarlyPulseShockwaves() {
  return getEarlyGameVisualCalmness() < 0.22 || gameNodes.length > 10 || gameLinks.length > 5 || (G.pulseCount || 0) > 7 || G.l3On || bossState.bossActive;
}

export function currentPulseCooldownRemaining(now = Date.now()) {
  const pulseCdBase = getEffectivePulseCooldownBase();
  const base = pulseCdBase - (now - G.pulseMs);
  const openWindows = G.l3On ? G.l3Clusters.filter(c => c.syncWindowOpen).length : 0;
  const predBonus = openWindows > 0 ? (PROFILE_BONUS?.predator?.pulseCdReduction || 0) : 0;
  const eventBonus = eventMods.pulseCdBonus || 0;
  const eventMalus = eventMods.pulseCdMalus || 0;
  const adjusted = base - Math.round(pulseCdBase * predBonus) - eventBonus + eventMalus;
  return Math.max(0, adjusted);
}


export function doPulse() {
  if (G.paused) return false;

  const now = Date.now();
  const cd = currentPulseCooldownRemaining(now);
  if (cd > 0) {
    const lang = getLang();
    showToast(
      lang === 'de' ? 'Pulse lädt' : 'Pulse charging',
      lang === 'de' ? Math.ceil(cd / 1000) + 's verbleibend' : Math.ceil(cd / 1000) + 's remaining',
      900
    );
    return false;
  }

  const cost = getEffectivePulseCost();
  if (cost > 0 && G.energy < cost) {
    const lang = getLang();
    showToast(
      lang === 'de' ? 'Zu wenig Energie' : 'Not enough energy',
      lang === 'de'
        ? `Pulse kostet ${cost}⬡ · aktuell ${Math.round(G.energy)}⬡`
        : `Pulse costs ${cost}⬡ · current ${Math.round(G.energy)}⬡`,
      1200
    );
    return false;
  }

  if ((eventMods.freePulses || 0) > 0) {
    eventMods.freePulses = Math.max(0, (eventMods.freePulses || 0) - 1);
  } else {
    G.energy -= cost;
  }

  G.pulseMs = now;
  G.pulseCount++;

  if (upgradeState.pulseEnergyBonus) G.energy += upgradeState.pulseEnergyBonus;

  if (synergyState.drainpulse) {
    let drainTotal = 0;
    gameNodes.forEach(node => {
      if (node.type !== 'memory' || !node.memCharge) return;
      const drained = Math.floor(node.memCharge * 0.30);
      if (drained <= 0) return;
      node.memCharge = Math.max(0, node.memCharge - drained);
      drainTotal += drained;
    });
    if (drainTotal > 0) {
      const gain = Math.round(drainTotal * TUNING.memoryMultiplier * (TUNING.memDischargeBonus || 1.0));
      G.energy += gain;
      G._lastMemDischarge = gain; // FIX 3.1: track for Echo Chamber
      if (gain >= 4) showToast('◉⚡ DRAIN PULSE', '+' + gain + '⬡ Memory-Drain', 900);
    }
  }

  SFX.pulse?.();
  onboarding.onPulse();
  agentOnPulse?.();

  if (eliteState.mirrorRelay?.active) {
    const state = eliteState.mirrorRelay;
    state.pulseCount++;
    if (state.pulseCount % 2 === 0 && gameLinks.length > 0) {
      const echoLink = gameLinks[Math.floor(Math.random() * gameLinks.length)];
      spawnSig(echoLink, 2.2);
      const echoGain = 3 + G.l3CapturedClusters;
      G.energy += echoGain;
      const lang = getLang();
      showToast('⟳ MIRROR ECHO', lang === 'de' ? `+${echoGain}⬡ Echo-Resonanz` : `+${echoGain}⬡ Echo Resonance`, 1200);
    }
  }

  if (eliteState.dormantFortress?.active) {
    const state = eliteState.dormantFortress;
    const idx = state.clusterIdx;
    const cluster = G.l3Clusters?.[idx]; // FIX 1.4: optional chaining for null-safety
    if (cluster?.syncWindowOpen) {
      const captured = cluster._eliteDef?.onPulseHit?.(idx);
      if (captured) {
        const lang = getLang();
        showToast('◈ STREAK ×3', lang === 'de' ? 'Festungs-Rhythmus erfüllt!' : 'Fortress rhythm fulfilled!', 2000);
        spawnShock(0x88aaff);
      }
    } else if (cluster && state.active) {
      cluster._eliteDef?.onPulseMiss?.(idx);
    }
  }

  if (eliteState.voidAnchor?.active) {
    const state = eliteState.voidAnchor;
    const idx = state.clusterIdx;
    const cluster = G.l3Clusters?.[idx];
    if (cluster && cluster._eliteActive && !cluster.captured && !cluster.syncWindowOpen) {
      cluster._eliteDef?.onPulseMiss?.(idx);
    }
  }

  if (traitState.resonanceDebt) {
    gameplayFlags.resonanceDebtPulseCount = (gameplayFlags.resonanceDebtPulseCount || 0) + 1;
    if (gameplayFlags.resonanceDebtPulseCount % 3 === 0) {
      triggerResonanceDebtBurst(400);
      gameLinks.forEach(link => {
        if (link.a.type === 'memory') link.a.memCharge = Math.max(0, (link.a.memCharge || 0) - 30);
        if (link.b.type === 'memory') link.b.memCharge = Math.max(0, (link.b.memCharge || 0) - 30);
      });
      showToast('⬡ RESONANZ-SCHULD', '3. Pulse — ×1.8 Energie · Memory −30', 1600);
      spawnShock(0xaa55ff);
    }
  }

  recordPulseInterval(now);
  touchActionTime();
  updateCombo();

  checkObjectives();

  // FIX 3.1: Echo Chamber — repeat last memory discharge at 40%
  if (upgradeState.echoChamber && G._lastMemDischarge > 0) {
    const echoGain = Math.round(G._lastMemDischarge * 0.40);
    if (echoGain > 0) {
      G.energy += echoGain;
      if (echoGain >= 3) showToast('⬢ ECHO CHAMBER', `+${echoGain}⬡ Memory-Echo`, 800);
    }
  }

  // FIX 3.2: Resonance Storm — each pulse charges memory nodes +15
  if (synergyState.resonanceStorm) {
    gameNodes.forEach(node => {
      if (node.type === 'memory') {
        node.memCharge = Math.min((node.memMax || 100), (node.memCharge || 0) + 15);
      }
    });
  }

  gameLinks.forEach(link => {
    spawnSig(link, 1.6);
    if (Math.random() > 0.4) spawnSig(link, 1.6);
  });
  if (shouldShowEarlyPulseShockwaves()) {
    spawnShock(0xffffff);
    spawnShock(0x88aaff);
    spawnShock(0x4466ff);
  }

  if (bossState.bossActive && bossState.activeBossProfile?.id === 'parasite_choir') {
    const infected = gameLinks.filter(link => link._parasiteInfected);
    if (infected.length > 0) {
      const toPurge = infected[Math.floor(Math.random() * infected.length)];
      toPurge._parasiteInfected = false;
      if (toPurge.line?.material) {
        toPurge.line.material.color.setHex(toPurge._parasiteOrigColor || 0x6688ff);
        toPurge.line.material.opacity = 0.28;
      }
      BOSS._parasitePurgeCount = (BOSS._parasitePurgeCount || 0) + 1;
      const remaining = gameLinks.filter(link => link._parasiteInfected).length;
      const target = BOSS._parasitePurgeTarget || 0;
      if ((BOSS._parasitePurgeCount || 0) >= target) {
        showToast('⬡ NETZ GEREINIGT', 'Alle Links gesäubert · Fenster öffnet sich!', 2000);
        spawnShock(0x88ff44);
      } else {
        showToast('⬡ LINK GEREINIGT', remaining + ' infizierte Links verbleiben', 1400);
      }
    }
  }

  if (bossState.bossActive && bossHit()) {
    refresh();
    return true;
  }

  const dormant = G.l3Clusters.find(cluster => cluster._dormant);
  if (dormant) {
    dormant._dormant = false;
    dormant.captured = true;
    G.l3CapturedClusters = Math.min(8, G.l3CapturedClusters + 1);
    showToast('KERN GEWECKT', 'Dormanter Cluster reaktiviert', 2000);
    spawnShock(0x6699ff);
    refresh();
    return true;
  }

  if (G.l3On) {
    if (eliteState.phantomNexus?.active) {
      const state = eliteState.phantomNexus;
      const phantomCluster = G.l3Clusters[state.clusterIdx];
      if (phantomCluster?.syncWindowOpen && !phantomCluster.captured) {
        const allowed = phantomCluster._eliteDef?.onPulseAttempt?.(state.clusterIdx);
        if (!allowed) {
          phantomCluster._phantomBlocked = true;
          const wasOpen = phantomCluster.syncWindowOpen;
          phantomCluster.syncWindowOpen = false;
          captureOpenClusters();
          phantomCluster.syncWindowOpen = wasOpen;
          phantomCluster._phantomBlocked = false;
          updateHUD();
          refresh();
          return true;
        }
      }
    }

    // Overcharge — deduct extra cost before capture if conditions allow
    let overchargeUsed = false;
    if (upgradeState.overcharge && !bossState.bossActive && G.energy >= cost) {
      G.energy -= cost; // second cost (total is now 2x)
      overchargeUsed = true;
    }

    const captured = captureOpenClusters();

    // Overcharge second capture — force-capture one syncReady (not yet open) cluster
    if (overchargeUsed && !G.runWon) {
      const lang = getLang();
      const extraTarget = G.l3Clusters.find(cl => !cl.captured && !cl.syncWindowOpen && cl.syncReady);
      if (extraTarget) {
        extraTarget.syncWindowOpen = true;
        const extraCaptured = captureOpenClusters();
        if (extraCaptured > 0) {
          spawnShock(0xff9900);
          spawnShock(0xff6600);
          showToast('⚡⚡ OVERCHARGE', lang === 'de' ? `×2 Kosten · Bonus-Cluster erfasst!` : `×2 cost · Bonus cluster captured!`, 2200);
        } else {
          // refund the extra cost if no bonus cluster was available
          G.energy += cost;
          showToast('⚡⚡ OVERCHARGE', lang === 'de' ? 'Kein Bonus-Fenster · Energie zurück' : 'No bonus window · Energy refunded', 1600);
        }
      } else {
        // refund if no syncReady cluster available for second hit
        G.energy += cost;
        showToast('⚡⚡ OVERCHARGE', lang === 'de' ? 'Kein Ziel · Energie zurück' : 'No target · Energy refunded', 1600);
      }
    }

    if (captured > 0) {
      // Temporal Protocol — halve next pulse CD on perfect hit (early window)
      if (protocolState.activeProtocol?.modifiers?.temporalComboReward) {
        const windowAge = G.l3Clusters.reduce((best, cl) => {
          if (cl.captured && cl.lastSyncOpen > 0) {
            const age = (Date.now() / 1000) - cl.lastSyncOpen;
            return Math.min(best, age);
          }
          return best;
        }, Infinity);
        const earlyHitThreshold = (G.l3SyncWindowDur || 5) * 0.30;
        if (windowAge !== Infinity && windowAge < earlyHitThreshold) {
          G.pulseCd = Math.max(1200, Math.round(G.pulseCd * 0.5));
          G.pulseMs = now - G.pulseCd + 1200;
          showToast('⏱ TEMPORAL COMBO', 'Perfekter Treffer · Pulse-CD halbiert', 1600);
          spawnShock(0x00ddff);
        }
      }
      // Hunt Instinct — pulse CD temp boost after capture
      if (traitState.huntInstinct) {
        const origCd = G.pulseCd;
        G.pulseCd = Math.max(800, Math.round(G.pulseCd * 0.55));
        setTimeout(() => { G.pulseCd = origCd; }, 5000);
        showToast('◉ HUNT INSTINCT', 'Pulse-CD −45% für 5s', 1200);
      }
      if (captured > 1) onChainComplete(captured);
      if (eventMods.bonusCapture) {
        eventMods.bonusCapture = false;
        G.energy += 60;
        showToast('BONUS CAPTURE!', '+60⬡ Bonus-Übernahme!', 2400);
        spawnShock(0xddff44);
      }
      SFX.capture?.();
      if (!overchargeUsed) showToast('PULSE + CAPTURE', captured + ' Cluster synchronisiert', 2200);
      if (G.l3CapturedClusters === 1) triggerMilestoneDraft('Erster Cluster übernommen!');
      if (G.l3CapturedClusters === 4) triggerMilestoneDraft('Halbzeit — 4 Cluster!');
    } else if (upgradeState.noMissedPulseCost) {
      G.energy += cost;
      showToast('PULSE · KEIN FENSTER', 'Energie zurück (Präzisionssynapse)', 1800);
    } else {
      showToast('PULSE', 'Signalwelle ausgelöst', 1800);
    }
  } else if (upgradeState.noMissedPulseCost) {
    G.energy += cost;
    showToast('PULSE · KEIN L3', 'Energie zurück (Präzisionssynapse)', 1800);
  } else {
    showToast('PULSE', 'Signalwelle ausgelöst', 1800);
  }

  refresh();
  return true;
}

