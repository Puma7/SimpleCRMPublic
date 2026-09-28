/**
 * Plan 048 (Desktop): Abschnitte als abgeleiteter Suchindex mit FTS5.
 * Speichern baut sie neu, eine Wissensbasis ohne Abschnitte wird bei Bedarf
 * nachgebaut, Löschen entfernt sie samt Volltext-Einträgen.
 */
jest.mock('../../electron/email/email-openai', () => ({
  runAiDecideCall: jest.fn(),
  runChatCompletion: jest.fn(),
  runEmbedding: jest.fn(async () => null),
}));

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  ensureKnowledgeSections,
  knowledgeStorageDir,
  saveKnowledgeBaseDocument,
  searchKnowledgeChunks,
  searchKnowledgeForWorkflow,
  storeDraftAiSources,
} from '../../electron/workflow/knowledge-base';
import { WORKFLOW_KNOWLEDGE_CHUNKS_TABLE } from '../../electron/database-schema';
import { runEmbedding } from '../../electron/email/email-openai';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
});

afterEach(() => {
  closeDatabase();
});

function sections(kbId: number) {
  return db
    .prepare('SELECT position, title, content FROM workflow_knowledge_sections WHERE knowledge_base_id = ? ORDER BY position')
    .all(kbId);
}

function match(query: string): string[] {
  return (db
    .prepare(
      `SELECT s.title FROM workflow_knowledge_sections_fts f
       JOIN workflow_knowledge_sections s ON s.id = f.rowid
       WHERE workflow_knowledge_sections_fts MATCH ? ORDER BY bm25(workflow_knowledge_sections_fts)`,
    )
    .all(query) as { title: string }[]).map((row) => row.title);
}

test('Speichern baut Abschnitte und Volltext neu', () => {
  const kb = createKnowledgeBase('Firma', null, { knowledgeContext: 'general' });
  saveKnowledgeBaseDocument(kb, '# Firma\n\nVersandhandel.\n\n## Rücksendung\n\nEtikett liegt bei.\n\n## Versand\n\nDHL.\n');
  expect(sections(kb)).toEqual([
    { position: 0, title: 'Firma', content: 'Versandhandel.' },
    { position: 1, title: 'Rücksendung', content: 'Etikett liegt bei.' },
    { position: 2, title: 'Versand', content: 'DHL.' },
  ]);
  // unicode61 remove_diacritics 2: „rucksendung“ findet „Rücksendung“.
  expect(match('"etikett"')).toEqual(['Rücksendung']);
  expect(match('"rucksendung"')).toEqual(['Rücksendung']);

  saveKnowledgeBaseDocument(kb, '## Nur noch\n\nEin Abschnitt.\n');
  expect(sections(kb)).toEqual([{ position: 0, title: 'Nur noch', content: 'Ein Abschnitt.' }]);
  expect(match('"etikett"')).toEqual([]);
  expect(match('"abschnitt"')).toEqual(['Nur noch']);
});

test('Bestand ohne Abschnitte wird bei Bedarf nachgebaut; leere Vorlage ergibt keine', async () => {
  const legacy = createKnowledgeBase('Altbestand', null, { knowledgeContext: 'general' });
  // Altbestand: nur Chunks, keine .md-Datei, keine Abschnitte.
  db.prepare(`DELETE FROM workflow_knowledge_sections WHERE knowledge_base_id = ?`).run(legacy);
  db.prepare(`DELETE FROM ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} WHERE knowledge_base_id = ?`).run(legacy);
  fs.rmSync(path.join(knowledgeStorageDir(), `${legacy}.md`), { force: true });
  db.prepare(`INSERT INTO ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} (knowledge_base_id, title, content) VALUES (?, 'Versand', 'DHL, zwei Tage.')`)
    .run(legacy);
  expect(sections(legacy)).toEqual([]);
  expect(ensureKnowledgeSections(legacy)).toBe(true);
  expect(sections(legacy)).toEqual([{ position: 0, title: 'Versand', content: 'DHL, zwei Tage.' }]);
  expect(ensureKnowledgeSections(legacy)).toBe(false);

  const empty = createKnowledgeBase('Leer', null, { knowledgeContext: 'general' });
  expect(ensureKnowledgeSections(empty)).toBe(false);
  expect(sections(empty)).toEqual([]);
});

// Datei und Suchindex bleiben eine Einheit: scheitert das Schreiben der Datei
// (voller oder schreibgeschützter Datenträger), rollt der Suchindex zurück.
describe('Speichern mit Schreibfehler', () => {
  function chunkContents(kbId: number): string[] {
    return (db
      .prepare(`SELECT content FROM ${WORKFLOW_KNOWLEDGE_CHUNKS_TABLE} WHERE knowledge_base_id = ? ORDER BY id`)
      .all(kbId) as { content: string }[]).map((row) => row.content);
  }

  test.each([
    ['writeFileSync', 'ENOSPC: no space left on device'],
    ['renameSync', 'EROFS: read-only file system'],
  ] as const)('%s scheitert: Fehler kommt an, Suchindex und Datei bleiben beim alten Stand', (fn, message) => {
    const kb = createKnowledgeBase('Firma', null, { knowledgeContext: 'general' });
    saveKnowledgeBaseDocument(kb, '## Rücksendung\n\nEtikett liegt bei.\n');
    const dir = knowledgeStorageDir();
    const filePath = path.join(dir, `${kb}.md`);
    const before = { sections: sections(kb), chunks: chunkContents(kb), file: fs.readFileSync(filePath, 'utf8') };

    const real = fs[fn] as (...args: unknown[]) => unknown;
    const spy = jest.spyOn(fs, fn).mockImplementation(((target: unknown, ...rest: unknown[]) => {
      if (String(target).startsWith(dir)) throw Object.assign(new Error(message), { code: message.split(':')[0] });
      return real.call(fs, target, ...rest);
    }) as never);
    try {
      expect(() => saveKnowledgeBaseDocument(kb, '## Versand\n\nDHL.\n')).toThrow(message);
    } finally {
      spy.mockRestore();
    }

    expect(sections(kb)).toEqual(before.sections);
    expect(chunkContents(kb)).toEqual(before.chunks);
    expect(match('"dhl"')).toEqual([]);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before.file);
    expect(fs.readdirSync(dir).filter((name) => !name.endsWith('.md'))).toEqual([]);
  });
});

test('Löschen der Wissensbasis entfernt Abschnitte und Volltext', () => {
  const kb = createKnowledgeBase('Firma', null, { knowledgeContext: 'general' });
  saveKnowledgeBaseDocument(kb, '## Rücksendung\n\nEtikett liegt bei.\n');
  expect(match('"etikett"')).toEqual(['Rücksendung']);
  deleteKnowledgeBase(kb);
  expect(sections(kb)).toEqual([]);
  expect(match('"etikett"')).toEqual([]);
});

// Phase B: Suche je Abschnitt.
describe('Suche', () => {
  const filler = (n: number) => `Allgemeiner Hinweis ${n}: ${'Lorem ipsum dolor sit amet. '.repeat(14)}`;
  function bigHandbook(): string {
    return ['# Handbuch', ...Array.from({ length: 30 }, (_, n) => (n === 17
      ? '## Rücksendungen\n\nDas Rücksendeetikett liegt jedem Paket bei; Etikett verloren: im Kundenkonto neu drucken.'
      : `## Thema ${n + 1}\n\n${filler(n + 1)}`))].join('\n\n');
  }

  test('große Wissensbasis: nur passende Abschnitte, nach Rang', async () => {
    const kb = createKnowledgeBase('Handbuch', null, { knowledgeContext: 'general' });
    saveKnowledgeBaseDocument(kb, bigHandbook());
    const rows = await searchKnowledgeChunks(kb, 'Wo ist das Etikett für die Rücksendung?', 5);
    expect(rows.map((row) => row.title)).toEqual(['Rücksendungen']);
    expect(rows[0]).toMatchObject({ knowledge_base_id: kb });
    expect(await searchKnowledgeChunks(kb, 'und die der das bitte', 5)).toEqual([]);
    expect(await searchKnowledgeChunks(kb, 'Lorem ipsum', 3)).toHaveLength(3);
  });

  test('kleine Wissensbasis geht ganz mit; Learnings kommen über die Richtung dazu', async () => {
    const general = createKnowledgeBase('Handbuch', null, { knowledgeContext: 'general' });
    saveKnowledgeBaseDocument(general, bigHandbook());
    const learnings = createKnowledgeBase('Learnings', null, { knowledgeContext: 'learnings' });
    saveKnowledgeBaseDocument(learnings, '## Rückgabe\n\nEtikett im Kundenkonto zeigen.\n\n## Ton\n\nSie-Form.\n');
    expect((await searchKnowledgeChunks(learnings, 'völlig anderes Thema', 5)).map((row) => row.title)).toEqual(['Rückgabe', 'Ton']);
    const rows = await searchKnowledgeForWorkflow(null, 'inbound', 'Rücksendung Etikett', 5);
    expect(rows.map((row) => [row.knowledge_base_id, row.title])).toEqual([
      [general, 'Rücksendungen'],
      [learnings, 'Rückgabe'],
      [learnings, 'Ton'],
    ]);
  });

  // Höchstens 50 Abschnitte werden eingebettet (SECTION_EMBEDDINGS_MAX): Solange
  // nicht alle Abschnitte eine Einbettung haben, ergänzt der Volltext die Treffer.
  function longHandbook(): string {
    return ['# Handbuch', ...Array.from({ length: 55 }, (_, n) => (n === 52
      ? '## Rücksendungen\n\nDas Rücksendeetikett liegt jedem Paket bei; Etikett verloren: im Kundenkonto neu drucken.'
      : `## Thema ${n + 1}\n\n${filler(n + 1)}`))].join('\n\n');
  }
  function embed(kbId: number, where: string, vector: number[]): void {
    db.prepare(`UPDATE workflow_knowledge_sections SET embedding_json = ? WHERE knowledge_base_id = ? AND ${where}`)
      .run(JSON.stringify(vector), kbId);
  }
  const returnsQuery = 'Wo ist das Etikett für die Rücksendung?';

  test('teilweise eingebettet: Volltexttreffer jenseits der Einbettungen ergänzen die Treffer', async () => {
    const kb = createKnowledgeBase('Handbuch', null, { knowledgeContext: 'general' });
    saveKnowledgeBaseDocument(kb, longHandbook());
    // Wie storeSectionEmbeddings: nur die ersten 50 Abschnitte haben eine Einbettung.
    embed(kb, 'position < 50', [0, 1]);
    embed(kb, "title = 'Thema 1'", [1, 0]);

    // Ein einziger Einbettungs-Treffer beendet die Suche nicht.
    jest.mocked(runEmbedding).mockResolvedValueOnce([1, 0]);
    expect((await searchKnowledgeChunks(kb, returnsQuery, 5)).map((row) => row.title)).toEqual(['Thema 1', 'Rücksendungen']);

    // Füllen die Einbettungs-Treffer das Limit, verdrängen sie den Volltexttreffer nicht.
    embed(kb, 'position < 50', [1, 0]);
    jest.mocked(runEmbedding).mockResolvedValueOnce([1, 0]);
    const rows = await searchKnowledgeChunks(kb, returnsQuery, 5);
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.title)).toContain('Rücksendungen');
  });

  test('vollständig eingebettet: nur die Einbettungs-Treffer, ohne Volltext', async () => {
    const kb = createKnowledgeBase('Handbuch', null, { knowledgeContext: 'general' });
    saveKnowledgeBaseDocument(kb, bigHandbook());
    embed(kb, '1 = 1', [0, 1]);
    embed(kb, "title = 'Thema 1'", [1, 0]);
    jest.mocked(runEmbedding).mockResolvedValueOnce([1, 0]);
    expect((await searchKnowledgeChunks(kb, returnsQuery, 5)).map((row) => row.title)).toEqual(['Thema 1']);
  });
});

test('Quellen am KI-Entwurf: gespeichert, gekürzt, leer = keine Angabe', () => {
  db.pragma('foreign_keys = OFF');
  db.exec("INSERT INTO email_messages (id, account_id, folder_id, uid, subject, date_received) VALUES (42, 1, 10, 42, 'x', '2026-01-01T00:00:00Z'), (43, 1, 10, 43, 'x', '2026-01-01T00:00:00Z')");
  storeDraftAiSources(42, 'Handbuch › Rücksendungen; Learnings › Rückgabe');
  storeDraftAiSources(43, 'x'.repeat(600));
  const read = (id: number) => (db.prepare('SELECT ai_sources FROM email_messages WHERE id = ?').get(id) as { ai_sources: string | null }).ai_sources;
  expect(read(42)).toBe('Handbuch › Rücksendungen; Learnings › Rückgabe');
  expect(read(43)).toHaveLength(500);
  storeDraftAiSources(42, '   ');
  expect(read(42)).toBeNull();
});
