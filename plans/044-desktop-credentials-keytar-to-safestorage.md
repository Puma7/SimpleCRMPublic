# Plan 044: Desktop credentials move from `keytar` to Electron `safeStorage` (staged: decision first, then build)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. This plan has two phases: **Phase 0 ends with a
> decision document and a hard stop** — Phase 1 may only start after the
> maintainer (Pascal) has approved that document (it says `Status: APPROVED`).
> When a phase is done, update this plan's row in `plans/README.md` (section
> "Runde 2"; Phase 0 done → `BLOCKED — waiting for approval of docs/design/desktop-credential-store.md`)
> and, after Phase 1, tick **044** in `plans/MASTERPLAN.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- electron/email/email-keytar.ts electron/email/email-ai-keytar.ts electron/email/email-ai-profiles.ts electron/mssql-keytar-service.ts electron/automation/automation-keytar.ts electron/maintenance/keytar-purge.ts electron/maintenance/reset-service.ts electron/email/email-local-backup-export.ts electron/email/email-local-restore.ts electron/mail-roadmap-migrations.ts package.json .github/workflows/ci.yml .github/workflows/release.yml`
> On any change, compare with "Current state"; a mismatch is a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: HIGH (a bug can lock users out of every mailbox, AI profile and ERP connection)
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `9e0491e3`, 2026-09-27

## Why this matters

All desktop secrets (IMAP/SMTP passwords, OAuth refresh tokens, PGP private
keys, AI API keys, the MSSQL password, the Automation-API key) live in the OS
keychain via `keytar` (`package.json:138`, `"keytar": "^7.9.0"`). keytar 7.9.0 is
from 2022-02-17 (confirmed with `npm view keytar time`) and has had no release
since; its repo is `atom/node-keytar` (Atom was sunset in 2022; archive status not
verifiable from this environment). It is a native module: CI installs
`gcc-12`, `libsecret-1-dev` to build it (`.github/workflows/ci.yml:96-128`) and
`release.yml:93` rebuilds it for Electron. Electron 43 (`node_modules/electron`
43.1.0) ships `safeStorage`, which encrypts with the same OS facilities (DPAPI,
Keychain, libsecret/kwallet) without a native addon. Removing keytar removes an
unmaintained native dependency and a whole class of ABI/build failures. The
risk is credential loss, so this plan decides first and builds second.
Audit claims verified: the six importers listed below are exact.

## Current state

keytar importers (exactly six; `grep -rln "from 'keytar'" electron`):

| File | Service name(s) | Accounts |
|---|---|---|
| `electron/email/email-keytar.ts` (28 lines) | `SimpleCRMElectron-Email`, `SimpleCRMElectron-PGP` | per mail account key (IMAP/SMTP password, OAuth refresh token — `email-oauth-google.ts:25` stores refresh tokens via `saveEmailPassword`); PGP private keys |
| `electron/email/email-ai-keytar.ts` (15) | `SimpleCRMElectron-EmailAI` | legacy single `api-key` |
| `electron/email/email-ai-profiles.ts` | `SimpleCRMElectron-EmailAI` | `profile-<uuid>` (column `keytar_account`); **also calls `keytar` directly** at `:246` (`void keytar.deletePassword`), `:250`, `:254`, `:258` |
| `electron/mssql-keytar-service.ts` (672) | `SimpleCRMElectron-MSSQL` | `getKeytarAccount(settings)` (`:119`); set/get/delete at `:198`, `:202`, `:233`, `:262`, `:298` |
| `electron/automation/automation-keytar.ts` (53) | `SimpleCRMElectron-AutomationAPI` | `api-credentials` (JSON) |
| `electron/maintenance/keytar-purge.ts` (23) | all six services incl. `SimpleCRMElectron-StandalonePostgres` | `findCredentials` + delete on hard reset (`reset-service.ts:77`) |

- Callers of the wrappers: `electron/ipc/email.ts` (13 uses), `pgp/pgp-service.ts` (9),
  `email-store.ts`, `email-smtp.ts`, `email-imap-auth.ts`, `email-pop3-sync.ts`,
  `email-oauth-google.ts`, `email-oauth-microsoft.ts`, `automation/auth.ts`,
  `automation/settings.ts`, `ipc/automation.ts`.
- `packages/desktop/src/electron-standalone.ts:59-75` takes an **injected**
  `KeytarSecretPort` for the standalone-Postgres mode; nothing in `electron/`
  wires it today. Keep it compiling; do not migrate it in this plan.
- Tests mock keytar: `jest.config.cjs:107,121,145` and `jest.mail.config.cjs:39`
  map `^keytar$` to `tests/setup/keytar-mock.ts`; direct users:
  `tests/mail/email-keytar.test.ts`, `tests/mail/email-ai-keytar.test.ts`,
  `tests/mail/email-ai-profiles.test.ts`, `tests/integration/ipc-email-ai-profile-rebind.test.ts`.
  `vite.config.ts:57` lists `keytar` as external.
- Startup order (`electron/main.js:341-352`, `:540-568`): `initializeDatabase()`
  runs **before** `app.whenReady()`; IPC handlers, background mail services and
  the Automation API start after ready. `safeStorage` is only usable after
  `ready` (see its typings: `isEncryptionAvailable()` "returns true if the app has
  emitted the ready event" on Linux/Windows).
- `safeStorage` API in Electron 43 (`node_modules/electron/electron.d.ts:11818ff`):
  `isEncryptionAvailable()`, `encryptString`, `decryptString`,
  `isAsyncEncryptionAvailable()`, `encryptStringAsync`, `decryptStringAsync` →
  `{ shouldReEncrypt, result }`, `getSelectedStorageBackend()` (Linux:
  `basic_text | gnome_libsecret | kwallet | kwallet5 | kwallet6 | unknown`),
  `setUsePlainTextEncryption`.
- Backups: `electron/email/email-local-backup.ts:141` ("raw SQLite DB + attachment
  files (no Keytar secrets)"); `email-local-backup-export.ts:48-125` snapshots
  `database.sqlite` into the ZIP; `email-local-restore.ts:342-390` **replaces**
  `database.sqlite` wholesale; `maintenance/pre-update-backup.ts:33-76` keeps
  `VACUUM INTO` copies under `backups/pre-update` for downgrades. GDPR export
  (`email-gdpr-export.ts`) selects explicit columns only.
- Desktop schema changes go through `runMailRoadmapMigrations`
  (`electron/mail-roadmap-migrations.ts:149`, `ensureTable`/`addCol` helpers),
  called from `electron/sqlite-service.ts:1244`.
- CI E2E already runs a real `gnome-keyring-daemon` (`ci.yml:155-161`), so
  `safeStorage` there selects `gnome_libsecret`.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest tests/unit/desktop-credential-store.test.ts` | all pass |
| Unit / integration | `pnpm run test:unit` / `pnpm run test:integration` | all pass |
| Mail suite | `pnpm run test:mail` then `pnpm run test:mail:coverage` | pass, ratchet ok |
| Build | `pnpm run build` | exit 0 |
| Native status | `pnpm run native:status` | shows better-sqlite3 caches |
| E2E (headless) | `xvfb-run --auto-servernum pnpm run test:e2e` inside `dbus-run-session` with gnome-keyring (see `ci.yml:155-161`) | pass |

## Scope

**Phase 0 in scope**: `docs/design/desktop-credential-store.md` (create), an
optional throw-away spike branch (never merged).
**Phase 1 in scope**: `electron/credentials/**` (create), the six importers above,
`electron/mail-roadmap-migrations.ts` + `electron/database-schema.ts` (new table),
`electron/maintenance/keytar-purge.ts`, `reset-service.ts`, backup/restore files
listed above (only if the approved doc requires it), tests, `jest*.cjs`,
`vite.config.ts`, CI workflow files, `package.json`/lockfile (only in the
release that removes keytar — see doc), `CHANGELOG.md`, `AGENTS.md` native-module note.

**Out of scope**: server edition secrets (`packages/server`, Postgres secret
store); `packages/desktop/src/electron-standalone.ts`; renaming DB columns such
as `keytar_account_key` (they become opaque credential ids); any change to how
secrets are entered in the UI.

## Git workflow

- Branch `advisor/044-desktop-credential-store` (Phase 0 commit = design doc only).
- German commit messages, e.g. `Zugangsdaten: Entscheidungsdokument keytar → safeStorage` /
  `Zugangsdaten: ein Speicher für alle Geheimnisse, Umzug aus dem Schlüsselbund`.
- Do NOT push or open a PR unless the operator says so.

## Phase 0 — spike and decision document (no production code)

### Step 0.1: Spike on the three OSes you can reach

In a scratch branch, add a tiny main-process snippet (behind an env var) that
logs `isEncryptionAvailable()`, `await isAsyncEncryptionAvailable()`,
`getSelectedStorageBackend()` (Linux), round-trips a string with sync and async
APIs, and reports `shouldReEncrypt`. Run it on Linux under the CI keyring setup
and under `--password-store=basic`. Record results; note Windows/macOS as
"to be confirmed by maintainer" if unavailable.

**Verify**: a results table exists in the doc draft (backend, sync ok, async ok).

### Step 0.2: Write `docs/design/desktop-credential-store.md` (German, for Pascal)

Must decide, each with options + recommendation:
1. **Where ciphertext lives**: (a) new table `credential_store(service TEXT, account TEXT, ciphertext BLOB, updated_at TEXT, PRIMARY KEY(service, account))` in `database.sqlite` (recommended by audit) vs (b) a separate file in `userData` (e.g. `credentials.sqlite`) that backup/restore never touches. Spell out the consequences for (a): the mail backup ZIP and pre-update backups now contain ciphertext; a restore **replaces** it (same machine: credentials roll back to the backup's state; other machine: undecryptable → must read as "missing", never crash). Recommend one.
2. **Sync vs async API** (`encryptStringAsync`/`decryptStringAsync` + `shouldReEncrypt` handling).
3. **Linux `basic_text`** (and `unknown`): refuse to *write* new secrets and show a German warning (proposed text: „Kein sicherer Schlüsselspeicher gefunden – Zugangsdaten werden nicht gespeichert.“), keep reading keytar; or allow with explicit opt-in. Recommend refuse.
4. **Migration**: lazy per credential on first read — read store; if missing read keytar; encrypt → write → read back → compare; only then (see 5) delete keytar.
5. **When keytar entries are deleted**: the audit proposes "after successful write+readback". Risk: a downgrade to the previous version (supported via `backups/pre-update`) reads only keytar → credentials gone. Options: delete immediately; keep keytar entries for one release and delete in release N+1 (recommended); never delete (purge only on hard reset).
6. **Read-only keytar fallback** duration (one release) and the release that drops the dependency, CI `libsecret-1-dev`/`gcc-12` (check whether `better-sqlite3` still needs `gcc-12` before removing), and `release.yml:93`.
7. **Hard reset** (`keytar-purge.ts`): must clear the new store AND keytar while keytar is still a dependency.
8. **Plaintext never exportable**: no IPC/API returns decrypted secrets beyond today's call sites; backup ZIP must not contain plaintext.

End the doc with `Status: DRAFT — wartet auf Freigabe` and a checklist of the decisions.

**Verify**: `test -f docs/design/desktop-credential-store.md && grep -c "Status: DRAFT" docs/design/desktop-credential-store.md` → `1`.

### Step 0.3: HARD STOP

Commit the doc, set the README row to BLOCKED (see header), report. Do not continue.

## Phase 1 — build (only if the doc says `Status: APPROVED`; follow its decisions where they differ from the defaults below)

### Step 1.1: Credential-store abstraction + tests first

Create `electron/credentials/credential-store.ts` exporting
`getSecret(service, account)`, `setSecret(service, account, value)`,
`deleteSecret(service, account)`, `purgeAllSecrets()`, with injectable ports
(`safeStorage`-like cipher, SQLite table access, legacy keytar reader/deleter,
`whenReady`). Write `tests/unit/desktop-credential-store.test.ts` with fakes first:
- read hit in store; read miss → keytar hit → migrated (write, readback equal) → returned;
- readback mismatch / write throws / encryption unavailable → returns keytar value, store unchanged, keytar untouched;
- decrypt failure (foreign ciphertext) → treated as missing → keytar fallback, row NOT deleted;
- `basic_text` backend → `setSecret` rejects with the German message, nothing written;
- keytar deletion only per the approved rule (e.g. never in this release);
- concurrent `getSecret` for the same key migrates once.

**Verify**: focused test → all pass.

### Step 1.2: Schema

Add the table (decision 1) via `ensureTable` in `runMailRoadmapMigrations`.
**Verify**: `pnpm run test:mail` passes; a fresh DB in a unit test has the table.

### Step 1.3: Route all six importers through the store

Keep each module's exported function names and signatures; only the bodies
change (`email-ai-profiles.ts` direct calls at `:246-258` included). The only
remaining `keytar` import must be inside `electron/credentials/` (legacy reader)
and `keytar-purge.ts` (until removal).

**Verify**: `grep -rln "from 'keytar'" electron | sort` → only `electron/credentials/legacy-keytar.ts` and `electron/maintenance/keytar-purge.ts`; mail suite + coverage ratchet pass; `tests/integration/ipc-email-ai-profile-rebind.test.ts` passes.

### Step 1.4: Reset, backup/restore, E2E

Apply decisions 1, 7, 8. Add a restore test: restoring a backup whose store rows
cannot be decrypted leaves the app usable and credentials reported as missing.
**Verify**: unit + integration + E2E pass.

### Step 1.5: Changelog and docs

`CHANGELOG.md` `[Unreleased]` → `### Changed`: `- **Desktop:** Zugangsdaten (Mail, KI, MSSQL, Automation-API, PGP) werden mit der Verschlüsselung von Electron gespeichert; bestehende Einträge im Schlüsselbund werden beim ersten Zugriff automatisch übernommen.` Update the AGENTS.md native-module gotcha when keytar is finally removed (later release per decision 6).

## Test plan

Unit (Step 1.1 list), schema test, restore-with-foreign-ciphertext test, the
existing mail/AI-profile/automation tests (updated to mock the store instead of
keytar where they asserted keytar calls), E2E with gnome-keyring.

## Done criteria

- Phase 0: design doc committed with `Status: DRAFT`; README row BLOCKED; no production code changed (`git diff --stat` shows only the doc).
- Phase 1:
  - [ ] typecheck, lint (0 warnings), unit, integration, `test:mail:coverage` pass
  - [ ] `grep -rln "from 'keytar'" electron` → only the two files named in Step 1.3
  - [ ] new store tests pass, incl. the "never lose a credential" cases
  - [ ] CHANGELOG entry present; README row updated; **044** ticked in MASTERPLAN

## STOP conditions

- Any code path that could delete a keytar entry before a verified store write
  (write + decrypt readback equal), or that deletes a store row on decrypt failure.
- `safeStorage` behaves differently from the typings above (spike results).
- The approved doc chooses an option this plan does not describe (report, get a plan update).
- A migration would need the plaintext secret in logs, IPC responses, or the backup ZIP.
- Existing tests need weakened assertions about secret handling.
- The design doc is not approved — never start Phase 1.

## Maintenance notes

- Ciphertext is machine- and user-bound; moving a profile to a new PC requires re-entering secrets (as today with keytar).
- A later release removes the keytar dependency, the legacy reader, the jest mappings, `vite.config.ts` external and CI libsecret build deps.
- Reviewers: check every `deleteSecret`/keytar delete call and the restore path.
