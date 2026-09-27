# Masterplan Runde 2 (Audit vom 2026-09-27)

Grundlage: `/improve`-Audit auf `main` @ `9e0491e3`. Fehler- und Sicherheitsprüfung
gezielt auf dem Code seit dem September-Audit (`e82d2824..9e0491e3`, rund 21.000
Zeilen); Performance, Tests, Altlasten, Abhängigkeiten, Doku über das ganze Repo;
dazu fünf Richtungsvorschläge. Jeder Befund wurde im Code nachgeprüft, #1, #6 und
#9 zusätzlich gemessen.

**So wird abgearbeitet**

- Die Wellen der Reihe nach. Innerhalb einer Welle ist die Reihenfolge frei, außer
  bei den genannten Abhängigkeiten.
- Jeder Plan (`plans/NNN-*.md`) ist in sich vollständig: Ausgangslage mit
  Code-Auszügen, Schritte mit Prüfbefehl, Tests, Abnahmekriterien, Abbruchbedingungen.
- Erst der Drift-Check im Plan; weicht der Code ab, wird gestoppt statt improvisiert.
- Fehlerbehebung immer: erst ein roter Regressionstest, dann der kleinste Fix.
- Erledigt = alle Abnahmekriterien grün. Dann hier abhaken und die Zeile in
  `plans/README.md` (Abschnitt „Runde 2“) auf DONE setzen.
- Push, PR und Merge nur nach Freigabe durch Pascal (AGENTS.md).

Legende: Befund-Nr. = Nummer aus dem Audit-Bericht. P1 = zuerst, P3 = zuletzt.
Aufwand S = Stunden, M = etwa ein Tag, L = mehrere Tage.

---

## Welle 1 – Sofort-Fixes (klein, hohes Risiko im Betrieb)

- [x] **024** KI-Entscheidung: Antwort-Parser linear statt Regex; `1`/`1.0` richtig lesen · Befund #1, #6 · P1 · S · *nach 028*
- [x] **025** Freigabe-Marker an das Absenderkonto binden, bei Kontowechsel löschen · Befund #2 · P1 · S
- [x] **027** Ein beschädigtes Mail-Original stoppt Deduplizierung und `simplecrm maintenance` nicht mehr · Befund #3 · P1 · S
- [x] **028** Wissensbasis: offene Codeblöcke schließen, kein Abschnittsverlust · Befund #4 · P1 · S
- [x] **029** Learnings bekommen festen Anteil am Wissensbudget der KI-Entwürfe · Befund #5 · P1 · S
- [x] **030** Coverage-Ratchets neu setzen, Mail-Ratchet in CI, Warnung bei veralteter Baseline · Befund #7 · P1 · S

## Welle 2 – CI und Testabsicherung

- [ ] **031** CI: Jest nur einmal mit Coverage statt dreimal (≈ 8–9 min schneller) · Befund #8 · P2 · M · *nach 030*
  - ⏸ **Wartet auf Pascal:** STOP in Schritt 4 (Zählweise ungetesteter UI-Dateien, 0,68 Punkte). Bericht und fertiger Patch: `.hermes/reports/runde-2/031-coverage-aequivalenz.md`, `031-teil2.patch`.
- [x] **036** Vertragstest: Frontend-HTTP-Zuordnung gegen die echten Server-Routen · Befund #14 · P2 · M
- [ ] **042** AGENTS.md und Handoff: alle CI-Pflichtprüfungen dokumentieren · Befund #17 · P3 · S · *nach 031*

## Welle 3 – Weitere Sicherheits- und Stabilitätsfixes

- [x] **026** Ausgangsprüfung überspringen: Inhaltsvergleich ohne Schlupflöcher · Befund #10 · P2 · M · *nach 025*
- [x] **032** Learnings-Datenschutzfilter: Kartennummern, Steuer-/SV-/Ausweisnummern, IP-Adressen · Befund #9 · P2 · M
- [x] **033** Backups: Sperre gegen gleichzeitige Läufe, keine verwaisten Anhang-Objekte · Befund #11 · P2 · S
- [x] **034** Senden: KI-Entscheidung außerhalb offener DB-Transaktionen · Befund #12 · P2 · M · *nach 024*
- [x] **035** Learnings-Auswertung: Größenprüfung vorab, Fehler sichtbar statt 5 Wiederholungen · Befund #13 · P2 · S

## Welle 4 – Kleinere Härtungen (Befund #16)

- [ ] **038** Learnings-Auswertung: Prompt-Schutz, atomare Freigabe, KI-Originalvorschlag bleibt erhalten · P3 · M · *nach 035*
- [x] **039** Office-Leser (DOC/XLS/RTF) mit Ausgabebudget · P3 · S
- [x] **040** Zeitplan-Takt: erst einreihen, dann beanspruchen (kein verlorener Lauf) · P3 · S
- [x] **041** Kennzeichnung „KI · freigegeben“: Änderungen in Signatur/Zitat zählen · P3 · M

## Welle 5 – Neue Funktionen (Richtung)

- [ ] **046** R1 „Was ist mit dieser Mail passiert?“ – alle Automatik-Läufe im Lesefenster · P2 · S–M
- [ ] **047** R2 Echter Testlauf: Mail auswählen, auch deaktiviert, optional echte KI · P2 · M
- [ ] **049** R4 Automatik-Cockpit: Anteil Mensch/KI, Warteschlangen, KI-Kosten · P2 · M
- [ ] **048** R3 Wissensbasis abschnittsweise durchsuchen, Quellen im Entwurf · P2 · M–L · *nach 028, 029*
- [ ] **050** R5 Treffsicherheit der KI-Entscheidungen, Schwellen-Vorschlag · P3 · L · *nach 046, 049*

## Welle 6 – Umbauten und Abhängigkeiten

- [ ] **037** Mail-Liste virtualisieren (ersetzt Plan 008) · Befund #15 · P3 · M
- [ ] **045** Desktop-Zeitpläne auf die gemeinsame Cron-Logik, `node-cron` entfernen · Befund #20 · P3 · M
- [ ] **043** `workflow-execution.ts` nach Knotentypen aufteilen (reine Verschiebung) · Befund #18 · P3 · L · *nach 030, 024, 034, 047*
- [ ] **044** Desktop-Zugangsdaten: `keytar` → Electron `safeStorage` (erst Entscheidungsdokument) · Befund #19 · P3 · L
  - ⏸ **Wartet auf Pascal:** Phase 0 fertig – Entscheidungsdokument `docs/design/desktop-credential-store.md` (Status DRAFT) freigeben, dann Phase 1.

## Sonstiges ohne eigenen Plan

- [ ] Quill-Ausnahme bis **25.10.2026** neu bewerten (`docs/SECURITY_DEPENDENCY_EXCEPTIONS.md`)

---

## Abhängigkeiten auf einen Blick

| Plan | braucht vorher | Grund |
|---|---|---|
| 026 | 025 | gleicher Code der Ausgangsprüfung |
| 031 | 030 | CI-Umbau setzt korrekte Ratchets voraus |
| 042 | 031 | Doku beschreibt den Endstand der CI |
| 024 | 028 | beide ändern `knowledge-sections.ts` (Überschriften-Muster) |
| 034 | 024 | gleicher KI-Entscheidungs-Pfad |
| 038 | 035 | gleiche Dateien der Learnings-Auswertung |
| 048 | 028, 029 | baut auf Abschnitts-Parser und Budget auf |
| 050 | 046, 049 | nutzt Laufansicht und Cockpit-Daten |
| 043 | 030, 024, 034, 047 | Verschiebung erst, wenn die anderen Änderungen an der Datei drin sind |
