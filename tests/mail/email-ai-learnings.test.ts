/**
 * TA-P5 Learnings (Desktop): echte In-Memory-SQLite, Versand über
 * sendComposeDraft (SMTP/IMAP ersetzt), Auswertung mit gefälschter KI.
 */
const mockSendSmtp = jest.fn();

jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: (...args: unknown[]) => mockSendSmtp(...args),
}));

jest.mock('../../electron/email/email-imap-append', () => ({
  appendSentToImap: jest.fn().mockResolvedValue(undefined),
}));

const mockRunChatCompletion = jest.fn();
jest.mock('../../electron/email/email-openai', () => ({
  runChatCompletion: (...args: unknown[]) => mockRunChatCompletion(...args),
  runEmbedding: jest.fn().mockResolvedValue(null),
}));

import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase, setSyncInfo } from '../../electron/sqlite-service';
import {
  createComposeDraft,
  createEmailAccountRecord,
  ensureInboxFolderForAccount,
  getEmailMessageById,
  insertOrUpdateEmailMessage,
  updateComposeDraft,
} from '../../electron/email/email-store';
import { sendComposeDraft } from '../../electron/email/email-compose-send';
import {
  acceptAiLearningDigest,
  addAiLearningNote,
  collectSentLearningCandidateSafe,
  deleteAiLearningCandidate,
  getAiLearningDigest,
  getAiLearningsOverview,
  getAiLearningsSettings,
  listAiLearningCandidates,
  listAiLearningDigests,
  preflightAiLearningsDigest,
  pruneAiLearningCandidates,
  pruneAiLearningCandidatesIfDue,
  rejectAiLearningDigest,
  resetAiLearningsRuntimeState,
  runAiLearningsDigest,
  saveAiLearningsSettings,
  storeDraftAiSuggestionSnapshot,
} from '../../electron/email/email-ai-learnings';
import {
  createKnowledgeBase,
  getKnowledgeBaseDocument,
  saveKnowledgeBaseDocument,
} from '../../electron/workflow/knowledge-base';
import { registerLearningsDigestNode } from '../../electron/workflow/nodes/learnings-nodes';
import type { RegisteredWorkflowNode, WorkflowContext } from '../../electron/workflow/types';

const USER = 'user-1';

describe('Learnings (Desktop, TA-P5)', () => {
  let db: Database.Database;
  let accountId: number;

  function inbound(): number {
    const folder = ensureInboxFolderForAccount(accountId);
    return insertOrUpdateEmailMessage({
      accountId,
      folderId: folder.id,
      uid: Math.floor(Math.random() * 1_000_000) + 1,
      messageId: `<m${Math.random()}@kunde.test>`,
      inReplyTo: null,
      referencesHeader: null,
      subject: 'Rückgabe Jacke',
      fromJson: JSON.stringify({ value: [{ name: 'Max Mustermann', address: 'max@kunde.test' }] }),
      toJson: null,
      ccJson: null,
      dateReceived: '2026-09-20T10:00:00.000Z',
      snippet: 'Frage',
      bodyText: 'Hallo,\n\nich bin Max Mustermann (Kd.-Nr. 12345). Kann ich die Jacke zurückgeben?\n\nGruß\nMax',
      bodyHtml: null,
      seenLocal: true,
    }).id;
  }

  function draft(parentId: number | null, snapshot?: string): number {
    const id = createComposeDraft({ accountId });
    if (parentId) updateComposeDraft(id, { replyParentMessageId: parentId });
    if (snapshot) storeDraftAiSuggestionSnapshot(id, snapshot);
    return id;
  }

  async function send(draftId: number, bodyText: string, parentId: number | null): Promise<void> {
    await expect(sendComposeDraft({
      accountId,
      draftMessageId: draftId,
      subject: 'AW: Rückgabe Jacke',
      bodyText,
      to: 'Max Mustermann <max@kunde.test>',
      ...(parentId ? { inReplyToMessageId: parentId } : {}),
    })).resolves.toEqual(expect.objectContaining({ ok: true }));
  }

  function seedCandidates(count: number, createdAt = new Date()): void {
    for (let i = 0; i < count; i += 1) {
      db.prepare(
        `INSERT INTO ai_learning_candidates (kind, question_text, human_text, created_at) VALUES ('human_reply', ?, ?, ?)`,
      ).run(`Betreff: Frage ${i}`, `Antwort ${i}: 30 Tage.`, new Date(createdAt.getTime() - i * 1000).toISOString());
    }
  }

  beforeEach(() => {
    mockSendSmtp.mockReset().mockResolvedValue(undefined);
    mockRunChatCompletion.mockReset();
    resetAiLearningsRuntimeState();
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.prepare(
      `INSERT INTO users (id, username, display_name, role, password_hash, password_updated_at)
       VALUES (?, 'erika', 'Erika Beispiel', 'admin', 'x', ?)`,
    ).run(USER, new Date().toISOString());
    accountId = createEmailAccountRecord({
      displayName: 'Support',
      emailAddress: 'support@firma.test',
      imapHost: 'imap.firma.test',
      imapPort: 993,
      imapTls: true,
      imapUsername: 'support@firma.test',
    }).id;
  });

  afterEach(() => {
    closeDatabase();
  });

  test('Einstellungen: Standard aus, Ziel muss existieren', () => {
    expect(getAiLearningsSettings()).toEqual({ collectEnabled: false, targetKnowledgeBaseId: null, profileId: null });
    expect(saveAiLearningsSettings({ targetKnowledgeBaseId: 999 })).toEqual({ success: false, error: 'Wissensbasis nicht gefunden' });
    const kb = createKnowledgeBase('Firma', null, { knowledgeContext: 'general' });
    expect(saveAiLearningsSettings({ collectEnabled: true, targetKnowledgeBaseId: kb, profileId: 4 })).toEqual({
      success: true,
      settings: { collectEnabled: true, targetKnowledgeBaseId: kb, profileId: 4 },
    });
    expect(saveAiLearningsSettings({ targetKnowledgeBaseId: null, profileId: null }).success).toBe(true);
    expect(getAiLearningsSettings()).toEqual({ collectEnabled: true, targetKnowledgeBaseId: null, profileId: null });
  });

  test('Versand: geänderter KI-Entwurf wird bereinigt gesammelt, Schnappschuss danach genullt', async () => {
    saveAiLearningsSettings({ collectEnabled: true });
    const parent = inbound();
    const id = draft(parent, 'Die Rückgabe ist innerhalb von 14 Tagen möglich.');
    await send(id, 'Hallo Herr Mustermann,\n\nDie Rückgabe ist innerhalb von 30 Tagen kostenlos möglich, das Etikett liegt im Kundenkonto.\n\nViele Grüße\nErika Beispiel', parent);

    const [candidate] = listAiLearningCandidates();
    expect(candidate).toMatchObject({
      kind: 'draft_edit',
      aiText: 'Die Rückgabe ist innerhalb von 14 Tagen möglich.',
      humanText: 'Die Rückgabe ist innerhalb von 30 Tagen kostenlos möglich, das Etikett liegt im Kundenkonto.',
      sourceMessageId: parent,
      sentMessageId: id,
    });
    expect(candidate!.questionText).toBe('Betreff: Rückgabe Jacke\n\nich bin [Name] (Kd.-Nr. [Nummer]). Kann ich die Jacke zurückgeben?');
    const row = getEmailMessageById(id) as unknown as { folder_kind: string; ai_suggestion_snapshot: string | null };
    expect(row.folder_kind).toBe('sent');
    expect(row.ai_suggestion_snapshot).toBeNull();
  });

  test('Versand: menschliche Antwort ja; unverändert, automatisch, ohne Eltern-Mail oder ausgeschaltet nein', async () => {
    const parent = inbound();
    const off = draft(parent);
    await send(off, 'Antwort bei ausgeschaltetem Sammeln.', parent);
    expect(listAiLearningCandidates()).toEqual([]);

    saveAiLearningsSettings({ collectEnabled: true });
    const human = draft(parent);
    await send(human, 'Ja, gerne. Das Etikett liegt im Kundenkonto.', parent);
    const unchanged = draft(parent, 'Das Etikett liegt im Kundenkonto.');
    await send(unchanged, 'Hallo,\n\nDas Etikett liegt im Kundenkonto.\n\nGruß', parent);
    const automatic = draft(parent);
    db.prepare('UPDATE email_messages SET auto_submitted = 1 WHERE id = ?').run(automatic);
    collectSentLearningCandidateSafe(automatic, { text: 'Automatische Antwort.' });
    const orphan = draft(null);
    collectSentLearningCandidateSafe(orphan, { text: 'Ohne Bezug.' });

    expect(listAiLearningCandidates().map((c) => c.kind)).toEqual(['human_reply']);
    // Erneuter Aufruf nach dem Versand legt nichts doppelt an.
    collectSentLearningCandidateSafe(human, { text: 'Ja, gerne.' });
    db.prepare("UPDATE email_messages SET folder_kind = 'draft' WHERE id = ?").run(human);
    collectSentLearningCandidateSafe(human, { text: 'Ja, gerne. Das Etikett liegt im Kundenkonto.' });
    expect(listAiLearningCandidates()).toHaveLength(1);
    // Fehler beim Sammeln stören nie.
    closeDatabase();
    expect(() => collectSentLearningCandidateSafe(human, { text: 'x' })).not.toThrow();
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
  });

  test('Notizen: mit und ohne Mail-Bezug, auch bei ausgeschaltetem Sammeln', () => {
    const parent = inbound();
    const note = addAiLearningNote({ text: 'Max Mustermann ruft oft an (0761 123456).', messageId: parent, actorUserId: USER });
    expect(note).toMatchObject({
      success: true,
      candidate: { kind: 'note', noteText: '[Name] ruft oft an ([Telefon]).', sourceMessageId: parent, createdByUserId: USER },
    });
    expect(addAiLearningNote({ text: 'Sie-Form.', actorUserId: null })).toMatchObject({ success: true });
    expect(addAiLearningNote({ text: '  ', actorUserId: USER })).toEqual({ success: false, error: 'Bitte einen Text für das Learning eingeben' });
    expect(addAiLearningNote({ text: 'x'.repeat(4001), actorUserId: USER }).success).toBe(false);
    expect(addAiLearningNote({ text: 'x', messageId: 99_999, actorUserId: USER })).toEqual({ success: false, error: 'E-Mail nicht gefunden' });
    expect(getAiLearningsOverview().counts).toEqual({ draft_edit: 0, human_reply: 0, note: 2, total: 2 });
    expect(listAiLearningCandidates({ kind: 'human_reply' })).toEqual([]);
    const [first] = listAiLearningCandidates({ kind: 'note', limit: 1 });
    expect(deleteAiLearningCandidate(first!.id)).toBe(true);
    expect(deleteAiLearningCandidate(first!.id)).toBe(false);
  });

  test('Auswerten: zu wenige, Fehler lässt Kandidaten offen, Vorschlag mit eigener Wissensbasis, dann „bereits offen“', async () => {
    seedCandidates(1);
    await expect(runAiLearningsDigest({ trigger: 'manual', minCandidates: 3 }))
      .resolves.toEqual({ status: 'skipped_no_candidates', digestId: null, candidateCount: 1 });

    seedCandidates(2);
    mockRunChatCompletion.mockResolvedValueOnce('keine Ahnung');
    const failed = await runAiLearningsDigest({ trigger: 'manual', minCandidates: 3, actorUserId: USER });
    expect(failed).toMatchObject({ status: 'failed', candidateCount: 3, error: 'Antwort der KI enthält kein gültiges JSON' });
    expect(getAiLearningsOverview().counts.total).toBe(3);

    mockRunChatCompletion.mockResolvedValueOnce(JSON.stringify({
      summary: 'Rückgabe ergänzt.',
      operations: [{ op: 'add', section: 'Rückgabe', content: '30 Tage, Etikett im Kundenkonto.' }],
    }));
    saveAiLearningsSettings({ profileId: 7 });
    const created = await runAiLearningsDigest({ trigger: 'manual', minCandidates: 3, actorUserId: USER });
    expect(created).toEqual({ status: 'created', digestId: expect.any(Number), candidateCount: 3 });
    expect(mockRunChatCompletion).toHaveBeenLastCalledWith(expect.stringContaining('Wissensbasis'), expect.any(String), 7);
    const overview = getAiLearningsOverview();
    expect(overview).toMatchObject({ pendingDigestId: created.digestId, running: false, counts: { total: 0 } });
    const detail = await getAiLearningDigest(Number(created.digestId));
    expect(detail).toMatchObject({ status: 'pending', knowledgeBaseName: 'Learnings', requestedByName: 'Erika Beispiel', knowledgeBaseChanged: false });
    expect(detail!.proposedContent).toContain('## Rückgabe\n\n30 Tage, Etikett im Kundenkonto.');
    expect(getKnowledgeBaseDocument(detail!.knowledgeBaseId)?.content).not.toContain('30 Tage');

    seedCandidates(2);
    await expect(runAiLearningsDigest({ trigger: 'workflow', minCandidates: 1 }))
      .resolves.toEqual({ status: 'skipped_pending', digestId: created.digestId, candidateCount: 0 });
    expect(listAiLearningDigests().map((d) => d.status)).toEqual(['pending', 'failed']);
    expect(await getAiLearningDigest(99_999)).toBeNull();
  });

  test('Auswerten parallel: nur eine Auswertung je Wissensbasis', async () => {
    seedCandidates(2);
    let release: (value: string) => void = () => undefined;
    mockRunChatCompletion.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }));
    const first = runAiLearningsDigest({ trigger: 'manual', minCandidates: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getAiLearningsOverview().running).toBe(true);
    await expect(runAiLearningsDigest({ trigger: 'manual', minCandidates: 1 }))
      .resolves.toMatchObject({ status: 'skipped_pending', digestId: null });
    release(JSON.stringify({ operations: [{ op: 'add', section: 'Ton', content: 'Sie-Form.' }] }));
    await expect(first).resolves.toMatchObject({ status: 'created' });
  });

  test('Übernehmen mit Konfliktwarnung, Verwerfen, Fehlerfälle', async () => {
    const kb = createKnowledgeBase('Firma', null, { knowledgeContext: 'general' });
    saveKnowledgeBaseDocument(kb, '# Firma\n\n## Rückgabe\n\n14 Tage.\n');
    saveAiLearningsSettings({ targetKnowledgeBaseId: kb });
    seedCandidates(2);
    mockRunChatCompletion.mockResolvedValueOnce(JSON.stringify({ operations: [{ op: 'update', section: 'Rückgabe', content: '30 Tage.' }] }));
    const created = await runAiLearningsDigest({ trigger: 'manual', period: 'week', minCandidates: 1 });
    const id = Number(created.digestId);

    saveKnowledgeBaseDocument(kb, '# Firma\n\n## Rückgabe\n\n14 Tage.\n\n## Versand\n\n2 Tage.\n');
    expect((await getAiLearningDigest(id))!.knowledgeBaseChanged).toBe(true);
    const conflict = await acceptAiLearningDigest({ id, content: '# Firma\n\n## Rückgabe\n\n30 Tage.\n', actorUserId: USER });
    expect(conflict).toMatchObject({ success: false, code: 'knowledge_base_changed' });
    expect((conflict as { currentContent?: string }).currentContent).toContain('## Versand');

    await expect(acceptAiLearningDigest({ id, content: '  ', actorUserId: USER })).resolves.toMatchObject({ code: 'content_invalid' });
    await expect(acceptAiLearningDigest({ id: 999, content: 'x', actorUserId: USER })).resolves.toMatchObject({ code: 'not_found' });
    const accepted = await acceptAiLearningDigest({
      id, content: '# Firma\n\n## Rückgabe\n\n30 Tage (bearbeitet).', confirmOverwrite: true, actorUserId: USER,
    });
    expect(accepted).toMatchObject({ success: true, digest: { status: 'accepted', decidedByName: 'Erika Beispiel' } });
    expect(getKnowledgeBaseDocument(kb)?.content).toBe('# Firma\n\n## Rückgabe\n\n30 Tage (bearbeitet).\n');
    expect(db.prepare('SELECT COUNT(*) AS n FROM ai_learning_candidates').get()).toEqual({ n: 0 });
    await expect(acceptAiLearningDigest({ id, content: 'x', actorUserId: USER })).resolves.toMatchObject({ code: 'not_pending' });

    seedCandidates(1);
    mockRunChatCompletion.mockResolvedValueOnce(JSON.stringify({ operations: [{ op: 'add', section: 'Ton', content: 'Sie-Form.' }] }));
    const second = await runAiLearningsDigest({ trigger: 'manual', minCandidates: 1 });
    expect(rejectAiLearningDigest({ id: Number(second.digestId), actorUserId: USER })).toMatchObject({
      success: true,
      digest: { status: 'rejected' },
    });
    expect(rejectAiLearningDigest({ id: Number(second.digestId), actorUserId: USER })).toMatchObject({ code: 'not_pending' });
    expect(rejectAiLearningDigest({ id: 999, actorUserId: USER })).toMatchObject({ code: 'not_found' });
  });

  test('gelöschtes Ziel wird nicht still umgelenkt; Aufräumen nach 90 Tagen', () => {
    setSyncInfo('learnings_target_kb_id', '4242');
    expect(preflightAiLearningsDigest({})).toEqual({ status: 'failed', error: 'Ziel-Wissensbasis nicht gefunden' });
    setSyncInfo('learnings_target_kb_id', '');
    const now = new Date('2026-09-26T12:00:00.000Z');
    seedCandidates(1, new Date('2026-06-01T00:00:00.000Z'));
    seedCandidates(1, now);
    expect(pruneAiLearningCandidates(now)).toBe(1);
    const logger = { warn: jest.fn(), debug: jest.fn() };
    seedCandidates(1, new Date('2026-06-01T00:00:00.000Z'));
    pruneAiLearningCandidatesIfDue(logger, now.getTime() + 10 * 24 * 60 * 60 * 1000);
    pruneAiLearningCandidatesIfDue(logger, now.getTime() + 10 * 24 * 60 * 60 * 1000 + 1000);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(listAiLearningCandidates().map((c) => c.createdAt)).toEqual(['2026-09-26T12:00:00.000Z']);
  });

  test('Knoten ai.learnings_digest: überspringt Mail-Workflows, Probelauf, echter Lauf', async () => {
    let node: RegisteredWorkflowNode | undefined;
    registerLearningsDigestNode((def) => { node = def; });
    const ctx = (direction: WorkflowContext['direction'], dryRun = false): WorkflowContext => ({
      trigger: 'manual',
      direction,
      messageId: null,
      message: null,
      outbound: null,
      workflowId: 3,
      runId: 1,
      dryRun,
      variables: {},
      strings: {},
      ai: {},
    });
    await expect(node!.execute(ctx('inbound'), {}, 'n1')).resolves.toMatchObject({ status: 'skipped' });
    seedCandidates(3);
    await expect(node!.execute(ctx('schedule', true), { minCandidates: 3 }, 'n1')).resolves.toMatchObject({
      status: 'ok',
      variables: { 'learnings.status': 'queued', 'learnings.candidate_count': 3 },
    });
    await expect(node!.execute(ctx('manual'), { minCandidates: 10 }, 'n1')).resolves.toMatchObject({
      variables: { 'learnings.status': 'skipped_no_candidates' },
    });
    mockRunChatCompletion.mockResolvedValueOnce(JSON.stringify({ operations: [{ op: 'add', section: 'Ton', content: 'Sie-Form.' }] }));
    const result = await node!.execute(ctx('schedule'), { minCandidates: 3, period: 'week' }, 'n1');
    expect(result).toMatchObject({ status: 'ok', variables: { 'learnings.status': 'created', 'learnings.candidate_count': 3 } });
    // Workflow 3 gibt es in dieser Datenbank nicht: die ID wird nicht gespeichert (Fremdschlüssel).
    expect(listAiLearningDigests()[0]).toMatchObject({ trigger: 'workflow', workflowId: null });
    await expect(node!.execute(ctx('manual', true), { knowledgeBaseId: 4242 }, 'n1')).resolves.toMatchObject({ status: 'error' });
    await expect(node!.execute(ctx('manual'), { knowledgeBaseId: 4242 }, 'n1')).resolves.toMatchObject({ status: 'error' });
  });
});
