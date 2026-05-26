import { MAX_EMAIL_CATEGORY_DEPTH } from '../../shared/email-constants';
import { normalizeEmailAddress } from '../../shared/email-address-normalize';
import { SNOOZE_FILTER_SQL } from './email-message-features';
import { doneFilterSql, type MessageDoneFilter } from '../../shared/email-done-filter';
import { getDb } from '../sqlite-service';
import {
  CUSTOMERS_TABLE,
  EMAIL_CATEGORIES_TABLE,
  EMAIL_MESSAGE_CATEGORIES_TABLE,
  EMAIL_INTERNAL_NOTES_TABLE,
  EMAIL_CANNED_RESPONSES_TABLE,
  EMAIL_AI_PROMPTS_TABLE,
  EMAIL_MESSAGES_TABLE,
  EMAIL_FOLDERS_TABLE,
  EMAIL_MESSAGES_FTS_TABLE,
} from '../database-schema';

export type EmailCategoryRow = {
  id: number;
  parent_id: number | null;
  name: string;
  sort_order: number;
  created_at: string;
};

export function seedEmailCrmDefaults(): void {
  const c = getDb().prepare(`SELECT COUNT(*) as n FROM ${EMAIL_CANNED_RESPONSES_TABLE}`).get() as { n: number };
  if (c.n === 0) {
    getDb()
      .prepare(`INSERT INTO ${EMAIL_CANNED_RESPONSES_TABLE} (title, body, sort_order) VALUES (?, ?, ?)`)
      .run(
        'Begrüßung',
        'Guten Tag {{customer.name}},\n\nvielen Dank für Ihre Nachricht.\n\nMit freundlichen Grüßen',
        0,
      );
  }
  const p = getDb().prepare(`SELECT COUNT(*) as n FROM ${EMAIL_AI_PROMPTS_TABLE}`).get() as { n: number };
  if (p.n === 0) {
    getDb()
      .prepare(`INSERT INTO ${EMAIL_AI_PROMPTS_TABLE} (label, user_template, target, sort_order) VALUES (?, ?, ?, ?)`)
      .run('Höflicher formulieren', 'Formuliere den folgenden Text höflich und professionell auf Deutsch:\n\n{{text}}', 'full_body', 0);
    getDb()
      .prepare(`INSERT INTO ${EMAIL_AI_PROMPTS_TABLE} (label, user_template, target, sort_order) VALUES (?, ?, ?, ?)`)
      .run(
        'Antwort entwerfen',
        'Schreibe eine professionelle Antwort auf Deutsch auf die folgende E-Mail.\nAntworte nur mit dem Antworttext (Begrüßung und Grußformel), ohne Betreffzeile und ohne das Original zitieren.\n\nVon: {{from}}\nBetreff: {{subject}}\n\n{{body}}',
        'reply',
        1,
      );
  } else {
    const replyCount = getDb()
      .prepare(`SELECT COUNT(*) as n FROM ${EMAIL_AI_PROMPTS_TABLE} WHERE target = 'reply'`)
      .get() as { n: number };
    if (replyCount.n === 0) {
      const maxRow = getDb()
        .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM ${EMAIL_AI_PROMPTS_TABLE}`)
        .get() as { m: number };
      getDb()
        .prepare(`INSERT INTO ${EMAIL_AI_PROMPTS_TABLE} (label, user_template, target, sort_order) VALUES (?, ?, ?, ?)`)
        .run(
          'Antwort entwerfen',
          'Schreibe eine professionelle Antwort auf Deutsch auf die folgende E-Mail.\nAntworte nur mit dem Antworttext (Begrüßung und Grußformel), ohne Betreffzeile und ohne das Original zitieren.\n\nVon: {{from}}\nBetreff: {{subject}}\n\n{{body}}',
          'reply',
          (maxRow?.m ?? -1) + 1,
        );
    }
  }
}

export function listCategories(): EmailCategoryRow[] {
  seedEmailCrmDefaults();
  return getDb()
    .prepare(`SELECT * FROM ${EMAIL_CATEGORIES_TABLE} ORDER BY parent_id IS NULL DESC, sort_order ASC, name ASC`)
    .all() as EmailCategoryRow[];
}

export function createCategory(name: string, parentId: number | null = null): number {
  const r = getDb()
    .prepare(`INSERT INTO ${EMAIL_CATEGORIES_TABLE} (parent_id, name, sort_order) VALUES (?, ?, ?)`)
    .run(parentId, name.trim(), 0);
  return Number(r.lastInsertRowid);
}

function findCategoryByNameUnderParent(name: string, parentId: number | null): number | null {
  const row = getDb()
    .prepare(
      `SELECT id FROM ${EMAIL_CATEGORIES_TABLE} WHERE name = ? AND (parent_id IS ? OR (parent_id IS NULL AND ? IS NULL))`,
    )
    .get(name, parentId, parentId) as { id: number } | undefined;
  return row?.id ?? null;
}

/** Path like "A/B/C" creates hierarchy and returns leaf id */
export function ensureCategoryPath(path: string): number {
  const parts = path.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error('Leerer Kategoriepfad');
  if (parts.length > MAX_EMAIL_CATEGORY_DEPTH) {
    throw new Error(`Kategoriepfad zu tief (max. ${MAX_EMAIL_CATEGORY_DEPTH} Ebenen)`);
  }
  let parentId: number | null = null;
  for (const part of parts) {
    let id = findCategoryByNameUnderParent(part, parentId);
    if (id == null) {
      id = createCategory(part, parentId);
    }
    parentId = id;
  }
  return parentId!;
}

export function setMessageCategory(messageId: number, categoryId: number): void {
  const d = getDb();
  d.prepare(`DELETE FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} WHERE message_id = ?`).run(messageId);
  d.prepare(
    `INSERT INTO ${EMAIL_MESSAGE_CATEGORIES_TABLE} (message_id, category_id) VALUES (?, ?)`,
  ).run(messageId, categoryId);
}

export function clearMessageCategory(messageId: number): void {
  getDb()
    .prepare(`DELETE FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} WHERE message_id = ?`)
    .run(messageId);
}

export function assignCategoryPathToMessage(messageId: number, path: string): void {
  const id = ensureCategoryPath(path);
  setMessageCategory(messageId, id);
}

export function getMessageCategoryId(messageId: number): number | null {
  const row = getDb()
    .prepare(`SELECT category_id FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} WHERE message_id = ?`)
    .get(messageId) as { category_id: number } | undefined;
  return row?.category_id ?? null;
}

export function listCategoryCountsForMailScope(
  accountScope: number | 'all',
): { categoryId: number; count: number }[] {
  if (accountScope === 'all') {
    return listCategoryCountsForAllAccounts();
  }
  return listCategoryCountsForAccount(accountScope);
}

/** Inbox messages per category summed across all accounts. */
export function listCategoryCountsForAllAccounts(): { categoryId: number; count: number }[] {
  return getDb()
    .prepare(
      `SELECT mc.category_id AS categoryId, COUNT(*) AS count
       FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} mc
       INNER JOIN ${EMAIL_MESSAGES_TABLE} m ON m.id = mc.message_id
       WHERE m.soft_deleted = 0
         AND (m.folder_kind = 'inbox' OR m.folder_kind IS NULL OR m.folder_kind = '')
         AND m.archived = 0 AND m.is_spam = 0
         AND (m.uid >= 0 OR m.pop3_uidl IS NOT NULL)
       GROUP BY mc.category_id`,
    )
    .all() as { categoryId: number; count: number }[];
}

export function listCategoryCountsForAccount(accountId: number): { categoryId: number; count: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT mc.category_id as categoryId, COUNT(DISTINCT mc.message_id) as count
       FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} mc
       INNER JOIN ${EMAIL_MESSAGES_TABLE} m ON m.id = mc.message_id
       WHERE m.account_id = ? AND m.soft_deleted = 0 AND m.archived = 0 AND m.is_spam = 0 AND (m.uid >= 0 OR m.pop3_uidl IS NOT NULL) AND m.folder_kind = 'inbox'
       GROUP BY mc.category_id`,
    )
    .all(accountId) as { categoryId: number; count: number }[];
  return rows;
}

export function addInternalNote(messageId: number, body: string): void {
  getDb()
    .prepare(`INSERT INTO ${EMAIL_INTERNAL_NOTES_TABLE} (message_id, body) VALUES (?, ?)`)
    .run(messageId, body.trim());
}

export function updateInternalNote(noteId: number, body: string): void {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Notiz darf nicht leer sein');
  getDb()
    .prepare(`UPDATE ${EMAIL_INTERNAL_NOTES_TABLE} SET body = ? WHERE id = ?`)
    .run(trimmed, noteId);
}

export function deleteInternalNote(noteId: number): void {
  getDb().prepare(`DELETE FROM ${EMAIL_INTERNAL_NOTES_TABLE} WHERE id = ?`).run(noteId);
}

export function listInternalNotes(messageId: number): { id: number; body: string; created_at: string }[] {
  return getDb()
    .prepare(
      `SELECT id, body, created_at FROM ${EMAIL_INTERNAL_NOTES_TABLE} WHERE message_id = ? ORDER BY id ASC`,
    )
    .all(messageId) as { id: number; body: string; created_at: string }[];
}

export function updateCategory(
  categoryId: number,
  input: { name?: string; parentId?: number | null; sortOrder?: number },
): void {
  const row = getDb()
    .prepare(`SELECT id, parent_id FROM ${EMAIL_CATEGORIES_TABLE} WHERE id = ?`)
    .get(categoryId) as { id: number; parent_id: number | null } | undefined;
  if (!row) throw new Error('Kategorie nicht gefunden');
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error('Name darf nicht leer sein');
    sets.push('name = ?');
    vals.push(name);
  }
  if (input.parentId !== undefined) {
    if (input.parentId === categoryId) throw new Error('Kategorie kann nicht sich selbst übergeordnet sein');
    sets.push('parent_id = ?');
    vals.push(input.parentId);
  }
  if (input.sortOrder !== undefined) {
    sets.push('sort_order = ?');
    vals.push(input.sortOrder);
  }
  if (sets.length === 0) return;
  vals.push(categoryId);
  getDb()
    .prepare(`UPDATE ${EMAIL_CATEGORIES_TABLE} SET ${sets.join(', ')} WHERE id = ?`)
    .run(...vals);
}

export function deleteCategory(categoryId: number): void {
  const child = getDb()
    .prepare(`SELECT id FROM ${EMAIL_CATEGORIES_TABLE} WHERE parent_id = ? LIMIT 1`)
    .get(categoryId) as { id: number } | undefined;
  if (child) throw new Error('Unterkategorien zuerst löschen');
  getDb().prepare(`DELETE FROM ${EMAIL_CATEGORIES_TABLE} WHERE id = ?`).run(categoryId);
}

export type CannedRow = { id: number; title: string; body: string; sort_order: number };
export function listCannedResponses(): CannedRow[] {
  return getDb()
    .prepare(`SELECT * FROM ${EMAIL_CANNED_RESPONSES_TABLE} ORDER BY sort_order ASC, id ASC`)
    .all() as CannedRow[];
}

export function createCannedResponse(title: string, body: string): number {
  const r = getDb()
    .prepare(`INSERT INTO ${EMAIL_CANNED_RESPONSES_TABLE} (title, body, sort_order) VALUES (?, ?, ?)`)
    .run(title.trim(), body, 0);
  return Number(r.lastInsertRowid);
}

export function updateCannedResponse(id: number, title: string, body: string): void {
  getDb().prepare(`UPDATE ${EMAIL_CANNED_RESPONSES_TABLE} SET title = ?, body = ? WHERE id = ?`).run(title, body, id);
}

export function deleteCannedResponse(id: number): void {
  getDb().prepare(`DELETE FROM ${EMAIL_CANNED_RESPONSES_TABLE} WHERE id = ?`).run(id);
}

export type AiPromptRow = {
  id: number;
  label: string;
  user_template: string;
  target: string;
  profile_id: number | null;
  sort_order: number;
};
export function listAiPrompts(): AiPromptRow[] {
  return getDb()
    .prepare(`SELECT * FROM ${EMAIL_AI_PROMPTS_TABLE} ORDER BY sort_order ASC, id ASC`)
    .all() as AiPromptRow[];
}

export function createAiPrompt(input: {
  label: string;
  userTemplate: string;
  target?: string;
  profileId?: number | null;
}): number {
  const maxRow = getDb()
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM ${EMAIL_AI_PROMPTS_TABLE}`)
    .get() as { m: number };
  const sortOrder = (maxRow?.m ?? -1) + 1;
  const profileId =
    input.profileId != null && input.profileId > 0 ? input.profileId : null;
  const r = getDb()
    .prepare(
      `INSERT INTO ${EMAIL_AI_PROMPTS_TABLE} (label, user_template, target, profile_id, sort_order) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.label.trim(),
      input.userTemplate,
      input.target ?? 'full_body',
      profileId,
      sortOrder,
    );
  return Number(r.lastInsertRowid);
}

/** Swap sort_order with neighbour (Composer dropdown order). */
export function moveAiPrompt(id: number, direction: 'up' | 'down'): boolean {
  const rows = listAiPrompts();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= rows.length) return false;
  const a = rows[idx]!;
  const b = rows[swapIdx]!;
  const aOrder = a.sort_order;
  const bOrder = b.sort_order;
  const db = getDb();
  db.prepare(`UPDATE ${EMAIL_AI_PROMPTS_TABLE} SET sort_order = ? WHERE id = ?`).run(
    bOrder,
    a.id,
  );
  db.prepare(`UPDATE ${EMAIL_AI_PROMPTS_TABLE} SET sort_order = ? WHERE id = ?`).run(
    aOrder,
    b.id,
  );
  return true;
}

export function updateAiPrompt(
  id: number,
  input: Partial<{
    label: string;
    userTemplate: string;
    target: string;
    profileId: number | null;
    sortOrder: number;
  }>,
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (input.label !== undefined) { sets.push('label = ?'); vals.push(input.label); }
  if (input.userTemplate !== undefined) { sets.push('user_template = ?'); vals.push(input.userTemplate); }
  if (input.target !== undefined) { sets.push('target = ?'); vals.push(input.target); }
  if (input.profileId !== undefined) {
    sets.push('profile_id = ?');
    vals.push(input.profileId != null && input.profileId > 0 ? input.profileId : null);
  }
  if (input.sortOrder !== undefined) { sets.push('sort_order = ?'); vals.push(input.sortOrder); }
  if (sets.length === 0) return;
  vals.push(id);
  getDb()
    .prepare(`UPDATE ${EMAIL_AI_PROMPTS_TABLE} SET ${sets.join(', ')} WHERE id = ?`)
    .run(...vals);
}

export function deleteAiPrompt(id: number): void {
  getDb().prepare(`DELETE FROM ${EMAIL_AI_PROMPTS_TABLE} WHERE id = ?`).run(id);
}

function findCustomerIdByEmailAddress(
  email: string,
  customerByEmail?: Map<string, number>,
): number | null {
  const norm = normalizeEmailAddress(email);
  if (!norm) return null;
  if (customerByEmail) {
    return customerByEmail.get(norm) ?? null;
  }
  const rows = getDb()
    .prepare(`SELECT id, email FROM ${CUSTOMERS_TABLE} WHERE email IS NOT NULL AND TRIM(email) != ''`)
    .all() as { id: number; email: string }[];
  for (const row of rows) {
    if (normalizeEmailAddress(row.email) === norm) return row.id;
  }
  return null;
}

/** Normalized email → customer id (one query per sync / backfill batch). */
export function buildCustomerEmailMap(): Map<string, number> {
  const rows = getDb()
    .prepare(`SELECT id, email FROM ${CUSTOMERS_TABLE} WHERE email IS NOT NULL AND TRIM(email) != ''`)
    .all() as { id: number; email: string }[];
  const map = new Map<string, number>();
  for (const row of rows) {
    const norm = normalizeEmailAddress(row.email);
    if (norm && !map.has(norm)) map.set(norm, row.id);
  }
  return map;
}

export function tryLinkMessageToCustomer(
  messageId: number,
  customerByEmail?: Map<string, number>,
): number | null {
  const msg = getDb()
    .prepare(`SELECT from_json, customer_id FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`)
    .get(messageId) as { from_json: string | null; customer_id: number | null } | undefined;
  if (!msg?.from_json || msg.customer_id != null) return msg?.customer_id ?? null;
  let email = '';
  try {
    const p = JSON.parse(msg.from_json) as { value?: { address?: string }[] };
    email = (p.value?.[0]?.address ?? '').trim();
  } catch {
    return null;
  }
  if (!email) return null;
  const custId = findCustomerIdByEmailAddress(email, customerByEmail);
  if (custId == null) return null;
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET customer_id = ? WHERE id = ?`)
    .run(custId, messageId);
  return custId;
}

/** Re-link inbox messages without customer_id (e.g. after new CRM contact). */
export function backfillCustomerLinksForMessages(opts?: {
  accountId?: number;
  limit?: number;
}): number {
  const limit = Math.min(opts?.limit ?? 500, 5000);
  let sql = `SELECT id FROM ${EMAIL_MESSAGES_TABLE}
    WHERE customer_id IS NULL AND soft_deleted = 0 AND (uid >= 0 OR pop3_uidl IS NOT NULL)
      AND ${SNOOZE_FILTER_SQL.replace(/m\./g, '')}`;
  const params: number[] = [];
  if (opts?.accountId != null) {
    sql += ` AND account_id = ?`;
    params.push(opts.accountId);
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(limit);
  const rows = getDb().prepare(sql).all(...params) as { id: number }[];
  const customerByEmail = buildCustomerEmailMap();
  let linked = 0;
  for (const r of rows) {
    if (tryLinkMessageToCustomer(r.id, customerByEmail) != null) linked += 1;
  }
  return linked;
}

export type MessageSearchMode = 'fts' | 'like' | 'regex';

export type MessageSearchOpts = {
  limit?: number;
  offset?: number;
  view?: import('./email-store').AccountMailView;
  categoryId?: number | null;
  doneFilter?: MessageDoneFilter;
};

function categoryJoinSql(categoryId: number | null | undefined): { sql: string; param?: number } {
  if (categoryId != null && categoryId > 0) {
    return {
      sql: ` INNER JOIN ${EMAIL_MESSAGE_CATEGORIES_TABLE} mc ON mc.message_id = m.id AND mc.category_id = ?`,
      param: categoryId,
    };
  }
  return { sql: '' };
}

const LIKE_SEARCH_FIELDS = `(
         m.subject LIKE ? ESCAPE '\\' OR m.snippet LIKE ? ESCAPE '\\' OR m.body_text LIKE ? ESCAPE '\\'
         OR m.to_json LIKE ? ESCAPE '\\' OR m.cc_json LIKE ? ESCAPE '\\' OR m.bcc_json LIKE ? ESCAPE '\\'
         OR m.ticket_code LIKE ? ESCAPE '\\'
       )`;

export function searchMessagesForAccountWithMeta(
  accountId: number,
  q: string,
  opts: MessageSearchOpts = {},
): {
  rows: import('./email-store').EmailMessageRow[];
  searchMode: MessageSearchMode;
  hasMore: boolean;
} {
  const limit = opts.limit ?? 80;
  const offset = opts.offset ?? 0;
  const view = opts.view;
  const trimmed = q.trim();
  if (!trimmed) {
    return { rows: [], searchMode: 'like', hasMore: false };
  }
  if (trimmed.startsWith('/') && trimmed.length > 2 && trimmed.lastIndexOf('/') > 0) {
    const lastSlash = trimmed.lastIndexOf('/');
    const pattern = trimmed.slice(1, lastSlash);
    const flags = trimmed.slice(lastSlash + 1) || 'i';
    let re: RegExp;
    try {
      re = new RegExp(pattern, flags.replace(/[^ims]/g, ''));
    } catch {
      const rows = searchMessagesForAccount(accountId, trimmed, { limit, offset, view, categoryId: opts.categoryId });
      return { rows, searchMode: 'like', hasMore: rows.length >= limit };
    }
    const all = searchMessagesForAccount(accountId, '', {
      limit: Math.min((limit + offset) * 3, 500),
      view,
      categoryId: opts.categoryId,
      doneFilter: opts.doneFilter,
    });
    const rows = all
      .filter((m) => messageMatchesDoneFilter(m, opts.doneFilter, view))
      .filter((m) => {
        const hay = [m.subject, m.snippet, m.body_text, m.to_json, m.cc_json, m.ticket_code]
          .filter(Boolean)
          .join('\n');
        return re.test(hay);
      })
      .slice(offset, offset + limit);
    return { rows, searchMode: 'regex', hasMore: rows.length >= limit };
  }
  const fts = ftsMatchExpression(trimmed);
  if (fts) {
    const viewSql = view ? viewFilterClause(view) : 'm.soft_deleted = 0';
    const doneSql = doneFilterSql(opts.doneFilter, view ?? 'inbox');
    const cat = categoryJoinSql(opts.categoryId);
    const ftsTable = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(EMAIL_MESSAGES_FTS_TABLE) as { name: string } | undefined;
    if (ftsTable) {
      try {
        const params: (string | number)[] = [accountId];
        if (cat.param != null) params.push(cat.param);
        params.push(fts, limit + 1, offset);
        const rows = getDb()
          .prepare(
            `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
             ${cat.sql}
             INNER JOIN ${EMAIL_MESSAGES_FTS_TABLE} fts ON fts.rowid = m.id
             WHERE m.account_id = ? AND ${viewSql} AND ${SNOOZE_FILTER_SQL}
               AND (m.uid >= 0 OR m.pop3_uidl IS NOT NULL OR m.folder_kind = 'draft')
               ${doneSql}
               AND fts MATCH ?
             ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC
             LIMIT ? OFFSET ?`,
          )
          .all(...params) as import('./email-store').EmailMessageRow[];
        const hasMore = rows.length > limit;
        return { rows: rows.slice(0, limit), searchMode: 'fts', hasMore };
      } catch {
        /* LIKE fallback */
      }
    }
  }
  const rows = searchMessagesForAccount(accountId, trimmed, {
    limit: limit + 1,
    offset,
    view,
    categoryId: opts.categoryId,
    doneFilter: opts.doneFilter,
  });
  return { rows: rows.slice(0, limit), searchMode: 'like', hasMore: rows.length > limit };
}

function messageMatchesDoneFilter(
  m: { done_local?: number },
  filter: MessageDoneFilter | undefined,
  view?: import('./email-store').AccountMailView,
): boolean {
  if (view && view !== 'inbox') return true;
  if (!filter || filter === 'all') return true;
  const done = (m.done_local ?? 0) !== 0;
  return filter === 'done' ? done : !done;
}

export function searchMessagesForMailScopeWithMeta(
  accountScope: number | 'all',
  q: string,
  opts: MessageSearchOpts = {},
): { rows: import('./email-store').EmailMessageRow[]; hasMore: boolean } {
  const limit = opts.limit ?? 80;
  if (accountScope !== 'all') {
    const r = searchMessagesForAccountWithMeta(accountScope, q, opts);
    return { rows: r.rows, hasMore: r.hasMore };
  }
  const rows = searchMessagesForAllAccounts(q, { ...opts, limit: (opts.limit ?? 80) + 1 });
  const hasMore = rows.length > limit;
  return { rows: rows.slice(0, limit), hasMore };
}

export function setMessageCustomerId(messageId: number, customerId: number | null): void {
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET customer_id = ? WHERE id = ?`)
    .run(customerId, messageId);
}

function ftsMatchExpression(raw: string): string | null {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  if (tokens.length === 0) return null;
  return tokens.join(' AND ');
}

function viewFilterClause(view: import('./email-store').AccountMailView): string {
  const nonDraftMail = `(m.uid >= 0 OR m.pop3_uidl IS NOT NULL)`;
  const outboundHeldInInbox = `(m.uid < 0 AND m.folder_kind = 'draft' AND m.outbound_hold = 1)`;
  switch (view) {
    case 'trash':
      return 'm.soft_deleted = 1';
    case 'archived':
      return `m.soft_deleted = 0 AND ${nonDraftMail} AND m.archived = 1 AND m.is_spam = 0`;
    case 'spam':
      return `m.soft_deleted = 0 AND ${nonDraftMail} AND m.is_spam = 1`;
    case 'sent':
      return `m.soft_deleted = 0 AND m.folder_kind = 'sent' AND m.is_spam = 0`;
    case 'drafts':
      return `m.soft_deleted = 0 AND m.folder_kind = 'draft'`;
    case 'snoozed':
      return `m.soft_deleted = 0 AND (m.snoozed_until IS NOT NULL AND m.snoozed_until > datetime('now'))`;
    case 'inbox':
      return `m.soft_deleted = 0 AND (
        (${nonDraftMail} AND (m.folder_kind = 'inbox' OR m.folder_kind IS NULL OR m.folder_kind = '') AND m.archived = 0 AND m.is_spam = 0)
        OR ${outboundHeldInInbox}
      )`;
    default:
      return 'm.soft_deleted = 0';
  }
}

export function searchMessagesForMailScope(
  accountScope: number | 'all',
  q: string,
  limit = 100,
  view?: import('./email-store').AccountMailView,
): import('./email-store').EmailMessageRow[] {
  return searchMessagesForMailScopeWithMeta(accountScope, q, { limit, view }).rows;
}

export function searchMessagesForAllAccounts(
  q: string,
  opts: MessageSearchOpts = {},
): import('./email-store').EmailMessageRow[] {
  if (!q.trim()) return [];
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const view = opts.view;
  const viewSql = view ? viewFilterClause(view) : 'm.soft_deleted = 0';
  const doneSql = doneFilterSql(opts.doneFilter, view ?? 'inbox');
  const cat = categoryJoinSql(opts.categoryId);
  const fts = ftsMatchExpression(q);
  if (fts) {
    const ftsTable = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(EMAIL_MESSAGES_FTS_TABLE) as { name: string } | undefined;
    if (ftsTable) {
      try {
        const params: (string | number)[] = [];
        if (cat.param != null) params.push(cat.param);
        params.push(fts, limit, offset);
        return getDb()
          .prepare(
            `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
             ${cat.sql}
             INNER JOIN ${EMAIL_MESSAGES_FTS_TABLE} fts ON fts.rowid = m.id
             WHERE ${viewSql} AND (m.uid >= 0 OR m.pop3_uidl IS NOT NULL OR m.folder_kind = 'draft')
             ${doneSql}
             AND fts MATCH ?
             ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC
             LIMIT ? OFFSET ?`,
          )
          .all(...params) as import('./email-store').EmailMessageRow[];
      } catch {
        /* FTS fallback */
      }
    }
  }
  const term = `%${q.trim().replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
  const params: (string | number)[] = [];
  if (cat.param != null) params.push(cat.param);
  params.push(term, term, term, term, term, term, term, limit, offset);
  return getDb()
    .prepare(
      `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
       ${cat.sql}
       WHERE ${viewSql} AND (m.uid >= 0 OR m.pop3_uidl IS NOT NULL OR m.folder_kind = 'draft')
       ${doneSql}
       AND ${LIKE_SEARCH_FIELDS}
       ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params) as import('./email-store').EmailMessageRow[];
}

export function searchMessagesForAccount(
  accountId: number,
  q: string,
  opts: MessageSearchOpts | number = 100,
  view?: import('./email-store').AccountMailView,
): import('./email-store').EmailMessageRow[] {
  const resolved: MessageSearchOpts =
    typeof opts === 'number' ? { limit: opts, view } : opts;
  if (!q.trim()) return [];
  const limit = resolved.limit ?? 100;
  const offset = resolved.offset ?? 0;
  const viewSql = resolved.view ? viewFilterClause(resolved.view) : 'm.soft_deleted = 0';
  const doneSql = doneFilterSql(resolved.doneFilter, resolved.view ?? 'inbox');
  const cat = categoryJoinSql(resolved.categoryId);
  const fts = ftsMatchExpression(q);
  if (fts) {
    const ftsTable = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(EMAIL_MESSAGES_FTS_TABLE) as { name: string } | undefined;
    if (ftsTable) {
      try {
        const params: (string | number)[] = [accountId];
        if (cat.param != null) params.push(cat.param);
        params.push(fts, limit, offset);
        return getDb()
          .prepare(
            `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
             ${cat.sql}
             INNER JOIN ${EMAIL_MESSAGES_FTS_TABLE} fts ON fts.rowid = m.id
             WHERE m.account_id = ? AND ${viewSql} AND (m.uid >= 0 OR m.pop3_uidl IS NOT NULL OR m.folder_kind = 'draft')
             ${doneSql}
             AND fts MATCH ?
             ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC
             LIMIT ? OFFSET ?`,
          )
          .all(...params) as import('./email-store').EmailMessageRow[];
      } catch {
        /* FTS nicht verfügbar oder ungültige Syntax — LIKE-Fallback */
      }
    }
  }
  const term = `%${q.trim().replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
  const params: (string | number)[] = [accountId];
  if (cat.param != null) params.push(cat.param);
  params.push(term, term, term, term, term, term, term, limit, offset);
  return getDb()
    .prepare(
      `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
       ${cat.sql}
       WHERE m.account_id = ? AND ${viewSql} AND (m.uid >= 0 OR m.pop3_uidl IS NOT NULL OR m.folder_kind = 'draft')
       ${doneSql}
       AND ${LIKE_SEARCH_FIELDS}
       ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params) as import('./email-store').EmailMessageRow[];
}
