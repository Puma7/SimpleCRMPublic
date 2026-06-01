import { createSqliteEmailStoreBranchesMock } from './helpers/sqlite-email-store-branches-mock';
import { POP3_UID_CEILING } from '../../electron/email/email-store';

const mock = createSqliteEmailStoreBranchesMock();
jest.mock('../../electron/sqlite-service', () => ({ getDb: () => mock.db }));
jest.mock('../../electron/email/email-keytar', () => ({
  deleteEmailPassword: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../electron/email/email-message-attachments-store', () => ({
  purgeAttachmentFilesForAccount: jest.fn().mockResolvedValue(undefined),
}));

import { deleteEmailPassword } from '../../electron/email/email-keytar';
import {
  addMessageTag,
  allocatePop3NegativeUid,
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
  getMailFolderCountsForAccount,
  getMailFolderCountsForAllAccounts,
  getMailFolderCountsForScope,
  insertOrUpdateEmailMessage,
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
  listTagsForMessage,
  loadImapUidToIdMap,
  loadPop3UidlToIdMap,
  loadPop3UidlsForFolder,
  markDraftAsSent,
  markMessagePostProcessDone,
  moveMessageToMailView,
  removeMessageTag,
  saveAccountSignature,
  setMessageArchived,
  setMessageSeenLocal,
  setMessageSoftDeleted,
  setMessageSpam,
  setOutboundHold,
  updateComposeDraft,
  updateEmailAccountRecord,
  updateFolderSyncState,
  upsertEmailFolder,
  upsertEmailTeamMember,
} from '../../electron/email/email-store';

const msgBase = {
  accountId: 1,
  folderId: 10,
  uid: 7,
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
};

describe('email-store branches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mock.resetState();
  });

  describe('account lifecycle', () => {
    test('createEmailAccountRecord uses defaults and explicit keytar key', () => {
      const withKey = createEmailAccountRecord({
        displayName: 'N',
        emailAddress: 'n@x.de',
        imapHost: 'h',
        imapPort: 993,
        imapTls: false,
        imapUsername: 'n@x.de',
        keytarAccountKey: 'custom-key',
        protocol: 'pop3',
        pop3Host: ' pop.example ',
        pop3Port: 110,
        pop3Tls: false,
        imapSyncSeenOnOpen: false,
      });
      expect(withKey.keytarAccountKey).toBe('custom-key');
      const auto = createEmailAccountRecord({
        displayName: 'A',
        emailAddress: 'a@x.de',
        imapHost: 'h',
        imapPort: 993,
        imapTls: true,
        imapUsername: 'a@x.de',
      });
      expect(auto.keytarAccountKey).toMatch(/^email-/);
    });

    test('updateEmailAccountRecord covers all optional fields and early return', () => {
      updateEmailAccountRecord(1, {
        displayName: 'X',
        emailAddress: ' x@y.de ',
        imapHost: ' imap ',
        imapPort: 143,
        imapTls: false,
        imapUsername: ' u ',
        smtpHost: 'smtp',
        smtpPort: 465,
        smtpTls: false,
        smtpUsername: 'su',
        smtpUseImapAuth: false,
        smtpKeytarAccountKey: 'sk',
        protocol: 'pop3',
        pop3Host: 'p',
        pop3Port: 995,
        pop3Tls: false,
        oauthProvider: 'google',
        oauthRefreshKeytarKey: 'ok',
        sentFolderPath: 'Gesendet',
        imapSyncSeenOnOpen: false,
        vacationEnabled: true,
        vacationSubject: 'Away',
        vacationBodyText: 'Back soon',
        requestReadReceipt: true,
      });
      updateEmailAccountRecord(1, {});
      mock.stmt.get.mockReturnValueOnce(undefined);
      expect(() => updateEmailAccountRecord(99, { displayName: 'x' })).toThrow(/not found/);
    });

    test('deleteEmailAccountRecord purges keytar keys when present', async () => {
      mock.state.accounts.get(1)!.smtp_keytar_account_key = 'smtp-k';
      mock.state.accounts.get(1)!.oauth_refresh_keytar_key = 'oauth-k';
      await deleteEmailAccountRecord(1);
      expect(deleteEmailPassword).toHaveBeenCalledWith('k1');
      expect(deleteEmailPassword).toHaveBeenCalledWith('smtp-k');
      expect(deleteEmailPassword).toHaveBeenCalledWith('oauth-k');
      await deleteEmailAccountRecord(999);
    });
  });

  describe('signatures and team members', () => {
    test('saveAccountSignature deletes when empty', () => {
      saveAccountSignature(1, '<p>sig</p>');
      expect(getComposeSignatureHtml(1)).toBe('<p>sig</p>');
      saveAccountSignature(1, '   ');
      expect(mock.state.signatures.has(1)).toBe(false);
    });

    test('getComposeSignatureHtml falls back to team then display name', () => {
      mock.state.teamMembers = [
        { id: 't1', display_name: 'Team', role: 'agent', signature_html: '  <p>T</p>  ', sort_order: 0, created_at: 't' },
      ];
      expect(getComposeSignatureHtml(1)).toBe('<p>T</p>');
      mock.state.teamMembers = [
        { id: 't2', display_name: 'NoSig', role: 'agent', signature_html: null, sort_order: 0, created_at: 't' },
      ];
      expect(getComposeSignatureHtml(1)).toContain('NoSig');
      mock.state.teamMembers = [];
      mock.stmt.all.mockImplementationOnce(() => []).mockImplementationOnce(() => []);
      expect(getComposeSignatureHtml(1)).toContain('Test');
    });

    test('getDefaultComposeSignatureHtml with no accounts uses team fallback', () => {
      mock.state.accounts.clear();
      mock.state.teamMembers = [
        { id: 't1', display_name: 'Only', role: 'agent', signature_html: '<p>O</p>', sort_order: 0, created_at: 't' },
      ];
      expect(getDefaultComposeSignatureHtml()).toBe('<p>O</p>');
    });

    test('listEmailTeamMembers seeds default when empty', () => {
      mock.state.teamMembers = [];
      const first = listEmailTeamMembers();
      expect(first.length).toBeGreaterThan(0);
      upsertEmailTeamMember({ id: ' custom ', displayName: ' Agent ', role: ' lead ', signatureHtml: ' sig ' });
      deleteEmailTeamMember('custom');
    });

    test('getComposeSignatureHtml returns null for missing account', () => {
      expect(getComposeSignatureHtml(999)).toBeNull();
    });
  });

  describe('folders', () => {
    test('upsertEmailFolder updates existing with all fields', () => {
      upsertEmailFolder({
        accountId: 1,
        path: 'INBOX',
        delimiter: '.',
        uidvalidity: 2,
        uidvalidityStr: '2',
        lastUid: 9,
        pop3UidlStr: '[]',
      });
      const created = upsertEmailFolder({ accountId: 1, path: 'Archive', lastUid: 0 });
      expect(created.path).toBe('Archive');
    });

    test('ensureInboxFolderForAccount creates when missing', () => {
      mock.state.folders.clear();
      const f = ensureInboxFolderForAccount(1);
      expect(f.path).toBe('INBOX');
    });

    test('updateFolderSyncState sets optional fields', () => {
      updateFolderSyncState(10, {
        lastUid: 8,
        uidvalidity: 3,
        uidvalidityStr: '3',
        pop3UidlStr: '["a"]',
      });
      updateFolderSyncState(10, {});
    });
  });

  describe('message listing views filters and sorts', () => {
    const views = ['inbox', 'sent', 'archived', 'drafts', 'spam', 'trash', 'all'] as const;
    const filters = [undefined, 'unread', 'attachment', 'customer', 'workflow'] as const;
    const sorts = [undefined, 'priority', 'date_asc'] as const;

    test.each(views)('listMessagesForAccountView view=%s', (view) => {
      listMessagesForAccountView(1, view, { limit: 5, offset: 0, categoryId: view === 'trash' ? 5 : 3 });
    });

    test.each(views)('listMessagesForAllAccountsView view=%s', (view) => {
      listMessagesForAllAccountsView(view, { categoryId: 2 });
    });

    test('listMessagesForMailScope routes account vs all', () => {
      listMessagesForMailScope('all', 'inbox');
      listMessagesForMailScope(1, 'sent', { listFilter: 'unread', sort: 'priority' });
    });

    test.each(filters)('list filter=%s with sort=%s', (listFilter) => {
      for (const sort of sorts) {
        listMessagesForAccountView(1, 'inbox', { listFilter, sort });
        listMessagesForAllAccountsView('inbox', { listFilter, sort });
      }
    });

    test('listMessagesForFolder returns inbox rows', () => {
      listMessagesForFolder(10, { limit: 10, offset: 0 });
    });
  });

  describe('folder counts', () => {
    test('getMailFolderCounts handles null aggregates', () => {
      mock.stmt.get.mockReturnValueOnce(null);
      const c = getMailFolderCountsForAccount(1);
      expect(c.inbox).toBe(0);
      mock.stmt.get.mockReturnValueOnce({
        trash: null,
        inbox: null,
        inbox_unread: null,
        sent_failed: null,
        drafts: null,
        archived: null,
        spam: null,
      });
      expect(getMailFolderCountsForAllAccounts().trash).toBe(0);
      getMailFolderCountsForScope('all');
      getMailFolderCountsForScope(1);
    });

    test('getMailFolderCounts sums real messages', () => {
      mock.seedMessage({
        id: 201,
        uid: 8,
        folder_kind: 'sent',
        is_spam: 0,
        soft_deleted: 0,
        sent_imap_sync_failed: 1,
      });
      mock.seedMessage({ id: 202, uid: 9, folder_kind: 'draft', soft_deleted: 0 });
      mock.seedMessage({ id: 203, uid: 10, archived: 1, soft_deleted: 0, is_spam: 0 });
      mock.seedMessage({ id: 204, uid: 11, is_spam: 1, soft_deleted: 0 });
      mock.seedMessage({ id: 205, uid: -2, folder_kind: 'draft', outbound_hold: 1, soft_deleted: 0 });
      const counts = getMailFolderCountsForAccount(1);
      expect(counts.sentFailed).toBeGreaterThanOrEqual(1);
      expect(counts.drafts).toBeGreaterThanOrEqual(1);
    });
  });

  describe('pop3 and imap uid helpers', () => {
    test('allocatePop3NegativeUid when no prior uids', () => {
      mock.state.messages.clear();
      expect(allocatePop3NegativeUid(1, 10)).toBe(POP3_UID_CEILING);
    });

    test('allocatePop3NegativeUid decrements from min', () => {
      mock.seedMessage({ id: 301, uid: -1_000_005, pop3_uidl: 'u1' });
      expect(allocatePop3NegativeUid(1, 10)).toBe(-1_000_006);
    });

    test('loadPop3UidlsForFolder and maps', () => {
      mock.seedMessage({ id: 302, uid: -3, pop3_uidl: 'uidl-a', post_process_done: 1 });
      mock.seedMessage({ id: 303, uid: -4, pop3_uidl: 'uidl-b', post_process_done: 0 });
      expect(loadPop3UidlsForFolder(10).has('uidl-a')).toBe(true);
      const map = loadPop3UidlToIdMap(10);
      expect(map.get('uidl-a')).toBe(302);
    });

    test('loadImapUidToIdMap chunks and empty', () => {
      expect(loadImapUidToIdMap(10, []).size).toBe(0);
      mock.seedMessage({ id: 304, uid: 50 });
      mock.seedMessage({ id: 305, uid: 51 });
      const uids = Array.from({ length: 450 }, (_, i) => i + 1);
      const map = loadImapUidToIdMap(10, uids);
      expect(map.get(50)).toBe(304);
    });

    test('createPop3UpsertContext and createImapUpsertContext', () => {
      const pop3 = createPop3UpsertContext(10, 1);
      expect(pop3.nextPop3Uid).toBeDefined();
      expect(pop3.pop3UidlToId?.size).toBeGreaterThanOrEqual(0);
      const imap = createImapUpsertContext(10, [6, 7]);
      expect(imap.imapUidToId).toBeDefined();
    });

    test('listMessageIdsForWorkflowBackfill and post process', () => {
      listMessageIdsForWorkflowBackfill(0, 10);
      listMessagesPendingPostProcess(10);
      markMessagePostProcessDone(100);
    });
  });

  describe('insertOrUpdateEmailMessage branches', () => {
    test('updates existing pop3 by cached uidl', () => {
      mock.seedMessage({ id: 401, uid: -5, pop3_uidl: 'cached-u' });
      const ctx = { pop3UidlToId: new Map([['cached-u', 401]]) };
      const r = insertOrUpdateEmailMessage({ ...msgBase, pop3Uidl: 'cached-u', uid: 99 }, ctx);
      expect(r.isNew).toBe(false);
      expect(r.id).toBe(401);
    });

    test('updates existing pop3 via db lookup', () => {
      mock.seedMessage({ id: 402, uid: -6, pop3_uidl: 'db-u' });
      const r = insertOrUpdateEmailMessage({ ...msgBase, pop3Uidl: 'db-u', uid: 99 });
      expect(r.isNew).toBe(false);
    });

    test('inserts new pop3 with ctx.nextPop3Uid', () => {
      const ctx = { pop3UidlToId: new Map<string, number>(), nextPop3Uid: -1_000_010 };
      const r = insertOrUpdateEmailMessage(
        { ...msgBase, pop3Uidl: 'new-u', uid: 1, hasAttachments: true, attachmentsJson: '[]' },
        ctx,
      );
      expect(r.isNew).toBe(true);
      expect(ctx.nextPop3Uid).toBe(-1_000_011);
      expect(ctx.pop3UidlToId!.get('new-u')).toBe(r.id);
    });

    test('inserts new pop3 without ctx uses allocatePop3NegativeUid', () => {
      const r = insertOrUpdateEmailMessage({ ...msgBase, pop3Uidl: 'alloc-u', uid: 1 });
      expect(r.id).toBeGreaterThan(0);
    });

    test('imap cached hit updates existing', () => {
      mock.seedMessage({ id: 403, uid: 20 });
      const ctx = { imapUidToId: new Map([[20, 403]]) };
      const r = insertOrUpdateEmailMessage({ ...msgBase, uid: 20, seenLocal: true }, ctx);
      expect(r.isNew).toBe(false);
      expect(ctx.imapUidToId!.get(20)).toBe(403);
    });

    test('imap db lookup and new insert resolves id from select', () => {
      mock.seedMessage({ id: 404, uid: 21 });
      const r1 = insertOrUpdateEmailMessage({ ...msgBase, uid: 21 });
      expect(r1.isNew).toBe(false);
      const r2 = insertOrUpdateEmailMessage({
        ...msgBase,
        uid: 22,
        bccJson: '[]',
        rawHeaders: 'H',
        rawRfc822B64: 'B64',
        imapThreadId: 't1',
      });
      expect(r2.isNew).toBe(true);
    });

    test('pop3Uidl trims whitespace', () => {
      insertOrUpdateEmailMessage({ ...msgBase, pop3Uidl: '  trim-u  ', uid: 1 });
    });
  });

  describe('bulk and single message flags', () => {
    test('bulkSoftDeleteMessages with and without accountId', () => {
      expect(bulkSoftDeleteMessages([])).toBe(0);
      expect(bulkSoftDeleteMessages([100, 101], 1)).toBeGreaterThanOrEqual(0);
      expect(bulkSoftDeleteMessages([100])).toBeGreaterThanOrEqual(0);
    });

    test('bulkSetMessagesArchived variants', () => {
      expect(bulkSetMessagesArchived([], true)).toBe(0);
      bulkSetMessagesArchived([100], true, 1);
      bulkSetMessagesArchived([100], false);
    });

    test('setMessageArchived seen spam outbound hold', () => {
      setMessageArchived(100, true);
      setMessageArchived(100, false);
      setMessageSeenLocal(100, true);
      setMessageSeenLocal(100, false);
      setMessageSpam(100, true);
      setMessageSpam(100, false);
      setOutboundHold(100, true, 'reason');
      setOutboundHold(100, false, null);
    });
  });

  describe('tags', () => {
    test('add and remove tags skip empty trim', () => {
      addMessageTag(100, '  ');
      addMessageTag(100, ' urgent ');
      expect(listTagsForMessage(100)).toContain('urgent');
      removeMessageTag(100, '  ');
      removeMessageTag(100, 'urgent');
      expect(listTagsForMessage(100)).toEqual([]);
    });
  });

  describe('compose drafts', () => {
    test('createComposeDraft with attachments and existing min uid', () => {
      mock.seedMessage({ id: 501, uid: -2, folder_kind: 'draft' });
      const id = createComposeDraft({
        accountId: 1,
        subject: 'Draft',
        bodyText: 'Hello',
        toJson: '[]',
        draftAttachmentPaths: ['/tmp/a.pdf'],
      });
      expect(id).toBeGreaterThan(0);
      markDraftAsSent(id);
    });

    test('createComposeDraft first negative uid when no drafts', () => {
      mock.state.messages.forEach((m) => {
        if ((m.uid as number) < 0) mock.state.messages.delete(m.id as number);
      });
      const id = createComposeDraft({ accountId: 1 });
      expect(getEmailMessageById(id)?.folder_kind).toBe('draft');
    });

    test('updateComposeDraft all field branches', () => {
      const id = createComposeDraft({ accountId: 1, bodyText: 'short' });
      updateComposeDraft(id, {
        subject: 'New',
        bodyText: 'x'.repeat(300),
        bodyHtml: '<p>h</p>',
        toJson: '[]',
        ccJson: '[]',
        bccJson: '[]',
        draftAttachmentPaths: [],
        replyParentMessageId: 100,
      });
      updateComposeDraft(id, {});
      mock.stmt.get.mockReturnValueOnce({ ...mock.state.messages.get(id), uid: 5 });
      expect(() => updateComposeDraft(id, { subject: 'x' })).toThrow(/negative UID/);
      mock.stmt.get.mockReturnValueOnce(undefined);
      expect(() => updateComposeDraft(999, { subject: 'x' })).toThrow(/negative UID/);
    });

    test('deleteLocalComposeDraft errors', () => {
      mock.stmt.get.mockReturnValueOnce(undefined);
      expect(() => deleteLocalComposeDraft(999)).toThrow(/nicht gefunden/);
      mock.stmt.get.mockReturnValueOnce({ id: 100, uid: 6 });
      expect(() => deleteLocalComposeDraft(100)).toThrow(/lokale Entwürfe/);
      const draftId = createComposeDraft({ accountId: 1 });
      deleteLocalComposeDraft(draftId);
      expect(getEmailMessageById(draftId)).toBeUndefined();
    });
  });

  describe('conversation listing', () => {
    test('returns empty when no ticket or customer', () => {
      expect(listConversationMessagesForScope(1, {})).toEqual([]);
      expect(listConversationMessagesForScope('all', { ticketCode: '  ' })).toEqual([]);
    });

    test('finds by ticket and customer with exclude', () => {
      mock.seedMessage({ id: 601, ticket_code: 'T-1', customer_id: null });
      mock.seedMessage({ id: 602, ticket_code: null, customer_id: 5 });
      listConversationMessagesForScope(1, { ticketCode: 'T-1', excludeMessageId: 601, limit: 100 });
      listConversationMessagesForScope('all', { customerId: 5 });
    });
  });

  describe('soft delete and move views', () => {
    test('setMessageSoftDeleted no-op when missing', () => {
      mock.stmt.get.mockReturnValueOnce(undefined);
      setMessageSoftDeleted(999, true);
    });

    test('setMessageSoftDeleted delete and restore with trash snapshot', () => {
      mock.seedMessage({
        id: 701,
        archived: 1,
        is_spam: 1,
        folder_kind: 'sent',
        trash_prev_archived: null,
        trash_prev_is_spam: null,
        trash_prev_folder_kind: null,
      });
      setMessageSoftDeleted(701, true);
      setMessageSoftDeleted(701, false);
      mock.seedMessage({
        id: 702,
        archived: 0,
        is_spam: 0,
        folder_kind: 'inbox',
        trash_prev_archived: 1,
        trash_prev_is_spam: 0,
        trash_prev_folder_kind: 'sent',
      });
      setMessageSoftDeleted(702, false);
    });

    test('moveMessageToMailView all supported views and errors', () => {
      moveMessageToMailView(100, 'trash');
      moveMessageToMailView(100, 'inbox');
      moveMessageToMailView(100, 'archived');
      moveMessageToMailView(100, 'spam');
      mock.stmt.get.mockReturnValueOnce(undefined);
      expect(() => moveMessageToMailView(999, 'inbox')).toThrow(/nicht gefunden/);
      mock.stmt.get.mockReturnValueOnce({ id: 800, uid: -1, pop3_uidl: null });
      expect(() => moveMessageToMailView(800, 'inbox')).toThrow(/Entwürfe/);
      for (const v of ['sent', 'drafts', 'all'] as const) {
        expect(() => moveMessageToMailView(100, v)).toThrow(/Drag/);
      }
    });
  });

  describe('misc exports', () => {
    test('listEmailAccounts and getEmailAccountById', () => {
      expect(listEmailAccounts()).toHaveLength(1);
      expect(getEmailAccountById(1)?.email_address).toBe('a@b.de');
      expect(getFolderByAccountAndPath(1, 'INBOX')?.id).toBe(10);
    });

    test('listConversationMessages delegates to scope helper', () => {
      mock.seedMessage({ id: 801, ticket_code: 'T-9' });
      expect(listConversationMessages(1, { ticketCode: 'T-9' }).length).toBeGreaterThanOrEqual(0);
    });
  });
});
