import path from 'path';
import type Database from 'better-sqlite3';

/**
 * `email_message_attachments.storage_path` is stored relative to the attachments
 * root (`<messageId>/<file>`, forward slashes) so a backup restored on another
 * machine or profile still finds its files. Rows written by older versions hold
 * the absolute path of the machine that wrote them; readers map those onto the
 * current root.
 */

const ATTACHMENTS_DIR_NAME = 'email-attachments';

function isAbsoluteOnAnyPlatform(p: string): boolean {
  return path.posix.isAbsolute(p) || path.win32.isAbsolute(p);
}

function segmentsOf(p: string): string[] {
  return p.split(/[\\/]+/).filter((s) => s.length > 0);
}

function isInsideRoot(resolved: string, root: string): boolean {
  return resolved.startsWith(root + path.sep);
}

/** DB value for a file written below `root`. */
export function toStoredAttachmentPath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

/**
 * Relative `<messageId>/<file>` form of a legacy absolute path, taken from the
 * segments after its `email-attachments` directory. null for relative values or
 * when the layout is not recognisable.
 */
export function legacyAttachmentPathToRelative(storagePath: string): string | null {
  if (!storagePath || !isAbsoluteOnAnyPlatform(storagePath)) return null;
  const segments = segmentsOf(storagePath);
  if (segments.length < 3 || segments[segments.length - 3] !== ATTACHMENTS_DIR_NAME) return null;
  const tail = segments.slice(-2);
  if (tail.some((s) => s === '.' || s === '..')) return null;
  return tail.join('/');
}

/**
 * Absolute path of a stored attachment below `root`, or null when the value
 * cannot be mapped or would leave the root (path traversal).
 */
export function resolveStoredAttachmentPath(storagePath: string, root: string): string | null {
  if (!storagePath) return null;
  const resolvedRoot = path.resolve(root);

  if (isAbsoluteOnAnyPlatform(storagePath)) {
    const direct = path.resolve(storagePath);
    if (path.isAbsolute(storagePath) && isInsideRoot(direct, resolvedRoot)) return direct;
    const relative = legacyAttachmentPathToRelative(storagePath);
    return relative ? path.resolve(resolvedRoot, ...segmentsOf(relative)) : null;
  }

  const segments = segmentsOf(storagePath);
  if (segments.length === 0 || segments.some((s) => s === '.' || s === '..')) return null;
  const resolved = path.resolve(resolvedRoot, ...segments);
  return isInsideRoot(resolved, resolvedRoot) ? resolved : null;
}

/**
 * One-time data fix: rewrites legacy absolute storage_path values to the
 * relative form. Idempotent (relative rows and unrecognisable paths are left
 * alone); returns the number of rewritten rows.
 */
export function rewriteLegacyAttachmentStoragePaths(
  conn: Database.Database,
  table: string,
): number {
  const rows = conn.prepare(`SELECT id, storage_path FROM ${table}`).all() as { id: number; storage_path: string }[];
  const update = conn.prepare(`UPDATE ${table} SET storage_path = ? WHERE id = ?`);
  let rewritten = 0;
  conn.transaction(() => {
    for (const row of rows) {
      const relative = legacyAttachmentPathToRelative(row.storage_path);
      if (!relative) continue;
      update.run(relative, row.id);
      rewritten += 1;
    }
  })();
  return rewritten;
}
