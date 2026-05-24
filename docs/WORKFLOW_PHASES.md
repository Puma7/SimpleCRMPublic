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

## Bekannte Grenzen (nach W6)

- Keine echten Embedding-Vektoren (RAG = Stichwort-Score).
- `logic.delay` legt Jobs an; separater Cron-Worker für Resume noch minimal.
- Subflows / Versionierung nur über Export-JSON, kein Git-UI.
- HTTP-Allowlist: `sync_info` Key `workflow_http_allowlist` (kommaseparierte Hosts).

## Nächste sinnvolle Schritte (priorisiert)

| Prio | Thema | Begründung |
|------|--------|------------|
| **P1** | **Delay-Job-Processor** — fällige `workflow_delayed_jobs` beim Start/Cron ausführen und Graph an `resume_node_id` fortsetzen | `logic.delay` ist nur halb produktiv ohne Resume |
| **P2** | **CRM-/Kalender-Trigger** (`crm.deal_stage_changed`, `task.due`, `calendar.event_start`) | In Vision als 🔲, für echte Querschnitts-Automation |
| **P3** | **Embeddings-RAG** (optional API/lokal) statt nur Keyword-Score | Bessere KI-Agent-Antworten |
| **P4** | **`logic.switch` / `merge` / `loop`** | Komplexere Verzweigungen ohne Code-Knoten |
| **P5** | **IMAP-Aktionen** (`email.move_imap`, ggf. `delete_server` mit Opt-in) | Postfach-Automation auf Server-Ebene |
| **P6** | **Subflows + Versionierung** (UI), **Monaco** für Experten-Modus | W6-Lücken aus Vision |
| **P7** | **JTL / MSSQL**-Knoten, `ai.agent_tool` | Integrationen für Power-User |

*Bewusst nicht geplant (vgl. Vision Kap. 9):* Omni-Channel, Multi-User-Kollaboration am Graph, freie Shell-Befehle, Auto-Send ohne Freigabe.
