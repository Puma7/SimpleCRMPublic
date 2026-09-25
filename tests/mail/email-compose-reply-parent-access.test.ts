/**
 * Antwort-Elternteil beim Versand: Header, Ticket und „erledigt" nur mit dem
 * Recht am Konto der Eltern-Mail. Echte SQLite mit ACL-Zeilen; ersetzt sind nur
 * SMTP und die IMAP-Ablage.
 */
const mockSendSmtp = jest.fn();

jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: (...args: unknown[]) => mockSendSmtp(...args),
}));

jest.mock('../../electron/email/email-imap-append', () => ({
  appendSentToImap: jest.fn().mockResolvedValue(undefined),
}));

import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import {
  createComposeDraft,
  createEmailAccountRecord,
  ensureInboxFolderForAccount,
  getEmailMessageById,
  insertOrUpdateEmailMessage,
} from '../../electron/email/email-store';
import { getOrCreateThreadForTicket } from '../../electron/email/email-ticket';
import { sendComposeDraft } from '../../electron/email/email-compose-send';

const AGENT = { userId: 'agent-1', role: 'agent' as const };
const PARENT_MESSAGE_ID = '<frage@kunde.test>';
const PARENT_TICKET = 'VERTRIEB-4711';

describe('sendComposeDraft: Konto der Eltern-Mail', () => {
  let db: Database.Database;
  let serviceAccountId: number;
  let salesAccountId: number;

  function account(name: string): number {
    return createEmailAccountRecord({
      displayName: name,
      emailAddress: `${name}@firma.test`,
      imapHost: 'imap.firma.test',
      imapPort: 993,
      imapTls: true,
      imapUsername: `${name}@firma.test`,
    }).id;
  }

  function grant(userId: string, accountId: number, level: 'ro' | 'rw' | 'send_only') {
    db.prepare(
      'INSERT INTO user_account_access (user_id, account_id, access_level) VALUES (?, ?, ?)',
    ).run(userId, accountId, level);
  }

  function parentIn(accountId: number): number {
    const folder = ensureInboxFolderForAccount(accountId);
    const id = insertOrUpdateEmailMessage({
      accountId,
      folderId: folder.id,
      uid: 7,
      messageId: PARENT_MESSAGE_ID,
      inReplyTo: null,
      referencesHeader: '<anfang@kunde.test>',
      subject: `Frage [${PARENT_TICKET}]`,
      fromJson: JSON.stringify({ value: [{ address: 'kunde@kunde.test' }] }),
      toJson: null,
      ccJson: null,
      dateReceived: '2026-09-20T10:00:00.000Z',
      snippet: 'Vertrauliche Frage',
      bodyText: 'Vertrauliche Frage',
      bodyHtml: null,
      seenLocal: true,
    }).id;
    db.prepare('UPDATE email_messages SET ticket_code = ?, thread_id = ? WHERE id = ?').run(
      PARENT_TICKET,
      getOrCreateThreadForTicket(PARENT_TICKET, accountId),
      id,
    );
    return id;
  }

  function reply(parentId: number, actor?: { userId: string; role: 'owner' | 'admin' | 'agent' | 'viewer' }) {
    const draftId = createComposeDraft({ accountId: serviceAccountId });
    return {
      draftId,
      result: sendComposeDraft({
        accountId: serviceAccountId,
        draftMessageId: draftId,
        subject: 'Re: Frage',
        bodyText: 'Antwort',
        to: 'kunde@kunde.test',
        inReplyToMessageId: parentId,
        ...(actor ? { actor } : {}),
      }),
    };
  }

  const smtpHeaders = () => {
    const [, message] = mockSendSmtp.mock.calls[0] as [number, { inReplyTo?: string; references?: string; subject: string }];
    return message;
  };
  const doneLocal = (id: number) => getEmailMessageById(id)?.done_local;

  beforeEach(() => {
    mockSendSmtp.mockReset().mockResolvedValue(undefined);
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, password_updated_at)
       VALUES (?, ?, ?, 'agent', 'x', ?)`,
    ).run(AGENT.userId, AGENT.userId, 'Agent', new Date().toISOString());
    serviceAccountId = account('service');
    salesAccountId = account('vertrieb');
    grant(AGENT.userId, serviceAccountId, 'rw');
  });

  afterEach(() => {
    closeDatabase();
  });

  // C-A79: Eine Eltern-Mail aus einem Konto ohne Zugriff lieferte Message-ID, References und Ticket fuer die Antwort und wurde als erledigt markiert.
  test('verwirft eine Eltern-Mail aus einem Konto, das der Handelnde nicht lesen darf', async () => {
    const parentId = parentIn(salesAccountId);

    const { draftId, result } = reply(parentId, AGENT);

    await expect(result).resolves.toEqual({ ok: true });
    const sent = smtpHeaders();
    expect(sent.inReplyTo).toBeUndefined();
    expect(sent.references).toBeUndefined();
    expect(sent.subject).not.toContain(PARENT_TICKET);
    const draft = getEmailMessageById(draftId)!;
    expect(draft.ticket_code).not.toBe(PARENT_TICKET);
    expect(draft.in_reply_to).toBeNull();
    expect(draft.references_header).toBeNull();
    expect(doneLocal(parentId)).toBe(0);
  });

  test('nutzt die Eltern-Mail mit Leserecht, markiert sie ohne Schreibrecht aber nicht als erledigt', async () => {
    grant(AGENT.userId, salesAccountId, 'ro');
    const parentId = parentIn(salesAccountId);

    const { draftId, result } = reply(parentId, AGENT);

    await expect(result).resolves.toEqual({ ok: true });
    expect(smtpHeaders().inReplyTo).toBe(PARENT_MESSAGE_ID);
    expect(smtpHeaders().references).toContain(PARENT_MESSAGE_ID);
    expect(getEmailMessageById(draftId)?.ticket_code).toBe(PARENT_TICKET);
    expect(doneLocal(parentId)).toBe(0);
  });

  test('markiert die Eltern-Mail mit Schreibrecht als erledigt', async () => {
    grant(AGENT.userId, salesAccountId, 'rw');
    const parentId = parentIn(salesAccountId);

    const { result } = reply(parentId, AGENT);

    await expect(result).resolves.toEqual({ ok: true });
    expect(smtpHeaders().inReplyTo).toBe(PARENT_MESSAGE_ID);
    expect(doneLocal(parentId)).toBe(1);
  });

  test('Owner und Admin behalten den kontouebergreifenden Elternbezug', async () => {
    for (const role of ['owner', 'admin'] as const) {
      mockSendSmtp.mockClear();
      const parentId = parentIn(salesAccountId);
      db.prepare('UPDATE email_messages SET done_local = 0 WHERE id = ?').run(parentId);

      const { draftId, result } = reply(parentId, { userId: `${role}-1`, role });

      await expect(result).resolves.toEqual({ ok: true });
      expect(smtpHeaders().inReplyTo).toBe(PARENT_MESSAGE_ID);
      expect(getEmailMessageById(draftId)?.ticket_code).toBe(PARENT_TICKET);
      expect(doneLocal(parentId)).toBe(1);
    }
  });

  test('ohne Akteur (Hintergrundversand) gilt nur eine Eltern-Mail aus demselben Konto', async () => {
    const foreignParent = parentIn(salesAccountId);
    const foreign = reply(foreignParent);
    await expect(foreign.result).resolves.toEqual({ ok: true });
    expect(smtpHeaders().inReplyTo).toBeUndefined();
    expect(doneLocal(foreignParent)).toBe(0);

    mockSendSmtp.mockClear();
    const ownParent = parentIn(serviceAccountId);
    const own = reply(ownParent);
    await expect(own.result).resolves.toEqual({ ok: true });
    expect(smtpHeaders().inReplyTo).toBe(PARENT_MESSAGE_ID);
    expect(getEmailMessageById(own.draftId)?.ticket_code).toBe(PARENT_TICKET);
    expect(doneLocal(ownParent)).toBe(1);
  });
});
