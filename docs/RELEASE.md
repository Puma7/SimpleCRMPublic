# Desktop Release Pipeline

How a desktop release is built and published by `.github/workflows/release.yml`.

## Trigger

Pushing a tag `v*` starts the workflow. The tag must equal `v` + the `version` in
`package.json`; both build jobs stop otherwise.

## Jobs

| Job | Token | What it does |
|-----|-------|--------------|
| `create-release` | `contents: write` | Creates a **draft** release with the changelog entry for this version. |
| `build-windows` | read only, no token in any step | Installs dependencies, runs `pnpm run electron:build` (`electron-builder --publish never`) and uploads the updater files as the workflow artifact `release-windows`. |
| `build-macos` | read only, no token in any step | Same for macOS, artifact `release-macos`. |
| `publish-release` | `contents: write` | Downloads both artifacts, checks them against the update metadata, attaches them with `gh release upload` and publishes the draft. |

Dependency install scripts, vite, tsc and electron-builder run without the
`GITHUB_TOKEN`. `actions/checkout` runs with `persist-credentials: false` in
every job, so the token is not left in `.git/config` either. Only the two steps
that talk to the release API receive the token as an environment variable.

## Files attached to the release

These are exactly the files `electron-updater` reads from a GitHub release:

| Platform | Files (from `dist-build/`) |
|----------|----------------------------|
| Windows (NSIS) | `latest.yml`, `*.exe` (installer), `*.exe.blockmap` |
| macOS (DMG) | `latest-mac.yml`, `*.dmg`, `*.dmg.blockmap` |

The `.blockmap` enables the differential download. `latest.yml` names the
installer with dashes instead of spaces (`SimpleCRM-Setup-1.2.3.exe`), which is
how electron-builder used to upload it; the publish job renames the files the
same way and fails if a manifest points to a file (or blockmap) that is missing.

If a build target changes in `package.json` (`build.win.target`,
`build.mac.target`), the upload list in the build job has to change with it.
`tests/integration/release-workflow-hardening.test.ts` derives the expected list
from `package.json` and fails until both match.

## Pinned actions

Every `uses:` in `release.yml` and `ci.yml` points to a full commit SHA, with the
version in a trailing comment, e.g.

```yaml
uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0
```

A moved tag of a third-party action therefore cannot change what runs with
`contents: write`. To update an action, resolve the new tag to its commit and
replace SHA and comment together:

```sh
git ls-remote --tags https://github.com/actions/checkout 'v6*'
# annotated tags: use the line ending in ^{} (the commit, not the tag object)
```

The same test checks that every action is pinned this way.

## Local builds

`pnpm run electron:build` never publishes. `pnpm run electron:publish`
(`electron-builder --publish always`, needs `GH_TOKEN`) is still there for a
manual emergency release from a trusted machine; the regular path is the tag
workflow above.
