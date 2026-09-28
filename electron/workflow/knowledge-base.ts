import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getDb } from '../sqlite-service';
import {
  EMAIL_MESSAGES_TABLE,
  WORKFLOW_KNOWLEDGE_BASES_TABLE,
  WORKFLOW_KNOWLEDGE_CHUNKS_TABLE,
  WORKFLOW_KNOWLEDGE_SECTIONS_FTS_TABLE,
  WORKFLOW_KNOWLEDGE_SECTIONS_TABLE,
} from '../database-schema';
import {
  buildKnowledgeQueryTerms,
  deriveKnowledgeSections,
  KNOWLEDGE_SMALL_KB_MAX_CHARS,
} from '../../packages/core/src/learnings/knowledge-chunking';
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
  /** Plan 048: Name der Wissensbasis (Quellenangabe am Entwurf). */
  knowledge_base_name?: string | null;
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

/** Plan 048: höchstens so viele Abschnitte je Speichern einbetten. */
const SECTION_EMBEDDINGS_MAX = 50;

/**
 * Einbettungen je Abschnitt, im Hintergrund und nur mit konfiguriertem
 * Einbettungsmodell (runEmbedding liefert sonst null). Ein zwischenzeitlicher
 * Neuaufbau macht die Updates wirkungslos (neue Ids).
 */
async function storeSectionEmbeddings(knowledgeBaseId: number): Promise<void> {
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, title, content FROM ${WORKFLOW_KNOWLEDGE_SECTIONS_TABLE}
         WHERE knowledge_base_id = ? ORDER BY position LIMIT ?`,
      )
      .all(knowledgeBaseId, SECTION_EMBEDDINGS_MAX) as { id: number; title: string; content: string }[];
    for (const row of rows) {
      const vec = await runEmbedding(`${row.title}\n${row.content}`.slice(0, 8000));
      if (!vec) return;
      getDb()
        .prepare(`UPDATE ${WORKFLOW_KNOWLEDGE_SECTIONS_TABLE} SET embedding_json = ? WHERE id = ?`)
        .run(JSON.stringify(vec), row.id);
    }
  } catch (error) {
    console.warn('[knowledge] Abschnitts-Einbettung fehlgeschlagen:', error instanceof Error ? error.message : error);
  }
}

export function listKnowledgeBases(scope?: AccountOverrideScope): KnowledgeBaseRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE} ORDER BY name ASC`)
    .all() as KnowledgeBaseRow[];
  return scope === undefined ? rows : resolveScopedAccountOverrides(rows, scope);
}

export function getKnowledgeBaseById(id: number): KnowledgeBaseRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE} WHERE id = ?`)
    .get(id) as KnowledgeBaseRow | undefined;
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
  // Erst der Suchindex (SQLite, rollt bei einem Fehler zurück — auch als Teil
  // einer umgebenden Transaktion), dann die Datei: scheitert der Index, bleibt
  // die Datei unverändert.
  syncChunksFromDocument(knowledgeBaseId, normalized, kb.name);
  fs.writeFileSync(filePath, normalized, 'utf8');
}

function syncChunksFromDocument(
  knowledgeBaseId: number,
  content: string,
  title: string,
): void {
  const db = getDb();
  const capped = content.slice(0, 500_000);
  // Löschen und Neuanlegen als Einheit: scheitert das Einfügen, bleibt der
  // bisherige Suchindex stehen, statt die Wissensbasis für alle KI-Bausteine
  // leer erscheinen zu lassen.
  const replaceChunks = db.transaction((): void => {
    // Plan 048: Abschnitte aus demselben Inhalt, in derselben Transaktion.
    rebuildKnowledgeSections(knowledgeBaseId, capped, title);
    db.prepare(`DELETE FROM ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} WHERE knowledge_base_id = ?`)
      .run(knowledgeBaseId);
    db
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
  });
  replaceChunks();
  void storeSectionEmbeddings(knowledgeBaseId);
}

/**
 * Plan 048: Abschnitte einer Wissensbasis aus dem Dokument neu ableiten
 * (FTS5 folgt per Trigger). Die unveränderte Vorlage ergibt keine Abschnitte.
 */
function rebuildKnowledgeSections(knowledgeBaseId: number, document: string, kbName: string): number {
  const db = getDb();
  db.prepare(`DELETE FROM ${WORKFLOW_KNOWLEDGE_SECTIONS_TABLE} WHERE knowledge_base_id = ?`).run(knowledgeBaseId);
  if (document.trimEnd() === defaultMarkdownTemplate(kbName).trimEnd()) return 0;
  const sections = deriveKnowledgeSections(document, kbName);
  const insert = db.prepare(
    `INSERT INTO ${WORKFLOW_KNOWLEDGE_SECTIONS_TABLE} (knowledge_base_id, position, title, content, built_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const builtAt = new Date().toISOString();
  for (const section of sections) insert.run(knowledgeBaseId, section.position, section.title, section.content, builtAt);
  return sections.length;
}

/**
 * Plan 048: baut die Abschnitte einer Wissensbasis nach, wenn sie noch keine
 * hat (Bestand vor dem Suchindex). true = neu gebaut.
 */
export function ensureKnowledgeSections(knowledgeBaseId: number): boolean {
  const db = getDb();
  const existing = db
    .prepare(`SELECT 1 FROM ${WORKFLOW_KNOWLEDGE_SECTIONS_TABLE} WHERE knowledge_base_id = ? LIMIT 1`)
    .get(knowledgeBaseId);
  if (existing) return false;
  const kb = getKnowledgeBaseById(knowledgeBaseId);
  if (!kb) return false;
  const document = getKnowledgeBaseDocument(knowledgeBaseId);
  if (!document) return false;
  return db.transaction(() => rebuildKnowledgeSections(knowledgeBaseId, document.content, kb.name))() > 0;
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
  getDb().prepare(`DELETE FROM ${WORKFLOW_KNOWLEDGE_SECTIONS_TABLE} WHERE knowledge_base_id = ?`).run(id);
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
  // Eine explizit gewählte Wissensbasis ergänzt die Kontext-Wissensbasen der
  // Richtung — die Learnings eingeschlossen — statt sie zu ersetzen (wie Server).
  for (const id of listKnowledgeBaseIdsForWorkflow(accountId, direction)) {
    kbIds.add(id);
  }
  // Je Wissensbasis gedeckelt, nicht insgesamt: sonst fielen die zuletzt
  // gelesenen (Learnings) heraus. Das Zeichenbudget verteilt joinKnowledgeWithinBudget.
  const merged: KnowledgeChunkRow[] = [];
  const perKb = Math.max(1, Math.ceil(limit / Math.max(1, kbIds.size)));
  for (const kbId of kbIds) {
    merged.push(...await searchKnowledgeChunks(kbId, query, perKb));
  }
  return merged;
}

type KnowledgeSectionRow = {
  id: number;
  knowledge_base_id: number;
  title: string;
  content: string;
  embedding_json: string | null;
};

function sectionToChunkRow(row: KnowledgeSectionRow, knowledgeBaseName: string | null): KnowledgeChunkRow {
  return {
    id: row.id,
    knowledge_base_id: row.knowledge_base_id,
    knowledge_base_name: knowledgeBaseName,
    title: row.title,
    content: row.content,
    source_path: null,
  };
}

/**
 * Plan 048: Suche je `##`-Abschnitt. Kleine Wissensbasen (≤ 6 000 Zeichen)
 * gehen ganz mit; sonst zuerst Einbettungen (falls ein Modell sie geliefert
 * hat), dann Volltext (FTS5, bm25). Ohne Treffer (auch ohne Suchbegriffe, z. B.
 * nur Füllwörter) nichts. Fehlende Abschnitte werden vorher nachgebaut.
 */
export async function searchKnowledgeChunks(
  knowledgeBaseId: number,
  query: string,
  limit = 5,
): Promise<KnowledgeChunkRow[]> {
  const max = Math.max(1, Math.floor(limit));
  ensureKnowledgeSections(knowledgeBaseId);
  const db = getDb();
  const sections = db
    .prepare(
      `SELECT id, knowledge_base_id, title, content, embedding_json FROM ${WORKFLOW_KNOWLEDGE_SECTIONS_TABLE}
       WHERE knowledge_base_id = ? ORDER BY position`,
    )
    .all(knowledgeBaseId) as KnowledgeSectionRow[];
  if (sections.length === 0) return [];
  const kbName = getKnowledgeBaseById(knowledgeBaseId)?.name ?? null;
  const toRow = (row: KnowledgeSectionRow) => sectionToChunkRow(row, kbName);
  const size = sections.reduce((sum, row) => sum + row.title.length + row.content.length, 0);
  if (size <= KNOWLEDGE_SMALL_KB_MAX_CHARS) return sections.map(toRow);

  if (sections.some((row) => row.embedding_json)) {
    const queryVec = await runEmbedding(query);
    if (queryVec) {
      const scored = sections
        .map((row) => {
          const emb = parseEmbedding(row.embedding_json ?? null);
          return { row, score: emb ? cosineSimilarity(queryVec, emb) : 0 };
        })
        .filter((entry) => entry.score > 0.2)
        .sort((a, b) => b.score - a.score);
      if (scored.length > 0) return scored.slice(0, max).map((entry) => toRow(entry.row));
    }
  }

  const terms = buildKnowledgeQueryTerms(query);
  if (terms.length === 0) return [];
  // Nur Buchstaben und Ziffern, jeweils in Anführungszeichen: keine FTS5-Operatoren.
  const match = terms.map((term) => `"${term}"`).join(' OR ');
  const rows = db
    .prepare(
      `SELECT s.id, s.knowledge_base_id, s.title, s.content, s.embedding_json
       FROM ${WORKFLOW_KNOWLEDGE_SECTIONS_FTS_TABLE} f
       JOIN ${WORKFLOW_KNOWLEDGE_SECTIONS_TABLE} s ON s.id = f.rowid
       WHERE ${WORKFLOW_KNOWLEDGE_SECTIONS_FTS_TABLE} MATCH ? AND s.knowledge_base_id = ?
       ORDER BY bm25(${WORKFLOW_KNOWLEDGE_SECTIONS_FTS_TABLE}, 2.0, 1.0), s.position
       LIMIT ?`,
    )
    .all(match, knowledgeBaseId, max) as KnowledgeSectionRow[];
  return rows.map(toRow);
}

/** Plan 048: genutztes Wissen am KI-Entwurf (Freigabe-Hinweis); leer = keine Angabe. */
export function storeDraftAiSources(draftId: number, label: string): void {
  try {
    getDb()
      .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET ai_sources = ? WHERE id = ?`)
      .run(label.trim() ? label.slice(0, 500) : null, draftId);
  } catch (error) {
    console.warn('[knowledge] Quellen am Entwurf nicht gespeichert:', error instanceof Error ? error.message : error);
  }
}

export function knowledgeStorageDir(): string {
  const dir = path.join(app.getPath('userData'), 'workflow-knowledge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
