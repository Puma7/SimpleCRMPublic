/**
 * @jest-environment node
 */
import Database from 'better-sqlite3';
import {
  createCustomersTable,
  createEmailAccountsTable,
  createEmailFoldersTable,
  createEmailMessagesTable,
  createEmailTeamMembersTable,
  createEmailThreadAliasesTable,
  createEmailThreadEdgesTable,
  createEmailThreadsTable,
  EMAIL_MESSAGES_TABLE,
} from '../../electron/database-schema';

let mockDb: Database.Database;
let mockTicketSequence = 0;

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => mockDb,
}));

jest.mock('../../electron/email/account-mail-settings-store', () => ({
  ...jest.requireActual('../../electron/email/account-mail-settings-store'),
  listKnownTicketPrefixes: () => new Set<string>(),
  allocateNextTicketCodeForAccount: () => {
    mockTicketSequence += 1;
    return `NEU-${String(mockTicketSequence).padStart(6, '0')}`;
  },
}));

import { assignJwzThreadAndTicket } from '../../electron/email/email-threading-jwz';

const ACCOUNT_ID = 1;

type Seed = {
  id: number;
  messageId: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  threadId?: string | null;
  ticket?: string | null;
};

function insertMessage(seed: Seed): void {
  mockDb
    .prepare(
      `INSERT INTO ${EMAIL_MESSAGES_TABLE}
       (id, account_id, folder_id, uid, message_id, in_reply_to, references_header, subject, thread_id, ticket_code, date_received)
       VALUES (?, ?, 1, ?, ?, ?, ?, 'Betreff', ?, ?, datetime('now'))`,
    )
    .run(
      seed.id,
      ACCOUNT_ID,
      seed.id,
      seed.messageId,
      seed.inReplyTo ?? null,
      seed.references ?? null,
      seed.threadId ?? null,
      seed.ticket ?? null,
    );
  if (seed.threadId && seed.ticket) {
    mockDb
      .prepare('INSERT OR IGNORE INTO email_threads (id, ticket_code, account_id) VALUES (?, ?, ?)')
      .run(seed.threadId, seed.ticket, ACCOUNT_ID);
  }
}

function assign(seed: Seed): void {
  insertMessage({ ...seed, threadId: null, ticket: null });
  assignJwzThreadAndTicket(seed.id, ACCOUNT_ID, {
    messageIdHeader: seed.messageId,
    inReplyTo: seed.inReplyTo ?? null,
    referencesHeader: seed.references ?? null,
    subject: 'Betreff',
  });
}

function threadOf(id: number): { thread_id: string | null; ticket_code: string | null } {
  return mockDb
    .prepare(`SELECT thread_id, ticket_code FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`)
    .get(id) as { thread_id: string | null; ticket_code: string | null };
}

describe('assignJwzThreadAndTicket reference matching (real SQLite)', () => {
  beforeEach(() => {
    mockTicketSequence = 0;
    mockDb = new Database(':memory:');
    mockDb.exec(createCustomersTable);
    mockDb.exec(createEmailAccountsTable);
    mockDb.exec(createEmailTeamMembersTable);
    mockDb.exec(createEmailFoldersTable);
    mockDb.exec(createEmailMessagesTable);
    mockDb.exec(createEmailThreadsTable);
    mockDb.exec(createEmailThreadEdgesTable);
    mockDb.exec(createEmailThreadAliasesTable);
    for (const column of [
      'thread_confidence TEXT',
      'thread_resolver_version INTEGER NOT NULL DEFAULT 0',
      'normalized_subject TEXT',
      'server_thread_source TEXT',
    ]) {
      mockDb.exec(`ALTER TABLE ${EMAIL_MESSAGES_TABLE} ADD COLUMN ${column}`);
    }
    mockDb
      .prepare(
        `INSERT INTO email_accounts (id, display_name, email_address, imap_host, imap_username, keytar_account_key)
         VALUES (?, 'Support', 'support@example.test', 'imap.example.test', 'support', 'k1')`,
      )
      .run(ACCOUNT_ID);
    mockDb.prepare(`INSERT INTO email_folders (id, account_id, path) VALUES (1, ?, 'INBOX')`).run(ACCOUNT_ID);

    // Two unrelated conversations whose References merely share substrings.
    insertMessage({ id: 1, messageId: '<b1@kunde-b.com>', references: '<y7@kunde-b.com> <z@kunde-b.com>', threadId: 'th-B', ticket: 'ALT-B' });
    insertMessage({ id: 2, messageId: '<c1@lieferant.com>', references: '<q@lieferant.com>', threadId: 'th-C', ticket: 'ALT-C' });
  });

  afterEach(() => {
    mockDb?.close();
  });

  // C-A62: Referenzen wurden per INSTR-Teilstring gesucht; ein kurzer Token wie "com" in den
  // References einer eingehenden Mail fuehrte fremde Konversationen dauerhaft zusammen.
  test('a bare reference token does not merge unrelated conversations', () => {
    assign({ id: 10, messageId: '<x1@angreifer.example>', references: 'com' });

    expect(threadOf(1)).toEqual({ thread_id: 'th-B', ticket_code: 'ALT-B' });
    expect(threadOf(2)).toEqual({ thread_id: 'th-C', ticket_code: 'ALT-C' });
    expect(['th-B', 'th-C']).not.toContain(threadOf(10).thread_id);
  });

  test('a message id that is only a substring of a stored reference does not match', () => {
    assign({ id: 11, messageId: '<x2@angreifer.example>', references: '<7@kunde-b.com> <q@lieferant.co>' });

    expect(threadOf(1).thread_id).toBe('th-B');
    expect(threadOf(2).thread_id).toBe('th-C');
    expect(['th-B', 'th-C']).not.toContain(threadOf(11).thread_id);
  });

  test('LIKE wildcards in a reference are matched literally', () => {
    assign({ id: 12, messageId: '<x3@angreifer.example>', references: '<%@kunde-b.com> <y_@kunde-b.com> <_@lieferant.com>' });

    expect(threadOf(1).thread_id).toBe('th-B');
    expect(threadOf(2).thread_id).toBe('th-C');
    expect(['th-B', 'th-C']).not.toContain(threadOf(12).thread_id);
  });

  test('an RFC reply chain still joins its conversation', () => {
    insertMessage({ id: 3, messageId: '<root@kunde-a.de>', threadId: 'th-A', ticket: 'ALT-A' });
    insertMessage({ id: 4, messageId: '<r1@kunde-a.de>', inReplyTo: '<root@kunde-a.de>', references: '<root@kunde-a.de>', threadId: 'th-A', ticket: 'ALT-A' });

    assign({ id: 20, messageId: '<R2@Kunde-A.de>', inReplyTo: '<r1@kunde-a.de>', references: '<root@kunde-a.de> <r1@kunde-a.de>' });

    expect(threadOf(20)).toEqual({ thread_id: 'th-A', ticket_code: 'ALT-A' });
    expect(threadOf(1).thread_id).toBe('th-B');
  });

  test('an exact References token joins even when the referenced message is not stored', () => {
    // Folded, mixed-case References header of the stored reply; its root d0 was never synced.
    insertMessage({
      id: 5,
      messageId: '<d2@partner.example>',
      inReplyTo: '<d1@partner.example>',
      references: '<D0@Partner.Example>\r\n\t<d1@partner.example>',
      threadId: 'th-D',
      ticket: 'ALT-D',
    });

    assign({ id: 21, messageId: '<d9@partner.example>', references: '<d0@partner.example>' });

    expect(threadOf(21)).toEqual({ thread_id: 'th-D', ticket_code: 'ALT-D' });
  });

  test('a late parent joins the replies that reference it', () => {
    insertMessage({ id: 6, messageId: '<e2@partner.example>', references: '<e0@partner.example> <e1@partner.example>', threadId: 'th-E', ticket: 'ALT-E' });

    assign({ id: 22, messageId: '<e1@partner.example>' });

    expect(threadOf(22)).toEqual({ thread_id: 'th-E', ticket_code: 'ALT-E' });
  });
});
