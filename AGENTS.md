# AGENTS.md

## Cursor Cloud specific instructions

### Documentation for AI continuity

| Read first | Purpose |
|------------|---------|
| [`docs/AGENT_HANDOFF.md`](docs/AGENT_HANDOFF.md) | **Session handoff** — what was built, branch/PR, architecture, file map, open items |
| [`docs/LEARNINGS.md`](docs/LEARNINGS.md) | Master learnings index |
| [`docs/INDEX.md`](docs/INDEX.md) | Full documentation map |

Domain: [`docs/DEVELOPER_EMAIL.md`](docs/DEVELOPER_EMAIL.md), [`docs/WORKFLOW_PHASES.md`](docs/WORKFLOW_PHASES.md).

### Project overview

SimpleCRM ships in **two editions** from one pnpm-workspaces monorepo (`packages/core`, `packages/desktop`, `packages/server`; see `pnpm-workspace.yaml`):

- **Desktop edition** — an Electron + React + TypeScript app. Data is stored locally in SQLite (`better-sqlite3`); everything runs inside the Electron main process plus a Vite-served renderer.
- **Server edition** — a Fastify HTTP API (`packages/server`) backed by PostgreSQL, deployed with Docker Compose (`docker/`: `caddy`, `api`, `postgres`, `migrate`, `backup`, …). See [`docs/SETUP_SERVER.md`](docs/SETUP_SERVER.md). CI boots and smoke-tests it in the `server-compose-smoke` job of `.github/workflows/ci.yml`.

Unless noted otherwise, the commands and gotchas below target the **desktop edition**; for the server edition follow [`docs/SETUP_SERVER.md`](docs/SETUP_SERVER.md).

### Key commands

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Lint | `pnpm run lint` |
| Typecheck (all packages + renderer + electron main) | `pnpm run typecheck` |
| Build workspace packages | `pnpm run build:packages` |
| Unit + integration tests | `pnpm test` |
| Unit tests only | `pnpm run test:unit` |
| Integration tests only | `pnpm run test:integration` |
| Focused test | `pnpm exec jest <path/to/file.test.ts>` |
| CI's single coverage run (unit + integration) | `pnpm run test:ci:coverage` |
| Server coverage ratchet | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` |
| Email UI coverage ratchet | `pnpm run test:ui:coverage:check` |
| Mail module tests | `pnpm run test:mail` |
| Mail coverage ratchet (`electron/email`) | `pnpm run test:mail:coverage:check` |
| Raise a coverage baseline | `pnpm run test:<server\|ui\|mail>:coverage:update-baseline` |
| Build (web + electron main) | `pnpm run build` |
| Dev mode | `xvfb-run --auto-servernum pnpm run electron:dev` |
| Production mode | `pnpm run electron:start` |

See `package.json` `scripts` for the full list.

### CI gates

`.github/workflows/ci.yml` is the source of truth; if this table and the workflow disagree, the workflow wins.

| CI job / step | Command CI runs | Reproduce locally |
|---|---|---|
| `build-and-test` · Verify TypeScript 7 toolchain | `pnpm run check:typescript-toolchain` | same |
| `build-and-test` · Lint | `pnpm run lint` | same |
| `build-and-test` · Run tests (unit + integration, once, with coverage) | `pnpm run test:ci:coverage` | same (as a non-root user, see Gotchas) |
| `build-and-test` · Mail module tests (coverage ratchet) | `pnpm run test:mail:coverage:check` | same |
| `build-and-test` · Server coverage ratchet | `node scripts/check-server-coverage-ratchet.mjs` | after `pnpm run test:ci:coverage` (or `pnpm run test:server:coverage`) |
| `build-and-test` · Email UI coverage ratchet | `node scripts/check-ui-coverage-ratchet.mjs` | after `pnpm run test:ci:coverage` (or `pnpm run test:ui:coverage:check`) |
| `build-and-test` · Typecheck | `pnpm run typecheck` | same |
| `build-and-test` · Build (renderer) | `pnpm run build` | same |
| `electron-e2e` · Electron E2E suite | `pnpm run test:e2e` (Xvfb + keyring) | `xvfb-run --auto-servernum pnpm run test:e2e` |
| `server-compose-smoke` · Compose config, boot, backup, doctor, restore drill | `docker compose -f docker/docker-compose.yml …` | see [`docs/SETUP_SERVER.md`](docs/SETUP_SERVER.md) |

Coverage ratchets fail when coverage drops more than 1 point below the committed `*-coverage-baseline.json`
**or** exceeds it by more than 2 points (then raise the baseline with the matching `…:update-baseline` script).

### Gotchas

- **Toolchain:** Node.js 24 LTS, pnpm 11.13.1 and TypeScript 7.0.2+ are enforced by `package.json`, CI and `pnpm run check:typescript-toolchain`. Do not add a second root lockfile.
- **Root package manager is pnpm.** It resolves the root peer tree without `--legacy-peer-deps`. The isolated `packages/svelte-lab` experiment intentionally keeps its own npm lock and uses `npm ci --legacy-peer-deps`.
- **`@testing-library/dom` is an explicit dependency** because `@testing-library/react` requires that peer.
- **Native modules** use different ABIs under Node 24 and Electron 43. `postinstall` caches both `better-sqlite3` binaries and leaves the workspace on the Node ABI; all `electron:*` scripts switch to the Electron ABI and restore Node afterwards. Use `pnpm run native:status` to inspect or `pnpm run native:initialize` to rebuild the caches. Do not invoke `electron-rebuild` directly.
- **Xvfb is required** on headless Linux to run the Electron app or E2E tests. Use `xvfb-run --auto-servernum` as a prefix.
- **Dev mode** (`pnpm run electron:dev`) starts four concurrent processes: Vite build watcher, TypeScript compiler watcher, Electron main via nodemon, and Vite dev server on port 5173. DevTools open automatically in dev mode.
- The SQLite database file is created at `~/.config/simplecrm/database.sqlite` (on Linux).
- **Mail tests and coverage:** CI runs `pnpm run test:mail:coverage:check` after the main Jest run; the ratchet compares `electron/email` coverage against `mail-coverage-baseline.json`. Run `pnpm run test:mail` while iterating (threshold disabled). See [`docs/MAIL_TESTING.md`](docs/MAIL_TESTING.md).
- **Embedded PostgreSQL tests need a non-root user.** Suites using `tests/integration/helpers/embedded-postgres.ts` start `initdb`, which refuses to run as root; CI runs as an unprivileged user. As root, run Jest as a normal user (e.g. `su <user> -c "cd <repo> && node_modules/.bin/jest --cacheDirectory /tmp/jest-<user> <file>"` after making the checkout writable for that user). Server coverage measured as root is several points too low.
- The app UI is in German (e.g., "Kunden" = Customers, "Aufgaben" = Tasks, "Kalender" = Calendar, "Einstellungen" = Settings).
- **Workflow graph UI:** `@xyflow/react` v12 (`^12.11.2`). Optional isolated Svelte experiment: `packages/svelte-lab` (`@xyflow/svelte`), see `packages/svelte-lab/README.md` and `VITE_ENABLE_SVELTE_LAB`.

## Hermes autonomous working mode

Pascal has granted Hermes high autonomy for this project.

### Allowed without additional confirmation

- Read, search, analyze and summarize repository files.
- Run local tests, typechecks, builds, scripts and diagnostics.
- Install local development dependencies when needed for verification.
- Add or update regression tests before bug fixes.
- Modify source code and project documentation.
- Use OpenCode as a focused coding or review worker.
- Create Hermes support artifacts under `.hermes/`.
- Store long audits and logs in `.hermes/reports/`; keep chat summaries concise.

### Ask Pascal before

- Pushing to GitHub, merging PRs, creating releases or deploying.
- Touching production data, real customer data, or live infrastructure.
- Handling real secrets, API keys, passwords, OAuth tokens or private credentials.
- Destructive deletion of large data sets or irreversible migrations.
- Paid external actions or anything with business/financial side effects.

### Preferred implementation loop

1. Map relevant code and tests.
2. Reproduce the bug or establish a baseline.
3. Add a regression test first.
4. Implement the smallest root-cause fix.
5. Run focused tests (`pnpm exec jest <file>`) and `pnpm run typecheck`; before handing off, run the CI gates that cover the files you touched (see "CI gates").
6. Write longer findings to `.hermes/reports/` and report only the concise result in German.
