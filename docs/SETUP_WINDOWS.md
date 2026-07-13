# SimpleCRM — Windows Setup Guide (PowerShell)

Step-by-step instructions to clone, build, and run SimpleCRM on **Windows 10/11** using **PowerShell**.

---

## 1. Prerequisites

### Node.js 24 LTS

SimpleCRM requires a recent Node.js version. Install via **winget** or download from [nodejs.org](https://nodejs.org):

```powershell
winget install OpenJS.NodeJS
# Verify:
node --version   # should print v24.x
npm --version
```

> **Alternative:** Use [nvm-windows](https://github.com/coreybutler/nvm-windows) if you need to manage multiple Node versions.

### Git

```powershell
winget install Git.Git
# Verify:
git --version
```

### Visual Studio Build Tools 2022 (C++ Compiler)

SimpleCRM uses native Node.js modules (`better-sqlite3`, `keytar`) that must be compiled from C++ source during `pnpm install`. This requires the **MSVC C++ build tools**.

**Option A — Full Visual Studio Build Tools (recommended):**

1. Download [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. In the installer, select the **"Desktop development with C++"** workload
3. Complete the installation (requires ~6 GB disk space)

**Option B — Automated install via npm (elevated PowerShell):**

```powershell
# Run PowerShell as Administrator:
npm install -g windows-build-tools
```

This installs the Visual C++ compiler and Python automatically.

### Python 3.x

`node-gyp` (the native module build system) requires Python. It is usually **bundled** with the Visual Studio Build Tools. Verify:

```powershell
python --version   # should print 3.x
```

If missing, install via `winget install Python.Python.3.12` or from [python.org](https://www.python.org).

### PowerShell Execution Policy

If you see errors about scripts being disabled, either allow local script execution or use the `corepack pnpm ...` commands below, which avoid PowerShell's `npm.ps1`/`pnpm.ps1` shims:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## 2. Clone & Install

```powershell
git clone https://github.com/Puma7/SimpleCRMPublic.git
Set-Location SimpleCRMPublic
```

Enable the repository-pinned package manager and install the root workspace:

```powershell
corepack enable
corepack prepare pnpm@11.12.0 --activate
corepack pnpm install --frozen-lockfile
```

This will:
1. Download all npm packages
2. Automatically run `electron-rebuild` (postinstall hook) to compile native modules (`better-sqlite3`, `keytar`) for your Electron version

**If `electron-rebuild` fails**, run it manually:

```powershell
corepack pnpm exec electron-rebuild -f -w better-sqlite3,keytar
```

---

## 3. Run in Development Mode

```powershell
corepack pnpm run electron:dev
```

This starts **4 concurrent processes**:

| Process | What it does |
|---------|-------------|
| **Vite build (watch)** | Bundles the Electron main process, rebuilds on file changes |
| **TypeScript compiler (watch)** | Compiles `electron/**/*.ts` to `dist-electron/` |
| **Electron (nodemon)** | Launches the app, auto-restarts on main-process changes |
| **Vite dev server (:5173)** | Serves the React UI with hot module replacement |

**Expected result:** An Electron window opens showing the SimpleCRM interface. Changes to React components appear instantly; changes to Electron main-process code trigger an automatic restart.

### First Launch

On first launch the app creates an empty SQLite database. You can:
- Configure an **MSSQL connection** (for JTL sync) under **Settings**
- Add **E-Mail accounts** under the **E-Mail** section
- Optionally seed test data (see section 6)

---

## 4. Production Build

### Run without packaging

Build the renderer (React/Vite) and Electron main process, then launch:

```powershell
corepack pnpm run build
corepack pnpm run electron:start
```

### Create a Windows installer (.exe)

```powershell
corepack pnpm run build
corepack pnpm run electron:build
```

The NSIS installer is created in the `dist-build\` directory. Double-click the `.exe` to install SimpleCRM like any Windows application.

---

## 5. Pull the Latest `main` Branch (While Testing)

When you test SimpleCRM from a local clone, **new releases on GitHub do not replace your dev build automatically**. To run the newest code from `main`, pull from Git, reinstall dependencies if needed, and restart the app.

> **Your data is kept.** Customers, e-mail, and settings live in `%APPDATA%\simplecrm\database.sqlite` (see section 7). Updating source code does not delete that database.

### Before you pull

1. **Stop the running app** — close the Electron window and press `Ctrl+C` in the terminal where `pnpm run electron:dev` is running.
2. Open PowerShell in your clone folder, e.g. `Set-Location C:\Users\You\SimpleCRMPublic`.
3. Optional: see whether you have local changes:

```powershell
git status
```

If you have uncommitted work you want to keep, stash it first:

```powershell
git stash push -m "WIP before main update"
```

### Option A — Test exactly what is on `main` (recommended for “latest stable”)

```powershell
git fetch origin
git checkout main
git pull origin main
corepack pnpm install --frozen-lockfile
corepack pnpm run electron:dev
```

Use `corepack pnpm run build` followed by `corepack pnpm run electron:start` if you want to test the **production build** instead of hot-reload dev mode.

### Option B — Stay on a feature branch but include latest `main`

Use this when you test a PR branch but need current `main` merged in:

```powershell
git fetch origin
git merge origin/main
# Alternative (linear history): git rebase origin/main
corepack pnpm install --frozen-lockfile
corepack pnpm run electron:dev
```

If Git reports merge conflicts, resolve them in your editor, then `git add .` and `git commit` (merge) or `git rebase --continue` (rebase).

### After `pnpm install` (only if needed)

Run these if install failed, native modules were upgraded, or Electron/Node versions changed:

```powershell
corepack pnpm exec electron-rebuild -f -w better-sqlite3,keytar
```

If the app still behaves oddly after a big pull, do a clean rebuild:

```powershell
corepack pnpm run build
```

### Restore stashed work

```powershell
git stash list
git stash pop
```

### Installed `.exe` vs. git clone

| How you run SimpleCRM | How to get the latest version |
|----------------------|-------------------------------|
| **Git clone** (`pnpm run electron:dev` / `electron:start`) | `git pull origin main` + `pnpm install` (this section) |
| **Windows installer** from `dist-build\` | Use **Update** in the app (status bar / update UI). That uses `electron-updater` and GitHub releases published via `pnpm run electron:publish`. Dev folders are not updated that way. |

To ship a new installer after pulling `main`:

```powershell
git pull origin main
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm run electron:build
```

---

## 6. Seed Test Data (Optional)

Populate the database with sample customers and products for testing:

```powershell
# 100 customers, 50 products
corepack pnpm run seed-db:test

# Custom amounts (interactive)
corepack pnpm run seed-db

# Preview cleanup without deleting
corepack pnpm run cleanup-db:dry

# Actually clean up seed data
corepack pnpm run cleanup-db
```

---

## 7. Where Data Is Stored

| Data | Location |
|------|----------|
| **SQLite database** | `%APPDATA%\simplecrm\database.sqlite` |
| **Application logs** | `%APPDATA%\simplecrm\logs\main.log` |
| **E-Mail attachments** | `%APPDATA%\simplecrm\email-attachments\` |
| **Passwords & OAuth tokens** | Windows Credential Manager (via Keytar) |

> In development mode, Electron may use `%APPDATA%\Electron\` instead of `%APPDATA%\simplecrm\`. This depends on whether the app name is set in `package.json` build config.

To open the data folder in Explorer:

```powershell
explorer "$env:APPDATA\simplecrm"
```

**No `.env` file is needed.** All configuration (MSSQL, E-Mail accounts, SMTP, OAuth, AI) is done through the application UI. Sensitive credentials are stored in the Windows Credential Manager, never in plain text.

---

## 8. Running Tests

```powershell
# All tests
corepack pnpm test

# Only Electron/main-process tests
corepack pnpm run test:electron

# Only React/frontend tests
corepack pnpm run test:frontend

# With coverage report
corepack pnpm run test:coverage
```

---

## 9. Troubleshooting

### `node-gyp` / `better-sqlite3` build errors

**Symptom:** Errors mentioning `gyp ERR!`, `MSBuild`, or `cl.exe not found` during `pnpm install`.

**Fix:** Install the Visual Studio Build Tools with the C++ workload (see Prerequisites). Then retry:

```powershell
corepack pnpm install
corepack pnpm exec electron-rebuild -f -w better-sqlite3,keytar
```

### `keytar` errors

**Symptom:** `Error: Module did not self-register` or credential storage failures.

**Fix:** Ensure Windows Credential Manager is running (it is enabled by default). Rebuild keytar:

```powershell
corepack pnpm exec electron-rebuild -f -w keytar
```

### PowerShell blocks `npm.ps1` or `pnpm.ps1`

**Symptom:** PowerShell reports that script execution is disabled when invoking `npm` or `pnpm`.

**Fix:** Invoke pnpm through Corepack; this does not require changing the machine-wide execution policy:

```powershell
corepack pnpm install --frozen-lockfile
```

### Port 5173 already in use

**Symptom:** `Error: Port 5173 is already in use` when running `pnpm run electron:dev`.

**Fix:** Find and stop the process using port 5173:

```powershell
# Find the process
Get-NetTCPConnection -LocalPort 5173 | Select-Object OwningProcess
# Then stop it (replace <PID> with the process ID)
Stop-Process -Id <PID>
```

Or use a different port by editing the `electron:dev` script in `package.json` (change `--port 5173`).

### `MODULE_NOT_FOUND: dist-electron/...`

**Symptom:** Electron crashes at startup with `Cannot find module '../dist-electron/electron/ipc/router'`.

**Cause:** The `electron/main.js` entry point requires compiled TypeScript from `dist-electron/` at the top level. On a fresh clone, this directory doesn't exist yet.

**Fix:** The `electron:dev` script runs `pnpm run electron:compile` automatically before starting the concurrent processes, so this should not happen anymore. If it still does, compile manually:

```powershell
corepack pnpm run build:electron:main
```

Then retry `corepack pnpm run electron:dev` or `corepack pnpm run electron:start`.

### Multiple app windows or DevTools in dev mode

**Symptom:** `pnpm run electron:dev` opens two or three SimpleCRM windows and/or several Chrome DevTools panels.

**Cause:**

1. **Nodemon** watches `dist-electron/` and restarts Electron whenever `tsc --watch` or `vite build --watch` writes files. On startup many files are written in quick succession, so several Electron processes can start before the previous one exits.
2. **Dev mode** intentionally opens DevTools (`NODE_ENV=development` in `electron/main.js`). A detached DevTools window used to appear in addition to the dedicated “SimpleCRM DevTools” window.

**What you can do:**

- Close all SimpleCRM/Electron windows, end stray `electron.exe` processes in Task Manager, then start **once**: `corepack pnpm run electron:dev`.
- Do not run `pnpm run electron:dev` in two terminals at the same time.
- Toggle DevTools with **F12** or **Ctrl+Shift+I**.

### Electron window is blank (white screen)

**Symptom:** The app window opens but shows nothing.

**Fix:** The Vite dev server may not be ready yet. Wait a few seconds — `pnpm run electron:dev` starts all processes concurrently and the dev server may take a moment. If it persists, check the terminal output for errors from the `Vite` process.

### PowerShell script execution disabled

**Symptom:** `File ... cannot be loaded because running scripts is disabled on this system.`

**Fix:**

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## 10. Useful Commands Reference

| Command | Description |
|---------|-------------|
| `git pull origin main` | Update source to latest `main` (then `pnpm install`) |
| `corepack pnpm run electron:dev` | Start development mode (hot-reload) |
| `corepack pnpm run build` | Build renderer + main process |
| `corepack pnpm run electron:start` | Run the built app (no packaging) |
| `corepack pnpm run electron:build` | Create Windows installer in `dist-build\` |
| `corepack pnpm run seed-db:test` | Seed 100 customers + 50 products |
| `corepack pnpm run cleanup-db` | Remove seed data |
| `corepack pnpm test` | Run all tests |
| `corepack pnpm exec electron-rebuild -f -w better-sqlite3,keytar` | Rebuild native modules |

---

## 11. Project Structure (Quick Reference)

```
SimpleCRMPublic/
├── electron/              # Electron main process (TypeScript)
│   ├── main.js            # Entry point (compiled)
│   ├── preload.ts         # IPC bridge to renderer
│   ├── sqlite-service.ts  # Database operations
│   ├── ipc/               # IPC handlers (email, sync, deals, ...)
│   └── email/             # Complete email system
├── src/                   # React renderer (TypeScript)
│   ├── app/               # Pages (CRM, Email, Settings, ...)
│   └── components/        # UI components (Shadcn/ui)
├── shared/                # Shared types & IPC channel definitions
├── scripts/               # Utility scripts (seed, cleanup, perf)
├── dist/                  # Built renderer output
├── dist-electron/         # Compiled Electron main process
├── dist-build/            # Packaged installer output
├── docs/                  # Documentation
├── package.json           # Dependencies & scripts
└── vite.config.ts         # Vite + Electron build configuration
```
