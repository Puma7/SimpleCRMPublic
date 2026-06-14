import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getDb } from '../sqlite-service';
import {
  WORKFLOW_KNOWLEDGE_BASES_TABLE,
  WORKFLOW_KNOWLEDGE_CHUNKS_TABLE,
} from '../database-schema';
import { runEmbedding } from '../email/email-openai';
import { resolveScopedAccountOverrides, type AccountOverrideScope } from '../../shared/mail-account-overrides';
import {
  type KnowledgeContext,
  isKnowledgeContext,
  knowledgeContextsForDirection,
} from '../../shared/knowledge-context';

export type KnowledgeBaseRow = {
  id: number;
  name: string;
  description: string | null;
  account_id: number | null;
  override_key: string | null;
  knowledge_context: string | null;
  created_at: string;
};

export type KnowledgeChunkRow = {
  id: number;
  knowledge_base_id: number;
  title: string | null;
  content: string;
  source_path: string | null;
  embedding_json?: string | null;
};

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function parseEmbedding(json: string | null | undefined): number[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as number[];
    return Array.isArray(v) && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

async function storeEmbedding(chunkId: number, text: string): Promise<void> {
  const vec = await runEmbedding(text);
  if (!vec) return;
  getDb()
    .prepare(`UPDATE ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} SET embedding_json = ? WHERE id = ?`)
    .run(JSON.stringify(vec), chunkId);
}

export function listKnowledgeBases(scope?: AccountOverrideScope): KnowledgeBaseRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE} ORDER BY name ASC`)
    .all() as KnowledgeBaseRow[];
  return scope === undefined ? rows : resolveScopedAccountOverrides(rows, scope);
}

function knowledgeMarkdownPath(knowledgeBaseId: number): string {
  return path.join(knowledgeStorageDir(), `${knowledgeBaseId}.md`);
}

function defaultMarkdownTemplate(name: string): string {
  return `# ${name.trim()}\n\nHier steht der Wissenstext für diesen Bereich (Markdown).\n`;
}

/** Load document from disk or migrate legacy DB chunks into one .md file. */
export function getKnowledgeBaseDocument(knowledgeBaseId: number): {
  content: string;
  fileName: string;
} | null {
  const kb = getDb()
    .prepare(`SELECT id, name FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE} WHERE id = ?`)
    .get(knowledgeBaseId) as { id: number; name: string } | undefined;
  if (!kb) return null;

  const filePath = knowledgeMarkdownPath(knowledgeBaseId);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    return { content, fileName: `${kb.id}-${sanitizeFileSlug(kb.name)}.md` };
  }

  const chunks = getDb()
    .prepare(
      `SELECT title, content FROM ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE}
       WHERE knowledge_base_id = ? ORDER BY id ASC`,
    )
    .all(knowledgeBaseId) as { title: string | null; content: string }[];

  if (chunks.length === 0) {
    const template = defaultMarkdownTemplate(kb.name);
    fs.writeFileSync(filePath, template, 'utf8');
    return { content: template, fileName: `${kb.id}-${sanitizeFileSlug(kb.name)}.md` };
  }

  const merged = chunks
    .map((c) => {
      const title = c.title?.trim();
      if (title && title !== 'Dokument') {
        return `## ${title}\n\n${c.content}`;
      }
      return c.content;
    })
    .join('\n\n---\n\n');
  fs.writeFileSync(filePath, merged, 'utf8');
  syncChunksFromDocument(knowledgeBaseId, merged, kb.name);
  return { content: merged, fileName: `${kb.id}-${sanitizeFileSlug(kb.name)}.md` };
}

function sanitizeFileSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'wissensbasis';
}

/** Persist markdown file and refresh the single search index chunk. */
export function saveKnowledgeBaseDocument(knowledgeBaseId: number, content: string): void {
  const kb = getDb()
    .prepare(`SELECT name FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE} WHERE id = ?`)
    .get(knowledgeBaseId) as { name: string } | undefined;
  if (!kb) throw new Error('Wissensbasis nicht gefunden');
  const normalized = content.trimEnd() + (content.endsWith('\n') ? '' : '\n');
  const filePath = knowledgeMarkdownPath(knowledgeBaseId);
  fs.writeFileSync(filePath, normalized, 'utf8');
  syncChunksFromDocument(knowledgeBaseId, normalized, kb.name);
}

function syncChunksFromDocument(
  knowledgeBaseId: number,
  content: string,
  title: string,
): void {
  getDb()
    .prepare(`DELETE FROM ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} WHERE knowledge_base_id = ?`)
    .run(knowledgeBaseId);
  const capped = content.slice(0, 500_000);
  const r = getDb()
    .prepare(
      `INSERT INTO ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE}
       (knowledge_base_id, title, content, source_path, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      knowledgeBaseId,
      title.trim() || 'Dokument',
      capped,
      knowledgeMarkdownPath(knowledgeBaseId),
      new Date().toISOString(),
    );
  const id = Number(r.lastInsertRowid);
  void storeEmbedding(id, capped.slice(0, 8000));
}

export function createKnowledgeBase(
  name: string,
  description?: string | null,
  opts: {
    accountId?: number | null;
    overrideKey?: string | null;
    knowledgeContext?: KnowledgeContext | string | null;
  } = {},
): number {
  const ctx = isKnowledgeContext(opts.knowledgeContext) ? opts.knowledgeContext : null;
  const overrideKey = opts.overrideKey ?? (ctx ? `kb.${ctx}` : null);
  const r = getDb()
    .prepare(
      `INSERT INTO ${WORKFLOW_KNOWLEDGE_BASES_TABLE} (name, description, account_id, override_key, knowledge_context, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name.trim(),
      description ?? null,
      opts.accountId ?? null,
      overrideKey,
      ctx,
      new Date().toISOString(),
    );
  const id = Number(r.lastInsertRowid);
  const template = defaultMarkdownTemplate(name);
  fs.writeFileSync(knowledgeMarkdownPath(id), template, 'utf8');
  syncChunksFromDocument(id, template, name);
  return id;
}

export function updateKnowledgeBase(
  id: number,
  opts: {
    name?: string;
    description?: string | null;
    accountId?: number | null;
    overrideKey?: string | null;
    knowledgeContext?: KnowledgeContext | string | null;
  },
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (opts.name !== undefined) {
    sets.push('name = ?');
    vals.push(opts.name.trim());
  }
  if (Object.prototype.hasOwnProperty.call(opts, 'description')) {
    sets.push('description = ?');
    vals.push(opts.description ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(opts, 'accountId')) {
    sets.push('account_id = ?');
    vals.push(opts.accountId ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(opts, 'overrideKey')) {
    sets.push('override_key = ?');
    vals.push(opts.overrideKey ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(opts, 'knowledgeContext')) {
    const ctx = isKnowledgeContext(opts.knowledgeContext) ? opts.knowledgeContext : null;
    sets.push('knowledge_context = ?');
    vals.push(ctx);
    if (!Object.prototype.hasOwnProperty.call(opts, 'overrideKey') && ctx) {
      sets.push('override_key = ?');
      vals.push(`kb.${ctx}`);
    }
  }
  if (sets.length === 0) return;
  vals.push(id);
  getDb()
    .prepare(`UPDATE ${WORKFLOW_KNOWLEDGE_BASES_TABLE} SET ${sets.join(', ')} WHERE id = ?`)
    .run(...vals);
}

export function deleteKnowledgeBase(id: number): void {
  const filePath = knowledgeMarkdownPath(id);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }
  getDb().prepare(`DELETE FROM ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} WHERE knowledge_base_id = ?`).run(id);
  getDb().prepare(`DELETE FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE} WHERE id = ?`).run(id);
}

export function addTextChunk(knowledgeBaseId: number, title: string, content: string): number {
  const doc = getKnowledgeBaseDocument(knowledgeBaseId);
  if (!doc) throw new Error('Wissensbasis nicht gefunden');
  const section = `## ${title.trim() || 'Eintrag'}\n\n${content.trim()}`;
  const merged = doc.content.trim() ? `${doc.content.trimEnd()}\n\n${section}\n` : `${section}\n`;
  saveKnowledgeBaseDocument(knowledgeBaseId, merged);
  const row = getDb()
    .prepare(
      `SELECT id FROM ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} WHERE knowledge_base_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(knowledgeBaseId) as { id: number } | undefined;
  return row?.id ?? 0;
}

/** Replace the whole knowledge-base document from an uploaded .md/.txt file. */
export function importFileToKnowledgeBase(knowledgeBaseId: number, filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf8');
  saveKnowledgeBaseDocument(knowledgeBaseId, content);
  const row = getDb()
    .prepare(
      `SELECT id FROM ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} WHERE knowledge_base_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(knowledgeBaseId) as { id: number } | undefined;
  return row?.id ?? 0;
}

function keywordSearch(
  knowledgeBaseId: number,
  query: string,
  limit: number,
): KnowledgeChunkRow[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 12);
  const rows = getDb()
    .prepare(
      `SELECT * FROM ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} WHERE knowledge_base_id = ? ORDER BY id DESC LIMIT 200`,
    )
    .all(knowledgeBaseId) as KnowledgeChunkRow[];
  if (terms.length === 0) return rows.slice(0, limit);
  const scored = rows
    .map((row) => {
      const hay = `${row.title ?? ''}\n${row.content}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (hay.includes(t)) score += 1;
      }
      return { row, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.row);
}

export function findKnowledgeBaseForAccountContext(
  accountId: number | null,
  context: KnowledgeContext,
): KnowledgeBaseRow | undefined {
  if (accountId != null) {
    const accountRow = getDb()
      .prepare(
        `SELECT * FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE}
         WHERE knowledge_context = ? AND account_id = ?
         LIMIT 1`,
      )
      .get(context, accountId) as KnowledgeBaseRow | undefined;
    if (accountRow) return accountRow;
  }
  return getDb()
    .prepare(
      `SELECT * FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE}
       WHERE knowledge_context = ? AND account_id IS NULL
       LIMIT 1`,
    )
    .get(context) as KnowledgeBaseRow | undefined;
}

export function listKnowledgeBaseIdsForWorkflow(
  accountId: number | null | undefined,
  direction: string | undefined,
): number[] {
  const contexts = knowledgeContextsForDirection(
    direction as 'inbound' | 'outbound' | 'draft_created' | undefined,
  );
  const ids = new Set<number>();
  for (const ctx of contexts) {
    const row = findKnowledgeBaseForAccountContext(accountId ?? null, ctx);
    if (row) ids.add(row.id);
  }
  return [...ids];
}

export async function searchKnowledgeForWorkflow(
  accountId: number | null | undefined,
  direction: string | undefined,
  query: string,
  limit = 5,
  explicitKbId?: number | null,
): Promise<KnowledgeChunkRow[]> {
  const kbIds = new Set<number>();
  if (explicitKbId != null && explicitKbId > 0) kbIds.add(explicitKbId);
  for (const id of listKnowledgeBaseIdsForWorkflow(accountId, direction)) kbIds.add(id);
  const merged: KnowledgeChunkRow[] = [];
  const perKb = Math.max(1, Math.ceil(limit / Math.max(1, kbIds.size)));
  for (const kbId of kbIds) {
    const chunks = await searchKnowledgeChunks(kbId, query, perKb);
    merged.push(...chunks);
  }
  return merged.slice(0, limit);
}

/** Keyword + optional embedding RAG */
export async function searchKnowledgeChunks(
  knowledgeBaseId: number,
  query: string,
  limit = 5,
): Promise<KnowledgeChunkRow[]> {
  const rows = getDb()
    .prepare(
      `SELECT * FROM ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} WHERE knowledge_base_id = ? ORDER BY id DESC LIMIT 200`,
    )
    .all(knowledgeBaseId) as KnowledgeChunkRow[];

  const queryVec = await runEmbedding(query);
  if (queryVec) {
    const scored = rows
      .map((row) => {
        const emb = parseEmbedding(row.embedding_json);
        if (!emb) return { row, score: 0 };
        return { row, score: cosineSimilarity(queryVec, emb) };
      })
      .filter((x) => x.score > 0.2)
      .sort((a, b) => b.score - a.score);
    if (scored.length > 0) {
      return scored.slice(0, limit).map((x) => x.row);
    }
  }
  return keywordSearch(knowledgeBaseId, query, limit);
}

export function knowledgeStorageDir(): string {
  const dir = path.join(app.getPath('userData'), 'workflow-knowledge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
