/**
 * Learnings mit Freigabe (TA-P5, docs/MAIL_TEILAUTOMATISIERUNG.md 3.4).
 *
 * Sammeln (beim Versand und per Notiz), Auswerten (Job `learnings.digest`) und
 * Übernehmen/Verwerfen eines Vorschlags. Die reine Logik (Datenschutzfilter,
 * Prompt, Parser, Abschnitts-Operationen) liegt in @simplecrm/core und ist mit
 * dem Desktop geteilt. Gespeichert wird nur bereinigter Text; das Sammeln ist
 * best effort und darf den Versand nie stören.
 */
import type { Kysely } from 'kysely';
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
  type LearningCandidateForDigest,
  type LearningCandidateKind,
  type LearningDigestStatus,
  type LearningDigestTrigger,
  type LearningsDigestPeriod,
  type LearningsDigestResultStatus,
  type PreparedLearningCandidate,
} from '@simplecrm/core';

import type { AuditApiPort } from './api/types';
import type { PostgresSecretPort } from './db/postgres-secret-port';
import {
  insertWorkflowKnowledgeBase,
  loadWorkflowKnowledgeDocument,
  saveWorkflowKnowledgeDocument,
} from './db/postgres-workflow-runtime-read-ports';
import type { ServerDatabase } from './db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import { runWorkflowTrackedChatCompletion } from './workflow-ai-chat';
import type { WorkflowKnowledgeDocumentSaveResult } from './api/types';

/** Merkt sich die selbst angelegte „Learnings“-Wissensbasis (Ziel leer). */
export const LEARNINGS_DEFAULT_KB_ID_KEY = 'learnings_default_kb_id';
/** Auswertung eingereiht/laufend (ISO-Zeit); die Oberfläche zeigt „läuft“. */
export const LEARNINGS_DIGEST_RUNNING_KEY = 'learnings_digest_running_at';
const RUNNING_MARKER_TTL_MS = 10 * 60 * 1000;
const LIST_LIMIT_MAX = 200;

export type AiLearningsDeps = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
}>;

export type AiLearningsSettings = {
  collectEnabled: boolean;
  targetKnowledgeBaseId: number | null;
  profileId: number | null;
};

export type AiLearningCandidateRecord = {
  id: number;
  kind: LearningCandidateKind;
  accountId: number | null;
  sourceMessageId: number | null;
  sentMessageId: number | null;
  questionText: string | null;
  aiText: string | null;
  humanText: string | null;
  noteText: string | null;
  createdByUserId: string | null;
  createdAt: string;
  digestId: number | null;
  processedAt: string | null;
};

export type AiLearningDigestRecord = {
  id: number;
  knowledgeBaseId: number;
  knowledgeBaseName: string | null;
  status: LearningDigestStatus;
  trigger: LearningDigestTrigger;
  requestedByUserId: string | null;
  requestedByName: string | null;
  workflowId: number | null;
  periodFrom: string | null;
  periodTo: string;
  candidateCount: number;
  summary: string;
  operations: unknown;
  error: string | null;
  createdAt: string;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  baseContent?: string;
  proposedContent?: string;
};

export type AiLearningsOverview = {
  settings: AiLearningsSettings;
  counts: Record<LearningCandidateKind, number> & { total: number };
  pendingDigestId: number | null;
  running: boolean;
  lastDigestAt: string | null;
  /** Wissensbasis, die eine Auswertung ohne Ziel verwenden würde (null = wird angelegt). */
  effectiveKnowledgeBaseId: number | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function positiveIdOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// --- Einstellungen ------------------------------------------------------------

async function readSyncValues(
  trx: WorkspaceTransaction,
  workspaceId: string,
  keys: readonly string[],
): Promise<Map<string, string | null>> {
  const rows = await trx
    .selectFrom('sync_info')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', 'in', [...keys])
    .execute();
  return new Map(rows.map((row) => [row.key, row.value]));
}

async function writeSyncValues(
  trx: WorkspaceTransaction,
  workspaceId: string,
  values: Readonly<Record<string, string | null>>,
  now: Date,
): Promise<void> {
  const entries = Object.entries(values);
  if (entries.length === 0) return;
  await trx
    .insertInto('sync_info')
    .values(entries.map(([key, value]) => ({
      workspace_id: workspaceId,
      key,
      value,
      last_updated: now,
      source_row: {},
      imported_in_run_id: null,
      updated_at: now,
    })))
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
      value: (eb) => eb.ref('excluded.value'),
      last_updated: now,
      updated_at: now,
    }))
    .execute();
}

export async function readAiLearningsSettingsInTransaction(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<AiLearningsSettings> {
  const values = await readSyncValues(trx, workspaceId, Object.values(LEARNINGS_SETTING_KEYS));
  return {
    collectEnabled: isLearningsCollectEnabledValue(values.get(LEARNINGS_SETTING_KEYS.collectEnabled)),
    targetKnowledgeBaseId: positiveIdOrNull(values.get(LEARNINGS_SETTING_KEYS.targetKnowledgeBaseId)),
    profileId: positiveIdOrNull(values.get(LEARNINGS_SETTING_KEYS.profileId)),
  };
}

export async function readAiLearningsSettings(deps: AiLearningsDeps, workspaceId: string): Promise<AiLearningsSettings> {
  return withWorkspaceTransaction(
    deps.db,
    { workspaceId, role: 'system' },
    (trx) => readAiLearningsSettingsInTransaction(trx, workspaceId),
    { applySession: deps.applyWorkspaceSession },
  );
}

export type AiLearningsSettingsPatch = Partial<AiLearningsSettings>;

export type AiLearningsSettingsResult =
  | { ok: true; settings: AiLearningsSettings }
  | { ok: false; code: 'knowledge_base_not_found' | 'ai_profile_not_found' };

export async function saveAiLearningsSettings(
  deps: AiLearningsDeps,
  workspaceId: string,
  patch: AiLearningsSettingsPatch,
): Promise<AiLearningsSettingsResult> {
  const now = deps.now?.() ?? new Date();
  return withWorkspaceTransaction(
    deps.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      if (patch.targetKnowledgeBaseId != null) {
        const kb = await trx
          .selectFrom('workflow_knowledge_bases')
          .select('id')
          .where('workspace_id', '=', workspaceId)
          .where('id', '=', patch.targetKnowledgeBaseId)
          .executeTakeFirst();
        if (!kb) return { ok: false as const, code: 'knowledge_base_not_found' as const };
      }
      if (patch.profileId != null) {
        const profile = await trx
          .selectFrom('email_ai_profiles')
          .select('id')
          .where('workspace_id', '=', workspaceId)
          .where('id', '=', patch.profileId)
          .executeTakeFirst();
        if (!profile) return { ok: false as const, code: 'ai_profile_not_found' as const };
      }
      const values: Record<string, string | null> = {};
      if (patch.collectEnabled !== undefined) {
        values[LEARNINGS_SETTING_KEYS.collectEnabled] = patch.collectEnabled ? '1' : '0';
      }
      if (patch.targetKnowledgeBaseId !== undefined) {
        values[LEARNINGS_SETTING_KEYS.targetKnowledgeBaseId] = patch.targetKnowledgeBaseId == null
          ? null
          : String(patch.targetKnowledgeBaseId);
      }
      if (patch.profileId !== undefined) {
        values[LEARNINGS_SETTING_KEYS.profileId] = patch.profileId == null ? null : String(patch.profileId);
      }
      await writeSyncValues(trx, workspaceId, values, now);
      return { ok: true as const, settings: await readAiLearningsSettingsInTransaction(trx, workspaceId) };
    },
    { applySession: deps.applyWorkspaceSession },
  );
}

// --- Namen für die Bereinigung --------------------------------------------------

async function workspacePeopleNames(trx: WorkspaceTransaction, workspaceId: string): Promise<string[]> {
  const users = await trx
    .selectFrom('users')
    .select(['display_name', 'public_name'])
    .where('workspace_id', '=', workspaceId)
    .limit(500)
    .execute();
  const team = await trx
    .selectFrom('email_team_members')
    .select(['display_name'])
    .where('workspace_id', '=', workspaceId)
    .limit(500)
    .execute();
  return [
    ...users.flatMap((user) => [user.display_name, user.public_name ?? '']),
    ...team.map((member) => member.display_name),
  ].filter((name) => typeof name === 'string' && name.trim().length > 0);
}

async function customerNames(
  trx: WorkspaceTransaction,
  workspaceId: string,
  customerIds: readonly (number | null | undefined)[],
): Promise<string[]> {
  const ids = [...new Set(customerIds.filter((id): id is number => typeof id === 'number' && id > 0))];
  if (ids.length === 0) return [];
  const rows = await trx
    .selectFrom('customers')
    .select(['name', 'first_name', 'company', 'email'])
    .where('workspace_id', '=', workspaceId)
    .where('id', 'in', ids)
    .execute();
  return rows.flatMap((row) => [
    [row.first_name, row.name].filter(Boolean).join(' '),
    row.name ?? '',
    row.company ?? '',
    row.email ?? '',
  ]).filter((name) => name.trim().length > 0);
}

// --- Kandidaten speichern --------------------------------------------------------

async function insertCandidate(
  trx: WorkspaceTransaction,
  workspaceId: string,
  candidate: PreparedLearningCandidate,
  refs: {
    accountId: number | null;
    sourceMessageId: number | null;
    sentMessageId: number | null;
    createdByUserId: string | null;
  },
  now: Date,
): Promise<number | null> {
  const row = await trx
    .insertInto('ai_learning_candidates')
    .values({
      workspace_id: workspaceId,
      kind: candidate.kind,
      account_id: refs.accountId,
      source_message_id: refs.sourceMessageId,
      sent_message_id: refs.sentMessageId,
      question_text: candidate.questionText,
      ai_text: candidate.aiText,
      human_text: candidate.humanText,
      note_text: candidate.noteText,
      created_by_user_id: refs.createdByUserId,
      created_at: now,
      digest_id: null,
      processed_at: null,
    })
    .onConflict((oc) => oc
      .columns(['workspace_id', 'sent_message_id'])
      .where('sent_message_id', 'is not', null)
      .doNothing())
    .returning('id')
    .executeTakeFirst();
  return row ? Number(row.id) : null;
}

/**
 * Sammelt beim Versand eines Entwurfs (vor dem Nullen des KI-Schnappschusses
 * in markDraftAsSent). Maßgeblich ist die Kennzeichnung „gesendet von“, die
 * finalizeSentDraft unmittelbar davor schreibt: nur sent_by_kind 'human'
 * zählt — unverändert freigegebene (ai_approved) oder automatisch gesendete
 * KI-Entwürfe (ai_auto), Workflow- und Relay-Mails sind keine Learnings.
 * draft_edit: KI-Schnappschuss vorhanden und ein Mensch hat den Entwurf
 * deutlich geändert. human_reply: Antwort ohne KI-Schnappschuss, nicht
 * automatisch gekennzeichnet, auf eine eingehende Mail. Fehler werden nur
 * protokolliert.
 */
export async function collectSentLearningCandidateSafe(
  deps: AiLearningsDeps,
  input: Readonly<{ workspaceId: string; messageId: number }>,
): Promise<void> {
  try {
    const now = deps.now?.() ?? new Date();
    await withWorkspaceTransaction(
      deps.db,
      { workspaceId: input.workspaceId, role: 'system' },
      async (trx) => {
        const settings = await readSyncValues(trx, input.workspaceId, [
          LEARNINGS_SETTING_KEYS.collectEnabled,
          `email_auto_submitted:${input.messageId}`,
        ]);
        if (!isLearningsCollectEnabledValue(settings.get(LEARNINGS_SETTING_KEYS.collectEnabled))) return;

        const draft = await trx
          .selectFrom('email_messages')
          .select([
            'id', 'account_id', 'folder_kind', 'body_text', 'body_html', 'ai_suggestion_snapshot',
            'reply_parent_message_id', 'to_json', 'cc_json', 'customer_id', 'auto_submitted',
            'scheduled_send_actor_user_id', 'scheduled_send_trusted_service_principal', 'sent_by_kind',
          ])
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', input.messageId)
          .executeTakeFirst();
        if (!draft || draft.folder_kind === 'sent') return;
        // Ohne Kennzeichnung (Versand nicht über finalizeSentDraft oder dort
        // fehlgeschlagen) lieber kein Learning als ein falsches.
        if (draft.sent_by_kind !== 'human') return;

        const snapshot = typeof draft.ai_suggestion_snapshot === 'string' ? draft.ai_suggestion_snapshot : '';
        const automatic = settings.get(`email_auto_submitted:${input.messageId}`) === '1'
          || Number(draft.auto_submitted ?? 0) === 1
          || Boolean(draft.scheduled_send_trusted_service_principal);

        const parentId = draft.reply_parent_message_id === null ? null : Number(draft.reply_parent_message_id);
        const parent = parentId
          ? await trx
            .selectFrom('email_messages')
            .select(['id', 'subject', 'body_text', 'body_html', 'from_json', 'to_json', 'cc_json', 'customer_id', 'folder_kind'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', parentId)
            .executeTakeFirst()
          : undefined;

        if (!snapshot.trim()) {
          // Menschliche Antwort: nur auf eingehende Mails und nie automatisch.
          if (automatic || !parent || parent.folder_kind !== 'inbox') return;
        }

        const names = [
          ...learningNamesFromAddressJson(draft.to_json),
          ...learningNamesFromAddressJson(draft.cc_json),
          ...(parent ? learningNamesFromAddressJson(parent.from_json) : []),
          ...(parent ? learningNamesFromAddressJson(parent.to_json) : []),
          ...(parent ? learningNamesFromAddressJson(parent.cc_json) : []),
          ...await customerNames(trx, input.workspaceId, [draft.customer_id, parent?.customer_id]),
          ...await workspacePeopleNames(trx, input.workspaceId),
        ];
        const candidate = prepareSentLearningCandidate({
          aiSnapshot: snapshot,
          sentText: draft.body_text,
          sentHtml: draft.body_html,
          parentSubject: parent?.subject ?? null,
          parentText: parent?.body_text ?? null,
          parentHtml: parent?.body_html ?? null,
          names,
        });
        if (!candidate) return;
        await insertCandidate(trx, input.workspaceId, candidate, {
          accountId: draft.account_id === null ? null : Number(draft.account_id),
          sourceMessageId: parent ? Number(parent.id) : null,
          sentMessageId: input.messageId,
          createdByUserId: draft.scheduled_send_actor_user_id ?? null,
        }, now);
      },
      { applySession: deps.applyWorkspaceSession },
    );
  } catch (error) {
    console.warn(
      `[ai-learnings] Sammeln beim Versand fehlgeschlagen (Nachricht ${input.messageId}): `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export type AiLearningNoteResult =
  | { ok: true; candidate: AiLearningCandidateRecord }
  | { ok: false; code: 'empty_note' | 'message_not_found' };

/** „Learning notieren“: bewusst gesetzt, daher auch bei ausgeschaltetem Sammeln. */
export async function createAiLearningNote(
  deps: AiLearningsDeps,
  input: Readonly<{ workspaceId: string; actorUserId: string; text: string; messageId?: number | null }>,
): Promise<AiLearningNoteResult> {
  const now = deps.now?.() ?? new Date();
  return withWorkspaceTransaction(
    deps.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      let message: {
        id: number; account_id: number | null; subject: string | null; body_text: string | null;
        body_html: string | null; from_json: unknown; to_json: unknown; cc_json: unknown; customer_id: number | null;
      } | undefined;
      if (input.messageId != null) {
        message = await trx
          .selectFrom('email_messages')
          .select(['id', 'account_id', 'subject', 'body_text', 'body_html', 'from_json', 'to_json', 'cc_json', 'customer_id'])
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', input.messageId)
          .executeTakeFirst();
        if (!message) return { ok: false as const, code: 'message_not_found' as const };
      }
      const names = [
        ...(message ? learningNamesFromAddressJson(message.from_json) : []),
        ...(message ? learningNamesFromAddressJson(message.to_json) : []),
        ...(message ? learningNamesFromAddressJson(message.cc_json) : []),
        ...(message ? await customerNames(trx, input.workspaceId, [message.customer_id]) : []),
        ...await workspacePeopleNames(trx, input.workspaceId),
      ];
      const candidate = prepareNoteLearningCandidate({
        note: input.text,
        questionSubject: message?.subject ?? null,
        questionText: message?.body_text ?? null,
        questionHtml: message?.body_html ?? null,
        names,
      });
      if (!candidate) return { ok: false as const, code: 'empty_note' as const };
      const id = await insertCandidate(trx, input.workspaceId, candidate, {
        accountId: message?.account_id == null ? null : Number(message.account_id),
        sourceMessageId: message ? Number(message.id) : null,
        sentMessageId: null,
        createdByUserId: input.actorUserId,
      }, now);
      const row = await trx
        .selectFrom('ai_learning_candidates')
        .selectAll()
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', Number(id))
        .executeTakeFirstOrThrow();
      return { ok: true as const, candidate: mapCandidateRow(row) };
    },
    { applySession: deps.applyWorkspaceSession },
  );
}

// --- Lesen ----------------------------------------------------------------------

type CandidateRow = {
  id: number | string;
  kind: string;
  account_id: number | string | null;
  source_message_id: number | string | null;
  sent_message_id: number | string | null;
  question_text: string | null;
  ai_text: string | null;
  human_text: string | null;
  note_text: string | null;
  created_by_user_id: string | null;
  created_at: Date | string;
  digest_id: number | string | null;
  processed_at: Date | string | null;
};

function nullableNumber(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapCandidateRow(row: CandidateRow): AiLearningCandidateRecord {
  return {
    id: Number(row.id),
    kind: row.kind as LearningCandidateKind,
    accountId: nullableNumber(row.account_id),
    sourceMessageId: nullableNumber(row.source_message_id),
    sentMessageId: nullableNumber(row.sent_message_id),
    questionText: row.question_text,
    aiText: row.ai_text,
    humanText: row.human_text,
    noteText: row.note_text,
    createdByUserId: row.created_by_user_id,
    createdAt: iso(row.created_at) ?? '',
    digestId: nullableNumber(row.digest_id),
    processedAt: iso(row.processed_at),
  };
}

export async function getAiLearningsOverview(deps: AiLearningsDeps, workspaceId: string): Promise<AiLearningsOverview> {
  const now = deps.now?.() ?? new Date();
  return withWorkspaceTransaction(
    deps.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      const settings = await readAiLearningsSettingsInTransaction(trx, workspaceId);
      const markers = await readSyncValues(trx, workspaceId, [LEARNINGS_DIGEST_RUNNING_KEY, LEARNINGS_DEFAULT_KB_ID_KEY]);
      const countRows = await trx
        .selectFrom('ai_learning_candidates')
        .select(['kind', (eb) => eb.fn.countAll<string>().as('count')])
        .where('workspace_id', '=', workspaceId)
        .where('processed_at', 'is', null)
        .groupBy('kind')
        .execute();
      const counts: Record<LearningCandidateKind, number> & { total: number } = {
        draft_edit: 0,
        human_reply: 0,
        note: 0,
        total: 0,
      };
      for (const row of countRows) {
        if ((LEARNING_CANDIDATE_KINDS as readonly string[]).includes(row.kind)) {
          counts[row.kind as LearningCandidateKind] = Number(row.count);
          counts.total += Number(row.count);
        }
      }
      const effectiveKnowledgeBaseId = await resolveExistingTargetKnowledgeBaseId(trx, workspaceId, settings, markers);
      const pending = effectiveKnowledgeBaseId === null
        ? undefined
        : await trx
          .selectFrom('ai_learning_digests')
          .select('id')
          .where('workspace_id', '=', workspaceId)
          .where('knowledge_base_id', '=', effectiveKnowledgeBaseId)
          .where('status', '=', 'pending')
          .executeTakeFirst();
      const last = await trx
        .selectFrom('ai_learning_digests')
        .select('created_at')
        .where('workspace_id', '=', workspaceId)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      const runningAt = markers.get(LEARNINGS_DIGEST_RUNNING_KEY);
      const runningSince = runningAt ? Date.parse(runningAt) : Number.NaN;
      return {
        settings,
        counts,
        pendingDigestId: pending ? Number(pending.id) : null,
        running: Number.isFinite(runningSince) && now.getTime() - runningSince < RUNNING_MARKER_TTL_MS,
        lastDigestAt: iso(last?.created_at ?? null),
        effectiveKnowledgeBaseId,
      };
    },
    { applySession: deps.applyWorkspaceSession },
  );
}

export async function listAiLearningCandidates(
  deps: AiLearningsDeps,
  workspaceId: string,
  options: { kind?: LearningCandidateKind; limit?: number } = {},
): Promise<AiLearningCandidateRecord[]> {
  const limit = Math.max(1, Math.min(LIST_LIMIT_MAX, options.limit ?? 100));
  return withWorkspaceTransaction(
    deps.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      let query = trx
        .selectFrom('ai_learning_candidates')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('processed_at', 'is', null)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit);
      if (options.kind) query = query.where('kind', '=', options.kind);
      return (await query.execute()).map(mapCandidateRow);
    },
    { applySession: deps.applyWorkspaceSession },
  );
}

export async function deleteAiLearningCandidate(
  deps: AiLearningsDeps,
  workspaceId: string,
  id: number,
): Promise<AiLearningCandidateRecord | null> {
  return withWorkspaceTransaction(
    deps.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      const row = await trx
        .deleteFrom('ai_learning_candidates')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      return row ? mapCandidateRow(row) : null;
    },
    { applySession: deps.applyWorkspaceSession },
  );
}

const digestSummaryColumns = [
  'd.id', 'd.knowledge_base_id', 'd.status', 'd.trigger', 'd.requested_by_user_id', 'd.workflow_id',
  'd.period_from', 'd.period_to', 'd.candidate_count', 'd.summary', 'd.operations_json', 'd.error',
  'd.created_at', 'd.decided_by_user_id', 'd.decided_at',
] as const;

type DigestSummaryRow = {
  id: number | string;
  knowledge_base_id: number | string;
  status: string;
  trigger: string;
  requested_by_user_id: string | null;
  workflow_id: number | string | null;
  period_from: Date | string | null;
  period_to: Date | string;
  candidate_count: number | string;
  summary: string;
  operations_json: unknown;
  error: string | null;
  created_at: Date | string;
  decided_by_user_id: string | null;
  decided_at: Date | string | null;
  kb_name: string | null;
  requested_by_name: string | null;
  decided_by_name: string | null;
};

function mapDigestRow(row: DigestSummaryRow): AiLearningDigestRecord {
  return {
    id: Number(row.id),
    knowledgeBaseId: Number(row.knowledge_base_id),
    knowledgeBaseName: row.kb_name,
    status: row.status as LearningDigestStatus,
    trigger: row.trigger as LearningDigestTrigger,
    requestedByUserId: row.requested_by_user_id,
    requestedByName: row.requested_by_name,
    workflowId: nullableNumber(row.workflow_id),
    periodFrom: iso(row.period_from),
    periodTo: iso(row.period_to) ?? '',
    candidateCount: Number(row.candidate_count),
    summary: row.summary,
    operations: row.operations_json,
    error: row.error,
    createdAt: iso(row.created_at) ?? '',
    decidedByUserId: row.decided_by_user_id,
    decidedByName: row.decided_by_name,
    decidedAt: iso(row.decided_at),
  };
}

function digestQuery(trx: WorkspaceTransaction, workspaceId: string) {
  return trx
    .selectFrom('ai_learning_digests as d')
    .leftJoin('workflow_knowledge_bases as kb', (join) => join
      .onRef('kb.id', '=', 'd.knowledge_base_id')
      .onRef('kb.workspace_id', '=', 'd.workspace_id'))
    .leftJoin('users as requester', 'requester.id', 'd.requested_by_user_id')
    .leftJoin('users as decider', 'decider.id', 'd.decided_by_user_id')
    .select([
      ...digestSummaryColumns,
      'kb.name as kb_name',
      'requester.display_name as requested_by_name',
      'decider.display_name as decided_by_name',
    ])
    .where('d.workspace_id', '=', workspaceId);
}

export async function listAiLearningDigests(
  deps: AiLearningsDeps,
  workspaceId: string,
  options: { limit?: number } = {},
): Promise<AiLearningDigestRecord[]> {
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  return withWorkspaceTransaction(
    deps.db,
    { workspaceId, role: 'system' },
    async (trx) => (await digestQuery(trx, workspaceId)
      .orderBy('d.created_at', 'desc')
      .orderBy('d.id', 'desc')
      .limit(limit)
      .execute()).map((row) => mapDigestRow(row as DigestSummaryRow)),
    { applySession: deps.applyWorkspaceSession },
  );
}

export type AiLearningDigestDetail = AiLearningDigestRecord & {
  baseContent: string;
  proposedContent: string;
  /** Aktueller Stand der Wissensbasis (null = gelöscht). */
  currentContent: string | null;
  knowledgeBaseChanged: boolean;
};

export async function getAiLearningDigest(
  deps: AiLearningsDeps,
  workspaceId: string,
  id: number,
): Promise<AiLearningDigestDetail | null> {
  return withWorkspaceTransaction(
    deps.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      const row = await digestQuery(trx, workspaceId)
        .select(['d.base_content', 'd.proposed_content'])
        .where('d.id', '=', id)
        .executeTakeFirst();
      if (!row) return null;
      const current = await loadWorkflowKnowledgeDocument(trx, workspaceId, Number(row.knowledge_base_id));
      const baseContent = String(row.base_content ?? '');
      return {
        ...mapDigestRow(row as DigestSummaryRow),
        baseContent,
        proposedContent: String(row.proposed_content ?? ''),
        currentContent: current?.content ?? null,
        knowledgeBaseChanged: current ? current.content !== baseContent : true,
      };
    },
    { applySession: deps.applyWorkspaceSession },
  );
}

// --- Entscheiden ------------------------------------------------------------------

export type AiLearningDigestDecisionResult =
  | { ok: true; digest: AiLearningDigestRecord; document?: WorkflowKnowledgeDocumentSaveResult; deletedCandidates: number }
  | { ok: false; code: 'not_found' | 'not_pending' | 'knowledge_base_missing' | 'knowledge_base_changed' | 'content_invalid'; currentContent?: string };

/**
 * Übernehmen: schreibt das (ggf. bearbeitete) Dokument atomar in die
 * Wissensbasis, markiert den Vorschlag und löscht die verarbeiteten
 * Kandidaten — alles in einer Transaktion. Hat sich die Wissensbasis seit dem
 * Vorschlag geändert, nur mit confirmOverwrite.
 */
export async function acceptAiLearningDigest(
  deps: AiLearningsDeps,
  input: Readonly<{ workspaceId: string; actorUserId: string; id: number; content: string; confirmOverwrite?: boolean }>,
): Promise<AiLearningDigestDecisionResult> {
  const content = String(input.content ?? '');
  if (!content.trim() || content.length > LEARNINGS_KNOWLEDGE_DOCUMENT_MAX_LENGTH) {
    return { ok: false, code: 'content_invalid' };
  }
  const now = deps.now?.() ?? new Date();
  return withWorkspaceTransaction(
    deps.db,
    { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
    async (trx) => {
      const digest = await trx
        .selectFrom('ai_learning_digests')
        .select(['id', 'status', 'knowledge_base_id', 'base_content'])
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.id)
        .forUpdate()
        .executeTakeFirst();
      if (!digest) return { ok: false as const, code: 'not_found' as const };
      if (digest.status !== 'pending') return { ok: false as const, code: 'not_pending' as const };
      const current = await loadWorkflowKnowledgeDocument(trx, input.workspaceId, Number(digest.knowledge_base_id));
      if (!current) return { ok: false as const, code: 'knowledge_base_missing' as const };
      if (current.content !== digest.base_content && input.confirmOverwrite !== true) {
        return { ok: false as const, code: 'knowledge_base_changed' as const, currentContent: current.content };
      }
      const document = await saveWorkflowKnowledgeDocument(
        trx,
        input.workspaceId,
        Number(digest.knowledge_base_id),
        content,
        now,
      );
      if (!document) return { ok: false as const, code: 'knowledge_base_missing' as const };
      await trx
        .updateTable('ai_learning_digests')
        .set({ status: 'accepted', decided_by_user_id: input.actorUserId, decided_at: now, proposed_content: content })
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.id)
        .execute();
      const deleted = await trx
        .deleteFrom('ai_learning_candidates')
        .where('workspace_id', '=', input.workspaceId)
        .where('digest_id', '=', input.id)
        .executeTakeFirst();
      const row = await digestQuery(trx, input.workspaceId).where('d.id', '=', input.id).executeTakeFirstOrThrow();
      return {
        ok: true as const,
        digest: mapDigestRow(row as DigestSummaryRow),
        document,
        deletedCandidates: Number(deleted.numDeletedRows ?? 0),
      };
    },
    { applySession: deps.applyWorkspaceSession },
  );
}

/** Verwerfen: Vorschlag bleibt im Verlauf, die verarbeiteten Kandidaten werden gelöscht. */
export async function rejectAiLearningDigest(
  deps: AiLearningsDeps,
  input: Readonly<{ workspaceId: string; actorUserId: string; id: number }>,
): Promise<AiLearningDigestDecisionResult> {
  const now = deps.now?.() ?? new Date();
  return withWorkspaceTransaction(
    deps.db,
    { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
    async (trx) => {
      const digest = await trx
        .selectFrom('ai_learning_digests')
        .select(['id', 'status'])
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.id)
        .forUpdate()
        .executeTakeFirst();
      if (!digest) return { ok: false as const, code: 'not_found' as const };
      if (digest.status !== 'pending') return { ok: false as const, code: 'not_pending' as const };
      await trx
        .updateTable('ai_learning_digests')
        .set({ status: 'rejected', decided_by_user_id: input.actorUserId, decided_at: now })
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.id)
        .execute();
      const deleted = await trx
        .deleteFrom('ai_learning_candidates')
        .where('workspace_id', '=', input.workspaceId)
        .where('digest_id', '=', input.id)
        .executeTakeFirst();
      const row = await digestQuery(trx, input.workspaceId).where('d.id', '=', input.id).executeTakeFirstOrThrow();
      return {
        ok: true as const,
        digest: mapDigestRow(row as DigestSummaryRow),
        deletedCandidates: Number(deleted.numDeletedRows ?? 0),
      };
    },
    { applySession: deps.applyWorkspaceSession },
  );
}

// --- Auswerten --------------------------------------------------------------------

export type AiLearningsDigestPlan = Readonly<{
  workspaceId: string;
  knowledgeBaseId?: number;
  period: LearningsDigestPeriod;
  minCandidates: number;
  profileId?: number;
  trigger: LearningDigestTrigger;
  actorUserId?: string;
  workflowId?: number;
}>;

export type AiLearningsDigestResult = Readonly<{
  status: Exclude<LearningsDigestResultStatus, 'queued'>;
  digestId: number | null;
  candidateCount: number;
  knowledgeBaseId: number | null;
  error?: string;
}>;

export type AiLearningsDigestDeps = AiLearningsDeps & Readonly<{
  secrets?: PostgresSecretPort;
  audit?: AuditApiPort;
  /** Tests/Alternativen: sonst runWorkflowTrackedChatCompletion (Budget + Usage). */
  chat?: (input: { workspaceId: string; profileId?: number; actorUserId?: string; system: string; user: string }) => Promise<string>;
  fetchImpl?: typeof fetch;
}>;

async function resolveExistingTargetKnowledgeBaseId(
  trx: WorkspaceTransaction,
  workspaceId: string,
  settings: AiLearningsSettings,
  markers?: Map<string, string | null>,
  explicitId?: number,
): Promise<number | null> {
  const candidates = [explicitId, settings.targetKnowledgeBaseId];
  for (const id of candidates) {
    if (!id) continue;
    const row = await trx
      .selectFrom('workflow_knowledge_bases')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .executeTakeFirst();
    // Ausdrücklich gewähltes, aber gelöschtes Ziel: nicht still umlenken.
    return row ? Number(row.id) : -1;
  }
  const values = markers ?? await readSyncValues(trx, workspaceId, [LEARNINGS_DEFAULT_KB_ID_KEY]);
  const defaultId = positiveIdOrNull(values.get(LEARNINGS_DEFAULT_KB_ID_KEY));
  if (!defaultId) return null;
  const row = await trx
    .selectFrom('workflow_knowledge_bases')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', defaultId)
    .executeTakeFirst();
  return row ? Number(row.id) : null;
}

async function lastDigestPeriodEnd(
  trx: WorkspaceTransaction,
  workspaceId: string,
  knowledgeBaseId: number | null,
): Promise<Date | null> {
  if (knowledgeBaseId === null) return null;
  const row = await trx
    .selectFrom('ai_learning_digests')
    .select('period_to')
    .where('workspace_id', '=', workspaceId)
    .where('knowledge_base_id', '=', knowledgeBaseId)
    .where('status', '!=', 'failed')
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? new Date(row.period_to) : null;
}

async function loadOpenCandidates(
  trx: WorkspaceTransaction,
  workspaceId: string,
  from: Date | null,
  to: Date,
): Promise<(LearningCandidateForDigest & { id: number })[]> {
  let query = trx
    .selectFrom('ai_learning_candidates')
    .select(['id', 'kind', 'question_text', 'ai_text', 'human_text', 'note_text', 'created_at'])
    .where('workspace_id', '=', workspaceId)
    .where('processed_at', 'is', null)
    .where('created_at', '<=', to)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(LEARNINGS_DIGEST_MAX_CANDIDATES);
  if (from) query = query.where('created_at', '>=', from);
  const rows = await query.execute();
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind as LearningCandidateKind,
    questionText: row.question_text,
    aiText: row.ai_text,
    humanText: row.human_text,
    noteText: row.note_text,
    createdAt: iso(row.created_at) ?? '',
  }));
}

export type AiLearningsDigestPreflight =
  | { status: 'skipped_pending'; knowledgeBaseId: number; digestId: number; candidateCount: number }
  | { status: 'skipped_no_candidates'; knowledgeBaseId: number | null; candidateCount: number }
  | { status: 'failed'; error: string; knowledgeBaseId: number | null; candidateCount: number }
  | { status: 'ready'; knowledgeBaseId: number | null; candidateCount: number };

/** Vorabprüfung (ohne KI): offener Vorschlag? genug Kandidaten? Genutzt von Knoten und Job. */
export async function preflightAiLearningsDigest(
  trx: WorkspaceTransaction,
  plan: Omit<AiLearningsDigestPlan, 'trigger'>,
  now: Date,
): Promise<AiLearningsDigestPreflight> {
  const settings = await readAiLearningsSettingsInTransaction(trx, plan.workspaceId);
  const knowledgeBaseId = await resolveExistingTargetKnowledgeBaseId(
    trx,
    plan.workspaceId,
    settings,
    undefined,
    plan.knowledgeBaseId,
  );
  if (knowledgeBaseId === -1) {
    return { status: 'failed', error: 'Ziel-Wissensbasis nicht gefunden', knowledgeBaseId: null, candidateCount: 0 };
  }
  if (knowledgeBaseId !== null) {
    const pending = await trx
      .selectFrom('ai_learning_digests')
      .select('id')
      .where('workspace_id', '=', plan.workspaceId)
      .where('knowledge_base_id', '=', knowledgeBaseId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (pending) {
      return { status: 'skipped_pending', knowledgeBaseId, digestId: Number(pending.id), candidateCount: 0 };
    }
  }
  const from = learningsPeriodStart(plan.period, now, await lastDigestPeriodEnd(trx, plan.workspaceId, knowledgeBaseId));
  const candidates = selectLearningCandidatesForDigest(await loadOpenCandidates(trx, plan.workspaceId, from, now));
  if (candidates.length < plan.minCandidates) {
    return { status: 'skipped_no_candidates', knowledgeBaseId, candidateCount: candidates.length };
  }
  return { status: 'ready', knowledgeBaseId, candidateCount: candidates.length };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === '23505');
}

/**
 * Der eigentliche Auswertungslauf (Job `learnings.digest`). Die Wissensbasis
 * wird nie geschrieben; Ergebnis ist ein Vorschlag (pending) oder ein
 * Fehlereintrag (failed, Kandidaten bleiben unverarbeitet).
 */
export async function runAiLearningsDigest(
  deps: AiLearningsDigestDeps,
  plan: AiLearningsDigestPlan,
): Promise<AiLearningsDigestResult> {
  const now = deps.now?.() ?? new Date();
  const session = { applySession: deps.applyWorkspaceSession };
  try {
    const prepared = await withWorkspaceTransaction(deps.db, { workspaceId: plan.workspaceId, role: 'system' }, async (trx) => {
      const settings = await readAiLearningsSettingsInTransaction(trx, plan.workspaceId);
      const preflight = await preflightAiLearningsDigest(trx, plan, now);
      if (preflight.status !== 'ready') return { kind: 'skip' as const, preflight };
      let knowledgeBaseId = preflight.knowledgeBaseId;
      if (knowledgeBaseId === null) {
        // Eigene Wissensbasis „Learnings“ (eigener Kontext, wird immer mitgelesen) beim ersten Vorschlag anlegen.
        const created = await insertWorkflowKnowledgeBase(trx, plan.workspaceId, {
          name: LEARNINGS_DEFAULT_KB_NAME,
          description: 'Von SimpleCRM aus freigegebenen Learnings gepflegt.',
          knowledgeContext: LEARNINGS_DEFAULT_KB_CONTEXT,
          content: LEARNINGS_DEFAULT_KB_DOCUMENT,
        }, now);
        knowledgeBaseId = created.id;
        await writeSyncValues(trx, plan.workspaceId, { [LEARNINGS_DEFAULT_KB_ID_KEY]: String(created.id) }, now);
      }
      const document = await loadWorkflowKnowledgeDocument(trx, plan.workspaceId, knowledgeBaseId);
      const from = learningsPeriodStart(plan.period, now, await lastDigestPeriodEnd(trx, plan.workspaceId, knowledgeBaseId));
      const candidates = selectLearningCandidatesForDigest(await loadOpenCandidates(trx, plan.workspaceId, from, now));
      return {
        kind: 'ready' as const,
        knowledgeBaseId,
        knowledgeBaseName: document?.knowledgeBase.name ?? LEARNINGS_DEFAULT_KB_NAME,
        baseContent: document?.content ?? '',
        candidates,
        from,
        profileId: plan.profileId ?? settings.profileId ?? undefined,
      };
    }, session);
    if (prepared.kind === 'skip') {
      const preflight = prepared.preflight;
      if (preflight.status === 'failed') {
        return { status: 'failed', digestId: null, candidateCount: 0, knowledgeBaseId: null, error: preflight.error };
      }
      return {
        status: preflight.status,
        digestId: preflight.status === 'skipped_pending' ? preflight.digestId : null,
        candidateCount: preflight.candidateCount,
        knowledgeBaseId: preflight.knowledgeBaseId,
      };
    }

    const chat = deps.chat ?? (async (input) => {
      if (!deps.secrets) throw new Error('KI ist auf diesem Server nicht konfiguriert');
      return runWorkflowTrackedChatCompletion(
        { db: deps.db, secrets: deps.secrets, applyWorkspaceSession: deps.applyWorkspaceSession, now: deps.now, fetchImpl: deps.fetchImpl },
        {
          workspaceId: input.workspaceId,
          messageId: null,
          nodeType: 'ai.learnings_digest',
          ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
          actorUserId: input.actorUserId ?? null,
          system: input.system,
          user: input.user,
        },
      );
    });
    const computed = await computeLearningsDigestProposal({
      knowledgeBaseName: prepared.knowledgeBaseName,
      baseContent: prepared.baseContent,
      candidates: prepared.candidates,
      chat: (prompt) => chat({
        workspaceId: plan.workspaceId,
        ...(prepared.profileId === undefined ? {} : { profileId: prepared.profileId }),
        ...(plan.actorUserId ? { actorUserId: plan.actorUserId } : {}),
        system: prompt.system,
        user: prompt.user,
      }),
    });

    let digestId: number;
    try {
      digestId = await withWorkspaceTransaction(deps.db, { workspaceId: plan.workspaceId, role: 'system' }, async (trx) => {
        // Nur eine noch vorhandene Workflow-ID speichern (Fremdschlüssel).
        const workflow = plan.workflowId
          ? await trx
            .selectFrom('email_workflows')
            .select('id')
            .where('workspace_id', '=', plan.workspaceId)
            .where('id', '=', plan.workflowId)
            .executeTakeFirst()
          : undefined;
        const row = await trx
          .insertInto('ai_learning_digests')
          .values({
            workspace_id: plan.workspaceId,
            knowledge_base_id: prepared.knowledgeBaseId,
            status: computed.ok ? 'pending' : 'failed',
            trigger: plan.trigger,
            requested_by_user_id: plan.actorUserId ?? null,
            workflow_id: workflow ? Number(workflow.id) : null,
            period_from: prepared.from,
            period_to: now,
            candidate_count: prepared.candidates.length,
            base_content: prepared.baseContent,
            proposed_content: computed.ok ? computed.proposedContent : '',
            summary: computed.ok ? computed.summary : '',
            operations_json: JSON.stringify(computed.ok ? computed.applied : []),
            error: computed.ok ? null : computed.error,
            created_at: now,
            decided_by_user_id: null,
            decided_at: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const id = Number(row.id);
        if (computed.ok) {
          await trx
            .updateTable('ai_learning_candidates')
            .set({ digest_id: id, processed_at: now })
            .where('workspace_id', '=', plan.workspaceId)
            .where('id', 'in', prepared.candidates.map((candidate) => candidate.id))
            .where('processed_at', 'is', null)
            .execute();
        }
        return id;
      }, session);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Parallel entstand schon ein offener Vorschlag für diese Wissensbasis.
        return { status: 'skipped_pending', digestId: null, candidateCount: prepared.candidates.length, knowledgeBaseId: prepared.knowledgeBaseId };
      }
      throw error;
    }

    await deps.audit?.record({
      workspaceId: plan.workspaceId,
      actorUserId: plan.actorUserId ?? null,
      action: 'ai_learning_digest.created',
      entityType: 'ai_learning_digest',
      entityId: String(digestId),
      metadata: {
        id: digestId,
        knowledgeBaseId: prepared.knowledgeBaseId,
        status: computed.ok ? 'pending' : 'failed',
        trigger: plan.trigger,
        workflowId: plan.workflowId ?? null,
        candidateCount: prepared.candidates.length,
        operationCount: computed.ok ? computed.operations.length : 0,
      },
    }).catch(() => undefined);

    return computed.ok
      ? { status: 'created', digestId, candidateCount: prepared.candidates.length, knowledgeBaseId: prepared.knowledgeBaseId }
      : { status: 'failed', digestId, candidateCount: prepared.candidates.length, knowledgeBaseId: prepared.knowledgeBaseId, error: computed.error };
  } finally {
    await withWorkspaceTransaction(deps.db, { workspaceId: plan.workspaceId, role: 'system' }, async (trx) => {
      await trx
        .deleteFrom('sync_info')
        .where('workspace_id', '=', plan.workspaceId)
        .where('key', '=', LEARNINGS_DIGEST_RUNNING_KEY)
        .execute();
    }, session).catch(() => undefined);
  }
}

/** Setzt den „läuft“-Marker beim Einreihen (Route/Knoten). */
export async function markAiLearningsDigestQueued(trx: WorkspaceTransaction, workspaceId: string, now: Date): Promise<void> {
  await writeSyncValues(trx, workspaceId, { [LEARNINGS_DIGEST_RUNNING_KEY]: now.toISOString() }, now);
}

/** Job-Payload für `learnings.digest` (ohne Akteur; Route/Knoten ergänzen Provenienz). */
export function buildAiLearningsDigestJobPayload(plan: Omit<AiLearningsDigestPlan, 'actorUserId'>): Record<string, unknown> {
  return {
    workspaceId: plan.workspaceId,
    period: plan.period,
    minCandidates: plan.minCandidates,
    trigger: plan.trigger,
    ...(plan.knowledgeBaseId ? { knowledgeBaseId: plan.knowledgeBaseId } : {}),
    ...(plan.profileId ? { profileId: plan.profileId } : {}),
    ...(plan.workflowId ? { workflowId: plan.workflowId } : {}),
  };
}

export function buildAiLearningsDigestJobPlan(payload: Record<string, unknown>, jobWorkspaceId: string): AiLearningsDigestPlan {
  const workspaceId = typeof payload.workspaceId === 'string' && payload.workspaceId.trim()
    ? payload.workspaceId.trim()
    : jobWorkspaceId;
  if (workspaceId !== jobWorkspaceId) throw new Error('learnings.digest workspaceId does not match job workspace');
  const knowledgeBaseId = positiveIdOrNull(payload.knowledgeBaseId);
  const profileId = positiveIdOrNull(payload.profileId);
  const workflowId = positiveIdOrNull(payload.workflowId);
  const actorUserId = typeof payload.actorUserId === 'string' && payload.actorUserId.trim() ? payload.actorUserId.trim() : undefined;
  return {
    workspaceId,
    period: normalizeLearningsDigestPeriod(payload.period),
    minCandidates: normalizeLearningsMinCandidates(payload.minCandidates),
    trigger: payload.trigger === 'workflow' ? 'workflow' : 'manual',
    ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    ...(profileId ? { profileId } : {}),
    ...(workflowId ? { workflowId } : {}),
    ...(actorUserId ? { actorUserId } : {}),
  };
}

export type AiLearningsDigestJobPort = Readonly<{
  digest(plan: AiLearningsDigestPlan): Promise<AiLearningsDigestResult>;
}>;

export function createPostgresAiLearningsDigestPort(deps: AiLearningsDigestDeps): AiLearningsDigestJobPort {
  return {
    async digest(plan) {
      const result = await runAiLearningsDigest(deps, plan);
      if (result.status === 'failed' && result.digestId === null) {
        console.warn(`[ai-learnings] Auswertung nicht möglich (Workspace ${plan.workspaceId}): ${result.error ?? 'unbekannt'}`);
      }
      return result;
    },
  };
}

// --- Aufbewahrung -----------------------------------------------------------------

/**
 * Löscht unverarbeitete Kandidaten älter als 90 Tage und verwaiste verarbeitete
 * (Vorschlag gelöscht oder schon entschieden). Läuft im audit.retention-Takt.
 */
export async function pruneAiLearningCandidates(
  deps: AiLearningsDeps,
  workspaceId: string,
): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const cutoff = learningsRetentionCutoff(now);
  return withWorkspaceTransaction(
    deps.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      const stale = await trx
        .deleteFrom('ai_learning_candidates')
        .where('workspace_id', '=', workspaceId)
        .where((eb) => eb.or([
          eb.and([eb('processed_at', 'is', null), eb('created_at', '<', cutoff)]),
          eb.and([eb('processed_at', 'is not', null), eb('digest_id', 'is', null)]),
          eb('digest_id', 'in', eb
            .selectFrom('ai_learning_digests')
            .select('id')
            .where('workspace_id', '=', workspaceId)
            .where('status', 'in', ['accepted', 'rejected'])),
        ]))
        .executeTakeFirst();
      return Number(stale.numDeletedRows ?? 0);
    },
    { applySession: deps.applyWorkspaceSession },
  );
}

// --- API-Port ---------------------------------------------------------------------

export type AiLearningsApiPort = Readonly<{
  getSettings(workspaceId: string): Promise<AiLearningsSettings>;
  saveSettings(workspaceId: string, patch: AiLearningsSettingsPatch): Promise<AiLearningsSettingsResult>;
  overview(workspaceId: string): Promise<AiLearningsOverview>;
  listCandidates(workspaceId: string, options: { kind?: LearningCandidateKind; limit?: number }): Promise<AiLearningCandidateRecord[]>;
  deleteCandidate(workspaceId: string, id: number): Promise<AiLearningCandidateRecord | null>;
  createNote(input: { workspaceId: string; actorUserId: string; text: string; messageId?: number | null }): Promise<AiLearningNoteResult>;
  listDigests(workspaceId: string, options: { limit?: number }): Promise<AiLearningDigestRecord[]>;
  getDigest(workspaceId: string, id: number): Promise<AiLearningDigestDetail | null>;
  acceptDigest(input: { workspaceId: string; actorUserId: string; id: number; content: string; confirmOverwrite?: boolean }): Promise<AiLearningDigestDecisionResult>;
  rejectDigest(input: { workspaceId: string; actorUserId: string; id: number }): Promise<AiLearningDigestDecisionResult>;
  /** Vorabprüfung und „läuft“-Marker, bevor die Route einen Job einreiht. */
  prepareDigestRequest(plan: Omit<AiLearningsDigestPlan, 'trigger'>): Promise<AiLearningsDigestPreflight>;
}>;

export function createPostgresAiLearningsApiPort(deps: AiLearningsDeps): AiLearningsApiPort {
  return {
    getSettings: (workspaceId) => readAiLearningsSettings(deps, workspaceId),
    saveSettings: (workspaceId, patch) => saveAiLearningsSettings(deps, workspaceId, patch),
    overview: (workspaceId) => getAiLearningsOverview(deps, workspaceId),
    listCandidates: (workspaceId, options) => listAiLearningCandidates(deps, workspaceId, options),
    deleteCandidate: (workspaceId, id) => deleteAiLearningCandidate(deps, workspaceId, id),
    createNote: (input) => createAiLearningNote(deps, input),
    listDigests: (workspaceId, options) => listAiLearningDigests(deps, workspaceId, options),
    getDigest: (workspaceId, id) => getAiLearningDigest(deps, workspaceId, id),
    acceptDigest: (input) => acceptAiLearningDigest(deps, input),
    rejectDigest: (input) => rejectAiLearningDigest(deps, input),
    async prepareDigestRequest(plan) {
      const now = deps.now?.() ?? new Date();
      return withWorkspaceTransaction(
        deps.db,
        { workspaceId: plan.workspaceId, role: 'system' },
        async (trx) => {
          const preflight = await preflightAiLearningsDigest(trx, plan, now);
          if (preflight.status === 'ready') await markAiLearningsDigestQueued(trx, plan.workspaceId, now);
          return preflight;
        },
        { applySession: deps.applyWorkspaceSession },
      );
    },
  };
}

// --- Workflow-Knoten ai.learnings_digest (Server) ---------------------------------

/** Richtungen, in denen der Knoten nicht sinnvoll ist (Mail-Ereignis statt Zeitplan). */
const LEARNINGS_NODE_SKIPPED_DIRECTIONS = new Set(['inbound', 'outbound', 'relay', 'draft_created']);

export type ServerLearningsDigestNodeResult = {
  status: 'ok' | 'skipped' | 'error';
  port: 'default' | 'error';
  message: string;
  variables?: Record<string, string | number>;
};

function learningsNodeVariables(
  status: LearningsDigestResultStatus,
  digestId: number | null,
  candidateCount: number,
): Record<string, string | number> {
  return {
    'learnings.status': status,
    'learnings.digest_id': digestId ?? '',
    'learnings.candidate_count': candidateCount,
  };
}

/**
 * Server-Ausführung: prüft vorab (offener Vorschlag, genug Einträge) und reiht
 * dann den Job `learnings.digest` in derselben Transaktion ein. Der KI-Aufruf
 * läuft im Job; der Knoten meldet `queued` und der Graph läuft sofort weiter.
 */
export async function executeServerLearningsDigestNode(
  trx: WorkspaceTransaction,
  input: Readonly<{
    workspaceId: string;
    workflowId: number;
    direction: string;
    config: Record<string, unknown>;
    provenance: Record<string, unknown>;
    dryRun: boolean;
    now: Date;
  }>,
): Promise<ServerLearningsDigestNodeResult> {
  if (LEARNINGS_NODE_SKIPPED_DIRECTIONS.has(input.direction)) {
    return {
      status: 'skipped',
      port: 'default',
      message: 'Learnings auswerten läuft nur in Zeitplan- oder manuellen Workflows',
    };
  }
  const knowledgeBaseId = positiveIdOrNull(input.config.knowledgeBaseId);
  const profileId = positiveIdOrNull(input.config.profileId);
  const plan = {
    workspaceId: input.workspaceId,
    period: normalizeLearningsDigestPeriod(input.config.period),
    minCandidates: normalizeLearningsMinCandidates(input.config.minCandidates),
    ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    ...(profileId ? { profileId } : {}),
  };
  const preflight = await preflightAiLearningsDigest(trx, plan, input.now);
  if (preflight.status === 'failed') {
    return {
      status: 'error',
      port: 'error',
      message: preflight.error,
      variables: learningsNodeVariables('failed', null, 0),
    };
  }
  if (preflight.status !== 'ready') {
    return {
      status: 'ok',
      port: 'default',
      message: preflight.status === 'skipped_pending'
        ? 'Es gibt schon einen offenen Vorschlag für diese Wissensbasis'
        : `Zu wenige gesammelte Einträge (${preflight.candidateCount} von mindestens ${plan.minCandidates})`,
      variables: learningsNodeVariables(
        preflight.status,
        preflight.status === 'skipped_pending' ? preflight.digestId : null,
        preflight.candidateCount,
      ),
    };
  }
  if (input.dryRun) {
    return {
      status: 'ok',
      port: 'default',
      message: `Probelauf: Auswertung von ${preflight.candidateCount} Einträgen würde eingereiht`,
      variables: learningsNodeVariables('queued', null, preflight.candidateCount),
    };
  }
  const job = await trx
    .insertInto('job_queue')
    .values({
      type: 'learnings.digest',
      payload: {
        ...buildAiLearningsDigestJobPayload({ ...plan, trigger: 'workflow', workflowId: input.workflowId }),
        ...input.provenance,
      },
      run_after: input.now,
      max_attempts: 1,
      workspace_id: input.workspaceId,
      updated_at: input.now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await markAiLearningsDigestQueued(trx, input.workspaceId, input.now);
  return {
    status: 'ok',
    port: 'default',
    message: `queued_learnings_digest:${Number(job.id)}`,
    variables: learningsNodeVariables('queued', null, preflight.candidateCount),
  };
}
