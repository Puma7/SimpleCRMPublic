# Plan 031 – Gleichwertigkeitsprüfung (Schritt 4): STOP ausgelöst

Stand: 2026-09-27, Branch `claude/jolly-cerf-hkvznl`.

## Ergebnis

Der kombinierte Lauf (`jest.ci.config.cjs`, einmal unit + integration mit Coverage,
danach `scripts/split-coverage-summary.mjs`) wurde gegen die bisherigen Einzelläufe
(`jest.server.config.cjs`, `jest.ui.config.cjs`) verglichen.

| Scope | Metrik | getrennt | kombiniert | Delta |
|---|---|---|---|---|
| server | lines / statements | 81.49 | 81.49 | 0.00 |
| server | functions | 81.39 | 81.39 | 0.00 |
| server | branches | 74.35 | 74.35 | 0.00 |
| ui | lines / statements | 56.70 | 56.70 | 0.00 |
| ui | functions | 42.94 | 42.94 | 0.00 |
| ui | **branches** | 69.54 | **70.22** | **0.68** |

Dateimengen: server 297 = 297, ui 128 = 128 (keine Datei fehlt oder kommt hinzu).

Der Plan erlaubt höchstens 0,5 Punkte je Metrik. Die STOP-Bedingung „any metric
delta > 0.5“ ist damit dem Wortlaut nach erfüllt. Teil 2 (CI-Umstellung) ist deshalb
**nicht** committet. Der vorbereitete Stand liegt als Patch in
`031-teil2.patch` (anwendbar mit `git apply`).

## Ursache (geprüft je Datei)

- Abgedeckte Branches: getrennt 2781, kombiniert 2781. In **jeder** Datei sind die
  abgedeckten Zeilen, Funktionen und Branches identisch.
- Einziger Unterschied: 39 E-Mail-UI-Dateien, die **kein Test lädt**
  (z. B. `mail-shell.tsx`, `workflow/workflow-canvas.tsx`, `settings/accounts-panel.tsx`),
  zählen im alten UI-Lauf je **0/1** Branches, im kombinierten Lauf **0/0**.
  Nenner: 3999 → 3960, Zähler unverändert → 69,54 % → 70,22 %.
- Grund: `jest.ui.config.cjs` lädt nur das `unit`-Projekt. Nie geladene Dateien
  werden bei v8-Coverage mit der Transform-Konfiguration des Laufs synthetisch
  gezählt; mit beiden Projekten (unit + integration) ergibt das für eine Datei ohne
  jeden Aufruf 0 statt 1 leeren Branch. Das ist ein Zähl-Artefakt für ungetestete
  Dateien, keine Änderung dessen, was gemessen wird.

Belege: `031-ui-coverage-getrennt.json` und `031-ui-coverage-kombiniert.json`.

## Laufzeit

Kombinierter Lauf lokal (3 Worker, nicht exklusiv): 1186 s (≈ 19,8 min).
Bisher getrennt: Server 952 s + UI 628 s = 1580 s, dazu in CI der Lauf ohne Coverage.
Ersparnis in CI wie im Plan geschätzt (≈ 8–9 min), lokal ≥ 6,5 min.

## Entscheidung für Pascal

1. **Empfehlung: annehmen.** Teil 2 anwenden und die UI-Branch-Baseline in
   `ui-coverage-baseline.json` auf den neuen Messwert (70,22) setzen, damit die
   Ratchet mit derselben Zählweise wie in CI vergleicht.
2. Ablehnen: CI bleibt bei drei Läufen; Plan 031 wird REJECTED, Plan 042 dokumentiert
   den heutigen Stand.
