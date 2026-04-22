# SYNAPSE v98 — Smoke Test: The Awakening Update (Sprint 3 + 4)

> Tipp: Öffne die Browser-Konsole (F12) für alle `window.*` Checks.
> `npm run dev` muss laufen. Alle Tests in Reihenfolge.

---

## Pre-flight

- [ ] `npm install && npm run dev` startet ohne Fehler
- [ ] Konsole: keine Import-Fehler für `heartbeat.js`, `awakening.js`, `rootServer.js`, `research.js`, `sprint4.js`
- [ ] `window.G.awakening` ist nach Run-Start ein Objekt (nicht `null`)
- [ ] `window.G.research` ist nach Run-Start ein Objekt mit `{ data, completed, active }`

---

## Epoch I — Mechanisch (Start-State)

- [ ] `document.body.classList.contains('epoch-mechanical')` → `true`
- [ ] `document.body.classList.contains('s4-epoch-restricted')` → `true` (Sprint 4)
- [ ] `#stats-row` ist nicht sichtbar (epoch-mechanical CSS)
- [ ] `#active-projects-hud` ist nicht sichtbar
- [ ] `#diag-panel` ist nicht sichtbar
- [ ] `#ai-hud` ist nicht sichtbar
- [ ] `#v97-epoch-badge` ist vorhanden
- [ ] Dock-Buttons `#bn-rly`, `#bn-amp`, `#bn-mem` haben `data-s4-hidden="1"` und sind unsichtbar
- [ ] `#ctrl-dock` erscheint gedimmt (saturate 0.3 / brightness 0.7)

---

## Heartbeat System

- [ ] Alle ~2s erscheint ein Shockwave-Ring auf dem Grid
- [ ] `window.__hbPhase` ändert sich von 0→1 zwischen Beats
- [ ] Sources produzieren Energie ohne manuellen Pulse
- [ ] `#vE` (Energy-Anzeige) zeigt kurzen Cyan-Glow beim Beat

### Upkeep
- [ ] Amplifier / Memory bauen, Energy leer lassen → Nodes werden transparent (Brownout)
- [ ] Toast `🔴 BROWNOUT` erscheint
- [ ] Bei ausreichend Energy: automatische Recovery

### Emergency Pulse
- [ ] `Space` → Schockwave + Toast "⟳ NETZ-PULS"
- [ ] Zweimal schnell → Cooldown-Toast erscheint

---

## Epoch II — Reaktiv

Konsole-Shortcut zum Triggern:
```js
G.peakEnergy = 1000;
```

- [ ] `body.classList.contains('epoch-reactive')` → `true`
- [ ] `body.classList.contains('s4-epoch-restricted')` → `false` (Restriction aufgehoben)
- [ ] `body.classList.contains('epoch-mechanical')` → `false`
- [ ] `#stats-row` erscheint mit `.v96-ui-glitch` Animation
- [ ] `#active-projects-hud` erscheint (600ms Versatz)
- [ ] `#diag-panel` erscheint
- [ ] Toast `✦ Epoche II · Reaktiv`
- [ ] **Sprint 4 — Glitch Burst:** HUD und Dock flackern kurz (~0.6s) mit Farbversatz
- [ ] **Sprint 4 — Epoch Flash:** Kurzer cyan-blauer Fullscreen-Glow
- [ ] **Sprint 4 — Narrative Toasts:** "SYSTEM AWARENESS EXPANDING…" → "◬ FORSCHUNGSPROTOKOLL INITIALISIERT" → "⬡ NETZWERK ERWACHT" (gestaffelt über ~7s)
- [ ] **Sprint 4 — Palette:** `document.documentElement.style.getPropertyValue('--s4-accent')` → `#00aacc`

---

## Sprint 3 — Forschungssystem (Research)

> Aktiv ab Epoch II (active-projects-hud sichtbar)

### Panel
- [ ] `#active-projects-hud` zeigt 1–3 Forschungsprojekte
- [ ] ◬ Data-Pill in Violett oben im Panel sichtbar (`#ap-data-display`)
- [ ] Klick auf Header → Panel klappt auf/zu (`expanded` Klasse)

### Data-Tick
- [ ] Memory-Node platzieren → `G.research.data` steigt bei jedem Heartbeat um 1
- [ ] In Konsole: `G.research.data` → Wert > 0 nach wenigen Sekunden

### Forschung starten
- [ ] Projekt anklicken → `active` Klasse erscheint, Progress-Bar startet
- [ ] Nur ein Projekt gleichzeitig aktiv (bei zweitem Klick: erstes pausiert)
- [ ] Progress bei jedem Beat sichtbar steigen

### Cancel
- [ ] Laufendes Projekt anhalten, dann Abbrechen-Button klicken
- [ ] 80% der Data werden zurückerstattet
- [ ] `G.research.active` ist danach `null`

### Completion
- [ ] Projekt zu 100% bringen → Toast `◬ FORSCHUNG ABGESCHLOSSEN` 
- [ ] Effekt greift sofort (z.B. Relay-Beschleunigung, Amplifier-Freischaltung)
- [ ] `G.research.completed.has('project_id')` → `true`
- [ ] Abgeschlossenes Projekt erscheint ausgegraut mit ✓

### Amplifier-Forschung (Tier 2)
- [ ] Ohne `amplifier_protocol` Forschung: `#bn-amp` hat Klasse `tbtn-research-locked`
- [ ] Nach Abschluss: `#bn-amp` ist klickbar, kurze Highlight-Animation `tbtn-research-unlocked`

---

## Sprint 4 — Awakening Points Badge

- [ ] `#s4-ap-badge` ist auf dem Title Screen sichtbar (neben Root Server Button)
- [ ] `#s4-ap-val` zeigt aktuellen AP-Kontostand
- [ ] Nach Run-Ende: Badge aktualisiert sich und zeigt kurze Bump-Animation (`ap-gained`)

---

## Sprint 4 — Epoch Paletten (visuell)

| Epoche | `--s4-accent` | Erwarteter Ton |
|---|---|---|
| Mechanical | `#2a4a6a` | Dunkelblau, gedimmt |
| Reactive | `#00aacc` | Cyan |
| Temporal | `#aa44ff` | Violett |
| Sentience | `#ff88ff` | Pink-Weiß |

Konsole-Check nach jedem Epoch-Übergang:
```js
getComputedStyle(document.documentElement).getPropertyValue('--s4-accent')
```

---

## Epoch III — Temporal

- [ ] Memory-Node platzieren → Epoch III triggert
- [ ] `#ai-hud` erscheint
- [ ] `#history-panel` erscheint
- [ ] Daemon-Panel erscheint
- [ ] **Sprint 4 — Narrative:** "TEMPORALE SIGNATUR ERKANNT…" → "🔧 DAEMONS FREIGESCHALTET" → "AUTOMATISIERUNG BEGINNT"
- [ ] **Sprint 4 — Palette:** `--s4-accent` → `#aa44ff`

---

## Node Evolution

```js
gameNodes[0]._energyProduced = 1001;
```
- [ ] Evolution-Overlay erscheint
- [ ] Zwei Karten sichtbar
- [ ] Auswahl → Toast + Node-Farbwechsel

---

## Cortex Cell

- [ ] Memory sehr nah an 4 Amplifier → Toast "✦ CORTEX-ZELLE GEBILDET"
- [ ] `G.awakening.macroStructures.length > 0`

---

## Epoch IV — Sentience

```js
G.awakening.bossAssimilated = true;
```
- [ ] `body.classList.contains('epoch-sentience')` → `true`
- [ ] Fullscreen Glitch-Burst
- [ ] **Sprint 4 — Narrative:** "⚠ PARAMETER-GRENZEN ÜBERSCHRITTEN" → "◈ SENTIENCE PROTOKOLL AKTIV" → "✦ DAS NETZ ERWACHT"
- [ ] **Sprint 4 — Palette:** `--s4-accent` → `#ff88ff`

---

## Root Server Panel

- [ ] Titel-Screen: "◈ Root Server" Button sichtbar
- [ ] Klick / `Shift+R` → Panel Toggle
- [ ] Panel zeigt Runs, Epochen, ⬟ Gedächtnis-Indikator (wenn `persistent_seed` gekauft)
- [ ] Kauf "Erster Relay" (5 AP) → Panel aktualisiert, Upgrade grün ✓
- [ ] `localStorage.getItem('syn_awakening_v98')` enthält JSON mit `awakenPoints`

---

## Sprint 4 — Genetisches Gedächtnis

**Voraussetzung:** Root Server Upgrade `persistent_seed` gekauft.

### Win-Screen Overlay
- [ ] Nach Spielende: `.s4-genetic-wrap` ist im Win-Screen sichtbar
- [ ] Bis zu 6 Memory/Amplifier/Cortex Nodes als Buttons aufgelistet
- [ ] Klick auf Node → Button highlighted (`.s4-selected`), alle anderen disabled
- [ ] Status-Text "✓ Gespeichert — erscheint im nächsten Run als Ruine"
- [ ] Toast `⬟ GEDÄCHTNIS GESICHERT`
- [ ] `getRootServer().geneticMemory` → Objekt mit `{ nodes, links, savedAt }`

### Nächster Run — Ruine
- [ ] Neuen Run starten nach gespeichertem Gedächtnis
- [ ] Toast `⬟ GENETISCHE ERINNERUNG` erscheint beim Start
- [ ] `G.geneticRuins` ist ein Array mit mind. 1 Eintrag
- [ ] `window._s4ReactivateRuin` ist eine Funktion
- [ ] Ruine reaktivieren (manuell via `window._s4ReactivateRuin(G.geneticRuins[0].id)`) → `+25 ◬ Data` Toast

### Root Server Panel — Gedächtnis-Indikator
- [ ] `⬟ Gedächtnis: ✓` im Root Server Panel nach gespeichertem Gedächtnis

---

## Sprint 4 — Research AP-Bonus

- [ ] Run beenden mit ≥1 Forschung abgeschlossen
- [ ] `bankAwakeningPoints` erhält `researchBonus` (1 pro Projekt, +5 Bonus bei ≥4)
- [ ] AP-Gesamtsumme im Root Server steigt entsprechend

---

## Sprint 4 — Win-Screen Research Summary

- [ ] Run gewinnen mit aktiver Mnemonic-Protokoll-Forschung
- [ ] `#ws-research-row` ist im `#win-stats` Block sichtbar
- [ ] Zeigt Anzahl abgeschlossener Projekte + gesamt ◬ Data

---

## Regression

- [ ] L1-Gameplay (Nodes/Links) funktioniert wie in v96/v97
- [ ] L3-Cluster-Capturing unverändert
- [ ] Boss-Kämpfe starten normal
- [ ] Diagnose-Lens (`L`-Taste) funktioniert
- [ ] Save/Load: `G.awakening` und `G.research` werden korrekt zurückgesetzt bei `resetG()`
- [ ] Tech-Tree und Mega-Projekte unbeschädigt
- [ ] Onboarding-Karte erscheint bei erstem Run
- [ ] Hard Mode Hint erscheint korrekt im Win-Screen

---

## Konsole-Schnellchecks (Gesamt)

```js
// Epoch I state
document.body.className                            // 'epoch-mechanical s4-epoch-restricted'

// Research state
G.research.data                                    // z.B. 12.4
G.research.completed                               // Set {}
G.research.active                                  // null oder 'project_id'

// Sprint 4 AP badge
document.getElementById('s4-ap-val').textContent   // '5' o.ä.

// Root Server
getRootServer().awakenPoints                        // z.B. 7
getRootServer().upgrades                            // { startWithRelay: false, ... }

// Epoch palette
getComputedStyle(document.documentElement).getPropertyValue('--s4-accent')

// Genetic memory
getRootServer().geneticMemory                       // null oder { nodes, links, savedAt }
G.geneticRuins                                     // undefined oder Array
```
