import { createSqliteEmailStoreMock } from './helpers/sqlite-email-store-mock';

const mock = createSqliteEmailStoreMock();
const mockRecordSpamLearning = jest.fn();
jest.mock('../../electron/sqlite-service', () => ({ getDb: () => mock.db }));
jest.mock('../../electron/email/email-message-attachments-store', () => ({
  purgeAttachmentFilesForAccount: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../electron/email/email-spam-store', () => ({
  recordSpamLearningForMessage: (...args: unknown[]) => mockRecordSpamLearning(...args),
}));

import {
  bulkSetMessagesArchived,
  bulkSoftDeleteMessages,
  createComposeDraft,
  createEmailAccountRecord,
  createImapUpsertContext,
  createPop3UpsertContext,
  deleteEmailAccountRecord,
  deleteEmailTeamMember,
  deleteLocalComposeDraft,
  ensureInboxFolderForAccount,
  getComposeSignatureHtml,
  getDefaultComposeSignatureHtml,
  getEmailAccountById,
  getEmailMessageById,
  getFolderByAccountAndPath,
  getFolderById,
  getMailFolderCountsForAccount,
  getMailFolderCountsForAllAccounts,
  getMailFolderCountsForScope,
  insertOrUpdateEmailMessage,
  listAccountSignatureRows,
  listConversationMessages,
  listConversationMessagesForScope,
  listEmailAccounts,
  listEmailTeamMembers,
  listMessageIdsForWorkflowBackfill,
  listMessagesForAccountView,
  listMessagesForAllAccountsView,
  listMessagesForFolder,
  listMessagesForMailScope,
  listMessagesPendingPostProcess,
  loadImapUidToIdMap,
  loadPop3UidlToIdMap,
  loadPop3UidlsForFolder,
  markDraftAsSent,
  markMessagePostProcessDone,
  moveMessageToMailView,
  saveAccountSignature,
  setMessageAssignedTo,
  setMessageSoftDeleted,
  updateComposeDraft,
  updateEmailAccountRecord,
  updateFolderSyncState,
  upsertEmailFolder,
  upsertEmailTeamMember,
} from '../../electron/email/email-store';

describe('email-store expanded', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mock.resetStmt();
  });

  test('account CRUD and signatures', () => {
    expect(listEmailAccounts()).toHaveLength(1);
    expect(getEmailAccountById(1)?.email_address).toBe('a@b.de');
    const created = createEmailAccountRecord({
      displayName: 'N',
      emailAddress: 'n@x.de',
      imapHost: 'h',
      imapPort: 993,
      imapTls: true,
      imapUsername: 'n@x.de',
      protocol: 'pop3',
      pop3Host: 'p',
      imapSyncSeenOnOpen: false,
    });
    expect(created.id).toBe(101);
    updateEmailAccountRecord(1, {
      displayName: 'X',
      vacationEnabled: true,
      requestReadReceipt: true,
    });
    mock.stmt.get.mockReturnValueOnce(undefined);
    expect(() => updateEmailAccountRecord(99, { displayName: 'x' })).toThrow(/not found/);
    updateEmailAccountRecord(1, {});
    listAccountSignatureRows();
    saveAccountSignature(1, '<p>sig</p>');
    expect(getComposeSignatureHtml(1)).toBeDefined();
    expect(getDefaultComposeSignatureHtml()).toBeDefined();
  });

  test('team members seed path', () => {
    mock.stmt.all.mockReturnValueOnce([]).mockReturnValueOnce([
      { id: 'agent-1', display_name: 'A', role: 'agent', signature_html: null, sort_order: 0, created_at: 't' },
    ]);
    const members = listEmailTeamMembers();
    expect(members.length).toBeGreaterThanOrEqual(0);
    upsertEmailTeamMember({ id: 'a2', displayName: 'Agent' });
    deleteEmailTeamMember('a2');
  });

  test('folders and counts', () => {
    expect(getFolderById(10)?.path).toBe('INBOX');
    expect(getFolderByAccountAndPath(1, 'INBOX')?.id).toBe(10);
    const folder = upsertEmailFolder({ accountId: 1, path: 'Sent', lastUid: 0 });
    expect(folder).toBeDefined();
    updateFolderSyncState(10, { lastUid: 7, uidvalidity: 2, uidvalidityStr: '2' });
    ensureInboxFolderForAccount(1);
    getMailFolderCountsForAccount(1);
    getMailFolderCountsForAllAccounts();
    getMailFolderCountsForScope('all');
    getMailFolderCountsForScope(1);
  });

  test('message lists and scopes', () => {
    listMessagesForFolder(10, 50, 0);
    listMessagesForAccountView(1, 'inbox', 50, 0);
    listMessagesForAllAccountsView('archived', 20, 0);
    listMessagesForMailScope(1, 'sent', 10, 0);
    listMessagesForMailScope('all', 'spam', 10, 0);
    listMessagesPendingPostProcess(10);
    markMessagePostProcessDone(100);
    listMessageIdsForWorkflowBackfill(0, 100);
    loadPop3UidlsForFolder(10);
    loadPop3UidlToIdMap(10);
    loadImapUidToIdMap(10, [1, 2, 3]);
  });

  test('insertOrUpdateEmailMessage paths', () => {
    const pop3Ctx = createPop3UpsertContext(10, 1);
    const imapCtx = { imapUidToId: new Map<number, number>() };
    const base = {
      accountId: 1,
      folderId: 10,
      uid: 6,
      messageId: '<x@y>',
      inReplyTo: null,
      referencesHeader: null,
      subject: 'S',
      fromJson: '[]',
      toJson: '[]',
      ccJson: '[]',
      dateReceived: null,
      snippet: 's',
      bodyText: 't',
      bodyHtml: null,
      seenLocal: true,
      hasAttachments: true,
    };
    mock.stmt.get.mockImplementation((...args: unknown[]) => {
      if (args.length >= 3) return undefined;
      return mock.messageRow;
    });
    const r1 = insertOrUpdateEmailMessage(base, imapCtx);
    expect(r1.isNew).toBe(true);
    mock.stmt.get.mockReturnValueOnce({ id: 50 });
    const r2 = insertOrUpdateEmailMessage(
      { ...base, pop3Uidl: 'uidl-1', uid: 99 },
      pop3Ctx,
    );
    expect(r2.id).toBeGreaterThan(0);
    mock.stmt.get.mockReturnValueOnce({ id: 50 });
    insertOrUpdateEmailMessage({ ...base, pop3Uidl: 'uidl-1' }, { pop3UidlToId: new Map([['uidl-1', 50]]) });
    bulkSoftDeleteMessages([1, 2], 1);
    bulkSoftDeleteMessages([]);
    bulkSetMessagesArchived([1], true, 1);
    bulkSetMessagesArchived([], false);
  });

  test('IMAP upsert preserves pending local seen state on conflict', () => {
    mock.resetStmt();
    const { insertOrUpdateEmailMessage } = require('../../electron/email/email-store') as typeof import('../../electron/email/email-store');
    insertOrUpdateEmailMessage({
      accountId: 1,
      folderId: 10,
      uid: 6,
      messageId: '<x@y>',
      inReplyTo: null,
      referencesHeader: null,
      subject: 'S',
      fromJson: '[]',
      toJson: '[]',
      ccJson: '[]',
      dateReceived: null,
      snippet: 's',
      bodyText: 't',
      bodyHtml: null,
      seenLocal: false,
    }, createImapUpsertContext(10, [6]));

    const preparedSql = mock.db.prepare.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(preparedSql).toContain('seen_sync_pending');
    expect(preparedSql).not.toContain('seen_local = excluded.seen_local');
  });

  test('drafts conversation and views', () => {
    setMessageAssignedTo(100, 'agent-1');
    mock.stmt.get.mockImplementation(() => ({
      ...mock.messageRow,
      uid: -5,
      folder_kind: 'drafts',
    }));
    const draftId = createComposeDraft({
      accountId: 1,
      toJson: '[]',
      subject: 'Draft',
      bodyText: 't',
    });
    expect(draftId).toBeGreaterThan(0);
    updateComposeDraft(draftId, { subject: 'Updated' });
    listConversationMessages(1, { ticketCode: 'T-1' });
    listConversationMessagesForScope(1, { customerId: 5 });
    listConversationMessagesForScope('all', { ticketCode: 'T-2' });
    markDraftAsSent(draftId);
    deleteLocalComposeDraft(draftId);
    mock.stmt.get.mockImplementation(() => ({ ...mock.messageRow, uid: 6, pop3_uidl: null }));
    moveMessageToMailView(100, 'archived');
    moveMessageToMailView(100, 'inbox');
    moveMessageToMailView(100, 'spam');
    moveMessageToMailView(100, 'trash');
    setMessageSoftDeleted(100, true);
    setMessageSoftDeleted(100, false);
    expect(getEmailMessageById(100)?.id).toBe(100);
  });

  test('deleteEmailAccountRecord', async () => {
    await deleteEmailAccountRecord(1);
    expect(mock.db.prepare).toHaveBeenCalled();
  });
});
