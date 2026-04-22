import { getLang } from '../state/settings.js';
import { regTimer } from '../registries/timerRegistry.js';

const LS_KEY = 'synapse_onboarding_v98';

const STEP_DEFS = [
  {
    id: 'epoch_i',
    icon: '◌',
    titleDe: 'Das Netz schläft noch',
    titleEn: 'The network is dormant',
    subDe: 'Epoche I: Das System ist auf Minimum reduziert. Nur Sources und Verbindungen stehen dir zur Verfügung. Baue Energie auf — das Netz erwacht von selbst.',
    subEn: 'Epoch I: The system is stripped to its core. Only sources and connections are available. Build energy — the network wakes on its own.',
  },
  {
    id: 'protocol',
    icon: '◈',
    titleDe: 'Protokoll gewählt',
    titleEn: 'Protocol selected',
    subDe: 'Jedes Protokoll schaltet andere Systeme frei. Predator baut schnell, Mnemonic forscht, Spine hält durch.',
    subEn: 'Each protocol unlocks different systems. Predator builds fast, Mnemonic researches, Spine endures.',
  },
  {
    id: 'node',
    icon: '◉',
    titleDe: 'Ersten Knoten setzen',
    titleEn: 'Place your first node',
    subDe: 'Starte mit Sources. Memory, Amplifier und Relay schalten sich frei wenn das Netz genug Energie erreicht.',
    subEn: 'Start with sources. Memory, Amplifier, and Relay unlock as the network gains energy.',
  },
  {
    id: 'link',
    icon: '↔',
    titleDe: 'Verbindungen ziehen',
    titleEn: 'Connect the network',
    subDe: 'Das Netz atmet jetzt selbst — jeder Beat produziert Energie. Verbinde gezielt, überlaste keine Links.',
    subEn: "The network breathes on its own — each beat produces energy. Connect with intent, don't overload links.",
  },
  {
    id: 'tri',
    icon: '△',
    titleDe: 'Dreieck erzeugen',
    titleEn: 'Create a triangle',
    subDe: 'Ein Dreieck ist der erste echte Schub. Darauf früh aktiv hinarbeiten.',
    subEn: 'A triangle is your first real spike. Aim for it early and the network rewards you.',
  },
  {
    id: 'heartbeat',
    icon: '⬡',
    titleDe: 'Das Netz erwacht',
    titleEn: 'The network awakens',
    subDe: 'Bei 1000⬡ Spitzenenergie: Epoche II. Das HUD öffnet sich. Forschung, Daemons und mehr werden sichtbar.',
    subEn: 'At 1000⬡ peak energy: Epoch II. The HUD opens up. Research, Daemons, and more become visible.',
  },
  {
    id: 'research',
    icon: '◬',
    titleDe: 'Forschung läuft',
    titleEn: 'Research active',
    subDe: 'Memory-Nodes erzeugen ◬ Data. Investiere in Projekte — sie schalten Amplifier, schnellere Links und mehr frei.',
    subEn: 'Memory nodes generate ◬ Data. Invest in projects — they unlock Amplifiers, faster links, and more.',
  },
  {
    id: 'elite',
    icon: '★',
    titleDe: 'Elite-Signatur erkannt',
    titleEn: 'Elite signature detected',
    subDe: 'Ab hier zählt Fokus: offene Fenster zuerst, dann Backbone und Fusion. Das Netz denkt bald selbst.',
    subEn: 'From here on, focus matters. Open windows first, then backbone and fusion. The network is almost sentient.',
  },
];

const stepIndexById = Object.fromEntries(STEP_DEFS.map((step, index) => [step.id, index]));

function el(id) {
  return document.getElementById(id);
}

function loadDismissed() {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch (_) { return false; }
}

function saveDismissed(value) {
  try {
    if (value) localStorage.setItem(LS_KEY, '1');
    else localStorage.removeItem(LS_KEY);
  } catch (_) {}
}

export const onboardingState = window.__synOnboardingState || (window.__synOnboardingState = {
  dismissed: loadDismissed(),
  active: false,
  currentStep: 0,
  completed: {},
});

function syncLegacy() {
  window.__synOnboardingState = onboardingState;
}

function isGameplayVisible() {
  return document.getElementById('hud')?.style.display !== 'none';
}

function renderStep(index = onboardingState.currentStep) {
  const card = el('onboard-card');
  const body = el('ob-body');
  if (!card || !body) return;

  const step = STEP_DEFS[Math.max(0, Math.min(STEP_DEFS.length - 1, index))];
  const lang = getLang();
  const title = lang === 'de' ? step.titleDe : step.titleEn;
  const sub = lang === 'de' ? step.subDe : step.subEn;

  body.classList.add('ob-fade');
  regTimer('onboardingStepFade', setTimeout(() => {
    const iconNode = el('ob-icon');
    const titleNode = el('ob-title');
    const subNode = el('ob-sub');
    const tagNode = el('ob-tag');
    if (iconNode) iconNode.textContent = step.icon;
    if (titleNode) titleNode.textContent = title;
    if (subNode) subNode.textContent = sub;
    if (tagNode) tagNode.textContent = `${index + 1} / ${STEP_DEFS.length}`;
    body.classList.remove('ob-fade');
  }, 110), 'timeout');

  STEP_DEFS.forEach((entry, i) => {
    const dot = el(`ob-d${i}`);
    if (!dot) return;
    dot.classList.toggle('ob-done', !!onboardingState.completed[entry.id]);
    dot.classList.toggle('ob-active', i === index && !onboardingState.completed[entry.id]);
  });
}

function showCard() {
  const card = el('onboard-card');
  if (!card) return;
  card.classList.remove('ob-hide');
  card.classList.add('vis');
}

function hideCard() {
  const card = el('onboard-card');
  if (!card) return;
  card.classList.remove('vis');
  card.classList.add('ob-hide');
}

function firstIncompleteIndex() {
  const index = STEP_DEFS.findIndex(step => !onboardingState.completed[step.id]);
  return index === -1 ? STEP_DEFS.length - 1 : index;
}

export function openOnboarding(force = false) {
  if (!force && (onboardingState.dismissed || !isGameplayVisible())) return false;
  onboardingState.active = true;
  onboardingState.currentStep = firstIncompleteIndex();
  renderStep(onboardingState.currentStep);
  showCard();
  syncLegacy();
  return true;
}

export function closeOnboarding(markDismissed = false) {
  onboardingState.active = false;
  if (markDismissed) {
    onboardingState.dismissed = true;
    saveDismissed(true);
  }
  hideCard();
  syncLegacy();
}

export function resetOnboardingRuntime() {
  onboardingState.active = false;
  onboardingState.currentStep = 0;
  if (!onboardingState.dismissed) onboardingState.completed = {};
  hideCard();
  syncLegacy();
}

export function maybeAdvanceOnboarding(stepId) {
  const idx = stepIndexById[stepId];
  if (idx == null || onboardingState.dismissed) return false;

  onboardingState.completed[stepId] = true;
  const nextIndex = firstIncompleteIndex();
  const done = STEP_DEFS.every(step => onboardingState.completed[step.id]);

  if (done) {
    onboardingState.currentStep = STEP_DEFS.length - 1;
    renderStep(onboardingState.currentStep);
    regTimer('onboardingCompleteClose', setTimeout(() => closeOnboarding(true), 1400), 'timeout');
    return true;
  }

  onboardingState.currentStep = nextIndex;
  openOnboarding(true);
  return true;
}

export const onboarding = {
  open: () => openOnboarding(true),
  skip: () => closeOnboarding(true),
  reset: resetOnboardingRuntime,
  onEpochI:   () => maybeAdvanceOnboarding('epoch_i'),
  onProtocol: () => maybeAdvanceOnboarding('protocol'),
  onNode:     () => maybeAdvanceOnboarding('node'),
  onMemory:   () => maybeAdvanceOnboarding('node'),
  onLink:     () => maybeAdvanceOnboarding('link'),
  onTri:      () => maybeAdvanceOnboarding('tri'),
  onPulse:    () => maybeAdvanceOnboarding('heartbeat'),   // remapped: pulse → heartbeat step
  onHeartbeat:() => maybeAdvanceOnboarding('heartbeat'),
  onResearch: () => maybeAdvanceOnboarding('research'),
  onElite:    () => maybeAdvanceOnboarding('elite'),
};

export function initOnboarding() {
  syncLegacy();
  if (!onboardingState.dismissed) {
    onboardingState.currentStep = firstIncompleteIndex();
    renderStep(onboardingState.currentStep);
  }
}

