#!/usr/bin/env node
// Verifies better-sqlite3 compatibility with Electron's modern V8 API.
// Older releases need a local HolderV2 patch; newer releases provide the same
// compatibility through a guarded PROPERTY_HOLDER macro.
const fs = require('fs');
const path = require('path');

// Locate the package — path differs between npm and pnpm installs
function findPackageDir() {
  const candidates = [
    path.join(__dirname, '../node_modules/better-sqlite3'),
  ];
  // Also check pnpm content-addressable store if it exists
  const pnpmDir = path.join(__dirname, '../node_modules/.pnpm');
  if (fs.existsSync(pnpmDir)) {
    const pnpmCandidates = fs.readdirSync(pnpmDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('better-sqlite3@'))
      .map(e => path.join(pnpmDir, e.name, 'node_modules/better-sqlite3'));
    candidates.push(...pnpmCandidates);
  }
  return candidates.find(p => fs.existsSync(path.join(p, 'src')));
}

const TARGET_FILES = ['src/objects/database.cpp', 'src/objects/statement.cpp'];
const MACRO_FILE = 'src/util/macros.cpp';
const FROM = 'info.Holder()';
const TO = 'info.HolderV2()';

function usesSafeUpstreamMacro(pkgDir, sources) {
  if (!sources.every(source => source.includes('PROPERTY_HOLDER(info)'))) {
    return false;
  }

  const macroFile = path.join(pkgDir, MACRO_FILE);
  if (!fs.existsSync(macroFile)) {
    throw new Error(
      `patch-better-sqlite3: ${MACRO_FILE} is missing while target files use ` +
      'PROPERTY_HOLDER(info). Refusing to trust an undefined compatibility macro.'
    );
  }

  const macros = fs.readFileSync(macroFile, 'utf8');
  const modernV8Guard = /#if\s+defined\(V8_MAJOR_VERSION\)\s*&&\s*V8_MAJOR_VERSION\s*>=\s*13/;
  const holderV2Definition = /#define\s+PROPERTY_HOLDER\(info\)\s+\(info\)\.HolderV2\(\)/;
  if (!modernV8Guard.test(macros) || !holderV2Definition.test(macros)) {
    throw new Error(
      'patch-better-sqlite3: PROPERTY_HOLDER(info) is not guarded for modern ' +
      'V8 with HolderV2(). Refusing to ship a broken native module.'
    );
  }

  return true;
}

function patchBetterSqlite3(pkgDir) {
  if (!pkgDir) {
    throw new Error(
      'patch-better-sqlite3: better-sqlite3 package directory not found. ' +
      'The dependency must be installed with its src/ before this patch runs; ' +
      'refusing to continue with a possibly broken native module.'
    );
  }
  const targetSources = TARGET_FILES.map(rel => {
    const file = path.join(pkgDir, rel);
    if (!fs.existsSync(file)) {
      throw new Error(
        `patch-better-sqlite3: target file missing: ${file}. ` +
        'The better-sqlite3 source layout changed; the patch can no longer be ' +
        'applied. Update this script for the new upstream layout.'
      );
    }
    return fs.readFileSync(file, 'utf8');
  });

  if (usesSafeUpstreamMacro(pkgDir, targetSources)) {
    console.log(
      `patch-better-sqlite3: verified upstream PROPERTY_HOLDER compatibility ` +
      `in ${pkgDir}`
    );
    return 0;
  }

  let applied = 0;
  for (const [index, rel] of TARGET_FILES.entries()) {
    const file = path.join(pkgDir, rel);
    const before = targetSources[index];
    const after = before.split(FROM).join(TO); // replaceAll of a literal
    // Informational count only (TO is longer than FROM by 2 chars per hit):
    applied += (after.length - before.length) / (TO.length - FROM.length) || 0;
    fs.writeFileSync(file, after);

    // End-state assertion (idempotent): the file must end patched, whether we
    // just changed it or it was already patched on a re-run. FROM is not a
    // substring of TO, so this cannot be fooled by an already-patched file.
    const result = fs.readFileSync(file, 'utf8');
    if (result.includes(FROM) || !result.includes(TO)) {
      throw new Error(
        `patch-better-sqlite3: ${file} is not in the expected patched state ` +
        `after processing (want '${TO}', still found unpatched '${FROM}', or ` +
        `'${TO}' absent). Refusing to ship a broken native module.`
      );
    }
  }
  console.log(
    `patch-better-sqlite3: verified ${TARGET_FILES.length} file(s) patched ` +
    `(${applied} replacement(s) applied this run) in ${pkgDir}`
  );
  return applied;
}

if (require.main === module) {
  try {
    patchBetterSqlite3(findPackageDir());
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { patchBetterSqlite3, findPackageDir, TARGET_FILES };
