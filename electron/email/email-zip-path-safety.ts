import fs from 'fs';
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

/** Locate database.sqlite in extracted backup (root or nested). */
export function findDatabaseSqliteInTree(rootDir: string): string | null {
  const direct = path.join(rootDir, 'database.sqlite');
  if (fs.existsSync(direct)) return direct;
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isFile() && ent.name === 'database.sqlite') {
        return full;
      }
      if (ent.isDirectory()) {
        stack.push(full);
      }
    }
  }
  return null;
}
