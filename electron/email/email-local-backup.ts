import fs from 'fs';
import path from 'path';
import yauzl from 'yauzl';
import { app, dialog, type OpenDialogReturnValue, type SaveDialogReturnValue } from 'electron';
import { exportLocalMailBackupToPath } from './email-local-backup-export';
import { RESTORE_ZIP_MAX_ENTRIES } from './email-local-backup-limits';

/** The export writes a manifest of a few hundred bytes. */
const BACKUP_MANIFEST_MAX_BYTES = 64 * 1024;

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

/** @internal Exported for tests. */
export function readZipEntryText(zip: yauzl.ZipFile, entry: yauzl.Entry, maxBytes: number): Promise<string> {
  // Checked before inflating and again while reading: a few KB of ZIP can
  // declare and deliver hundreds of MB (C-A8).
  const tooLarge = () => new Error(`${entry.fileName} ist zu groß.`);
  if (entry.uncompressedSize > maxBytes) return Promise.reject(tooLarge());
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error('Eintrag konnte nicht gelesen werden.'));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      stream.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > maxBytes) {
          stream.destroy();
          reject(tooLarge());
          return;
        }
        chunks.push(c);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
  });
}

/** @internal Exported for restore preview and tests. */
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
    if (zip.entryCount > RESTORE_ZIP_MAX_ENTRIES) {
      return { ok: false, error: 'ZIP enthält zu viele Einträge.' };
    }
    let hasDatabase = false;
    let hasAttachments = false;
    let manifest: BackupManifest | null = null;
    let manifestSeen = false;

    await new Promise<void>((resolve, reject) => {
      const nextEntry = () => {
        zip!.readEntry();
      };

      zip!.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName.replace(/\\/g, '/');
        if (name === 'database.sqlite' || name.endsWith('/database.sqlite')) {
          hasDatabase = true;
          nextEntry();
          return;
        }
        if (name.startsWith('email-attachments/') && !name.endsWith('/')) {
          hasAttachments = true;
          nextEntry();
          return;
        }
        if (name === 'manifest.json') {
          if (manifestSeen) {
            reject(new Error('ZIP enthält mehr als eine manifest.json.'));
            return;
          }
          manifestSeen = true;
          void readZipEntryText(zip!, entry, BACKUP_MANIFEST_MAX_BYTES)
            .then((raw) => {
              try {
                manifest = JSON.parse(raw) as BackupManifest;
              } catch {
                manifest = null;
              }
              nextEntry();
            })
            .catch(reject);
          return;
        }
        nextEntry();
      });
      zip!.on('end', () => resolve());
      zip!.on('error', reject);
      zip!.readEntry();
    });

    if (!hasDatabase) {
      return { ok: false, error: 'ZIP enthält keine database.sqlite.' };
    }
    const manifestOk = manifest as BackupManifest | null;
    if (!manifestOk || manifestOk.type !== 'simplecrm-mail-local-backup') {
      return {
        ok: false,
        error: 'manifest.json fehlt oder ist kein SimpleCRM-Mail-Backup.',
      };
    }
    return { ok: true, manifest: manifestOk, hasDatabase, hasAttachments };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    zip?.close();
  }
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

  return exportLocalMailBackupToPath(dlg.filePath);
}

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
