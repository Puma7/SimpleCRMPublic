# SimpleCRM Local Setup

This document describes the current local/standalone foundation on this branch. It is not a packaged end-user installer yet.

## Prerequisites

- Node.js 22 LTS.
- npm.
- Git.
- Electron runtime dependencies for your OS.
- Optional for standalone PostgreSQL work: the embedded PostgreSQL runtime package expected by `packages/desktop`; the current tests use ports and mocks and do not start a real embedded database.

## Developer Desktop

From the repository root:

```powershell
npm ci
npm run build
npm run electron:dev
```

`npm run electron:dev` starts the Vite renderer and Electron main process. On first start, the deploy setup gate can persist one of:

- `standalone`: local Electron app with the standalone PostgreSQL foundation.
- `server-client`: thin client talking to an existing SimpleCRM server.
- `server-install`: pending installer mode; the production installer flow is still a later hardening item.

## Browser Server-Client Bootstrap

For browser-only testing against a running server:

```powershell
npm run dev
```

Open one of:

- `http://localhost:5173/?serverUrl=https://crm.example.com`
- `http://localhost:5173/?simplecrmServer=https://crm.example.com`

The URL bootstrap stores the server URL in browser local storage under `simplecrm.deployConfig.v1`.

## Local Verification

Use the same verification gates as normal development:

```powershell
npm test -- --runInBand
npm run lint
npm run build
```

Server-edition focused checks:

```powershell
npm run test:server-edition
```

Live PostgreSQL RLS checks require `DATABASE_URL` and a built server package:

```powershell
npm run build:packages
$env:DATABASE_URL='postgres://simplecrm:password@localhost:5432/simplecrm'
npm run test:server-rls
```

## Known Limits

- The installer-driven standalone flow is a foundation, not a completed packaged installer.
- Embedded PostgreSQL lifecycle code is port-based and covered by tests, but packaged binary validation and upgrade drills remain open.
- Full production mail-sync and workflow side-effect parity are not complete on this branch.
