import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createKnowledgeBase,
  getKnowledgeBaseDocument,
  saveKnowledgeBaseDocument,
} from '../../electron/workflow/knowledge-base';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));

jest.mock('electron', () => ({
  app: { getPath: () => tmpDir },
}));

const chunks: { id: number; knowledge_base_id: number; title: string; content: string }[] = [];
let nextKbId = 0;
let nextChunkId = 0;

jest.mock('../../electron/sqlite-service', () => {
  const bases: { id: number; name: string; description: string | null }[] = [];
  const prepare = jest.fn((sql: string) => ({
    all: (...args: unknown[]) => {
      if (sql.includes('workflow_knowledge_bases') && sql.includes('ORDER BY name')) {
        return bases;
      }
      if (sql.includes('workflow_knowledge_chunks') && sql.includes('ORDER BY id ASC')) {
        const kbId = args[0] as number;
        return chunks.filter((c) => c.knowledge_base_id === kbId);
      }
      return [];
    },
    get: (...args: unknown[]) => {
      if (sql.includes('workflow_knowledge_bases') && sql.includes('WHERE id')) {
        return bases.find((b) => b.id === args[0]);
      }
      if (sql.includes('workflow_knowledge_chunks') && sql.includes('ORDER BY id DESC')) {
        const kbId = args[0] as number;
        const found = chunks.filter((c) => c.knowledge_base_id === kbId).pop();
        return found ? { id: found.id } : undefined;
      }
      return undefined;
    },
    run: (...args: unknown[]) => {
      if (sql.includes('INSERT INTO workflow_knowledge_bases')) {
        const id = ++nextKbId;
        bases.push({ id, name: args[0] as string, description: (args[1] as string) ?? null });
        return { lastInsertRowid: id };
      }
      if (sql.includes('DELETE FROM workflow_knowledge_chunks')) {
        const kbId = args[0] as number;
        for (let i = chunks.length - 1; i >= 0; i--) {
          if (chunks[i]!.knowledge_base_id === kbId) chunks.splice(i, 1);
        }
        return { changes: 1 };
      }
      if (sql.includes('INSERT INTO workflow_knowledge_chunks')) {
        const id = ++nextChunkId;
        chunks.push({
          id,
          knowledge_base_id: args[0] as number,
          title: args[1] as string,
          content: args[2] as string,
        });
        return { lastInsertRowid: id };
      }
      if (sql.includes('UPDATE workflow_knowledge_chunks') && sql.includes('embedding_json')) {
        return { changes: 1 };
      }
      return { changes: 0 };
    },
  }));
  return { getDb: () => ({ prepare }) };
});

jest.mock('../../electron/email/email-openai', () => ({
  runEmbedding: jest.fn(async () => null),
}));

describe('knowledge-base document', () => {
  beforeEach(() => {
    chunks.length = 0;
    nextKbId = 0;
    nextChunkId = 0;
    const kbDir = path.join(tmpDir, 'workflow-knowledge');
    if (fs.existsSync(kbDir)) {
      fs.rmSync(kbDir, { recursive: true, force: true });
    }
  });

  it('creates a markdown file with template on createKnowledgeBase', () => {
    const id = createKnowledgeBase('Retouren');
    const doc = getKnowledgeBaseDocument(id);
    expect(doc).not.toBeNull();
    expect(doc!.content).toContain('# Retouren');
    expect(fs.existsSync(path.join(tmpDir, 'workflow-knowledge', `${id}.md`))).toBe(true);
    expect(chunks).toHaveLength(1);
  });

  it('saveKnowledgeBaseDocument updates file and single chunk', () => {
    const id = createKnowledgeBase('Versand');
    saveKnowledgeBaseDocument(id, '# Versand\n\nNeue FAQ\n');
    const doc = getKnowledgeBaseDocument(id);
    expect(doc!.content).toContain('Neue FAQ');
    expect(chunks.filter((c) => c.knowledge_base_id === id)).toHaveLength(1);
    expect(chunks[0]!.content).toContain('Neue FAQ');
  });
});
