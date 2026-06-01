import { MAX_EMAIL_CATEGORY_DEPTH } from '../../shared/email-constants';
import { createSqliteCrmStoreMock } from './helpers/sqlite-crm-store-mock';

const mock = createSqliteCrmStoreMock();
jest.mock('../../electron/sqlite-service', () => ({ getDb: () => mock.db }));

import {
  addInternalNote,
  assignCategoryPathToMessage,
  backfillCustomerLinksForMessages,
  clearMessageCategory,
  createAiPrompt,
  createCannedResponse,
  createCategory,
  deleteAiPrompt,
  deleteCannedResponse,
  deleteCategory,
  deleteInternalNote,
  ensureCategoryPath,
  getMessageCategoryId,
  listAiPrompts,
  listCannedResponses,
  listCategories,
  listCategoryCountsForAccount,
  listCategoryCountsForAllAccounts,
  listCategoryCountsForMailScope,
  listInternalNotes,
  moveAiPrompt,
  searchMessagesForAccount,
  searchMessagesForAccountWithMeta,
  searchMessagesForAllAccounts,
  searchMessagesForMailScope,
  searchMessagesForMailScopeWithMeta,
  seedEmailCrmDefaults,
  setMessageCategory,
  setMessageCustomerId,
  tryLinkMessageToCustomer,
  updateAiPrompt,
  updateCannedResponse,
  updateCategory,
  reorderCategories,
  updateInternalNote,
} from '../../electron/email/email-crm-store';

describe('email-crm-store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mock.reset();
  });

  describe('seedEmailCrmDefaults', () => {
    test('seeds canned responses and ai prompts when empty', () => {
      seedEmailCrmDefaults();
      expect(mock.cannedResponses).toHaveLength(1);
      expect(mock.aiPrompts.length).toBeGreaterThanOrEqual(2);
    });

    test('adds reply prompt when prompts exist but none target reply', () => {
      mock.setPromptCount(1);
      mock.setReplyPromptCount(0);
      mock.setMaxPromptSort(3);
      seedEmailCrmDefaults();
      expect(mock.aiPrompts.some((p) => p.target === 'reply')).toBe(true);
    });

    test('skips seed when data already present', () => {
      mock.setCannedCount(2);
      mock.setPromptCount(2);
      mock.setReplyPromptCount(1);
      seedEmailCrmDefaults();
      expect(mock.cannedResponses).toHaveLength(0);
    });
  });

  describe('categories', () => {
    test('listCategories calls seed and returns rows', () => {
      mock.addCategory({ id: 1, parent_id: null, name: 'Root', sort_order: 0 });
      expect(listCategories()).toHaveLength(1);
    });

    test('createCategory trims name and returns id', () => {
      const id = createCategory('  Sales  ');
      expect(id).toBe(1);
      expect(mock.categories[0]?.name).toBe('Sales');
    });

    test('ensureCategoryPath creates hierarchy', () => {
      const leaf = ensureCategoryPath('A/B/C');
      expect(leaf).toBe(3);
      expect(mock.categories).toHaveLength(3);
    });

    test('ensureCategoryPath reuses existing categories', () => {
      mock.addCategory({ id: 5, parent_id: null, name: 'A', sort_order: 0 });
      const id = ensureCategoryPath('A/B');
      expect(id).toBeGreaterThan(5);
    });

    test('ensureCategoryPath rejects empty path', () => {
      expect(() => ensureCategoryPath('  /  ')).toThrow(/Leerer Kategoriepfad/);
    });

    test('ensureCategoryPath rejects too deep path', () => {
      const deep = Array(MAX_EMAIL_CATEGORY_DEPTH + 1).fill('x').join('/');
      expect(() => ensureCategoryPath(deep)).toThrow(/zu tief/);
    });

    test('message category assign get clear', () => {
      setMessageCategory(10, 2);
      expect(getMessageCategoryId(10)).toBe(2);
      assignCategoryPathToMessage(11, 'Support/Tickets');
      expect(getMessageCategoryId(11)).toBe(2);
      clearMessageCategory(10);
      expect(getMessageCategoryId(10)).toBeNull();
    });

    test('listCategoryCountsForMailScope routes all vs account', () => {
      expect(listCategoryCountsForMailScope('all')).toEqual([{ categoryId: 1, count: 3 }]);
      expect(listCategoryCountsForMailScope(1)).toEqual([{ categoryId: 1, count: 3 }]);
      expect(listCategoryCountsForAllAccounts()).toEqual([{ categoryId: 1, count: 3 }]);
      expect(listCategoryCountsForAccount(1)).toEqual([{ categoryId: 1, count: 3 }]);
    });

    test('listCategoryCounts filters open active inbox messages only', () => {
      listCategoryCountsForAllAccounts();
      const allSql = mock.db.prepare.mock.calls.at(-1)?.[0] as string;
      expect(allSql).toContain('done_local');
      expect(allSql).toContain('snoozed_until');

      listCategoryCountsForAccount(1);
      const accountSql = mock.db.prepare.mock.calls.at(-1)?.[0] as string;
      expect(accountSql).toContain('done_local');
      expect(accountSql).toContain('snoozed_until');
    });

    test('updateCategory validates and updates fields', () => {
      mock.addCategory({ id: 1, parent_id: null, name: 'Old', sort_order: 0 });
      updateCategory(1, { name: 'New', parentId: null, sortOrder: 5 });
      expect(mock.categories[0]?.name).toBe('New');
      expect(() => updateCategory(99, { name: 'X' })).toThrow(/nicht gefunden/);
      expect(() => updateCategory(1, { name: '  ' })).toThrow(/Name darf nicht leer/);
      expect(() => updateCategory(1, { parentId: 1 })).toThrow(/sich selbst/);
      updateCategory(1, {});
      expect(mock.db.prepare).toHaveBeenCalled();
    });

    test('reorderCategories batch updates parent and sort order', () => {
      mock.addCategory({ id: 1, parent_id: null, name: 'A', sort_order: 0 });
      mock.addCategory({ id: 2, parent_id: null, name: 'B', sort_order: 1 });
      reorderCategories([
        { id: 2, parentId: 1, sortOrder: 0 },
        { id: 1, parentId: null, sortOrder: 0 },
      ]);
      expect(mock.categories.find((c) => c.id === 2)?.parent_id).toBe(1);
      expect(mock.categories.find((c) => c.id === 2)?.sort_order).toBe(0);
    });

    test('deleteCategory requires no children', () => {
      mock.addCategory({ id: 1, parent_id: null, name: 'P', sort_order: 0 });
      mock.addCategory({ id: 2, parent_id: 1, name: 'C', sort_order: 0 });
      expect(() => deleteCategory(1)).toThrow(/Unterkategorien/);
      deleteCategory(2);
      deleteCategory(1);
      expect(mock.categories).toHaveLength(0);
    });
  });

  describe('internal notes', () => {
    test('crud lifecycle', () => {
      addInternalNote(1, '  note  ');
      expect(listInternalNotes(1)[0]?.body).toBe('note');
      const noteId = listInternalNotes(1)[0]!.id;
      updateInternalNote(noteId, 'updated');
      expect(listInternalNotes(1)[0]?.body).toBe('updated');
      expect(() => updateInternalNote(noteId, '   ')).toThrow(/leer/);
      deleteInternalNote(noteId);
      expect(listInternalNotes(1)).toHaveLength(0);
    });
  });

  describe('canned responses', () => {
    test('list create update delete', () => {
      expect(listCannedResponses()).toEqual([]);
      const id = createCannedResponse(' Title ', 'body');
      expect(id).toBe(1);
      updateCannedResponse(id, 'T2', 'B2');
      deleteCannedResponse(id);
      expect(mock.db.prepare).toHaveBeenCalled();
    });
  });

  describe('ai prompts', () => {
    test('create list update delete and reorder', () => {
      const id1 = createAiPrompt({ label: 'A', userTemplate: 'a', target: 'full_body' });
      createAiPrompt({ label: 'B', userTemplate: 'b', profileId: 0 });
      expect(listAiPrompts()).toHaveLength(2);
      updateAiPrompt(id1, { label: 'A2', userTemplate: 'a2', target: 'reply', profileId: 3, sortOrder: 9 });
      deleteAiPrompt(id1);
      mock.aiPrompts.length = 0;
      mock.aiPrompts.push(
        { id: 10, label: 'X', user_template: 'x', target: 'full_body', profile_id: null, sort_order: 0 },
        { id: 11, label: 'Y', user_template: 'y', target: 'full_body', profile_id: null, sort_order: 1 },
      );
      expect(moveAiPrompt(10, 'up')).toBe(false);
      expect(moveAiPrompt(11, 'down')).toBe(false);
      expect(moveAiPrompt(10, 'down')).toBe(true);
      expect(moveAiPrompt(999, 'up')).toBe(false);
      updateAiPrompt(11, {});
    });
  });

  describe('customer linking', () => {
    test('buildCustomerEmailMap via tryLink and backfill', () => {
      mock.customers.push({ id: 7, email: 'User@Test.COM' });
      mock.addMessage({
        id: 50,
        from_json: JSON.stringify({ value: [{ address: 'user@test.com' }] }),
        customer_id: null,
      });
      mock.addMessage({
        id: 51,
        from_json: 'bad-json',
        customer_id: null,
      });
      mock.addMessage({
        id: 52,
        from_json: JSON.stringify({ value: [{ address: '' }] }),
        customer_id: null,
      });
      mock.addMessage({
        id: 53,
        from_json: JSON.stringify({ value: [{ address: 'unknown@test.com' }] }),
        customer_id: null,
      });
      mock.addMessage({
        id: 54,
        from_json: JSON.stringify({ value: [{ address: 'x@test.com' }] }),
        customer_id: 99,
      });

      mock.addMessage({
        id: 55,
        from_json: JSON.stringify({ value: [{ address: 'user@test.com' }] }),
        customer_id: null,
      });

      expect(tryLinkMessageToCustomer(50)).toBe(7);
      expect(tryLinkMessageToCustomer(55, new Map([['user@test.com', 7]]))).toBe(7);
      expect(tryLinkMessageToCustomer(51)).toBeNull();
      expect(tryLinkMessageToCustomer(52)).toBeNull();
      expect(tryLinkMessageToCustomer(53)).toBeNull();
      expect(tryLinkMessageToCustomer(54)).toBe(99);
      expect(tryLinkMessageToCustomer(999)).toBeNull();

      const linked = backfillCustomerLinksForMessages({ accountId: 1, limit: 10 });
      expect(linked).toBeGreaterThanOrEqual(0);
      setMessageCustomerId(50, null);
    });
  });

  describe('message search', () => {
    test('searchMessagesForAccountWithMeta empty query', () => {
      const r = searchMessagesForAccountWithMeta(1, '   ');
      expect(r).toEqual({ rows: [], searchMode: 'like', hasMore: false });
    });

    test('regex search filters rows', () => {
      mock.setFtsTableExists(false);
      const r = searchMessagesForAccountWithMeta(1, '/^Test subject$/i', { limit: 10 });
      expect(r.searchMode).toBe('regex');
      expect(r.rows).toEqual([]);
    });

    test('fts hasMore when extra row returned', () => {
      mock.setFtsTableExists(true);
      mock.setFtsThrows(false);
      const origAll = mock.stmt.all.getMockImplementation();
      mock.stmt.all.mockImplementation((...args: unknown[]) => {
        if (mock.stmt.all.mock.calls.at(-1)) {
          const sql = (mock.db.prepare.mock.calls.at(-1)?.[0] as string) ?? '';
          if (sql.includes('fts MATCH')) {
            return [{ id: 1 }, { id: 2 }];
          }
        }
        return origAll?.(...args) ?? [];
      });
      const r = searchMessagesForAccountWithMeta(1, 'hello', { limit: 1 });
      expect(r.searchMode).toBe('fts');
      expect(r.hasMore).toBe(true);
    });

    test('invalid regex falls back to like', () => {
      const r = searchMessagesForAccountWithMeta(1, '/[/i');
      expect(r.searchMode).toBe('like');
    });

    test('fts search when table exists', () => {
      mock.setFtsTableExists(true);
      const r = searchMessagesForAccountWithMeta(1, 'hello world');
      expect(r.searchMode).toBe('fts');
    });

    test('fts error falls back to like', () => {
      mock.setFtsTableExists(true);
      mock.setFtsThrows(true);
      const r = searchMessagesForAccountWithMeta(1, 'hello');
      expect(r.searchMode).toBe('like');
    });

    test('search with view and category filters', () => {
      mock.setFtsTableExists(false);
      mock.setFtsThrows(false);
      for (const view of ['inbox', 'trash', 'archived', 'spam', 'sent', 'drafts'] as const) {
        searchMessagesForAccount(1, 'term', { limit: 5, view, categoryId: 2 });
      }
      searchMessagesForAccount(1, 'term', { limit: 5, view: 'inbox' as import('../../electron/email/email-store').AccountMailView });
      searchMessagesForAccount(1, 'term', { limit: 5, view: 'other' as import('../../electron/email/email-store').AccountMailView });
      searchMessagesForAccount(1, 'term', 10, 'inbox');
      searchMessagesForAllAccounts('query', { limit: 5, view: 'inbox', categoryId: 1 });
      mock.setFtsTableExists(true);
      searchMessagesForAllAccounts('query fts');
      mock.setFtsThrows(true);
      searchMessagesForAllAccounts('query fts');
      mock.setFtsThrows(false);
      mock.setFtsTableExists(true);
      searchMessagesForAccount(1, 'hello fts');
    });

    test('mail scope wrappers', () => {
      const scoped = searchMessagesForMailScopeWithMeta(1, 'x');
      expect(scoped.rows).toBeDefined();
      const all = searchMessagesForMailScopeWithMeta('all', 'x', { limit: 5 });
      expect(all.hasMore).toBe(false);
      expect(searchMessagesForMailScope('all', '   ', 5, 'inbox')).toEqual([]);
      searchMessagesForMailScope('all', 'hello', 5, 'inbox');
    });
  });
});
