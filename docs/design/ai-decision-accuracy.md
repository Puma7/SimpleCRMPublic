# KI-Entscheidung: Treffsicherheit messen und Schwelle vorschlagen

Entscheidungsdokument zu Plan 050 (Phase 0). Phasen 1–3 sind umgesetzt, siehe
„Umsetzung“ am Ende; Phase 4 ist nicht gebaut (Q7).

Status: **APPROVED** (Pascal, 28.09.2026) – alle Vorschläge zu Q1–Q7 angenommen, siehe „Antworten“ unten.

## Problem

Die KI-Entscheidung (`ai.decide`) leitet Mails nach einer von Hand gesetzten
Schwelle (50–99 %, Standard 80) in „Ja“, „Nein“ oder „Unsicher“. Ob das Modell
richtig lag, erfährt niemand:

- Schiebt ein Mensch eine als Spam eingestufte Mail zurück in den Posteingang,
  entsteht nur ein Spam-Lernereignis (`email_spam_learning_events`) ohne Bezug
  zur Entscheidung.
- Beantwortet ein Mensch eine Mail, bei der die KI „kein Mensch nötig“ sagte,
  bleibt das ebenfalls unverbunden.
- Das Ergebnis selbst steht nur im Lauf-Schritt: `port` (`ja|nein|unsicher|error`)
  und die Zusammenfassung „Ja-Wahrscheinlichkeit NN %“ bleiben, die Details
  (`detail_json`) werden nach 30 Tagen geleert
  (`packages/server/src/workflow-run-step-append.ts`, Desktop
  `electron/workflow/run-steps.ts`). Den deutschen Text zu parsen ist keine
  tragfähige Datenquelle.
- `ai_usage_events` kennt nur Kosten, keine Antwort.

„Kalibrierung der Confidence“ ist in `docs/KI_SUPPORT_IMPLEMENTATION_PLAN.md`
noch offen.

`ai.decide` ändert den Spam-Status nicht selbst; das tun nachgelagerte Knoten
(z. B. die Vorlage „Eingang: Spam-Entscheidung“,
`packages/core/src/workflow/templates-partial-automation.ts`, Konfiguration
`SPAM_DECISION_CONFIG`). Worauf sich eine Entscheidung bezieht, lässt sich am
Knoten also nicht ablesen – daher die ausdrückliche Einstellung
„Rückmeldung“ (unten, 2).

## Modell

### 1. Ereignis

Ein **Ereignis** ist eine echte (produktive) Auflösung eines `ai.decide`-Knotens
mit Lauf-Id und Knoten-Id. **Nicht** gespeichert werden Testläufe (`dry_run`,
auch „KI wirklich fragen“ aus Plan 047) und Versandvorschauen
(`executePreviewAiDecide`, Desktop `ctx.previewOutbound`) – siehe Frage Q3.

Felder: Workspace, Workflow (Server-Id und Quell-Id), Knoten-Id, Lauf-Id,
Mail-Id, Richtung, Antwort, Ja-Wahrscheinlichkeit, Schwelle, Modell,
Rückmeldungsart, Zeitpunkt; später Art der Korrektur (`override_kind`),
Wahrheit (`truth`) und Zeitpunkt der Korrektur.

**Kein Text**: keine Frage, keine Kriterien, keine Begründung, kein Betreff,
keine Adressen. Damit liegt die Tabelle außerhalb der personenbezogenen Daten
(siehe „Datenschutz“).

### 2. Rückmeldung (`feedbackSignal`)

Neues optionales Feld am Knoten `ai.decide`, Beschriftung „Rückmeldung für die
Treffsicherheit“:

| Wert | Bedeutung | Vorlage |
|---|---|---|
| `none` (Standard) | keine Korrekturen zählen | – |
| `spam` | Ja = Spam | `SPAM_DECISION_CONFIG` |
| `human_needed` | Ja = Mensch nötig | `HUMAN_DECISION_CONFIG` |
| `send_ok` | Ja = versandfähig | `OUTBOUND_DECISION_CONFIG` |

Bestehende Workflows behalten `none`, bis jemand die Rückmeldung wählt; die
drei Vorlagen der Teilautomatisierung setzen sie. Der Knoten zeigt einen
Hinweis, solange `none` gewählt ist.

### 3. Korrekturen → Wahrheit

Nur **menschliche** Eingänge verknüpfen, nur mit dem **neuesten offenen**
Ereignis derselben Mail und Rückmeldungsart, nur innerhalb von **30 Tagen**
nach der Entscheidung. Eine zweite Korrektur überschreibt die erste nicht.

| Rückmeldung | Antwort | Menschliche Handlung | `override_kind` | `truth` | zählt als |
|---|---|---|---|---|---|
| `spam` | ja | setzt „kein Spam“ | `spam_to_clean` | nein | Widerspruch |
| `spam` | nein | setzt „Spam“ | `clean_to_spam` | ja | Widerspruch |
| `spam` | unsicher | setzt „kein Spam“ | `review_to_clean` | nein | Klärung (kein Widerspruch) |
| `spam` | unsicher | setzt „Spam“ | `review_to_spam` | ja | Klärung (kein Widerspruch) |
| `human_needed` | nein | ein Mensch beantwortet die Mail | `human_reply` | ja | Widerspruch |
| `send_ok` | nein / unsicher | „Ohne Ausgangsprüfung senden“ | `sent_without_review` | ja | Widerspruch (nein) / Klärung (unsicher) |

Ohne Korrektur innerhalb von 30 Tagen zählt ein `ja`/`nein` als **bestätigt**
(stillschweigende Zustimmung, Frage Q1). `unsicher` ohne menschliche Klärung und
`error` fließen nicht in die Treffsicherheit ein.

Menschliche Eingänge (Stand dieses Dokuments):

- **Server**: `setSpamStatus` und `bulkSetSpamStatusRows` in
  `packages/server/src/db/postgres-mail-read-ports.ts`; einziger Aufrufer von
  `setSpamStatus` ist die HTTP-Route (`api/mail-routes.ts`), also immer ein
  Mensch mit `actorUserId`.
- **Desktop**: `setMessageSpamStatus`/`setMessageSpam` in
  `electron/email/email-store.ts` kennen bereits `opts.source`. Mensch sind
  `source: 'manual'` (`electron/ipc/email.ts`) und `'drag-and-drop'`
  (`moveMessageToMailView`). **Kein** Mensch: Workflow-Knoten
  (`electron/workflow/nodes/email-nodes.ts`, `source: 'workflow'`), die lokale
  HTTP-API (`electron/services/email-api-service.ts`, `source: 'api'`) und
  `electron/email/mail-security-static.ts` (ohne `source`). Der Plan schlägt
  eine zusätzliche Option `aiOverride` vor; alternativ genügt die Liste der
  menschlichen `source`-Werte. Empfehlung: ausdrückliches `aiOverride: true`,
  weil neue Aufrufer sonst stillschweigend mitzählen könnten.
- **Antworten**: `recordSentProvenance` (Desktop
  `electron/email/email-sent-provenance.ts`, Server
  `packages/server/src/mail-sent-provenance.ts`): `sent_by_kind = 'human'` plus
  `reply_parent_message_id` des Entwurfs = menschliche Antwort (dieselbe Regel
  wie bei den Learnings). `sent_outbound_review_skipped` = „Ohne
  Ausgangsprüfung senden“. Die Verknüpfung läuft nach dem Versand in
  `try/catch` und kann den Versand nie scheitern lassen.

### 4. Kennzahlen je Knoten (90 Tage)

- Anzahl Entscheidungen, Verteilung Ja/Nein/Unsicher/KI-Fehler
- **Übereinstimmung mit Menschen** = bestätigt / (bestätigt + widersprochen),
  nur über abgeschlossene Ereignisse (korrigiert oder älter als 30 Tage) und nur
  über Ereignisse mit Rückmeldung: `none` zählt nur zur Verteilung und zum
  Histogramm, nie zu Übereinstimmung oder Schwellen-Vorschlag (ohne
  Rückmeldung wird nie eine Korrektur verknüpft)
- Histogramm der Ja-Wahrscheinlichkeit in 10 Stufen (0–9, 10–19, …, 90–100)
- **Vorschlag Schwelle**, erst ab 30 gelabelten Ereignissen: kleinste Schwelle
  t (50…99), bei der höchstens 5 % der automatischen Antworten falsch wären
  (`p ≥ t` bei Wahrheit nein, `p ≤ 100 − t` bei Wahrheit ja) und mindestens eine
  automatische Antwort bleibt. „Übernehmen“ ändert nur die Knoten-Einstellung,
  gespeichert wird wie immer von Hand. **Nichts ändert das Routing
  automatisch.**

### 5. Aufbewahrung

Ereignisse 365 Tage, danach gelöscht (Server im Wartungsjob neben
`pruneWorkflowRunStepDetails`, Desktop `…IfDue` neben
`pruneWorkflowRunStepDetailsIfDue`). `message_id` ist `ON DELETE SET NULL`.

### 6. Phase 4 (nicht gebaut)

Eine Learnings-Art `decision_override`, die aus Korrekturen überarbeitete
Ja/Nein-Kriterien vorschlägt – über die bestehende Freigabe der Learnings
(`ai_learning_digests`). Nur Beschreibung, siehe Frage Q7.

## Tabelle

Server-Migration (nächste freie Nummer, Muster `0057_ai_learnings`):

```sql
CREATE TABLE ai_decision_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id bigint REFERENCES email_workflows(id) ON DELETE CASCADE,
  workflow_source_id bigint NOT NULL,
  node_id text NOT NULL CHECK (char_length(node_id) <= 200),
  run_id bigint,
  message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  direction text NOT NULL,
  answer text NOT NULL CHECK (answer IN ('ja','nein','unsicher','error')),
  probability smallint CHECK (probability IS NULL OR probability BETWEEN 0 AND 100),
  threshold smallint NOT NULL CHECK (threshold BETWEEN 50 AND 99),
  model text CHECK (model IS NULL OR char_length(model) <= 200),
  feedback_signal text NOT NULL DEFAULT 'none'
    CHECK (feedback_signal IN ('none','spam','human_needed','send_ok')),
  override_kind text CHECK (override_kind IS NULL OR override_kind IN
    ('spam_to_clean','clean_to_spam','review_to_clean','review_to_spam','human_reply','sent_without_review')),
  truth text CHECK (truth IS NULL OR truth IN ('ja','nein')),
  override_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Kennzahlen je Knoten
CREATE INDEX … ON ai_decision_events (workspace_id, workflow_source_id, node_id, created_at DESC);
-- offene Ereignisse je Mail (Korrektur verknüpfen)
CREATE INDEX … ON ai_decision_events (workspace_id, message_id, created_at DESC)
  WHERE message_id IS NOT NULL AND override_at IS NULL;
-- RLS: ENABLE + FORCE, Policy app.can_access_workspace(workspace_id)
```

Desktop: dieselben Spalten in SQLite-Syntax (`electron/database-schema.ts`),
angelegt an beiden Stellen, an denen `sqlite-service.ts` die Learnings-Tabellen
anlegt.

## Plan für beide Editionen

| Schritt | Server | Desktop |
|---|---|---|
| Ereignis schreiben | `createPostgresAiDecidePort().decide`, zweite Transaktion nach der Abbruchprüfung (`packages/server/src/workflow-ai-decide.ts`); `feedbackSignal` reist im Job-Plan (`scheduleAiDecideJob` in `workflow-execution.ts`) | `ai-nodes.ts`, `finish(...)`, nur wenn `!ctx.dryRun && !ctx.previewOutbound` |
| Spam-Korrektur | `setSpamStatus`, `bulkSetSpamStatusRows` mit `actorUserId` | `setMessageSpamStatus` mit `aiOverride: true` aus IPC und Drag & Drop |
| Antwort / Versand ohne Prüfung | `recordSentProvenance` | `recordSentProvenance` |
| Aufbewahrung | Wartungsjob | `…IfDue` |
| Kennzahlen lesen | `GET /api/v1/workflows/by-source/:sourceId/ai-decisions?nodeId=…&days=90` (nur Zusammenfassung, nie Zeilen; gleiche Rechte wie `…/runs`) | IPC `workflow:ai-decision-stats` |
| Anzeige | Knoten-Einstellungen: „Treffsicherheit (90 Tage)“ | gleich |

Fehler beim Speichern oder Verknüpfen werden abgefangen und protokolliert; sie
ändern nie das Ergebnis des Knotens, den Spam-Status oder den Versand.

## Datenschutz

Die Tabelle enthält nur Ids, Zahlen und feste Kürzel. Nach
`docs/design/gdpr-erasure-spike.md` („Table → action mapping“) gehört sie nicht
zur personenbezogenen Oberfläche; die Löschung per Anonymisieren lässt die
Mail-Id bestehen, ein hartes Löschen setzt `message_id` auf `NULL`. Es ist
keine Änderung an Export oder Löschung nötig.

## Offene Fragen für Pascal

- **Q1** Gilt „keine Korrektur innerhalb von 30 Tagen = bestätigt“, oder sollen
  nur ausdrückliche Bestätigungen zählen? *Vorschlag: stillschweigend bestätigt;
  sonst gibt es praktisch nie 30 gelabelte Ereignisse.*
- **Q2** Ist eine ausdrückliche Einstellung „Rückmeldung“ je Knoten in Ordnung,
  oder soll sie aus nachgelagerten Knoten abgeleitet werden (z. B.
  „Als Spam markieren“ am Ja-Ausgang)? *Vorschlag: ausdrücklich; das Ableiten ist
  bei verzweigten Graphen unzuverlässig.*
- **Q3** Sollen Entscheidungen der Versandvorschau (Ausgangsprüfung,
  `executePreviewAiDecide`, Desktop `previewOutbound`) mitgezählt werden? Sie
  entscheiden über echte Sendungen. *Vorschlag: vorerst nein; sie werden je
  Sendeversuch mehrfach ausgewertet und würden doppelt zählen.*
- **Q4** Aufbewahrung 365 Tage – oder wie die Lauf-Details 30 Tage (weniger
  Stichproben)? *Vorschlag: 365 Tage.*
- **Q5** Die Fehlerquote für den Vorschlag (Standard 5 %) – fest oder je
  Workflow einstellbar? *Vorschlag: fest, später bei Bedarf einstellbar.*
- **Q6** Sollen von Menschen geklärte „Unsicher“-Fälle als Stichproben in den
  Vorschlag einfließen? *Vorschlag: ja (zählen nicht als Widerspruch).*
- **Q7** Phase 4 bauen (Learnings-Art `decision_override`, neue CHECK-Werte in
  `ai_learning_candidates`, geänderter Auswertungs-Prompt) oder bei rein
  zahlenmäßigen Vorschlägen bleiben? *Vorschlag: vorerst nur Zahlen.*

## Checkliste der Entscheidungen

- [x] 1. Ereignis = produktive Auflösung mit Lauf- und Knoten-Id, ohne Testlauf und Vorschau, ohne Text
- [x] 2. Einstellung „Rückmeldung“ (`feedbackSignal`), Standard `none`, Vorlagen setzen sie
- [x] 3. Nur menschliche Korrekturen, neuestes offenes Ereignis, 30-Tage-Fenster, Tabelle oben
- [x] 4. Kennzahlen je Knoten, Vorschlag ab 30 gelabelten Ereignissen, Fehlerquote 5 %
- [x] 5. Aufbewahrung 365 Tage, `message_id` `ON DELETE SET NULL`
- [x] 6. Phase 4 nur beschrieben
- [x] 7. Antworten auf Q1–Q7 hier eingetragen

## Antworten (Pascal, 28.09.2026)

- **Q1:** Keine Korrektur innerhalb von 30 Tagen = bestätigt.
- **Q2:** Ausdrückliche Einstellung „Rückmeldung“ (`feedbackSignal`) je Knoten; die Vorlagen setzen sie.
- **Q3:** Entscheidungen der Versandvorschau vorerst **nicht** mitzählen.
- **Q4:** Aufbewahrung 365 Tage.
- **Q5:** Fehlerquote für den Vorschlag fest 5 %.
- **Q6:** Von Menschen geklärte „Unsicher“-Fälle fließen als Stichproben ein (kein Widerspruch).
- **Q7:** Phase 4 (`decision_override`) vorerst nicht; nur Zahlen.

## Empfehlung

Die Vorgaben oben übernehmen (Vorschläge zu Q1–Q7). Sie speichern keinen Text,
ändern kein Routing und bauen auf vorhandenen Eingängen auf (Spam-Status,
Versand-Kennzeichnung). Das Risiko liegt in den Verknüpfungs-Haken; sie laufen
nach dem eigentlichen Vorgang und fangen jeden Fehler ab.

## Umsetzung (Phasen 1–3, 28.09.2026)

| Teil | Server | Desktop |
|---|---|---|
| Kern (Regeln, Kennzahlen, Vorschlag) | `packages/core/src/workflow/ai-decision-accuracy.ts` | gleich |
| Tabelle | Migration `0066_ai_decision_events` (RLS) | `createAiDecisionEventsTable` in `electron/database-schema.ts` |
| Ereignis schreiben | `recordAiDecisionEvent` in `packages/server/src/ai-decision-events.ts`, aufgerufen nach der Entscheidung in `workflow-ai-decide.ts` (eigene Transaktion, nicht bei Kettenabbruch) | `electron/workflow/ai-decision-events.ts`, aufgerufen in `ai-nodes.ts` (`finish`, nicht bei Testlauf/Versandvorschau) |
| Spam-Korrektur | `setSpamStatus`, `bulkSetSpamStatusRows` nur mit `actorUserId` (Savepoint, Fehler abgefangen) | `setMessageSpamStatus(…, { aiOverride: true })` aus IPC und Drag & Drop (auch „in den Posteingang“) |
| Antwort / Versand ohne Prüfung | `recordSentProvenance` (`mail-sent-provenance.ts`) | `recordSentProvenance` (`email-sent-provenance.ts`) |
| Aufbewahrung | `pruneAiDecisionEvents` im Wartungsjob `audit.retention` | `pruneAiDecisionEventsIfDue` im globalen Cron |
| Kennzahlen lesen | `GET /api/v1/workflows/by-source/:sourceId/ai-decisions?nodeId=…&days=90` (Recht `workflows.view`; bei eingeschränkter Mail-Sicht nur sichtbare Mails, wie die Lauf-Liste) | IPC `workflow:ai-decision-stats` |
| Anzeige | `src/components/email/workflow/ai-decision-accuracy.tsx` in den Knoten-Einstellungen | gleich |

Abweichung vom Plan: Die Tabelle „KI-Entscheidungen (30 Tage)“ der Auswertung
(Plan 049) bekommt **keine** Spalte „Übereinstimmung“. Übereinstimmung zählt nur
abgeschlossene Fälle (korrigiert oder älter als 30 Tage); in einem 30-Tage-Fenster
wären fast alle unkorrigierten Entscheidungen noch offen, die Spalte zeigte also
nur Widersprüche. Die Kennzahl steht deshalb am Knoten (90 Tage).

Tests: `tests/unit/ai-decision-accuracy-core.test.ts`,
`tests/integration/postgres-ai-decision-accuracy.test.ts` (als Nicht-root),
`tests/integration/sqlite-ai-decision-accuracy.test.ts`,
`tests/unit/ai-decision-accuracy-panel.test.tsx`.
