# TypeScript 7 and Runtime Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reproducible SimpleCRM build that uses TypeScript 7.0.2 or newer throughout, Node 24 LTS, current supported stable dependencies, and no legacy TypeScript compiler-API tooling.

**Architecture:** Keep the existing CommonJS application boundaries and replace compiler-API consumers with SWC, TSX, and Babel-based lint parsing. Migrate removed TypeScript options directly, load newly ESM-only runtime dependencies through preserved dynamic imports, and upgrade dependencies in gated groups so failures remain attributable.

**Tech Stack:** Node 24 LTS, pnpm 11, TypeScript 7, Electron 43, React 19, Vite 8, Jest 30, SWC, ESLint 10, Babel 8, TSX, Svelte 5.

## Global Constraints

- Use `typescript@^7.0.2` in both root and Svelte-lab manifests.
- Do not install TypeScript 5.x or 6.x, `ts-jest`, `ts-node`, or `typescript-eslint` for project execution.
- Keep Node runtime and `@types/node` on major 24.
- Preserve CommonJS output, IPC contracts, database format, and build output paths.
- Keep local `electron-dev.err.log` and `electron-dev.out.log` untouched and uncommitted.
- Do not use forced peer-dependency resolution to hide incompatibilities.
- Keep every execution visible; do not add hidden Windows process launchers.

---

### Task 1: Pin the Runtime and Package Manager

**Files:**
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `docker/api.Dockerfile`
- Modify: `docker/web.Dockerfile`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: Node 24 and pnpm 11.12.0 as reproducible install baselines.

- [ ] **Step 1: Add package-manager assertions before changing the manifest**

Run:

```powershell
node -e "const p=require('./package.json'); if(p.engines?.node!=='>=24') process.exit(1); if(p.packageManager) process.exit(1)"
```

Expected: exit 0, proving the new pin is not already present.

- [ ] **Step 2: Pin pnpm and move pnpm 11 settings**

Add to `package.json`:

```json
"packageManager": "pnpm@11.12.0"
```

Move `pnpm.overrides` and `pnpm.onlyBuiltDependencies` from `package.json` to top-level `overrides` and `onlyBuiltDependencies` keys in `pnpm-workspace.yaml`. Replace `pnpm@9` with `pnpm@11.12.0` in both Dockerfiles.

- [ ] **Step 3: Verify package-manager metadata**

Run:

```powershell
corepack pnpm --version
corepack pnpm config get node-linker
```

Expected: pnpm 11.12.0 and no warning that the manifest `pnpm` field is ignored.

- [ ] **Step 4: Commit the runtime baseline**

```powershell
git add package.json pnpm-workspace.yaml docker/api.Dockerfile docker/web.Dockerfile pnpm-lock.yaml
git commit -m "build: pin Node 24 and pnpm 11 toolchain"
```

### Task 2: Replace Legacy Compiler-API Tooling

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `scripts/check-typescript-toolchain.mjs`

**Interfaces:**
- Produces: `pnpm run check:typescript-toolchain`, a deterministic guard for the TS7 toolchain.

- [ ] **Step 1: Add a failing toolchain guard**

Create `scripts/check-typescript-toolchain.mjs` that reads both package manifests and fails unless:

```javascript
const requiredRoot = ['typescript', '@swc/core', '@swc/jest', 'tsx', '@babel/core', '@babel/eslint-parser'];
const forbiddenRoot = ['ts-jest', 'ts-node', 'typescript-eslint'];
```

It must use `semver.satisfies(version, '>=7.0.2 <8')` after removing a leading range marker and assert that the Svelte-lab manifest also declares TypeScript 7.

- [ ] **Step 2: Run the guard and verify failure**

Run:

```powershell
node scripts/check-typescript-toolchain.mjs
```

Expected: non-zero exit identifying TypeScript 5 and the three forbidden tools.

- [ ] **Step 3: Replace dependencies and scripts**

Remove `ts-jest`, `ts-node`, and `typescript-eslint`. Add current stable `typescript@^7.0.2`, `@swc/core`, `@swc/jest`, `tsx`, `@babel/core`, `@babel/eslint-parser`, and `semver`. Add:

```json
"check:typescript-toolchain": "node scripts/check-typescript-toolchain.mjs"
```

Change maintenance scripts from `ts-node --project scripts/tsconfig.json` to `tsx --tsconfig scripts/tsconfig.json`.

- [ ] **Step 4: Install and verify the single compiler**

Run:

```powershell
corepack pnpm install --no-frozen-lockfile
corepack pnpm exec tsc --version
corepack pnpm run check:typescript-toolchain
```

Expected: TypeScript 7.0.2 or newer and guard exit 0.

- [ ] **Step 5: Commit compiler tooling**

```powershell
git add package.json pnpm-lock.yaml scripts/check-typescript-toolchain.mjs
git commit -m "build: replace legacy TypeScript compiler tooling"
```

### Task 3: Migrate Every TypeScript Configuration

**Files:**
- Modify: `tsconfig.json`
- Modify: `tsconfig.electron.json`
- Modify: `scripts/tsconfig.json`
- Modify: `packages/core/tsconfig.json`
- Modify: `packages/server/tsconfig.json`
- Modify: `packages/desktop/tsconfig.json`
- Modify: `packages/svelte-lab/tsconfig.json`

**Interfaces:**
- Produces: TypeScript 7-compatible renderer, Electron, script, workspace-package, and Svelte configurations.

- [ ] **Step 1: Capture the expected TS7 failures**

Run:

```powershell
corepack pnpm exec tsc -p tsconfig.electron.json --noEmit
corepack pnpm exec tsc -b packages/core packages/server packages/desktop
```

Expected: diagnostics for removed `node10` resolution and `baseUrl` before edits.

- [ ] **Step 2: Migrate renderer and Electron configs**

Keep renderer `moduleResolution: "bundler"`. In Electron use the supported Node module pair:

```json
"module": "Node16",
"moduleResolution": "Node16",
"paths": { "@shared/*": ["./shared/*"] }
```

Remove `baseUrl`. Keep `rootDir`, `outDir`, source maps, and includes unchanged.

- [ ] **Step 3: Migrate package and script configs**

Use `module: "Node16"` with `moduleResolution: "Node16"` for CommonJS packages and scripts. Keep Svelte on `module: "ESNext"` plus `moduleResolution: "bundler"`.

- [ ] **Step 4: Fix source diagnostics without broad suppression**

Run `pnpm run typecheck`, fix TypeScript 7 diagnostics at the smallest source boundary, and rerun until clean. Do not add `ignoreDeprecations`, disable `strict`, or add repository-wide `any` escapes.

- [ ] **Step 5: Commit compiler configuration migration**

```powershell
git add tsconfig.json tsconfig.electron.json scripts/tsconfig.json packages/*/tsconfig.json
git commit -m "build: migrate tsconfigs to TypeScript 7"
```

### Task 4: Move Jest Transformation to SWC

**Files:**
- Modify: `jest.config.cjs`
- Modify: `jest.mail.config.cjs`
- Modify: `tests/setup/transform-import-meta.cjs`
- Test: existing unit, integration, and mail tests

**Interfaces:**
- Produces: Jest transformations independent of the TypeScript compiler API.

- [ ] **Step 1: Run a focused test with the removed transformer**

Run:

```powershell
corepack pnpm test -- --runTestsByPath tests/unit/local-data-service.test.ts --runInBand
```

Expected: failure resolving `ts-jest` or `typescript.transpileModule`.

- [ ] **Step 2: Configure SWC for TS and TSX**

Replace each `ts-jest` transform with `@swc/jest` configured for TypeScript/TSX, decorators, React automatic runtime, ES2022 target, and CommonJS modules. Keep existing test roots, aliases, environments, setup files, and coverage settings unchanged.

- [ ] **Step 3: Rewrite the custom transformer**

Keep the `import.meta.env.DEV` source replacement and call `transformSync` from `@swc/core` with TypeScript parser and CommonJS output. Do not import `typescript`.

- [ ] **Step 4: Run focused and broad Jest gates**

Run:

```powershell
corepack pnpm test -- --runTestsByPath tests/unit/local-data-service.test.ts --runInBand
corepack pnpm run test:unit -- --runInBand
corepack pnpm run test:integration -- --runInBand
corepack pnpm run test:mail -- --runInBand
```

Expected: all suites pass with SWC.

- [ ] **Step 5: Commit test transformation**

```powershell
git add jest.config.cjs jest.mail.config.cjs tests/setup/transform-import-meta.cjs
git commit -m "test: migrate Jest TypeScript transforms to SWC"
```

### Task 5: Make ESLint Independent of the TypeScript API

**Files:**
- Modify: `eslint.config.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: ESLint parsing for `.ts` and `.tsx` without `typescript-eslint`.

- [ ] **Step 1: Verify current lint failure after tool removal**

Run `corepack pnpm run lint`.

Expected: failure importing `typescript-eslint`.

- [ ] **Step 2: Configure Babel parsing by extension**

Import `@babel/eslint-parser`, use `requireConfigFile: false`, and define separate flat-config entries for TypeScript and TSX so Babel receives the `typescript` parser plugin and JSX only where needed. Preserve ignore patterns and the current no-rules behavior.

- [ ] **Step 3: Run the full lint gate**

Run `corepack pnpm run lint`.

Expected: exit 0 with no parser warnings or unknown TypeScript rule references.

- [ ] **Step 4: Commit lint migration**

```powershell
git add eslint.config.mjs package.json pnpm-lock.yaml
git commit -m "build: decouple ESLint from TypeScript compiler API"
```

### Task 6: Upgrade Stable Dependencies

**Files:**
- Modify: `package.json`
- Modify: `packages/server/package.json`
- Modify: `packages/desktop/package.json`
- Modify: `packages/svelte-lab/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/svelte-lab/package-lock.json`

**Interfaces:**
- Produces: Current stable dependency manifests, with Node typings held to major 24.

- [ ] **Step 1: Record the available updates**

Run:

```powershell
npm.cmd exec --yes npm-check-updates -- --workspaces --jsonUpgraded
npm.cmd exec --yes npm-check-updates -- --cwd packages/svelte-lab --jsonUpgraded
```

Expected: update inventory retained in terminal output for comparison.

- [ ] **Step 2: Apply root and workspace updates**

Apply current stable versions from the inventory, including Electron 43, Vite 8, Jest 30, dependency patch/minor releases, and declared workspace dependencies. Keep `@types/node` at the newest 24.x release rather than 26.x. Do not re-add removed compiler tooling.

- [ ] **Step 3: Apply isolated Svelte-lab updates**

Upgrade Svelte, Svelte Flow, Vite, the Svelte Vite plugin, and TypeScript 7. Run `npm.cmd install --prefix packages/svelte-lab` to update its tracked lockfile.

- [ ] **Step 4: Refresh the root lock and native modules**

Run:

```powershell
corepack pnpm install --no-frozen-lockfile
corepack pnpm run postinstall
```

Expected: no peer-resolution failures and native rebuild exit 0.

- [ ] **Step 5: Commit dependency versions**

```powershell
git add package.json packages/*/package.json packages/svelte-lab/package-lock.json pnpm-lock.yaml
git commit -m "build: update supported runtime dependencies"
```

### Task 7: Adapt ESM-Only Major Dependencies

**Files:**
- Modify: `electron/mssql-service.ts`
- Modify: `electron/mssql-keytar-service.ts`
- Modify: `electron/email/email-gdpr-export.ts`
- Modify: `electron/email/email-local-backup-export.ts`
- Modify: `packages/server/src/mail-gdpr-export.ts`
- Test: `tests/unit/mssql-keytar-pool.test.ts`
- Test: `tests/mail/email-gdpr-export.test.ts`
- Test: server GDPR export tests discovered by Jest

**Interfaces:**
- Produces: Lazy ESM loading while preserving CommonJS application entry points.

- [ ] **Step 1: Run affected tests and builds**

Run focused MSSQL and GDPR export tests plus `pnpm run build:electron:main`.

Expected: ESM import/type errors or runtime `ERR_REQUIRE_ESM` before adaptation.

- [ ] **Step 2: Load electron-store lazily**

Create one memoized promise per MSSQL module:

```typescript
const storePromise = import('electron-store').then(({ default: Store }) =>
  new Store<MssqlKeytarStoreSchema>({ defaults: { [STORE_KEY_SETTINGS]: null } }),
);
```

Await it inside async operations. Convert only the unused legacy synchronous MSSQL helpers needed to preserve compilation; do not alter stored keys or schemas.

- [ ] **Step 3: Load archiver inside async export boundaries**

Use a small memoized loader or `await import('archiver')` before archive construction. Update archive types using type-only imports. Keep compression levels, filenames, limits, stream handling, and error behavior unchanged.

- [ ] **Step 4: Update mocks and verify runtime behavior**

Adjust Jest mocks only where dynamic default imports require it, then run all focused MSSQL and GDPR tests.

- [ ] **Step 5: Commit ESM compatibility**

```powershell
git add electron/mssql-service.ts electron/mssql-keytar-service.ts electron/email/email-gdpr-export.ts electron/email/email-local-backup-export.ts packages/server/src/mail-gdpr-export.ts tests
git commit -m "fix: preserve CommonJS runtime with ESM dependencies"
```

### Task 8: Update CI, Docker, and Documentation Contracts

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `docs/AGENT_HANDOFF.md`
- Modify: `docs/LEARNINGS.md`
- Modify: `packages/svelte-lab/README.md`

**Interfaces:**
- Produces: CI checks and continuity documentation matching the new toolchain.

- [ ] **Step 1: Add the toolchain gate to CI**

Run `pnpm run check:typescript-toolchain` after install and before lint. Ensure pnpm/action-setup uses the manifest pin without a conflicting explicit version.

- [ ] **Step 2: Update continuity documentation**

Document TypeScript 7, SWC Jest transforms, TSX scripts, Babel ESLint parsing, pnpm 11, Node 24, and the ESM-only dependency loading boundary. Replace Svelte-lab install instructions with the exact supported command.

- [ ] **Step 3: Verify Docker builds at least through dependency and TypeScript stages**

Run Docker builds when Docker is available; otherwise validate Dockerfile syntax and record the environmental limitation.

- [ ] **Step 4: Commit CI and docs**

```powershell
git add .github/workflows docs/AGENT_HANDOFF.md docs/LEARNINGS.md packages/svelte-lab/README.md
git commit -m "ci: enforce TypeScript 7 modernization gates"
```

### Task 9: Full Clean Verification and Electron Smoke Test

**Files:**
- Modify only files required by verified failures.

**Interfaces:**
- Produces: Final evidence that the modernized application is compatible and runnable.

- [ ] **Step 1: Verify dependency and compiler state**

Run:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run check:typescript-toolchain
corepack pnpm exec tsc --version
corepack pnpm why typescript
```

Expected: one TypeScript 7 line for root tooling and no TypeScript 5/6 installation.

- [ ] **Step 2: Run static and build gates**

```powershell
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run build
corepack pnpm run svelte-lab:build
```

Expected: all exit 0.

- [ ] **Step 3: Run behavior and coverage gates**

```powershell
corepack pnpm test -- --runInBand
corepack pnpm run test:mail:coverage -- --runInBand
corepack pnpm run test:server:coverage -- --runInBand
corepack pnpm run test:ui:coverage:check -- --runInBand
```

Expected: all tests and existing ratchets pass.

- [ ] **Step 4: Build the Windows application**

Run `corepack pnpm run electron:build`.

Expected: unpacked/installer artifacts created without native ABI or dynamic-import errors. Publishing is not performed.

- [ ] **Step 5: Launch Electron visibly**

Start `npm.cmd run electron:start` in a visible terminal process. Confirm the main window loads and review the fresh process output for JavaScript, preload, native ABI, and missing asset errors. Stop only the process started by this verification.

- [ ] **Step 6: Review changes and commit verified fixes**

Run:

```powershell
git diff --check
git status --short
git log --oneline origin/main..HEAD
```

Commit any narrowly scoped verification fixes, leaving the two local Electron logs untracked.
