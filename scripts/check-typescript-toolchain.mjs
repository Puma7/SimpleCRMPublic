import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootManifest = readJson('package.json');
const svelteManifest = readJson('packages/svelte-lab/package.json');
const problems = [];

const requiredRoot = [
  'typescript',
  '@swc/core',
  '@swc/jest',
  'tsx',
  '@babel/core',
  '@babel/eslint-parser',
];
const forbiddenRoot = ['ts-jest', 'ts-node', 'typescript-eslint'];

for (const dependency of requiredRoot) {
  if (!declaredVersion(rootManifest, dependency)) {
    problems.push(`Missing root toolchain dependency: ${dependency}`);
  }
}

for (const dependency of forbiddenRoot) {
  if (declaredVersion(rootManifest, dependency)) {
    problems.push(`Forbidden legacy toolchain dependency: ${dependency}`);
  }
}

checkTypeScriptRange(rootManifest, 'root package.json');
checkTypeScriptRange(svelteManifest, 'packages/svelte-lab/package.json');

if (rootManifest.packageManager !== 'pnpm@11.12.0') {
  problems.push(`Expected packageManager pnpm@11.12.0, found ${rootManifest.packageManager ?? 'none'}`);
}

if (rootManifest.engines?.node !== '>=24') {
  problems.push(`Expected Node engine >=24, found ${rootManifest.engines?.node ?? 'none'}`);
}

if (problems.length > 0) {
  console.error('TypeScript toolchain check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log('TypeScript 7 toolchain declarations are consistent.');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function declaredVersion(manifest, dependency) {
  return manifest.devDependencies?.[dependency] ?? manifest.dependencies?.[dependency];
}

function checkTypeScriptRange(manifest, label) {
  const range = declaredVersion(manifest, 'typescript');
  const minimum = range ? semver.minVersion(range) : null;
  if (!minimum || !semver.satisfies(minimum, '>=7.0.2 <8')) {
    problems.push(`Expected TypeScript >=7.0.2 <8 in ${label}, found ${range ?? 'none'}`);
  }
}
