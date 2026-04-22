# Synapse v98 — The Awakening Update

A premium network-building puzzle game built with Three.js and Vite.

## Quick Start

```bash
npm install
npm run dev
```

Then open the URL shown in the terminal (default: http://localhost:5173).

## Build

```bash
npm install
npm run build
# Output in dist/public/

# Optionally set a custom port (for dev/preview):
PORT=3000 npm run dev
```

> **Note:** `PORT` is optional — defaults to `5173` if not set.

## Environment Variables

| Variable    | Required | Description                                |
|-------------|----------|--------------------------------------------|
| `PORT`      | No       | Dev/preview server port (default: `5173`)  |
| `BASE_PATH` | No       | URL base path (default `/`)                |

## Architecture

| Layer | File | Responsibility |
|-------|------|----------------|
| Rendering | `src/layers/network/layer1.js` | Node/link/signal mesh + batching |
| Layer 2 | `src/layers/bridge/layer2.js` | Bridge / backbone logic |
| Layer 3 | `src/layers/meta/layer3.js` | Cluster capture + sync windows |
| State | `src/state/` | Tuning, game state, save system |
| Systems | `src/systems/` | Boss, AI, events, protocols, heartbeat, awakening, rootServer |
| Runtime | `src/meta/` + `src/boot/` | Meta-flow, input, HUD |

## Visual Ruleset

| Signal | Meaning |
|--------|---------|
| **Color** | Node/link type + Epoch palette (`--s4-accent`) |
| **Glow intensity** | Activity level + Heartbeat sync |
| **Ring/Shell** | Role (spine, selected, over-cap, Cortex Cell) |
| **Pulse** | Emergency tool (Space, 30s cooldown) |
| **Line style** | Connection type + bottleneck heatmap |

## What's New in v98 — The Awakening Update

### Heartbeat System (`src/systems/heartbeat.js`)
- Global tick every 2s replaces manual Pulse as primary energy source
- `Space` is now an **Emergency Pulse** (30s cooldown)
- Energy routing per link capacity — overflow creates bottleneck heatmap
- Upkeep costs: Amplifier/Memory cost 2⬡/beat, Catalyst 3⬡/beat
- Brownout system: 3-beat grace before nodes go dark
- **Node Evolution**: at 1000⬡ produced, Sources/Memory unlock mutation draft
- **Cortex Cell**: Memory + 4 adjacent Amplifiers fuse into an aura-radiating super-node

### Epoch Progression (`src/systems/awakening.js`)
Four epochs that progressively reveal the UI:

| Epoch | Trigger | Unlocks |
|---|---|---|
| I · Mechanical | Start | Minimal HUD (Source + Connect only) |
| II · Reactive | 1000⬡ peak | Stats row, Research panel, Diagnostics |
| III · Temporal | First Memory placed | AI HUD, Run History, Daemons |
| IV · Sentience | Boss assimilated | Full palette + Ascension effect |

- **Glitch-Reveal**: every UI element appears with a `.v96-ui-glitch` clip animation
- **Epoch palettes**: `--s4-accent` shifts from dark-blue → cyan → violet → pink-white
- **Daemon System**: Repair / Builder / Optimizer daemons run per-beat

### Root Server (`src/systems/rootServer.js`)
Persistent meta-progression between runs:
- Earn **Awakening Points (AP)** at run end (Epoch × 2 + bonuses)
- 6 upgrades (5–25 AP): Starting Relay, Mnemonic Research, Spine Daemons, Assimilation Bank, Persistent Seed, Extended Canvas
- Toggle panel with **Shift+R** in-game or from Title Screen
- Save key: `syn_awakening_v98` (auto-migrated from v97)

### Research System (`src/systems/research.js`)
- Active from Epoch II via `#active-projects-hud`
- Memory nodes generate ◬ Data per heartbeat
- Projects unlock new mechanics (Relay speed, Amplifier protocol, etc.)
- Completed research contributes AP bonus at run end

### Genetic Memory (Sprint 4)
- Requires Root Server upgrade `persistent_seed`
- After a win, save up to 1 Memory/Amplifier/Cortex cluster
- Saved cluster spawns as a **Ruin** at the start of the next run (+25 ◬ Data on reactivation)

### Hotkeys (v98)

| Key | Function |
|---|---|
| `P` | Place mode |
| `C` | Connect mode |
| `1–5` | Node type: Source · Relay · Amplifier · Memory · Catalyst |
| `Space` | **Emergency Pulse** (30s cooldown) |
| `T` | Train AI |
| `A` | Toggle Auto-Router (Epoch III+) |
| `B` | Toggle Blueprint / Highway build mode |
| `Shift+R` | Toggle Root Server panel |
| `L` | Toggle Diagnose Lens |
| `Shift+L` | Toggle Tactical View (no bloom/glow) |
| `Ctrl+Z` | Rewind network ~10s |
| `R` | Restart (after win or fail screen) |
| `Esc` | Pause / Close overlay |

## Dev Notes

- `window.SFX`, `window.gameNodes`, `window.gameLinks` bridges are intentional
  backwards-compat shims — do not remove until all callers are migrated to ES imports.
- All localStorage access goes through `src/platform/safeStorage.js` — this surfaces a
  dismissible banner when storage is blocked (Incognito / strict privacy mode).
- `__DEV__` is injected by Vite — use it to gate verbose logging.
- `__BUILD_TIME__` and `__COMMIT_SHA__` are baked in at build time and rendered in
  `#build-meta` (bottom of Title Screen / Settings).
- `window.SYNAPSE_BUILD.launchedAt` is a **runtime** timestamp (page start).
- `prefers-reduced-motion` is respected both in CSS (`body.reduce-motion`) and in JS
  (`_reduceMotion` flag in `cameraFX.js` disables idle drift).

## Refactor Pass 5 — Modularisation (release-prep)

The largest monolith files have been split into focused submodules. Behaviour
is unchanged; the original entry files re-export the moved primitives so
existing import sites continue to work.

| Original | Lines before | Lines after | New submodules |
|---|---:|---:|---|
| `src/layers/network/layer1.js` | 2480 | 2368 | `_constants.js` (NT/LT, palettes, capacities), `_shaders.js` (link + flow GLSL) |
| `src/ui/hud/hud.js` | 1073 | 929 | `_domCache.js` (THRESHOLDS, `el`, `initDOMCache`, cached writers, `fmtE`), `_notify.js` (toasts, condition chip, tip, layer/phase headers) |
| `src/meta/screens.js` | 918 | 879 | `_runHistory.js` (LS keys, retention cap, `escapeHtml`, `loadRunHistory`, `saveRunHistory`, `invalidateRunHistoryCache`) |

Why these splits matter:
- **Findability** — colour palettes, GLSL strings and DOM-id whitelists used to
  be buried mid-file. They now live in dedicated, well-commented modules.
- **Cold-start cost** — pure data modules (`_constants.js`, `_shaders.js`,
  `_runHistory.js`) have zero side effects, so tree-shakers can keep them out
  of bundles that don't need them.
- **Backwards compatibility** — every public symbol that moved is re-exported
  from its original file, so no caller needs updating.

Verified: `node --check` passes on every `.js` file under `src/` (128 files).

## Known Architectural Debt (tracked, non-blocking)

- **Global window surface** (~199 `window.*` assignments across `compat.js`, `layer1/3.js`, `ai.js`, `boss.js`).
  Prefer ES module imports; reduce toward zero over time.
- **CSS fragmentation**: `sprint2/3/4.css` + multiple `premium-*.css` and `hud-*.css` layers
  cause specificity wars (heavy `!important` use). Consolidation planned post-v98.
- **Google Fonts** are loaded from CDN. For fully offline/GDPR-compliant builds, host
  Space Grotesk, Share Tech Mono, Bebas Neue, and Outfit locally in `/public/fonts/`.
- **index.html shell** is historically grown and large. Incremental migration to component
  modules is the goal.
