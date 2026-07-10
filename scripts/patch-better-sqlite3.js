#!/usr/bin/env node
// Patches better-sqlite3 for Electron 41+ compatibility.
// v12.7.1 upstream used Holder() but Electron 41's V8 only exposes HolderV2().
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
const FROM = 'info.Holder()';
const TO = 'info.HolderV2()';

function patchBetterSqlite3(pkgDir) {
  if (!pkgDir) {
    throw new Error(
      'patch-better-sqlite3: better-sqlite3 package directory not found. ' +
      'The dependency must be installed with its src/ before this patch runs; ' +
      'refusing to continue with a possibly broken native module.'
    );
  }
  let applied = 0;
  for (const rel of TARGET_FILES) {
    const file = path.join(pkgDir, rel);
    if (!fs.existsSync(file)) {
      throw new Error(
        `patch-better-sqlite3: target file missing: ${file}. ` +
        'The better-sqlite3 source layout changed; the patch can no longer be ' +
        'applied. Update this script for the new upstream layout.'
      );
    }
    const before = fs.readFileSync(file, 'utf8');
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
