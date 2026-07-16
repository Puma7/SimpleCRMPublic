# Task 8 Report: Konservative V2-Tracking-Evidenz fuer Workflows

## Status

Abgeschlossen auf `codex/email-evidence-validity-v2`, einschliesslich des P1-
Legacy-Kompatibilitaetsfixes.

## RED

Vor der Implementierung schlugen die neuen Core- und Template-Regressionen wie erwartet fehl:

```powershell
pnpm exec jest --runInBand tests/unit/email-tracking.test.ts tests/unit/email-workflow-graph-compile.test.ts
```

- Die Vorlage verwendete noch `tracking.probable_open_count` statt der praezisen V2-Oeffnungssitzungen.
- Die neun additiven V2-Workflow-Variablen fehlten im Mapping und Schema.
- Der erste V2-Ansatz liess `actorClass` faelschlich die unveraenderlichen Legacy-
  Event-Typen fuer Engagement und alte Zaehler ueberschreiben.

Die Server-Regression wurde danach separat gegen den Persistenzpfad reproduziert:

```powershell
pnpm exec jest --runInBand tests/unit/server-edition-foundation.test.ts --testNamePattern="server summary conservatively projects"
```

- Ohne `summaryEvidenceEventFromProjectionRow` fehlte dem historischen, nicht projektierten
  `open_probable` die konservative V2-`unknown`-Klassifizierung.

## GREEN

- Alle neun V2-Felder sind additiv als Workflow-Variablen und als empfohlene Schema-Ausgaenge verfuegbar.
- Legacy-Engagement sowie automatisierte/wahrscheinliche Open- und Click-Zaehler werden immer
  aus dem unveraenderlichen `event.type` gebildet, auch wenn V2 `actorClass` widerspricht.
- Nur die neun additiven V2-Pixel- und Oeffnungssitzungsfelder werden aus `actorClass` gebildet.
- Der Server-DB-Pfad bleibt konservativ: `summaryEvidenceEventFromProjectionRow` legt fuer nicht
  projektierte historische Ereignisse V2-`unknown` an. Ein historisches `open_probable` ergibt
  damit weiterhin Legacy-`engagement: probable_open` und `probableOpenCount: 1`, aber praezise
  `unknownPixelFetchCount: 1` und keinen wahrscheinlichen menschlichen Open-Session-Anspruch.
- Die Follow-up-Vorlage leitet `probable_open` ueber `tracking.pixel_fetch_count >= 1` zum
  `tracking.probable_human_open_session_count`-Gate. Proxy-/Unknown-Pixelabrufe erzeugen weiter
  Aufgaben, echte menschliche Oeffnungen, Klicks und Antworten nicht; MDN ohne Pixelabruf folgt
  ebenfalls nicht nach.

## Verifikation

```powershell
pnpm exec jest --runInBand tests/unit/email-tracking.test.ts tests/unit/email-workflow-graph-compile.test.ts tests/unit/server-edition-foundation.test.ts --testNamePattern="adds precise pixel-fetch|immutable legacy|old workflow variables|server summary keeps legacy aliases|ships a delayed outbound evidence follow-up template|runs the outbound evidence follow-up graph"
# RED: 3/3 Suiten fehlgeschlagen, 6/6 Regressionen fehlgeschlagen

pnpm exec jest --runInBand tests/unit/email-tracking.test.ts tests/unit/email-workflow-graph-compile.test.ts tests/unit/server-edition-foundation.test.ts
# GREEN: 3/3 Suiten, 425/425 Tests bestanden

pnpm run typecheck
# bestanden

pnpm exec eslint packages/core/src/email/tracking.ts packages/core/src/workflow/templates.ts tests/unit/email-tracking.test.ts tests/unit/email-workflow-graph-compile.test.ts tests/unit/server-edition-foundation.test.ts --max-warnings 0
# bestanden

git diff --check
# bestanden
```

## Kompatibilitaet

- Keine alte Workflow-Variable wurde entfernt oder umbenannt; ihre Schluessel bleiben vorhanden.
- Alle direkten Core-Events behalten fuer alte Summary-Felder und Workflow-Variablen die bisherige
  `event.type`-Auswertung fuer Open und Click, unabhaengig von V2 `actorClass`.
- Persistierte Server-Events ohne V2-Projektion werden fuer die neun neuen Felder konservativ als
  `unknown` behandelt, nie als `probable_human`; ihre Legacy-Felder bleiben event-type-kompatibel.
- Neue praezise Felder sind die empfohlenen Variablen fuer Workflows mit Evidenzbewertung.

## Residual Risk

- Der Server-Summary-Regressionstest verwendet die bestehende Kysely-Fake-Datenbank; ein echter PostgreSQL-Compose-Lauf ist nicht Teil von Task 8.
- An der Server-Abfrage- und Paging-Strategie wurde kein Produktionscode geaendert; daher besteht kein neuer N+1-Pfad durch diese Aufgabe.
- Der fokussierte Abschlusslauf umfasst nur die drei direkt relevanten Testdateien; breite, nicht
  betroffene Suites wurden auf ausdruecklichen Wunsch nicht erneut ausgefuehrt.
