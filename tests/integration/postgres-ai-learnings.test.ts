import type { Kysely } from 'kysely';

import {
  acceptAiLearningDigest,
  createAiLearningNote,
  executeServerLearningsDigestNode,
  getAiLearningDigest,
  getAiLearningsOverview,
  listAiLearningCandidates,
  pruneAiLearningCandidates,
  rejectAiLearningDigest,
  runAiLearningsDigest,
  saveAiLearningsSettings,
} from '../../packages/server/src/ai-learnings';
import {
  loadWorkflowKnowledgeDocument,
  saveWorkflowKnowledgeDocument,
} from '../../packages/server/src/db/postgres-workflow-runtime-read-ports';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import { withWorkspaceTransaction } from '../../packages/server/src/db/workspace-context';
import { createPostgresEmailComposeSenderPort } from '../../packages/server/src/mail-compose-send';
import { markDraftOrigin } from '../../packages/server/src/mail-sent-provenance';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { buildKnowledgePromptAppend, searchKnowledgeForWorkflow } from '../../packages/server/src/knowledge-workflow-search';
import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(180_000);

const WS_A = '10000000-0000-4000-8000-0000000000a5';
const WS_B = '10000000-0000-4000-8000-0000000000b5';
const USER_A = '20000000-0000-4000-8000-0000000000a5';
const ACCOUNT_ID = 951;
const FOLDER_ID = 961;
const KB_ID = 971;

type Row = Record<string, unknown>;

describe('TA-P5 Learnings (PostgreSQL)', () => {
  let postgres: EmbeddedPostgres;
  let db: Kysely<ServerDatabase>;
  let nextMessageId = 9500;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('ai-learnings');
    const { admin } = postgres;
    await admin.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Learnings A'), ($2, 'Learnings B')`, [WS_A, WS_B]);
    await admin.query(`
      INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
      VALUES ($1, $2, 'erika@firma.test', 'Erika Beispiel', 'x', 'admin')
    `, [USER_A, WS_A]);
    await admin.query(`
      INSERT INTO email_accounts (
        id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username,
        smtp_host, smtp_port, smtp_tls, smtp_username, smtp_use_imap_auth
      ) VALUES ($1, $2, $1, 'Support', 'support@firma.test', 'imap.firma.test', 'support',
        'smtp.firma.test', 587, true, 'support', false)
    `, [ACCOUNT_ID, WS_A]);
    await admin.query(`
      INSERT INTO email_folders (id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path)
      VALUES ($1, $2, $1, $3, $3, 'INBOX')
    `, [FOLDER_ID, WS_A, ACCOUNT_ID]);
    await admin.query(`
      INSERT INTO workflow_knowledge_bases (id, workspace_id, source_sqlite_id, name, knowledge_context, account_id)
      VALUES ($1, $2, $1, 'Firma', 'inbound', NULL)
    `, [KB_ID, WS_A]);
    await admin.query(`
      INSERT INTO workflow_knowledge_chunks (workspace_id, source_sqlite_id, knowledge_base_source_sqlite_id, knowledge_base_id, title, content)
      VALUES ($1, 9711, $2, $2, 'Dokument', $3)
    `, [WS_A, KB_ID, '# Firma\n\n## Rückgabe\n\n14 Tage.\n']);
    db = postgres.createApplicationDb();
  });

  afterAll(async () => {
    if (db) await db.destroy();
    if (postgres) await postgres.stop();
  });

  beforeEach(async () => {
    await postgres.admin.query('DELETE FROM ai_learning_candidates');
    await postgres.admin.query('DELETE FROM ai_learning_digests');
    await postgres.admin.query('DELETE FROM job_queue');
    await postgres.admin.query(`DELETE FROM sync_info WHERE key LIKE 'learnings%'`);
    await postgres.admin.query(`DELETE FROM workflow_knowledge_bases WHERE workspace_id = $1 AND id <> $2`, [WS_A, KB_ID]);
  });

  async function setCollect(enabled: boolean): Promise<void> {
    await saveAiLearningsSettings({ db }, WS_A, { collectEnabled: enabled });
  }

  async function seedInbound(): Promise<number> {
    const id = nextMessageId++;
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, from_json, body_text, folder_kind
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $1, 'Rückgabe Jacke', $5::jsonb, $6, 'inbox')
    `, [
      id, WS_A, ACCOUNT_ID, FOLDER_ID,
      JSON.stringify({ value: [{ name: 'Max Mustermann', address: 'max@kunde.test' }] }),
      'Hallo,\n\nich bin Max Mustermann (Kd.-Nr. 12345). Kann ich die Jacke zurückgeben?\n\nGruß\nMax',
    ]);
    return id;
  }

  async function seedDraft(parentId: number | null, options: { snapshot?: string; body?: string } = {}): Promise<number> {
    const id = nextMessageId++;
    await postgres.admin.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
        account_id, folder_id, uid, subject, to_json, body_text, folder_kind, reply_parent_message_id, ai_suggestion_snapshot
      ) VALUES ($1, $2, $1, $3, $4, $3, $4, $5, 'AW: Rückgabe Jacke', $6::jsonb, $7, 'draft', $8, $9)
    `, [
      id, WS_A, ACCOUNT_ID, FOLDER_ID, -id,
      JSON.stringify({ value: [{ name: 'Max Mustermann', address: 'max@kunde.test' }] }),
      options.body ?? 'Entwurf',
      parentId,
      options.snapshot ?? null,
    ]);
    return id;
  }

  /** by 'workflow': Versand eines Workflows ohne Menschen (Trusted Service). */
  async function send(
    draftId: number,
    bodyText: string,
    parentId: number | null,
    by: 'human' | 'workflow' = 'human',
  ): Promise<void> {
    const sender = createPostgresEmailComposeSenderPort({
      db,
      secrets: { async readSecret() { return Buffer.from('smtp-secret'); } } as never,
      smtpSend: async () => undefined,
      outboundReview: { async review() { return { allowed: true }; } },
    });
    const result = await sender.send({
      workspaceId: WS_A,
      ...(by === 'human' ? { actorUserId: USER_A } : { actorUserId: 'system', trustedService: true }),
      values: {
        accountId: ACCOUNT_ID,
        draftMessageId: draftId,
        to: 'Max Mustermann <max@kunde.test>',
        subject: 'AW: Rückgabe Jacke',
        bodyText,
        ...(parentId ? { inReplyToMessageId: parentId } : {}),
      },
    });
    expect(result).toMatchObject({ ok: true });
  }

  async function candidates(): Promise<Row[]> {
    return (await postgres.admin.query(
      'SELECT kind, question_text, ai_text, human_text, note_text, sent_message_id, source_message_id, processed_at, digest_id FROM ai_learning_candidates ORDER BY id',
    )).rows as Row[];
  }

  async function seedCandidates(count: number, workspaceId = WS_A): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await postgres.admin.query(`
        INSERT INTO ai_learning_candidates (workspace_id, kind, question_text, human_text, created_at)
        VALUES ($1, 'human_reply', $2, $3, now() - ($4 || ' minutes')::interval)
      `, [workspaceId, `Betreff: Frage ${i}`, `Antwort ${i}: Rückgabe 30 Tage.`, String(i)]);
    }
  }

  test('Migration: RLS trennt Workspaces, höchstens ein offener Vorschlag je Wissensbasis', async () => {
    await seedCandidates(1, WS_A);
    await seedCandidates(2, WS_B);
    const seenFromA = await withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, async (trx) => trx
      .selectFrom('ai_learning_candidates').select('workspace_id').execute());
    expect(seenFromA.map((row) => row.workspace_id)).toEqual([WS_A]);
    const policies = await postgres.admin.query(`
      SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('ai_learning_candidates', 'ai_learning_digests') ORDER BY tablename
    `);
    expect(policies.rows).toEqual([
      { tablename: 'ai_learning_candidates', policyname: 'ai_learning_candidates_workspace_isolation' },
      { tablename: 'ai_learning_digests', policyname: 'ai_learning_digests_workspace_isolation' },
    ]);
    const insertPending = () => postgres.admin.query(`
      INSERT INTO ai_learning_digests (workspace_id, knowledge_base_id, status, trigger, period_to)
      VALUES ($1, $2, 'pending', 'manual', now())
    `, [WS_A, KB_ID]);
    await insertPending();
    await expect(insertPending()).rejects.toThrow(/ai_learning_digests_one_pending_idx/);
  });

  test('Sammeln beim Versand: geänderter KI-Entwurf wird bereinigt gespeichert, Schnappschuss danach genullt', async () => {
    await setCollect(true);
    const parent = await seedInbound();
    const draft = await seedDraft(parent, { snapshot: 'Die Rückgabe ist innerhalb von 14 Tagen möglich.' });
    await send(draft, 'Hallo Herr Mustermann,\n\nDie Rückgabe ist innerhalb von 30 Tagen kostenlos möglich, das Etikett liegt im Kundenkonto.\n\nViele Grüße\nErika Beispiel', parent);

    const rows = await candidates();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'draft_edit',
      ai_text: 'Die Rückgabe ist innerhalb von 14 Tagen möglich.',
      human_text: 'Die Rückgabe ist innerhalb von 30 Tagen kostenlos möglich, das Etikett liegt im Kundenkonto.',
      sent_message_id: String(draft),
      source_message_id: String(parent),
    });
    expect(String(rows[0]!.question_text)).toBe('Betreff: Rückgabe Jacke\n\nich bin [Name] (Kd.-Nr. [Nummer]). Kann ich die Jacke zurückgeben?');
    const draftRow = await postgres.admin.query('SELECT folder_kind, ai_suggestion_snapshot FROM email_messages WHERE id = $1', [draft]);
    expect(draftRow.rows[0]).toEqual({ folder_kind: 'sent', ai_suggestion_snapshot: null });
    const feedback = await postgres.admin.query('SELECT count(*)::int AS n FROM ai_reply_feedback WHERE message_id = $1', [draft]);
    expect(feedback.rows[0]).toEqual({ n: 1 });
  });

  test('Sammeln: menschliche Antwort ja, unverändert/automatisch/ausgeschaltet nein, kein Duplikat', async () => {
    await setCollect(true);
    const parent = await seedInbound();
    const human = await seedDraft(parent);
    await send(human, 'Ja, gerne. Das Etikett liegt im Kundenkonto.', parent);

    const unchanged = await seedDraft(parent, { snapshot: 'Das Etikett liegt im Kundenkonto.' });
    await send(unchanged, 'Hallo,\n\nDas Etikett liegt im Kundenkonto.\n\nGruß', parent);

    const automatic = await seedDraft(parent);
    await postgres.admin.query(`
      INSERT INTO sync_info (workspace_id, key, value, last_updated) VALUES ($1, $2, '1', now())
    `, [WS_A, `email_auto_submitted:${automatic}`]);
    await send(automatic, 'Automatische Antwort: Danke für Ihre Nachricht.', parent);

    const withoutParent = await seedDraft(null);
    await send(withoutParent, 'Neue Mail ohne Bezug.', null);

    expect((await candidates()).map((row) => row.kind)).toEqual(['human_reply']);

    await setCollect(false);
    const off = await seedDraft(parent);
    await send(off, 'Noch eine Antwort.', parent);
    expect(await candidates()).toHaveLength(1);
  });

  test('Sammeln: nur von Menschen gesendete Mails zählen (Kennzeichnung „gesendet von“)', async () => {
    await setCollect(true);
    await postgres.admin.query('DELETE FROM ai_learning_candidates WHERE workspace_id = $1', [WS_A]);
    const parent = await seedInbound();
    const changedText = 'Hallo Herr Mustermann,\n\nDie Rückgabe ist innerhalb von 30 Tagen kostenlos möglich, das Etikett liegt im Kundenkonto.\n\nViele Grüße';
    const origin = (draftId: number, kind: 'ai' | 'workflow') => withWorkspaceTransaction(
      db,
      { workspaceId: WS_A, role: 'system' },
      async (trx) => markDraftOrigin(trx, { workspaceId: WS_A, draftId, kind, workflowId: null }),
    );

    // KI-Entwurf unverändert von einem Menschen gesendet (ai_approved): kein Kandidat,
    // auch wenn der Text vom Schnappschuss abweicht.
    const approved = await seedDraft(parent, { snapshot: 'Die Rückgabe ist innerhalb von 14 Tagen möglich.' });
    await origin(approved, 'ai');
    await send(approved, changedText, parent);
    // KI-Entwurf automatisch von einem Workflow gesendet (ai_auto): kein Kandidat.
    const auto = await seedDraft(parent, { snapshot: 'Die Rückgabe ist innerhalb von 14 Tagen möglich.' });
    await origin(auto, 'ai');
    await send(auto, changedText, parent, 'workflow');
    // Workflow-Antwort ohne KI und ohne RFC-3834-Marker (workflow): keine „menschliche Antwort“.
    const workflow = await seedDraft(parent);
    await origin(workflow, 'workflow');
    await send(workflow, 'Danke, wir melden uns.', parent, 'workflow');
    expect(await candidates()).toEqual([]);
    const kinds = await postgres.admin.query(
      'SELECT id::int AS id, sent_by_kind FROM email_messages WHERE id = ANY($1::bigint[]) ORDER BY id',
      [[approved, auto, workflow]],
    );
    expect(kinds.rows.map((row) => row.sent_by_kind)).toEqual(['ai_approved', 'ai_auto', 'workflow']);

    // Vom Menschen geänderter KI-Entwurf (human): draft_edit.
    const edited = await seedDraft(parent, { snapshot: 'Die Rückgabe ist innerhalb von 14 Tagen möglich.' });
    await origin(edited, 'ai');
    await postgres.admin.query('UPDATE email_messages SET draft_origin_edited = true WHERE id = $1', [edited]);
    await send(edited, changedText, parent);
    expect((await candidates()).map((row) => [row.kind, row.sent_message_id])).toEqual([['draft_edit', String(edited)]]);
  });

  test('Notiz: auch ohne Sammeln, mit Mail-Bezug bereinigt; unbekannte Mail → Fehler', async () => {
    const parent = await seedInbound();
    const note = await createAiLearningNote({ db }, {
      workspaceId: WS_A,
      actorUserId: USER_A,
      text: 'Max Mustermann ruft oft an (0761 123456) — Rückgaben immer mit Etikett aus dem Kundenkonto.',
      messageId: parent,
    });
    expect(note.ok).toBe(true);
    if (!note.ok) return;
    expect(note.candidate).toMatchObject({
      kind: 'note',
      noteText: '[Name] ruft oft an ([Telefon]) — Rückgaben immer mit Etikett aus dem Kundenkonto.',
      sourceMessageId: parent,
      createdByUserId: USER_A,
    });
    await expect(createAiLearningNote({ db }, { workspaceId: WS_A, actorUserId: USER_A, text: 'x', messageId: 999_999 }))
      .resolves.toEqual({ ok: false, code: 'message_not_found' });
    await expect(createAiLearningNote({ db }, { workspaceId: WS_A, actorUserId: USER_A, text: '   ' }))
      .resolves.toEqual({ ok: false, code: 'empty_note' });
  });

  test('Auswerten: legt „Learnings“ an, Vorschlag, dann „bereits offen“; zu wenige; Fehler lässt Kandidaten offen', async () => {
    await seedCandidates(1);
    const tooFew = await runAiLearningsDigest({ db, chat: async () => '{}' }, {
      workspaceId: WS_A, period: 'since_last', minCandidates: 3, trigger: 'manual',
    });
    expect(tooFew).toMatchObject({ status: 'skipped_no_candidates', candidateCount: 1, knowledgeBaseId: null });

    await seedCandidates(3);
    const failed = await runAiLearningsDigest({ db, chat: async () => 'kein JSON' }, {
      workspaceId: WS_A, period: 'since_last', minCandidates: 3, trigger: 'manual', actorUserId: USER_A,
    });
    expect(failed).toMatchObject({ status: 'failed', error: 'Antwort der KI enthält kein gültiges JSON' });
    const open = await postgres.admin.query('SELECT count(*)::int AS n FROM ai_learning_candidates WHERE processed_at IS NULL');
    expect(open.rows[0]).toEqual({ n: 4 });

    const chat = jest.fn(async () => JSON.stringify({
      summary: 'Rückgabefrist ergänzt.',
      operations: [{ op: 'add', section: 'Rückgabe', content: 'Innerhalb von 30 Tagen, Etikett im Kundenkonto.' }],
    }));
    const created = await runAiLearningsDigest({ db, chat }, {
      workspaceId: WS_A, period: 'since_last', minCandidates: 3, trigger: 'manual', actorUserId: USER_A,
    });
    expect(created).toMatchObject({ status: 'created', candidateCount: 4 });
    const digest = await getAiLearningDigest({ db }, WS_A, Number(created.digestId));
    expect(digest).toMatchObject({
      status: 'pending',
      summary: 'Rückgabefrist ergänzt.',
      knowledgeBaseName: 'Learnings',
      knowledgeBaseChanged: false,
      requestedByName: 'Erika Beispiel',
    });
    expect(digest!.proposedContent).toContain('## Rückgabe\n\nInnerhalb von 30 Tagen, Etikett im Kundenkonto.');
    const kb = await postgres.admin.query('SELECT name, knowledge_context, override_key, account_id FROM workflow_knowledge_bases WHERE id = $1', [created.knowledgeBaseId]);
    expect(kb.rows[0]).toEqual({ name: 'Learnings', knowledge_context: 'learnings', override_key: 'kb.learnings', account_id: null });

    await seedCandidates(3);
    const pending = await runAiLearningsDigest({ db, chat }, {
      workspaceId: WS_A, period: 'since_last', minCandidates: 1, trigger: 'workflow',
    });
    expect(pending).toMatchObject({ status: 'skipped_pending', digestId: created.digestId });
    expect(chat).toHaveBeenCalledTimes(1);

    const overview = await getAiLearningsOverview({ db }, WS_A);
    expect(overview).toMatchObject({
      counts: { human_reply: 3, total: 3 },
      pendingDigestId: created.digestId,
      effectiveKnowledgeBaseId: created.knowledgeBaseId,
      running: false,
    });
  });

  test('Übernehmen: atomar, Konfliktwarnung bei geänderter Wissensbasis, Kandidaten werden gelöscht', async () => {
    await seedCandidates(2);
    await saveAiLearningsSettings({ db }, WS_A, { targetKnowledgeBaseId: KB_ID });
    const created = await runAiLearningsDigest({
      db,
      chat: async () => JSON.stringify({ summary: 's', operations: [{ op: 'update', section: 'Rückgabe', content: '30 Tage.' }] }),
    }, { workspaceId: WS_A, period: 'week', minCandidates: 1, trigger: 'manual', actorUserId: USER_A });
    expect(created).toMatchObject({ status: 'created', knowledgeBaseId: KB_ID });
    const digestId = Number(created.digestId);

    // Jemand ändert die Wissensbasis zwischenzeitlich (zwei Chunks → nicht atomar gespeichert).
    await postgres.admin.query(`
      INSERT INTO workflow_knowledge_chunks (workspace_id, source_sqlite_id, knowledge_base_source_sqlite_id, knowledge_base_id, title, content)
      VALUES ($1, 9712, $2, $2, 'Versand', '2 Tage.')
    `, [WS_A, KB_ID]);
    const conflict = await acceptAiLearningDigest({ db }, {
      workspaceId: WS_A, actorUserId: USER_A, id: digestId, content: '# Firma\n\n## Rückgabe\n\n30 Tage (bearbeitet).\n',
    });
    expect(conflict).toMatchObject({ ok: false, code: 'knowledge_base_changed' });
    expect((conflict as { currentContent?: string }).currentContent).toContain('## Versand\n\n2 Tage.');

    const accepted = await acceptAiLearningDigest({ db }, {
      workspaceId: WS_A, actorUserId: USER_A, id: digestId, content: '# Firma\n\n## Rückgabe\n\n30 Tage (bearbeitet).', confirmOverwrite: true,
    });
    expect(accepted).toMatchObject({ ok: true, digest: { status: 'accepted', decidedByName: 'Erika Beispiel' }, deletedCandidates: 2 });
    const chunks = await postgres.admin.query('SELECT title, content FROM workflow_knowledge_chunks WHERE knowledge_base_id = $1', [KB_ID]);
    expect(chunks.rows).toEqual([{ title: 'Dokument', content: '# Firma\n\n## Rückgabe\n\n30 Tage (bearbeitet).\n' }]);
    // Gewähltes Ziel behält seinen Kontext.
    const target = await postgres.admin.query('SELECT knowledge_context FROM workflow_knowledge_bases WHERE id = $1', [KB_ID]);
    expect(target.rows[0]).toEqual({ knowledge_context: 'inbound' });
    await expect(acceptAiLearningDigest({ db }, { workspaceId: WS_A, actorUserId: USER_A, id: digestId, content: 'x' }))
      .resolves.toEqual({ ok: false, code: 'not_pending' });
    expect(await listAiLearningCandidates({ db }, WS_A)).toEqual([]);
  });

  test('Verwerfen und Aufräumen', async () => {
    await seedCandidates(2);
    const created = await runAiLearningsDigest({
      db,
      chat: async () => JSON.stringify({ operations: [{ op: 'add', section: 'Ton', content: 'Sie-Form.' }] }),
    }, { workspaceId: WS_A, period: 'since_last', minCandidates: 1, trigger: 'manual' });
    const rejected = await rejectAiLearningDigest({ db }, { workspaceId: WS_A, actorUserId: USER_A, id: Number(created.digestId) });
    expect(rejected).toMatchObject({ ok: true, digest: { status: 'rejected' }, deletedCandidates: 2 });

    await seedCandidates(1);
    await postgres.admin.query(`
      INSERT INTO ai_learning_candidates (workspace_id, kind, note_text, created_at)
      VALUES ($1, 'note', 'uralt', now() - interval '91 days')
    `, [WS_A]);
    expect(await pruneAiLearningCandidates({ db }, WS_A)).toBe(1);
    expect(await listAiLearningCandidates({ db }, WS_A)).toHaveLength(1);
  });

  test('Dokument atomar speichern fasst mehrere Chunks zusammen', async () => {
    await postgres.admin.query(`
      INSERT INTO workflow_knowledge_chunks (workspace_id, source_sqlite_id, knowledge_base_source_sqlite_id, knowledge_base_id, title, content)
      VALUES ($1, 9713, $2, $2, 'Zusatz', 'Mehr.')
    `, [WS_A, KB_ID]);
    const saved = await withWorkspaceTransaction(db, { workspaceId: WS_A, userId: USER_A, role: 'user' }, (trx) =>
      saveWorkflowKnowledgeDocument(trx, WS_A, KB_ID, '# Neu\n\nText', new Date()));
    expect(saved).toMatchObject({ created: false, chunk: { title: 'Dokument' } });
    expect(saved!.removedChunks.length).toBeGreaterThanOrEqual(1);
    const doc = await withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, (trx) =>
      loadWorkflowKnowledgeDocument(trx, WS_A, KB_ID));
    expect(doc?.content).toBe('# Neu\n\nText\n');
    const other = await withWorkspaceTransaction(db, { workspaceId: WS_B, role: 'system' }, (trx) =>
      saveWorkflowKnowledgeDocument(trx, WS_B, KB_ID, 'fremd', new Date()));
    expect(other).toBeNull();
  });

  test('Abruf: Learnings-Basis (eigener Kontext) neben anderer allgemeiner Wissensbasis, Quote je Wissensbasis', async () => {
    const GENERAL_KB = 972;
    await postgres.admin.query(`
      INSERT INTO workflow_knowledge_bases (id, workspace_id, source_sqlite_id, name, knowledge_context, override_key, account_id)
      VALUES ($1, $2, $1, 'Allgemein', 'general', 'kb.general', NULL)
    `, [GENERAL_KB, WS_A]);
    for (const n of [1, 2, 3, 4]) {
      await postgres.admin.query(`
        INSERT INTO workflow_knowledge_chunks (workspace_id, source_sqlite_id, knowledge_base_source_sqlite_id, knowledge_base_id, title, content)
        VALUES ($1, $2, $3, $3, $4, $5)
      `, [WS_A, 9720 + n, GENERAL_KB, `Rückgabe ${n}`, `Rückgabe Hinweis ${n}.`]);
    }
    await withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, (trx) =>
      saveWorkflowKnowledgeDocument(trx, WS_A, KB_ID, '# Firma\n\n## Rückgabe\n\nRückgabe-Anfragen am selben Tag beantworten.', new Date()));

    await seedCandidates(2);
    const created = await runAiLearningsDigest({
      db,
      chat: async () => JSON.stringify({
        operations: [{ op: 'add', section: 'Rückgabe', content: 'Rückgabe innerhalb von 30 Tagen, Etikett im Kundenkonto.' }],
      }),
    }, { workspaceId: WS_A, period: 'since_last', minCandidates: 1, trigger: 'manual', actorUserId: USER_A });
    expect(created).toMatchObject({ status: 'created' });
    const learningsKb = Number(created.knowledgeBaseId);
    const digest = await getAiLearningDigest({ db }, WS_A, Number(created.digestId));
    await expect(acceptAiLearningDigest({ db }, {
      workspaceId: WS_A, actorUserId: USER_A, id: Number(created.digestId), content: digest!.proposedContent,
    })).resolves.toMatchObject({ ok: true });

    const chunkKb = new Map<number, number>();
    const chunkRows = await postgres.admin.query('SELECT id, knowledge_base_id FROM workflow_knowledge_chunks WHERE workspace_id = $1', [WS_A]);
    for (const row of chunkRows.rows as Array<{ id: string | number; knowledge_base_id: string | number }>) {
      chunkKb.set(Number(row.id), Number(row.knowledge_base_id));
    }
    const countByKb = (rows: { id: number }[]) => rows.reduce<Record<number, number>>((acc, row) => {
      const kbId = chunkKb.get(row.id) ?? -1;
      acc[kbId] = (acc[kbId] ?? 0) + 1;
      return acc;
    }, {});
    const search = (direction: string | undefined, limit: number, explicit?: number) =>
      withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, (trx) =>
        searchKnowledgeForWorkflow(trx, WS_A, ACCOUNT_ID, direction, 'Rückgabe Etikett', limit, explicit));

    // Eingang: general + inbound + learnings → ceil(5 / 3) = 2 je Wissensbasis.
    const inbound = await search('inbound', 5);
    expect(countByKb(inbound)).toEqual({ [GENERAL_KB]: 2, [KB_ID]: 1, [learningsKb]: 1 });
    expect(inbound.find((chunk) => chunkKb.get(chunk.id) === learningsKb)?.content).toContain('Etikett im Kundenkonto');
    // Ausgang und manuell lesen die Learnings ebenfalls.
    expect(countByKb(await search('outbound', 2))).toEqual({ [GENERAL_KB]: 1, [learningsKb]: 1 });
    expect(countByKb(await search(undefined, 5))).toEqual({ [GENERAL_KB]: 3, [learningsKb]: 1 });
    // Explizit gewählte Wissensbasis (ai.draft_reply): Learnings kommen nicht dazu.
    expect(countByKb(await search('inbound', 5, KB_ID))).not.toHaveProperty(String(learningsKb));
    // Reader-KI-Antwort (Antwortvorschlag) nutzt dieselbe Kontext-Liste.
    const promptAppend = await withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, (trx) =>
      buildKnowledgePromptAppend(trx, WS_A, ACCOUNT_ID, 'inbound', 'Rückgabe Etikett'));
    expect(promptAppend).toContain('Etikett im Kundenkonto');
    expect(promptAppend).toContain('Rückgabe Hinweis');
  });

  test('Knoten im echten Workflow-Lauf (manuell): Job wird eingereiht, Lauf endet ok', async () => {
    await seedCandidates(3);
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
        { id: 'digest', type: 'registry', data: { nodeType: 'ai.learnings_digest', config: { period: 'week', minCandidates: 2 } } },
      ],
      edges: [{ id: 'edge-1', source: 'trigger-1', target: 'digest' }],
    };
    await postgres.admin.query(`
      INSERT INTO email_workflows (
        id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
        definition_json, graph_json, execution_mode, engine_version
      ) VALUES (9901, $1, 9901, 'Learnings wöchentlich', 'manual', true, 1, '{}'::jsonb, $2::jsonb, 'graph', 1)
      ON CONFLICT (id) DO NOTHING
    `, [WS_A, JSON.stringify(graph)]);
    await createPostgresWorkflowExecutionJobPort({ db }).execute({
      workspaceId: WS_A,
      workflowId: 9901,
      triggerName: 'manual',
      trustedService: true,
      context: {},
    });
    const jobs = await postgres.admin.query(`SELECT type, payload FROM job_queue WHERE workspace_id = $1`, [WS_A]);
    expect(jobs.rows).toEqual([{
      type: 'learnings.digest',
      payload: expect.objectContaining({ trigger: 'workflow', workflowId: 9901, period: 'week', minCandidates: 2 }),
    }]);
    const steps = await postgres.admin.query(
      `SELECT status, message FROM email_workflow_run_steps WHERE workspace_id = $1 AND node_type = 'ai.learnings_digest'`,
      [WS_A],
    );
    expect(steps.rows).toEqual([expect.objectContaining({ status: 'ok', message: expect.stringMatching(/^queued_learnings_digest:/) })]);
  });

  test('Knoten: reiht im Zeitplan-Workflow ein, überspringt eingehende Workflows', async () => {
    await seedCandidates(3);
    const run = (direction: string, dryRun = false) => withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, (trx) =>
      executeServerLearningsDigestNode(trx, {
        workspaceId: WS_A,
        workflowId: 0,
        direction,
        config: { period: 'since_last', minCandidates: 3 },
        provenance: {},
        dryRun,
        now: new Date(),
      }));
    await expect(run('inbound')).resolves.toMatchObject({ status: 'skipped' });
    await expect(run('schedule', true)).resolves.toMatchObject({ status: 'ok', variables: { 'learnings.status': 'queued' } });
    expect((await postgres.admin.query('SELECT count(*)::int AS n FROM job_queue')).rows[0]).toEqual({ n: 0 });
    await expect(run('schedule')).resolves.toMatchObject({
      status: 'ok',
      variables: { 'learnings.status': 'queued', 'learnings.candidate_count': 3 },
    });
    const jobs = await postgres.admin.query('SELECT type, payload FROM job_queue');
    expect(jobs.rows).toEqual([{
      type: 'learnings.digest',
      payload: expect.objectContaining({ trigger: 'workflow', minCandidates: 3, period: 'since_last' }),
    }]);
    expect((await getAiLearningsOverview({ db }, WS_A)).running).toBe(true);
    await expect(withWorkspaceTransaction(db, { workspaceId: WS_A, role: 'system' }, (trx) =>
      executeServerLearningsDigestNode(trx, {
        workspaceId: WS_A, workflowId: 0, direction: 'manual', config: { minCandidates: 10 }, provenance: {}, dryRun: false, now: new Date(),
      }))).resolves.toMatchObject({ variables: { 'learnings.status': 'skipped_no_candidates' } });
  });
});
