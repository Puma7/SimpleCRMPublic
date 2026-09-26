# Learnings — master index (for humans & AI)

Short, durable facts discovered during implementation. **Read before refactoring** the e-mail or workflow subsystems.

---

## Where to look

| Area | File |
|------|------|
| **Agent continuity (start here)** | [AGENT_HANDOFF.md](AGENT_HANDOFF.md) |
| Auth / Login-Sicherheit / Server-Setup | [LEARNINGS_AUTH.md](LEARNINGS_AUTH.md), [LOGIN_SECURITY.md](LOGIN_SECURITY.md) |
| CRM (Kunden, Deals, Follow-up, JTL) | [CRM_PRODUCT_GUIDE.md](CRM_PRODUCT_GUIDE.md), [DEVELOPER_CRM.md](DEVELOPER_CRM.md) |
| E-mail / sync / SQLite / UI | [LEARNINGS_EMAIL.md](LEARNINGS_EMAIL.md) |
| Workflows / graphs / outbound / spam | [LEARNINGS_WORKFLOW.md](LEARNINGS_WORKFLOW.md) |
| Doc map | [INDEX.md](INDEX.md) |

---

## Cross-cutting (whole repo)

1. **Pinned toolchain** — use Node.js 24 LTS and pnpm 11.13.1; `pnpm run check:typescript-toolchain` rejects TypeScript below 7.0.2 and legacy compiler integrations.
2. **Package managers** — use `pnpm install` at the root. Only isolated `packages/svelte-lab` uses its own npm lock with `npm ci --legacy-peer-deps`.
3. **Native modules** — Node 24 uses ABI 137 while Electron 43 uses ABI 148. `pnpm run native:initialize` caches both `better-sqlite3` binaries; Electron scripts switch with `run-with-electron-native.mjs` and restore Node in `finally`. Do not run `electron-rebuild` directly. The patch guard accepts both the legacy direct `HolderV2` patch and the upstream `PROPERTY_HOLDER` macro.
4. **CommonJS to ESM dependencies** — load ESM-only packages such as `archiver`, `electron-store`, and `openpgp` with memoized dynamic imports from Electron/server CommonJS output.
5. **Compatibility exceptions** — `@types/node` stays on the Node 24 major; Kysely stays at the security-patched `0.28.17` until the CommonJS server is migrated because 0.29 is ESM-only.
6. **Graphile Worker 0.17 migration** — old API/worker replicas must be scaled to zero before the new version starts and migrates its lock schema; `docker/update.sh` enforces this ordering.
7. **IPC contracts** — payload and result schemas are enforced at runtime. Destructive CRM handlers return `{ success, error? }`; schema mismatches can mutate SQLite and still make the renderer report failure.
8. **Electron E2E** — use `launchAuthenticatedElectron` so suites get a temporary standalone profile, complete first-run authentication, and never depend on the developer's local account or database. The Chromium sandbox is the default; `SIMPLECRM_E2E_NO_SANDBOX=1` is only a local diagnostic fallback. CI stores Playwright artifacts and `test-results/electron-logs`.
9. **Secrets** — Keytar / env, never commit API keys or mail passwords.
10. **German UI** — user-facing strings in German; docs may be EN/DE mixed.
11. **Embedded Postgres tests** — `initdb` refuses root; run `tests/integration/postgres-*` as a non-root user. Migrations must work under FORCE RLS as the non-superuser app role (helper `startMigratedEmbeddedPostgres`); a data backfill without `set_config` workspace context silently updates nothing (see migration 0053).
12. **Secrets bound to endpoints** — changing a stored host/port/TLS (mail, MSSQL test) or an AI `baseUrl`/provider must require re-entering the secret server-side, otherwise the stored credential is sent to an attacker-chosen host.
13. **Untrusted HTML/regex** — never strip HTML with backtracking regexes (`/<[^>]+>/`, `<style[\s\S]*?</style>`) on mail content; use the linear helpers in `packages/core/src/email/parse-utils.ts` (`plainTextFromHtml`, `stripHtmlTagsToText`, `replaceElementBlocks`). Insert user values with callback replacements so `$&`/`$'` are not patterns, and interpolate placeholders in a single pass.
14. **Archive/parse differentials** — guard ZIP bombs with the same parser that later reads the file (JSZip for mammoth); yauzl can be shown different entries. mailparser `headerLines` are `{key,line}` objects — join `.line`.
15. **Module cycles** — class exports in modules that sit in an import cycle (e.g. `electron/sqlite-service.ts`) are in the temporal dead zone during load and break `{ ...jest.requireActual() }` mocks; put error classes in their own module.
16. **Operator scripts** — `docker/simplecrm`, `update.sh` and `restore-compose.sh` accept a `:`-separated `COMPOSE_FILE`; the SMTP relay override must be listed there or updates recreate the API without relay ports. `TRUST_PROXY` must name proxy IPs/CIDRs (Compose: Caddy's fixed `CADDY_PROXY_IP` on its own network); hop counts are rejected at startup because Fastify ≥ 5.12 ignores them.
17. **Worker limits** — a process-wide `--max-old-space-size` (also via `NODE_OPTIONS`) silently replaces `worker_threads` `resourceLimits`; the DOCX worker therefore watches `getHeapStatistics()` itself when the limit was overridden. Under Jest `process.env` is a sandbox copy: pass `env: process.env` to a `Worker` so test settings such as `TSX_TSCONFIG_PATH` reach it (CI has no `packages/core/dist`).
18. **Desktop IPC scope** — every IPC payload with an object id must resolve to its mail account in `electron/ipc/ipc-account-scope.ts` or be listed as global with a reason; `unresolved` is owner/admin only, and every account channel declares its level (`ro`/`rw`). Inventory and classification tests fail when a new channel is missing.
19. **Event streams mirror REST** — WebSocket/replay delivery of non-mail events uses `NON_MAIL_EVENT_READ_POLICY` (same right as the REST read route; unknown families admin-only). Add new event families there, or the inventory test fails.
20. **Worktree type checks** — in a git worktree whose `packages/server/node_modules` is a symlink to the main checkout, `tsc -b packages/server` checks against the main checkout's `packages/core/dist`; rebuild core in the main checkout (or use a `paths` override) before trusting the result.
21. **Timing assertions under coverage** — CI runs the unit tests again under the server and UI coverage configs; instrumented code is several times slower, so a "stays fast" test only catches real super-linear behaviour. Parsers of model output must bound their work (step budget), not just the input length.
22. **Outbound hold helper** — every final outbound block on the server goes through `persistOutboundBlockOnDraft` (`packages/server/src/mail-outbound-hold.ts`): it sets the real reason, rewrites the draft banner and clears the schedule so the draft shows up in the inbox. Writing `outbound_hold` directly leaves automatic replies invisibly scheduled.
23. **One clock per comparison** — Postgres `now()` has microseconds, a JS `Date` only milliseconds. A test that seeds `created_at` with `now()` and then filters `created_at <= new Date()` loses the row whenever both fall into the same millisecond (measured: most of the time right after a query). Seed timestamps from the same clock the code under test uses.
24. **Updates** — server: `sh docker/simplecrm update --version latest` (release tag, backup, health wait, printed way back); desktop: the packaged app snapshots `database.sqlite` to `backups/pre-update/` before the first start of a new version (`electron/maintenance/pre-update-backup.ts`). User guide: README „Aktualisieren“.
9. **Ist-stand vs vision** — `WORKFLOW_PHASES.md` = implemented; `WORKFLOW_VISION.md` = long-term (many 🔲 are already done).

---

## E-mail (summary — details in LEARNINGS_EMAIL.md)

- POP3: use **UIDL** (`pop3_uidl`), not volatile message numbers.
- “Real mail” filter: `(uid >= 0 OR pop3_uidl IS NOT NULL)`; drafts are `uid < 0` without uidl.
- Outbound workflows: **fail-closed**; run all workflows before final block decision.
- Viewer: **plain text only**; compose: sanitize HTML (DOMPurify).
- **Compose SMTP outbox:** `sync_info` Claim `outbox` **before** SMTP; retry on `outbox`/`1` ohne erneuten Versand.
- **`forward_copy` dedupe (Server):** Insert **before** SMTP; delete dedup row on SMTP failure so retries work.

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
