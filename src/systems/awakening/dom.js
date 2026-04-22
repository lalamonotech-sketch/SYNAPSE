import { G } from '../../state/gameState.js';
import { getLang } from '../../state/settings.js';

const _awakeningDom = Object.create(null);
let _epochBadgeEl = null;
let _epochBadgeText = '';

export function getAwakeningDom(id) {
  const cached = _awakeningDom[id];
  if (cached && document.body.contains(cached)) return cached;
  const node = document.getElementById(id);
  if (node) _awakeningDom[id] = node;
  return node;
}

export function setAwakeningDom(id, node) {
  if (node) _awakeningDom[id] = node;
}

export function triggerAwakeningGlitch(ids) {
  for (let i = 0; i < ids.length; i++) {
    const el = getAwakeningDom(ids[i]);
    if (!el) continue;
    el.classList.remove('v96-ui-glitch');
    void el.offsetWidth;
    el.classList.add('v96-ui-glitch');
    setTimeout(() => el.classList.remove('v96-ui-glitch'), 450);
  }
}

export function updateEpochBadge(epochs) {
  if (!_epochBadgeEl || !document.body.contains(_epochBadgeEl)) {
    _epochBadgeEl = getAwakeningDom('v97-epoch-badge');
  }
  if (!_epochBadgeEl) {
    _epochBadgeEl = document.createElement('div');
    _epochBadgeEl.id = 'v97-epoch-badge';
    _epochBadgeEl.className = 'v97-epoch-badge';
    const topbar = getAwakeningDom('stats-row') || document.body;
    topbar.prepend(_epochBadgeEl);
    setAwakeningDom('v97-epoch-badge', _epochBadgeEl);
  }

  const epoch = epochs[G.awakening?.epochIndex || 0];
  const lang = getLang();
  const nextText = epoch ? (epoch.label[lang] || epoch.label.en) : '';
  if (nextText !== _epochBadgeText) {
    _epochBadgeText = nextText;
    _epochBadgeEl.textContent = nextText;
  }
}

export function resetAwakeningDomCache() {
  _epochBadgeEl = null;
  _epochBadgeText = '';
  for (const key of Object.keys(_awakeningDom)) delete _awakeningDom[key];
}
