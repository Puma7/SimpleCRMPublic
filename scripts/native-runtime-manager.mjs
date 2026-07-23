#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = resolve(dirname(scriptPath), '..');
const require = createRequire(join(workspaceRoot, 'package.json'));
const sqlitePackageJsonPath = require.resolve('better-sqlite3/package.json');
const sqlitePackageRoot = dirname(sqlitePackageJsonPath);
const sqlitePackage = JSON.parse(await readFile(sqlitePackageJsonPath, 'utf8'));
const sqliteBinaryPath = join(sqlitePackageRoot, 'build', 'Release', 'better_sqlite3.node');
const forgeMetaPath = join(sqlitePackageRoot, 'build', 'Release', '.forge-meta');
const electronPackage = JSON.parse(await readFile(require.resolve('electron/package.json'), 'utf8'));
const electronExecutable = require('electron');
const nodeAbi = process.versions.modules;

function runtimeEnvironment(runtime) {
  const env = { ...process.env };
  if (runtime === 'electron') {
    env.ELECTRON_RUN_AS_NODE = '1';
  } else {
    delete env.ELECTRON_RUN_AS_NODE;
  }
  return env;
}

function runElectronCode(source) {
  return spawnSync(electronExecutable, ['-e', source], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    env: runtimeEnvironment('electron'),
    windowsHide: false,
  });
}

function getElectronAbi() {
  const result = runElectronCode("process.stdout.write(process.versions.modules || '')");
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Unable to determine Electron ABI: ${result.stderr || result.error || 'unknown error'}`);
  }
  return result.stdout.trim();
}

const electronAbi = getElectronAbi();
const cacheRoot = join(
  workspaceRoot,
  'node_modules',
  '.cache',
  'simplecrm-native',
  `better-sqlite3-${sqlitePackage.version}-${process.platform}-${process.arch}`,
);
const nodeCachePath = join(cacheRoot, `node-${process.version}-abi-${nodeAbi}.node`);
const electronCachePath = join(
  cacheRoot,
  `electron-${electronPackage.version}-abi-${electronAbi}.node`,
);

function probe(runtime) {
  const source = [
    `const Database = require(${JSON.stringify(sqlitePackageRoot)});`,
    "const db = new Database(':memory:');",
    "const row = db.prepare('select 1 as ok').get();",
    'db.close();',
    "if (row.ok !== 1) throw new Error('SQLite probe returned an invalid result');",
  ].join('\n');
  const command = runtime === 'electron' ? electronExecutable : process.execPath;
  const result = spawnSync(command, ['-e', source], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    env: runtimeEnvironment(runtime),
    windowsHide: false,
  });
  return {
    ok: result.status === 0,
    detail: (result.stderr || result.stdout || result.error?.message || '').trim(),
  };
}

function assertProbe(runtime) {
  const result = probe(runtime);
  if (!result.ok) {
    throw new Error(`${runtime} cannot load better-sqlite3: ${result.detail || 'unknown error'}`);
  }
}

async function rebuildNodeBinary() {
  const packageRequire = createRequire(sqlitePackageJsonPath);
  const prebuildInstall = packageRequire.resolve('prebuild-install/bin.js');
  const nodeGyp = packageRequire.resolve('node-gyp/bin/node-gyp.js');
  const env = { ...runtimeEnvironment('node') };
  for (const key of Object.keys(env)) {
    const normalized = key.toLowerCase();
    if (
      normalized === 'npm_config_runtime'
      || normalized === 'npm_config_target'
      || normalized === 'npm_config_disturl'
      || normalized === 'npm_config_target_arch'
    ) {
      delete env[key];
    }
  }

  const originalBinary = existsSync(sqliteBinaryPath) ? await readFile(sqliteBinaryPath) : undefined;
  await rm(forgeMetaPath, { force: true });
  await rm(sqliteBinaryPath, { force: true });
  let result = spawnSync(process.execPath, [prebuildInstall], {
    cwd: sqlitePackageRoot,
    env,
    stdio: 'inherit',
    windowsHide: false,
  });
  if (result.status !== 0) {
    result = spawnSync(process.execPath, [nodeGyp, 'rebuild', '--release'], {
      cwd: sqlitePackageRoot,
      env,
      stdio: 'inherit',
      windowsHide: false,
    });
  }
  if (result.status !== 0) {
    if (originalBinary) await writeFile(sqliteBinaryPath, originalBinary);
    throw new Error(`Unable to rebuild better-sqlite3 for Node (exit ${result.status ?? 'unknown'})`);
  }
}

async function ensureNodeCache() {
  await mkdir(cacheRoot, { recursive: true });
  if (existsSync(nodeCachePath)) return;

  if (!probe('node').ok) await rebuildNodeBinary();
  assertProbe('node');
  await copyFile(sqliteBinaryPath, nodeCachePath);
}

async function applyNodeCache() {
  await copyFile(nodeCachePath, sqliteBinaryPath);
  await rm(forgeMetaPath, { force: true });
  assertProbe('node');
}

async function ensureElectronCache() {
  if (existsSync(electronCachePath)) return;

  await applyNodeCache();
  const { rebuild } = await import('@electron/rebuild');
  try {
    await rm(forgeMetaPath, { force: true });
    await rebuild({
      buildPath: workspaceRoot,
      electronVersion: electronPackage.version,
      platform: process.platform,
      arch: process.arch,
      force: true,
      onlyModules: ['better-sqlite3'],
      mode: 'sequential',
      useElectronClang: process.platform === 'linux',
    });
    assertProbe('electron');
    await copyFile(sqliteBinaryPath, electronCachePath);
  } finally {
    await applyNodeCache();
  }
}

export async function initializeNativeRuntimeCache() {
  await ensureNodeCache();
  await ensureElectronCache();
  await applyNodeCache();
  console.log(
    `Native runtime cache ready: Node ABI ${nodeAbi}, Electron ${electronPackage.version} ABI ${electronAbi}.`,
  );
}

export async function selectNativeRuntime(runtime) {
  if (runtime !== 'node' && runtime !== 'electron') {
    throw new Error(`Unsupported native runtime: ${runtime}`);
  }
  await ensureNodeCache();
  await ensureElectronCache();
  if (runtime === 'node') {
    await applyNodeCache();
    console.log(`Selected Node ABI ${nodeAbi} native modules.`);
    return;
  }

  await copyFile(electronCachePath, sqliteBinaryPath);
  await writeFile(forgeMetaPath, `${process.arch}--${electronAbi}`);
  assertProbe('electron');
  console.log(`Selected Electron ${electronPackage.version} ABI ${electronAbi} native modules.`);
}

export function getNativeRuntimeStatus() {
  return {
    betterSqlite3: sqlitePackage.version,
    current: probe('node').ok ? 'node' : probe('electron').ok ? 'electron' : 'invalid',
    node: { abi: nodeAbi, cached: existsSync(nodeCachePath) },
    electron: {
      version: electronPackage.version,
      abi: electronAbi,
      cached: existsSync(electronCachePath),
    },
  };
}

async function main() {
  const command = process.argv[2];
  if (command === 'initialize') {
    await initializeNativeRuntimeCache();
  } else if (command === 'node' || command === 'electron') {
    await selectNativeRuntime(command);
  } else if (command === 'status') {
    console.log(JSON.stringify(getNativeRuntimeStatus(), null, 2));
  } else {
    throw new Error('Usage: node scripts/native-runtime-manager.mjs <initialize|node|electron|status>');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
