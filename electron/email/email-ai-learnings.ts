/**
 * Learnings mit Freigabe — Desktop (TA-P5, docs/MAIL_TEILAUTOMATISIERUNG.md 3.4).
 *
 * Gleiche Kernlogik wie der Server (packages/core/src/learnings über
 * shared/ai-learnings): Sammeln beim Versand und per Notiz, Auswertung direkt
 * im Main-Prozess (runChatCompletion), Übernehmen/Verwerfen. Gespeichert wird
 * nur bereinigter Text; das Sammeln ist best effort und stört den Versand nie.
 */
import {
  AI_LEARNING_CANDIDATES_TABLE,
  AI_LEARNING_DIGESTS_TABLE,
  EMAIL_MESSAGES_TABLE,
  EMAIL_TEAM_MEMBERS_TABLE,
  USERS_TABLE,
  WORKFLOW_KNOWLEDGE_BASES_TABLE,
} from '../database-schema';
import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';
import {
  computeLearningsDigestProposal,
  isLearningsCollectEnabledValue,
  learningNamesFromAddressJson,
  learningsPeriodStart,
  learningsRetentionCutoff,
  LEARNING_CANDIDATE_KINDS,
  LEARNINGS_DEFAULT_KB_CONTEXT,
  LEARNINGS_DEFAULT_KB_DOCUMENT,
  LEARNINGS_DEFAULT_KB_NAME,
  LEARNINGS_DIGEST_MAX_CANDIDATES,
  LEARNINGS_KNOWLEDGE_DOCUMENT_MAX_LENGTH,
  LEARNINGS_SETTING_KEYS,
  normalizeLearningsDigestPeriod,
  normalizeLearningsMinCandidates,
  prepareNoteLearningCandidate,
  prepareSentLearningCandidate,
  selectLearningCandidatesForDigest,
  type AiLearningCandidateDto,
  type AiLearningDecisionResultDto,
  type AiLearningDigestDetailDto,
  type AiLearningDigestDto,
  type AiLearningsOverviewDto,
  type AiLearningsRunDigestResultDto,
  type AiLearningsSettingsDto,
  type LearningCandidateForDigest,
  type LearningCandidateKind,
  type LearningDigestTrigger,
  type LearningsDigestPeriod,
  type PreparedLearningCandidate,
  AI_LEARNING_DECISION_MESSAGES,
} from '../../shared/ai-learnings';

/** Merkt sich die selbst angelegte „Learnings“-Wissensbasis (Ziel leer). */
export const LEARNINGS_DEFAULT_KB_ID_KEY = 'learnings_default_kb_id';
const LIST_LIMIT_MAX = 200;

/** Laufende Auswertungen (Main-Prozess, nicht persistent). */
const runningDigests = new Set<string>();

function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

function positiveIdOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// --- Einstellungen ------------------------------------------------------------

export function getAiLearningsSettings(): AiLearningsSettingsDto {
  return {
    collectEnabled: isLearningsCollectEnabledValue(getSyncInfo(LEARNINGS_SETTING_KEYS.collectEnabled)),
    targetKnowledgeBaseId: positiveIdOrNull(getSyncInfo(LEARNINGS_SETTING_KEYS.targetKnowledgeBaseId)),
    profileId: positiveIdOrNull(getSyncInfo(LEARNINGS_SETTING_KEYS.profileId)),
  };
}

export function saveAiLearningsSettings(
  patch: Partial<AiLearningsSettingsDto>,
): { success: true; settings: AiLearningsSettingsDto } | { success: false; error: string } {
  if (patch.targetKnowledgeBaseId != null && !knowledgeBaseExists(patch.targetKnowledgeBaseId)) {
    return { success: false, error: 'Wissensbasis nicht gefunden' };
  }
  if (patch.collectEnabled !== undefined) {
    setSyncInfo(LEARNINGS_SETTING_KEYS.collectEnabled, patch.collectEnabled ? '1' : '0');
  }
  if (patch.targetKnowledgeBaseId !== undefined) {
    setSyncInfo(LEARNINGS_SETTING_KEYS.targetKnowledgeBaseId, patch.targetKnowledgeBaseId == null ? '' : String(patch.targetKnowledgeBaseId));
  }
  if (patch.profileId !== undefined) {
    setSyncInfo(LEARNINGS_SETTING_KEYS.profileId, patch.profileId == null ? '' : String(patch.profileId));
  }
  return { success: true, settings: getAiLearningsSettings() };
}

function knowledgeBaseExists(id: number): boolean {
  return Boolean(getDb().prepare(`SELECT id FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE} WHERE id = ?`).get(id));
}

// --- Namen für die Bereinigung ------------------------------------------------

function workspacePeopleNames(): string[] {
  const db = getDb();
  const users = db.prepare(`SELECT display_name FROM ${USERS_TABLE} LIMIT 500`).all() as { display_name: string | null }[];
  const team = db.prepare(`SELECT display_name FROM ${EMAIL_TEAM_MEMBERS_TABLE} LIMIT 500`).all() as { display_name: string | null }[];
  return [...users, ...team]
    .map((row) => String(row.display_name ?? '').trim())
    .filter((name) => name.length > 0 && name !== 'Lokal');
}

function customerNames(customerIds: readonly (number | null | undefined)[]): string[] {
  const ids = [...new Set(customerIds.filter((id): id is number => typeof id === 'number' && id > 0))];
  if (ids.length === 0) return [];
  const rows = getDb()
    .prepare(`SELECT name, firstName, company, email FROM customers WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { name: string | null; firstName: string | null; company: string | null; email: string | null }[];
  return rows.flatMap((row) => [
    [row.firstName, row.name].filter(Boolean).join(' '),
    row.name ?? '',
    row.company ?? '',
    row.email ?? '',
  ]).filter((name) => name.trim().length > 0);
}

// --- KI-Schnappschuss am Entwurf -------------------------------------------------

/** Wie der Server (ai_suggestion_snapshot): KI-Text des Entwurfs für den späteren Vergleich. */
export function storeDraftAiSuggestionSnapshot(draftId: number, text: string): void {
  try {
    getDb()
      .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET ai_suggestion_snapshot = ? WHERE id = ?`)
      .run(String(text ?? '').slice(0, 100_000), draftId);
  } catch (error) {
    console.warn('[ai-learnings] KI-Schnappschuss nicht gespeichert:', error);
  }
}

// --- Sammeln -------------------------------------------------------------------

type CandidateRefs = {
  accountId: number | null;
  sourceMessageId: number | null;
  sentMessageId: number | null;
  createdByUserId: string | null;
};

function insertCandidate(candidate: PreparedLearningCandidate, refs: CandidateRefs, now: Date): number | null {
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO ${AI_LEARNING_CANDIDATES_TABLE}
       (kind, account_id, source_message_id, sent_message_id, question_text, ai_text, human_text, note_text,
        created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      candidate.kind,
      refs.accountId,
      refs.sourceMessageId,
      refs.sentMessageId,
      candidate.questionText,
      candidate.aiText,
      candidate.humanText,
      candidate.noteText,
      refs.createdByUserId,
      nowIso(now),
    );
  return result.changes > 0 ? Number(result.lastInsertRowid) : null;
}

type DraftRow = {
  id: number;
  account_id: number | null;
  folder_kind: string | null;
  auto_submitted: number | null;
  reply_parent_message_id: number | null;
  ai_suggestion_snapshot: string | null;
  to_json: string | null;
  cc_json: string | null;
  customer_id: number | null;
  body_text: string | null;
  body_html: string | null;
};

type ParentRow = {
  id: number;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  from_json: string | null;
  to_json: string | null;
  cc_json: string | null;
  customer_id: number | null;
  folder_kind: string | null;
  account_id: number | null;
};

/**
 * Beim Versand (vor markDraftAsSent): draft_edit für deutlich geänderte
 * KI-Entwürfe, human_reply für menschliche Antworten auf eingehende Mails
 * (nicht automatisch versendet). Der Schnappschuss wird danach genullt.
 */
export function collectSentLearningCandidateSafe(
  draftMessageId: number,
  sent: { text?: string | null; html?: string | null } = {},
  options: { actorUserId?: string | null; now?: Date } = {},
): void {
  try {
    const db = getDb();
    const draft = db
      .prepare(
        `SELECT id, account_id, folder_kind, auto_submitted, reply_parent_message_id, ai_suggestion_snapshot,
                to_json, cc_json, customer_id, body_text, body_html
         FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`,
      )
      .get(draftMessageId) as DraftRow | undefined;
    if (!draft || draft.folder_kind === 'sent') return;
    const snapshot = String(draft.ai_suggestion_snapshot ?? '');
    if (snapshot) {
      db.prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET ai_suggestion_snapshot = NULL WHERE id = ?`).run(draftMessageId);
    }
    if (!isLearningsCollectEnabledValue(getSyncInfo(LEARNINGS_SETTING_KEYS.collectEnabled))) return;

    const parent = draft.reply_parent_message_id
      ? db
        .prepare(
          `SELECT id, subject, body_text, body_html, from_json, to_json, cc_json, customer_id, folder_kind, account_id
           FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`,
        )
        .get(draft.reply_parent_message_id) as ParentRow | undefined
      : undefined;
    if (!snapshot.trim()) {
      if (Number(draft.auto_submitted ?? 0) === 1) return;
      if (!parent || (parent.folder_kind ?? 'inbox') !== 'inbox') return;
    }

    const names = [
      ...learningNamesFromAddressJson(draft.to_json),
      ...learningNamesFromAddressJson(draft.cc_json),
      ...(parent ? learningNamesFromAddressJson(parent.from_json) : []),
      ...(parent ? learningNamesFromAddressJson(parent.to_json) : []),
      ...(parent ? learningNamesFromAddressJson(parent.cc_json) : []),
      ...customerNames([draft.customer_id, parent?.customer_id]),
      ...workspacePeopleNames(),
    ];
    const sentText = sent.text ?? draft.body_text;
    const sentHtml = sent.html ?? draft.body_html;
    const candidate = prepareSentLearningCandidate({
      aiSnapshot: snapshot,
      sentText,
      sentHtml,
      parentSubject: parent?.subject ?? null,
      parentText: parent?.body_text ?? null,
      parentHtml: parent?.body_html ?? null,
      names,
    });
    if (!candidate) return;
    insertCandidate(candidate, {
      accountId: draft.account_id,
      sourceMessageId: parent?.id ?? null,
      sentMessageId: draftMessageId,
      createdByUserId: options.actorUserId ?? null,
    }, options.now ?? new Date());
  } catch (error) {
    console.warn(`[ai-learnings] Sammeln beim Versand fehlgeschlagen (Nachricht ${draftMessageId}):`, error);
  }
}

/** „Learning notieren“: bewusst gesetzt, daher auch bei ausgeschaltetem Sammeln. */
export function addAiLearningNote(input: {
  text: string;
  messageId?: number | null;
  actorUserId: string | null;
  now?: Date;
}): { success: true; candidate: AiLearningCandidateDto } | { success: false; error: string } {
  const text = String(input.text ?? '').trim();
  if (!text) return { success: false, error: 'Bitte einen Text für das Learning eingeben' };
  if (text.length > 4000) return { success: false, error: 'Learning darf höchstens 4000 Zeichen haben' };
  let message: ParentRow | undefined;
  if (input.messageId != null) {
    message = getDb()
      .prepare(
        `SELECT id, subject, body_text, body_html, from_json, to_json, cc_json, customer_id, folder_kind, account_id
         FROM ${EMAIL_MESSAGES_TABLE} WHERE id = ?`,
      )
      .get(input.messageId) as ParentRow | undefined;
    if (!message) return { success: false, error: 'E-Mail nicht gefunden' };
  }
  const names = [
    ...(message ? learningNamesFromAddressJson(message.from_json) : []),
    ...(message ? learningNamesFromAddressJson(message.to_json) : []),
    ...(message ? learningNamesFromAddressJson(message.cc_json) : []),
    ...(message ? customerNames([message.customer_id]) : []),
    ...workspacePeopleNames(),
  ];
  const candidate = prepareNoteLearningCandidate({
    note: text,
    questionSubject: message?.subject ?? null,
    questionText: message?.body_text ?? null,
    questionHtml: message?.body_html ?? null,
    names,
  });
  if (!candidate) return { success: false, error: 'Nach dem Datenschutzfilter bleibt kein Text übrig' };
  const id = insertCandidate(candidate, {
    accountId: message?.account_id ?? null,
    sourceMessageId: message?.id ?? null,
    sentMessageId: null,
    createdByUserId: input.actorUserId,
  }, input.now ?? new Date());
  const row = getDb().prepare(`SELECT * FROM ${AI_LEARNING_CANDIDATES_TABLE} WHERE id = ?`).get(id) as CandidateRow;
  return { success: true, candidate: mapCandidateRow(row) };
}

// --- Lesen ---------------------------------------------------------------------

type CandidateRow = {
  id: number;
  kind: string;
  account_id: number | null;
  source_message_id: number | null;
  sent_message_id: number | null;
  question_text: string | null;
  ai_text: string | null;
  human_text: string | null;
  note_text: string | null;
  created_by_user_id: string | null;
  created_at: string;
  digest_id: number | null;
  processed_at: string | null;
};

function mapCandidateRow(row: CandidateRow): AiLearningCandidateDto {
  return {
    id: Number(row.id),
    kind: row.kind as LearningCandidateKind,
    accountId: row.account_id,
    sourceMessageId: row.source_message_id,
    sentMessageId: row.sent_message_id,
    questionText: row.question_text,
    aiText: row.ai_text,
    humanText: row.human_text,
    noteText: row.note_text,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    digestId: row.digest_id,
    processedAt: row.processed_at,
  };
}

function resolveTargetKnowledgeBaseId(explicitId?: number | null): number | null | -1 {
  const settings = getAiLearningsSettings();
  for (const id of [explicitId, settings.targetKnowledgeBaseId]) {
    if (!id) continue;
    // Ausdrücklich gewähltes, aber gelöschtes Ziel: nicht still umlenken.
    return knowledgeBaseExists(id) ? id : -1;
  }
  const defaultId = positiveIdOrNull(getSyncInfo(LEARNINGS_DEFAULT_KB_ID_KEY));
  return defaultId && knowledgeBaseExists(defaultId) ? defaultId : null;
}

export function getAiLearningsOverview(): AiLearningsOverviewDto {
  const db = getDb();
  const counts: Record<LearningCandidateKind, number> & { total: number } = {
    draft_edit: 0,
    human_reply: 0,
    note: 0,
    total: 0,
  };
  const rows = db
    .prepare(`SELECT kind, COUNT(*) AS count FROM ${AI_LEARNING_CANDIDATES_TABLE} WHERE processed_at IS NULL GROUP BY kind`)
    .all() as { kind: string; count: number }[];
  for (const row of rows) {
    if ((LEARNING_CANDIDATE_KINDS as readonly string[]).includes(row.kind)) {
      counts[row.kind as LearningCandidateKind] = Number(row.count);
      counts.total += Number(row.count);
    }
  }
  const target = resolveTargetKnowledgeBaseId();
  const effectiveKnowledgeBaseId = target === -1 ? null : target;
  const pending = effectiveKnowledgeBaseId === null
    ? undefined
    : db
      .prepare(`SELECT id FROM ${AI_LEARNING_DIGESTS_TABLE} WHERE knowledge_base_id = ? AND status = 'pending'`)
      .get(effectiveKnowledgeBaseId) as { id: number } | undefined;
  const last = db
    .prepare(`SELECT created_at FROM ${AI_LEARNING_DIGESTS_TABLE} ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get() as { created_at: string } | undefined;
  const general = db
    .prepare(`SELECT COUNT(*) AS count FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE} WHERE knowledge_context = ? AND account_id IS NULL`)
    .get(LEARNINGS_DEFAULT_KB_CONTEXT) as { count: number };
  return {
    settings: getAiLearningsSettings(),
    counts,
    pendingDigestId: pending ? Number(pending.id) : null,
    running: runningDigests.size > 0,
    lastDigestAt: last?.created_at ?? null,
    effectiveKnowledgeBaseId,
    generalKnowledgeBaseCount: Number(general.count),
  };
}

export function listAiLearningCandidates(options: { kind?: LearningCandidateKind; limit?: number } = {}): AiLearningCandidateDto[] {
  const limit = Math.max(1, Math.min(LIST_LIMIT_MAX, options.limit ?? 100));
  const where = options.kind ? 'AND kind = ?' : '';
  const params: unknown[] = options.kind ? [options.kind, limit] : [limit];
  const rows = getDb()
    .prepare(
      `SELECT * FROM ${AI_LEARNING_CANDIDATES_TABLE}
       WHERE processed_at IS NULL ${where}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(...params) as CandidateRow[];
  return rows.map(mapCandidateRow);
}

export function deleteAiLearningCandidate(id: number): boolean {
  return getDb().prepare(`DELETE FROM ${AI_LEARNING_CANDIDATES_TABLE} WHERE id = ?`).run(id).changes > 0;
}

type DigestRow = {
  id: number;
  knowledge_base_id: number;
  status: string;
  trigger: string;
  requested_by_user_id: string | null;
  workflow_id: number | null;
  period_from: string | null;
  period_to: string;
  candidate_count: number;
  summary: string;
  operations_json: string;
  error: string | null;
  created_at: string;
  decided_by_user_id: string | null;
  decided_at: string | null;
  kb_name: string | null;
  requested_by_name: string | null;
  decided_by_name: string | null;
  base_content?: string;
  proposed_content?: string;
};

function parseOperations(value: string | null | undefined): unknown {
  try {
    return JSON.parse(String(value ?? '[]')) as unknown;
  } catch {
    return [];
  }
}

function mapDigestRow(row: DigestRow): AiLearningDigestDto {
  return {
    id: Number(row.id),
    knowledgeBaseId: Number(row.knowledge_base_id),
    knowledgeBaseName: row.kb_name,
    status: row.status as AiLearningDigestDto['status'],
    trigger: row.trigger as LearningDigestTrigger,
    requestedByUserId: row.requested_by_user_id,
    requestedByName: row.requested_by_name,
    workflowId: row.workflow_id,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    candidateCount: Number(row.candidate_count),
    summary: row.summary,
    operations: parseOperations(row.operations_json),
    error: row.error,
    createdAt: row.created_at,
    decidedByUserId: row.decided_by_user_id,
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at,
  };
}

const DIGEST_SELECT = `
  SELECT d.id, d.knowledge_base_id, d.status, d.trigger, d.requested_by_user_id, d.workflow_id, d.period_from,
         d.period_to, d.candidate_count, d.summary, d.operations_json, d.error, d.created_at,
         d.decided_by_user_id, d.decided_at, kb.name AS kb_name,
         requester.display_name AS requested_by_name, decider.display_name AS decided_by_name
  FROM ${AI_LEARNING_DIGESTS_TABLE} d
  LEFT JOIN ${WORKFLOW_KNOWLEDGE_BASES_TABLE} kb ON kb.id = d.knowledge_base_id
  LEFT JOIN ${USERS_TABLE} requester ON requester.id = d.requested_by_user_id
  LEFT JOIN ${USERS_TABLE} decider ON decider.id = d.decided_by_user_id`;

export function listAiLearningDigests(options: { limit?: number } = {}): AiLearningDigestDto[] {
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const rows = getDb()
    .prepare(`${DIGEST_SELECT} ORDER BY d.created_at DESC, d.id DESC LIMIT ?`)
    .all(limit) as DigestRow[];
  return rows.map(mapDigestRow);
}

async function knowledgeDocument(knowledgeBaseId: number): Promise<{ content: string } | null> {
  const { getKnowledgeBaseDocument } = await import('../workflow/knowledge-base.js');
  return getKnowledgeBaseDocument(knowledgeBaseId);
}

export async function getAiLearningDigest(id: number): Promise<AiLearningDigestDetailDto | null> {
  const row = getDb()
    .prepare(`${DIGEST_SELECT.replace('SELECT d.id,', 'SELECT d.base_content, d.proposed_content, d.id,')} WHERE d.id = ?`)
    .get(id) as DigestRow | undefined;
  if (!row) return null;
  const current = await knowledgeDocument(Number(row.knowledge_base_id));
  const baseContent = String(row.base_content ?? '');
  return {
    ...mapDigestRow(row),
    baseContent,
    proposedContent: String(row.proposed_content ?? ''),
    currentContent: current?.content ?? null,
    knowledgeBaseChanged: current ? current.content !== baseContent : true,
  };
}

// --- Entscheiden ----------------------------------------------------------------

function decisionFailure(
  code: Extract<AiLearningDecisionResultDto, { success: false }>['code'],
  currentContent?: string,
): AiLearningDecisionResultDto {
  return {
    success: false,
    code,
    error: AI_LEARNING_DECISION_MESSAGES[code],
    ...(currentContent === undefined ? {} : { currentContent }),
  };
}

function digestSummary(id: number): AiLearningDigestDto {
  return mapDigestRow(getDb().prepare(`${DIGEST_SELECT} WHERE d.id = ?`).get(id) as DigestRow);
}

/**
 * Übernehmen: schreibt das (ggf. bearbeitete) Dokument über
 * saveKnowledgeBaseDocument und markiert den Vorschlag. Hat sich die
 * Wissensbasis seit dem Vorschlag geändert, nur mit confirmOverwrite.
 */
export async function acceptAiLearningDigest(input: {
  id: number;
  content: string;
  confirmOverwrite?: boolean;
  actorUserId: string | null;
  now?: Date;
}): Promise<AiLearningDecisionResultDto> {
  const content = String(input.content ?? '');
  if (!content.trim() || content.length > LEARNINGS_KNOWLEDGE_DOCUMENT_MAX_LENGTH) return decisionFailure('content_invalid');
  const db = getDb();
  const digest = db
    .prepare(`SELECT id, status, knowledge_base_id, base_content FROM ${AI_LEARNING_DIGESTS_TABLE} WHERE id = ?`)
    .get(input.id) as { id: number; status: string; knowledge_base_id: number; base_content: string } | undefined;
  if (!digest) return decisionFailure('not_found');
  if (digest.status !== 'pending') return decisionFailure('not_pending');
  const current = await knowledgeDocument(Number(digest.knowledge_base_id));
  if (!current) return decisionFailure('knowledge_base_missing');
  if (current.content !== digest.base_content && input.confirmOverwrite !== true) {
    return decisionFailure('knowledge_base_changed', current.content);
  }
  const { saveKnowledgeBaseDocument } = await import('../workflow/knowledge-base.js');
  const decidedAt = nowIso(input.now);
  // Erst die Zeile beanspruchen (nur pending → accepted), dann schreiben: ein
  // doppelter Klick übernimmt nie zweimal.
  const claimed = db
    .prepare(
      `UPDATE ${AI_LEARNING_DIGESTS_TABLE}
       SET status = 'accepted', decided_by_user_id = ?, decided_at = ?, proposed_content = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(input.actorUserId, decidedAt, content, input.id);
  if (claimed.changes === 0) return decisionFailure('not_pending');
  try {
    saveKnowledgeBaseDocument(Number(digest.knowledge_base_id), content);
  } catch (error) {
    db.prepare(
      `UPDATE ${AI_LEARNING_DIGESTS_TABLE} SET status = 'pending', decided_by_user_id = NULL, decided_at = NULL WHERE id = ?`,
    ).run(input.id);
    throw error;
  }
  db.prepare(`DELETE FROM ${AI_LEARNING_CANDIDATES_TABLE} WHERE digest_id = ?`).run(input.id);
  return { success: true, digest: digestSummary(input.id) };
}

export function rejectAiLearningDigest(input: { id: number; actorUserId: string | null; now?: Date }): AiLearningDecisionResultDto {
  const db = getDb();
  const digest = db.prepare(`SELECT id, status FROM ${AI_LEARNING_DIGESTS_TABLE} WHERE id = ?`).get(input.id) as
    | { id: number; status: string }
    | undefined;
  if (!digest) return decisionFailure('not_found');
  const updated = db
    .prepare(
      `UPDATE ${AI_LEARNING_DIGESTS_TABLE} SET status = 'rejected', decided_by_user_id = ?, decided_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(input.actorUserId, nowIso(input.now), input.id);
  if (updated.changes === 0) return decisionFailure('not_pending');
  db.prepare(`DELETE FROM ${AI_LEARNING_CANDIDATES_TABLE} WHERE digest_id = ?`).run(input.id);
  return { success: true, digest: digestSummary(input.id) };
}

// --- Auswerten ------------------------------------------------------------------

export type AiLearningsDigestRequest = {
  knowledgeBaseId?: number | null;
  period?: LearningsDigestPeriod;
  minCandidates?: number;
  profileId?: number | null;
  trigger: LearningDigestTrigger;
  actorUserId?: string | null;
  workflowId?: number | null;
  now?: Date;
  /** Tests: sonst runChatCompletion mit dem Profil. */
  chat?: (system: string, user: string, profileId: number | null) => Promise<string>;
};

type Preflight =
  | { status: 'skipped_pending'; knowledgeBaseId: number; digestId: number; candidateCount: number }
  | { status: 'skipped_no_candidates'; knowledgeBaseId: number | null; candidateCount: number }
  | { status: 'failed'; error: string }
  | { status: 'ready'; knowledgeBaseId: number | null; candidates: (LearningCandidateForDigest & { id: number })[]; from: Date | null };

function lastDigestPeriodEnd(knowledgeBaseId: number | null): Date | null {
  if (knowledgeBaseId === null) return null;
  const row = getDb()
    .prepare(
      `SELECT period_to FROM ${AI_LEARNING_DIGESTS_TABLE}
       WHERE knowledge_base_id = ? AND status != 'failed' ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(knowledgeBaseId) as { period_to: string } | undefined;
  return row ? new Date(row.period_to) : null;
}

function loadOpenCandidates(from: Date | null, to: Date): (LearningCandidateForDigest & { id: number })[] {
  const params: unknown[] = [nowIso(to)];
  let where = 'processed_at IS NULL AND created_at <= ?';
  if (from) {
    where += ' AND created_at >= ?';
    params.push(nowIso(from));
  }
  const rows = getDb()
    .prepare(
      `SELECT id, kind, question_text, ai_text, human_text, note_text, created_at FROM ${AI_LEARNING_CANDIDATES_TABLE}
       WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${LEARNINGS_DIGEST_MAX_CANDIDATES}`,
    )
    .all(...params) as CandidateRow[];
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind as LearningCandidateKind,
    questionText: row.question_text,
    aiText: row.ai_text,
    humanText: row.human_text,
    noteText: row.note_text,
    createdAt: row.created_at,
  }));
}

/** Vorabprüfung ohne KI: offener Vorschlag? genug Einträge? (Knoten und Knopf) */
export function preflightAiLearningsDigest(request: {
  knowledgeBaseId?: number | null;
  period?: LearningsDigestPeriod;
  minCandidates?: number;
  now?: Date;
}): Preflight {
  const now = request.now ?? new Date();
  const knowledgeBaseId = resolveTargetKnowledgeBaseId(request.knowledgeBaseId);
  if (knowledgeBaseId === -1) return { status: 'failed', error: 'Ziel-Wissensbasis nicht gefunden' };
  if (knowledgeBaseId !== null) {
    const pending = getDb()
      .prepare(`SELECT id FROM ${AI_LEARNING_DIGESTS_TABLE} WHERE knowledge_base_id = ? AND status = 'pending'`)
      .get(knowledgeBaseId) as { id: number } | undefined;
    if (pending) {
      return { status: 'skipped_pending', knowledgeBaseId, digestId: Number(pending.id), candidateCount: 0 };
    }
  }
  const period = normalizeLearningsDigestPeriod(request.period);
  const from = learningsPeriodStart(period, now, lastDigestPeriodEnd(knowledgeBaseId));
  const candidates = selectLearningCandidatesForDigest(loadOpenCandidates(from, now));
  const minCandidates = normalizeLearningsMinCandidates(request.minCandidates);
  if (candidates.length < minCandidates) {
    return { status: 'skipped_no_candidates', knowledgeBaseId, candidateCount: candidates.length };
  }
  return { status: 'ready', knowledgeBaseId, candidates, from };
}

/** Nur eine noch vorhandene Workflow-ID speichern (Fremdschlüssel; Lauf kann den Workflow überleben). */
function existingWorkflowId(workflowId: number | null | undefined): number | null {
  if (!workflowId || workflowId <= 0) return null;
  return getDb().prepare('SELECT id FROM email_workflows WHERE id = ?').get(workflowId) ? workflowId : null;
}

async function ensureDefaultKnowledgeBase(): Promise<number> {
  const { createKnowledgeBase, saveKnowledgeBaseDocument } = await import('../workflow/knowledge-base.js');
  const id = createKnowledgeBase(LEARNINGS_DEFAULT_KB_NAME, 'Von SimpleCRM aus freigegebenen Learnings gepflegt.', {
    knowledgeContext: LEARNINGS_DEFAULT_KB_CONTEXT,
  });
  saveKnowledgeBaseDocument(id, LEARNINGS_DEFAULT_KB_DOCUMENT);
  setSyncInfo(LEARNINGS_DEFAULT_KB_ID_KEY, String(id));
  return id;
}

/**
 * Auswertung direkt im Main-Prozess. Die Wissensbasis wird nie geschrieben;
 * Ergebnis ist ein Vorschlag (pending) oder ein Fehlereintrag (failed,
 * Kandidaten bleiben unverarbeitet). Pro Wissensbasis läuft höchstens eine.
 */
export async function runAiLearningsDigest(request: AiLearningsDigestRequest): Promise<AiLearningsRunDigestResultDto> {
  const now = request.now ?? new Date();
  const preflight = preflightAiLearningsDigest(request);
  if (preflight.status === 'failed') return { status: 'failed', digestId: null, candidateCount: 0, error: preflight.error };
  if (preflight.status === 'skipped_pending') {
    return { status: 'skipped_pending', digestId: preflight.digestId, candidateCount: 0 };
  }
  if (preflight.status === 'skipped_no_candidates') {
    return { status: 'skipped_no_candidates', digestId: null, candidateCount: preflight.candidateCount };
  }

  // Eine Auswertung zur Zeit: die eigene Wissensbasis entsteht erst im Lauf,
  // ein Schlüssel je Wissensbasis würde zwei parallele Erstläufe nicht trennen.
  const runKey = 'digest';
  if (runningDigests.has(runKey)) {
    return { status: 'skipped_pending', digestId: null, candidateCount: preflight.candidates.length };
  }
  runningDigests.add(runKey);
  try {
    const knowledgeBaseId = preflight.knowledgeBaseId ?? await ensureDefaultKnowledgeBase();
    const document = await knowledgeDocument(knowledgeBaseId);
    const kb = getDb().prepare(`SELECT name FROM ${WORKFLOW_KNOWLEDGE_BASES_TABLE} WHERE id = ?`).get(knowledgeBaseId) as
      | { name: string }
      | undefined;
    const baseContent = document?.content ?? '';
    const settings = getAiLearningsSettings();
    const profileId = request.profileId ?? settings.profileId ?? null;
    const chat = request.chat ?? (async (system: string, user: string, profile: number | null) => {
      const { runChatCompletion } = await import('./email-openai.js');
      return runChatCompletion(system, user, profile);
    });
    const computed = await computeLearningsDigestProposal({
      knowledgeBaseName: kb?.name ?? LEARNINGS_DEFAULT_KB_NAME,
      baseContent,
      candidates: preflight.candidates,
      chat: (prompt) => chat(prompt.system, prompt.user, profileId),
    });

    const db = getDb();
    const insert = db.transaction((): number => {
      const pending = db
        .prepare(`SELECT id FROM ${AI_LEARNING_DIGESTS_TABLE} WHERE knowledge_base_id = ? AND status = 'pending'`)
        .get(knowledgeBaseId) as { id: number } | undefined;
      if (pending && computed.ok) return -Number(pending.id);
      const result = db
        .prepare(
          `INSERT INTO ${AI_LEARNING_DIGESTS_TABLE}
           (knowledge_base_id, status, trigger, requested_by_user_id, workflow_id, period_from, period_to, candidate_count,
            base_content, proposed_content, summary, operations_json, error, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          knowledgeBaseId,
          computed.ok ? 'pending' : 'failed',
          request.trigger,
          request.actorUserId ?? null,
          existingWorkflowId(request.workflowId),
          preflight.from ? nowIso(preflight.from) : null,
          nowIso(now),
          preflight.candidates.length,
          baseContent,
          computed.ok ? computed.proposedContent : '',
          computed.ok ? computed.summary : '',
          JSON.stringify(computed.ok ? computed.applied : []),
          computed.ok ? null : computed.error,
          nowIso(now),
        );
      const id = Number(result.lastInsertRowid);
      if (computed.ok) {
        const mark = db.prepare(
          `UPDATE ${AI_LEARNING_CANDIDATES_TABLE} SET digest_id = ?, processed_at = ? WHERE id = ? AND processed_at IS NULL`,
        );
        for (const candidate of preflight.candidates) mark.run(id, nowIso(now), candidate.id);
      }
      return id;
    });
    const digestId = insert();
    if (digestId < 0) {
      return { status: 'skipped_pending', digestId: -digestId, candidateCount: preflight.candidates.length };
    }
    return computed.ok
      ? { status: 'created', digestId, candidateCount: preflight.candidates.length }
      : { status: 'failed', digestId, candidateCount: preflight.candidates.length, error: computed.error };
  } finally {
    runningDigests.delete(runKey);
  }
}

/** Für Tests. */
export function resetAiLearningsRuntimeState(): void {
  runningDigests.clear();
}

// --- Aufbewahrung ---------------------------------------------------------------

/**
 * Löscht unverarbeitete Kandidaten älter als 90 Tage und verwaiste verarbeitete
 * (Vorschlag gelöscht oder schon entschieden). Läuft im Hintergrund-Tick.
 */
export function pruneAiLearningCandidates(now: Date = new Date()): number {
  const cutoff = nowIso(learningsRetentionCutoff(now));
  return getDb()
    .prepare(
      `DELETE FROM ${AI_LEARNING_CANDIDATES_TABLE}
       WHERE (processed_at IS NULL AND created_at < ?)
          OR (processed_at IS NOT NULL AND digest_id IS NULL)
          OR digest_id IN (SELECT id FROM ${AI_LEARNING_DIGESTS_TABLE} WHERE status IN ('accepted', 'rejected'))`,
    )
    .run(cutoff).changes;
}

const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastPruneAt = 0;

/** Hintergrund-Tick: höchstens alle sechs Stunden aufräumen, Fehler nur protokollieren. */
export function pruneAiLearningCandidatesIfDue(
  logger: Pick<typeof console, 'warn' | 'debug'>,
  now: number = Date.now(),
): void {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  try {
    const removed = pruneAiLearningCandidates(new Date(now));
    if (removed > 0) logger.debug(`[ai-learnings] ${removed} alte Learnings-Einträge gelöscht`);
  } catch (error) {
    logger.warn('[ai-learnings] Aufräumen fehlgeschlagen', error);
  }
}
