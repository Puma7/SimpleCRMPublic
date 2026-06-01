import path from 'path';

/** Reject zip-slip paths; return absolute path under destDir or throw. */
export function resolveSafePathUnderDirectory(destDir: string, entryRel: string): string {
  const normalized = entryRel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) {
    throw new Error(`Ungültiger ZIP-Eintrag: ${entryRel}`);
  }
  const segments = normalized.split('/').filter((p) => p.length > 0);
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new Error(`Ungültiger ZIP-Eintrag (Pfad-Traversal): ${entryRel}`);
    }
  }
  const destRoot = path.resolve(destDir);
  const outPath = path.resolve(destRoot, ...segments);
  const relative = path.relative(destRoot, outPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`ZIP-Eintrag liegt außerhalb des Zielordners: ${entryRel}`);
  }
  return outPath;
}
