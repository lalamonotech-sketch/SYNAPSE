/**
 * SYNAPSE — Layer 1 constants
 *
 * Pure data: node/link type tables, color palettes, opacity tables and
 * early-game pacing thresholds. Extracted from layer1.js so visual tweaks
 * are findable and the renderer module can stay focused on pipeline code.
 *
 * NO side effects. NO THREE imports. Safe to import from anywhere.
 */

export const NT = {
  source:    { cost: 0,  label: 'Source',    labelDe: 'Quelle',     color: 0xdd4422, em: 0xff3300, ei: 1.4, tip: '+1⬡/5s passiv · Basisenergie' },
  relay:     { cost: 5,  label: 'Relay',     labelDe: 'Relais',     color: 0x22ccaa, em: 0x00ddaa, ei: 1.2, tip: '×1.8 Signalspeed' },
  amplifier: { cost: 8,  label: 'Amplifier', labelDe: 'Verstärker', color: 0x99cc22, em: 0x88dd00, ei: 1.2, tip: '×2 Energie' },
  memory:    { cost: 10, label: 'Memory',    labelDe: 'Speicher',   color: 0xaa33dd, em: 0xcc22ff, ei: 1.4, tip: 'Lädt & entlädt' },
  catalyst:  { cost: 15, label: 'Catalyst',  labelDe: 'Katalysator', color: 0xff5533, em: 0xff8844, ei: 1.6, tip: 'Empfang → +Speed für Nachbar-Signale' },
};

export const LT = {
  stable:    { cost: 0, label: 'Stabil',    labelDe: 'Stabil',       color: 0x4466cc, sc: 0x8899ee, spd: 1.0,  em: 1.0, brk: 0,      lw: 1.0, tip: 'Solide · kein Abbruch' },
  fast:      { cost: 5, label: 'Schnell',   labelDe: 'Schnell',      color: 0x11ddcc, sc: 0x44ffee, spd: 2.4,  em: 0.7, brk: 0,      lw: 0.8, tip: '×2.4 Geschwindigkeit' },
  resonance: { cost: 4, label: 'Resonanz',  labelDe: 'Resonanz',     color: 0x8844ee, sc: 0xaa66ff, spd: 0.85, em: 1.8, brk: 0,      lw: 1.6, tip: '×1.8 Energie · ×2.4 im Dreieck' },
  fragile:   { cost: 0, label: 'Fragil',    labelDe: 'Zerbrechlich', color: 0xcc8811, sc: 0xeeaa44, spd: 1.5,  em: 0.9, brk: 0.0009, lw: 0.6, tip: 'Bricht unter Last' },
  phase:     { cost: 3, label: 'Phasen',    labelDe: 'Phasen-Link',  color: 0x44ffaa, sc: 0x88ffcc, spd: 1.8,  em: 1.2, brk: 0,      lw: 1.1, tip: '2s aktiv · 1s pausiert · Signale nur im Fenster' },
};

export const NODE_TYPE_KEYS = ['source', 'relay', 'amplifier', 'memory'];
export const SIG_TYPE_KEYS = ['stable', 'fast', 'resonance', 'fragile'];

export const NODE_BASE_COLORS = {
  core: 0xff9955,
  source: 0xdd4422,
  relay: 0x22ccaa,
  amplifier: 0x99cc22,
  memory: 0xaa33dd,
  catalyst: 0xff5533,
};

export const NODE_TYPE_EMISSIVE = {
  core: 0xff5522,
  source: 0xff2222,
  relay: 0x00ddaa,
  amplifier: 0x88dd00,
  memory: 0xaa11ee,
  catalyst: 0xff8844,
};

export const NODE_SOFT_BASE_COLORS = {
  core: 0xe8996a,
  source: 0xc4614a,
  relay: 0x4ab8a8,
  amplifier: 0x8ab830,
  memory: 0x9040c0,
  catalyst: 0xee6633,
};

export const NODE_SOFT_EMISSIVE = {
  core: 0xff8844,
  source: 0xdd5533,
  relay: 0x33bbaa,
  amplifier: 0x88cc11,
  memory: 0xaa33ee,
};

export const LINK_BASE_COLORS = {
  stable:    0x4466cc,
  fast:      0x11ddcc,
  resonance: 0x8844ee,
  fragile:   0xcc8811,
};

export const LINK_SOFT_COLORS = {
  stable:    0x6688cc,
  fast:      0x55cccc,
  resonance: 0xaa77ee,
  fragile:   0xbb9933,
};

export const SIGNAL_BASE_OPACITY = {
  stable:    0.82,
  fast:      0.90,
  resonance: 0.86,
  fragile:   0.70,
};

export const SIGNAL_SOFT_OPACITY = {
  stable:    0.46,
  fast:      0.50,
  resonance: 0.52,
  fragile:   0.38,
};

// Early-game visual calmness thresholds (used by getEarlyGameVisualCalmness)
export const EARLY_GAME_LOOK_NODE_MAX = 14;
export const EARLY_GAME_LOOK_LINK_MAX = 6;
export const EARLY_GAME_LOOK_PULSE_MAX = 8;
export const EARLY_GAME_LOOK_TIME_MAX = 75;

// Renderer scaling / hysteresis defaults
export const NODE_INSTANCE_HYSTERESIS = 6;
export const NODE_INSTANCE_THRESHOLD_DEFAULT = 32;
export const NODE_INSTANCE_CAPACITY_DEFAULT = 256;
export const LINK_BATCH_CAPACITY_DEFAULT = 512;
export const SIGNAL_BATCH_CAPACITY_DEFAULT = 256;
export const CURVE_LINK_CAPACITY_DEFAULT = 256;
export const FLOW_BATCH_CAPACITY_DEFAULT = 512;
export const FLOW_SEGS = 10;

// Curve/afterglow pacing
export const AFTERGLOW_DURATION = 4.0;
export const CURVE_STRENGTH = 0.55;
export const CURVE_SEGMENTS = 6;

export const FLOW_SPEED = {
  stable:    0.28,
  fast:      0.80,
  resonance: 0.42,
  fragile:   0.55,
  phase:     0.35,
};
