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
- **Server edition** — a Fastify HTTP API (`packages/server`, ~185 source files) backed by PostgreSQL, deployed with Docker Compose (`docker/`: `caddy`, `api`, `postgres`, `migrate`, `backup`, …). See [`docs/SETUP_SERVER.md`](docs/SETUP_SERVER.md). CI boots and smoke-tests it in the `server-compose-smoke` job of `.github/workflows/ci.yml`.

Unless noted otherwise, the commands and gotchas below target the **desktop edition**; for the server edition follow [`docs/SETUP_SERVER.md`](docs/SETUP_SERVER.md).

### Key commands

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Lint | `pnpm run lint` |
| Unit + integration tests | `pnpm test` |
| Unit tests only | `pnpm run test:unit` |
| Mail module tests | `pnpm run test:mail` |
| Mail module coverage (ratchet on `electron/email`) | `pnpm run test:mail:coverage` |
| Integration tests only | `pnpm run test:integration` |
| Build (web + electron main) | `pnpm run build` |
| Dev mode | `xvfb-run --auto-servernum pnpm run electron:dev` |
| Production mode | `pnpm run electron:start` |

See `package.json` `scripts` for the full list.

### Gotchas

- **Toolchain:** Node.js 24 LTS, pnpm 11.12.0 and TypeScript 7.0.2+ are enforced by `package.json`, CI and `pnpm run check:typescript-toolchain`. Do not add a second root lockfile.
- **Root package manager is pnpm.** It resolves the root peer tree without `--legacy-peer-deps`. The isolated `packages/svelte-lab` experiment intentionally keeps its own npm lock and uses `npm ci --legacy-peer-deps`.
- **`@testing-library/dom` is an explicit dependency** because `@testing-library/react` requires that peer.
- **Native modules** (`better-sqlite3`, `keytar`) are compiled by the `postinstall` script (`electron-rebuild`). If you see "module was compiled against a different Node.js version" errors, run `pnpm run postinstall` to rebuild.
- **Xvfb is required** on headless Linux to run the Electron app or E2E tests. Use `xvfb-run --auto-servernum` as a prefix.
- **Dev mode** (`pnpm run electron:dev`) starts four concurrent processes: Vite build watcher, TypeScript compiler watcher, Electron main via nodemon, and Vite dev server on port 5173. DevTools open automatically in dev mode.
- The SQLite database file is created at `~/.config/simplecrm/database.sqlite` (on Linux).
- **Mail tests in CI:** GitHub Actions runs `pnpm run test:mail` after the main Jest suite (see `.github/workflows/ci.yml`).
- **Mail coverage:** `jest.mail.config.cjs` collects coverage from `electron/email/**/*.ts` with a **ratchet** threshold (~91% lines, ~80% branches). Run `pnpm run test:mail` while iterating (threshold disabled); use `pnpm run test:mail:coverage` before merging mail changes. See [`docs/MAIL_TESTING.md`](docs/MAIL_TESTING.md).
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
5. Run focused tests and typecheck.
6. Write longer findings to `.hermes/reports/` and report only the concise result in German.
