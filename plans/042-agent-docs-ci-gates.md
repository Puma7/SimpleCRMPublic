# Plan 042: AGENTS.md and the handoff doc list every CI gate and the server runtime

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") **and** tick its checkbox in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- AGENTS.md docs/AGENT_HANDOFF.md .github/workflows/ci.yml package.json`
> Plans 030 and 031 are expected to have changed `ci.yml` and `package.json` — that is the state this plan
> documents, so read those two files live (Step 1). Any change to `AGENTS.md` or `docs/AGENT_HANDOFF.md`:
> compare with the excerpts below; if the quoted lines are gone or reworded, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/031-ci-single-jest-coverage-run.md (and therefore 030). Run this plan only after 031 is
  DONE, or after 031 was marked REJECTED/DROPPED in `plans/README.md` — then document whatever `ci.yml` does at that point.
- **Category**: docs
- **Planned at**: commit `9e0491e3`, 2026-09-27

Audit check: the finding holds. `packages/server/src` has 300 `.ts` files excluding `.d.ts` (the doc says "~185").

## Why this matters

`AGENTS.md` is the first file every coding agent reads. Its command table lacks `pnpm run typecheck` and all
coverage ratchets, although CI fails on each of them, so agents push work that passes the documented commands
and fails CI. Its step "Run focused tests and typecheck" names no command, it does not warn that the embedded
PostgreSQL suites cannot run as root (a common agent environment), and `docs/AGENT_HANDOFF.md` describes only
the desktop workflow runtime. After this plan, both docs list exactly what CI enforces and how to reproduce
each gate locally, with no hard-coded counts that go stale.

## Current state

- `AGENTS.md:20`: `- **Server edition** — a Fastify HTTP API (\`packages/server\`, ~185 source files) backed by PostgreSQL, …`
- `AGENTS.md:24-39` — "### Key commands" table: Install deps, Lint, Unit + integration tests (`pnpm test`), Unit
  tests only, Mail module tests (`pnpm run test:mail`), Mail module coverage (`pnpm run test:mail:coverage`,
  labelled "ratchet on `electron/email`"), Integration tests only, Build, Dev mode, Production mode. No
  typecheck, no server/UI ratchet, no `build:packages`.
- `AGENTS.md:50-51` (Gotchas):
  ```
  - **Mail tests in CI:** GitHub Actions runs `pnpm run test:mail` after the main Jest suite (see `.github/workflows/ci.yml`).
  - **Mail coverage:** `jest.mail.config.cjs` collects coverage from `electron/email/**/*.ts` with a **ratchet** threshold (~91% lines, ~80% branches). Run `pnpm run test:mail` while iterating (threshold disabled); use `pnpm run test:mail:coverage` before merging mail changes. See [`docs/MAIL_TESTING.md`](docs/MAIL_TESTING.md).
  ```
  (The "~91%/~80%" is the hard `coverageThreshold` in `jest.mail.config.cjs`, not the ratchet; after plan 030 CI
  runs `pnpm run test:mail:coverage:check` against `mail-coverage-baseline.json`.)
- `AGENTS.md:78-85` — "### Preferred implementation loop", step 5: `Run focused tests and typecheck.`
- `docs/AGENT_HANDOFF.md:17`: `5. Verify: \`pnpm run check:typescript-toolchain\`, \`pnpm test\`, \`pnpm run build\`, \`pnpm run lint\`.`
- `docs/AGENT_HANDOFF.md:39-43` — "## 3. Architecture — workflows": execution source `email_workflows.graph_json`;
  `**Runtime:** \`electron/workflow/runtime.ts\` → node registry in \`electron/workflow/nodes/*.ts\`.`; triggers line.
- `docs/AGENT_HANDOFF.md:71-85` — "## 5. Key files" table (IPC mail, Backup, Compose, Workflow UI, … Atomic task/calendar); no server workflow runtime row.
- Server workflow runtime facts (verified): `packages/server/src/workflow-execution.ts` (8,832 lines) exports
  `createPostgresWorkflowExecutionJobPort` (`:484`) and is used by the job worker
  (`packages/server/src/jobs/workflow-schedule-tick.ts`, `packages/server/src/server.ts`); shared, edition-neutral
  workflow logic lives in `packages/core/src/workflow/` (e.g. `graph-compile.ts`, `graph-validate.ts`,
  `cron-schedule.ts`, `ai-decide.ts`).
- Embedded PostgreSQL: `tests/integration/helpers/embedded-postgres.ts:26` — "Initdb refuses to run as root, so
  these suites only run as a normal user (as in CI)." About 70 files in `tests/integration/` use it.
- CI at `9e0491e3` (`.github/workflows/ci.yml`), before plans 030/031 — three jobs:
  - `build-and-test`: install (`pnpm install --frozen-lockfile`) → `pnpm run check:typescript-toolchain` →
    Svelte lab `npm ci --legacy-peer-deps --prefix packages/svelte-lab` + build → electron `path.txt` →
    `npm rebuild better-sqlite3` → `pnpm run lint` → `pnpm test` → `pnpm run test:mail` →
    `pnpm run test:server:coverage` + `node scripts/check-server-coverage-ratchet.mjs` →
    `pnpm run test:ui:coverage:check` → `pnpm run typecheck` → `pnpm run build`.
  - `electron-e2e` (ubuntu-22.04): Xvfb + keyring, `pnpm run test:e2e`.
  - `server-compose-smoke`: Docker Compose config validation, then boots postgres/migrate/api/caddy and runs
    backup, doctor and restore drill.
  Expected after 030 + 031 (confirm in Step 1): `pnpm test` + server + UI coverage steps replaced by
  `pnpm run test:ci:coverage` followed by `node scripts/check-server-coverage-ratchet.mjs` and
  `node scripts/check-ui-coverage-ratchet.mjs`; mail step `pnpm run test:mail:coverage:check`; an
  "Upload coverage summaries" artifact step.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;` in this environment.

| Purpose | Command | Expected |
|---|---|---|
| Lint (markdown is not linted; run to be safe) | `pnpm run lint` | exit 0, 0 warnings |
| List CI steps | `grep -n "name:\|run:" .github/workflows/ci.yml` | readable step list |
| List scripts | `node -e 'const s=require("./package.json").scripts; for (const k of Object.keys(s)) if (/^(test|typecheck|lint|build)/.test(k)) console.log(k, "=>", s[k])'` | script list |
| Check every documented `pnpm run X` exists | see Step 4 | no output |

## Scope

**In scope**: `AGENTS.md` (sections "Project overview", "Key commands", "Gotchas", new "CI gates", "Preferred
implementation loop" step 5), `docs/AGENT_HANDOFF.md` (§1 item 5, §3, §5, header "Last updated").

**Out of scope**: `.github/workflows/ci.yml`, `package.json`, any script or test (this plan only documents);
`docs/MAIL_TESTING.md` (plan 030 updated it); `README.md`; the "Hermes autonomous working mode" rules in
`AGENTS.md` other than step 5 of the loop. No CHANGELOG entry.

## Git workflow

- Branch: `advisor/042-agent-docs-ci-gates`
- German commit message with area prefix, e.g. `Doku: CI-Pflichtprüfungen und Server-Laufzeit in AGENTS.md und Handoff`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Capture the live CI and script state

Run the two listing commands from the table. Write down, for job `build-and-test`, every step that can fail the
build, in order, with its exact `run:` command; plus the other two jobs in one line each. Check `plans/README.md`
for the status of 030 and 031.

**Verify**: 031 is DONE, REJECTED or DROPPED (otherwise STOP); you have the ordered step list.

### Step 2: Update AGENTS.md

1. Line 20: replace `(\`packages/server\`, ~185 source files)` with `(\`packages/server\`)` — no counts.
2. Key commands table: add rows (use the script names that exist in `package.json` now):
   `Typecheck (all packages + renderer + electron main)` → `pnpm run typecheck`;
   `Build workspace packages` → `pnpm run build:packages`;
   `Focused test` → `pnpm exec jest <path/to/file.test.ts>`;
   `Server coverage ratchet` → the local command pair (`pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs`);
   `Email UI coverage ratchet` → `pnpm run test:ui:coverage:check`;
   `Mail coverage ratchet` → `pnpm run test:mail:coverage:check` (replace the old "Mail module coverage" row);
   `Raise a coverage baseline` → `pnpm run test:<server|ui|mail>:coverage:update-baseline`;
   if 031 is DONE also `CI's single coverage run` → `pnpm run test:ci:coverage`.
3. New section `### CI gates` directly after "Key commands": one table with columns *CI job / step*,
   *Command CI runs*, *Reproduce locally*, filled from Step 1 in CI order (toolchain check, lint, tests/coverage,
   mail, server ratchet, UI ratchet, typecheck, build; then `electron-e2e` and `server-compose-smoke` as one row
   each, with `xvfb-run --auto-servernum pnpm run test:e2e` and `docs/SETUP_SERVER.md` as the local pointers).
   Below the table, one sentence: coverage ratchets fail when coverage drops more than 1 point below the
   committed `*-coverage-baseline.json` **or** exceeds it by more than 2 points (then raise the baseline).
   Tell readers `.github/workflows/ci.yml` is the source of truth if this table and the workflow disagree.
4. Gotchas: replace the two mail bullets (lines 50–51) with one bullet describing the state after 030 (CI runs
   `pnpm run test:mail:coverage:check`; `pnpm run test:mail` while iterating; the ratchet compares against
   `mail-coverage-baseline.json`; link `docs/MAIL_TESTING.md`). Add a bullet:
   **Embedded PostgreSQL tests need a non-root user.** Suites using `tests/integration/helpers/embedded-postgres.ts`
   start `initdb`, which refuses to run as root; CI runs as an unprivileged user. As root, run Jest as a normal
   user (e.g. `su <user> -c "cd <repo> && node_modules/.bin/jest --cacheDirectory /tmp/jest-<user> <file>"` after
   making the checkout writable for that user). Server coverage measured as root is several points too low.
5. Preferred implementation loop step 5: `Run focused tests (\`pnpm exec jest <file>\`) and \`pnpm run typecheck\`; before handing off, run the CI gates that cover the files you touched (see "CI gates").`

**Verify**: `grep -n "185\|~91%" AGENTS.md` → no output; `grep -n "### CI gates\|pnpm run typecheck\|non-root" AGENTS.md` → matches.

### Step 3: Update docs/AGENT_HANDOFF.md

1. §1 item 5: `Verify: see the "CI gates" table in [\`AGENTS.md\`](../AGENTS.md) — at minimum \`pnpm run lint\`, \`pnpm run typecheck\`, \`pnpm test\`, \`pnpm run build\`.`
2. §3: rename the runtime bullet to `**Runtime (Desktop):**` (unchanged text) and add
   `**Runtime (Server):** \`packages/server/src/workflow-execution.ts\` (\`createPostgresWorkflowExecutionJobPort\`, run by the job worker, schedules via \`packages/server/src/jobs/workflow-schedule-tick.ts\`); edition-neutral logic (graph compile/validate, cron, AI decide) in \`packages/core/src/workflow/\`.`
3. §5 Key files: add rows `Workflow runtime (Server)` → `packages/server/src/workflow-execution.ts`,
   `Shared workflow logic` → `packages/core/src/workflow/`, `CI gates` → `.github/workflows/ci.yml`, `AGENTS.md` ("CI gates").
4. Header "Last updated": today's date and "CI-Gates dokumentiert (Plan 042)", keep the rest.

Before writing each path, confirm it exists: `ls packages/server/src/workflow-execution.ts packages/server/src/jobs/workflow-schedule-tick.ts packages/core/src/workflow/`.

**Verify**: `grep -n "workflow-execution.ts\|CI gates" docs/AGENT_HANDOFF.md` → at least 3 matches.

### Step 4: Check every documented command exists

```bash
for s in $(grep -ohE 'pnpm run [a-z0-9:_-]+' AGENTS.md docs/AGENT_HANDOFF.md | awk '{print $3}' | sort -u); do
  node -e 'const s=require("./package.json").scripts; process.exit(s[process.argv[1]]?0:1)' "$s" || echo "MISSING: $s"
done
for f in $(grep -ohE 'scripts/[a-z0-9_-]+\.mjs' AGENTS.md docs/AGENT_HANDOFF.md | sort -u); do test -f "$f" || echo "MISSING: $f"; done
```

`test:<server|ui|mail>:coverage:update-baseline` is a pattern, not a literal — it will not be matched by the loop.

**Verify**: the loops print nothing.

## Test plan

Documentation only: Step 4's existence checks plus the greps in each step. `pnpm run lint` stays green.

## Done criteria

- [ ] Step 4 prints nothing
- [ ] `grep -c "~185" AGENTS.md` → `0`
- [ ] The "CI gates" table has one row per failing-capable step of `build-and-test` in `ci.yml` (count them) plus one row each for `electron-e2e` and `server-compose-smoke`
- [ ] `git status` shows only `AGENTS.md`, `docs/AGENT_HANDOFF.md`, `plans/README.md`, `plans/MASTERPLAN.md` changed
- [ ] Row 042 updated in `plans/README.md` (Runde 2) and box ticked in `plans/MASTERPLAN.md`

## STOP conditions

- Plan 031 is TODO or IN PROGRESS (documenting now would describe CI that is about to change).
- `ci.yml` runs a command that does not exist in `package.json` (CI would be broken — report instead of documenting it).
- A path you are about to document does not exist.

## Maintenance notes

- Whoever changes `ci.yml` must update the "CI gates" table in the same PR; the table points to `ci.yml` as the
  source of truth, but agents read the table first.
- Keep counts out of these docs (files, tests, lines) — they go stale within weeks.
