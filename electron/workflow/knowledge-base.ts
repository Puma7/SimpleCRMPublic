import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getDb } from '../sqlite-service';
import {
  WORKFLOW_KNOWLEDGE_BASES_TABLE,
  WORKFLOW_KNOWLEDGE_CHUNKS_TABLE,
} from '../database-schema';
import { runEmbedding } from '../email/email-openai';

export type KnowledgeBaseRow = {
  id: number;
  name: string;
  description: string | null;
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

export function listKnowledgeBases(): KnowledgeBaseRow[] {
  return getDb()
    .prepare(`SELECT * FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE} ORDER BY name ASC`)
    .all() as KnowledgeBaseRow[];
}

export function createKnowledgeBase(name: string, description?: string | null): number {
  const r = getDb()
    .prepare(
      `INSERT INTO ${WORKFLOW_KNOWLEDGE_BASES_TABLE} (name, description, created_at) VALUES (?, ?, ?)`,
    )
    .run(name.trim(), description ?? null, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function deleteKnowledgeBase(id: number): void {
  getDb().prepare(`DELETE FROM ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} WHERE knowledge_base_id = ?`).run(id);
  getDb().prepare(`DELETE FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE} WHERE id = ?`).run(id);
}

export function addTextChunk(knowledgeBaseId: number, title: string, content: string): number {
  const r = getDb()
    .prepare(
      `INSERT INTO ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE}
       (knowledge_base_id, title, content, source_path, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
    )
    .run(knowledgeBaseId, title, content, new Date().toISOString());
  const id = Number(r.lastInsertRowid);
  void storeEmbedding(id, `${title}\n${content}`);
  return id;
}

export function importFileToKnowledgeBase(knowledgeBaseId: number, filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf8');
  const title = path.basename(filePath);
  const r = getDb()
    .prepare(
      `INSERT INTO ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE}
       (knowledge_base_id, title, content, source_path, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(knowledgeBaseId, title, content.slice(0, 500_000), filePath, new Date().toISOString());
  const id = Number(r.lastInsertRowid);
  void storeEmbedding(id, content.slice(0, 8000));
  return id;
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
