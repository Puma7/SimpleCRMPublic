# TypeScript 7 and Runtime Modernization Design

## Goal

Modernize the complete SimpleCRM toolchain without retaining TypeScript 5 or 6 anywhere in the dependency graph used by project scripts. The finished branch must build, test, lint, package, and run the Electron application with TypeScript 7.0.2 or newer, Node 24 LTS, and current supported stable dependencies.

## Version Policy

- Use Node 24 LTS as the runtime baseline. Do not move `@types/node` beyond the runtime major.
- Use `typescript@^7.0.2`; the lockfiles provide reproducible exact versions.
- Use the newest supported stable release for projects without an LTS channel, including Electron, Vite, Jest, ESLint, React libraries, and utility packages.
- Upgrade native and behavior-sensitive dependencies separately from low-risk patch/minor updates.
- Keep a single TypeScript compiler version. No aliased or nested TypeScript 5/6 compatibility installation is allowed.
- Keep pnpm as the root package manager and npm for the isolated `packages/svelte-lab` package until that package is added to the workspace in a separate architectural change.

## Architecture

### Compiler

The root compiler becomes TypeScript 7. All `tsc` build, project-reference, no-emit, declaration, and Electron emit commands continue to use the standard `tsc` executable. Configurations are migrated away from removed TypeScript options:

- Replace legacy `moduleResolution: "node"` with a supported resolution mode matched to each module format.
- Remove `baseUrl` and make path targets explicitly relative.
- Preserve CommonJS output for Electron and server packages unless TypeScript 7 requires the paired `Node16` module mode.
- Preserve the existing output directories and package interfaces.

### Tests

`ts-jest` is removed because its supported TypeScript range excludes TypeScript 7 and it depends on the legacy compiler API. Jest remains the test runner, while `@swc/jest` and `@swc/core` perform TypeScript/TSX transformation. The custom `import.meta.env.DEV` transformer is rewritten to use SWC instead of `typescript.transpileModule`.

Tests remain transpile-only. Type correctness is enforced by the dedicated TypeScript 7 `typecheck` command, and Jest continues to enforce runtime behavior and coverage.

### Script Execution

`ts-node` is removed and TypeScript maintenance scripts run through `tsx`, which does not require the TypeScript compiler API. Existing command arguments and environment variables remain unchanged.

### Linting

The current `typescript-eslint` parser cannot run against TypeScript 7. Because the repository currently enables no TypeScript-specific lint rules, it is replaced with a compiler-independent parser configuration. ESLint must continue to parse all `.ts` and `.tsx` files and fail on parser/configuration errors. Introducing a stronger ruleset is outside this migration.

### Runtime and Dependencies

Dependency upgrades are grouped by risk:

1. Toolchain packages required for TypeScript 7.
2. Patch and minor dependency updates.
3. Major runtime-facing updates such as Electron, `electron-store`, `nodemailer`, and `archiver`.
4. Native dependencies such as `better-sqlite3`, `keytar`, Electron, and `@electron/rebuild`.

Each group receives a clean install and its relevant test/build gate. API migrations stay narrowly scoped to compatibility changes.

### Development Runtime

The existing Electron development workflow remains visible and foreground-driven. No hidden process launcher is introduced. TypeScript 7 watch mode is tested explicitly; if it proves unreliable, an existing visible watcher (`nodemon`) may invoke one-shot TypeScript compilation rather than introducing a background service.

## Compatibility Boundaries

- No database migration or persisted application-data change is planned.
- No product behavior or UI redesign is planned.
- Existing CommonJS entry points, preload boundaries, IPC contracts, package exports, and build output paths must remain stable.
- Generated dependency lockfiles are committed; generated application bundles and local Electron logs are not.
- The isolated Svelte lab is upgraded and built, but remains isolated from the production React bundle.

### Verified Dependency Constraints

- `kysely` remains on `0.28.17`, the newest security-patched release that still publishes a CommonJS entry point. Kysely 0.29 is ESM-only and is incompatible with the current CommonJS server package boundary.
- `quill` remains on the latest published release, `2.0.3`. GitHub advisory `GHSA-v3m3-f69x-jf25` has no patched release and applies to Quill's HTML export feature; SimpleCRM reads the editor DOM and does not call `getSemanticHTML`. The remaining low-severity audit finding must be revisited when Quill publishes a fixed version.
- Transitive security fixes are constrained with pnpm workspace overrides so production dependencies resolve patched `xmldom`, DOMPurify, `fast-uri`, `js-yaml`, Nodemailer, Undici, and `ws` versions without changing application APIs.

## Error Handling and Rollback

- Compiler diagnostics are fixed at their source or configuration boundary; they are not suppressed globally.
- Dependency peer conflicts are resolved by compatible package replacement, not `--force` or permanent peer-dependency bypasses.
- A package major that produces broad application regressions may stay on its newest compatible supported major, with the constraint documented in the final verification report.
- Package-sized commits keep the migration bisectable even though execution happens in one continuous pass.

## Verification Gates

The modernization is complete only when all applicable gates pass from a clean dependency installation:

1. Confirm `tsc --version` is at least 7.0.2 and the lockfiles contain no TypeScript 5/6 package used by project tooling.
2. Run TypeScript project references and both renderer/Electron typechecks.
3. Run ESLint over all TypeScript and TSX files.
4. Run unit, integration, mail, server coverage, and UI coverage suites.
5. Build workspace packages, web renderer, Electron main process, and Svelte lab.
6. Rebuild native Electron modules and create the production application package when the Windows environment supports signing-independent packaging.
7. Launch Electron visibly and smoke-test startup plus core navigation. Review runtime logs for module ABI, dynamic-import, preload, and uncaught-exception failures.

## Success Criteria

- No TypeScript 5.x or 6.x compiler is installed for root or Svelte-lab project execution.
- Every repository script that previously depended on `ts-jest`, `ts-node`, or the TypeScript compiler API has a TypeScript-7-compatible replacement.
- Typecheck, lint, required Jest suites, web build, Electron build, package builds, and Svelte-lab build pass.
- The Electron application starts on Windows without a JavaScript error dialog or native-module ABI failure.
- Changes are committed in reviewable units on `codex/typescript-7-modernization`.
