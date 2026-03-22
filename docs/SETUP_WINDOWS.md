# SimpleCRM — Windows Setup Guide (PowerShell)

Step-by-step instructions to clone, build, and run SimpleCRM on **Windows 10/11** using **PowerShell**.

---

## 1. Prerequisites

### Node.js (v23.11 or newer)

SimpleCRM requires a recent Node.js version. Install via **winget** or download from [nodejs.org](https://nodejs.org):

```powershell
winget install OpenJS.NodeJS
# Verify:
node --version   # should print v23.x or higher
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

SimpleCRM uses native Node.js modules (`better-sqlite3`, `keytar`) that must be compiled from C++ source during `npm install`. This requires the **MSVC C++ build tools**.

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

If you see errors about scripts being disabled, allow local script execution:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## 2. Clone & Install

```powershell
git clone https://github.com/Puma7/SimpleCRMPublic.git
Set-Location SimpleCRMPublic
```

Install dependencies with the `--legacy-peer-deps` flag (required due to peer-dependency conflicts in the current dependency tree):

```powershell
npm install --legacy-peer-deps
```

This will:
1. Download all npm packages
2. Automatically run `electron-rebuild` (postinstall hook) to compile native modules (`better-sqlite3`, `keytar`) for your Electron version

**If `electron-rebuild` fails**, run it manually:

```powershell
npx electron-rebuild -f -w better-sqlite3,keytar
```

---

## 3. Run in Development Mode

```powershell
npm run electron:dev
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
- Optionally seed test data (see section 5)

---

## 4. Production Build

### Run without packaging

Build the renderer (React/Vite) and Electron main process, then launch:

```powershell
npm run build
npm run electron:start
```

### Create a Windows installer (.exe)

```powershell
npm run build
npm run electron:build
```

The NSIS installer is created in the `dist-build\` directory. Double-click the `.exe` to install SimpleCRM like any Windows application.

---

## 5. Seed Test Data (Optional)

Populate the database with sample customers and products for testing:

```powershell
# 100 customers, 50 products
npm run seed-db:test

# Custom amounts (interactive)
npm run seed-db

# Preview cleanup without deleting
npm run cleanup-db:dry

# Actually clean up seed data
npm run cleanup-db
```

---

## 6. Where Data Is Stored

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

## 7. Running Tests

```powershell
# All tests
npm test

# Only Electron/main-process tests
npm run test:electron

# Only React/frontend tests
npm run test:frontend

# With coverage report
npm run test:coverage
```

---

## 8. Troubleshooting

### `node-gyp` / `better-sqlite3` build errors

**Symptom:** Errors mentioning `gyp ERR!`, `MSBuild`, or `cl.exe not found` during `npm install`.

**Fix:** Install the Visual Studio Build Tools with the C++ workload (see Prerequisites). Then retry:

```powershell
npm install --legacy-peer-deps
npx electron-rebuild -f -w better-sqlite3,keytar
```

### `keytar` errors

**Symptom:** `Error: Module did not self-register` or credential storage failures.

**Fix:** Ensure Windows Credential Manager is running (it is enabled by default). Rebuild keytar:

```powershell
npx electron-rebuild -f -w keytar
```

### `ERESOLVE` during `npm install`

**Symptom:** `npm ERR! ERESOLVE could not resolve` with peer dependency conflicts.

**Fix:** You forgot the `--legacy-peer-deps` flag:

```powershell
npm install --legacy-peer-deps
```

### Port 5173 already in use

**Symptom:** `Error: Port 5173 is already in use` when running `npm run electron:dev`.

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

**Fix:** The TypeScript main-process code hasn't been compiled yet. Run:

```powershell
npm run build:electron:main
```

Then retry `npm run electron:dev` or `npm run electron:start`.

### Electron window is blank (white screen)

**Symptom:** The app window opens but shows nothing.

**Fix:** The Vite dev server may not be ready yet. Wait a few seconds — `npm run electron:dev` starts all processes concurrently and the dev server may take a moment. If it persists, check the terminal output for errors from the `Vite` process.

### PowerShell script execution disabled

**Symptom:** `File ... cannot be loaded because running scripts is disabled on this system.`

**Fix:**

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## 9. Useful Commands Reference

| Command | Description |
|---------|-------------|
| `npm run electron:dev` | Start development mode (hot-reload) |
| `npm run build` | Build renderer + main process |
| `npm run electron:start` | Run the built app (no packaging) |
| `npm run electron:build` | Create Windows installer in `dist-build\` |
| `npm run seed-db:test` | Seed 100 customers + 50 products |
| `npm run cleanup-db` | Remove seed data |
| `npm test` | Run all tests |
| `npx electron-rebuild -f -w better-sqlite3,keytar` | Rebuild native modules |

---

## 10. Project Structure (Quick Reference)

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
