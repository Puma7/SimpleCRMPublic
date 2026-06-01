import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import archiver from 'archiver';
import yauzl from 'yauzl';
import { app, dialog, type OpenDialogReturnValue, type SaveDialogReturnValue } from 'electron';
import { MAIL_SCHEMA_GENERATION, MAIL_SCHEMA_GENERATION_LABEL } from '../db/mail-schema-version';
import { getAttachmentsRootForExport } from './email-message-attachments-store';

const MAX_BACKUP_ATTACH_BYTES = 8 * 1024 * 1024 * 1024;

function dirSizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(dir);
  return total;
}

/**
 * Full local backup: raw SQLite DB + attachment files (no Keytar secrets).
 * For restore procedure see docs/MAIL_BETA_PHASE3_PLAN.md (P3-1b).
 */
export async function exportLocalMailBackup(): Promise<
  { ok: true; path: string } | { ok: false; error: string }
> {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'database.sqlite');
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: 'Datenbankdatei nicht gefunden.' };
  }

  const dlg = (await dialog.showSaveDialog({
    title: 'Lokales Mail-Vollbackup',
    defaultPath: `simplecrm-mail-backup-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })) as unknown as SaveDialogReturnValue;
  if (dlg.canceled || !dlg.filePath) {
    return { ok: false, error: 'Abgebrochen' };
  }

  const attRoot = getAttachmentsRootForExport();
  const attBytes = dirSizeBytes(attRoot);
  if (attBytes > MAX_BACKUP_ATTACH_BYTES) {
    return {
      ok: false,
      error: `Anhänge zu groß (${Math.round(attBytes / (1024 * 1024))} MB). Archivieren oder alte Mails löschen.`,
    };
  }

  return new Promise((resolve) => {
    const out = createWriteStream(dlg.filePath!);
    const archive = archiver('zip', { zlib: { level: 6 } });

    const fail = (err: Error | string) => {
      try {
        archive.abort();
      } catch {
        /* ignore */
      }
      try {
        out.destroy();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, error: typeof err === 'string' ? err : err.message });
    };

    out.on('error', (e) => fail(e));
    archive.on('error', (e) => fail(e));
    out.on('close', () => resolve({ ok: true, path: dlg.filePath! }));

    archive.pipe(out);

    try {
      archive.file(dbPath, { name: 'database.sqlite' });
      if (fs.existsSync(attRoot)) {
        archive.directory(attRoot, 'email-attachments');
      }
      archive.append(
        JSON.stringify(
          {
            type: 'simplecrm-mail-local-backup',
            exportedAt: new Date().toISOString(),
            schemaGeneration: MAIL_SCHEMA_GENERATION,
            schemaGenerationLabel: MAIL_SCHEMA_GENERATION_LABEL,
            warnings: [
              'Enthält KEINE Passwörter, OAuth-Refresh-Tokens oder API-Keys (Keytar).',
              'Restore: App beenden, Dateien nach userData kopieren — siehe docs/MAIL_BETA_PHASE3_PLAN.md',
            ],
          },
          null,
          2,
        ),
        { name: 'manifest.json' },
      );
      void archive.finalize();
    } catch (e) {
      fail(e instanceof Error ? e : String(e));
    }
  });
}

type BackupManifest = {
  type?: string;
  exportedAt?: string;
  schemaGeneration?: number;
  schemaGenerationLabel?: string;
};

function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) reject(err ?? new Error('ZIP konnte nicht geöffnet werden.'));
      else resolve(zip);
    });
  });
}

function readZipEntryText(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error('Eintrag konnte nicht gelesen werden.'));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
  });
}

type ZipWalkState = {
  hasDatabase: boolean;
  hasAttachments: boolean;
  manifest: BackupManifest | null;
};

async function walkZipBackupEntries(zip: yauzl.ZipFile): Promise<ZipWalkState> {
  const walked: ZipWalkState = {
    hasDatabase: false,
    hasAttachments: false,
    manifest: null,
  };

  await new Promise<void>((resolve, reject) => {
    const nextEntry = () => {
      zip.readEntry();
    };

    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName.replace(/\\/g, '/');
      if (name === 'database.sqlite' || name.endsWith('/database.sqlite')) {
        walked.hasDatabase = true;
        nextEntry();
        return;
      }
      if (name.startsWith('email-attachments/') && !name.endsWith('/')) {
        walked.hasAttachments = true;
        nextEntry();
        return;
      }
      if (name === 'manifest.json') {
        void readZipEntryText(zip, entry)
          .then((raw) => {
            try {
              walked.manifest = JSON.parse(raw) as BackupManifest;
            } catch {
              walked.manifest = null;
            }
            nextEntry();
          })
          .catch(reject);
        return;
      }
      nextEntry();
    });
    zip.on('end', () => resolve());
    zip.on('error', reject);
    zip.readEntry();
  });

  return walked;
}

/** @internal Exported for unit tests. */
export async function inspectZipBackup(filePath: string): Promise<
  | {
      ok: true;
      manifest: BackupManifest;
      hasDatabase: boolean;
      hasAttachments: boolean;
    }
  | { ok: false; error: string }
> {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: 'Datei nicht gefunden.' };
  }
  let zip: yauzl.ZipFile | null = null;
  try {
    zip = await openZip(filePath);
    const walked = await walkZipBackupEntries(zip);

    if (!walked.hasDatabase) {
      return { ok: false, error: 'ZIP enthält keine database.sqlite.' };
    }
    if (!walked.manifest || walked.manifest.type !== 'simplecrm-mail-local-backup') {
      return {
        ok: false,
        error: 'manifest.json fehlt oder ist kein SimpleCRM-Mail-Backup.',
      };
    }
    return {
      ok: true,
      manifest: walked.manifest,
      hasDatabase: walked.hasDatabase,
      hasAttachments: walked.hasAttachments,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    zip?.close();
  }
}

/** Read-only integrity check for an exported mail backup ZIP. */
export async function verifyLocalMailBackup(): Promise<
  | {
      ok: true;
      path: string;
      schemaGeneration?: number;
      schemaGenerationLabel?: string;
      exportedAt?: string;
      hasDatabase: boolean;
      hasAttachments: boolean;
    }
  | { ok: false; error: string }
> {
  const dlg = (await dialog.showOpenDialog({
    title: 'Mail-Backup prüfen',
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
    properties: ['openFile'],
  })) as unknown as OpenDialogReturnValue;
  if (dlg.canceled || !dlg.filePaths?.[0]) {
    return { ok: false, error: 'Abgebrochen' };
  }
  const filePath = dlg.filePaths[0];
  const inspected = await inspectZipBackup(filePath);
  if (!inspected.ok) return inspected;
  return {
    ok: true,
    path: filePath,
    schemaGeneration: inspected.manifest.schemaGeneration,
    schemaGenerationLabel: inspected.manifest.schemaGenerationLabel,
    exportedAt: inspected.manifest.exportedAt,
    hasDatabase: inspected.hasDatabase,
    hasAttachments: inspected.hasAttachments,
  };
}
