import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { posix } from 'node:path';

import type {
  SqliteMigrationReadRowsInput,
  SqliteMigrationRow,
  SqliteMigrationSourcePort,
} from './types';

export type AttachmentCopyingSqliteSourceOptions = Readonly<{
  source: SqliteMigrationSourcePort;
  workspaceId: string;
  sourceAttachmentsRoot: string;
  targetAttachmentsRoot: string;
  copyFile?: (sourcePath: string, targetPath: string) => Promise<void>;
  mkdir?: (path: string) => Promise<void>;
}>;

export type AttachmentCopyResult = Readonly<{
  sourcePath: string;
  targetPath: string;
  storagePath: string;
}>;

export function createAttachmentCopyingSqliteSource(
  options: AttachmentCopyingSqliteSourceOptions,
): SqliteMigrationSourcePort {
  const copyAttachmentFile = options.copyFile ?? copyFile;
  const makeDirectory = options.mkdir ?? ((path) => mkdir(path, { recursive: true }).then(() => undefined));
  return {
    tableExists(tableName) {
      return options.source.tableExists(tableName);
    },
    countRows(tableName) {
      return options.source.countRows(tableName);
    },
    async readRows(input) {
      const rows = await options.source.readRows(input);
      if (input.tableName !== 'email_message_attachments') return rows;
      const copiedRows: SqliteMigrationRow[] = [];
      for (const row of rows) {
        const copied = await copyAttachmentRow({
          row,
          input,
          workspaceId: options.workspaceId,
          sourceAttachmentsRoot: options.sourceAttachmentsRoot,
          targetAttachmentsRoot: options.targetAttachmentsRoot,
          copyAttachmentFile,
          makeDirectory,
        });
        copiedRows.push(copied);
      }
      return copiedRows;
    },
  };
}

export function resolveSourceAttachmentPath(sourceAttachmentsRoot: string, storagePath: string): string | null {
  const root = resolve(sourceAttachmentsRoot);
  const candidate = isAbsolute(storagePath)
    ? resolve(storagePath)
    : resolve(root, storagePath);
  const fromRoot = relative(root, candidate);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    return null;
  }
  return candidate;
}

export function buildServerAttachmentStoragePath(input: {
  workspaceId: string;
  messageId: unknown;
  sourcePk: unknown;
  filename: unknown;
}): string {
  return posix.join(
    safePathSegment(input.workspaceId, 'workspace'),
    'email-attachments',
    safePathSegment(input.messageId, 'message'),
    `${safePathSegment(input.sourcePk, 'attachment')}-${safeFilename(input.filename)}`,
  );
}

async function copyAttachmentRow(input: {
  row: SqliteMigrationRow;
  input: SqliteMigrationReadRowsInput;
  workspaceId: string;
  sourceAttachmentsRoot: string;
  targetAttachmentsRoot: string;
  copyAttachmentFile(sourcePath: string, targetPath: string): Promise<void>;
  makeDirectory(path: string): Promise<void>;
}): Promise<SqliteMigrationRow> {
  const rawStoragePath = input.row.storage_path;
  if (typeof rawStoragePath !== 'string' || rawStoragePath.trim() === '') {
    throw new Error('SQLite attachment row is missing storage_path');
  }
  const sourcePath = resolveSourceAttachmentPath(input.sourceAttachmentsRoot, rawStoragePath);
  if (!sourcePath) {
    throw new Error(`SQLite attachment storage_path is outside source attachment root: ${rawStoragePath}`);
  }
  const storagePath = buildServerAttachmentStoragePath({
    workspaceId: input.workspaceId,
    messageId: input.row.message_id,
    sourcePk: input.row[input.input.primaryKey],
    filename: input.row.filename_display,
  });
  const targetPath = resolve(input.targetAttachmentsRoot, storagePath);
  await input.makeDirectory(dirname(targetPath));
  await input.copyAttachmentFile(sourcePath, targetPath);
  return {
    ...input.row,
    storage_path: storagePath,
  };
}

function safePathSegment(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return normalized || fallback;
}

function safeFilename(value: unknown): string {
  const normalized = String(value ?? '').trim().replace(/[^a-zA-Z0-9._\-+ ]/g, '_').slice(0, 180);
  return normalized || 'attachment';
}
