# Plan 012: Standardize on pnpm and remove the second lockfile

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`)
> — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat f24fb27..HEAD -- package-lock.json .gitignore .gitattributes docker/api.Dockerfile docker/web.Dockerfile tests/integration/server-edition-foundation.test.ts README.md AGENTS.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

The repo tracks **two** dependency lockfiles: `package-lock.json` (npm, 707 KB)
and `pnpm-lock.yaml` (pnpm, 478 KB). CI, release, and local dev all use pnpm
(`pnpm install --frozen-lockfile`), but the two Docker image builds still run
`npm ci` against `package-lock.json`. Nothing keeps the two lockfiles in sync,
so they can silently drift to resolve *different* dependency trees — the app you
test with pnpm is not guaranteed to be the app that ships in the Docker image.
Standardizing on one package manager (pnpm — it is what CI, release, and dev
already use) removes an entire class of "works on my machine / breaks in the
container" bugs and deletes ~700 KB of redundant, unverified metadata.

**Important correction to the source finding**: the audit claimed
`package-lock.json` "is never installed or checked." That is **false** in this
repo. `package-lock.json` is consumed by `docker/api.Dockerfile` and
`docker/web.Dockerfile` (both `RUN npm ci …`), those images are built by the
`server-compose-smoke` CI job (`docker compose … up --build`), and an
integration test asserts the exact `npm ci` string is present in the Dockerfile.
Therefore you **cannot** simply `git rm package-lock.json` — doing so breaks the
Docker builds, the smoke CI job, and that test. This plan converts the Docker
builds to pnpm as part of the removal. That is mandatory, not optional.

## Current state

Files involved and their role:

- `package-lock.json` — npm lockfile, git-tracked, 707 KB. To be deleted +
  gitignored.
- `pnpm-lock.yaml` — pnpm lockfile, git-tracked (`lockfileVersion: '9.0'`). The
  single surviving lockfile. **Do not modify.**
- `pnpm-workspace.yaml` — pnpm workspace config. **Do not modify.** Read it: it
  documents *why* both package managers currently coexist:
  ```yaml
  packages:
    - "packages/core"
    - "packages/server"
    - "packages/desktop"
  # pnpm 10 changed the default of link-workspace-packages to false … We keep
  # plain semver refs like "@simplecrm/core": "0.1.0" so npm's Docker `npm ci`
  # (which does not understand workspace:*) also resolves them as local
  # workspace links. This setting restores pnpm's version-based workspace linking.
  linkWorkspacePackages: true
  ```
  The plain-semver workspace refs mean the pnpm install path already works (CI
  proves it); we are removing the npm-specific accommodation, not the refs.
- `.gitignore` — currently ignores `node_modules/`, `.env*`, dist dirs, etc. No
  lockfile is ignored today. We add `package-lock.json`.
- `.gitattributes:36` — `package-lock.json text eol=lf` under a "Lockfiles"
  block. References the file we delete; the line must be removed.
- `docker/api.Dockerfile` — builds the server image (services `api` + `migrate`
  in `docker/docker-compose.yml`). Uses npm.
- `docker/web.Dockerfile` — builds the SPA into a Caddy image (service `caddy`).
  Uses npm.
- `tests/integration/server-edition-foundation.test.ts:331-337` — asserts the
  api Dockerfile's exact install/prune commands. Must be updated to the pnpm
  strings.
- `README.md:57-61` + `AGENTS.md:23,38` — tell humans/agents to `npm install
  --legacy-peer-deps`. The install commands are updated here; the broader
  `npm run …` → `pnpm run …` prose sweep is **out of scope** (see Scope).

Real excerpts at `f24fb27`:

`docker/api.Dockerfile` (full):
```dockerfile
FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.electron.json ./
COPY packages ./packages
RUN npm ci --legacy-peer-deps --ignore-scripts
RUN npm run build:packages
RUN npm prune --omit=dev --legacy-peer-deps --ignore-scripts

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
EXPOSE 3000
CMD ["node", "packages/server/dist/server.js"]
```

`docker/web.Dockerfile` (lines 7-16, the build stage):
```dockerfile
FROM node:24 AS build

WORKDIR /app
# Full context; .dockerignore keeps node_modules/.git/build output out.
COPY . .
RUN npm ci --legacy-peer-deps --ignore-scripts
# The bundle is large (Monaco). Raise the V8 heap so the build does not hit the
# ~2 GB default limit on small (e.g. 4 GB) hosts. The host still needs enough
# RAM+swap to back this; see docs/SETUP_SERVER.md.
RUN NODE_OPTIONS=--max-old-space-size=4096 SIMPLECRM_WEB_ONLY=1 npx vite build
```

`tests/integration/server-edition-foundation.test.ts:331-337`:
```ts
  test('api Docker image keeps runtime node dependencies for server CLI commands', () => {
    const dockerfile = readFileSync(join(__dirname, '..', '..', 'docker', 'api.Dockerfile'), 'utf8');
    expect(dockerfile).toContain('npm ci --legacy-peer-deps --ignore-scripts');
    expect(dockerfile).toContain('npm prune --omit=dev --legacy-peer-deps --ignore-scripts');
    expect(dockerfile).toContain('COPY --from=build /app/node_modules ./node_modules');
    expect(dockerfile).toContain('CMD ["node", "packages/server/dist/server.js"]');
  });
```

`README.md:57-61`:
```markdown
2. **Install Dependencies:**
   ```bash
   npm install --legacy-peer-deps
   ```
   (`--legacy-peer-deps` avoids peer-resolution conflicts in the current dependency tree.)
```

`AGENTS.md:23` (a row in the "Key commands" table) and `AGENTS.md:38` (a gotcha):
```markdown
| Install deps | `npm install --legacy-peer-deps` |
```
```markdown
- **`--legacy-peer-deps` is required** for `npm install` because the dependency tree has peer-resolution conflicts. Without it, install fails.
```

`.gitattributes:35-39`:
```gitattributes
# Lockfiles (avoid CRLF churn on Windows)
package-lock.json text eol=lf
yarn.lock         text eol=lf
pnpm-lock.yaml    text eol=lf
*.lock            text eol=lf
```

Repo conventions this plan must honor:

- **pnpm 9** is the pinned version. CI installs it via `pnpm/action-setup@v4`
  with `version: 9` (`.github/workflows/ci.yml:27-31`). In the Docker images
  (which have no such action) pin the same version with `npm install -g pnpm@9`.
- **The proven pnpm-in-Docker recipe** is in `.github/workflows/release.yml:73-74`:
  `pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts`. The
  `--node-linker=hoisted` flag produces a flat, npm-style `node_modules` so the
  multi-stage `COPY --from=build /app/node_modules …` copies real files (pnpm's
  default symlinked layout does not survive a cross-stage copy). `--ignore-scripts`
  skips the `postinstall` electron-rebuild (irrelevant to the server image and
  currently skipped by the `npm ci --ignore-scripts` too). Mirror this recipe.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Lint | `pnpm run lint` | exit 0 (eslint, `--max-warnings 0`) |
| Targeted test (Dockerfile assertions) | `pnpm run test:server-edition` | all pass |
| Full test suite | `pnpm test` | all pass |
| Build (renderer) | `pnpm run build` | exit 0 |
| Typecheck | `npx tsc -p tsconfig.json --noEmit` | exit 0, no errors (there is no `typecheck` script yet) |
| Docker api build | `docker build -f docker/api.Dockerfile -t simplecrm-api-test .` (run from repo root) | exit 0 |
| Docker web build | `docker build -f docker/web.Dockerfile -t simplecrm-web-test .` (run from repo root) | exit 0 |

The Docker builds require Docker + network access. If Docker is unavailable in
your environment, that is a STOP condition for the Docker verification steps —
see STOP conditions; the authoritative gate is then the `server-compose-smoke`
CI job, which builds these images on every push/PR.

## Scope

**In scope** (the only files you should modify):
- `package-lock.json` (delete)
- `.gitignore`
- `.gitattributes`
- `docker/api.Dockerfile`
- `docker/web.Dockerfile`
- `tests/integration/server-edition-foundation.test.ts`
- `README.md`
- `AGENTS.md`

**Out of scope** (do NOT touch, even though they look related):
- `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json` — the surviving pnpm
  setup already works; changing it is unnecessary and risky. In particular do
  **not** run `pnpm install` in a way that rewrites `pnpm-lock.yaml` (always use
  `--frozen-lockfile`).
- `.github/workflows/*.yml` — already pnpm; no change needed.
- `.dockerignore` — it already excludes only `node_modules/.git/dist/…`, so
  `pnpm-lock.yaml` + `pnpm-workspace.yaml` reach the build context unchanged.
  (Its comment says "lockfile" generically and stays accurate enough.)
- The broader `npm run …` → `pnpm run …` prose in `README.md` ("Running the
  Application", "Building the Application") and in other `docs/*.md` — this is a
  **documentation harmonization pass owned by the sibling docs plan (013)**. This
  plan only fixes the *install command* lines that would otherwise point humans
  at a removed lockfile / the wrong package manager. If plan 013 has already
  landed and those lines are already pnpm, skip Step 5 and note it.

## Git workflow

- Branch: `advisor/012-single-package-manager-pnpm`
- Commit per logical unit; conventional-commit style (example from `git log`:
  `fix(review): keep raw-headers / .eml export out of the mail read bucket`).
  Suggested commits:
  - `chore(deps): drop package-lock.json; standardize on pnpm`
  - `build(docker): install deps with pnpm instead of npm`
  - `test(server-edition): assert pnpm commands in api Dockerfile`
  - `docs: point install steps at pnpm`
- Do NOT push or open a PR.

## Steps

### Step 1: Delete package-lock.json and stop tracking it

1. Remove the file from git and the working tree:
   ```bash
   git rm package-lock.json
   ```
2. Add it to `.gitignore` so a stray local `npm install` never re-tracks it.
   Insert a `package-lock.json` line under the existing `# dependencies` block.
   Current `.gitignore:2-5`:
   ```gitignore
   # dependencies
   node_modules/
   **/node_modules/
   ```
   Make it:
   ```gitignore
   # dependencies
   node_modules/
   **/node_modules/
   # We standardize on pnpm; npm's lockfile is intentionally untracked.
   package-lock.json
   ```
3. Remove the now-dangling `.gitattributes` line for the deleted file. Delete
   exactly this line (`.gitattributes:36`):
   ```gitattributes
   package-lock.json text eol=lf
   ```
   Leave the `yarn.lock`, `pnpm-lock.yaml`, and `*.lock` lines intact.

**Verify**:
- `git ls-files package-lock.json` → prints nothing (no longer tracked).
- `git check-ignore package-lock.json` → prints `package-lock.json` (ignored).
- `git grep -n package-lock -- .gitattributes` → prints nothing.

### Step 2: Convert docker/api.Dockerfile to pnpm

Replace the entire contents of `docker/api.Dockerfile` with:
```dockerfile
FROM node:24-alpine AS build

WORKDIR /app
RUN npm install -g pnpm@9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.electron.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts
RUN pnpm run build:packages
RUN pnpm prune --prod

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
EXPOSE 3000
CMD ["node", "packages/server/dist/server.js"]
```
Key differences from the original:
- Install pnpm 9 globally (no `pnpm/action-setup` inside Docker).
- COPY `pnpm-lock.yaml pnpm-workspace.yaml` instead of `package-lock.json`
  (pnpm needs the workspace file to resolve `packages/*`).
- `pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts`
  replaces `npm ci --legacy-peer-deps --ignore-scripts`.
- `pnpm prune --prod` replaces `npm prune --omit=dev --legacy-peer-deps
  --ignore-scripts` (removes devDependencies; `--prod` is the pnpm flag).
- The two runtime-stage `COPY --from=build …` lines and the `CMD` are unchanged.

**Verify**:
- `grep -nE "npm ci|npm prune|package-lock" docker/api.Dockerfile` → prints nothing.
- `grep -n "pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts" docker/api.Dockerfile` → matches line.
- `grep -n 'CMD \["node", "packages/server/dist/server.js"\]' docker/api.Dockerfile` → still present.

### Step 3: Convert docker/web.Dockerfile to pnpm

In `docker/web.Dockerfile`, change only the build stage's install. Replace this
line (`docker/web.Dockerfile:12`):
```dockerfile
RUN npm ci --legacy-peer-deps --ignore-scripts
```
with these two lines:
```dockerfile
RUN npm install -g pnpm@9
RUN pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts
```
Leave everything else unchanged — `COPY . .` already brings `pnpm-lock.yaml` and
`pnpm-workspace.yaml` into the context, and the `npx vite build` line and the
`caddy:2` runtime stage are untouched.

**Verify**:
- `grep -nE "npm ci|package-lock" docker/web.Dockerfile` → prints nothing.
- `grep -n "pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts" docker/web.Dockerfile` → matches line.

### Step 4: Update the Dockerfile assertion test

In `tests/integration/server-edition-foundation.test.ts`, the test at lines
331-337 asserts the old npm strings. Update the two install/prune assertions to
the pnpm strings (leave the `COPY --from=build …` and `CMD …` assertions as-is).

Change:
```ts
    expect(dockerfile).toContain('npm ci --legacy-peer-deps --ignore-scripts');
    expect(dockerfile).toContain('npm prune --omit=dev --legacy-peer-deps --ignore-scripts');
```
to:
```ts
    expect(dockerfile).toContain('pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts');
    expect(dockerfile).toContain('pnpm prune --prod');
```

**Verify**: `pnpm run test:server-edition` → all pass (this runs both the unit
and integration `server-edition-foundation.test.ts` files). In particular the
test `api Docker image keeps runtime node dependencies for server CLI commands`
passes.

### Step 5: Point the install docs at pnpm

(Skip this step and note it if plan 013 already converted these lines to pnpm.)

1. `README.md:57-61` — replace:
   ```markdown
   2. **Install Dependencies:**
      ```bash
      npm install --legacy-peer-deps
      ```
      (`--legacy-peer-deps` avoids peer-resolution conflicts in the current dependency tree.)
   ```
   with:
   ```markdown
   2. **Install Dependencies:**
      ```bash
      pnpm install
      ```
      (This project uses **pnpm**. pnpm resolves the peer-dependency tree
      automatically — no `--legacy-peer-deps` flag is needed. Install pnpm 9+
      first if you don't have it: `npm install -g pnpm@9`.)
   ```
2. `AGENTS.md:23` — change the "Install deps" table row from:
   ```markdown
   | Install deps | `npm install --legacy-peer-deps` |
   ```
   to:
   ```markdown
   | Install deps | `pnpm install` |
   ```
3. `AGENTS.md:38` — the `--legacy-peer-deps` gotcha is now misleading. Replace:
   ```markdown
   - **`--legacy-peer-deps` is required** for `npm install` because the dependency tree has peer-resolution conflicts. Without it, install fails.
   ```
   with:
   ```markdown
   - **Package manager is pnpm** (pinned to 9 in CI). pnpm resolves the peer-dependency conflicts automatically (`autoInstallPeers` in `pnpm-lock.yaml` settings), so no `--legacy-peer-deps` flag is needed. Do not add a second lockfile.
   ```

**Verify**: `git grep -n "npm install --legacy-peer-deps" -- README.md AGENTS.md`
→ prints nothing.

### Step 6: Full verification

Run the repo gates:
- `pnpm install --frozen-lockfile` → exit 0 (confirms `pnpm-lock.yaml` still
  installs the workspace cleanly; it should be untouched by this plan).
- `pnpm run lint` → exit 0.
- `pnpm test` → all pass.
- If Docker is available: `docker build -f docker/api.Dockerfile -t simplecrm-api-test .`
  and `docker build -f docker/web.Dockerfile -t simplecrm-web-test .` (both from
  repo root) → exit 0. If Docker is unavailable, record that the Docker builds
  were not locally verified and rely on the `server-compose-smoke` CI job.

## Test plan

- No new test files. One existing test is updated: the api-Dockerfile assertion
  in `tests/integration/server-edition-foundation.test.ts` (Step 4). It now
  proves the image installs with pnpm and prunes dev deps for prod — the same
  intent as before, guarding a runtime regression where the server image ships
  without its node dependencies.
- The end-to-end guard that the converted images actually build and run is the
  existing `server-compose-smoke` CI job (`.github/workflows/ci.yml:72-155`),
  which does `docker compose … up --build postgres migrate api caddy` — building
  both converted Dockerfiles — then hits the health endpoints and runs the
  backup / doctor / restore-drill profiles. No change to that job is needed.
- Verification: `pnpm run test:server-edition` → all pass; `pnpm test` → all
  pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `git ls-files package-lock.json` prints nothing (file deleted + untracked)
- [ ] `git check-ignore package-lock.json` prints `package-lock.json`
- [ ] `git grep -n "npm ci" -- docker/` prints nothing
- [ ] `git grep -n "package-lock" -- . ':!pnpm-lock.yaml' ':!.gitignore'` prints nothing
- [ ] `pnpm run test:server-edition` exits 0 (updated Dockerfile assertions pass)
- [ ] `pnpm install --frozen-lockfile` exits 0
- [ ] `pnpm run lint` exits 0
- [ ] `pnpm test` exits 0
- [ ] `git grep -n "npm install --legacy-peer-deps" -- README.md AGENTS.md` prints nothing
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts (the
  codebase has drifted since this plan was written — e.g. the Dockerfiles are
  already on pnpm, or `package-lock.json` is already gone).
- `pnpm install --frozen-lockfile` fails or wants to modify `pnpm-lock.yaml` —
  do not regenerate the lockfile; report instead.
- A Docker build fails (e.g. `pnpm prune --prod` errors, or the web build hits a
  Rollup/optional-dependency resolution error under the pnpm layout). Do not
  hand-edit dependencies to force it through — report the exact error.
- Docker is not available in your environment: run every non-Docker verification,
  then report that the two `docker build` steps could not be executed locally and
  that the `server-compose-smoke` CI job is the remaining gate. This is expected,
  not a failure — do not try to install Docker.
- Any step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file (e.g. `package.json`
  or `pnpm-workspace.yaml`).

## Maintenance notes

For the human/agent who owns this after the change lands:

- **The Docker builds now depend on `pnpm-lock.yaml` + `pnpm-workspace.yaml`.**
  Any future change to those must keep `pnpm install --frozen-lockfile` green,
  or the Docker images (and the `server-compose-smoke` job) break.
- **`--node-linker=hoisted` is load-bearing** in `docker/api.Dockerfile`: the
  multi-stage `COPY --from=build /app/node_modules …` only works with a flat
  (hoisted) `node_modules`. If someone drops that flag, the runtime stage will
  copy broken symlinks and the server image will fail at `node …server.js`.
- **Deferred to the docs plan (013)**: the remaining `npm run …` invocations in
  `README.md` ("Running the Application", "Building the Application", the
  `postinstall`/`electron-rebuild` block) and any `npm`/`--legacy-peer-deps`
  references scattered through `docs/*.md`. This plan intentionally touched only
  the *install command* lines to avoid colliding with that pass.
- **Optional follow-up** (not done here to keep scope small): add
  `"packageManager": "pnpm@9.x.x"` to `package.json` so `corepack` pins the
  version for local dev too. Left out because CI/release pin pnpm explicitly and
  the Docker images pin via `npm install -g pnpm@9`.
- A reviewer should scrutinize: (1) the exact pnpm command strings match between
  the Dockerfile and the updated test assertion, (2) `git status` shows only the
  eight in-scope files, (3) `pnpm-lock.yaml` is unchanged in the diff.
