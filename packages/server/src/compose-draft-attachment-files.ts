import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Files uploaded to a local server draft live under
 * <attachmentsRoot>/<workspaceId>/compose-drafts/<draftId>/. They have no
 * email_message_attachments row, so nothing else ever removes them: without a
 * quota and cleanup every upload stays on disk (and in every backup) forever.
 *
 * Same limits as the send path (mail-compose-send.ts: 25 MB per file, 50 MB in
 * total); the file count caps many tiny uploads.
 */
export const MAX_COMPOSE_DRAFT_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_COMPOSE_DRAFT_ATTACHMENT_FILES = 50;

/**
 * Unreferenced uploads younger than this are kept: the client uploads first and
 * attaches the returned path with a separate draft update, and a stale autosave
 * may briefly drop a path that the next autosave restores.
 */
export const COMPOSE_DRAFT_UNREFERENCED_GRACE_MS = 2 * 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Absolute upload directory of one draft, or null for ids that could not form a safe path. */
export function composeDraftAttachmentDirectory(
  attachmentsRoot: string,
  workspaceId: string,
  draftMessageId: number,
): string | null {
  if (!attachmentsRoot.trim() || !UUID_RE.test(workspaceId)) return null;
  if (!Number.isSafeInteger(draftMessageId) || draftMessageId <= 0) return null;
  return path.join(path.resolve(attachmentsRoot), workspaceId, 'compose-drafts', String(draftMessageId));
}

/**
 * Resolve a stored attachment path to a file directly inside the draft's upload
 * directory. Anything else (other drafts, mail-sync files, traversal) is null.
 */
function draftLocalFilePath(
  attachmentsRoot: string,
  draftDirectory: string,
  storagePath: string,
): string | null {
  const trimmed = storagePath.trim();
  if (!trimmed) return null;
  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(path.resolve(attachmentsRoot), trimmed);
  return path.dirname(resolved) === draftDirectory ? resolved : null;
}

export type ComposeDraftAttachmentUsage = Readonly<{ files: number; bytes: number }>;

/**
 * Current usage of a draft's upload directory. Unreferenced files older than
 * the grace period (removed from the draft, or never attached after an aborted
 * upload) are deleted instead of being counted.
 */
export async function measureComposeDraftAttachmentUsage(input: {
  attachmentsRoot: string;
  workspaceId: string;
  draftMessageId: number;
  referencedPaths: readonly string[];
  now: Date;
}): Promise<ComposeDraftAttachmentUsage> {
  const directory = composeDraftAttachmentDirectory(input.attachmentsRoot, input.workspaceId, input.draftMessageId);
  if (!directory) return { files: 0, bytes: 0 };
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return { files: 0, bytes: 0 };
  }
  const referenced = new Set(
    input.referencedPaths
      .map((storagePath) => draftLocalFilePath(input.attachmentsRoot, directory, storagePath))
      .filter((value): value is string => value !== null),
  );
  let files = 0;
  let bytes = 0;
  for (const name of names) {
    const filePath = path.join(directory, name);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(filePath);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    if (!referenced.has(filePath) && input.now.getTime() - info.mtimeMs > COMPOSE_DRAFT_UNREFERENCED_GRACE_MS) {
      await rm(filePath, { force: true }).catch(() => undefined);
      continue;
    }
    files += 1;
    bytes += info.size;
  }
  return { files, bytes };
}

/**
 * Best-effort removal of attachments that were dropped from a draft. Only files
 * directly inside this draft's upload directory are touched, and uploads within
 * the grace period survive (see COMPOSE_DRAFT_UNREFERENCED_GRACE_MS).
 */
export async function removeComposeDraftAttachmentFiles(input: {
  attachmentsRoot: string;
  workspaceId: string;
  draftMessageId: number;
  storagePaths: readonly string[];
  now: Date;
}): Promise<void> {
  const directory = composeDraftAttachmentDirectory(input.attachmentsRoot, input.workspaceId, input.draftMessageId);
  if (!directory) return;
  for (const storagePath of input.storagePaths) {
    const filePath = draftLocalFilePath(input.attachmentsRoot, directory, storagePath);
    if (!filePath) continue;
    try {
      const info = await stat(filePath);
      if (!info.isFile() || input.now.getTime() - info.mtimeMs <= COMPOSE_DRAFT_UNREFERENCED_GRACE_MS) continue;
      await rm(filePath, { force: true });
    } catch {
      // Already gone or unreadable: nothing to clean up.
    }
  }
}

/** Best-effort removal of a sent or deleted draft's whole upload directory. */
export async function removeComposeDraftAttachmentDirectory(input: {
  attachmentsRoot: string;
  workspaceId: string;
  draftMessageId: number;
}): Promise<void> {
  const directory = composeDraftAttachmentDirectory(input.attachmentsRoot, input.workspaceId, input.draftMessageId);
  if (!directory) return;
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

/** Paths stored in email_messages.draft_attachment_paths_json (JSON text or jsonb). */
export function composeDraftAttachmentPathsFromStored(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const paths: string[] = [];
  for (const item of parsed) {
    const storagePath = typeof item === 'string'
      ? item.trim()
      : item && typeof item === 'object'
        ? String((item as { path?: unknown }).path ?? '').trim()
        : '';
    if (storagePath && !paths.includes(storagePath)) paths.push(storagePath);
  }
  return paths;
}
