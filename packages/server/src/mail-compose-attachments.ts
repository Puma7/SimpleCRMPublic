import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Kysely } from 'kysely';

import type { EmailComposeAttachmentUploadApiPort, EmailComposeAttachmentUploadResult } from './api';
import {
  composeDraftAttachmentPathsFromStored,
  MAX_COMPOSE_DRAFT_ATTACHMENT_FILES,
  MAX_COMPOSE_DRAFT_ATTACHMENT_TOTAL_BYTES,
  measureComposeDraftAttachmentUsage,
} from './compose-draft-attachment-files';
import { resolveAttachmentStoragePath } from './db';
import type { ServerDatabase } from './db/schema';
import { withWorkspaceTransaction } from './db/workspace-context';

const MAX_COMPOSE_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_COMPOSE_UPLOAD_BASE64_CHARS = Math.ceil((MAX_COMPOSE_UPLOAD_BYTES * 4) / 3) + 8;

// Serializes quota check + write per draft within this process, so parallel
// uploads cannot all pass the check before any of them has written its file.
const draftUploadQueues = new Map<string, Promise<void>>();

async function withDraftUploadQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = draftUploadQueues.get(key) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const tail = run.then(() => undefined, () => undefined);
  draftUploadQueues.set(key, tail);
  try {
    return await run;
  } finally {
    if (draftUploadQueues.get(key) === tail) draftUploadQueues.delete(key);
  }
}

export function createPostgresEmailComposeAttachmentUploadPort(options: {
  db: Kysely<ServerDatabase>;
  attachmentsRoot: string;
}): EmailComposeAttachmentUploadApiPort {
  return {
    async upload(input) {
      const filename = sanitizeAttachmentFilename(input.filename);
      if (!filename) {
        return { ok: false, reason: 'invalid_content', error: 'Dateiname ist ungueltig' };
      }

      const contentBase64 = input.contentBase64.trim();
      if (!isValidBase64(contentBase64) || contentBase64.length > MAX_COMPOSE_UPLOAD_BASE64_CHARS) {
        return { ok: false, reason: 'invalid_content', error: 'Anhang-Inhalt ist ungueltig oder zu gross' };
      }
      const content = Buffer.from(contentBase64, 'base64');
      if (content.length > MAX_COMPOSE_UPLOAD_BYTES) {
        return { ok: false, reason: 'invalid_content', error: 'Anhang ist groesser als 25 MB' };
      }

      const draftState = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .selectFrom('email_messages')
          .select(['id', 'uid', 'folder_kind', 'draft_attachment_paths_json'])
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', input.draftMessageId)
          .executeTakeFirst(),
      );
      if (!draftState) return { ok: false, reason: 'not_found', error: 'Entwurf nicht gefunden' };
      if (Number(draftState.uid) >= 0 || draftState.folder_kind !== 'draft') {
        return { ok: false, reason: 'not_local_draft', error: 'Anhaenge koennen nur lokalen Entwuerfen hinzugefuegt werden' };
      }

      return withDraftUploadQueue<EmailComposeAttachmentUploadResult>(`${input.workspaceId}:${input.draftMessageId}`, async () => {
        const usage = await measureComposeDraftAttachmentUsage({
          attachmentsRoot: options.attachmentsRoot,
          workspaceId: input.workspaceId,
          draftMessageId: input.draftMessageId,
          referencedPaths: composeDraftAttachmentPathsFromStored(draftState.draft_attachment_paths_json),
          now: new Date(),
        });
        if (usage.files + 1 > MAX_COMPOSE_DRAFT_ATTACHMENT_FILES) {
          return {
            ok: false,
            reason: 'quota_exceeded',
            error: `Ein Entwurf kann hoechstens ${MAX_COMPOSE_DRAFT_ATTACHMENT_FILES} Anhaenge haben`,
          };
        }
        if (usage.bytes + content.length > MAX_COMPOSE_DRAFT_ATTACHMENT_TOTAL_BYTES) {
          return {
            ok: false,
            reason: 'quota_exceeded',
            error: 'Anhaenge dieses Entwurfs waeren zusammen groesser als 50 MB',
          };
        }

        const storagePath = [
          input.workspaceId,
          'compose-drafts',
          String(input.draftMessageId),
          `${randomBytes(8).toString('hex')}-${filename}`,
        ].join('/');
        const resolvedPath = resolveAttachmentStoragePath(options.attachmentsRoot, storagePath);
        if (!resolvedPath) {
          return { ok: false, reason: 'write_failed', error: 'Anhangspeicherpfad ist ungueltig' };
        }

        try {
          await mkdir(path.dirname(resolvedPath), { recursive: true });
          await writeFile(resolvedPath, content, { flag: 'wx' });
        } catch (error) {
          return {
            ok: false,
            reason: 'write_failed',
            error: error instanceof Error ? error.message : String(error),
          };
        }

        return {
          ok: true,
          path: storagePath,
          filename,
          sizeBytes: content.length,
        };
      });
    },
  };
}

function sanitizeAttachmentFilename(input: string): string {
  const basename = path.basename(input).trim();
  if (!basename || basename === '.' || basename === '..') return '';
  const sanitized = basename
    .replace(/[\r\n\0]+/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+/, '')
    .slice(0, 180);
  return sanitized || 'attachment';
}

function isValidBase64(value: string): boolean {
  if (!value) return true;
  if (value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
