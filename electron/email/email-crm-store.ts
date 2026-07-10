import { MAX_EMAIL_CATEGORY_DEPTH } from '../../shared/email-constants';
import { normalizeEmailAddress } from '../../shared/email-address-normalize';
import { SNOOZE_FILTER_SQL } from './email-message-features';
import { doneFilterSql, type MessageDoneFilter } from '../../shared/email-done-filter';
import type { MessageSearchScope } from '../../shared/email-search-scope';
import {
  buildFtsMatchExpression,
  MAX_SEARCH_TEXT_TOKENS,
  parseMailSearchQuery,
  type ParsedMailSearchQuery,
} from '../../packages/core/src/email';
import { getDb } from '../sqlite-service';
import { resolveScopedAccountOverrides, type AccountOverrideScope } from '../../shared/mail-account-overrides';
import { accountAccessSql } from './mail-scope-access';
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
  const maxRow = getDb()
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) AS m FROM ${EMAIL_CATEGORIES_TABLE}
       WHERE parent_id IS ? OR (parent_id IS NULL AND ? IS NULL)`,
    )
    .get(parentId, parentId) as { m: number };
  const r = getDb()
    .prepare(`INSERT INTO ${EMAIL_CATEGORIES_TABLE} (parent_id, name, sort_order) VALUES (?, ?, ?)`)
    .run(parentId, name.trim(), (maxRow?.m ?? -1) + 1);
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

// ----- M:N category assignments (drag-drop multi-category) ----------------
// The legacy setMessageCategory above stays as the "replace single value"
// path used by the metadata-panel single-select + the email.set_category
// workflow node. The helpers below are the additive M:N counterparts.

export function listMessageCategoryAssignments(messageId: number): number[] {
  const rows = getDb()
    .prepare(
      `SELECT category_id FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} WHERE message_id = ? ORDER BY category_id`,
    )
    .all(messageId) as { category_id: number }[];
  return rows.map((r) => r.category_id);
}

/** Idempotent: returns `{ added: false, alreadyAssigned: true }` if the assignment exists. */
export function addMessageCategoryAssignment(
  messageId: number,
  categoryId: number,
): { added: true } | { added: false; alreadyAssigned: true } {
  const existing = getDb()
    .prepare(
      `SELECT 1 FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} WHERE message_id = ? AND category_id = ?`,
    )
    .get(messageId, categoryId) as { 1: number } | undefined;
  if (existing) return { added: false, alreadyAssigned: true };
  getDb()
    .prepare(
      `INSERT INTO ${EMAIL_MESSAGE_CATEGORIES_TABLE} (message_id, category_id) VALUES (?, ?)`,
    )
    .run(messageId, categoryId);
  return { added: true };
}

/** Returns `{ removed: true }` if a row was deleted, otherwise `{ removed: false }`. */
export function removeMessageCategoryAssignment(
  messageId: number,
  categoryId: number,
): { removed: boolean } {
  const result = getDb()
    .prepare(
      `DELETE FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} WHERE message_id = ? AND category_id = ?`,
    )
    .run(messageId, categoryId);
  return { removed: Number(result.changes) > 0 };
}

/** Diff-replace: keeps current rows that are in `categoryIds`, deletes the rest, inserts missing ones. */
export function setMessageCategoriesExact(messageId: number, categoryIds: readonly number[]): void {
  const d = getDb();
  const target = new Set(categoryIds);
  const tx = d.transaction(() => {
    const current = d
      .prepare(`SELECT category_id FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} WHERE message_id = ?`)
      .all(messageId) as { category_id: number }[];
    const currentIds = new Set(current.map((r) => r.category_id));
    for (const id of currentIds) {
      if (target.has(id)) continue;
      d.prepare(
        `DELETE FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} WHERE message_id = ? AND category_id = ?`,
      ).run(messageId, id);
    }
    const insertStmt = d.prepare(
      `INSERT INTO ${EMAIL_MESSAGE_CATEGORIES_TABLE} (message_id, category_id) VALUES (?, ?)`,
    );
    for (const id of target) {
      if (currentIds.has(id)) continue;
      insertStmt.run(messageId, id);
    }
  });
  tx();
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
  access?: import('./email-store').MailScopeSession,
): { categoryId: number; count: number }[] {
  if (accountScope === 'all') {
    return listCategoryCountsForAllAccounts(access);
  }
  return listCategoryCountsForAccount(accountScope);
}

const CATEGORY_INBOX_OPEN_WHERE = `m.soft_deleted = 0
         AND (m.folder_kind = 'inbox' OR m.folder_kind IS NULL OR m.folder_kind = '')
         AND m.archived = 0 AND m.is_spam = 0
         AND (m.uid >= 0 OR m.pop3_uidl IS NOT NULL)
         AND COALESCE(m.done_local, 0) = 0
         AND ${SNOOZE_FILTER_SQL}`;

/** Inbox messages per category summed across all accounts (open / unerledigt only). */
export function listCategoryCountsForAllAccounts(
  access?: import('./email-store').MailScopeSession,
): { categoryId: number; count: number }[] {
  const { sql: accessSql, params: accessParams } = accountAccessSql(getDb(), access);
  return getDb()
    .prepare(
      `SELECT mc.category_id AS categoryId, COUNT(*) AS count
       FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} mc
       INNER JOIN ${EMAIL_MESSAGES_TABLE} m ON m.id = mc.message_id
       WHERE ${CATEGORY_INBOX_OPEN_WHERE}${accessSql}
       GROUP BY mc.category_id`,
    )
    .all(...accessParams) as { categoryId: number; count: number }[];
}

export function listCategoryCountsForAccount(accountId: number): { categoryId: number; count: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT mc.category_id as categoryId, COUNT(DISTINCT mc.message_id) as count
       FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} mc
       INNER JOIN ${EMAIL_MESSAGES_TABLE} m ON m.id = mc.message_id
       WHERE m.account_id = ? AND ${CATEGORY_INBOX_OPEN_WHERE}
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

function categoryParentDepth(parentId: number | null, parentById: Map<number, number | null>): number {
  let depth = 0;
  let current = parentId;
  while (current != null) {
    depth += 1;
    if (depth >= MAX_EMAIL_CATEGORY_DEPTH) return depth;
    current = parentById.get(current) ?? null;
  }
  return depth;
}

function categorySubtreeHeight(
  categoryId: number,
  childrenByParent: Map<number | null, number[]>,
): number {
  const kids = childrenByParent.get(categoryId) ?? [];
  if (kids.length === 0) return 0;
  return 1 + Math.max(...kids.map((id) => categorySubtreeHeight(id, childrenByParent)));
}

/** Batch-update category parent and sibling order (from drag-and-drop UI). */
export function reorderCategories(
  updates: { id: number; parentId: number | null; sortOrder: number }[],
): void {
  if (updates.length === 0) return;
  const existing = listCategories();
  const known = new Set(existing.map((c) => c.id));
  const parentById = new Map<number, number | null>();
  for (const row of existing) parentById.set(row.id, row.parent_id);
  for (const u of updates) {
    if (!known.has(u.id)) throw new Error('Kategorie nicht gefunden');
    if (u.parentId === u.id) throw new Error('Kategorie kann nicht sich selbst übergeordnet sein');
    if (u.parentId != null && !known.has(u.parentId)) {
      throw new Error('Übergeordnete Kategorie nicht gefunden');
    }
    parentById.set(u.id, u.parentId);
  }

  const childrenByParent = new Map<number | null, number[]>();
  for (const u of updates) {
    const pid = u.parentId;
    const list = childrenByParent.get(pid) ?? [];
    list.push(u.id);
    childrenByParent.set(pid, list);
  }

  for (const u of updates) {
    const depth = categoryParentDepth(u.parentId, parentById);
    if (depth >= MAX_EMAIL_CATEGORY_DEPTH) {
      throw new Error(
        `Kategorien dürfen höchstens ${MAX_EMAIL_CATEGORY_DEPTH} Ebenen tief sein`,
      );
    }
    const subtree = categorySubtreeHeight(u.id, childrenByParent);
    if (depth + subtree >= MAX_EMAIL_CATEGORY_DEPTH) {
      throw new Error(
        `Verschieben würde die maximale Tiefe von ${MAX_EMAIL_CATEGORY_DEPTH} Ebenen überschreiten`,
      );
    }
  }

  const visiting = new Set<number>();
  const visit = (id: number): void => {
    if (visiting.has(id)) throw new Error('Ungültige Kategorie-Hierarchie (Zyklus)');
    visiting.add(id);
    const parent = parentById.get(id) ?? null;
    if (parent != null) visit(parent);
    visiting.delete(id);
  };
  for (const u of updates) visit(u.id);

  const d = getDb();
  const apply = d.transaction(() => {
    for (const u of updates) {
      updateCategory(u.id, { parentId: u.parentId, sortOrder: u.sortOrder });
    }
  });
  apply();
}

export type CannedRow = { id: number; title: string; body: string; account_id: number | null; override_key: string | null; sort_order: number };
export function listCannedResponses(scope?: AccountOverrideScope): CannedRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM ${EMAIL_CANNED_RESPONSES_TABLE} ORDER BY sort_order ASC, id ASC`)
    .all() as CannedRow[];
  return resolveScopedAccountOverrides(rows, scope ?? 'all');
}

export function createCannedResponse(title: string, body: string, opts: { accountId?: number | null; overrideKey?: string | null } = {}): number {
  const r = getDb()
    .prepare(`INSERT INTO ${EMAIL_CANNED_RESPONSES_TABLE} (title, body, account_id, override_key, sort_order) VALUES (?, ?, ?, ?, ?)`)
    .run(title.trim(), body, opts.accountId ?? null, opts.overrideKey ?? null, 0);
  return Number(r.lastInsertRowid);
}

export function updateCannedResponse(id: number, title: string, body: string, opts: { accountId?: number | null; overrideKey?: string | null } = {}): void {
  const sets = ['title = ?', 'body = ?'];
  const vals: unknown[] = [title, body];
  if (Object.prototype.hasOwnProperty.call(opts, 'accountId')) { sets.push('account_id = ?'); vals.push(opts.accountId ?? null); }
  if (Object.prototype.hasOwnProperty.call(opts, 'overrideKey')) { sets.push('override_key = ?'); vals.push(opts.overrideKey ?? null); }
  vals.push(id);
  getDb().prepare(`UPDATE ${EMAIL_CANNED_RESPONSES_TABLE} SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
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
  account_id: number | null;
  override_key: string | null;
  sort_order: number;
};
export function listAiPrompts(scope?: AccountOverrideScope): AiPromptRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM ${EMAIL_AI_PROMPTS_TABLE} ORDER BY sort_order ASC, id ASC`)
    .all() as AiPromptRow[];
  return resolveScopedAccountOverrides(rows, scope ?? 'all');
}

function listAllAiPromptRows(): AiPromptRow[] {
  return getDb()
    .prepare(`SELECT * FROM ${EMAIL_AI_PROMPTS_TABLE} ORDER BY sort_order ASC, id ASC`)
    .all() as AiPromptRow[];
}

export function createAiPrompt(input: {
  label: string;
  userTemplate: string;
  target?: string;
  profileId?: number | null;
  accountId?: number | null;
  overrideKey?: string | null;
}): number {
  const maxRow = getDb()
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM ${EMAIL_AI_PROMPTS_TABLE}`)
    .get() as { m: number };
  const sortOrder = (maxRow?.m ?? -1) + 1;
  const profileId =
    input.profileId != null && input.profileId > 0 ? input.profileId : null;
  const r = getDb()
    .prepare(
      `INSERT INTO ${EMAIL_AI_PROMPTS_TABLE} (label, user_template, target, profile_id, account_id, override_key, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.label.trim(),
      input.userTemplate,
      input.target ?? 'full_body',
      profileId,
      input.accountId ?? null,
      input.overrideKey ?? null,
      sortOrder,
    );
  return Number(r.lastInsertRowid);
}

/** Swap sort_order with neighbour inside the prompt's visible account scope. */
export function moveAiPrompt(id: number, direction: 'up' | 'down'): boolean {
  const allRows = listAllAiPromptRows();
  const current = allRows.find((r) => r.id === id);
  if (!current) return false;
  const scope: AccountOverrideScope = current.account_id == null ? 'all' : current.account_id;
  const rows = listAiPrompts(scope);
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
    accountId: number | null;
    overrideKey: string | null;
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
  if (input.accountId !== undefined) { sets.push('account_id = ?'); vals.push(input.accountId ?? null); }
  if (input.overrideKey !== undefined) { sets.push('override_key = ?'); vals.push(input.overrideKey ?? null); }
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

export type { MessageSearchScope } from '../../shared/email-search-scope';

export type MessageSearchOpts = {
  limit?: number;
  offset?: number;
  view?: import('./email-store').AccountMailView;
  categoryId?: number | null;
  doneFilter?: MessageDoneFilter;
  /** 'broad' searches across all folders/views; absent or 'view' keeps per-view filtering. */
  scope?: MessageSearchScope;
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
         OR m.from_json LIKE ? ESCAPE '\\' OR m.to_json LIKE ? ESCAPE '\\' OR m.cc_json LIKE ? ESCAPE '\\'
         OR m.bcc_json LIKE ? ESCAPE '\\' OR m.ticket_code LIKE ? ESCAPE '\\'
         OR m.attachments_json LIKE ? ESCAPE '\\'
         OR EXISTS (
           SELECT 1 FROM ${CUSTOMERS_TABLE} c
           WHERE c.id = m.customer_id
             AND (
               COALESCE(c.name, '') LIKE ? ESCAPE '\\'
               OR COALESCE(c.firstName, '') LIKE ? ESCAPE '\\'
               OR COALESCE(c.company, '') LIKE ? ESCAPE '\\'
               OR COALESCE(c.email, '') LIKE ? ESCAPE '\\'
             )
         )
       )`;

/** Placeholder count in LIKE_SEARCH_FIELDS. */
const LIKE_SEARCH_FIELD_COUNT = 13;

/** One search term per placeholder in LIKE_SEARCH_FIELDS. */
function pushLikeSearchTerms(params: (string | number)[], term: string): void {
  for (let i = 0; i < LIKE_SEARCH_FIELD_COUNT; i++) params.push(term);
}

function escapeLikeValue(v: string): string {
  return v.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

/**
 * LIKE pattern for from:/to: operator values against the stored address JSON:
 * `@bar.de` → domain suffix, `foo@bar.de` → exact address, `foo@bar` →
 * address prefix, anything without `@` → plain substring (matches names too).
 */
function addressLikePattern(value: string): string {
  const escaped = escapeLikeValue(value);
  if (value.startsWith('@')) {
    return `%"address":"%${escaped}"%`;
  }
  if (/^\S+@\S+\.\S{2,}$/.test(value)) {
    return `%"address":"${escaped}"%`;
  }
  if (value.includes('@')) {
    return `%"address":"${escaped}%`;
  }
  return `%${escaped}%`;
}

/** SQL conditions for parsed operators (from:/to:/subject:/has:attachment). */
function operatorSearchSql(parsed: ParsedMailSearchQuery): { sql: string; params: string[] } {
  const conds: string[] = [];
  const params: string[] = [];
  for (const value of parsed.from) {
    conds.push(`m.from_json LIKE ? ESCAPE '\\'`);
    params.push(addressLikePattern(value));
  }
  for (const value of parsed.to) {
    conds.push(
      `(m.to_json LIKE ? ESCAPE '\\' OR m.cc_json LIKE ? ESCAPE '\\' OR m.bcc_json LIKE ? ESCAPE '\\')`,
    );
    const pattern = addressLikePattern(value);
    params.push(pattern, pattern, pattern);
  }
  for (const value of parsed.subject) {
    conds.push(`m.subject LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeLikeValue(value)}%`);
  }
  if (parsed.hasAttachment) conds.push('m.has_attachments = 1');
  return { sql: conds.length > 0 ? ` AND ${conds.join(' AND ')}` : '', params };
}

/** One AND'ed LIKE fields block per phrase/term (capped like the FTS tokens). */
function likeTextSearchSql(parsed: ParsedMailSearchQuery): { sql: string; params: string[] } {
  const needles = [...parsed.phrases, ...parsed.terms].slice(0, MAX_SEARCH_TEXT_TOKENS);
  const blocks: string[] = [];
  const params: string[] = [];
  for (const needle of needles) {
    blocks.push(LIKE_SEARCH_FIELDS);
    pushLikeSearchTerms(params, `%${escapeLikeValue(needle)}%`);
  }
  return { sql: blocks.length > 0 ? ` AND ${blocks.join(' AND ')}` : '', params };
}

/** Non-draft or draft mail that belongs in search results at all. */
const SEARCHABLE_MAIL_SQL = `(m.uid >= 0 OR m.pop3_uidl IS NOT NULL OR m.folder_kind = 'draft')`;

/** WHERE fragment for the search scope: broad (cross-view) or per-view. */
function searchScopeSql(opts: MessageSearchOpts): { sql: string; broad: boolean } {
  const scope = opts.scope;
  if (scope && scope.mode === 'broad') {
    const parts = [SEARCHABLE_MAIL_SQL];
    if (!scope.includeTrash) parts.push('m.soft_deleted = 0');
    if (!scope.includeSpam) {
      // spam_status 'review' mail lives in the inbox and stays searchable.
      parts.push(`m.is_spam = 0 AND COALESCE(m.spam_status, 'clean') <> 'spam'`);
    }
    return { sql: parts.join(' AND '), broad: true };
  }
  const viewSql = opts.view ? viewFilterClause(opts.view) : 'm.soft_deleted = 0';
  return { sql: `${viewSql} AND ${SEARCHABLE_MAIL_SQL}`, broad: false };
}

function ftsTableExists(): boolean {
  return Boolean(
    getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(EMAIL_MESSAGES_FTS_TABLE),
  );
}

type MessageSearchTarget = {
  accountId?: number;
  access?: import('./email-store').MailScopeSession;
  /** View mode only: hide snoozed mail from search (per-account meta path). */
  applySnoozeFilter?: boolean;
};

/**
 * Shared search engine for all non-regex paths. Dispatch: FTS5 (phrases exact,
 * terms as prefix) → LIKE fallback. The mode is deterministic per query, not
 * per page: page 1 decides (FTS hit → fts, otherwise LIKE); later pages probe
 * FTS page 1 so a LIKE-served result list stays LIKE across its pagination.
 * Operator-only queries (e.g. `von:max@test.de`) skip text matching and run a
 * plain filtered SELECT.
 */
function runMessageSearch(
  trimmed: string,
  opts: MessageSearchOpts,
  target: MessageSearchTarget,
  limit: number,
  offset: number,
): { rows: import('./email-store').EmailMessageRow[]; searchMode: 'fts' | 'like' } {
  const parsed = parseMailSearchQuery(trimmed);
  const { sql: scopeSql, broad } = searchScopeSql(opts);
  const doneSql = broad ? '' : doneFilterSql(opts.doneFilter, opts.view ?? 'inbox');
  const snoozeSql = !broad && target.applySnoozeFilter ? ` AND ${SNOOZE_FILTER_SQL}` : '';
  const cat = categoryJoinSql(opts.categoryId);
  const ops = operatorSearchSql(parsed);
  const access =
    target.accountId == null
      ? accountAccessSql(getDb(), target.access)
      : { sql: '', params: [] as number[] };
  const accountSql = target.accountId != null ? 'm.account_id = ? AND ' : '';
  const fts = buildFtsMatchExpression(parsed);
  if (!fts && ops.sql.length === 0) {
    // Nothing searchable parsed out of the query (e.g. `""`): never return the
    // unfiltered view.
    return { rows: [], searchMode: 'like' };
  }
  if (fts && ftsTableExists()) {
    try {
      // NB: the MATCH column must be alias-qualified with the *table* name
      // (`fts.email_messages_fts`); a bare `fts MATCH ?` is "no such column".
      const params: (string | number)[] = [];
      if (cat.param != null) params.push(cat.param);
      if (target.accountId != null) params.push(target.accountId);
      params.push(...access.params, ...ops.params, fts);
      const stmt = getDb().prepare(
        `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
         ${cat.sql}
         INNER JOIN ${EMAIL_MESSAGES_FTS_TABLE} fts ON fts.rowid = m.id
         WHERE ${accountSql}${scopeSql}${snoozeSql}
         ${doneSql}${access.sql}${ops.sql}
         AND fts.${EMAIL_MESSAGES_FTS_TABLE} MATCH ?
         ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC
         LIMIT ? OFFSET ?`,
      );
      const rows = stmt.all(...params, limit, offset) as import('./email-store').EmailMessageRow[];
      if (rows.length > 0) {
        return { rows, searchMode: 'fts' };
      }
      if (offset > 0) {
        // Empty page beyond page 1: probe page 1 to tell "genuine end of FTS
        // results" from "this query has been LIKE mode all along" — otherwise
        // pages after the first would be unreachable for LIKE-only queries.
        const probe = stmt.all(...params, 1, 0) as import('./email-store').EmailMessageRow[];
        if (probe.length > 0) {
          return { rows: [], searchMode: 'fts' };
        }
      }
      // FTS ok but has no hits for this query — fall through to LIKE.
    } catch {
      /* FTS nicht verfuegbar oder ungueltige Syntax — LIKE-Fallback */
    }
  }
  const text = fts ? likeTextSearchSql(parsed) : { sql: '', params: [] as string[] };
  const params: (string | number)[] = [];
  if (cat.param != null) params.push(cat.param);
  if (target.accountId != null) params.push(target.accountId);
  params.push(...access.params, ...ops.params, ...text.params, limit, offset);
  const rows = getDb()
    .prepare(
      `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
       ${cat.sql}
       WHERE ${accountSql}${scopeSql}${snoozeSql}
       ${doneSql}${access.sql}${ops.sql}${text.sql}
       ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params) as import('./email-store').EmailMessageRow[];
  return { rows, searchMode: 'like' };
}

/**
 * Candidate rows for the regex search (regex matching happens in JS): plain
 * scope/view-filtered SELECT, newest first, capped by the caller.
 */
function listRegexSearchCandidates(
  accountId: number,
  opts: MessageSearchOpts,
  limit: number,
): import('./email-store').EmailMessageRow[] {
  const { sql: scopeSql, broad } = searchScopeSql(opts);
  const doneSql = broad ? '' : doneFilterSql(opts.doneFilter, opts.view ?? 'inbox');
  const cat = categoryJoinSql(opts.categoryId);
  const params: (string | number)[] = [];
  if (cat.param != null) params.push(cat.param);
  params.push(accountId, limit);
  return getDb()
    .prepare(
      `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
       ${cat.sql}
       WHERE m.account_id = ? AND ${scopeSql}
       ${doneSql}
       ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC
       LIMIT ?`,
    )
    .all(...params) as import('./email-store').EmailMessageRow[];
}

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
      const rows = searchMessagesForAccount(accountId, trimmed, {
        limit,
        offset,
        view,
        categoryId: opts.categoryId,
        doneFilter: opts.doneFilter,
        scope: opts.scope,
      });
      return { rows, searchMode: 'like', hasMore: rows.length >= limit };
    }
    const all = listRegexSearchCandidates(accountId, opts, Math.min((limit + offset) * 3, 500));
    const rows = all
      .filter((m) => messageMatchesDoneFilter(m, opts.doneFilter, view))
      .filter((m) => {
        const hay = [
          m.subject,
          m.snippet,
          m.body_text,
          m.from_json,
          m.to_json,
          m.cc_json,
          m.bcc_json,
          m.ticket_code,
          m.attachments_json,
        ]
          .filter(Boolean)
          .join('\n');
        return re.test(hay);
      })
      .slice(offset, offset + limit);
    return { rows, searchMode: 'regex', hasMore: rows.length >= limit };
  }
  const r = runMessageSearch(trimmed, opts, { accountId, applySnoozeFilter: true }, limit + 1, offset);
  return { rows: r.rows.slice(0, limit), searchMode: r.searchMode, hasMore: r.rows.length > limit };
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
  access?: import('./email-store').MailScopeSession,
): {
  rows: import('./email-store').EmailMessageRow[];
  searchMode: MessageSearchMode;
  hasMore: boolean;
} {
  if (accountScope !== 'all') {
    return searchMessagesForAccountWithMeta(accountScope, q, opts);
  }
  return searchMessagesForAllAccountsWithMeta(q, opts, access);
}

export function setMessageCustomerId(messageId: number, customerId: number | null): void {
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET customer_id = ? WHERE id = ?`)
    .run(customerId, messageId);
}

function viewFilterClause(view: import('./email-store').AccountMailView): string {
  const nonDraftMail = `(m.uid >= 0 OR m.pop3_uidl IS NOT NULL)`;
  const outboundHeldInInbox = `(m.uid < 0 AND m.folder_kind = 'draft' AND m.outbound_hold = 1 AND (m.scheduled_send_at IS NULL OR m.scheduled_send_at = ''))`;
  switch (view) {
    case 'trash':
      return 'm.soft_deleted = 1';
    case 'archived':
      return `m.soft_deleted = 0 AND ${nonDraftMail} AND m.archived = 1 AND m.is_spam = 0 AND COALESCE(m.spam_status, 'clean') = 'clean'`;
    case 'spam_review':
      return `m.soft_deleted = 0 AND ${nonDraftMail} AND COALESCE(m.spam_status, 'clean') = 'review'`;
    case 'spam':
      return `m.soft_deleted = 0 AND ${nonDraftMail} AND (m.is_spam = 1 OR COALESCE(m.spam_status, 'clean') = 'spam')`;
    case 'sent':
      return `m.soft_deleted = 0 AND m.folder_kind = 'sent' AND m.is_spam = 0`;
    case 'drafts':
      return `m.soft_deleted = 0 AND m.folder_kind = 'draft' AND (m.scheduled_send_at IS NULL OR m.scheduled_send_at = '')`;
    case 'scheduled_send':
      return `m.soft_deleted = 0 AND m.folder_kind = 'draft' AND m.scheduled_send_at IS NOT NULL AND m.scheduled_send_at != ''`;
    case 'snoozed':
      return `m.soft_deleted = 0 AND (m.snoozed_until IS NOT NULL AND datetime(m.snoozed_until) > datetime('now'))`;
    case 'inbox':
      return `m.soft_deleted = 0 AND (
        (${nonDraftMail} AND (m.folder_kind = 'inbox' OR m.folder_kind IS NULL OR m.folder_kind = '') AND m.archived = 0 AND m.is_spam = 0 AND COALESCE(m.spam_status, 'clean') = 'clean')
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

export function searchMessagesForAllAccountsWithMeta(
  q: string,
  opts: MessageSearchOpts = {},
  access?: import('./email-store').MailScopeSession,
): {
  rows: import('./email-store').EmailMessageRow[];
  searchMode: MessageSearchMode;
  hasMore: boolean;
} {
  const trimmed = q.trim();
  if (!trimmed) return { rows: [], searchMode: 'like', hasMore: false };
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const r = runMessageSearch(trimmed, opts, { access }, limit + 1, offset);
  return { rows: r.rows.slice(0, limit), searchMode: r.searchMode, hasMore: r.rows.length > limit };
}

export function searchMessagesForAllAccounts(
  q: string,
  opts: MessageSearchOpts = {},
  access?: import('./email-store').MailScopeSession,
): import('./email-store').EmailMessageRow[] {
  return searchMessagesForAllAccountsWithMeta(q, opts, access).rows;
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
  return runMessageSearch(q.trim(), resolved, { accountId }, limit, offset).rows;
}
