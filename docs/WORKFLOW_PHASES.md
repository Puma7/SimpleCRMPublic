# Workflow-Phasen — Umsetzungsstand (W0–W7)

Siehe Zielbild: [`WORKFLOW_VISION.md`](WORKFLOW_VISION.md).

| Phase | Status | Lieferung |
|-------|--------|-----------|
| **W0** | ✅ | E-Mail-Trigger, Regel-Engine, React-Flow-Editor, If/Else, `ai_review`, Postfach-Lücken |
| **W1** | ✅ | `electron/workflow/runtime.ts` Graph-Interpreter, `WorkflowContext`, `email_workflow_run_steps`, Test Dry-Run IPC |
| **W2** | ✅ | `WorkflowNodeRegistry`, dynamische Palette, Vorlagen, Experten-JSON pro Registry-Knoten |
| **W3** | ✅ | Wissensbasis-Tab, `ai.agent` / `ai.classify` / `ai.transform_text`, Keyword-RAG |
| **W4** | ✅ | `code.javascript` (vm), `code.python`, Plugin-Manifest-Loader |
| **W5** | ✅ | `crm.create_task`, `crm.log_activity`, `sync.run`, `http.request` (Allowlist), `logic.delay` / `set_variable` |
| **W6** | ✅ | Import/Export Bundle IPC, Lauf-Historie UI, Workflow-Reporting weiter über Runs |
| **W7** | ✅ | Editor-Roadmap: editierbare Kanten-Labels, Switch-/Loop-Builder, Inline-Code-Monaco, Snap-to-grid, direkte Node-/Helper-Tests |

## Architektur (kurz)

- **Modular (Standard):** Jeder Flow ist ein **Graph aus Einzelknoten** (`graph_json`). Laufzeit = `runWorkflowGraph` + **Node Registry** (`registerWorkflowNode`). Kein festes Programm — Vorlagen/Defaults sind nur vorgefüllte Graphen.
- **Legacy-Export:** `definition_json` ist optionaler **Export** linearer Regeln (Palette: Bedingung + klassische Aktionen). Registry-Knoten (`ai.spam_score`, `logic.threshold`, …) laufen **nur** im Graph-Interpreter.
- **`execution_mode = compiled`:** Nur wenn explizit gesetzt — alte Regel-Engine ohne Registry-Knoten.
- **Plugins:** Jeder Handler in `~/.config/simplecrm/workflow-plugins/*.json` wird als Knotentyp `plugin.<id>.<handler>` registriert.
- **Migration:** Workflows ohne `graph_json` werden einmalig aus `definition_json` in einen Graph überführt (`definition-to-graph.ts`).
- **IPC:** `workflow:*` Kanäle in `shared/ipc/channels.ts`, Handler `electron/ipc/workflow.ts`.

## Backlog P1–P7 (✅ umgesetzt)

| Prio | Thema | Lieferung |
|------|--------|-----------|
| **P1** | Delay-Job-Processor | `processDueDelayedJobs` im E-Mail-Cron; Resume via `executeWorkflowForTrigger` + `startNodeId`; `resolveResumeNodeAfter` |
| **P2** | CRM-/Kalender-Trigger | `workflow-trigger-dispatch.ts`; `crm.customer_created`; `crm.deal_stage_changed` bei `updateDealStage`; Cron-Scan für `task.due` / `calendar.event_start` (15-Min-Fenster, Dedup 60s) |
| **P3** | Embeddings-RAG | `embedding_json` an Chunks; `runEmbedding` in OpenAI-Layer; Cosine + Keyword-Fallback in `knowledge-base.ts` |
| **P4** | `logic.switch` / `merge` / `loop` | Registry-Knoten + Loop-Walker in `runtime.ts` (Ports `each`/`done`, dynamische Switch-Labels) |
| **P5** | IMAP-Aktionen | `email.move_imap`, `email.delete_server` (Opt-in `workflow_imap_delete_opt_in` in `sync_info`) |
| **P6** | Subflows, Versionierung, Monaco | `workflow.subflow`; Tabelle `email_workflow_versions` + Dialog; `@monaco-editor/react` Experten-JSON |
| **P7** | JTL / MSSQL, Agent-Tools | `mssql.query`, `jtl.lookup` (read-only); `ai.agent_tool`; `crm.update_deal` |

## Ergänzungen (Postfach & Ausgang)

| Thema | Status |
|--------|--------|
| Ausgangsprüfung vor SMTP + Rückkehr Posteingang mit Warnbanner | ✅ |
| `ai.outbound_review`, Vorlage `outbound-quality-check` | ✅ |
| Cron: `runScheduledWorkflowFire` führt Graph aus (+ optional Konto-Sync) | ✅ |
| Desktop: **Jetzt ausführen** (`workflow:execute-now`) für manual/schedule/CRM | ✅ |
| Server: Zeitplan-Auslöser — Minutentakt `workflow.schedule.tick` je Workspace (Maintenance-Ticker), Anspruch je Zeitpunkt per bedingtem UPDATE auf `email_workflows.schedule_last_slot_at` (Migration `0056`), `workflow.execute` mit Ausloeser `schedule`, Dienst-Provenienz und Job-Key Workflow+Zeitpunkt; Nachholung höchstens 15 Minuten; Zeitzone `workflow_schedule_timezone` (sync_info, Standard `Europe/Berlin`); Cron-Parser rein in `packages/core/src/workflow/cron-schedule.ts` (5 Felder, Mindestabstand 15 Minuten, Tag UND Wochentag wie node-cron, Paritätstest gegen node-cron); `schedule_last_slot_at IS NULL` = nicht scharf (Bestand, Desktop-Import) — scharf erst durch Anlegen/Aktivieren/Speichern im Server, Editor-Hinweis über `scheduleLastSlotAt`; „Jetzt ausführen“ läuft als `schedule` | ✅ |
| Globaler Spam-Schwellwert → `logic.threshold` mit `useGlobalThreshold` | ✅ |
| Compose: **Ausgang prüfen** (Dry-Run, keine DB-Mutation) | ✅ |
| Canvas-Ports für `email.sender_filter` / `logic.threshold` | ✅ |
| Zusätzliche Vorlagen (Schedule, Manual, CRM-Deal, Newsletter-Archiv) | ✅ |
| Editor-UX: editierbare Kanten-Labels, Switch-/Loop-Felder, Monaco-Codefelder, Snap-to-grid | ✅ |
| Trigger `webhook.incoming` über E-Mail-IPC/Automation-API | ✅ |

## Überarbeitung 2026-07 — Masterplan Phasen 1–3 (✅ umgesetzt)

Systemaudit-Overhaul in drei Commits (`f93354e`, `65966ef`, `8dc8298`). Endanwender-Doku dazu: [`USER_GUIDE_WORKFLOWS.md`](USER_GUIDE_WORKFLOWS.md).

| Phase | Lieferung (Kern in einer Zeile) |
|-------|--------------------------------|
| **1 — Funktionale Fixes** | `email.release_outbound`-Doppelregistrierung beseitigt (ein Executor, Registry wirft bei Duplikat); `interpolateTemplate` Single-Pass (mehr-Punkt-Keys, keine Re-Interpolation); Plugin-Nodes können `run()` exportieren und `{ variables }` zurückgeben (Freeze-Bug); `returns.*`, `jtl.order_context`, `jtl.prepare_action` per `runtime`-Flag als server-only markiert — Desktop filtert sie aus der Palette und meldet beim Lauf einen klaren Fehler statt „Unbekannter Knoten“ |
| **2 — Deklaratives Node-Schema** | Eine Quelle der Wahrheit für ~52 Knoten (`packages/core/src/workflow/node-schema.ts` + `schema/`): Felder (Typ, DE-Label, Hilfe, Beispiel, Pflicht, Wertebereich), Ports und Output-Variablen treiben generischen Form-Renderer (`schema-fields.tsx`), Speichern-Validierung (Pflichtfelder blockieren, Knoten wird markiert), Variablen-Picker mit graph-sensitiven Vorschlägen, Canvas-Port-Handles und Kantenlabel-Auswahl statt Freitext; zentraler Interpolations-Pre-Pass: `{{Platzhalter}}` wirken in allen als `interpolate` markierten Feldern |
| **3 — Zwei-Stufen-KI-Antwort** | `ai.draft_reply` (Agent 1: Entwurf mit Wissensbasis, Anrede, Signatur, korrekt adressiert) + `ai.review_draft` (Agent 2: Gegenprüfung, Ports `send`/`hold`, fail-safe immer Richtung Mensch); neutraler Freigabe-Zustand `approval_state` mit „Wartet auf Freigabe“-Banner (Jetzt senden / Als Entwurf behalten); Auto-Antwort-Master-Schalter jetzt mit UI (Einstellungen → Automatisierung) + Tageslimit pro Absender (`email_auto_reply_dedup`); Anti-Loop am Gate (RFC-3834-/List-*-Header eingehend, `Auto-Submitted: auto-replied` ausgehend); Vorlage „Eingehend: KI-Antwort mit Gegenprüfung (empfohlen)“; Vorlagen-Dialog mit Live-Voraussetzungs-Checkliste |

## Überarbeitung 2026-07 — Workflow-Semantik (Welle 1–3)

| Welle | Lieferung |
|-------|-----------|
| **1.1 Ausgangsprüfung** | `ai.outbound_review` mit Ports `ok`/`block`/`error`; Vorlage `outbound-quality-check` mit sichtbaren Zweigen |
| **1.2/1.3 Spam Short-Circuit** | `stopFurtherWorkflows` an Spam-Knoten; `logic.stop_after_spam`; serielle Inbound-Kette auf dem Server; Agent-Vorlage mit Spam-Bedingung |
| **2 Spam-Score-Parität** | Ehrliche Server-Hinweise zu `ai.spam_score`; Schema-Doku Desktop vs. Server |
| **3 Editor-Transparenz** | Read-only Graph-JSON im Editor; Vorlagen-Port-Erklärungen; Doku-Updates |
| **4 Server-Parität & Spam-Kette** | `ai.draft_reply`/`ai.review_draft` auf dem Server; `approval_state` in PostgreSQL; HTTP Freigabe (`approve-draft-send` / `dismiss-draft-approval`); einheitliche fail-closed KI + Spam-Short-Circuit (`inboundChainStop`); Inbound-Kette überlebt KI/HTTP/Delay-Continuations; Run-Historie mit Port-Labels ok/block/error; Desktop-KI überspringt Spam-Mails |
| **F-D1-03 Delay in der Kette** | Deferiert ein Inbound-Lauf nur an `logic.delay` und folgt dahinter kein kettenstoppender Knoten (`stopFurtherWorkflows`, `logic.stop_after_spam`), schaltet der Server die Kette sofort weiter (Hop-Claim verhindert doppeltes Einreihen durch die Continuation). Mit Stopper hinter dem Delay bleibt sie seriell; der Editor zeigt dann einen Hinweis |

## Teilautomatisierung 2026-09 ([`MAIL_TEILAUTOMATISIERUNG.md`](MAIL_TEILAUTOMATISIERUNG.md))

| Paket | Lieferung |
|-------|-----------|
| **P1 KI-Entscheidung** | `ai.decide` (beide Editionen): Ports `ja`/`nein`/`unsicher`/`error`, Schwelle 50–99 (Standard 80), Logik und Chat-Antwort-Parser in `packages/core/src/workflow/ai-decide.ts`, Decisions-API-Hilfen in `ai-decisions-api.ts`. `pickEdge` lässt `nein`/`unsicher` nicht auf die unbeschriftete Kante fallen (`ja` schon); Trap-Walker kennt `ai.decide` (Freigabe nur über `ja`). Ausgang: `nein`/`unsicher`/`error` halten den Versand an (Desktop `blocked`, Server Hold + Fortsetzung am Port). Server: Job-Typ `ai.decide` (Queue `ai`, Policy `mail.content.read`, `portResumeTargets`, Terminal-Kette, Abbruch-Check, Fehler → Port `error`, Interpolation im Job); Versandvorschau entscheidet synchron. Profil-Typ `openrouter_decisions` (`POST …/alpha/decisions` über `guardedAiPost`, 30 s, Kosten aus `usage.cost` in `ai_usage_events`); Chat-Bausteine lehnen ihn zentral ab. „Verbindung testen“: IPC `email:test-ai-profile`, `POST /api/v1/ai/profiles/:id/test-connection` (Usage `ai.profile_test`) |
| **P2 Ausgang** | Endgültiger Ausgangs-Block hält den Entwurf an, löscht dessen Planung und zeigt den echten Grund (auch der Server-Oberfläche, auch beim synchronen Block eines menschlichen Versands); leerer Grund → Standardtext; „Ohne Ausgangsprüfung senden“ mit Einstellung `outbound_review_skip_policy` und Audit; KI-Antwort-Vorlagen senden durch den Ausgang (Details unten) |
| **P3 Gesendet von** | Kennzeichnung `sent_by_kind` (`human`/`ai_auto`/`ai_approved`/`workflow`/`relay`) an jeder gesendeten Mail, Ansicht „Gesendet (KI)“ (`sent_ai`), Server-Sync des Gesendet-Ordners ohne Doppelzeilen (Details unten) |
| **P4 Zeitplan auf dem Server** | Auslöser `schedule` in beiden Editionen, Minutentakt je Workspace, genau ein Lauf je Zeitpunkt, Zeitzone je Workspace (Details in der Tabelle „Ergänzungen“ oben) |
| **P5 Learnings** | Kernlogik `packages/core/src/learnings` (Datenschutzfilter `redactPersonalData`, `stripReplyNoise`, `##`-Abschnitte + `applyKnowledgeOperations`, Myers-Wort-Diff, Prompt/Parser); Tabellen `ai_learning_candidates`/`ai_learning_digests` (Server-Migration `0057_ai_learnings`, SQLite idempotent) plus Desktop-Spalte `email_messages.ai_suggestion_snapshot`; Sammeln beim Versand (vor dem Nullen des KI-Schnappschusses; nur bei `sent_by_kind = 'human'` aus P3 — `draft_edit` braucht zusätzlich den KI-Schnappschuss, `ai_approved`/`ai_auto`/`workflow`/`relay` sammeln nichts) und per „Learning notieren“; Auswertung Server-Job `learnings.digest` (Queue `learnings-<ws>`) bzw. Desktop im Main-Prozess; Knoten `ai.learnings_digest`; Einstellungen → Learnings mit Änderungsansicht und atomarer Übernahme (`POST /api/v1/workflow-knowledge-bases/:id/document`, auch für das normale Speichern der Wissensbasis); Aufräumen im `audit.retention`-Lauf bzw. Desktop-Tick; eigener Wissensbasis-Kontext `learnings` (auto-angelegte Basis, `override_key` `kb.learnings`), den `knowledgeContextsForDirection` in jeder Richtung zusätzlich liefert |
| **P6 Vorlagenpaket** | Vier Vorlagen in `packages/core/src/workflow/templates-partial-automation.ts` (`PARTIAL_AUTOMATION_TEMPLATE_IDS`), beide Editionen: `inbound-spam-decision` (Priorität 5; `ai.decide` → `email.mark_spam` mit `moveImap`/`stopFurtherWorkflows` + `logic.stop_after_spam`, unsicher → `email.set_spam_status` review + Stopp, `error` → Tag `ki-fehler`, `nein` unverdrahtet), `inbound-human-or-ai-reply` (Priorität 50; `logic.stop_after_spam` → `ai.decide` → ja/unsicher/error Tag `manuell`, nein → `email.auto_reply` mit `ai.decide.confidence` → `ai.draft_reply` → `ai.review_draft` → `email.send_draft` mit `runOutboundReview: true`, hold → `ki-freigabe` + Aufgabe, blocked → `ki-manuell`), `outbound-decision-before-send` (Priorität 50; ja → `email.release_outbound` autoSend, sonst Tag `ausgang-blockiert`), `learnings-weekly-digest` (Zeitplan `0 6 * * 1`, `ai.learnings_digest` Woche/3). `WorkflowTemplate` trägt optional `priority`/`cronExpr`; der Server reicht sie in `GET /api/v1/workflow/templates` durch, „Vorlage laden“ setzt Priorität und Cron im Editor und trägt in `ai.decide` ohne `profileId` das erste Profil `openrouter_decisions` mit Schlüssel ein (nur beim Laden, aus `ListAiProfiles`; `withDecisionModelProfile`). Vorlagen-Checkliste als reine Logik `workflow-template-checks.ts` mit neuen Prüfungen (Entscheidungs-/Chat-Profil mit Schlüssel, Wissensbasis, „Learnings sammeln“, Zeitplan-Auslöser) über vorhandene Kanäle (`ListAiProfiles`, `ListKnowledgeBases`, `GetLearningsOverview`); Speicher-Hinweis „Aktionen direkt am Auslöser“ ignoriert `ai.decide` und `logic.stop_after_spam`. Desktop-`email.mark_spam`: scheitert nur das Verschieben (`moveImap`: POP3, kein Ordner „Spam“, IMAP-Fehler), bleibt die Mail Spam, Stopp-Flags gelten weiter, Schritt-Meldung `imap_spam_move_failed: <Grund>` — Parität zum Server, der das Verschieben nach dem Commit versucht und ein Scheitern übergeht. Tests: Graph-Validierung, Server-API, Desktop-Durchläufe je Ausgang, Server-Lauf mit Embedded Postgres (Spam-Kette und „Mensch oder KI?“ bis zum geplanten Versand) |

## Ausgang: angehaltene Entwürfe (Teilautomatisierung P2)

- Ein **endgültiger** Ausgangs-Block (Knoten `email.hold_outbound`, Block/Fehler von `ai.outbound_review`, synchroner Dry-Run-Block beim Server-Versand — geplant oder von einem Menschen gesendet, auch durch `ai.decide`, das dort die KI fragt) löscht `scheduled_send_at` und die Planungs-Provenienz (Server: `scheduled_send_actor_user_id`/`scheduled_send_trusted_service_principal`, Desktop: `sync_info` `scheduled_send_actor:<id>`) und schreibt den Banner mit dem echten Grund. Zentral: Server `persistOutboundBlockOnDraft` (`packages/server/src/mail-outbound-hold.ts`), Desktop `returnOutboundDraftToInbox`. Neue Block-Knoten (z. B. `ai.decide` im Ausgang) nutzen denselben Helfer.
- Der Server-Zwischenzustand „Prüfung läuft“ (`OUTBOUND_REVIEW_PENDING_REASON`) ist kein endgültiger Block; `restoreClaimedDraft` stellt die Planung nur wieder her, wenn der Entwurf nicht inzwischen endgültig angehalten ist.
- Leerer Grund: `OUTBOUND_HOLD_FALLBACK_REASON` („Vom Workflow ohne Begründung angehalten – bitte E-Mail prüfen.“, `packages/core/src/email/outbound-review-parse.ts`) in Runtime, Knoten und Oberfläche beider Editionen.
- Server-Lesepfad liefert `outboundHold`/`outboundBlockReason` (Grund für metadata-only Aufrufer geschwärzt).
- Workflow-Versand mit `runOutboundReview:true` auf dem Server: Der geplante Versand ohne menschlichen Akteur (`scheduled_send_trusted_service_principal`) startet Dry-Run und `workflow.execute`-Jobs der Ausgangs-Workflows als **Trusted Service** (`buildTrustedServiceJobPayload`, kein `actorUserId`). Vorher trugen die Jobs den Platzhalter `actorUserId: 'system'`, den der Job-Enforcer als unbekannten Nutzer abwies — die Prüfung lief nie, und `release_outbound` hätte `system` als Planer eingetragen. Die KI-Antwort-Vorlagen senden seitdem mit `runOutboundReview:true` (Ende-zu-Ende-Test `postgres-outbound-review-auto-reply-e2e`). Dasselbe gilt für die Weiterleitungskopie mit `runOutboundReview:true` (`workflow-forward-copy`): ohne menschlichen Akteur als Trusted Service, mit Akteur (Workflow von Hand gestartet) als dieser Nutzer (Test `postgres-forward-copy-outbound-review`).
- „Ohne Ausgangsprüfung senden“: IPC `email:send-draft-skip-outbound-review` `{ draftId }` / `POST /api/v1/email/messages/:id/send-skip-outbound-review` (Mail-ACL wie `approve-draft-send`: `mail.send` + `mail.draft.edit`, Eltern-Triage, Anhangsrechte). Nur lokale Entwürfe mit `outbound_hold`; Rolle laut `outbound_review_skip_policy` (`all`/`admins`/`none`, Server und Desktop-Main-Prozess). Nur der unveränderte, angehaltene Inhalt: der endgültige Block speichert `sync_info` `outbound_hold_fingerprint:<id>` (`outboundHoldFingerprint` = `outboundDraftFingerprint` über `normalizeOutboundHoldContent`: Hinweis herausgerechnet, Leerraum/Entitäten/HTML-Auszeichnung ignoriert, Text- und HTML-Text, Link-/Bildziele, Empfänger-Adressen, Anhänge); der Skip vergleicht unter Sperre (Server `FOR UPDATE`, Desktop Transaktion), Abweichung oder fehlender Fingerprint ⇒ 409 `email_draft_changed_since_hold` bzw. Desktop-Fehler mit derselben Meldung; aufgeräumt bei Versand, Freigabe und Löschen. Ablauf: `persistManualOutboundApproval` bzw. `applyManualComposeOutboundApproval` (Banner weg, Freigabe-Marker für den aktuellen Inhalt), Planung gelöscht, `sync_info` `outbound_review_skipped:<id>` = Freigabe-Marker, Audit (`email_message.outbound_review_skipped` bzw. `email.outbound_review_skipped`), dann synchron über den normalen Sendepfad.

## Kennzeichnung „gesendet von“ (Teilautomatisierung P3)

- Spalten an `email_messages` (Server-Migration `0055_email_message_sent_provenance`, Desktop idempotent in `electron/email/email-sent-provenance-schema.ts`): `draft_origin_kind` (`ai`|`workflow`), `draft_origin_workflow_id`, `draft_origin_edited`, `sent_by_kind` (`human`|`ai_auto`|`ai_approved`|`workflow`|`relay`), `sent_by_user_id`, `sent_by_workflow_id`, `sent_by_label` (Namens-Schnappschuss), `sent_outbound_review_skipped`; Index auf (Workspace,) `sent_by_kind`.
- Entwurfs-Herkunft setzen die Knoten, die Entwürfe anlegen: `ai.draft_reply`, `ai.agent`, `ai.pick_canned` ⇒ `ai`; `email.create_draft`, Weiterleitungskopie ⇒ `workflow`; `send_draft`/`release_outbound` (ohne menschlichen Akteur) nur, wenn noch keine Herkunft steht. Speichern über das Entwurfsfenster (`UpdateComposeDraft` bzw. `PATCH …/compose-draft`) setzt `draft_origin_edited` nur bei einem echten Unterschied (`draftContentChanged`: Betreff, Text ohne Leerraum-/HTML-Unterschiede und ohne Hinweis „Versand blockiert“ — Text- und HTML-Fassung zählen beide, ebenso Link-/Bildziele; bei HTML mit Zonen-Markern des Entwurfsfensters nur Anrede und Text, Signatur- und Zitat-Zone zählen nicht —, Empfänger-Adressen, Anhänge, Konto) — das Fenster speichert vor jedem Senden alle Felder.
- Bestimmung beim Übergang zu `folder_kind = 'sent'` (`determineSentProvenance`, `packages/core/src/email/sent-provenance.ts`): Workflow ohne Menschen (Server: Trusted Service bzw. Platzhalter `system`; Desktop: Workflow-Versand) ⇒ `ai_auto` bei KI-Herkunft, sonst `workflow`; Mensch ⇒ `ai_approved` bei unveränderter KI-Herkunft, sonst `human`; SMTP-Relay ⇒ `relay` (Name des Relays). `sent_outbound_review_skipped` gilt, solange `sync_info` `outbound_review_skipped:<id>` dem Freigabe-Marker entspricht; der Marker wird danach gelöscht.
- Aufrufstellen: Server `finalizeSentDraft` (`packages/server/src/mail-compose-send.ts`) → `store.recordSentProvenance` → `recordSentProvenance` (`packages/server/src/mail-sent-provenance.ts`), unmittelbar vor `markDraftAsSent`; Desktop `finalizeSentDraft` (`electron/email/email-compose-send.ts`) → `recordSentProvenance` (`electron/email/email-sent-provenance.ts`) direkt nach `markDraftAsSent` (best effort). Beide liefern die ermittelte `SentProvenance` zurück — Andockpunkt für Folgefunktionen nach dem Versand.
- Ansicht `sent_ai` („Gesendet (KI)“) = gesendet, kein Spam, `sent_by_kind IN ('ai_auto','ai_approved','workflow')` — Liste, Thread-Liste und view-gebundene Suche beider Editionen; kein Ziel für Verschieben.
- Server-Sync des Gesendet-Ordners: Eine per IMAP gefundene Server-Kopie übernimmt die lokale Gesendet-Zeile (gleiche `message_id`, `uid < 0`) statt eine zweite anzulegen (Parität zu Desktop `tryPromoteLocalSentImapRow`); die Kennzeichnung bleibt erhalten.
- Desktop→Server-Import (`postgres-core-mail-import.ts`) übernimmt die Spalten; unbekannte Werte werden verworfen, Workflow-IDs über `source_sqlite_id` aufgelöst, `sent_by_user_id` bleibt leer (Desktop-Nutzer-IDs sind keine Server-Nutzer).

## Smoke-Check 2026-06-01

Automatisierte Stichprobe (CI-äquivalent, lokal):

| Trigger | Tests | Ergebnis |
|---------|--------|----------|
| Inbound | `email-workflow-engine.core`, `workflow-inbound-conditions` | OK |
| Outbound | `email-workflow-engine.core`, `email-compose-send` | OK |
| Schedule | `workflow-scheduled-fire`, `email-workflow-engine.core` | OK |

Manuell empfohlen: Vorlage pro Trigger aktivieren → Lauf-Historie; „Jetzt ausführen“ bei Schedule; Compose „Ausgang prüfen“ (Dry-Run); Switch-Fälle und Loop-Limit im Editor speichern/neu laden.

## Bekannte Grenzen (nach P7)

- Embeddings nur wenn OpenAI-Key konfiguriert; sonst Keyword-RAG.
- Subflow: Aufruf per Workflow-ID, kein eingebetteter Nested-Graph-Editor.
- JTL: Lookup/Masterdata, keine vollständige Auftragserstellung.
- HTTP-Allowlist: `sync_info` Key `workflow_http_allowlist` (kommaseparierte Hosts).
- `draft_created` nur bei neuem Entwurf, nicht bei jedem Update.
- Externe Outbound-Webhook-Subscriptions bleiben API-Roadmap; der interne Trigger `webhook.incoming` ist angebunden.
- Schleifen (F-A9-04): Ein Knoten, der den Lauf deferiert, ist im Je-Eintrag-Zweig nicht erlaubt (Desktop: `logic.delay`; Server zusätzlich KI-, HTTP-, Weiterleitungs- und DMARC-Knoten mit Folgeknoten, `ai.draft_reply`/`ai.agent`/`ai.pick_canned`/`ai.review_draft` immer). Die Runtime beendet den Lauf vor dem Einreihen mit Fehler, der Editor warnt (`findLoopBodyDeferringNodes`). Server: Fortsetzungen zählen `__continuation_hops`; ab 100 Fortsetzungen einer Lauf-Kette bricht der Lauf ab (Schranke gegen Kreise über asynchrone Knoten).
- Server, asynchrone Knoten (KI, HTTP, Weiterleitung, DMARC, Verzögerung, Subflow): Job-Payload und Fortsetzung tragen `body_text` höchstens mit 48 000 Zeichen (`combined_text` aus dem gekürzten Text neu gebaut, `body_truncated = 'true'`). Der synchrone Teil vor der Pause sieht den vollen Text; Bedingungen nach der Fortsetzung sehen nur den Anfang (F-D1-05).

*Bewusst nicht geplant (vgl. Vision Kap. 9):* Omni-Channel, Multi-User-Kollaboration am Graph, freie Shell-Befehle.

*Nicht mehr ausgeschlossen:* **Auto-Send** existiert seit 2026-07 — aber mehrfach abgesichert statt „ohne Freigabe“: Master-Schalter (Default aus, UI in Einstellungen → Automatisierung) + `email.auto_reply`-Gate (Confidence, No-Reply-/Automaten-Filter) + KI-Gegenprüfung (`ai.review_draft`, fail-safe: im Zweifel wartet der Entwurf auf menschliche Freigabe) + Anti-Loop (RFC 3834, Tageslimit pro Absender).
