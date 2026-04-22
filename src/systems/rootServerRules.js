/**
 * Shared Root Server purchase rules.
 *
 * Centralising these avoids drift between the UI in rootServer.js and the
 * hard purchase validation in awakening.js.
 */

export const ROOT_UPGRADE_REQUIRES = {
  startWithRelay: [],
  mnemonic_research: [],
  spine_daemons: [],
  // assimilation_bank and persistent_seed are intentionally disabled
  // for the release build.
  expanded_canvas: ['startWithRelay'],
};

export const ROOT_UPGRADE_PROTOCOL_GATES = {
  mnemonic_research: 'mnemonic',
  spine_daemons: 'spine',
};

export const PROTOCOL_UNLOCK_RUNS = {
  phantom: 0,
  spine: 0,
  temporal: 2,
  mnemonic: 4,
};

export function isProtocolGateUnlocked(protocolId, totalRuns = 0) {
  if (!protocolId) return true;
  return (totalRuns || 0) >= (PROTOCOL_UNLOCK_RUNS[protocolId] ?? 0);
}

export function protocolGateLabel(protocolId, lang = 'en', totalRuns = 0) {
  const needed = PROTOCOL_UNLOCK_RUNS[protocolId] ?? 0;
  if ((totalRuns || 0) >= needed) return '';
  if (lang === 'de') {
    return `Verfügbar mit ${protocolId.toUpperCase()} (${needed} Runs nötig)`;
  }
  return `Available with ${protocolId.toUpperCase()} (${needed} runs required)`;
}
