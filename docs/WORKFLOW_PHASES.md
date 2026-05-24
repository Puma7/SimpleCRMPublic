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

## Nächste sinnvolle Schritte

1. Delay-Job-Processor beim App-Start / Cron.
2. Embeddings optional (OpenAI / lokales Modell).
3. Deal/Calendar-Trigger an CRM-Events koppeln.
