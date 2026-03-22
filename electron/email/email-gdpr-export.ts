import fs from 'fs';
import { createWriteStream } from 'fs';
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

export async function exportEmailGdprPackage(): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
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
    out.on('close', () => resolve({ ok: true, path: filePath }));
    archive.on('error', (err) => resolve({ ok: false, error: err.message }));
    archive.pipe(out);

    const db = getDb();
    const redactedAccounts = db
      .prepare(
        `SELECT id, display_name, email_address, imap_host, imap_port, protocol,
                smtp_host, smtp_port, oauth_provider, created_at
         FROM ${EMAIL_ACCOUNTS_TABLE}`,
      )
      .all();
    archive.append(JSON.stringify(redactedAccounts, null, 2), { name: 'accounts_redacted.json' });

    const messages = db
      .prepare(
        `SELECT id, account_id, subject, snippet, date_received, ticket_code, customer_id, assigned_to,
                folder_kind, archived, seen_local, has_attachments, thread_id, imap_thread_id, created_at
         FROM ${EMAIL_MESSAGES_TABLE}`,
      )
      .all();
    archive.append(JSON.stringify(messages, null, 2), { name: 'messages_index.json' });

    const notes = db.prepare(`SELECT * FROM ${EMAIL_INTERNAL_NOTES_TABLE}`).all();
    archive.append(JSON.stringify(notes, null, 2), { name: 'internal_notes.json' });

    const workflows = db.prepare(`SELECT id, name, trigger, enabled, priority, cron_expr, schedule_account_id, created_at FROM ${EMAIL_WORKFLOWS_TABLE}`).all();
    archive.append(JSON.stringify(workflows, null, 2), { name: 'workflows_meta.json' });

    const runs = db
      .prepare(`SELECT id, workflow_id, message_id, direction, status, started_at, finished_at FROM ${EMAIL_WORKFLOW_RUNS_TABLE} LIMIT 5000`)
      .all();
    archive.append(JSON.stringify(runs, null, 2), { name: 'workflow_runs_sample.json' });

    const attRoot = getAttachmentsRootForExport();
    if (fs.existsSync(attRoot)) {
      archive.directory(attRoot, 'attachments');
    }

    archive.append(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          note: 'Keine Passwörter/Keytar-Inhalte. Nachrichtentexte nur als Metadaten in messages_index; Rohmail nicht enthalten.',
        },
        null,
        2,
      ),
      { name: 'README_EXPORT.txt' },
    );

    void archive.finalize();
  });
}
