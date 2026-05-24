# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

SimpleCRM is an Electron + React + TypeScript desktop CRM app. All data is stored locally in SQLite (`better-sqlite3`). There is no backend server; everything runs inside the Electron main process plus a Vite-served renderer.

### Key commands

| Task | Command |
|---|---|
| Install deps | `npm install --legacy-peer-deps` |
| Lint | `npx eslint . --ext ts,tsx --max-warnings 0` |
| Unit + integration tests | `npm test` |
| Unit tests only | `npm run test:unit` |
| Integration tests only | `npm run test:integration` |
| Build (web + electron main) | `npm run build` |
| Dev mode | `xvfb-run --auto-servernum npm run electron:dev` |
| Production mode | `npm run electron:start` |

See `package.json` `scripts` for the full list.

### Gotchas

- **`--legacy-peer-deps` is required** for `npm install` because the dependency tree has peer-resolution conflicts. Without it, install fails.
- **`@testing-library/dom` is a missing peer dep** — `@testing-library/react` requires it but it is not listed in `package.json`. The update script installs it explicitly so tests pass.
- **Native modules** (`better-sqlite3`, `keytar`) are compiled by the `postinstall` script (`electron-rebuild`). If you see "module was compiled against a different Node.js version" errors, run `npm run postinstall` to rebuild.
- **Xvfb is required** on headless Linux to run the Electron app or E2E tests. Use `xvfb-run --auto-servernum` as a prefix.
- **Dev mode** (`npm run electron:dev`) starts four concurrent processes: Vite build watcher, TypeScript compiler watcher, Electron main via nodemon, and Vite dev server on port 5173. DevTools open automatically in dev mode.
- The SQLite database file is created at `~/.config/simplecrm/database.sqlite` (on Linux).
- The app UI is in German (e.g., "Kunden" = Customers, "Aufgaben" = Tasks, "Kalender" = Calendar, "Einstellungen" = Settings).
