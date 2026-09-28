import type { Kysely } from 'kysely';

import {
  createPostgresWorkflowKnowledgeBaseReadPort,
  createPostgresWorkflowKnowledgeChunkReadPort,
  ensureWorkflowKnowledgeSections,
} from '../../packages/server/src/db/postgres-workflow-runtime-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { withWorkspaceTransaction } from '../../packages/server/src/db/workspace-context';
import { searchKnowledgeForWorkflow, searchKnowledgeSections } from '../../packages/server/src/knowledge-workflow-search';
import { draftReplyKnowledgeText } from '../../packages/server/src/workflow-ai-draft-nodes';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

/**
 * Plan 048 (Server): Abschnitte als abgeleiteter Suchindex. Speichern baut sie
 * neu, Chunk-Änderungen ebenso; Bestand ohne Abschnitte wird bei Bedarf
 * nachgebaut; RLS trennt Workspaces; die Konfiguration `german` ist vorhanden.
 */
const WS_A = '10000000-0000-4000-8000-0000000000d1';
const WS_B = '10000000-0000-4000-8000-0000000000d2';
const USER_A = '20000000-0000-4000-8000-0000000000d1';
const KB_A = 951;
const KB_LEGACY = 952;
const KB_B = 953;
const KB_RACE = 954;
const KB_RACE_SAVE = 955;
const KB_RACE_CHUNK = 956;
const WS_C = '10000000-0000-4000-8000-0000000000d3';
const KB_GENERAL = 961;
const KB_INBOUND = 962;
const KB_LEARNINGS = 963;

describe('Server: Wissensbasis-Abschnitte', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('knowledge-sections');
    const { admin } = postgres;
    for (const [ws, name] of [[WS_A, 'KB A'], [WS_B, 'KB B']] as const) {
      await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [ws, name]);
    }
    await admin.query(`
      INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
      VALUES ($1, $2, 'owner@example.test', 'Owner', 'x', 'owner')
    `, [USER_A, WS_A]);
    for (const [id, ws, name] of [[KB_A, WS_A, 'Firma'], [KB_LEGACY, WS_A, 'Altbestand'], [KB_B, WS_B, 'Fremd']] as const) {
      await admin.query(`
        INSERT INTO workflow_knowledge_bases (id, workspace_id, source_sqlite_id, name, knowledge_context)
        VALUES ($1, $2, $1, $3, 'general')
      `, [id, ws, name]);
    }
    // Bestand (vor Plan 048 bzw. SQLite-Import): Chunk ohne Abschnitte.
    await admin.query(`
      INSERT INTO workflow_knowledge_chunks (workspace_id, source_sqlite_id, knowledge_base_source_sqlite_id, knowledge_base_id, title, content)
      VALUES ($1, 9801, $2, $2, 'Dokument', $3), ($4, 9802, $5, $5, 'Dokument', $6)
    `, [WS_A, KB_LEGACY, '# Altbestand\n\n## Versand\n\nDHL.\n\n## Rückgabe\n\n30 Tage.\n', WS_B, KB_B, '## Geheim\n\nNur B.\n']);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  async function sections(kbId: number): Promise<Array<{ position: number; title: string; content: string }>> {
    const rows = await postgres.admin.query<{ position: number; title: string; content: string }>(
      `SELECT position, title, content FROM workflow_knowledge_sections WHERE knowledge_base_id = $1 ORDER BY position`,
      [kbId],
    );
    return rows.rows;
  }

  test('die Konfiguration german ist vorhanden', async () => {
    const config = await postgres.admin.query(`SELECT 1 FROM pg_ts_config WHERE cfgname = 'german'`);
    expect(config.rows).toHaveLength(1);
  });

  test('Speichern baut die Abschnitte neu; Titel und Inhalt sind durchsuchbar (german)', async () => {
    const port = createPostgresWorkflowKnowledgeBaseReadPort({ db });
    await port.saveDocument!({
      workspaceId: WS_A,
      actorUserId: USER_A,
      id: KB_A,
      content: '# Firma\n\nVersandhandel für Jacken.\n\n## Rücksendungen\n\nEtikett liegt dem Paket bei.\n\n## Versand\n\nDHL, zwei Tage.\n',
    });
    expect(await sections(KB_A)).toEqual([
      { position: 0, title: 'Firma', content: 'Versandhandel für Jacken.' },
      { position: 1, title: 'Rücksendungen', content: 'Etikett liegt dem Paket bei.' },
      { position: 2, title: 'Versand', content: 'DHL, zwei Tage.' },
    ]);
    // german: „Rücksendung“ findet „Rücksendungen“ (Stammform).
    const hit = await postgres.admin.query<{ title: string }>(
      `SELECT title FROM workflow_knowledge_sections WHERE knowledge_base_id = $1 AND search_vector @@ to_tsquery('german', $2)`,
      [KB_A, 'rücksendung'],
    );
    expect(hit.rows).toEqual([{ title: 'Rücksendungen' }]);

    await port.saveDocument!({ workspaceId: WS_A, actorUserId: USER_A, id: KB_A, content: '## Nur noch\n\nEin Abschnitt.\n' });
    expect(await sections(KB_A)).toEqual([{ position: 0, title: 'Nur noch', content: 'Ein Abschnitt.' }]);
  });

  test('Bestand ohne Abschnitte wird bei Bedarf nachgebaut, danach nicht erneut', async () => {
    expect(await sections(KB_LEGACY)).toEqual([]);
    const first = await withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, (trx) =>
      ensureWorkflowKnowledgeSections(trx, WS_A, [KB_LEGACY, KB_A], new Date()));
    expect(first).toEqual([KB_LEGACY]);
    expect((await sections(KB_LEGACY)).map((row) => row.title)).toEqual(['Versand', 'Rückgabe']);
    const second = await withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, (trx) =>
      ensureWorkflowKnowledgeSections(trx, WS_A, [KB_LEGACY, KB_A], new Date()));
    expect(second).toEqual([]);
  });

  test('Chunk-API: Anlegen, Ändern und Löschen bauen neu', async () => {
    const chunks = createPostgresWorkflowKnowledgeChunkReadPort({ db });
    const created = await chunks.create!({
      workspaceId: WS_A,
      actorUserId: USER_A,
      values: { knowledgeBaseId: KB_A, title: 'Zahlung', content: 'Rechnung oder PayPal.' },
    });
    if (!created.ok) throw new Error(created.code);
    expect((await sections(KB_A)).map((row) => row.title)).toEqual(['Nur noch', 'Zahlung']);
    await chunks.update!({ workspaceId: WS_A, actorUserId: USER_A, id: created.chunk.id, values: { title: 'Bezahlung' } });
    expect((await sections(KB_A)).map((row) => row.title)).toEqual(['Nur noch', 'Bezahlung']);
    await chunks.delete!({ workspaceId: WS_A, actorUserId: USER_A, id: created.chunk.id });
    expect((await sections(KB_A)).map((row) => row.title)).toEqual(['Nur noch']);
  });

  // Zwei Läufe bauen denselben Bestand gleichzeitig nach, oder jemand speichert,
  // während ein Lauf (mit offener Transaktion bis zur KI-Antwort) nachbaut:
  // ohne Sperre scheiterte der zweite an der Eindeutigkeit (Position je Wissensbasis).
  test('gleichzeitiges Nachbauen: der zweite Lauf wartet nicht und scheitert nicht', async () => {
    await postgres.admin.query(`
      INSERT INTO workflow_knowledge_bases (id, workspace_id, source_sqlite_id, name, knowledge_context)
      VALUES ($1, $2, $1, 'Parallel', 'general')
    `, [KB_RACE, WS_A]);
    await postgres.admin.query(`
      INSERT INTO workflow_knowledge_chunks (workspace_id, source_sqlite_id, knowledge_base_source_sqlite_id, knowledge_base_id, title, content)
      VALUES ($1, 9803, $2, $2, 'Dokument', '## Eins\n\nA.\n\n## Zwei\n\nB.\n')
    `, [WS_A, KB_RACE]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let built!: () => void;
    const rebuilt = new Promise<void>((resolve) => { built = resolve; });
    const first = withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, async (trx) => {
      const ids = await ensureWorkflowKnowledgeSections(trx, WS_A, [KB_RACE], new Date());
      built();
      await held;
      return ids;
    });
    await rebuilt;
    const second = withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, (trx) =>
      ensureWorkflowKnowledgeSections(trx, WS_A, [KB_RACE], new Date()));
    const outcome = await Promise.race([
      second.then((ids) => ({ ids }), (error: unknown) => ({ error: String(error) })),
      new Promise((resolve) => setTimeout(() => resolve('wartet'), 1_500)),
    ]);
    release();
    await expect(first).resolves.toEqual([KB_RACE]);
    await second.catch(() => undefined);
    expect(outcome).toEqual({ ids: [] });
    expect((await sections(KB_RACE)).map((row) => row.title)).toEqual(['Eins', 'Zwei']);
  });

  test('Speichern während eines Nachbaus wartet und gewinnt (Dokument und Chunk-API)', async () => {
    for (const [id, name] of [[KB_RACE_SAVE, 'Parallel 2'], [KB_RACE_CHUNK, 'Parallel 3']] as const) {
      await postgres.admin.query(`
        INSERT INTO workflow_knowledge_bases (id, workspace_id, source_sqlite_id, name, knowledge_context)
        VALUES ($1, $2, $1, $3, 'general')
      `, [id, WS_A, name]);
      await postgres.admin.query(`
        INSERT INTO workflow_knowledge_chunks (workspace_id, source_sqlite_id, knowledge_base_source_sqlite_id, knowledge_base_id, title, content)
        VALUES ($1, $2, $3, $3, 'Dokument', '## Alt\n\nAlt.\n')
      `, [WS_A, 9800 + id, id]);
    }
    const port = createPostgresWorkflowKnowledgeBaseReadPort({ db });
    const chunks = createPostgresWorkflowKnowledgeChunkReadPort({ db });
    const writes = [
      {
        kbId: KB_RACE_SAVE,
        write: () => port.saveDocument!({ workspaceId: WS_A, actorUserId: USER_A, id: KB_RACE_SAVE, content: '## Neu\n\nNeu.\n' }),
        titles: ['Neu'],
      },
      {
        kbId: KB_RACE_CHUNK,
        write: () => chunks.create!({
          workspaceId: WS_A,
          actorUserId: USER_A,
          values: { knowledgeBaseId: KB_RACE_CHUNK, title: 'Zahlung', content: 'Rechnung.' },
        }),
        titles: ['Alt', 'Zahlung'],
      },
    ];
    for (const { kbId, write, titles } of writes) {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let built!: () => void;
      const rebuilt = new Promise<void>((resolve) => { built = resolve; });
      const run = withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, async (trx) => {
        await ensureWorkflowKnowledgeSections(trx, WS_A, [kbId], new Date());
        built();
        await held;
      });
      await rebuilt;
      const settled = write().then(() => 'gespeichert', (error: unknown) => `Fehler: ${String(error)}`);
      // Erst freigeben, wenn das Speichern nachweislich auf den Lauf wartet.
      let waited = false;
      for (let attempt = 0; attempt < 100 && !waited; attempt += 1) {
        waited = (await postgres.admin.query(`SELECT 1 FROM pg_locks WHERE NOT granted`)).rows.length > 0;
        if (!waited) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      release();
      await run;
      expect({ kbId, waited, outcome: await settled }).toEqual({ kbId, waited: true, outcome: 'gespeichert' });
      expect((await sections(kbId)).map((row) => row.title)).toEqual(titles);
    }
  });

  test('RLS: Workspace A sieht und baut keine Abschnitte von B', async () => {
    const rebuilt = await withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, (trx) =>
      ensureWorkflowKnowledgeSections(trx, WS_A, [KB_B], new Date()));
    expect(rebuilt).toEqual([]);
    const visible = await withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, (trx) =>
      trx.selectFrom('workflow_knowledge_sections').select('knowledge_base_id').where('knowledge_base_id', '=', KB_B).execute());
    expect(visible).toEqual([]);
    const built = await withWorkspaceTransaction(db, { workspaceId: WS_B, role: 'system' }, (trx) =>
      ensureWorkflowKnowledgeSections(trx, WS_B, [KB_B], new Date()));
    expect(built).toEqual([KB_B]);
    const fromA = await withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, (trx) =>
      trx.selectFrom('workflow_knowledge_sections').select('knowledge_base_id').where('knowledge_base_id', '=', KB_B).execute());
    expect(fromA).toEqual([]);
  });

  // Phase B: Suche je Abschnitt mit Rangfolge und garantiertem Learnings-Anteil.
  describe('Suche', () => {
    const filler = (n: number) => `Allgemeiner Hinweis ${n}: ${'Lorem ipsum dolor sit amet. '.repeat(14)}`;
    beforeAll(async () => {
      const { admin } = postgres;
      await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'KB C')`, [WS_C]);
      for (const [id, name, context] of [
        [KB_GENERAL, 'Handbuch', 'general'],
        [KB_INBOUND, 'Eingang', 'inbound'],
        [KB_LEARNINGS, 'Learnings', 'learnings'],
      ] as const) {
        await admin.query(`
          INSERT INTO workflow_knowledge_bases (id, workspace_id, source_sqlite_id, name, knowledge_context)
          VALUES ($1, $2, $1, $3, $4)
        `, [id, WS_C, name, context]);
      }
      const general = [
        '# Handbuch',
        ...Array.from({ length: 30 }, (_, n) => (n === 17
          ? '## Rücksendungen\n\nDas Rücksendeetikett liegt jedem Paket bei; Etikett verloren: im Kundenkonto neu drucken.'
          : `## Thema ${n + 1}\n\n${filler(n + 1)}`)),
      ].join('\n\n');
      const inbound = ['# Eingang', ...Array.from({ length: 20 }, (_, n) => `## Eingang ${n + 1}\n\n${filler(n + 100)}`)].join('\n\n');
      for (const [id, content, sourceId] of [
        [KB_GENERAL, general, 9811],
        [KB_INBOUND, inbound, 9812],
        [KB_LEARNINGS, '## Rückgabe\n\nEtikett im Kundenkonto zeigen, nicht per Mail schicken.', 9813],
      ] as const) {
        await admin.query(`
          INSERT INTO workflow_knowledge_chunks (workspace_id, source_sqlite_id, knowledge_base_source_sqlite_id, knowledge_base_id, title, content)
          VALUES ($1, $2, $3, $3, 'Dokument', $4)
        `, [WS_C, sourceId, id, content]);
      }
      expect(general.length + inbound.length).toBeGreaterThan(12_000);
    });

    const inWsC = <T>(run: (trx: Parameters<Parameters<typeof withWorkspaceTransaction>[2]>[0]) => Promise<T>) =>
      withWorkspaceTransaction(db, { workspaceId: WS_C, role: 'system' }, run);

    test('nur passende Abschnitte der großen Wissensbasis, Learnings dabei, Reihenfolge der Wissensbasen', async () => {
      const matches = await inWsC((trx) => searchKnowledgeForWorkflow(trx, WS_C, null, 'inbound', 'Rücksendung Etikett verloren', 5));
      expect(matches.map((match) => [match.knowledgeBaseId, match.title])).toEqual([
        [KB_GENERAL, 'Rücksendungen'],
        [KB_LEARNINGS, 'Rückgabe'],
      ]);
      expect(matches[0]).toMatchObject({ knowledgeBaseName: 'Handbuch' });
    });

    test('nur Füllwörter: große Wissensbasen liefern nichts, kleine ganz', async () => {
      const matches = await inWsC((trx) => searchKnowledgeSections(trx, WS_C, [KB_GENERAL, KB_LEARNINGS], 'und die der das bitte', 3));
      expect(matches.map((match) => match.knowledgeBaseId)).toEqual([KB_LEARNINGS]);
    });

    test('Entwurf: der Learnings-Treffer übersteht große allgemeine Wissensbasen', async () => {
      const matches = await inWsC((trx) => searchKnowledgeForWorkflow(trx, WS_C, null, 'inbound', 'Lorem ipsum Rücksendung Etikett', 5));
      expect(matches.some((match) => match.knowledgeBaseId === KB_LEARNINGS)).toBe(true);
      const text = draftReplyKnowledgeText(matches);
      expect(text).toContain('Etikett im Kundenkonto zeigen');
      expect(text.length).toBeLessThanOrEqual(12_000 + 16);
    });
  });
});
