import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Kysely } from 'kysely';

import {
  isStrictBase64Payload,
  sanitizeAttachmentFilename as sanitizeUnicodeAttachmentFilename,
} from '@simplecrm/core';

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

type ComposeAttachmentPortOptions = {
  db: Kysely<ServerDatabase>;
  attachmentsRoot: string;
};

type LocalDraftState = { draft_attachment_paths_json: unknown };

export function createPostgresEmailComposeAttachmentUploadPort(
  options: ComposeAttachmentPortOptions,
): EmailComposeAttachmentUploadApiPort {
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

      const draft = await loadLocalDraft(options, input.workspaceId, input.draftMessageId);
      if (!draft.ok) return draft.result;

      return storeDraftAttachment(options, {
        workspaceId: input.workspaceId,
        draftMessageId: input.draftMessageId,
        draft: draft.state,
        filename,
        sizeBytes: content.length,
        write: (resolvedPath) => writeFile(resolvedPath, content, { flag: 'wx' }),
      });
    },

    // Forwarding: the client never sees storage paths, so it names the stored
    // attachment by id and the server copies it into this draft's uploads. The
    // HTTP policy layer authorizes the source attachment like a download.
    async copyStoredAttachment(input) {
      const draft = await loadLocalDraft(options, input.workspaceId, input.draftMessageId);
      if (!draft.ok) return draft.result;

      const source = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .selectFrom('email_message_attachments')
          .select(['id', 'filename_display', 'storage_path'])
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', input.sourceAttachmentId)
          .executeTakeFirst(),
      );
      const sourcePath = source
        ? resolveAttachmentStoragePath(options.attachmentsRoot, source.storage_path)
        : null;
      if (!source || !sourcePath) {
        return { ok: false, reason: 'source_not_found', error: 'Anhang nicht gefunden' };
      }
      let sizeBytes: number;
      try {
        const info = await stat(sourcePath);
        if (!info.isFile()) throw new Error('not a file');
        sizeBytes = info.size;
      } catch {
        return { ok: false, reason: 'source_not_found', error: 'Anhang-Datei nicht gefunden' };
      }
      if (sizeBytes > MAX_COMPOSE_UPLOAD_BYTES) {
        return { ok: false, reason: 'invalid_content', error: 'Anhang ist groesser als 25 MB' };
      }

      return storeDraftAttachment(options, {
        workspaceId: input.workspaceId,
        draftMessageId: input.draftMessageId,
        draft: draft.state,
        filename: sanitizeAttachmentFilename(source.filename_display) || 'attachment',
        sizeBytes,
        write: (resolvedPath) => copyFile(sourcePath, resolvedPath, fsConstants.COPYFILE_EXCL),
      });
    },
  };
}

async function loadLocalDraft(
  options: ComposeAttachmentPortOptions,
  workspaceId: string,
  draftMessageId: number,
): Promise<{ ok: true; state: LocalDraftState } | { ok: false; result: EmailComposeAttachmentUploadResult }> {
  const draftState = await withWorkspaceTransaction(
    options.db,
    { workspaceId, role: 'system' },
    async (trx) => trx
      .selectFrom('email_messages')
      .select(['id', 'uid', 'folder_kind', 'draft_attachment_paths_json'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', draftMessageId)
      .executeTakeFirst(),
  );
  if (!draftState) return { ok: false, result: { ok: false, reason: 'not_found', error: 'Entwurf nicht gefunden' } };
  if (Number(draftState.uid) >= 0 || draftState.folder_kind !== 'draft') {
    return {
      ok: false,
      result: { ok: false, reason: 'not_local_draft', error: 'Anhaenge koennen nur lokalen Entwuerfen hinzugefuegt werden' },
    };
  }
  return { ok: true, state: draftState };
}

async function storeDraftAttachment(
  options: ComposeAttachmentPortOptions,
  input: {
    workspaceId: string;
    draftMessageId: number;
    draft: LocalDraftState;
    filename: string;
    sizeBytes: number;
    write: (resolvedPath: string) => Promise<void>;
  },
): Promise<EmailComposeAttachmentUploadResult> {
  return withDraftUploadQueue<EmailComposeAttachmentUploadResult>(`${input.workspaceId}:${input.draftMessageId}`, async () => {
    const usage = await measureComposeDraftAttachmentUsage({
      attachmentsRoot: options.attachmentsRoot,
      workspaceId: input.workspaceId,
      draftMessageId: input.draftMessageId,
      referencedPaths: composeDraftAttachmentPathsFromStored(input.draft.draft_attachment_paths_json),
      now: new Date(),
    });
    if (usage.files + 1 > MAX_COMPOSE_DRAFT_ATTACHMENT_FILES) {
      return {
        ok: false,
        reason: 'quota_exceeded',
        error: `Ein Entwurf kann hoechstens ${MAX_COMPOSE_DRAFT_ATTACHMENT_FILES} Anhaenge haben`,
      };
    }
    if (usage.bytes + input.sizeBytes > MAX_COMPOSE_DRAFT_ATTACHMENT_TOTAL_BYTES) {
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
      `${randomBytes(8).toString('hex')}-${input.filename}`,
    ].join('/');
    const resolvedPath = resolveAttachmentStoragePath(options.attachmentsRoot, storagePath);
    if (!resolvedPath) {
      return { ok: false, reason: 'write_failed', error: 'Anhangspeicherpfad ist ungueltig' };
    }

    try {
      await mkdir(path.dirname(resolvedPath), { recursive: true });
      await input.write(resolvedPath);
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
      filename: input.filename,
      sizeBytes: input.sizeBytes,
    };
  });
}

function sanitizeAttachmentFilename(input: string): string {
  const basename = path.basename(input).trim();
  if (!basename || basename === '.' || basename === '..') return '';
  return sanitizeUnicodeAttachmentFilename(basename);
}

function isValidBase64(value: string): boolean {
  if (!value) return true;
  if (value.length % 4 !== 0) return false;
  return isStrictBase64Payload(value);
}
