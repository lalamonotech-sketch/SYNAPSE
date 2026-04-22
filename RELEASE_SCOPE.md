# SYNAPSE v98 — Release Scope: The Awakening Update

## Design Vision

> Vom manuellen Verkabeln zum Architekten eines lebendigen, digitalen Bewusstseins.

v97 vollzieht den fundamentalen Wechsel von APM-Reflexspiel zu **strategischem Engine-Builder**.  
Das Spiel startet klaustrophobisch simpel — und skaliert zu einem selbst denkenden Netzwerk.

---

## Neue Systeme

### 1. `src/systems/heartbeat.js` — Globaler Metronom-Tick (NEU)

**Das Ende des manuellen Pulse:**
- `tickHeartbeat(t, dt)` — Globaler Systemtakt alle 2 Sekunden (`TUNING.heartbeatInterval`).
- Bei jedem Beat: Sources produzieren Energie, Upkeep wird abgezogen, Bandbreite routet.
- `fireEmergencyPulse(t)` — Space-Taste ist jetzt ein Notfall-Tool (30s Cooldown, `TUNING.emergencyPulseCd`).
- `beatPhase` — Exportierter [0..1] Wert für visuellen Glow-Sync in hud.js / layer1.js.

**Energie-Routing & Bandbreite:**
- Jeder Link-Typ hat `TUNING.linkCapacity` pro Beat (stable=4, fast=7, resonance=5, fragile=2).
- Overflow → Energie geht verloren → `_bottleneckIntensity` auf Link für Heatmap.
- `_routeEnergy()` — Traffic-Splitting auf alle ausgehenden Links eines Source-Nodes.

**Upkeep-System:**
- `TUNING.nodeUpkeepTable` — Amplifier/Memory kosten 2⬡/Beat, Catalyst 3⬡/Beat.
- 3-Beat-Gnadenfrist vor Brownout (`TUNING.brownoutGraceBeats`).
- Brownout-Recovery sobald Energie wieder ausreicht.

**Node Evolution:**
- Wenn ein Node ≥1000⬡ produziert hat (`TUNING.nodeEvolutionThreshold`), öffnet sich der Evolution-Draft.
- Source → Pulsing Source (AoE-Energie) oder Deep Source (langsamer, robuster).
- Memory → Archive Memory (×2 Knowledge) oder Volatile Memory (schneller, fragil).

**Cortex Cell:**
- Wenn ein Memory-Node ≤3.5 Welteinheiten von 4 Amplifier-Nodes entfernt ist → automatische Verschmelzung zur Cortex-Zelle.
- Cortex-Zelle strahlt Energie-Aura aus (kein Link nötig) in Radius `TUNING.cortexAuraRadius`.
- `tickDaemons()` integriert (Repair/Optimizer laufen jetzt pro Beat).

---

### 2. `src/systems/awakening.js` — Epoch-Progression & UI-Offenbarung (NEU)

**4 Epochen:**
| Epoche | Trigger | UI-Freischaltung |
|---|---|---|
| I Mechanisch | Start | Minimal-HUD (Source + Connect only) |
| II Reaktiv | 1000⬡ Peak / 300⬡ akkumuliert | stats-row, active-projects-hud, diag-panel |
| III Temporal | Erstes Memory platziert | ai-hud, history-panel + Daemons |
| IV Sentience | Boss assimiliert | Vollständige Farbpalette + Ascension-Effekt |

**Glitch-Reveal:**
- Alle UI-Elemente werden mit `.v96-ui-glitch` eingeblendet (0.38s Clip-Animation).
- Freischaltungen werden gestaffelt (600ms Abstand).
- `body.epoch-*` Klassen steuern das globale Farb-Thema via CSS Custom Properties.

**Daemon-System:**
- `unlockDaemons()` → Dynamisches Daemon-Panel erscheint mit Glitch-Reveal.
- 3 Daemon-Typen: Repair (heilt Brownout-Nodes), Builder (ressourcengetrieben), Optimizer (Traffic-Balancing).
- Sektoren: NW/NE/SW/SE Quadranten des Grids.

**Node Evolution System:**
- `checkNodeEvolution(node)` → öffnet Mutations-Draft (ähnlich wie normaler Upgrade-Draft).
- Evolution-Overlay mit Glitch-Einblendung und 2 Optionen pro Node-Typ.
- Mechanische Effekte werden direkt auf die Node-Daten angewendet.

**Genetisches Gedächtnis:**
- `saveGeneticMemory(nodeIds)` — Speichert einen markierten Cluster in localStorage.
- Wird nur aktiv wenn Root Server Upgrade `persistent_seed` gekauft wurde.

---

### 3. `src/systems/rootServer.js` — Root Server (Inter-Run Tech Tree) (NEU)

**Persistente Meta-Progression zwischen Runs:**
- Awakening Points (AP) werden am Run-Ende vergeben (Epoche × 2 + Boni).
- `localStorage` Schlüssel: `syn_awakening_v98`.
- 6 käufliche Upgrades (5–25 AP) mit Voraussetzungskette.

| Upgrade | Kosten | Effekt |
|---|---|---|
| Erster Relay | 5 AP | Run startet mit 1 platzierten Relay |
| Mnemonic Forschung | 8 AP | Mnemonic öffnet Forschungspanel sofort |
| Spine Daemons | 8 AP | Spine startet mit Repair-Daemon |
| Assimilationsbank | 15 AP | Boss-Node-Typ persistent |
| Persistenter Samen | 20 AP | Genetisches Gedächtnis Feature |
| Erweitertes Canvas | 25 AP | Grid → 50×50 nach erstem Boss-Kill |

**UI:**
- Panel auf Title Screen + Shift+R Toggle im Spiel.
- Zeigt AP-Kontostand, Runs gesamt, Epochen-Statistik.
- Nicht-erfüllte Voraussetzungen sperren Upgrades (greyed out).

---

## Geänderte Dateien

| Datei | Änderung |
|---|---|
| `src/engine/gameLoop.js` | Heartbeat + Awakening + Daemons eingebunden; `resetHeartbeat()` in stopLoop; `beatPhase` → `window.__hbPhase` |
| `src/state/gameState.js` | `G.awakening = null` + `G.research = null` in `resetG()` |
| `src/state/tuning.js` | v98-Konstanten: `heartbeatInterval`, `emergencyPulseCd`, `nodeUpkeepTable`, `linkCapacity`, `sourceOutputPerBeat`, `nodeEvolutionThreshold` |
| `src/input/hotkeys.js` | Space → `fireEmergencyPulse`; Shift+R → Root Server Toggle; A → Auto-Router; B → Blueprint |
| `src/gameplay/progression.js` | `initAwakeningOnRunStart()` beim Run-Start |
| `src/meta/screens.js` | `mountRootServerPanel()` beim Laden; `bankAwakeningPoints()` bei Run-Ende |
| `src/ui/hud/hud.js` | `_updateHeartbeatGlow()` syncht Energy-Anzeige mit Beat-Phase |
| `index.html` | `awakening.css` Link; Root-Server-Button in Menü; Epoch-I-HUD-Restriction-Style |

## Neue Dateien

| Datei | Beschreibung |
|---|---|
| `src/systems/heartbeat.js` | Globaler Metronom-Tick (ersetzt manuellen Pulse) |
| `src/systems/awakening.js` | Epoch-System, Node Evolution, Daemons, Glitch-Reveal, Genetic Memory |
| `src/systems/rootServer.js` | Root Server Panel, Inter-Run Tech Tree |
| `src/styles/awakening.css` | Epoch-Themes, Root Server UI, Daemon Panel, Evolution Overlay, Epoch Badge |

---

## Hotkeys (Neu / Geändert)

| Taste | Alt | Funktion |
|---|---|---|
| `Space` | — | Notfall-Pulse (30s CD, war: normaler Pulse) |
| `A` | — | Auto-Router ein/aus (ab Epoche III) *(neu v98)* |
| `B` | — | Blueprint / Highway-Build-Modus *(neu v98)* |
| `Shift+R` | — | Root Server Panel öffnen/schliessen |
| `Shift+L` | — | Tactical View (kein Bloom/Glow) |
| `Ctrl+Z` | — | Netzwerk ~10s zurückspulen (Rewind) |
| `L` | — | Diagnose-Lens (wie v96) |
| `ESC` | — | Taktischer Modus / Overlay schliessen |

---

## Design-Philosophie

> Epoche I fühlt sich wie ein anderes, simpleres Spiel an.  
> Epoche IV fühlt sich wie das Netzwerk denkt.

Das UI wird nicht "freigeschaltet" — es **erwacht**. Jedes Element, das erscheint,
signalisiert eine echte Zustandsänderung im Netzwerk, nicht nur eine Progression-Gate.

