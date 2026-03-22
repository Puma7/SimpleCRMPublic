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

const MAX_CATEGORY_DEPTH = 40;

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
  if (parts.length > MAX_CATEGORY_DEPTH) {
    throw new Error(`Kategoriepfad zu tief (max. ${MAX_CATEGORY_DEPTH} Ebenen)`);
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

export function listCategoryCountsForAccount(accountId: number): { categoryId: number; count: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT mc.category_id as categoryId, COUNT(DISTINCT mc.message_id) as count
       FROM ${EMAIL_MESSAGE_CATEGORIES_TABLE} mc
       INNER JOIN ${EMAIL_MESSAGES_TABLE} m ON m.id = mc.message_id
       WHERE m.account_id = ? AND m.soft_deleted = 0 AND m.archived = 0 AND m.uid >= 0 AND m.folder_kind = 'inbox'
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

export function listInternalNotes(messageId: number): { id: number; body: string; created_at: string }[] {
  return getDb()
    .prepare(
      `SELECT id, body, created_at FROM ${EMAIL_INTERNAL_NOTES_TABLE} WHERE message_id = ? ORDER BY id ASC`,
    )
    .all(messageId) as { id: number; body: string; created_at: string }[];
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
  sort_order: number;
};
export function listAiPrompts(): AiPromptRow[] {
  return getDb()
    .prepare(`SELECT * FROM ${EMAIL_AI_PROMPTS_TABLE} ORDER BY sort_order ASC, id ASC`)
    .all() as AiPromptRow[];
}

export function createAiPrompt(input: { label: string; userTemplate: string; target?: string }): number {
  const r = getDb()
    .prepare(
      `INSERT INTO ${EMAIL_AI_PROMPTS_TABLE} (label, user_template, target, sort_order) VALUES (?, ?, ?, ?)`,
    )
    .run(input.label.trim(), input.userTemplate, input.target ?? 'full_body', 0);
  return Number(r.lastInsertRowid);
}

export function updateAiPrompt(
  id: number,
  input: Partial<{ label: string; userTemplate: string; target: string }>,
): void {
  getDb()
    .prepare(
      `UPDATE ${EMAIL_AI_PROMPTS_TABLE} SET
        label = COALESCE(?, label),
        user_template = COALESCE(?, user_template),
        target = COALESCE(?, target)
      WHERE id = ?`,
    )
    .run(input.label ?? null, input.userTemplate ?? null, input.target ?? null, id);
}

export function deleteAiPrompt(id: number): void {
  getDb().prepare(`DELETE FROM ${EMAIL_AI_PROMPTS_TABLE} WHERE id = ?`).run(id);
}

export function tryLinkMessageToCustomer(messageId: number): number | null {
  const msg = getDb()
    .prepare(`SELECT from_json FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`)
    .get(messageId) as { from_json: string | null } | undefined;
  if (!msg?.from_json) return null;
  let email = '';
  try {
    const p = JSON.parse(msg.from_json) as { value?: { address?: string }[] };
    email = (p.value?.[0]?.address ?? '').trim().toLowerCase();
  } catch {
    return null;
  }
  if (!email) return null;
  const cust = getDb()
    .prepare(
      `SELECT id FROM ${CUSTOMERS_TABLE} WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
    )
    .get(email) as { id: number } | undefined;
  if (!cust) return null;
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET customer_id = ? WHERE id = ?`)
    .run(cust.id, messageId);
  return cust.id;
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

export function searchMessagesForAccount(
  accountId: number,
  q: string,
  limit = 100,
): import('./email-store').EmailMessageRow[] {
  const fts = ftsMatchExpression(q);
  if (fts) {
    const ftsTable = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(EMAIL_MESSAGES_FTS_TABLE) as { name: string } | undefined;
    if (ftsTable) {
      try {
        return getDb()
          .prepare(
            `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
             INNER JOIN ${EMAIL_MESSAGES_FTS_TABLE} fts ON fts.rowid = m.id
             WHERE m.account_id = ? AND m.soft_deleted = 0 AND m.uid >= 0
             AND fts MATCH ?
             ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC
             LIMIT ?`,
          )
          .all(accountId, fts, limit) as import('./email-store').EmailMessageRow[];
      } catch {
        /* FTS nicht verfügbar oder ungültige Syntax — LIKE-Fallback */
      }
    }
  }
  const term = `%${q.trim().replace(/%/g, '\\%')}%`;
  return getDb()
    .prepare(
      `SELECT m.* FROM ${EMAIL_MESSAGES_TABLE} m
       INNER JOIN ${EMAIL_FOLDERS_TABLE} f ON f.id = m.folder_id
       WHERE m.account_id = ? AND m.soft_deleted = 0 AND m.uid >= 0
       AND (
         m.subject LIKE ? ESCAPE '\\' OR m.snippet LIKE ? ESCAPE '\\' OR m.body_text LIKE ? ESCAPE '\\'
       )
       ORDER BY datetime(COALESCE(m.date_received, m.created_at)) DESC
       LIMIT ?`,
    )
    .all(accountId, term, term, term, limit) as import('./email-store').EmailMessageRow[];
}
