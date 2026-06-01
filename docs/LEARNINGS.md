# Learnings — master index (for humans & AI)

Short, durable facts discovered during implementation. **Read before refactoring** the e-mail or workflow subsystems.

---

## Where to look

| Area | File |
|------|------|
| **Agent continuity (start here)** | [AGENT_HANDOFF.md](AGENT_HANDOFF.md) |
| CRM (Kunden, Deals, Follow-up, JTL) | [CRM_PRODUCT_GUIDE.md](CRM_PRODUCT_GUIDE.md), [DEVELOPER_CRM.md](DEVELOPER_CRM.md) |
| E-mail / sync / SQLite / UI | [LEARNINGS_EMAIL.md](LEARNINGS_EMAIL.md) |
| Workflows / graphs / outbound / spam | [LEARNINGS_WORKFLOW.md](LEARNINGS_WORKFLOW.md) |
| Doc map | [INDEX.md](INDEX.md) |

---

## Cross-cutting (whole repo)

1. **`npm install --legacy-peer-deps`** — required; peer tree conflicts otherwise.
2. **Native modules** — run `npm run postinstall` after Node/Electron version changes (`better-sqlite3`, `keytar`).
3. **Secrets** — Keytar / env, never commit API keys or mail passwords.
4. **German UI** — user-facing strings in German; docs may be EN/DE mixed.
5. **Ist-stand vs vision** — `WORKFLOW_PHASES.md` = implemented; `WORKFLOW_VISION.md` = long-term (many 🔲 are already done).

---

## E-mail (summary — details in LEARNINGS_EMAIL.md)

- POP3: use **UIDL** (`pop3_uidl`), not volatile message numbers.
- “Real mail” filter: `(uid >= 0 OR pop3_uidl IS NOT NULL)`; drafts are `uid < 0` without uidl.
- Outbound workflows: **fail-closed**; run all workflows before final block decision.
- Viewer: **plain text only**; compose: sanitize HTML (DOMPurify).
- `forward_copy` dedupe: record **after** successful SMTP.

---

## Workflows (summary — details in LEARNINGS_WORKFLOW.md)

- **Execution = graph** (`graph_json`) + node registry; not hidden JSON rule programs.
- Registry nodes (`ai.spam_score`, …) **never** run in `compiled` mode — only in graph interpreter.
- `definition_json` is a **legacy export** for simple condition/action chains.
- Validate outbound with **`dryRun`** — must not set `outbound_hold` or rewrite draft body.
- Global spam threshold: settings key `workflow_spam_score_threshold` + `logic.threshold` `useGlobalThreshold: true`.
- Schedule cron: runs **graph** after optional inbox sync — not “log only”.
- Tests: mock `sqlite` / avoid Electron `app` when loading plugin registry in Jest.

---

## Automation API (PR #18)

- Only paths under `/api/v1`; scope checks on handlers.
- Workflow HTTP execute uses same `executeWorkflowForTrigger` as desktop.
- See `SECURITY_AUTOMATION_API.md` for fail-closed auth notes.

---

## How to extend this file

When you learn something non-obvious that caused a bug or wrong assumption:

1. Add one bullet to the right domain file (`LEARNINGS_EMAIL` or `LEARNINGS_WORKFLOW`).
2. If it affects both domains, add a one-liner here under **Cross-cutting**.
3. Update `AGENT_HANDOFF.md` §10 **Known gaps** if the learning closes a gap.
