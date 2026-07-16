# Task 8 Review-Fix Report: Workflow-Pfad und Evidenz-Dokumentation

## Umfang

- Die Vorlage `outbound-evidence-follow-up` wird jetzt tabellarisch durch den realen
  Server-Graph-Walker (`createPostgresWorkflowExecutionJobPort`) ab dem Evidenz-Resume-Knoten
  ausgefuehrt.
- Die Dokumentation beschreibt die Nachfassbedingung mit praezisen V2-Signalen und listet alle
  neun empfohlenen V2-Workflow-Variablen.

## Ausgefuehrte Faelle

| Fall | Erwartung |
| --- | --- |
| SMTP-only | Task wird erstellt |
| Mail-Proxy-Abruf | Task wird erstellt |
| Unklarer Pixelabruf | Task wird erstellt |
| Wahrscheinlich menschliche Oeffnung | Kein Task |
| Wahrscheinlich menschlicher Klick | Kein Task |
| Antwort | Kein Task |

Der Test prueft ausserdem den tatsaechlichen `no_engagement`-Port. Damit sind
`link_interaction` und `human_reply` als staerkere Unterdrueckungssignale abgedeckt.

## Verifikation

```powershell
pnpm exec jest --runInBand tests/unit/email-tracking.test.ts tests/unit/server-edition-foundation.test.ts tests/unit/email-workflow-graph-compile.test.ts tests/unit/workflow-templates-nodes.test.ts
# 4/4 Suiten, 453/453 Tests bestanden

pnpm run typecheck
# bestanden

pnpm exec eslint tests/unit/server-edition-foundation.test.ts --max-warnings 0
# bestanden

git diff --check
# bestanden
```

## Hinweis

Die Review-Luecke war Test- und Dokumentationsabdeckung; der reale Graph-Test ist auf dem
aktuellen konservativen Serververhalten bereits gruen. Der parallele, nicht zu diesem Fix
gehoerende E2E-Diff wurde nicht gestaged oder geaendert.
