import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getDb } from '../sqlite-service';
import {
  WORKFLOW_KNOWLEDGE_BASES_TABLE,
  WORKFLOW_KNOWLEDGE_CHUNKS_TABLE,
} from '../database-schema';

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
};

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
  return Number(r.lastInsertRowid);
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
  return Number(r.lastInsertRowid);
}

/** Simple keyword RAG (no embeddings) — sufficient for MVP */
export function searchKnowledgeChunks(
  knowledgeBaseId: number,
  query: string,
  limit = 5,
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

export function knowledgeStorageDir(): string {
  const dir = path.join(app.getPath('userData'), 'workflow-knowledge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
