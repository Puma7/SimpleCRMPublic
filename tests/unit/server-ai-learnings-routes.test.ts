import { handleAiLearningsRoute } from '../../packages/server/src/api/ai-learnings-routes';
import type { ApiRequest, ServerApiPorts } from '../../packages/server/src/api/types';
import { handleWorkflowRuntimeReadRoute } from '../../packages/server/src/api/workflow-runtime-routes';
import type { AiLearningsApiPort } from '../../packages/server/src/ai-learnings';
import { assertMailRoutePolicy } from '../../packages/server/src/mail-access/policy-manifest';
import { buildAiLearningsDigestJobPlan } from '../../packages/server/src/ai-learnings';
import { graphileJobKeyForJob, graphileQueueNameForJob } from '../../packages/server/src/jobs/graphile-worker';
import { assertServerJobPolicy } from '../../packages/server/src/jobs/policy';
import { createProductionJobHandlers } from '../../packages/server/src/jobs/production-handlers';

const WS = '11111111-1111-4111-8111-111111111111';
const manager = { userId: 'u-admin', workspaceId: WS, role: 'admin' as const };
const plainUser = { userId: 'u-user', workspaceId: WS, role: 'user' as const, capabilities: ['workflows.view'] };
const delegatedManager = { userId: 'u-mgr', workspaceId: WS, role: 'user' as const, capabilities: ['workflows.manage'] };

const digest = {
  id: 7,
  knowledgeBaseId: 3,
  knowledgeBaseName: 'Learnings',
  status: 'accepted' as const,
  trigger: 'manual' as const,
  requestedByUserId: null,
  requestedByName: null,
  workflowId: null,
  periodFrom: null,
  periodTo: '2026-09-26T00:00:00.000Z',
  candidateCount: 2,
  summary: '',
  operations: [],
  error: null,
  createdAt: '2026-09-26T00:00:00.000Z',
  decidedByUserId: 'u-admin',
  decidedByName: 'Admin',
  decidedAt: '2026-09-26T00:00:00.000Z',
};

function chunk(id: number) {
  return {
    id,
    sourceSqliteId: -id,
    knowledgeBaseSourceSqliteId: -3,
    knowledgeBaseId: 3,
    title: 'Dokument',
    sourcePath: null,
    embeddingConfigured: false,
    createdAt: null,
    updatedAt: '2026-09-26T00:00:00.000Z',
  };
}

function makePorts(overrides: Partial<AiLearningsApiPort> = {}) {
  const audit = { record: jest.fn(async () => undefined) };
  const events = { publish: jest.fn(async () => undefined) };
  const jobQueue = { enqueue: jest.fn(async () => ({})) };
  const aiLearnings: AiLearningsApiPort = {
    getSettings: jest.fn(async () => ({ collectEnabled: false, targetKnowledgeBaseId: null, profileId: null })),
    saveSettings: jest.fn(async () => ({ ok: true as const, settings: { collectEnabled: true, targetKnowledgeBaseId: 3, profileId: null } })),
    overview: jest.fn(async () => ({
      settings: { collectEnabled: true, targetKnowledgeBaseId: null, profileId: null },
      counts: { draft_edit: 1, human_reply: 0, note: 2, total: 3 },
      pendingDigestId: null,
      running: false,
      lastDigestAt: null,
      effectiveKnowledgeBaseId: null,
    })),
    listCandidates: jest.fn(async () => []),
    deleteCandidate: jest.fn(async () => ({
      id: 4, kind: 'note' as const, accountId: null, sourceMessageId: null, sentMessageId: null, questionText: null,
      aiText: null, humanText: null, noteText: 'x', createdByUserId: null, createdAt: '', digestId: null, processedAt: null,
    })),
    createNote: jest.fn(async () => ({
      ok: true as const,
      candidate: {
        id: 9, kind: 'note' as const, accountId: null, sourceMessageId: 42, sentMessageId: null, questionText: null,
        aiText: null, humanText: null, noteText: 'Sie-Form.', createdByUserId: 'u-user', createdAt: '', digestId: null, processedAt: null,
      },
    })),
    listDigests: jest.fn(async () => []),
    getDigest: jest.fn(async () => null),
    acceptDigest: jest.fn(async () => ({
      ok: true as const,
      digest,
      deletedCandidates: 2,
      document: {
        knowledgeBase: {
          id: 3, sourceSqliteId: -3, name: 'Learnings', description: null, accountSourceSqliteId: null, accountId: null,
          overrideKey: 'kb.general', knowledgeContext: 'general', createdAt: null, updatedAt: '',
        },
        chunk: chunk(30),
        created: false,
        removedChunks: [chunk(31)],
      },
    })),
    rejectDigest: jest.fn(async () => ({ ok: true as const, digest: { ...digest, status: 'rejected' as const }, deletedCandidates: 1 })),
    prepareDigestRequest: jest.fn(async () => ({ status: 'ready' as const, knowledgeBaseId: null, candidateCount: 4 })),
    ...overrides,
  };
  const ports = { aiLearnings, audit, events, jobQueue } as unknown as ServerApiPorts;
  return { ports, aiLearnings, audit, events, jobQueue };
}

async function call(req: ApiRequest, ports: ServerApiPorts) {
  const response = await handleAiLearningsRoute(req, ports);
  if (!response) throw new Error('route not handled');
  return response as { status: number; body: any };
}

describe('Learnings-Routen (TA-P5)', () => {
  test('Verwaltung verlangt workflows.manage (auch zum Lesen)', async () => {
    const { ports } = makePorts();
    for (const [method, path] of [
      ['GET', '/api/v1/ai-learnings/overview'],
      ['GET', '/api/v1/ai-learnings/settings'],
      ['PATCH', '/api/v1/ai-learnings/settings'],
      ['GET', '/api/v1/ai-learnings/candidates'],
      ['DELETE', '/api/v1/ai-learnings/candidates/4'],
      ['GET', '/api/v1/ai-learnings/digests'],
      ['POST', '/api/v1/ai-learnings/digests'],
      ['GET', '/api/v1/ai-learnings/digests/7'],
      ['POST', '/api/v1/ai-learnings/digests/7/accept'],
      ['POST', '/api/v1/ai-learnings/digests/7/reject'],
    ] as const) {
      const response = await call({ method, path, principal: plainUser, body: {} }, ports);
      expect({ method, path, status: response.status }).toEqual({ method, path, status: 403 });
    }
    const delegated = await call({ method: 'GET', path: '/api/v1/ai-learnings/overview', principal: delegatedManager }, ports);
    expect(delegated.status).toBe(200);
    expect(await call({ method: 'GET', path: '/api/v1/ai-learnings/overview' }, ports)).toMatchObject({ status: 401 });
    expect(await call({ method: 'PUT' as never, path: '/api/v1/ai-learnings/overview', principal: manager }, ports)).toMatchObject({ status: 405 });
    expect(await handleAiLearningsRoute({ method: 'GET', path: '/api/v1/workflows', principal: manager }, ports)).toBeNull();
  });

  test('Einstellungen validieren und protokollieren', async () => {
    const { ports, aiLearnings, audit } = makePorts();
    expect(await call({ method: 'PATCH', path: '/api/v1/ai-learnings/settings', principal: manager, body: { collectEnabled: 'ja' } }, ports))
      .toMatchObject({ status: 400 });
    expect(await call({ method: 'PATCH', path: '/api/v1/ai-learnings/settings', principal: manager, body: { foo: 1 } }, ports))
      .toMatchObject({ status: 400 });
    expect(await call({ method: 'PATCH', path: '/api/v1/ai-learnings/settings', principal: manager, body: { targetKnowledgeBaseId: -1 } }, ports))
      .toMatchObject({ status: 400 });
    const ok = await call({
      method: 'PATCH',
      path: '/api/v1/ai-learnings/settings',
      principal: manager,
      body: { collectEnabled: true, targetKnowledgeBaseId: 3, profileId: null },
    }, ports);
    expect(ok.status).toBe(200);
    expect(aiLearnings.saveSettings).toHaveBeenCalledWith(WS, { collectEnabled: true, targetKnowledgeBaseId: 3, profileId: null });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_learnings.settings_updated' }));
  });

  test('Notiz: jeder Angemeldete, Validierung, Audit', async () => {
    const { ports, aiLearnings, audit } = makePorts();
    expect(await call({ method: 'POST', path: '/api/v1/ai-learnings/notes', principal: plainUser, body: { text: '  ' } }, ports))
      .toMatchObject({ status: 400 });
    expect(await call({ method: 'POST', path: '/api/v1/ai-learnings/notes', principal: plainUser, body: { text: 'x', messageId: 'abc' } }, ports))
      .toMatchObject({ status: 400 });
    expect(await call({ method: 'POST', path: '/api/v1/ai-learnings/notes', principal: plainUser, body: { text: 'x'.repeat(4001) } }, ports))
      .toMatchObject({ status: 400 });
    const created = await call({
      method: 'POST', path: '/api/v1/ai-learnings/notes', principal: plainUser, body: { text: 'Sie-Form.', messageId: 42 },
    }, ports);
    expect(created.status).toBe(201);
    expect(aiLearnings.createNote).toHaveBeenCalledWith({ workspaceId: WS, actorUserId: 'u-user', text: 'Sie-Form.', messageId: 42 });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_learning_note.created', entityId: '9' }));
    const missing = makePorts({ createNote: jest.fn(async () => ({ ok: false as const, code: 'message_not_found' as const })) });
    expect(await call({ method: 'POST', path: '/api/v1/ai-learnings/notes', principal: plainUser, body: { text: 'x', messageId: 5 } }, missing.ports))
      .toMatchObject({ status: 404 });
  });

  test('Mail-Policy: Notiz mit Mail-Bezug verlangt mail.content.read auf der Mail, ohne Bezug keine Mail-Prüfung', () => {
    expect(assertMailRoutePolicy('POST', '/api/v1/ai-learnings/notes').policy).toEqual({
      kind: 'permission',
      permission: 'mail.content.read',
      resource: {
        kind: 'optional_message_lookup',
        messageId: { source: 'body', field: 'messageId' },
        whenAbsent: 'non_mail',
        whenNull: 'non_mail',
      },
    });
  });

  test('Auswerten reiht den Job ein oder meldet „bereits offen“', async () => {
    const { ports, jobQueue, aiLearnings } = makePorts();
    const queued = await call({ method: 'POST', path: '/api/v1/ai-learnings/digests', principal: manager, body: { period: 'week' } }, ports);
    expect(queued).toMatchObject({ status: 202, body: { data: { status: 'queued', candidateCount: 4 } } });
    expect(aiLearnings.prepareDigestRequest).toHaveBeenCalledWith({ workspaceId: WS, period: 'week', minCandidates: 1 });
    expect(jobQueue.enqueue).toHaveBeenCalledWith({
      type: 'learnings.digest',
      workspaceId: WS,
      payload: { workspaceId: WS, period: 'week', minCandidates: 1, trigger: 'manual', actorUserId: 'u-admin' },
    });
    expect(await call({ method: 'POST', path: '/api/v1/ai-learnings/digests', principal: manager, body: { period: 'year' } }, ports))
      .toMatchObject({ status: 400 });

    const pending = makePorts({
      prepareDigestRequest: jest.fn(async () => ({ status: 'skipped_pending' as const, knowledgeBaseId: 3, digestId: 11, candidateCount: 0 })),
    });
    expect(await call({ method: 'POST', path: '/api/v1/ai-learnings/digests', principal: manager, body: {} }, pending.ports))
      .toMatchObject({ status: 200, body: { data: { status: 'skipped_pending', digestId: 11 } } });
    expect(pending.jobQueue.enqueue).not.toHaveBeenCalled();
  });

  test('Übernehmen: Konflikt 409 mit aktuellem Stand; Erfolg mit Audit und Wissensbasis-Ereignissen', async () => {
    const conflict = makePorts({
      acceptDigest: jest.fn(async () => ({ ok: false as const, code: 'knowledge_base_changed' as const, currentContent: '# Neu' })),
    });
    const conflictResponse = await call({
      method: 'POST', path: '/api/v1/ai-learnings/digests/7/accept', principal: manager, body: { content: '# X' },
    }, conflict.ports);
    expect(conflictResponse).toMatchObject({
      status: 409,
      body: { error: { code: 'knowledge_base_changed', details: { currentContent: '# Neu' } } },
    });

    const { ports, audit, events, aiLearnings } = makePorts();
    expect(await call({ method: 'POST', path: '/api/v1/ai-learnings/digests/7/accept', principal: manager, body: {} }, ports))
      .toMatchObject({ status: 400 });
    const ok = await call({
      method: 'POST', path: '/api/v1/ai-learnings/digests/7/accept', principal: manager, body: { content: '# X', confirmOverwrite: true },
    }, ports);
    expect(ok.status).toBe(200);
    expect(aiLearnings.acceptDigest).toHaveBeenCalledWith({ workspaceId: WS, actorUserId: 'u-admin', id: 7, content: '# X', confirmOverwrite: true });
    expect((audit.record.mock.calls as unknown as Array<[{ action: string }]>).map(([entry]) => entry.action)).toEqual([
      'ai_learning_digest.accepted',
      'workflow_knowledge_chunk.updated',
      'workflow_knowledge_chunk.deleted',
    ]);
    expect((events.publish.mock.calls as unknown as Array<[{ type: string; payload: { knowledgeBaseId: number } }]>)
      .map(([event]) => [event.type, event.payload.knowledgeBaseId])).toEqual([
      ['workflow_knowledge_chunk.updated', 3],
      ['workflow_knowledge_chunk.deleted', 3],
    ]);

    const rejected = makePorts();
    expect(await call({ method: 'POST', path: '/api/v1/ai-learnings/digests/7/reject', principal: manager }, rejected.ports))
      .toMatchObject({ status: 200, body: { data: { status: 'rejected' } } });
    expect(rejected.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_learning_digest.rejected' }));
  });

  test('Einträge löschen protokolliert', async () => {
    const { ports, audit } = makePorts();
    expect(await call({ method: 'DELETE', path: '/api/v1/ai-learnings/candidates/4', principal: manager }, ports))
      .toMatchObject({ status: 200 });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_learning_candidate.deleted', entityId: '4' }));
    const gone = makePorts({ deleteCandidate: jest.fn(async () => null) });
    expect(await call({ method: 'DELETE', path: '/api/v1/ai-learnings/candidates/4', principal: manager }, gone.ports))
      .toMatchObject({ status: 404 });
    expect(await call({ method: 'GET', path: '/api/v1/ai-learnings/candidates', principal: manager, query: { kind: 'foo' } }, ports))
      .toMatchObject({ status: 400 });
  });
});

describe('Wissensbasis-Dokument atomar speichern (TA-P5)', () => {
  function kbPorts() {
    const saveDocument = jest.fn(async () => ({
      knowledgeBase: {
        id: 3, sourceSqliteId: -3, name: 'Firma', description: null, accountSourceSqliteId: null, accountId: null,
        overrideKey: null, knowledgeContext: null, createdAt: null, updatedAt: '',
      },
      chunk: chunk(30),
      created: true,
      removedChunks: [],
    }));
    const audit = { record: jest.fn(async () => undefined) };
    const events = { publish: jest.fn(async () => undefined) };
    return { ports: { workflowKnowledgeBases: { saveDocument }, audit, events } as unknown as ServerApiPorts, saveDocument, audit, events };
  }

  test('POST …/document verlangt workflows.manage und validiert', async () => {
    const { ports, saveDocument, audit, events } = kbPorts();
    const path = '/api/v1/workflow-knowledge-bases/3/document';
    expect(await handleWorkflowRuntimeReadRoute({ method: 'POST', path, principal: plainUser, body: { content: 'x' } }, ports))
      .toMatchObject({ status: 403 });
    expect(await handleWorkflowRuntimeReadRoute({ method: 'POST', path, principal: manager, body: { content: 'x', title: 'y' } }, ports))
      .toMatchObject({ status: 400 });
    expect(await handleWorkflowRuntimeReadRoute({ method: 'POST', path, principal: manager, body: { content: 'x'.repeat(100_001) } }, ports))
      .toMatchObject({ status: 400 });
    expect(await handleWorkflowRuntimeReadRoute({ method: 'GET', path, principal: manager }, ports))
      .toMatchObject({ status: 405 });
    const ok = await handleWorkflowRuntimeReadRoute({ method: 'POST', path, principal: manager, body: { content: '# Neu' } }, ports);
    expect(ok).toMatchObject({ status: 200 });
    expect(saveDocument).toHaveBeenCalledWith({ workspaceId: WS, actorUserId: 'u-admin', id: 3, content: '# Neu' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'workflow_knowledge_chunk.created' }));
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow_knowledge_chunk.created' }));
  });
});

describe('Wissensbasis-Kontext „learnings“ (TA-P5)', () => {
  test('POST /workflow-knowledge-bases akzeptiert learnings und lehnt unbekannte Kontexte ab', async () => {
    const create = jest.fn(async (input: { values: Record<string, unknown> }) => ({
      id: 5, sourceSqliteId: -5, name: String(input.values.name), description: null, accountSourceSqliteId: null, accountId: null,
      overrideKey: 'kb.learnings', knowledgeContext: (input.values.knowledgeContext as string | null) ?? null, createdAt: null, updatedAt: '',
    }));
    const ports = {
      workflowKnowledgeBases: { create },
      audit: { record: jest.fn(async () => undefined) },
      events: { publish: jest.fn(async () => undefined) },
    } as unknown as ServerApiPorts;
    const path = '/api/v1/workflow-knowledge-bases';
    const ok = await handleWorkflowRuntimeReadRoute({ method: 'POST', path, principal: manager, body: { name: 'Learnings', knowledgeContext: 'learnings' } }, ports);
    expect(ok).toMatchObject({ status: 201 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ values: { name: 'Learnings', knowledgeContext: 'learnings' } }));

    const invalid = await handleWorkflowRuntimeReadRoute({ method: 'POST', path, principal: manager, body: { name: 'X', knowledgeContext: 'foo' } }, ports);
    expect(invalid).toMatchObject({ status: 400 });
    expect((invalid!.body as { error: { details: { fields: unknown[] } } }).error.details.fields).toEqual([
      { field: 'knowledgeContext', message: 'knowledgeContext muss einer von inbound, outbound, general, learnings sein' },
    ]);
    const cleared = await handleWorkflowRuntimeReadRoute({ method: 'POST', path, principal: manager, body: { name: 'Ohne', knowledgeContext: null } }, ports);
    expect(cleared).toMatchObject({ status: 201 });
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('Job learnings.digest (TA-P5)', () => {
  test('Policy, Queue, Key, Handler und Plan', async () => {
    expect(assertServerJobPolicy('learnings.digest')).toMatchObject({ kind: 'non_mail', classification: 'non_mail' });
    expect(graphileQueueNameForJob('learnings.digest', {}, WS)).toBe(`learnings-${WS}`);
    expect(graphileJobKeyForJob('learnings.digest', { knowledgeBaseId: 3 }, WS)).toBe(`learnings.digest:${WS}:3`);
    expect(graphileJobKeyForJob('learnings.digest', {}, WS)).toBe(`learnings.digest:${WS}:default`);
    expect(buildAiLearningsDigestJobPlan({ workspaceId: WS, period: 'week', minCandidates: 5, trigger: 'workflow', workflowId: 4 }, WS))
      .toEqual({ workspaceId: WS, period: 'week', minCandidates: 5, trigger: 'workflow', workflowId: 4 });
    expect(() => buildAiLearningsDigestJobPlan({ workspaceId: 'other' }, WS)).toThrow();
    const digestPort = { digest: jest.fn(async () => ({ status: 'created' as const, digestId: 1, candidateCount: 3, knowledgeBaseId: 2 })) };
    const handlers = createProductionJobHandlers({ aiLearningsDigest: digestPort });
    await handlers['learnings.digest']!({ payload: { period: 'bogus', actorUserId: 'u1' }, workspaceId: WS } as never);
    expect(digestPort.digest).toHaveBeenCalledWith({ workspaceId: WS, period: 'since_last', minCandidates: 3, trigger: 'manual', actorUserId: 'u1' });
  });
});
