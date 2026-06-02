import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import archiver from 'archiver';
import Database from 'better-sqlite3';
import { app } from 'electron';
import { redactOneTimeSetupTokenInDatabase } from '../auth/setup-token';
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

/** Write backup ZIP to a fixed path (no dialog). Used for pre-restore safety copies. */
export async function exportLocalMailBackupToPath(
  filePath: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'database.sqlite');
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: 'Datenbankdatei nicht gefunden.' };
  }

  const attRoot = getAttachmentsRootForExport();
  const attBytes = dirSizeBytes(attRoot);
  if (attBytes > MAX_BACKUP_ATTACH_BYTES) {
    return {
      ok: false,
      error: `Anhänge zu groß (${Math.round(attBytes / (1024 * 1024))} MB).`,
    };
  }

  return new Promise((resolve) => {
    const out = createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    const tempDbPath = path.join(os.tmpdir(), `simplecrm-mail-backup-${randomUUID()}.sqlite`);

    const fail = (err: Error | string) => {
      try {
        fs.unlinkSync(tempDbPath);
      } catch {
        /* ignore */
      }
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
    out.on('close', () => {
      try {
        fs.unlinkSync(tempDbPath);
      } catch {
        /* ignore */
      }
      resolve({ ok: true, path: filePath });
    });

    archive.pipe(out);

    try {
      fs.copyFileSync(dbPath, tempDbPath);
      const copyDb = new Database(tempDbPath);
      redactOneTimeSetupTokenInDatabase(copyDb);
      copyDb.close();
      archive.file(tempDbPath, { name: 'database.sqlite' });
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
              'Einmal-Setup-Token wird aus der Datenbank-Kopie entfernt.',
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
