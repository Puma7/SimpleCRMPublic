# Plan 013: Fix AGENTS.md/README architecture claims and package-manager guidance

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`)
> — unless a reviewer dispatched you and told you they maintain the index.
> (For this plan, the advisor maintains `plans/README.md`; do NOT create or
> edit it.)
>
> **Drift check (run first)**: `git diff --stat f24fb27..HEAD -- AGENTS.md README.md`
> If either file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. **Expected-drift exception:** plan 012
> (which the index sequences BEFORE this one) also edits the `npm install
> --legacy-peer-deps` → pnpm guidance in these files. If the ONLY changes are
> 012's package-manager edits, that is expected — proceed and layer this plan's
> architecture/overview fixes on top (skip the now-redundant pnpm edits, keep the
> "no backend server" / editions fixes). Treat any OTHER change to the excerpted
> sections as drift and STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/012-single-package-manager-pnpm.md — soft/ordering
  dependency: 012 rewrites the `npm`→`pnpm` install guidance in the same
  `AGENTS.md`/`README.md` this plan edits. Run 012 first (per the index) and honor
  the expected-drift exception in the drift check; if 012 has NOT landed, this
  plan may still run but must also apply the pnpm command fix itself.
- **Category**: docs
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

`AGENTS.md` is the first file an AI agent (or new contributor) reads, and its
"Project overview" flatly states "There is no backend server" — but the repo
ships a full **server edition**: a Fastify HTTP API in `packages/server` (185
source files), a Docker Compose stack under `docker/`, dedicated docs, and a
CI job (`server-compose-smoke`) that boots and smoke-tests the whole thing. An
agent that trusts the overview will make wrong architectural decisions. The
same file tells contributors to install with `npm install --legacy-peer-deps`
while CI is authoritative on `pnpm install --frozen-lockfile`
(`.github/workflows/ci.yml`), so anyone following the docs diverges from CI on
their very first command. It also hardcodes one operator's Windows machine as
environment truth. `README.md` compounds this by describing a desktop-only
product and never mentioning the server edition. This plan makes both docs
describe reality: two editions, pnpm-first commands (matching CI), and no
machine-specific notes. It is docs-only — no code or behavior changes.

## Current state

Two files are wrong. Both are in scope.

- `AGENTS.md` — agent-facing project guide. The false claim, the npm commands,
  and the machine-specific note all live here.
- `README.md` — the public project readme; desktop-only, omits the server edition.

Facts verified at `f24fb27` (use these, they are ground truth for this plan):

- The repo is a **pnpm-workspaces monorepo**. `pnpm-workspace.yaml`:
  ```yaml
  packages:
    - "packages/core"
    - "packages/server"
    - "packages/desktop"
  ```
- `packages/server` is a **Fastify + PostgreSQL** HTTP API. `packages/server/package.json`
  has `"name": "@simplecrm/server"`, `"main": "dist/server.js"`, and depends on
  `fastify` (`^5.8.5`) and `@fastify/websocket`. `packages/server/src` contains
  **185 files** (`find packages/server/src -type f | wc -l` → `185`).
- `docker/` holds the server deployment: `docker-compose.yml` (services
  `caddy`, `api`, `postgres`, `migrate`, `backup`, `restore`, `doctor`,
  `restore-drill`, …), `api.Dockerfile`, `web.Dockerfile`, `Caddyfile`, and
  backup/restore scripts.
- CI has a dedicated **`server-compose-smoke`** job in `.github/workflows/ci.yml`
  that runs `docker compose -f docker/docker-compose.yml …` to build, boot, and
  smoke-test the server stack.
- Server docs already exist: `docs/SETUP_SERVER.md`,
  `docs/MIGRATION_STANDALONE_TO_SERVER.md`, `docs/SERVER_EDITION_IMPLEMENTATION.md`
  (all present; `docs/INDEX.md` even has a "## Server edition" section listing them).

### The exact text to change

**`AGENTS.md:17`** (the false overview — one paragraph on one line):
```
SimpleCRM is an Electron + React + TypeScript desktop CRM app. All data is stored locally in SQLite (`better-sqlite3`). There is no backend server; everything runs inside the Electron main process plus a Vite-served renderer.
```

**`AGENTS.md:19-34`** ("### Key commands" table — every command uses `npm`):
```
### Key commands

| Task | Command |
|---|---|
| Install deps | `npm install --legacy-peer-deps` |
| Lint | `npx eslint . --ext ts,tsx --max-warnings 0` |
| Unit + integration tests | `npm test` |
| Unit tests only | `npm run test:unit` |
| Mail module tests | `npm run test:mail` |
| Mail module coverage (ratchet on `electron/email`) | `npm run test:mail:coverage` |
| Integration tests only | `npm run test:integration` |
| Build (web + electron main) | `npm run build` |
| Dev mode | `xvfb-run --auto-servernum npm run electron:dev` |
| Production mode | `npm run electron:start` |

See `package.json` `scripts` for the full list.
```
(These pnpm equivalents are confirmed real scripts in `package.json`: `lint` →
`eslint . --ext ts,tsx --max-warnings 0`, plus `test`, `test:unit`,
`test:mail`, `test:mail:coverage`, `test:integration`, `build`, `electron:dev`,
`electron:start`. `pnpm run test:mail` is already the command CI uses — see
`.github/workflows/ci.yml` and the gotcha at `AGENTS.md:44`.)

**`AGENTS.md:38`** (the `--legacy-peer-deps` gotcha):
```
- **`--legacy-peer-deps` is required** for `npm install` because the dependency tree has peer-resolution conflicts. Without it, install fails.
```

**`AGENTS.md:81-83`** (the machine-specific note — the last section of the file):
```
### Current local environment note

On this Windows machine, broad workflow tests that import Electron may fail if `node_modules/electron/dist/electron.exe` is missing. Reinstalling can require Visual Studio Build Tools because `electron-rebuild` rebuilds native modules such as `better-sqlite3` and `keytar`. Prefer focused server/core tests when the Electron binary is blocked.
```

**`README.md:3`** (intro — desktop-only, no server edition):
```
SimpleCRM is a desktop-based Customer Relationship Management (CRM) application built with Electron, React, and TypeScript. It bundles essential CRM features on your local machine, helping you manage customers, products, deals, tasks, and your schedule. It also offers optional one-way data synchronization from your JTL MSSQL database.
```

**`README.md:87-100`** (the "## Building the Application" section; the new
"Server edition" section will be inserted immediately after line 100, before
"## Configuration" at line 102):
```
## Building the Application

To create an installer (`.exe`, `.dmg`, etc.):

1. **Build the Frontend & Electron Code:**
   ```bash
   npm run build
   ```
   This runs `build:web` (renderer) and `build:electron:main` (compiled IPC/services under `dist-electron/electron/`). The Vite Electron bundle step is included in `npm run build` via `vite build`.
2. **Package with Electron Builder:**
   ```bash
   npm run electron:build
   ```
   The installer will be created in the `dist-build` directory.
```

### Convention to match

Both files are GitHub-flavored Markdown. Relative doc links use
`[Text](docs/FILE.md)` form (see `AGENTS.md:9-13` and `README.md:22-23` for
existing examples). Match that exact link style. Do not touch surrounding
sections beyond the edits specified.

## Commands you will need

This is a docs-only change; the primary gates are `grep`/`test -f`, which need
no install. The lint/build rows are a sanity check only (ESLint targets
`ts,tsx` and does not lint Markdown, so it cannot catch a doc error — it just
confirms you broke nothing else).

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Drift check | `git diff --stat f24fb27..HEAD -- AGENTS.md README.md` | empty (no drift) |
| Link resolve | `for f in docs/SETUP_SERVER.md docs/MIGRATION_STANDALONE_TO_SERVER.md docs/SERVER_EDITION_IMPLEMENTATION.md; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done` | three `OK` lines |
| Scope check | `git status --porcelain` | only `AGENTS.md` and `README.md` modified |
| Lint (sanity) | `pnpm run lint` | exit 0 (unchanged; optional) |

Install (only if you run the sanity lint): `pnpm install --frozen-lockfile` → exit 0.

## Scope

**In scope** (the only files you may modify):
- `AGENTS.md`
- `README.md`

**Out of scope** (do NOT touch, even though they look related):
- `README.md` "Setup & Installation" / "Running" / "Building" `npm install
  --legacy-peer-deps` and `npm run …` commands (lines ~50-100). The README is
  the end-user desktop-install guide, and `npm` (with `npm ci` even used inside
  the Docker build) is an intentional documented path there. This plan only
  *adds* a server-edition section to the README; changing its npm commands is a
  separate decision and out of scope.
- `docs/SETUP_SERVER.md`, `docs/INDEX.md`, `pnpm-workspace.yaml`,
  `.github/workflows/ci.yml`, anything under `packages/` or `docker/` — these
  are the sources of truth you are citing, not editing.
- `plans/README.md` — the advisor owns the index; do not create or edit it.

## Git workflow

- Branch: `advisor/013-docs-correct-editions-and-commands`
- One commit for the whole plan is fine (docs-only). Conventional-commits
  style, matching the repo (example from `git log`: `fix(review): keep
  raw-headers / .eml export out of the mail read bucket`). Suggested message:
  `docs: describe both editions and align AGENTS.md commands to pnpm`.
- Do NOT push or open a PR.

## Steps

### Step 1: Create the working branch

```bash
git checkout -b advisor/013-docs-correct-editions-and-commands
```

**Verify**: `git rev-parse --abbrev-ref HEAD` → `advisor/013-docs-correct-editions-and-commands`

### Step 2: Rewrite the AGENTS.md overview to cover both editions

Replace the single paragraph at `AGENTS.md:17` (the one starting "SimpleCRM is
an Electron + React + TypeScript desktop CRM app.") with:

```markdown
SimpleCRM ships in **two editions** from one pnpm-workspaces monorepo (`packages/core`, `packages/desktop`, `packages/server`; see `pnpm-workspace.yaml`):

- **Desktop edition** — an Electron + React + TypeScript app. Data is stored locally in SQLite (`better-sqlite3`); everything runs inside the Electron main process plus a Vite-served renderer.
- **Server edition** — a Fastify HTTP API (`packages/server`, ~185 source files) backed by PostgreSQL, deployed with Docker Compose (`docker/`: `caddy`, `api`, `postgres`, `migrate`, `backup`, …). See [`docs/SETUP_SERVER.md`](docs/SETUP_SERVER.md). CI boots and smoke-tests it in the `server-compose-smoke` job of `.github/workflows/ci.yml`.

Unless noted otherwise, the commands and gotchas below target the **desktop edition**; for the server edition follow [`docs/SETUP_SERVER.md`](docs/SETUP_SERVER.md).
```

**Verify**:
- `grep -n "no backend server" AGENTS.md` → no matches (exit 1)
- `grep -n "Server edition" AGENTS.md` → at least one match
- `grep -n "server-compose-smoke" AGENTS.md` → one match

### Step 3: Convert the AGENTS.md "Key commands" table to pnpm

Replace the "Install deps" through "Production mode" rows of the table at
`AGENTS.md:22-33` so every command uses `pnpm`. The resulting table body:

```markdown
| Task | Command |
|---|---|
| Install deps | `pnpm install --frozen-lockfile` |
| Lint | `pnpm run lint` |
| Unit + integration tests | `pnpm test` |
| Unit tests only | `pnpm run test:unit` |
| Mail module tests | `pnpm run test:mail` |
| Mail module coverage (ratchet on `electron/email`) | `pnpm run test:mail:coverage` |
| Integration tests only | `pnpm run test:integration` |
| Build (web + electron main) | `pnpm run build` |
| Dev mode | `xvfb-run --auto-servernum pnpm run electron:dev` |
| Production mode | `pnpm run electron:start` |
```

Leave the "See `package.json` `scripts` for the full list." line unchanged.

**Verify**:
- `grep -n "npm install --legacy-peer-deps" AGENTS.md` → no matches (exit 1)
- `grep -cn "pnpm" AGENTS.md` → count increased (≥ 9 pnpm mentions expected)
- `grep -n "npx eslint" AGENTS.md` → no matches (exit 1)

### Step 4: Update the `--legacy-peer-deps` gotcha to be pnpm-first

Replace the bullet at `AGENTS.md:38` with:

```markdown
- **Use pnpm.** `pnpm install --frozen-lockfile` is the supported, CI-authoritative install (see `.github/workflows/ci.yml`). If you fall back to `npm install`, add `--legacy-peer-deps` because the dependency tree has peer-resolution conflicts and install otherwise fails.
```

Leave the other gotcha bullets (`@testing-library/dom`, native modules, Xvfb,
etc.) unchanged.

**Verify**: `grep -n "CI-authoritative install" AGENTS.md` → one match.

### Step 5: Remove the machine-specific environment note

Delete the entire final section of `AGENTS.md` — the `### Current local
environment note` heading and its paragraph (`AGENTS.md:81-83`, plus the blank
line separating it from the section above). The file should now end with the
"Preferred implementation loop" list (the line ending "...report only the
concise result in German.").

**Verify**:
- `grep -n "Windows machine" AGENTS.md` → no matches (exit 1)
- `grep -n "Current local environment note" AGENTS.md` → no matches (exit 1)

### Step 6: Add a server-edition mention to the README intro

At the end of the intro paragraph (`README.md:3`, after "...one-way data
synchronization from your JTL MSSQL database."), append one sentence:

```markdown
 A self-hostable **server edition** (Fastify API + PostgreSQL, deployed with Docker) is also available — see [Server edition (Docker)](#server-edition-docker) below.
```

**Verify**: `grep -n "server edition" README.md` → at least one match (case-insensitive: `grep -in "server edition" README.md`).

### Step 7: Add the "Server edition (Docker)" section to the README

Insert a new section immediately after the "## Building the Application"
section (i.e., after `README.md:100`, before "## Configuration"):

```markdown
## Server edition (Docker)

Beyond the desktop app, SimpleCRM has a self-hostable **server edition**: a Fastify HTTP API (`packages/server`) backed by PostgreSQL, fronted by Caddy for TLS, and deployed with Docker Compose from the `docker/` directory. It enables multi-user, browser-based access to the same CRM data model.

- **Setup:** [docs/SETUP_SERVER.md](docs/SETUP_SERVER.md) — Docker Compose stack (Caddy + PostgreSQL + API), environment/secrets, and first-run owner setup.
- **Migrate from the desktop/standalone app:** [docs/MIGRATION_STANDALONE_TO_SERVER.md](docs/MIGRATION_STANDALONE_TO_SERVER.md).
- **Implementation status:** [docs/SERVER_EDITION_IMPLEMENTATION.md](docs/SERVER_EDITION_IMPLEMENTATION.md).

CI validates the stack end-to-end in the `server-compose-smoke` job (`.github/workflows/ci.yml`): it builds the images, boots PostgreSQL + migrations + API + Caddy, then runs the backup, doctor, and restore-drill profiles.
```

**Verify**:
- `grep -n "## Server edition (Docker)" README.md` → one match
- Link targets resolve:
  ```bash
  for f in docs/SETUP_SERVER.md docs/MIGRATION_STANDALONE_TO_SERVER.md docs/SERVER_EDITION_IMPLEMENTATION.md; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done
  ```
  → three `OK` lines, zero `MISSING`.

### Step 8: Final scope + drift review, then commit

```bash
git status --porcelain
git diff
```

Confirm only `AGENTS.md` and `README.md` are modified and the diff matches the
edits above. Then commit:

```bash
git add AGENTS.md README.md
git commit -m "docs: describe both editions and align AGENTS.md commands to pnpm"
```

**Verify**: `git status --porcelain` → empty (clean tree after commit); `git show --stat HEAD` lists only `AGENTS.md` and `README.md`.

## Test plan

No automated tests apply (docs-only; ESLint does not lint Markdown, Jest has no
doc coverage). Verification is the per-step `grep`/`test -f` gates plus:

- **Link resolution** (the one substantive risk): every relative doc link added
  or referenced must resolve.
  ```bash
  for f in docs/SETUP_SERVER.md docs/MIGRATION_STANDALONE_TO_SERVER.md docs/SERVER_EDITION_IMPLEMENTATION.md; do test -f "$f" || echo "BROKEN: $f"; done
  ```
  → prints nothing.
- **Optional sanity** (only if you installed deps): `pnpm run lint` → exit 0
  (must be unchanged from before; a failure means you touched a code file — a
  scope violation).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "no backend server" AGENTS.md` → no matches
- [ ] `grep -n "Server edition" AGENTS.md` → at least one match
- [ ] `grep -n "npm install --legacy-peer-deps" AGENTS.md` → no matches (only pnpm in the Key commands table)
- [ ] `grep -n "Windows machine" AGENTS.md` and `grep -n "Current local environment note" AGENTS.md` → no matches
- [ ] `grep -n "## Server edition (Docker)" README.md` → one match
- [ ] `for f in docs/SETUP_SERVER.md docs/MIGRATION_STANDALONE_TO_SERVER.md docs/SERVER_EDITION_IMPLEMENTATION.md; do test -f "$f" || echo MISSING $f; done` → prints nothing
- [ ] `git status --porcelain` shows only `AGENTS.md` and `README.md` modified
- [ ] (If run) `pnpm run lint` exits 0

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check (`git diff --stat f24fb27..HEAD -- AGENTS.md README.md`) shows
  either file already changed, and the "Current state" excerpts no longer match
  the live text (someone edited these docs after this plan was written).
- Any of `docs/SETUP_SERVER.md`, `docs/MIGRATION_STANDALONE_TO_SERVER.md`,
  `docs/SERVER_EDITION_IMPLEMENTATION.md` does NOT exist (the link-resolve check
  fails) — the plan assumed they were present; do not link to a missing file.
- `packages/server`, `docker/docker-compose.yml`, or the `server-compose-smoke`
  job in `.github/workflows/ci.yml` no longer exists — the new overview claims
  would themselves become false; report instead of writing them.
- A verification `grep` still matches the old text after your edit and a second
  fix attempt.
- Applying an edit appears to require touching any file outside the in-scope
  list.

## Maintenance notes

For whoever owns these docs next:

- The overview and README now assert three facts that must stay true: (1)
  `packages/server` is the Fastify API, (2) `docker/docker-compose.yml` is the
  deployment, (3) `.github/workflows/ci.yml` has a `server-compose-smoke` job.
  If any is renamed/removed, update `AGENTS.md:17` and the README "Server
  edition (Docker)" section in the same PR.
- The "~185 source files" figure in the AGENTS.md overview is approximate by
  design ("~") — it will drift as the server grows; that's fine, it conveys
  scale, not an exact count. Drop or re-round it if it becomes misleading.
- **Deferred, intentionally out of scope:** the README's "Setup & Installation"
  still documents `npm install --legacy-peer-deps` for the desktop build. That
  was left as-is because the README targets end-users and `npm` is a valid
  desktop-install path (and `npm ci` is used in the Docker build). If the
  project decides to standardize the README on pnpm too, do it as a separate
  change.
- A reviewer should check that the new README anchor link
  `[Server edition (Docker)](#server-edition-docker)` matches GitHub's
  auto-generated slug for the `## Server edition (Docker)` heading (it does:
  lowercased, spaces→`-`, parentheses dropped).
