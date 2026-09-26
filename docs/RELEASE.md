# Desktop Release Pipeline

How a desktop release is built and published by `.github/workflows/release.yml`.

## Trigger

Pushing a tag `v*` starts the workflow. The tag must equal `v` + the `version` in
`package.json`; both build jobs stop otherwise.

Before tagging: set `version` in the root `package.json`, add a `## [x.y.z]`
section to `CHANGELOG.md` (it becomes the release notes), merge to `main`, then
tag that merge commit.

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

## Code signing and auto-update (F-A7-10)

**Current state:** the builds are not signed.

- **Windows:** `electron-updater` downloads updates in the background and
  installs them when the app quits. Without a signature it only checks the
  sha512 from `latest.yml` of the same release; the assets are only as safe as
  write access to the release (hence the token-free build above).
- **macOS:** the app checks for a new version but downloads and installs
  nothing. The update banner says "Neue Version verfügbar – bitte manuell von der
  Release-Seite installieren" and offers **Release-Seite öffnen**; users install
  the new DMG by hand. The link is taken from the `app-update.yml` that
  electron-builder puts into the app (owner/repo of the release feed).
  "Neustart & Aktualisieren" refuses on macOS with a matching message. The switch
  is `MANUAL_UPDATE_PLATFORMS` in `electron/update-service.ts`. Squirrel.Mac
  would reject an unsigned update anyway, and the DMG-only build has no zip that
  `electron-updater` needs on macOS.

### What signing needs

**macOS (Developer ID + notarization)**

- Apple Developer Program membership (about 99 USD per year) and a
  *Developer ID Application* certificate, exported as `.p12`.
- Notarization credentials, either an App Store Connect API key
  (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) or Apple ID,
  app-specific password and team ID (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID`).
- `package.json` → `build.mac`: `"notarize": true` (hardened runtime is the
  electron-builder default). Check that `better-sqlite3` and `keytar` still load
  in the notarized app.
- Repository secrets `CSC_LINK` (base64 of the `.p12`) and `CSC_KEY_PASSWORD`
  plus the notarization variables, passed **only** to the electron-builder step
  of `build-macos`, ideally through a GitHub environment with required
  reviewers.

**Windows (OV or EV certificate via cloud HSM)**

- Private keys of publicly trusted code-signing certificates have to live in a
  hardware security module, so CI signs through a cloud signing service, for
  example Azure Trusted Signing (`build.win.azureSignOptions`) or an OV/EV
  certificate in DigiCert KeyLocker, SSL.com eSigner or Azure Key Vault (custom
  `build.win.signtoolOptions.sign` script). An OV certificate is enough
  technically.
- Set the certificate's subject name as `publisherName` (in `signtoolOptions` or
  `azureSignOptions`). electron-builder writes it into `app-update.yml`, and from
  then on `NsisUpdater` accepts only installers with a valid Authenticode
  signature from that publisher. Installs from before that version still check
  only the sha512, so they reach the first signed version the old way.
- Pass the signing credentials only to the electron-builder step of
  `build-windows`.

`tests/integration/release-workflow-hardening.test.ts` currently allows no
`secrets.` at all in the build jobs. When signing is added, narrow that check to
the named signing secrets in the electron-builder step; `GITHUB_TOKEN` stays out.

### Turning macOS auto-update back on

Only after signed and notarized builds come out of `build-macos`
(`codesign --verify --deep --strict`, `spctl -a -vv` and
`xcrun stapler validate` pass on the built app):

1. `package.json` → `build.mac.target`: add `{ "target": "zip", "arch": ["arm64"] }`
   next to the DMG. The macOS updater installs from the zip.
2. `.github/workflows/release.yml` → `build-macos` upload list: add
   `dist-build/*.zip` and `dist-build/*.zip.blockmap`. The release test derives
   the list from `package.json` and fails until this is done; the publish job
   fails too if `latest-mac.yml` points to a missing file.
3. `electron/update-service.ts`: remove `'darwin'` from
   `MANUAL_UPDATE_PLATFORMS`, and turn the macOS cases in
   `tests/integration/update-service-macos.test.ts` into the automatic path.
4. Installs of the unsigned app cannot update themselves to the signed one;
   users install the first signed version manually once.
