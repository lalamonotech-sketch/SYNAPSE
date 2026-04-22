const LS_KEY = 'synapse_settings_v95'; // v90 key migrated on first load below

export const SETTINGS_DEFAULTS = {
  difficulty: 'normal',
  sfx: true,
  volume: 70,
  bloom: 60,
  motion: 'full',
  graphics: 'high',
  lang: 'de',
  colorblind: false,
  tactical: false,
};

export function loadSettings() {
  // One-time migration: read v90 settings key if v95 key doesn't exist yet
  try {
    const legacyRaw = localStorage.getItem('synapse_settings_v90');
    if (legacyRaw && !localStorage.getItem(LS_KEY)) {
      localStorage.setItem(LS_KEY, legacyRaw);
      localStorage.removeItem('synapse_settings_v90');
    }
  } catch (_) {}
  try {
    return { ...SETTINGS_DEFAULTS, ...(JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}) };
  } catch (_) {
    return { ...SETTINGS_DEFAULTS };
  }
}

export const synSettings = window._synSettings = window._synSettings || loadSettings();

export function saveSettings() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(synSettings)); } catch (_) {}
}

export function getLang() {
  return synSettings.lang || 'de';
}

export function getDifficulty() {
  return synSettings.difficulty || 'normal';
}

export function setDifficulty(value) {
  synSettings.difficulty = value || 'normal';
  saveSettings();
}
