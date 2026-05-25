# Workflow-Phasen — Umsetzungsstand (W0–W6)

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

## Architektur (kurz)

- **Ausführung:** `execution_mode = graph` (Standard) → `runWorkflowGraph`; sonst `compiled-fallback` → bestehende Regel-Engine.
- **Knoten:** `electron/workflow/nodes/*` registriert in `register-builtin-nodes.ts`.
- **IPC:** `workflow:*` Kanäle in `shared/ipc/channels.ts`, Handler `electron/ipc/workflow.ts`.

## Backlog P1–P7 (✅ umgesetzt)

| Prio | Thema | Lieferung |
|------|--------|-----------|
| **P1** | Delay-Job-Processor | `processDueDelayedJobs` im E-Mail-Cron; Resume via `executeWorkflowForTrigger` + `startNodeId`; `resolveResumeNodeAfter` |
| **P2** | CRM-/Kalender-Trigger | `workflow-trigger-dispatch.ts`; `crm.deal_stage_changed` bei `updateDealStage`; Cron-Scan für `task.due` / `calendar.event_start` (15-Min-Fenster, Dedup 60s) |
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

## Bekannte Grenzen (nach P7)

- Embeddings nur wenn OpenAI-Key konfiguriert; sonst Keyword-RAG.
- Subflow: Aufruf per Workflow-ID, kein eingebetteter Nested-Graph-Editor.
- JTL: Lookup/Masterdata, keine vollständige Auftragserstellung.
- HTTP-Allowlist: `sync_info` Key `workflow_http_allowlist` (kommaseparierte Hosts).
- `draft_created` nur bei neuem Entwurf, nicht bei jedem Update.
- `webhook.incoming`, `crm.customer_created` noch nicht als Trigger.

*Bewusst nicht geplant (vgl. Vision Kap. 9):* Omni-Channel, Multi-User-Kollaboration am Graph, freie Shell-Befehle, Auto-Send ohne Freigabe.
