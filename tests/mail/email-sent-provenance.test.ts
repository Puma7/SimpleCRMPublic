/**
 * Kennzeichnung „gesendet von“ (Teilautomatisierung P3, Desktop): Herkunft
 * eines Entwurfs, Änderung durch einen Menschen und die Bestimmung beim
 * Versand. Echte In-Memory-DB mit dem echten Schema.
 */
import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.pragma('foreign_keys = OFF');

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  getSyncInfo: (key: string) =>
    (db.prepare('SELECT value FROM sync_info WHERE key = ?').get(key) as { value: string } | undefined)
      ?.value ?? null,
  setSyncInfo: (key: string, value: string) => {
    db.prepare(
      `INSERT INTO sync_info (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  },
}));

import { createEmailMessagesTable, createSyncInfoTable } from '../../electron/database-schema';
import { ensureSentProvenanceColumns } from '../../electron/email/email-sent-provenance-schema';
import {
  markDraftOrigin,
  markDraftOriginEdited,
  markDraftOriginEditedIfChanged,
  readDraftOriginContent,
  recordSentProvenance,
} from '../../electron/email/email-sent-provenance';

beforeAll(() => {
  db.exec(createEmailMessagesTable);
  db.exec(createSyncInfoTable);
  ensureSentProvenanceColumns(db);
  // Idempotent: zweiter Lauf (App-Neustart) ändert nichts.
  ensureSentProvenanceColumns(db);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT);
    CREATE TABLE email_workflows (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO users (id, display_name) VALUES ('u1', 'Anna Beispiel');
    INSERT INTO email_workflows (id, name) VALUES (7, 'KI-Antwort'), (8, 'Rechnungen weiterleiten');
  `);
});

beforeEach(() => {
  db.exec('DELETE FROM email_messages');
  db.exec('DELETE FROM sync_info');
});

function insertDraft(id: number): void {
  db.prepare(
    `INSERT INTO email_messages (id, account_id, folder_id, uid, subject, folder_kind, date_received)
     VALUES (?, 1, 10, ?, 'Re: Frage', 'draft', '2026-09-26T07:00:00Z')`,
  ).run(id, -id);
}

function sentColumns(id: number) {
  return db.prepare(
    `SELECT sent_by_kind, sent_by_user_id, sent_by_workflow_id, sent_by_label, sent_outbound_review_skipped
     FROM email_messages WHERE id = ?`,
  ).get(id);
}

describe('Desktop: Kennzeichnung „gesendet von“', () => {
  test('KI-Entwurf automatisch gesendet ⇒ ai_auto mit Workflow-Namen', () => {
    insertDraft(71);
    markDraftOrigin(71, 'ai', 7);
    // send_draft überschreibt die KI-Herkunft nicht.
    markDraftOrigin(71, 'workflow', 8, { onlyIfUnset: true });

    const provenance = recordSentProvenance(71, { kind: 'workflow' });

    expect(provenance?.kind).toBe('ai_auto');
    expect(sentColumns(71)).toEqual({
      sent_by_kind: 'ai_auto',
      sent_by_user_id: null,
      sent_by_workflow_id: 7,
      sent_by_label: 'Workflow „KI-Antwort“',
      sent_outbound_review_skipped: 0,
    });
  });

  test('Workflow-Entwurf ohne KI ⇒ workflow; eigener Entwurf ohne Herkunft ⇒ workflow ohne Namen', () => {
    insertDraft(72);
    markDraftOrigin(72, 'workflow', 8, { onlyIfUnset: true });
    recordSentProvenance(72, { kind: 'workflow' });
    expect(sentColumns(72)).toMatchObject({ sent_by_kind: 'workflow', sent_by_label: 'Workflow „Rechnungen weiterleiten“' });
  });

  test('Mensch sendet unveränderten KI-Entwurf ⇒ ai_approved; nach Bearbeitung ⇒ human', () => {
    insertDraft(73);
    markDraftOrigin(73, 'ai', 7);
    recordSentProvenance(73, { kind: 'human', userId: 'u1' });
    expect(sentColumns(73)).toEqual({
      sent_by_kind: 'ai_approved',
      sent_by_user_id: 'u1',
      sent_by_workflow_id: 7,
      sent_by_label: 'Anna Beispiel',
      sent_outbound_review_skipped: 0,
    });

    insertDraft(74);
    markDraftOrigin(74, 'ai', 7);
    markDraftOriginEdited(74);
    recordSentProvenance(74, { kind: 'human', userId: 'u1' });
    expect(sentColumns(74)).toMatchObject({ sent_by_kind: 'human', sent_by_workflow_id: null });
  });

  test('Speichern im Entwurfsfenster: nur eine echte Änderung zählt als Bearbeitung', () => {
    insertDraft(78);
    db.prepare(
      `UPDATE email_messages SET body_text = ?, to_json = ? WHERE id = 78`,
    ).run('Guten Tag,\n\nIhre Bestellung kommt morgen.', JSON.stringify({ value: [{ address: 'kunde@example.com' }] }));
    markDraftOrigin(78, 'ai', 7);

    // Wie IPC UpdateComposeDraft: vorher lesen, speichern, vergleichen.
    let before = readDraftOriginContent(78);
    expect(before).not.toBeNull();
    db.prepare(`UPDATE email_messages SET body_text = ?, body_html = ? WHERE id = 78`).run(
      'Guten Tag, Ihre Bestellung kommt morgen.',
      '<p>Guten Tag,</p><p>Ihre Bestellung kommt morgen.</p>',
    );
    markDraftOriginEditedIfChanged(78, before);
    expect(db.prepare('SELECT draft_origin_edited FROM email_messages WHERE id = 78').get())
      .toEqual({ draft_origin_edited: 0 });

    // Das Fenster setzt eine Signatur-Zone ein (Zonen-Marker): keine Bearbeitung.
    before = readDraftOriginContent(78);
    db.prepare(`UPDATE email_messages SET body_text = ?, body_html = ? WHERE id = 78`).run(
      'Guten Tag, Ihre Bestellung kommt morgen. Erika Beispiel',
      '<p>Guten Tag,</p><p>Ihre Bestellung kommt morgen.</p><!-- simplecrm-signature --><p>Erika Beispiel</p>',
    );
    markDraftOriginEditedIfChanged(78, before);
    expect(db.prepare('SELECT draft_origin_edited FROM email_messages WHERE id = 78').get())
      .toEqual({ draft_origin_edited: 0 });

    before = readDraftOriginContent(78);
    db.prepare(`UPDATE email_messages SET body_text = ?, body_html = NULL WHERE id = 78`).run('Guten Tag, Ihre Bestellung kommt übermorgen.');
    markDraftOriginEditedIfChanged(78, before);
    expect(db.prepare('SELECT draft_origin_edited FROM email_messages WHERE id = 78').get())
      .toEqual({ draft_origin_edited: 1 });
    // Bereits bearbeitet: nichts mehr zu vergleichen.
    expect(readDraftOriginContent(78)).toBeNull();
    recordSentProvenance(78, { kind: 'human', userId: 'u1' });
    expect(sentColumns(78)).toMatchObject({ sent_by_kind: 'human' });
  });

  test('Review B7: nur das HTML geändert ⇒ bearbeitet ⇒ human statt „KI · freigegeben“', () => {
    insertDraft(79);
    db.prepare(`UPDATE email_messages SET body_text = ?, body_html = ? WHERE id = 79`).run(
      'Ihre Bestellung kommt morgen.',
      '<p>Ihre Bestellung kommt <a href="https://shop.example.test/status">morgen</a>.</p>',
    );
    markDraftOrigin(79, 'ai', 7);
    const before = readDraftOriginContent(79);
    db.prepare(`UPDATE email_messages SET body_html = ? WHERE id = 79`).run(
      '<p>Ihre Bestellung kommt <a href="https://phish.example.test/status">morgen</a>.</p>',
    );
    markDraftOriginEditedIfChanged(79, before);
    recordSentProvenance(79, { kind: 'human', userId: 'u1' });
    expect(sentColumns(79)).toMatchObject({ sent_by_kind: 'human' });
  });

  test('Bearbeiten ohne Herkunft markiert nichts; eigener Entwurf ⇒ human', () => {
    insertDraft(75);
    expect(readDraftOriginContent(75)).toBeNull();
    markDraftOriginEdited(75);
    expect(db.prepare('SELECT draft_origin_edited FROM email_messages WHERE id = 75').get())
      .toEqual({ draft_origin_edited: 0 });
    recordSentProvenance(75, { kind: 'human', userId: 'unbekannt' });
    expect(sentColumns(75)).toMatchObject({ sent_by_kind: 'human', sent_by_label: null });
  });

  test('„Ohne Ausgangsprüfung senden“ zählt nur, solange der Freigabe-Marker gleich ist', () => {
    insertDraft(76);
    db.prepare(`INSERT INTO sync_info (key, value) VALUES ('outbound_review_approved:76', 'm1'), ('outbound_review_skipped:76', 'm1')`).run();
    recordSentProvenance(76, { kind: 'human', userId: 'u1' });
    expect(sentColumns(76)).toMatchObject({ sent_by_kind: 'human', sent_outbound_review_skipped: 1 });
    expect(db.prepare(`SELECT 1 FROM sync_info WHERE key = 'outbound_review_skipped:76'`).get()).toBeUndefined();

    // Nach einer Änderung hat der normale Ausgang neu freigegeben: kein Überspringen.
    insertDraft(77);
    db.prepare(`INSERT INTO sync_info (key, value) VALUES ('outbound_review_approved:77', 'm2'), ('outbound_review_skipped:77', 'm1')`).run();
    recordSentProvenance(77, { kind: 'human', userId: 'u1' });
    expect(sentColumns(77)).toMatchObject({ sent_outbound_review_skipped: 0 });
  });

  test('unbekannte Nachricht: keine Kennzeichnung, kein Fehler', () => {
    expect(recordSentProvenance(999, { kind: 'workflow' })).toBeNull();
  });
});
