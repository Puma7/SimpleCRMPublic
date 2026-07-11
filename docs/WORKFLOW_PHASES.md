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

*Bewusst nicht geplant (vgl. Vision Kap. 9):* Omni-Channel, Multi-User-Kollaboration am Graph, freie Shell-Befehle.

*Nicht mehr ausgeschlossen:* **Auto-Send** existiert seit 2026-07 — aber mehrfach abgesichert statt „ohne Freigabe“: Master-Schalter (Default aus, UI in Einstellungen → Automatisierung) + `email.auto_reply`-Gate (Confidence, No-Reply-/Automaten-Filter) + KI-Gegenprüfung (`ai.review_draft`, fail-safe: im Zweifel wartet der Entwurf auf menschliche Freigabe) + Anti-Loop (RFC 3834, Tageslimit pro Absender).
