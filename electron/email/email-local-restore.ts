import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { createWriteStream } from 'fs';
import yauzl from 'yauzl';
import { app, dialog, type OpenDialogReturnValue } from 'electron';
import Database from 'better-sqlite3';
import { MAIL_SCHEMA_GENERATION } from '../db/mail-schema-version';
import { inspectZipBackup } from './email-local-backup';
import { exportLocalMailBackupToPath } from './email-local-backup-export';
import {
  findDatabaseSqliteInTree,
  resolveSafePathUnderDirectory,
} from './email-zip-path-safety';
import { getAttachmentsRootForExport } from './email-message-attachments-store';
import {
  isEmailBackgroundSyncBusy,
  startEmailBackgroundServices,
  stopEmailBackgroundServices,
} from './email-imap-services';
import { closeDatabase, reopenDatabaseConnection } from '../sqlite-service';

const RESTORE_CONFIRM_PHRASE = 'WIEDERHERSTELLEN';
const RESTORE_ZIP_MAX_ENTRIES = 10_000;
const RESTORE_ZIP_MAX_ENTRY_BYTES = 2_000 * 1024 * 1024;
const RESTORE_ZIP_MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024;

export { resolveSafePathUnderDirectory } from './email-zip-path-safety';

export type RestoreZipValidationState = {
  entries: number;
  totalBytes: number;
};

export function validateRestoreZipEntry(
  rel: string,
  uncompressedSize: number,
  state: RestoreZipValidationState,
): void {
  state.entries += 1;
  if (state.entries > RESTORE_ZIP_MAX_ENTRIES) {
    throw new Error('ZIP enthält zu viele Einträge.');
  }
  if (uncompressedSize > RESTORE_ZIP_MAX_ENTRY_BYTES) {
    throw new Error('ZIP-Eintrag ist zu groß.');
  }
  state.totalBytes += uncompressedSize;
  if (state.totalBytes > RESTORE_ZIP_MAX_TOTAL_BYTES) {
    throw new Error('ZIP ist entpackt zu groß.');
  }
  resolveSafePathUnderDirectory('/', rel);
}

export function createRestoreZipEntryLimitStream(
  _rel: string,
  declaredUncompressedSize: number,
  state: RestoreZipValidationState,
): Transform {
  let actualBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      actualBytes += chunk.length;
      const undeclaredExtra = Math.max(0, actualBytes - declaredUncompressedSize);
      if (actualBytes > RESTORE_ZIP_MAX_ENTRY_BYTES) {
        callback(new Error('ZIP-Eintrag ist zu groß.'));
        return;
      }
      if (state.totalBytes + undeclaredExtra > RESTORE_ZIP_MAX_TOTAL_BYTES) {
        callback(new Error('ZIP ist entpackt zu groß.'));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      const undeclaredExtra = Math.max(0, actualBytes - declaredUncompressedSize);
      state.totalBytes += undeclaredExtra;
      callback();
    },
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

async function extractZipToDirectory(zipPath: string, destDir: string): Promise<void> {
  const zip = await openZip(zipPath);
  const validationState: RestoreZipValidationState = { entries: 0, totalBytes: 0 };
  try {
    await new Promise<void>((resolve, reject) => {
      const next = () => zip.readEntry();
      zip.on('entry', (entry) => {
        const rel = entry.fileName.replace(/\\/g, '/');
        let outPath: string;
        try {
          validateRestoreZipEntry(rel, entry.uncompressedSize, validationState);
          outPath = resolveSafePathUnderDirectory(destDir, rel);
        } catch (e) {
          reject(e);
          return;
        }
        if (rel.endsWith('/')) {
          fs.mkdirSync(outPath, { recursive: true });
          next();
          return;
        }
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        zip.openReadStream(entry, (err, readStream) => {
          if (err || !readStream) {
            reject(err ?? new Error(`Eintrag ${rel} konnte nicht gelesen werden.`));
            return;
          }
          const limitStream = createRestoreZipEntryLimitStream(
            rel,
            entry.uncompressedSize,
            validationState,
          );
          const writeStream = createWriteStream(outPath);
          void pipeline(readStream, limitStream, writeStream)
            .then(() => next())
            .catch(reject);
        });
      });
      zip.on('end', () => resolve());
      zip.on('error', reject);
      next();
    });
  } finally {
    zip.close();
  }
}

function previewTokenFor(zipPath: string, manifest: BackupManifest): string {
  const st = fs.statSync(zipPath);
  return crypto
    .createHash('sha256')
    .update(`${zipPath}|${st.mtimeMs}|${manifest.exportedAt ?? ''}|${manifest.schemaGeneration ?? ''}`)
    .digest('hex')
    .slice(0, 24);
}

function readAccountsFromBackupDb(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare('SELECT email_address FROM email_accounts ORDER BY id ASC')
      .all() as { email_address: string }[];
    return rows.map((r) => r.email_address).filter(Boolean);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function pickLocalMailBackupZip(): Promise<
  { ok: true; path: string } | { ok: false; error: string }
> {
  const dlg = (await dialog.showOpenDialog({
    title: 'Mail-Backup auswählen',
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
    properties: ['openFile'],
  })) as unknown as OpenDialogReturnValue;
  if (dlg.canceled || !dlg.filePaths?.[0]) {
    return { ok: false, error: 'Abgebrochen' };
  }
  return { ok: true, path: dlg.filePaths[0] };
}

export async function previewRestoreLocalMailBackup(zipPath: string): Promise<
  | {
      ok: true;
      path: string;
      previewToken: string;
      schemaGeneration?: number;
      schemaGenerationLabel?: string;
      currentSchemaGeneration: number;
      exportedAt?: string;
      hasAttachments: boolean;
      accountEmails: string[];
      warnings: string[];
    }
  | { ok: false; error: string }
> {
  const inspected = await inspectZipBackup(zipPath);
  if (!inspected.ok) return inspected;

  let tmpDir: string | null = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'crm-restore-preview-'));
    await extractZipToDirectory(zipPath, tmpDir);
    const previewDbPath = findDatabaseSqliteInTree(tmpDir);
    if (!previewDbPath) {
      return { ok: false, error: 'ZIP enthält keine database.sqlite.' };
    }
    const accountEmails = readAccountsFromBackupDb(previewDbPath);
    const warnings: string[] = [
      'Ersetzt die lokale Datenbank und Anhänge (gesamte SimpleCRM-Daten, nicht nur Mail).',
      'Passwörter und API-Keys (Keytar) sind nicht im Backup — nach Restore ggf. neu eintragen.',
    ];
    if (
      inspected.manifest.schemaGeneration != null &&
      inspected.manifest.schemaGeneration !== MAIL_SCHEMA_GENERATION
    ) {
      warnings.push(
        `Schema-Generation im Backup (${inspected.manifest.schemaGeneration}) weicht von der aktuellen App (${MAIL_SCHEMA_GENERATION}) ab — Migration beim Start.`,
      );
    }
    if (isEmailBackgroundSyncBusy()) {
      warnings.push('Hintergrund-Sync läuft gerade — vor Restore erneut prüfen.');
    }

    return {
      ok: true,
      path: zipPath,
      previewToken: previewTokenFor(zipPath, inspected.manifest),
      schemaGeneration: inspected.manifest.schemaGeneration,
      schemaGenerationLabel: inspected.manifest.schemaGenerationLabel,
      currentSchemaGeneration: MAIL_SCHEMA_GENERATION,
      exportedAt: inspected.manifest.exportedAt,
      hasAttachments: inspected.hasAttachments,
      accountEmails,
      warnings,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

function renameForBackup(targetPath: string, suffix: string): string | null {
  const stamped = `${targetPath}.pre-restore-${suffix}`;
  if (fs.existsSync(stamped)) {
    fs.rmSync(stamped, { recursive: true, force: true });
  }
  if (!fs.existsSync(targetPath)) {
    return null;
  }
  fs.renameSync(targetPath, stamped);
  return stamped;
}

function rollbackRenamedBackup(targetPath: string, backupPath: string | null): void {
  if (!backupPath || !fs.existsSync(backupPath)) return;
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
  fs.renameSync(backupPath, targetPath);
}

export { findDatabaseSqliteInTree } from './email-zip-path-safety';

async function restoreFailureRecovery(
  servicesStopped: boolean,
  databaseClosed: boolean,
  logger: Pick<typeof console, 'warn' | 'error' | 'debug'>,
): Promise<void> {
  if (databaseClosed) {
    try {
      reopenDatabaseConnection();
    } catch (reopenErr) {
      logger.error('[restore] reopenDatabaseConnection failed', reopenErr);
    }
  }
  if (servicesStopped) {
    try {
      await startEmailBackgroundServices(logger);
    } catch (restartErr) {
      logger.error('[restore] startEmailBackgroundServices failed', restartErr);
    }
  }
}

function findExtractedAttachmentsDir(extractDir: string): string | null {
  const direct = path.join(extractDir, 'email-attachments');
  if (fs.existsSync(direct)) return direct;
  const stack = [extractDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory() && ent.name === 'email-attachments') {
        return full;
      }
      if (ent.isDirectory()) stack.push(full);
    }
  }
  return null;
}

export async function restoreLocalMailBackup(input: {
  zipPath: string;
  previewToken: string;
  confirmPhrase: string;
  createPreBackup: boolean;
}): Promise<{ ok: true; preBackupPath?: string } | { ok: false; error: string }> {
  if (input.confirmPhrase.trim() !== RESTORE_CONFIRM_PHRASE) {
    return {
      ok: false,
      error: `Bestätigung muss exakt „${RESTORE_CONFIRM_PHRASE}“ lauten.`,
    };
  }

  const inspected = await inspectZipBackup(input.zipPath);
  if (!inspected.ok) return inspected;

  const token = previewTokenFor(input.zipPath, inspected.manifest);
  if (token !== input.previewToken) {
    return { ok: false, error: 'Vorschau ist veraltet — bitte erneut prüfen.' };
  }

  if (isEmailBackgroundSyncBusy()) {
    return {
      ok: false,
      error: 'Sync läuft noch. Bitte einen Moment warten und erneut versuchen.',
    };
  }

  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'database.sqlite');
  const attRoot = getAttachmentsRootForExport();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  let preBackupPath: string | undefined;
  let servicesStopped = false;
  let databaseClosed = false;
  const recoveryLogger = console;

  try {
    if (input.createPreBackup) {
      const preDir = path.join(userData, 'pre-restore-backups');
      fs.mkdirSync(preDir, { recursive: true });
      preBackupPath = path.join(preDir, `auto-${stamp}.zip`);
      const pre = await exportLocalMailBackupToPath(preBackupPath);
      if (!pre.ok) {
        return { ok: false, error: pre.error ?? 'Sicherheits-Backup fehlgeschlagen.' };
      }
    }

    const extractDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'crm-restore-extract-'));
    try {
      await extractZipToDirectory(input.zipPath, extractDir);
      const extractedDb = findDatabaseSqliteInTree(extractDir);
      if (!extractedDb) {
        return { ok: false, error: 'Entpacktes Backup enthält keine database.sqlite.' };
      }
      const extractedAtt = findExtractedAttachmentsDir(extractDir);

      stopEmailBackgroundServices();
      servicesStopped = true;
      try {
        closeDatabase();
        databaseClosed = true;
      } catch (closeErr) {
        await restoreFailureRecovery(servicesStopped, false, console);
        throw closeErr;
      }

      const dbBackupPath = renameForBackup(dbPath, stamp);
      const attBackupPath = renameForBackup(attRoot, stamp);
      try {
        fs.copyFileSync(extractedDb, dbPath);
        if (extractedAtt) {
          fs.cpSync(extractedAtt, attRoot, { recursive: true });
        } else if (attBackupPath && fs.existsSync(attRoot)) {
          fs.rmSync(attRoot, { recursive: true, force: true });
        }
      } catch (copyErr) {
        rollbackRenamedBackup(dbPath, dbBackupPath);
        rollbackRenamedBackup(attRoot, attBackupPath);
        throw copyErr;
      }
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }

    app.relaunch();
    app.exit(0);
    return { ok: true, preBackupPath };
  } catch (e) {
    await restoreFailureRecovery(servicesStopped, databaseClosed, recoveryLogger);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export { RESTORE_CONFIRM_PHRASE };
