/**
 * HTTP-Routen für Learnings (TA-P5).
 *
 * - `POST /api/v1/ai-learnings/notes` ist eine Mail-Route: mit Bezug auf eine
 *   Mail verlangt das Mail-Policy-Manifest mail.content.read auf genau dieser
 *   Mail; ohne Bezug genügt die Anmeldung. Notizen funktionieren auch bei
 *   ausgeschaltetem Sammeln (sie sind bewusst gesetzt).
 * - Alles andere (Einstellungen, Übersicht, Kandidaten, Vorschläge) ist
 *   Wissensbasis-Verwaltung und verlangt workflows.manage — auch zum Lesen,
 *   weil die Kandidaten Inhalte aus Mails verschiedener Postfächer tragen.
 */
import {
  isLearningCandidateKind,
  isLearningsDigestPeriod,
  LEARNING_NOTE_MAX_LENGTH,
  LEARNINGS_KNOWLEDGE_DOCUMENT_MAX_LENGTH,
  normalizeLearningsMinCandidates,
} from '@simplecrm/core';

import type {
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  CanonicalApiRoute,
  CanonicalApiRouteRegistration,
  ServerApiPorts,
  WorkflowKnowledgeChunkRecord,
  WorkflowKnowledgeDocumentSaveResult,
} from './types';
import { data, error, positiveIntFromPath, rejectUnlessWorkflowManage, requirePrincipal } from './http';
import { buildAiLearningsDigestJobPayload } from '../ai-learnings';

type RouteHandler = (req: ApiRequest, ports: ServerApiPorts, params: readonly string[]) => Promise<ApiResponse>;

type LearningsRouteRegistration = Readonly<{
  mail: boolean;
  registration: CanonicalApiRouteRegistration;
  handler: RouteHandler;
}>;

function route(
  path: string,
  methods: CanonicalApiRouteRegistration['methods'],
  pattern: RegExp,
  mail: boolean,
  handler: RouteHandler,
): LearningsRouteRegistration {
  return { mail, registration: { path, methods, pattern }, handler };
}

const AI_LEARNINGS_ROUTE_REGISTRATIONS: readonly LearningsRouteRegistration[] = Object.freeze([
  route('/api/v1/ai-learnings/notes', ['POST'], /^\/api\/v1\/ai-learnings\/notes$/, true, handleNoteCreate),
  route('/api/v1/ai-learnings/settings', ['GET', 'PATCH'], /^\/api\/v1\/ai-learnings\/settings$/, false, handleSettings),
  route('/api/v1/ai-learnings/overview', ['GET'], /^\/api\/v1\/ai-learnings\/overview$/, false, handleOverview),
  route('/api/v1/ai-learnings/candidates', ['GET'], /^\/api\/v1\/ai-learnings\/candidates$/, false, handleCandidateList),
  route('/api/v1/ai-learnings/candidates/:id', ['DELETE'], /^\/api\/v1\/ai-learnings\/candidates\/([^/]+)$/, false, handleCandidateDelete),
  route('/api/v1/ai-learnings/digests', ['GET', 'POST'], /^\/api\/v1\/ai-learnings\/digests$/, false, handleDigests),
  route('/api/v1/ai-learnings/digests/:id', ['GET'], /^\/api\/v1\/ai-learnings\/digests\/([^/]+)$/, false, handleDigestGet),
  route('/api/v1/ai-learnings/digests/:id/accept', ['POST'], /^\/api\/v1\/ai-learnings\/digests\/([^/]+)\/accept$/, false, handleDigestAccept),
  route('/api/v1/ai-learnings/digests/:id/reject', ['POST'], /^\/api\/v1\/ai-learnings\/digests\/([^/]+)\/reject$/, false, handleDigestReject),
]);

export const AI_LEARNINGS_MAIL_ROUTE_REGISTRATIONS: readonly LearningsRouteRegistration[] = Object.freeze(
  AI_LEARNINGS_ROUTE_REGISTRATIONS.filter(({ mail }) => mail),
);

export const AI_LEARNINGS_MAIL_ROUTE_INVENTORY: readonly CanonicalApiRoute[] = Object.freeze(
  AI_LEARNINGS_MAIL_ROUTE_REGISTRATIONS
    .flatMap(({ registration }) => registration.methods.map((method) => ({
      source: 'ai-learnings-routes',
      method,
      path: registration.path,
      pattern: registration.pattern,
    }))),
);

export async function handleAiLearningsRoute(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse | null> {
  if (!req.path.startsWith('/api/v1/ai-learnings/')) return null;
  for (const { registration, handler } of AI_LEARNINGS_ROUTE_REGISTRATIONS) {
    const match = registration.pattern.exec(req.path);
    if (!match) continue;
    if (!registration.methods.includes(req.method)) return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handler(req, ports, match.slice(1));
  }
  return error(404, 'not_found', 'Route nicht gefunden');
}

function unavailable(): ApiResponse {
  return error(503, 'ai_learnings_unavailable', 'Learnings sind auf diesem Server nicht konfiguriert');
}

function manager(req: ApiRequest): AuthenticatedPrincipal | ApiResponse {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const denied = rejectUnlessWorkflowManage(principal);
  return denied ?? principal;
}

function bodyObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

function optionalPositiveId(value: unknown): number | null | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 'invalid';
}

async function handleNoteCreate(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.aiLearnings) return unavailable();
  const body = bodyObject(req.body);
  if (!body) return error(400, 'invalid_ai_learning_note', 'Notiz muss ein JSON-Objekt sein');
  for (const key of Object.keys(body)) {
    if (key !== 'text' && key !== 'messageId') {
      return error(400, 'validation_error', 'Notiz ist ungueltig', { fields: [{ field: key, message: 'Feld ist nicht erlaubt' }] });
    }
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return error(400, 'invalid_ai_learning_note', 'Bitte einen Text für das Learning eingeben');
  if (text.length > LEARNING_NOTE_MAX_LENGTH) {
    return error(400, 'invalid_ai_learning_note', `Learning darf höchstens ${LEARNING_NOTE_MAX_LENGTH} Zeichen haben`);
  }
  const messageId = optionalPositiveId(body.messageId);
  if (messageId === 'invalid') return error(400, 'invalid_message_id', 'messageId muss eine positive Ganzzahl sein');
  const result = await ports.aiLearnings.createNote({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    text,
    ...(messageId ? { messageId } : {}),
  });
  if (!result.ok) {
    return result.code === 'message_not_found'
      ? error(404, 'email_message_not_found', 'E-Mail nicht gefunden')
      : error(400, 'invalid_ai_learning_note', 'Nach dem Datenschutzfilter bleibt kein Text übrig');
  }
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'ai_learning_note.created',
    entityType: 'ai_learning_candidate',
    entityId: String(result.candidate.id),
    metadata: {
      id: result.candidate.id,
      messageId: result.candidate.sourceMessageId,
      length: result.candidate.noteText?.length ?? 0,
    },
  });
  return data(201, result.candidate);
}

async function handleSettings(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = manager(req);
  if ('status' in principal) return principal;
  if (!ports.aiLearnings) return unavailable();
  if (req.method === 'GET') return data(200, await ports.aiLearnings.getSettings(principal.workspaceId));
  const body = bodyObject(req.body);
  if (!body) return error(400, 'invalid_ai_learnings_settings', 'Einstellungen müssen ein JSON-Objekt sein');
  const fields: Array<{ field: string; message: string }> = [];
  const patch: { collectEnabled?: boolean; targetKnowledgeBaseId?: number | null; profileId?: number | null } = {};
  for (const key of Object.keys(body)) {
    if (key === 'collectEnabled') {
      if (typeof body.collectEnabled !== 'boolean') fields.push({ field: key, message: 'muss true oder false sein' });
      else patch.collectEnabled = body.collectEnabled;
    } else if (key === 'targetKnowledgeBaseId' || key === 'profileId') {
      const value = optionalPositiveId(body[key]);
      if (value === 'invalid') fields.push({ field: key, message: 'muss eine positive Ganzzahl oder leer sein' });
      else if (value !== undefined) patch[key] = value;
    } else {
      fields.push({ field: key, message: 'Feld ist nicht erlaubt' });
    }
  }
  if (fields.length > 0) return error(400, 'validation_error', 'Einstellungen sind ungueltig', { fields });
  if (Object.keys(patch).length === 0) return error(400, 'validation_error', 'Keine Einstellung angegeben');
  const result = await ports.aiLearnings.saveSettings(principal.workspaceId, patch);
  if (!result.ok) {
    return result.code === 'knowledge_base_not_found'
      ? error(404, 'workflow_knowledge_base_not_found', 'Wissensbasis nicht gefunden')
      : error(404, 'ai_profile_not_found', 'KI-Profil nicht gefunden');
  }
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'ai_learnings.settings_updated',
    entityType: 'sync_info',
    entityId: 'ai_learnings',
    metadata: { fields: Object.keys(patch).sort(), ...patch },
  });
  return data(200, result.settings);
}

async function handleOverview(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = manager(req);
  if ('status' in principal) return principal;
  if (!ports.aiLearnings) return unavailable();
  return data(200, await ports.aiLearnings.overview(principal.workspaceId));
}

async function handleCandidateList(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = manager(req);
  if ('status' in principal) return principal;
  if (!ports.aiLearnings) return unavailable();
  const kindRaw = req.query?.kind;
  const kind = typeof kindRaw === 'string' && kindRaw.trim() ? kindRaw.trim() : undefined;
  if (kind !== undefined && !isLearningCandidateKind(kind)) {
    return error(400, 'invalid_kind', 'kind muss draft_edit, human_reply oder note sein');
  }
  const limit = req.query?.limit === undefined ? 100 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return error(400, 'invalid_limit', 'limit muss zwischen 1 und 200 liegen');
  }
  const items = await ports.aiLearnings.listCandidates(principal.workspaceId, {
    ...(kind ? { kind } : {}),
    limit,
  });
  return data(200, { items });
}

async function handleCandidateDelete(req: ApiRequest, ports: ServerApiPorts, params: readonly string[]): Promise<ApiResponse> {
  const principal = manager(req);
  if ('status' in principal) return principal;
  if (!ports.aiLearnings) return unavailable();
  const id = positiveIntFromPath(params[0]);
  if (id === null) return error(400, 'invalid_ai_learning_candidate_id', 'id muss eine positive Ganzzahl sein');
  const deleted = await ports.aiLearnings.deleteCandidate(principal.workspaceId, id);
  if (!deleted) return error(404, 'ai_learning_candidate_not_found', 'Eintrag nicht gefunden');
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'ai_learning_candidate.deleted',
    entityType: 'ai_learning_candidate',
    entityId: String(id),
    metadata: { id, kind: deleted.kind },
  });
  return data(200, { deleted: true });
}

async function handleDigests(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = manager(req);
  if ('status' in principal) return principal;
  if (!ports.aiLearnings) return unavailable();
  if (req.method === 'GET') {
    const limit = req.query?.limit === undefined ? 20 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return error(400, 'invalid_limit', 'limit muss zwischen 1 und 50 liegen');
    }
    return data(200, { items: await ports.aiLearnings.listDigests(principal.workspaceId, { limit }) });
  }

  if (!ports.jobQueue) return error(503, 'job_queue_unavailable', 'Job-Queue nicht konfiguriert');
  const body = bodyObject(req.body ?? {}) ?? {};
  const period = body.period === undefined ? 'since_last' : body.period;
  if (!isLearningsDigestPeriod(period)) {
    return error(400, 'invalid_period', 'period muss since_last, day, week oder month sein');
  }
  const knowledgeBaseId = optionalPositiveId(body.knowledgeBaseId);
  const profileId = optionalPositiveId(body.profileId);
  if (knowledgeBaseId === 'invalid' || profileId === 'invalid') {
    return error(400, 'validation_error', 'knowledgeBaseId/profileId müssen positive Ganzzahlen sein');
  }
  // Auf Knopfdruck genügt ein Eintrag; der Workflow-Baustein nutzt seine Mindestanzahl.
  const minCandidates = body.minCandidates === undefined ? 1 : normalizeLearningsMinCandidates(body.minCandidates);
  const plan = {
    workspaceId: principal.workspaceId,
    period,
    minCandidates,
    ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    ...(profileId ? { profileId } : {}),
  };
  const preflight = await ports.aiLearnings.prepareDigestRequest(plan);
  if (preflight.status === 'failed') return error(404, 'workflow_knowledge_base_not_found', preflight.error);
  if (preflight.status !== 'ready') {
    return data(200, {
      status: preflight.status,
      digestId: preflight.status === 'skipped_pending' ? preflight.digestId : null,
      candidateCount: preflight.candidateCount,
    });
  }
  await ports.jobQueue.enqueue({
    type: 'learnings.digest',
    workspaceId: principal.workspaceId,
    payload: {
      ...buildAiLearningsDigestJobPayload({ ...plan, trigger: 'manual' }),
      actorUserId: principal.userId,
    },
  });
  return data(202, { status: 'queued', digestId: null, candidateCount: preflight.candidateCount });
}

async function handleDigestGet(req: ApiRequest, ports: ServerApiPorts, params: readonly string[]): Promise<ApiResponse> {
  const principal = manager(req);
  if ('status' in principal) return principal;
  if (!ports.aiLearnings) return unavailable();
  const id = positiveIntFromPath(params[0]);
  if (id === null) return error(400, 'invalid_ai_learning_digest_id', 'id muss eine positive Ganzzahl sein');
  const digest = await ports.aiLearnings.getDigest(principal.workspaceId, id);
  return digest ? data(200, digest) : error(404, 'ai_learning_digest_not_found', 'Vorschlag nicht gefunden');
}

function decisionError(code: string, currentContent?: string): ApiResponse {
  switch (code) {
    case 'not_found':
      return error(404, 'ai_learning_digest_not_found', 'Vorschlag nicht gefunden');
    case 'not_pending':
      return error(409, 'ai_learning_digest_not_pending', 'Über diesen Vorschlag wurde schon entschieden');
    case 'knowledge_base_missing':
      return error(404, 'workflow_knowledge_base_not_found', 'Die Wissensbasis gibt es nicht mehr');
    case 'knowledge_base_changed':
      return error(
        409,
        'knowledge_base_changed',
        'Die Wissensbasis wurde seit dem Vorschlag geändert. Beim Übernehmen werden diese Änderungen überschrieben.',
        { currentContent },
      );
    default:
      return error(400, 'invalid_content', `Inhalt fehlt oder ist länger als ${LEARNINGS_KNOWLEDGE_DOCUMENT_MAX_LENGTH} Zeichen`);
  }
}

async function handleDigestAccept(req: ApiRequest, ports: ServerApiPorts, params: readonly string[]): Promise<ApiResponse> {
  const principal = manager(req);
  if ('status' in principal) return principal;
  if (!ports.aiLearnings) return unavailable();
  const id = positiveIntFromPath(params[0]);
  if (id === null) return error(400, 'invalid_ai_learning_digest_id', 'id muss eine positive Ganzzahl sein');
  const body = bodyObject(req.body);
  if (!body || typeof body.content !== 'string') return decisionError('content_invalid');
  if (body.confirmOverwrite !== undefined && typeof body.confirmOverwrite !== 'boolean') {
    return error(400, 'validation_error', 'confirmOverwrite muss true oder false sein');
  }
  const result = await ports.aiLearnings.acceptDigest({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    content: body.content,
    confirmOverwrite: body.confirmOverwrite === true,
  });
  if (!result.ok) return decisionError(result.code, result.currentContent);
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'ai_learning_digest.accepted',
    entityType: 'ai_learning_digest',
    entityId: String(id),
    metadata: {
      id,
      knowledgeBaseId: result.digest.knowledgeBaseId,
      contentLength: body.content.length,
      overwroteChanges: body.confirmOverwrite === true,
      deletedCandidates: result.deletedCandidates,
    },
  });
  if (result.document) await recordKnowledgeDocumentSaved(ports, principal, result.document, 'ai_learning_digest');
  return data(200, result.digest);
}

async function handleDigestReject(req: ApiRequest, ports: ServerApiPorts, params: readonly string[]): Promise<ApiResponse> {
  const principal = manager(req);
  if ('status' in principal) return principal;
  if (!ports.aiLearnings) return unavailable();
  const id = positiveIntFromPath(params[0]);
  if (id === null) return error(400, 'invalid_ai_learning_digest_id', 'id muss eine positive Ganzzahl sein');
  const result = await ports.aiLearnings.rejectDigest({ workspaceId: principal.workspaceId, actorUserId: principal.userId, id });
  if (!result.ok) return decisionError(result.code);
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'ai_learning_digest.rejected',
    entityType: 'ai_learning_digest',
    entityId: String(id),
    metadata: { id, knowledgeBaseId: result.digest.knowledgeBaseId, deletedCandidates: result.deletedCandidates },
  });
  return data(200, result.digest);
}

/**
 * Audit + Ereignisse für ein atomar gespeichertes Wissensbasis-Dokument —
 * dieselben Aktionen wie die Chunk-Routen, damit Verlauf und offene
 * Wissensbasis-Ansichten gleich reagieren. Geteilt mit
 * PUT /api/v1/workflow-knowledge-bases/:id/document.
 */
export async function recordKnowledgeDocumentSaved(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  result: WorkflowKnowledgeDocumentSaveResult,
  origin: 'knowledge_document' | 'ai_learning_digest',
): Promise<void> {
  const occurredAt = new Date().toISOString();
  const chunkAudit = async (action: string, chunk: WorkflowKnowledgeChunkRecord, metadata: Record<string, unknown>) => {
    await ports.audit?.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      action,
      entityType: 'workflow_knowledge_chunk',
      entityId: String(chunk.id),
      metadata: {
        id: chunk.id,
        sourceSqliteId: chunk.sourceSqliteId,
        knowledgeBaseId: chunk.knowledgeBaseId,
        knowledgeBaseSourceSqliteId: chunk.knowledgeBaseSourceSqliteId,
        origin,
        ...metadata,
      },
    });
  };
  const publish = async (
    type: 'workflow_knowledge_chunk.created' | 'workflow_knowledge_chunk.updated' | 'workflow_knowledge_chunk.deleted',
    chunk: WorkflowKnowledgeChunkRecord,
  ) => {
    await ports.events?.publish({
      type,
      workspaceId: principal.workspaceId,
      entityType: 'workflow_knowledge_chunk',
      entityId: String(chunk.id),
      actorUserId: principal.userId,
      occurredAt,
      payload: {
        id: chunk.id,
        sourceSqliteId: chunk.sourceSqliteId,
        knowledgeBaseId: chunk.knowledgeBaseId,
        knowledgeBaseSourceSqliteId: chunk.knowledgeBaseSourceSqliteId,
        title: chunk.title,
        sourcePath: chunk.sourcePath,
        embeddingConfigured: chunk.embeddingConfigured,
      },
    });
  };
  const action = result.created ? 'workflow_knowledge_chunk.created' : 'workflow_knowledge_chunk.updated';
  await chunkAudit(action, result.chunk, {
    title: result.chunk.title,
    document: true,
    removedChunkIds: result.removedChunks.map((chunk) => chunk.id),
  });
  await publish(action, result.chunk);
  for (const removed of result.removedChunks) {
    await chunkAudit('workflow_knowledge_chunk.deleted', removed, { title: removed.title, document: true });
    await publish('workflow_knowledge_chunk.deleted', removed);
  }
}
