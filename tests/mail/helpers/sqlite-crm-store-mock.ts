/** SQLite mock with SQL-aware handlers for email-crm-store tests. */
import { createSqliteMock, type StmtMock } from './sqlite-mock';

export type SqliteCrmStoreMock = ReturnType<typeof createSqliteCrmStoreMock>;

export function createSqliteCrmStoreMock() {
  const base = createSqliteMock();
  const { db, stmt } = base;
  let lastSql = '';

  let cannedCount = 0;
  let promptCount = 0;
  let replyPromptCount = 0;
  let maxPromptSort = -1;

  type CategoryRow = { id: number; parent_id: number | null; name: string; sort_order: number; created_at: string };
  const categories: CategoryRow[] = [];
  let nextCategoryId = 1;

  const messageCategories = new Map<number, number>();
  const internalNotes: { id: number; message_id: number; body: string; created_at: string }[] = [];
  let nextNoteId = 1;

  const cannedResponses: { id: number; title: string; body: string; sort_order: number }[] = [];
  let nextCannedId = 1;

  const aiPrompts: {
    id: number;
    label: string;
    user_template: string;
    target: string;
    profile_id: number | null;
    sort_order: number;
  }[] = [];
  let nextPromptId = 1;

  const customers: { id: number; email: string }[] = [];
  const messages: Record<string, unknown>[] = [];

  let ftsTableExists = false;
  let ftsThrows = false;

  function routeGet(...args: unknown[]): unknown {
    if (lastSql.includes('COUNT(*)') && lastSql.includes('email_canned_responses')) {
      return { n: cannedCount };
    }
    if (lastSql.includes('COUNT(*)') && lastSql.includes("target = 'reply'")) {
      return { n: replyPromptCount };
    }
    if (lastSql.includes('COUNT(*)') && lastSql.includes('email_ai_prompts')) {
      return { n: promptCount };
    }
    if (lastSql.includes('COALESCE(MAX(sort_order)')) {
      return { m: maxPromptSort };
    }
    if (lastSql.includes('sqlite_master')) {
      return ftsTableExists ? { name: 'email_messages_fts' } : undefined;
    }
    if (lastSql.includes('email_categories') && lastSql.includes('WHERE name =')) {
      const name = args[0] as string;
      const parentId = args[1] as number | null;
      const row = categories.find(
        (c) =>
          c.name === name &&
          ((c.parent_id == null && parentId == null) || c.parent_id === parentId),
      );
      return row ? { id: row.id } : undefined;
    }
    if (lastSql.includes('email_categories') && lastSql.includes('WHERE id =')) {
      const id = args[0] as number;
      const row = categories.find((c) => c.id === id);
      return row ? { id: row.id, parent_id: row.parent_id } : undefined;
    }
    if (lastSql.includes('email_categories') && lastSql.includes('parent_id = ?')) {
      const parentId = args[0] as number;
      const child = categories.find((c) => c.parent_id === parentId);
      return child ? { id: child.id } : undefined;
    }
    if (lastSql.includes('email_message_categories') && lastSql.includes('category_id')) {
      const messageId = args[0] as number;
      const catId = messageCategories.get(messageId);
      return catId != null ? { category_id: catId } : undefined;
    }
    if (lastSql.includes('email_messages') && lastSql.includes('from_json')) {
      const messageId = args[0] as number;
      const msg = messages.find((m) => m.id === messageId);
      return msg ?? undefined;
    }
    return undefined;
  }

  function routeAll(...args: unknown[]): unknown[] {
    if (lastSql.includes('email_categories') && lastSql.includes('SELECT *')) {
      return [...categories].sort(
        (a, b) =>
          (a.parent_id == null ? 0 : 1) - (b.parent_id == null ? 0 : 1) ||
          a.sort_order - b.sort_order ||
          a.name.localeCompare(b.name),
      );
    }
    if (lastSql.includes('email_internal_notes')) {
      const messageId = args[0] as number;
      return internalNotes.filter((n) => n.message_id === messageId);
    }
    if (lastSql.includes('email_canned_responses')) return [...cannedResponses];
    if (lastSql.includes('email_ai_prompts') && lastSql.includes('SELECT *')) {
      return [...aiPrompts].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    }
    if (lastSql.includes('customers') || lastSql.includes('CUSTOMERS')) return customers;
    if (lastSql.includes('GROUP BY mc.category_id')) {
      return [{ categoryId: 1, count: 3 }];
    }
    if (lastSql.includes('SELECT id FROM') && lastSql.includes('email_messages')) {
      return [{ id: 50 }, { id: 51 }];
    }
    if (lastSql.includes('email_messages') && lastSql.includes('SELECT m.*')) {
      if (ftsThrows && lastSql.includes('fts MATCH')) throw new Error('fts fail');
      return [
        {
          id: 100,
          account_id: args[0] ?? 1,
          subject: 'Test subject',
          snippet: 'snippet',
          body_text: 'body text',
          to_json: '[]',
          cc_json: '[]',
          ticket_code: null,
        },
      ];
    }
    return [];
  }

  function routeRun(...args: unknown[]): { changes: number; lastInsertRowid: number } {
    if (lastSql.includes('INSERT INTO email_categories')) {
      const parentId = args[0] as number | null;
      const name = args[1] as string;
      const id = nextCategoryId++;
      categories.push({
        id,
        parent_id: parentId,
        name,
        sort_order: (args[2] as number) ?? 0,
        created_at: 't',
      });
      return { changes: 1, lastInsertRowid: id };
    }
    if (lastSql.includes('INSERT INTO email_message_categories')) {
      messageCategories.set(args[0] as number, args[1] as number);
      return { changes: 1, lastInsertRowid: 1 };
    }
    if (lastSql.includes('DELETE FROM email_message_categories')) {
      messageCategories.delete(args[0] as number);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('INSERT INTO email_internal_notes')) {
      const id = nextNoteId++;
      internalNotes.push({
        id,
        message_id: args[0] as number,
        body: args[1] as string,
        created_at: 't',
      });
      return { changes: 1, lastInsertRowid: id };
    }
    if (lastSql.includes('UPDATE email_internal_notes')) {
      const note = internalNotes.find((n) => n.id === args[1]);
      if (note) note.body = args[0] as string;
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('DELETE FROM email_internal_notes')) {
      const idx = internalNotes.findIndex((n) => n.id === args[0]);
      if (idx >= 0) internalNotes.splice(idx, 1);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('INSERT INTO email_canned_responses')) {
      cannedCount += 1;
      const id = nextCannedId++;
      cannedResponses.push({
        id,
        title: args[0] as string,
        body: args[1] as string,
        sort_order: args[2] as number,
      });
      return { changes: 1, lastInsertRowid: id };
    }
    if (lastSql.includes('INSERT INTO email_ai_prompts')) {
      promptCount += 1;
      const target = args[2] as string;
      if (target === 'reply') replyPromptCount += 1;
      const sortOrder = args[4] as number;
      maxPromptSort = Math.max(maxPromptSort, sortOrder);
      const id = nextPromptId++;
      aiPrompts.push({
        id,
        label: args[0] as string,
        user_template: args[1] as string,
        target,
        profile_id: (args[3] as number | null) ?? null,
        sort_order: sortOrder,
      });
      return { changes: 1, lastInsertRowid: id };
    }
    if (lastSql.includes('UPDATE email_ai_prompts') && lastSql.includes('sort_order')) {
      const row = aiPrompts.find((p) => p.id === args[1]);
      if (row) row.sort_order = args[0] as number;
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('UPDATE email_messages') && lastSql.includes('customer_id')) {
      const msg = messages.find((m) => m.id === args[1]);
      if (msg) msg.customer_id = args[0];
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('UPDATE email_categories')) {
      const id = args[args.length - 1] as number;
      const row = categories.find((c) => c.id === id);
      if (row && lastSql.includes('name =')) row.name = args[0] as string;
      if (row && lastSql.includes('parent_id =')) row.parent_id = args[0] as number | null;
      if (row && lastSql.includes('sort_order =')) row.sort_order = args[0] as number;
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('DELETE FROM email_categories')) {
      const idx = categories.findIndex((c) => c.id === args[0]);
      if (idx >= 0) categories.splice(idx, 1);
      return { changes: 1, lastInsertRowid: 0 };
    }
    return { changes: 1, lastInsertRowid: 101 };
  }

  db.prepare.mockImplementation((sql: string) => {
    lastSql = sql;
    return stmt;
  });
  stmt.get.mockImplementation((...args: unknown[]) => routeGet(...args));
  stmt.all.mockImplementation((...args: unknown[]) => routeAll(...args));
  stmt.run.mockImplementation((...args: unknown[]) => routeRun(...args));

  return {
    ...base,
    categories,
    cannedResponses,
    aiPrompts,
    customers,
    messages,
    setCannedCount: (n: number) => {
      cannedCount = n;
    },
    setPromptCount: (n: number) => {
      promptCount = n;
    },
    setReplyPromptCount: (n: number) => {
      replyPromptCount = n;
    },
    setMaxPromptSort: (n: number) => {
      maxPromptSort = n;
    },
    setFtsTableExists: (v: boolean) => {
      ftsTableExists = v;
    },
    setFtsThrows: (v: boolean) => {
      ftsThrows = v;
    },
    addCategory: (row: Omit<CategoryRow, 'created_at'> & { created_at?: string }) => {
      categories.push({ ...row, created_at: row.created_at ?? 't' });
      nextCategoryId = Math.max(nextCategoryId, row.id + 1);
    },
    addMessage: (row: Record<string, unknown>) => {
      messages.push(row);
    },
    reset: () => {
      cannedCount = 0;
      promptCount = 0;
      replyPromptCount = 0;
      maxPromptSort = -1;
      categories.length = 0;
      messageCategories.clear();
      internalNotes.length = 0;
      cannedResponses.length = 0;
      aiPrompts.length = 0;
      customers.length = 0;
      messages.length = 0;
      ftsTableExists = false;
      ftsThrows = false;
      nextCategoryId = 1;
      nextNoteId = 1;
      nextCannedId = 1;
      nextPromptId = 1;
      stmt.get.mockImplementation((...args: unknown[]) => routeGet(...args));
      stmt.all.mockImplementation((...args: unknown[]) => routeAll(...args));
      stmt.run.mockImplementation((...args: unknown[]) => routeRun(...args));
    },
    resetStmt: (overrides?: Partial<StmtMock>) => {
      Object.assign(stmt, overrides);
    },
  };
}
