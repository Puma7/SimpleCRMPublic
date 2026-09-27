# Runde 2 – offene Punkte (Stand 27.09.2026)

## Instabiler Test: Learnings „Übernehmen: scheitert das Speichern …“ (Plan 038)

- Datei: `tests/mail/email-ai-learnings.test.ts`, Test „Übernehmen: scheitert das
  Speichern, bleibt alles wie vorher; danach getrennt gespeichert“.
- Beobachtet: 2 Fehlschläge in Voll-Läufen der Mail-Suite, beide während parallel
  weitere Jest-Läufe (Server-/UI-Coverage) liefen. Meldung: „Received function did
  not throw“ – `acceptAiLearningDigest` endete ohne Ausnahme, also über einen
  `decisionFailure` (vermutlich `knowledge_base_changed` oder `not_pending`).
- Nicht reproduzierbar: 3 Einzelläufe, 16 Läufe der Datei parallel unter CPU-Last,
  2 instrumentierte Voll-Läufe mit Coverage, 3 instrumentierte Voll-Läufe unter
  CPU-Last – alle grün.
- Ausgeschlossen: gemeinsames userData-Verzeichnis je Worker (Commit 5ed8765a:
  eigenes Verzeichnis je Testdatei und Lauf; danach trat der Fehler noch einmal
  auf); nicht abgewartete Arbeit in `runAiLearningsDigest`/`acceptAiLearningDigest`
  (keine gefunden).
- Maßnahme: Die Prüfung zeigt jetzt beim Fehlschlag den tatsächlichen
  Rückgabewert (`{ resolved: … }`). Beim nächsten Auftreten damit die Ursache
  bestimmen.

## Nebenwirkungen aus der Diagnose

- Ein fehlerhaftes Stress-Skript schrieb Logdateien `/r1-1.log` … `/r1-8.log`,
  `/r2-1.log`, `/r2-2.log` in das Wurzelverzeichnis des Containers; das Löschen
  wurde von der Sicherheitsprüfung verhindert. Harmlos (flüchtiger Container).
- `/backups/.backup.lock` aus dem manuellen Test von Plan 033 liegt noch im
  Container-Wurzelverzeichnis (ebenfalls harmlos).

## ReDoS-Laufzeitschranken unter Last

- `tests/unit/ai-learnings-redos.test.ts` (Schranke 200 ms) schlug einmal im
  UI-Coverage-Lauf fehl (291 ms / 207 ms), während mehrere Jest-Läufe parallel
  liefen. Allein gemessen: 9–18 ms je 200-KB-Eingabe. Kein Rückschritt aus
  Plan 032; die Schranke ist bei paralleler Last knapp.
