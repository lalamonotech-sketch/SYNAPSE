import { G } from '../../state/gameState.js';
import { gameNodes } from '../../layers/network/index.js';
import { showToast } from '../../ui/hud/index.js';
import { getLang } from '../../state/settings.js';
import { notifyCortexFormed as notifyCortexFormedFx } from '../fx/visualEnhancer.js';
import { triggerAwakeningGlitch } from './dom.js';

const EVOLUTION_THRESHOLD_ENERGY = 1000;
const CORTEX_SYNERGY_DIST = 3.5;
const CORTEX_SYNERGY_DIST_SQ = CORTEX_SYNERGY_DIST * CORTEX_SYNERGY_DIST;
let evolutionDraftOpen = false;

const EVOLUTIONS = {
  source: [
    { id: 'pulsing', label: { de: 'Pulsing Source', en: 'Pulsing Source' }, desc: { de: 'AoE-Energie beim Tick', en: 'AoE energy on tick' }, color: '#ff6644' },
    { id: 'deep', label: { de: 'Deep Source', en: 'Deep Source' }, desc: { de: 'Konstant, langsam, robust', en: 'Constant, slow, robust' }, color: '#4488ff' },
  ],
  memory: [
    { id: 'archive', label: { de: 'Archive Memory', en: 'Archive Memory' }, desc: { de: '×2 Wissens-Output', en: '×2 knowledge output' }, color: '#aa44ff' },
    { id: 'volatile', label: { de: 'Volatile Memory', en: 'Volatile Memory' }, desc: { de: 'Schnellere Verarbeitung, fragil', en: 'Faster processing, fragile' }, color: '#ffcc00' },
  ],
};

export function getEvolutionThresholdEnergy() {
  return EVOLUTION_THRESHOLD_ENERGY;
}

export function checkNodeEvolution(node) {
  if (!node || !node._id) return;
  if (G.awakening?.nodeEvolutions?.[node._id]) return;
  const options = EVOLUTIONS[node._type];
  if (!options) return;
  showEvolutionDraft(node, options);
}

function showEvolutionDraft(node, options) {
  if (evolutionDraftOpen) return;
  evolutionDraftOpen = true;

  const lang = getLang();
  const overlay = document.createElement('div');
  overlay.id = 'evolution-overlay';
  overlay.className = 'evolution-overlay';
  overlay.innerHTML = `
    <div class="evo-box">
      <div class="evo-title">◈ NODE MUTATION</div>
      <div class="evo-sub">${lang === 'de'
        ? 'Dieser Node hat genug Energie verarbeitet, um zu mutieren.'
        : 'This node has processed enough energy to mutate.'}</div>
      <div class="evo-cards">
        ${options.map((option, index) => `
          <div class="evo-card" data-evo-idx="${index}" style="--evo-color:${option.color}">
            <div class="evo-card-name">${option.label[lang] || option.label.en}</div>
            <div class="evo-card-desc">${option.desc[lang] || option.desc.en}</div>
          </div>`).join('')}
      </div>
    </div>`;

  overlay.addEventListener('click', (event) => {
    const card = event.target.closest('.evo-card');
    if (!card) return;
    const index = parseInt(card.dataset.evoIdx, 10);
    applyNodeEvolution(node, options[index]);
    overlay.remove();
    evolutionDraftOpen = false;
  }, { once: true });

  document.body.appendChild(overlay);
}

function applyNodeEvolution(node, evolution) {
  if (!G.awakening || !evolution) return;
  G.awakening.nodeEvolutions[node._id] = evolution.id;
  node._evolution = evolution.id;

  if (evolution.id === 'pulsing') {
    node._aoeEnergy = true;
    node._aoePulseRadius = 2.5;
  } else if (evolution.id === 'deep') {
    node._deepSource = true;
    node._sourceRateBonus = 0.5;
  } else if (evolution.id === 'archive') {
    node._archiveMemory = true;
    node._knowledgeMult = 2.0;
  } else if (evolution.id === 'volatile') {
    node._volatileMemory = true;
    node._refinementSpeed = 2.0;
    node._fragile = true;
  }

  if (node.m?.material?.color) {
    const { r, g, b } = hexToRgb(evolution.color);
    node.m.material.color.setRGB(r, g, b);
  }

  const lang = getLang();
  showToast(
    lang === 'de' ? `◈ MUTATION: ${evolution.label.de}` : `◈ MUTATION: ${evolution.label.en}`,
    lang === 'de' ? evolution.desc.de : evolution.desc.en,
    2200
  );
}

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

export function detectMacroStructures() {
  if (!G.awakening) return;

  const memories = [];
  const amplifiers = [];
  for (let i = 0; i < gameNodes.length; i++) {
    const node = gameNodes[i];
    if (node._type === 'memory') memories.push(node);
    else if (node._type === 'amplifier') amplifiers.push(node);
  }

  const existing = new Set();
  for (let i = 0; i < G.awakening.macroStructures.length; i++) {
    existing.add(G.awakening.macroStructures[i].id);
  }

  const newCells = [];
  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i];
    const ampIds = [];
    const mx = memory.m.position.x;
    const my = memory.m.position.y;

    for (let j = 0; j < amplifiers.length && ampIds.length < 4; j++) {
      const amp = amplifiers[j];
      const dx = amp.m.position.x - mx;
      const dy = amp.m.position.y - my;
      if ((dx * dx + dy * dy) > CORTEX_SYNERGY_DIST_SQ) continue;
      ampIds.push(amp._id);
    }

    if (ampIds.length < 4) continue;
    const id = `cortex_${memory._id}`;
    if (existing.has(id)) continue;

    newCells.push({ id, type: 'cortex', coreId: memory._id, ampIds });
    memory._cortexCore = true;
    for (let j = 0; j < 4; j++) {
      const ampId = ampIds[j];
      for (let k = 0; k < amplifiers.length; k++) {
        if (amplifiers[k]._id === ampId) amplifiers[k]._cortexMember = true;
      }
    }

    const lang = getLang();
    showToast(
      lang === 'de' ? '✦ CORTEX-ZELLE GEBILDET' : '✦ CORTEX CELL FORMED',
      lang === 'de' ? 'Memory + 4 Amplifier haben verschmolzen' : 'Memory + 4 Amplifiers have merged',
      2800
    );
    triggerAwakeningGlitch(['stats-row', 'active-projects-hud']);
    try { notifyCortexFormedFx(memory); } catch (_) {}
  }

  if (newCells.length) G.awakening.macroStructures.push(...newCells);
  return G.awakening.macroStructures;
}
