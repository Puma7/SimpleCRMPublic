/**
 * Gespeicherter Planender eines zeitversetzten Versands (sync_info) und die
 * Pruefung im Hintergrundversand. Echte SQLite mit Benutzern und Konto-ACL;
 * ersetzt sind nur SMTP und die IMAP-Ablage.
 */
const mockSendSmtp = jest.fn();

jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: (...args: unknown[]) => mockSendSmtp(...args),
}));

jest.mock('../../electron/email/email-imap-append', () => ({
  appendSentToImap: jest.fn().mockResolvedValue(undefined),
}));

import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase, setSyncInfo } from '../../electron/sqlite-service';
import {
  bulkDeleteLocalComposeDrafts,
  createComposeDraft,
  createEmailAccountRecord,
  deleteLocalComposeDraft,
  getEmailMessageById,
} from '../../electron/email/email-store';
import { setDraftScheduledSendAt } from '../../electron/email/email-message-features';
import { getScheduledSendDraftState } from '../../electron/email/email-scheduled-send-state';
import {
  SCHEDULED_SEND_ACTOR_REVOKED_MESSAGE,
  processDueScheduledSends,
} from '../../electron/email/email-scheduled-send';
import {
  clearScheduledSendActor,
  readScheduledSendActor,
  recordScheduledSendActor,
  scheduledSendActorKey,
} from '../../electron/email/email-scheduled-send-actor';
import { approveDraftSend } from '../../electron/workflow/draft-approval-actions';
import { setDraftApprovalPending } from '../../electron/email/email-draft-approval';

const PAST = '2026-01-01T08:00:00.000Z';
const logger = { warn: jest.fn(), debug: jest.fn() };

describe('Geplanter Versand: gespeicherter Planender', () => {
  let db: Database.Database;
  let accountId: number;

  function draft(): number {
    const id = createComposeDraft({
      accountId,
      subject: 'Angebot',
      bodyText: 'Hallo',
      toJson: JSON.stringify({ value: [{ address: 'kunde@kunde.test' }] }),
    });
    setDraftScheduledSendAt(id, PAST);
    return id;
  }

  function user(id: string, role = 'agent') {
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, password_updated_at)
       VALUES (?, ?, ?, ?, 'x', ?)`,
    ).run(id, id, id, role, new Date().toISOString());
  }

  function grant(userId: string, level: 'ro' | 'rw' | 'send_only') {
    db.prepare(
      'INSERT OR REPLACE INTO user_account_access (user_id, account_id, access_level) VALUES (?, ?, ?)',
    ).run(userId, accountId, level);
  }

  const held = (id: number) => {
    expect(getScheduledSendDraftState(id)).toMatchObject({
      status: 'failed',
      lastError: SCHEDULED_SEND_ACTOR_REVOKED_MESSAGE,
    });
    expect((getEmailMessageById(id) as { scheduled_send_at?: string | null }).scheduled_send_at).toBeNull();
    expect(getEmailMessageById(id)?.folder_kind).toBe('draft');
  };

  beforeEach(() => {
    mockSendSmtp.mockReset().mockResolvedValue(undefined);
    logger.warn.mockClear();
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    accountId = createEmailAccountRecord({
      displayName: 'Service',
      emailAddress: 'service@firma.test',
      imapHost: 'imap.firma.test',
      imapPort: 993,
      imapTls: true,
      imapUsername: 'service@firma.test',
    }).id;
    user('agent-1');
  });

  afterEach(() => {
    closeDatabase();
  });

  test('speichert, liest und raeumt den Akteur je Entwurf', () => {
    expect(readScheduledSendActor(5)).toBeUndefined();
    recordScheduledSendActor(5, { userId: 'agent-1' });
    recordScheduledSendActor(6, { userId: 'agent-2' });
    expect(readScheduledSendActor(5)).toEqual({ userId: 'agent-1' });

    clearScheduledSendActor(5, 6);
    expect(readScheduledSendActor(5)).toBeUndefined();
    expect(readScheduledSendActor(6)).toBeUndefined();
  });

  test('ein unlesbarer Eintrag gilt als entzogen', () => {
    setSyncInfo(scheduledSendActorKey(5), 'kein-json');
    expect(readScheduledSendActor(5)).toBeNull();
    setSyncInfo(scheduledSendActorKey(5), JSON.stringify({ userId: '' }));
    expect(readScheduledSendActor(5)).toBeNull();
  });

  // C-A2: Der Hintergrundversand pruefte die Rechte des Planenden nicht mehr, nachdem er geplant hatte.
  test('sendet mit Schreibrecht und haelt bei ro, send_only, Deaktivierung, Loeschung oder unlesbarem Eintrag an', async () => {
    grant('agent-1', 'rw');
    const ok = draft();
    recordScheduledSendActor(ok, { userId: 'agent-1' });
    await expect(processDueScheduledSends(logger)).resolves.toBe(1);
    expect(getEmailMessageById(ok)?.folder_kind).toBe('sent');
    expect(readScheduledSendActor(ok)).toBeUndefined();

    for (const revoke of [
      () => grant('agent-1', 'ro'),
      () => grant('agent-1', 'send_only'),
      () => db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run('agent-1'),
      () => db.prepare('DELETE FROM users WHERE id = ?').run('agent-1'),
    ]) {
      db.prepare('DELETE FROM users WHERE id = ?').run('agent-1');
      user('agent-1');
      grant('agent-1', 'rw');
      const id = draft();
      recordScheduledSendActor(id, { userId: 'agent-1' });
      revoke();

      mockSendSmtp.mockClear();
      await expect(processDueScheduledSends(logger)).resolves.toBe(0);
      expect(mockSendSmtp).not.toHaveBeenCalled();
      held(id);
    }

    const corrupt = draft();
    setSyncInfo(scheduledSendActorKey(corrupt), 'kein-json');
    await processDueScheduledSends(logger);
    held(corrupt);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ohne Schreibzugriff'));
  });

  test('Owner und Admin ohne Konto-Freigabe senden weiter; ohne gespeicherten Akteur wie bisher', async () => {
    user('admin-1', 'admin');
    const byAdmin = draft();
    recordScheduledSendActor(byAdmin, { userId: 'admin-1' });
    const legacy = draft();

    await expect(processDueScheduledSends(logger)).resolves.toBe(2);

    expect(getEmailMessageById(byAdmin)?.folder_kind).toBe('sent');
    expect(getEmailMessageById(legacy)?.folder_kind).toBe('sent');
  });

  test('war SMTP schon durch, wird trotz Entzug nur nachgezogen', async () => {
    const id = draft();
    recordScheduledSendActor(id, { userId: 'agent-1' });
    setSyncInfo(`email_compose_smtp_ok:${id}`, '1');

    await expect(processDueScheduledSends(logger)).resolves.toBe(1);

    expect(mockSendSmtp).not.toHaveBeenCalled();
    expect(getEmailMessageById(id)?.folder_kind).toBe('sent');
    expect(readScheduledSendActor(id)).toBeUndefined();
  });

  test('Freigabe speichert den Freigebenden; Loeschen raeumt den Akteur auf', () => {
    const approved = draft();
    setDraftApprovalPending(approved, 'Bitte pruefen');
    expect(approveDraftSend(approved, { userId: 'agent-1' })).toEqual({ success: true });
    expect(readScheduledSendActor(approved)).toEqual({ userId: 'agent-1' });

    deleteLocalComposeDraft(approved);
    expect(readScheduledSendActor(approved)).toBeUndefined();

    const a = draft();
    const b = draft();
    recordScheduledSendActor(a, { userId: 'agent-1' });
    recordScheduledSendActor(b, { userId: 'agent-1' });
    expect(bulkDeleteLocalComposeDrafts([a, b])).toBe(2);
    expect(readScheduledSendActor(a)).toBeUndefined();
    expect(readScheduledSendActor(b)).toBeUndefined();
  });
});
