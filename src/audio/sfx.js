/**
 * SYNAPSE v98 — SFX Layer
 *
 * Web Audio API only — zero external files required.
 * AudioContext is created lazily on first user interaction (iOS safe).
 * iOS 15 resume guard: retries on touchstart if context is suspended.
 */

let _ctx     = null;
let _enabled = true;
let _vol     = 0.28; // conservative master gain
let _resumeRetryArmed = false;

// ── AudioContext helper ───────────────────────────────────────────────────

function ctx() {
  if (!_ctx) {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { _enabled = false; return null; }
      _ctx = new Ctor();
    } catch (e) {
      // AudioContext blocked (Safari private mode, locked policies, etc.)
      // Disable SFX permanently this session and surface a single banner.
      _enabled = false;
      try {
        import('../platform/safeAudio.js').then(m => m.checkAudioHealth());
      } catch (_) {}
      return null;
    }
  }
  if (_ctx.state === 'suspended') {
    _ctx.resume().catch(() => {
      // FIX S-02: iOS 15 guard — retry on next touchstart
      if (_resumeRetryArmed) return;
      _resumeRetryArmed = true;
      const retry = () => {
        _ctx?.resume?.().catch(() => {}).finally(() => { _resumeRetryArmed = false; });
      };
      document.addEventListener('touchstart', retry, { once: true, passive: true });
    });
  } else {
    _resumeRetryArmed = false;
  }
  return _ctx;
}

// ── Low-level primitives ──────────────────────────────────────────────────

function beep(freq, type, durMs, volMult, delayMs) {
  if (!_enabled || _vol <= 0) return;
  try {
    const ac  = ctx();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.connect(g);
    g.connect(ac.destination);
    osc.type            = type || 'sine';
    osc.frequency.value = freq;
    const now = ac.currentTime + (delayMs || 0) / 1000;
    const vol = _vol * (volMult || 1);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durMs / 1000);
    osc.start(now);
    osc.stop(now + durMs / 1000 + 0.02);
  } catch (_) {}
}

function chord(freqs, type, durMs, vol) {
  freqs.forEach((f, i) => beep(f, type, durMs, vol, i * 40));
}

// ── Public API ────────────────────────────────────────────────────────────

export const SFX = {
  enable()  { _enabled = true; },
  disable() { _enabled = false; },
  setVolume(v) { _vol = Math.max(0, Math.min(1, v)); },
  getVolume()  { return _vol; },

  pulse()    { chord([220, 330, 440], 'sine',     140, 0.55); },
  capture()  { chord([440, 550, 660], 'triangle', 200, 0.45); },
  sync()     { beep(880, 'sine', 120, 0.6); setTimeout(() => beep(1100, 'sine', 100, 0.5), 80); },
  train()    { chord([330, 440],       'sine',     180, 0.4); },
  draft()    { beep(660, 'triangle',   120, 0.45); },

  bossTelegraph() {
    chord([110, 130, 155], 'sawtooth', 600, 0.35);
    setTimeout(() => beep(80, 'square', 400, 0.3), 300);
  },

  vuln() {
    beep(1320, 'sine', 80, 0.7);
    setTimeout(() => beep(1760, 'sine', 120, 0.6), 60);
  },

  winT1() { chord([440, 550, 660, 880], 'sine',     500, 0.5); },
  winT2() { chord([440, 550, 660, 880], 'triangle', 600, 0.55); setTimeout(() => chord([880, 1100], 'sine', 400, 0.4), 300); },
  winT3() {
    chord([440, 550, 660, 880, 1100], 'sine', 700, 0.6);
    setTimeout(() => chord([880, 1100, 1320], 'triangle', 500, 0.5), 250);
    setTimeout(() => beep(1760, 'sine', 800, 0.4), 600);
  },

  nodePlace() { beep(330, 'triangle', 80,  0.3); },
  linkPlace()  { beep(220, 'sine',    100, 0.25); },
  error()      { beep(110, 'square',  120, 0.4); },

  // v95: Sync window audio cues
  syncReady()  {
    // Gentle rising tone — sync window about to open
    beep(550, 'sine', 80, 0.35);
    setTimeout(() => beep(660, 'sine', 100, 0.3), 70);
  },
  syncWarn()   {
    // Increasingly urgent: called repeatedly 5s before window opens
    beep(330, 'triangle', 120, 0.25);
    setTimeout(() => beep(440, 'triangle', 80, 0.2), 90);
  },

  // v95: Entropy Field boss decay sound
  entropyDecay() {
    beep(80, 'sawtooth', 300, 0.3);
    setTimeout(() => beep(60, 'sawtooth', 400, 0.25), 150);
  },

  // v95: Catalyst node trigger
  catalystTrigger() {
    beep(880, 'triangle', 60, 0.3);
    setTimeout(() => beep(1100, 'sine', 80, 0.25), 40);
  },
};

// ── Backwards-compat global ────────────────────────────────────────────────
window.SFX = SFX;
