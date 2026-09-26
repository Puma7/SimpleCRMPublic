import type Database from 'better-sqlite3';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';

/**
 * Teilautomatisierung P3 (Desktop): Herkunft eines Entwurfs und Kennzeichnung
 * „gesendet von“. Idempotent (Spalten nur anlegen, wenn sie fehlen) — läuft
 * bei jedem Start für Neuinstallationen und bestehende Datenbanken.
 */
const SENT_PROVENANCE_COLUMNS: ReadonlyArray<{ name: string; definition: string }> = [
  { name: 'draft_origin_kind', definition: 'TEXT' },
  { name: 'draft_origin_workflow_id', definition: 'INTEGER' },
  { name: 'draft_origin_edited', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'sent_by_kind', definition: 'TEXT' },
  { name: 'sent_by_user_id', definition: 'TEXT' },
  { name: 'sent_by_workflow_id', definition: 'INTEGER' },
  { name: 'sent_by_label', definition: 'TEXT' },
  { name: 'sent_outbound_review_skipped', definition: 'INTEGER NOT NULL DEFAULT 0' },
];

export function ensureSentProvenanceColumns(db: Database.Database): void {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(${EMAIL_MESSAGES_TABLE})`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const column of SENT_PROVENANCE_COLUMNS) {
    if (existing.has(column.name)) continue;
    console.log(`Adding ${column.name} to email_messages...`);
    db.exec(`ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN ${column.name} ${column.definition}`);
  }
  // Ansicht „Gesendet (KI)“: gesendete Mails automatischer Herkunft je Konto.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_email_messages_sent_by_kind
     ON ${EMAIL_MESSAGES_TABLE} (account_id, folder_kind, sent_by_kind)`,
  );
}
