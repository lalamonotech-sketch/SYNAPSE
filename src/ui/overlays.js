import { getLang } from '../state/settings.js';
import { regTimer, clearTimer } from '../registries/timerRegistry.js';

/**
 * SYNAPSE v95 — overlay helpers
 * Phase H migration pass.
 */

const PROTOCOL_SIGNATURES = {
  phantom: {
    cssClass: 'proto-sig-phantom',
    color: 'rgba(200,80,255,.85)',
    textDE: '◈  PHANTOM PROTOCOL  ◈',
    textEN: '◈  PHANTOM PROTOCOL  ◈',
    subDE: 'Verschleierung aktiv',
    subEN: 'Deception active',
  },
  spine: {
    cssClass: 'proto-sig-spine',
    color: 'rgba(255,210,60,.9)',
    textDE: '▲  SPINE PROTOCOL  ▲',
    textEN: '▲  SPINE PROTOCOL  ▲',
    subDE: 'Backbone initialisiert',
    subEN: 'Backbone initialised',
  },
  temporal: {
    cssClass: 'proto-sig-temporal',
    color: 'rgba(80,220,255,.9)',
    textDE: '⬡  TEMPORAL PROTOCOL  ⬡',
    textEN: '⬡  TEMPORAL PROTOCOL  ⬡',
    subDE: 'Sync-Fenster erweitert',
    subEN: 'Sync windows widened',
  },
  mnemonic: {
    cssClass: 'proto-sig-mnemonic',
    color: 'rgba(180,100,255,.9)',
    textDE: '⟳  MNEMONIC PROTOCOL  ⟳',
    textEN: '⟳  MNEMONIC PROTOCOL  ⟳',
    subDE: 'Memory-Kernel geladen',
    subEN: 'Memory kernel loaded',
  },
};

// Hot-path DOM cache. Boss HUD updates can happen every frame during the
// encounter; avoid repeated getElementById/querySelectorAll traffic and skip
// redundant DOM writes where possible.
const _overlayDom = {
  protoChip: null,
  protoSigOverlay: null,
  protoSigBanner: null,
  protocolOverlay: null,
  protocolConfirm: null,
  bossName: null,
  bossIntroSub: null,
  bossHudName: null,
  bossHudLabel: null,
  bossIntroPhaseNote: null,
  bossScreen: null,
  bossIntroBox: null,
  bossHud: null,
  bossVulnBar: null,
  bossHpFill: null,
  bossHpVal: null,
  bossPhaseLbl: null,
  bossEncStatus: null,
  bossVulnTitle: null,
  bossVulnFill: null,
  bossAttackFlash: null,
  bossPhaseDots: null,
};

const _bossHudCache = {
  hpWidth: '',
  hpValue: '',
  phaseText: '',
  phaseClass2: false,
  phaseClass3: false,
  statusText: '',
  vulnClass: false,
  dotStates: [],
};

function _dom(key, id) {
  return _overlayDom[key] || (_overlayDom[key] = document.getElementById(id));
}

function _bossDots() {
  if (!_overlayDom.bossPhaseDots) {
    _overlayDom.bossPhaseDots = Array.from(document.querySelectorAll('#boss-phase-dots .bpd'));
  }
  return _overlayDom.bossPhaseDots;
}

function _setText(node, next) {
  if (!node) return;
  const value = next == null ? '' : String(next);
  if (node.textContent !== value) node.textContent = value;
}

export function updateProtocolChipUI(proto, lang = getLang()) {
  const chip = _dom('protoChip', 'proto-chip');
  if (!chip || !proto) return;
  _setText(chip, lang === 'de' ? proto.tagDe : proto.tagEn);
  chip.style.setProperty('--proto-color', proto.hudColor || proto.color || 'rgba(120,220,255,.85)');
  chip.classList.add('vis');
}

export function triggerProtocolSignatureUI(protoId, lang = getLang()) {
  const overlay = _dom('protoSigOverlay', 'proto-sig-overlay');
  const banner = _dom('protoSigBanner', 'proto-sig-banner');
  if (!overlay || !banner) return;

  const sig = PROTOCOL_SIGNATURES[protoId];
  if (!sig) return;
  const isDE = lang === 'de';

  overlay.innerHTML = '';
  const flash = document.createElement('div');
  flash.className = 'proto-sig-flash ' + sig.cssClass;
  overlay.appendChild(flash);

  banner.innerHTML =
    `<div style="color:${sig.color};text-shadow:0 0 24px ${sig.color}">${isDE ? sig.textDE : sig.textEN}</div>` +
    `<div style="font-size:.55em;letter-spacing:4px;opacity:.6;margin-top:4px">${isDE ? sig.subDE : sig.subEN}</div>`;
  banner.classList.remove('show');
  void banner.offsetWidth;
  banner.classList.add('show');

  const chip = _dom('protoChip', 'proto-chip');
  if (chip) {
    chip.classList.remove('proto-intro');
    void chip.offsetWidth;
    chip.classList.add('proto-intro');
  }

  clearTimer('protocolSignatureOverlayHide');
  regTimer('protocolSignatureOverlayHide', setTimeout(() => {
    overlay.innerHTML = '';
    banner.classList.remove('show');
    clearTimer('protocolSignatureOverlayHide');
  }, 3000), 'timeout');
}

export function showProtocolOverlayUI({ totalRuns = 0, unlockRules = {}, lang = 'de', defaultId = 'spine' } = {}) {
  const overlay = _dom('protocolOverlay', 'protocol-overlay');
  if (!overlay) return;

  document.querySelectorAll('.proto-card').forEach(card => {
    card.classList.remove('selected', 'locked');
    const id = card.dataset.protocolId;
    const rule = unlockRules[id];
    if (!rule) return;

    let hint = card.querySelector('.proto-unlock-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'proto-unlock-hint';
      card.appendChild(hint);
    }

    const runsNeeded = Math.max(0, (rule.runs || 0) - totalRuns);
    const locked = runsNeeded > 0;
    card.classList.toggle('locked', locked);
    hint.textContent = locked
      ? (lang === 'de'
        ? `Noch ${runsNeeded} Run${runsNeeded !== 1 ? 's' : ''} benötigt`
        : `${runsNeeded} more run${runsNeeded !== 1 ? 's' : ''} needed`)
      : (lang === 'de' ? rule.labelDE : rule.labelEN);
  });

  _dom('protocolConfirm', 'protocol-confirm')?.classList.remove('ready');
  overlay.classList.add('show');
  markProtocolSelectionUI(defaultId);
}

export function markProtocolSelectionUI(id) {
  document.querySelectorAll('.proto-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.protocolId === id);
  });
  _dom('protocolConfirm', 'protocol-confirm')?.classList.add('ready');
}

export function closeProtocolOverlayUI() {
  _dom('protocolOverlay', 'protocol-overlay')?.classList.remove('show');
}

export function setBossProfileUI(profile) {
  if (!profile) return;

  const nameEl = _dom('bossName', 'boss-name');
  const subEl = _dom('bossIntroSub', 'boss-intro-sub');
  const hudNameEl = _dom('bossHudName', 'boss-hud-name');
  const hudLabelEl = _dom('bossHudLabel', 'boss-hud-label');
  const phaseNoteEl = _dom('bossIntroPhaseNote', 'boss-intro-phase-note');

  const _lang = getLang();
  _setText(nameEl, profile.name);
  _setText(subEl, (_lang === 'en' && profile.subEN) ? profile.subEN : profile.sub);
  _setText(hudNameEl, profile.name);
  _setText(hudLabelEl, _lang === 'en' ? '◈ Synaptic Network · Threat' : '◈ Synaptic Network · Bedrohung');
  _setText(phaseNoteEl, _lang === 'en' ? 'Phase 1 · 3 phases · Hit vulnerability windows' : 'Phase 1 · 3 Phasen · Treffe Verwundbarkeits-Fenster');

  document.body.classList.remove('boss-profile-ghost', 'boss-profile-sigma', 'boss-profile-vortex', 'boss-profile-parasite');
  const bodyClass = {
    ghost_matrix: 'boss-profile-ghost',
    sigma_recursive: 'boss-profile-sigma',
    vortex_architect: 'boss-profile-vortex',
    parasite_choir: 'boss-profile-parasite',
  }[profile.id];
  if (bodyClass) document.body.classList.add(bodyClass);

  const hud = _dom('bossHud', 'boss-hud');
  hud?.classList.remove('profile-ghost', 'profile-sigma', 'profile-vortex', 'profile-parasite');
  const hudClass = {
    ghost_matrix: 'profile-ghost',
    sigma_recursive: 'profile-sigma',
    vortex_architect: 'profile-vortex',
    parasite_choir: 'profile-parasite',
  }[profile.id];
  if (hudClass) hud?.classList.add(hudClass);
}

export function showBossIntroUI() {
  const screen = _dom('bossScreen', 'boss-screen');
  const box = _dom('bossIntroBox', 'boss-intro-box');
  if (screen) screen.classList.add('intro');
  if (box) {
    box.style.display = 'flex';
    clearTimer('bossIntroShowFx');
    regTimer('bossIntroShowFx', setTimeout(() => {
      box.classList.add('show');
      clearTimer('bossIntroShowFx');
    }, 80), 'timeout');
  }
}

export function transitionBossFightUI() {
  const screen = _dom('bossScreen', 'boss-screen');
  const box = _dom('bossIntroBox', 'boss-intro-box');
  box?.classList.remove('show');
  clearTimer('bossIntroTransition');
  regTimer('bossIntroTransition', setTimeout(() => {
    if (box) box.style.display = 'none';
    screen?.classList.remove('intro');
    screen?.classList.add('active');
    clearTimer('bossIntroTransition');
  }, 0), 'timeout');
}

export function hideBossUI() {
  clearTimer('bossIntroShowFx');
  clearTimer('bossIntroTransition');
  clearTimer('bossHudShow');
  clearTimer('bossAttackFlash');
  _dom('bossScreen', 'boss-screen')?.classList.remove('intro', 'active');
  _dom('bossIntroBox', 'boss-intro-box')?.classList.remove('show');
  const hud = _dom('bossHud', 'boss-hud');
  hud?.classList.remove('vis', 'enc-vuln');
  if (hud) hud.style.display = 'none';
  _dom('bossVulnBar', 'boss-vuln-bar')?.classList.remove('show');
}

export function setBossHudVisible(visible) {
  const hud = _dom('bossHud', 'boss-hud');
  if (!hud) return;
  if (visible) {
    hud.style.display = 'block';
    clearTimer('bossHudShow');
    regTimer('bossHudShow', setTimeout(() => {
      hud.classList.add('vis');
      clearTimer('bossHudShow');
    }, 50), 'timeout');
  } else {
    hud.classList.remove('vis', 'enc-vuln');
    hud.style.display = 'none';
  }
}

export function updateBossHUDUI({ hp, maxHP, phase, vulnOpen }) {
  const fill = _dom('bossHpFill', 'boss-hp-fill');
  const val = _dom('bossHpVal', 'boss-hp-val');
  const phaseEl = _dom('bossPhaseLbl', 'boss-phase-lbl');
  const status = _dom('bossEncStatus', 'boss-enc-status');
  const dots = _bossDots();
  const hud = _dom('bossHud', 'boss-hud');
  const pct = maxHP > 0 ? Math.max(0, Math.min(100, (hp / maxHP) * 100)) : 0;
  const _lang = getLang();

  const nextWidth = pct + '%';
  const nextValue = Math.round(pct) + '%';
  if (fill && _bossHudCache.hpWidth !== nextWidth) {
    _bossHudCache.hpWidth = nextWidth;
    fill.style.width = nextWidth;
  }
  if (val && _bossHudCache.hpValue !== nextValue) {
    _bossHudCache.hpValue = nextValue;
    val.textContent = nextValue;
  }
  if (phaseEl) {
    const nextPhaseText = _lang === 'en'
      ? (phase <= 1 ? 'Phase 1 · Fend off attacks' : phase === 2 ? 'Phase 2 · Pressure rising' : 'Phase 3 · Final escalation')
      : (phase <= 1 ? 'Phase 1 · Angriff abwehren' : phase === 2 ? 'Phase 2 · Druck steigt' : 'Phase 3 · Finale Eskalation');
    if (_bossHudCache.phaseText !== nextPhaseText) {
      _bossHudCache.phaseText = nextPhaseText;
      phaseEl.textContent = nextPhaseText;
    }
    const isPhase2 = phase === 2;
    const isPhase3 = phase >= 3;
    if (_bossHudCache.phaseClass2 !== isPhase2) {
      _bossHudCache.phaseClass2 = isPhase2;
      phaseEl.classList.toggle('phase-2', isPhase2);
    }
    if (_bossHudCache.phaseClass3 !== isPhase3) {
      _bossHudCache.phaseClass3 = isPhase3;
      phaseEl.classList.toggle('phase-3', isPhase3);
    }
  }
  const nextStatus = vulnOpen
    ? (_lang === 'en' ? 'VULNERABILITY OPEN' : 'SCHWACHSTELLE OFFEN')
    : (_lang === 'en' ? 'ATTACK PHASE' : 'ANGRIFFSPHASE');
  if (status && _bossHudCache.statusText !== nextStatus) {
    _bossHudCache.statusText = nextStatus;
    status.textContent = nextStatus;
  }
  const activeIdx = Math.max(0, phase - 1);
  dots.forEach((dot, idx) => {
    const nextState = `${idx < activeIdx ? 1 : 0}:${idx === activeIdx ? 1 : 0}`;
    if (_bossHudCache.dotStates[idx] === nextState) return;
    _bossHudCache.dotStates[idx] = nextState;
    dot.classList.toggle('bpd-done', idx < activeIdx);
    dot.classList.toggle('bpd-active', idx === activeIdx);
  });
  if (hud && _bossHudCache.vulnClass !== !!vulnOpen) {
    _bossHudCache.vulnClass = !!vulnOpen;
    hud.classList.toggle('enc-vuln', !!vulnOpen);
  }
}

export function setBossVulnerabilityUI({ open, title = 'VULNERABILITY', frac = 1 }) {
  const bar = _dom('bossVulnBar', 'boss-vuln-bar');
  const titleEl = _dom('bossVulnTitle', 'boss-vuln-title');
  const fill = _dom('bossVulnFill', 'boss-vuln-fill');
  if (open) bar?.classList.add('show');
  else bar?.classList.remove('show');
  _setText(titleEl, title);
  if (fill) fill.style.width = Math.max(0, Math.min(100, frac * 100)) + '%';
}

export function flashBossAttackUI() {
  const flash = _dom('bossAttackFlash', 'boss-attack-flash');
  flash?.classList.add('show');
  clearTimer('bossAttackFlash');
  regTimer('bossAttackFlash', setTimeout(() => {
    flash?.classList.remove('show');
    clearTimer('bossAttackFlash');
  }, 180), 'timeout');
}

