import fs from 'fs';
import { createWriteStream } from 'fs';
import { PassThrough } from 'stream';
import archiver from 'archiver';
import { dialog, type SaveDialogReturnValue } from 'electron';
import { getDb } from '../sqlite-service';
import {
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_MESSAGES_TABLE,
  EMAIL_INTERNAL_NOTES_TABLE,
  EMAIL_WORKFLOWS_TABLE,
  EMAIL_WORKFLOW_RUNS_TABLE,
} from '../database-schema';
import { getAttachmentsRootForExport } from './email-message-attachments-store';

const MESSAGE_BATCH = 2000;
const NOTES_BATCH = 5000;
const RUNS_LIMIT = 5000;
const MAX_EXPORT_ATTACH_BYTES = 4 * 1024 * 1024 * 1024;

function dirSizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${ent.name}`;
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

export async function exportEmailGdprPackage(
  options: { skipAttachments?: boolean } = {},
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const dlg = (await dialog.showSaveDialog({
    title: 'E-Mail-Datenexport (DSGVO)',
    defaultPath: `simplecrm-email-export-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })) as unknown as SaveDialogReturnValue;
  const canceled = dlg.canceled;
  const filePath = dlg.filePath;
  if (canceled || !filePath) {
    return { ok: false, error: 'Abgebrochen' };
  }

  return new Promise((resolve) => {
    const out = createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

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
    out.on('close', () => resolve({ ok: true, path: filePath }));

    archive.pipe(out);

    try {
      const db = getDb();

      const redactedAccounts = db
        .prepare(
          `SELECT id, display_name, email_address, imap_host, imap_port, protocol,
                  smtp_host, smtp_port, oauth_provider, created_at
           FROM ${EMAIL_ACCOUNTS_TABLE}`,
        )
        .all();
      archive.append(JSON.stringify(redactedAccounts, null, 2), { name: 'accounts_redacted.json' });

      const messagesStream = new PassThrough();
      archive.append(messagesStream, { name: 'messages_index.jsonl' });
      let offset = 0;
      for (;;) {
        const batch = db
          .prepare(
            `SELECT id, account_id, subject, snippet, date_received, ticket_code, customer_id, assigned_to,
                    folder_kind, archived, seen_local, has_attachments, thread_id, imap_thread_id, created_at
             FROM ${EMAIL_MESSAGES_TABLE}
             ORDER BY id ASC
             LIMIT ? OFFSET ?`,
          )
          .all(MESSAGE_BATCH, offset) as Record<string, unknown>[];
        if (batch.length === 0) break;
        for (const row of batch) {
          messagesStream.write(`${JSON.stringify(row)}\n`);
        }
        offset += batch.length;
        if (batch.length < MESSAGE_BATCH) break;
      }
      messagesStream.end();

      const notesStream = new PassThrough();
      archive.append(notesStream, { name: 'internal_notes.jsonl' });
      let noteOffset = 0;
      for (;;) {
        const batch = db
          .prepare(`SELECT * FROM ${EMAIL_INTERNAL_NOTES_TABLE} ORDER BY id ASC LIMIT ? OFFSET ?`)
          .all(NOTES_BATCH, noteOffset) as Record<string, unknown>[];
        if (batch.length === 0) break;
        for (const row of batch) {
          notesStream.write(`${JSON.stringify(row)}\n`);
        }
        noteOffset += batch.length;
        if (batch.length < NOTES_BATCH) break;
      }
      notesStream.end();

      const workflows = db
        .prepare(
          `SELECT id, name, trigger, enabled, priority, cron_expr, schedule_account_id, created_at FROM ${EMAIL_WORKFLOWS_TABLE}`,
        )
        .all();
      archive.append(JSON.stringify(workflows, null, 2), { name: 'workflows_meta.json' });

      const runs = db
        .prepare(
          `SELECT id, workflow_id, message_id, direction, status, started_at, finished_at FROM ${EMAIL_WORKFLOW_RUNS_TABLE} LIMIT ?`,
        )
        .all(RUNS_LIMIT);
      archive.append(JSON.stringify(runs, null, 2), { name: 'workflow_runs_sample.json' });

      if (!options.skipAttachments) {
        const attRoot = getAttachmentsRootForExport();
        fs.mkdirSync(attRoot, { recursive: true });
        const attBytes = dirSizeBytes(attRoot);
        if (attBytes > MAX_EXPORT_ATTACH_BYTES) {
          fail(
            `Anhänge zu groß für einen Export (${Math.round(attBytes / (1024 * 1024))} MB). Nutzen Sie „Export ohne Anhänge“ oder verkleinern Sie den Ordner userData/email-attachments.`,
          );
          return;
        }
        try {
          archive.directory(attRoot, 'attachments');
        } catch (e) {
          fail(e instanceof Error ? e : String(e));
          return;
        }
      }

      archive.append(
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            note: options.skipAttachments
              ? 'Keine Passwörter/Keytar. Anhänge-Ordner in diesem Export ausgelassen (skipAttachments).'
              : 'Keine Passwörter/Keytar-Inhalte. Nachrichten als JSONL (messages_index.jsonl). Rohmail nicht enthalten.',
          },
          null,
          2,
        ),
        { name: 'README_EXPORT.txt' },
      );

      void archive.finalize();
    } catch (e) {
      fail(e instanceof Error ? e : String(e));
    }
  });
}
