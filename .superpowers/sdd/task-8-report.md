# Task 8 Report: Konservative V2-Tracking-Evidenz fuer Workflows

## Status

Abgeschlossen auf `codex/email-evidence-validity-v2`.

## RED

Vor der Implementierung schlugen die neuen Core- und Template-Regressionen wie erwartet fehl:

```powershell
pnpm exec jest --runInBand tests/unit/email-tracking.test.ts tests/unit/email-workflow-graph-compile.test.ts
```

- Die Vorlage verwendete noch `tracking.probable_open_count` statt der praezisen V2-Oeffnungssitzungen.
- Die neun additiven V2-Workflow-Variablen fehlten im Mapping und Schema.
- Ein unveraendertes `open_probable` mit `mail_proxy` blieb faelschlich `probable_open`.

Die Server-Regression wurde danach separat gegen den Persistenzpfad reproduziert:

```powershell
pnpm exec jest --runInBand tests/unit/server-edition-foundation.test.ts --testNamePattern="server summary conservatively projects"
```

- Ohne `summaryEvidenceEventFromProjectionRow` ergab ein historisches, nicht projektiertes `open_probable` faelschlich `probable_open` und `probableOpenCount: 1`.

## GREEN

- Alle neun V2-Felder sind additiv als Workflow-Variablen und als empfohlene Schema-Ausgaenge verfuegbar.
- Bei vorhandener V2-Klassifizierung bestimmt `actorClass` Open-/Click-Kategorie und Engagement: Proxy/Scanner sind automatisiert, `unknown`/`system` machen keinen menschlichen Anspruch, `probable_human` liefert die entsprechende menschliche Evidenz und eine Antwort bleibt staerkste Interaktion.
- Ohne Klassifizierung behalten direkte Core-Events ihr Legacy-Verhalten fuer Kompatibilitaet.
- Der Server-DB-Pfad bleibt absichtlich strenger: `summaryEvidenceEventFromProjectionRow` legt fuer nicht projektierte historische Ereignisse V2-`unknown` an. Damit ergeben sie `engagement: none`, `unknownPixelFetchCount: 1` und `probableOpenCount: 0`.
- Die Follow-up-Vorlage verwendet `tracking.probable_human_open_session_count`; ihre unveraenderten `none,automated_fetch`-Pfade erzeugen weiterhin Aufgaben fuer Proxy- und unbekannte Abrufe, aber nicht fuer wahrscheinliche menschliche Oeffnungen, echte Link-Interaktionen oder Antworten.

## Verifikation

```powershell
pnpm exec jest --runInBand tests/unit/email-tracking.test.ts tests/unit/server-edition-foundation.test.ts tests/unit/email-workflow-graph-compile.test.ts tests/unit/workflow-templates-nodes.test.ts tests/unit/workflow-node-catalog-sync.test.ts
# 5/5 Suiten, 460/460 Tests bestanden; 1 Snapshot bestanden

pnpm run typecheck
# bestanden

pnpm exec eslint packages/core/src/email/tracking.ts packages/core/src/workflow/schema/email.ts packages/core/src/workflow/templates.ts tests/unit/email-tracking.test.ts tests/unit/email-workflow-graph-compile.test.ts tests/unit/server-edition-foundation.test.ts --max-warnings 0
# bestanden

git diff --check
# bestanden
```

## Kompatibilitaet

- Keine alte Workflow-Variable wurde entfernt oder umbenannt; ihre Schluessel bleiben vorhanden.
- Unklassifizierte direkte Core-Events behalten die bisherige `event.type`-Auswertung fuer Open und Click.
- Persistierte Server-Events ohne V2-Projektion werden konservativ als `unknown` behandelt, nie als `probable_human`.
- Neue praezise Felder sind die empfohlenen Variablen fuer Workflows mit Evidenzbewertung.

## Residual Risk

- Der Server-Summary-Regressionstest verwendet die bestehende Kysely-Fake-Datenbank; ein echter PostgreSQL-Compose-Lauf ist nicht Teil von Task 8.
- An der Server-Abfrage- und Paging-Strategie wurde kein Produktionscode geaendert; daher besteht kein neuer N+1-Pfad durch diese Aufgabe.
