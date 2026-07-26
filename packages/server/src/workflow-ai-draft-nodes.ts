/**
 * Server execution for ai.draft_reply and ai.review_draft (Zwei-Stufen-KI-Antwort).
 */
import addressparser from 'nodemailer/lib/addressparser';
import { sql as kyselySql } from 'kysely';
import {
  addressesFromRecipientJson,
  messageIsSpamOrReviewForInboundWorkflow,
  outboundDraftFingerprint,
  parseDraftReviewResponse,
} from '@simplecrm/core';

import type { PostgresSecretPort } from './db/postgres-secret-port';
import type { ServerDatabase } from './db/schema';
import { createPostgresComposeDraftInTransaction } from './db/postgres-mail-read-ports';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import { searchKnowledgeForWorkflow } from './knowledge-workflow-search';
import { runWorkflowTrackedChatCompletion, type WorkflowAiChatDeps } from './workflow-ai-chat';
import {
  buildSignatureTemplateContext,
  interpolateSignatureTemplate,
} from './signature-template.js';
import {
  aiDraftLikelyIncludesGreeting,
  buildReplyGreeting,
} from './email-reply-greeting.js';
import {
  enqueueContinuation,
  type AiClassificationContinuation,
} from './ai-classification';
import { enqueueNextInboundWorkflowAfterTerminalChildFailure } from './workflow-inbound-chain-advance';
import type { JobPayload } from './jobs/types';

const MAX_AI_DRAFT_REPLY_CHARS = 16_000;

export type WorkflowAiDraftNodeDeps = WorkflowAiChatDeps & Readonly<{
  db: import('kysely').Kysely<ServerDatabase>;
  secrets: PostgresSecretPort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type NodeResult = Readonly<{
  status: 'ok' | 'error' | 'skipped';
  port?: string;
  message?: string;
  variables?: Record<string, string | number | boolean | null>;
}>;

export async function executeWorkflowAiDraftReply(
  trx: WorkspaceTransaction,
  deps: WorkflowAiDraftNodeDeps,
  input: {
    workspaceId: string;
    messageId: number;
    config: Record<string, unknown>;
    strings: Record<string, string>;
    variables: Record<string, string | number | boolean | null>;
    actorUserId?: string | null;
    dryRun?: boolean;
  },
): Promise<NodeResult> {
  const message = await trx
    .selectFrom('email_messages')
    .select([
      'id',
      'account_id',
      'subject',
      'from_json',
      'raw_headers',
      'body_text',
      'snippet',
      'is_spam',
      'spam_status',
      'spam_score_label',
    ])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .executeTakeFirst();
  if (!message) return { status: 'error', message: 'Nachricht nicht gefunden' };
  if (messageIsSpamOrReviewForInboundWorkflow(message)) {
    return { status: 'skipped', message: 'skip:message_spam_or_review' };
  }
  if (input.dryRun) {
    return {
      status: 'ok',
      message: 'dry-run draft_reply',
      variables: { 'draft.id': 0, 'ai.draft.text': '(Dry-Run)', 'ai.draft.subject': 'Re:' },
    };
  }
  if (message.account_id === null) {
    return { status: 'error', message: 'Nachricht ohne Konto' };
  }

  const profileId = optionalPositiveInt(input.config.profileId);
  const knowledgeBaseId = optionalPositiveInt(input.config.knowledgeBaseId);
  const query = input.strings.combined_text ?? '';
  let chunks;
  if (knowledgeBaseId !== undefined) {
    chunks = await searchKnowledgeForWorkflow(
      trx,
      input.workspaceId,
      Number(message.account_id),
      'inbound',
      query,
      5,
      knowledgeBaseId,
    );
  } else {
    chunks = await searchKnowledgeForWorkflow(
      trx,
      input.workspaceId,
      Number(message.account_id),
      'inbound',
      query,
      5,
    );
  }
  const kbText = chunks.map((c) => c.content).join('\n---\n');

  let cannedBlock = '';
  if (input.config.includeCanned === true) {
    const canned = await trx
      .selectFrom('email_canned_responses')
      .select(['title', 'body'])
      .where('workspace_id', '=', input.workspaceId)
      .where((eb) => eb.or([
        eb('account_id', 'is', null),
        eb('account_id', '=', Number(message.account_id)),
      ]))
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .limit(5)
      .execute();
    if (canned.length > 0) {
      cannedBlock = canned
        .map((c) => `• ${String(c.title ?? '')}:\n${String(c.body ?? '').slice(0, 1200)}`)
        .join('\n\n');
    }
  }

  const system = String(input.config.systemPrompt ?? '').trim()
    || 'Beantworte die Kundenmail freundlich auf Deutsch.';
  const user = [
    'Kundenmail:',
    query,
    kbText ? `\nWissensbasis (relevante Auszüge):\n${kbText}` : '',
    cannedBlock ? `\nVorhandene Textbausteine (als Formulierungshilfe):\n${cannedBlock}` : '',
  ].filter(Boolean).join('\n');

  let aiText: string;
  try {
    aiText = (await runWorkflowTrackedChatCompletion(deps, {
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      nodeType: 'ai.draft_reply',
      profileId,
      actorUserId: input.actorUserId ?? null,
      system,
      user,
    })).trim();
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  if (!aiText) return { status: 'error', message: 'KI lieferte keinen Antworttext' };
  if (aiText.length > MAX_AI_DRAFT_REPLY_CHARS) {
    return {
      status: 'error',
      message: `KI-Antwort unplausibel lang (${aiText.length} Zeichen, Limit ${MAX_AI_DRAFT_REPLY_CHARS})`,
    };
  }

  const parts: string[] = [];
  if (input.config.greeting !== 'none' && !aiDraftLikelyIncludesGreeting(aiText)) {
    const customerName = input.variables['customer.name'];
    parts.push(
      buildReplyGreeting({
        customer:
          typeof customerName === 'string' && customerName
            ? { name: customerName }
            : null,
        fromJson: typeof message.from_json === 'string'
          ? message.from_json
          : message.from_json == null
            ? null
            : JSON.stringify(message.from_json),
      }),
      '',
    );
  }
  parts.push(aiText);
  if (input.config.signature !== 'none') {
    const accountSig = await resolveAccountSignatureText(trx, {
      workspaceId: input.workspaceId,
      accountId: Number(message.account_id),
      variables: input.variables,
      actorUserId: input.actorUserId ?? null,
    });
    parts.push('', accountSig || 'Mit freundlichen Grüßen');
  }
  const bodyText = parts.join('\n');
  const replyTo = firstReplyAddress({
    from_json: message.from_json,
    raw_headers: message.raw_headers,
  });
  if (!replyTo) return { status: 'error', message: 'Kein Antwort-Empfänger ermittelbar' };

  const draft = await createPostgresComposeDraftInTransaction(trx, {
    workspaceId: input.workspaceId,
    accountId: Number(message.account_id),
    values: {
      accountId: Number(message.account_id),
      subject: replySubject(message.subject),
      bodyText,
      toJson: { value: [{ address: replyTo }] },
    },
  });
  if (!draft.ok) {
    return { status: 'error', message: `Entwurf konnte nicht angelegt werden: ${draft.reason}` };
  }

  await trx
    .updateTable('email_messages')
    .set({
      reply_parent_message_id: input.messageId,
      ai_suggestion_snapshot: aiText,
      updated_at: new Date(),
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', Number(draft.message.id))
    .execute();

  return {
    status: 'ok',
    variables: {
      'draft.id': draft.message.id,
      'ai.draft.text': bodyText.slice(0, 8000),
      'ai.draft.subject': replySubject(message.subject),
      'ai.draft.sources': knowledgeSourcesLabel(chunks),
    },
  };
}

export async function executeWorkflowAiReviewDraft(
  trx: WorkspaceTransaction,
  deps: WorkflowAiDraftNodeDeps,
  input: {
    workspaceId: string;
    messageId: number | null;
    config: Record<string, unknown>;
    variables: Record<string, string | number | boolean | null>;
    strings: Record<string, string>;
    actorUserId?: string | null;
    dryRun?: boolean;
  },
): Promise<NodeResult> {
  const draftIdVar = String(input.config.draftIdVariable ?? 'draft.id').trim() || 'draft.id';
  const draftId = Number(input.variables[draftIdVar]);
  if (input.dryRun) {
    return {
      status: 'ok',
      port: 'hold',
      message: 'dry-run review_draft',
      variables: {
        'ai.review.verdict': 'hold',
        'ai.review.answered': false,
        'ai.review.reason': 'Dry-Run — es wird nie automatisch gesendet',
      },
    };
  }
  if (!Number.isFinite(draftId) || draftId <= 0) {
    return { status: 'error', message: `Kein Entwurf unter Variable ${draftIdVar}` };
  }

  const draft = await trx
    .selectFrom('email_messages')
    .select(['id', 'subject', 'body_text', 'folder_kind', 'uid'])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', draftId)
    .executeTakeFirst();
  if (!draft || draft.folder_kind !== 'draft' || Number(draft.uid) >= 0) {
    return { status: 'error', message: `Entwurf ${draftId} nicht gefunden` };
  }

  const original = input.messageId === null
    ? null
    : await trx
      .selectFrom('email_messages')
      .select(['subject', 'body_text', 'snippet', 'from_json'])
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.messageId)
      .executeTakeFirst();

  const extraCriteria = String(input.config.reviewPrompt ?? '').trim();
  const system = [
    'Du bist die Endkontrolle für automatische Kundenservice-Antworten.',
    'Prüfe: Beantwortet der Entwurf die Fragen des Kunden vollständig und korrekt?',
    'Ist der Ton professionell? Enthält er keine erfundenen Fakten?',
    extraCriteria ? `Zusätzliche Kriterien: ${extraCriteria}` : '',
    '',
    'Antworte NUR in diesem Format:',
    'STATUS: SEND oder HOLD',
    'ANSWERED: yes oder no',
    'REASON: kurze deutsche Begründung (eine Zeile)',
    'SEND nur, wenn der Entwurf ohne Änderung verschickt werden kann. Im Zweifel HOLD.',
  ].filter(Boolean).join('\n');

  const user = [
    '--- Kundenmail ---',
    original
      ? [
        `Betreff: ${original.subject ?? ''}`,
        `Von: ${input.strings.from_address ?? ''}`,
        '',
        (original.body_text ?? original.snippet ?? '').slice(0, 6000),
      ].join('\n')
      : '(Original-Nachricht nicht verfügbar)',
    '',
    '--- Antwort-Entwurf ---',
    `Betreff: ${draft.subject ?? ''}`,
    '',
    (draft.body_text ?? '').slice(0, 6000),
  ].join('\n');

  const profileId = optionalPositiveInt(input.config.profileId);
  try {
    const out = await runWorkflowTrackedChatCompletion(deps, {
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      nodeType: 'ai.review_draft',
      profileId,
      actorUserId: input.actorUserId ?? null,
      system,
      user,
    });
    const parsed = parseDraftReviewResponse(out);
    const variables: Record<string, string | number | boolean | null> = {
      'ai.review.verdict': parsed.verdict,
      'ai.review.answered': parsed.answered,
      'ai.review.reason': parsed.reason,
    };
    if (parsed.verdict === 'send') {
      return { status: 'ok', port: 'send', variables };
    }
    await setDraftApprovalPending(trx, input.workspaceId, draftId, parsed.reason || 'Gegenlese-KI empfiehlt menschliche Prüfung');
    return { status: 'ok', port: 'hold', variables };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await setDraftApprovalPending(
      trx,
      input.workspaceId,
      draftId,
      `KI-Prüfung fehlgeschlagen: ${msg.slice(0, 200)}`,
    );
    return {
      status: 'ok',
      port: 'hold',
      message: `review_error:${msg}`,
      variables: {
        'ai.review.verdict': 'hold',
        'ai.review.answered': false,
        'ai.review.reason': 'KI-Prüfung fehlgeschlagen — bitte manuell prüfen',
      },
    };
  }
}

export async function setDraftApprovalPending(
  trx: WorkspaceTransaction,
  workspaceId: string,
  draftId: number,
  reason: string,
): Promise<void> {
  const now = new Date();
  await trx
    .updateTable('email_messages')
    .set({
      approval_state: 'pending',
      approval_reason: reason.slice(0, 500),
      // HOLD must disarm any armed scheduled send — otherwise the worker can
      // transmit a draft the review explicitly held (and the approval banner
      // stays hidden because inbox queries exclude scheduled drafts).
      scheduled_send_at: null,
      scheduled_send_actor_user_id: null,
      scheduled_send_trusted_service_principal: null,
      updated_at: now,
    })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', draftId)
    .execute();
}

export async function clearDraftApproval(
  trx: WorkspaceTransaction,
  workspaceId: string,
  draftId: number,
): Promise<void> {
  await trx
    .updateTable('email_messages')
    .set({
      approval_state: null,
      approval_reason: null,
      updated_at: new Date(),
    })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', draftId)
    .execute();
}

function optionalPositiveInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function firstReplyAddress(message: {
  from_json: unknown;
  raw_headers?: string | null;
}): string | null {
  const fallback = firstFromAddress(message.from_json);
  const rawHeaders = String(message.raw_headers ?? '').slice(0, 128_000);
  if (!rawHeaders) return fallback;
  try {
    const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, ' ');
    const replyTo = unfolded.match(/^Reply-To:\s*([^\r\n]+)/im)?.[1] ?? '';
    return addressparser(replyTo, { flatten: true })[0]?.address.trim() || fallback;
  } catch {
    return fallback;
  }
}

function firstFromAddress(fromJson: unknown): string | null {
  const raw = typeof fromJson === 'string' ? fromJson : fromJson == null ? null : JSON.stringify(fromJson);
  const joined = addressesFromRecipientJson(raw);
  const first = joined.split(',')[0]?.trim();
  return first || null;
}

function signatureHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function resolveAccountSignatureText(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    accountId: number;
    variables: Record<string, string | number | boolean | null>;
    actorUserId?: string | null;
  },
): Promise<string> {
  const [account, signature, actor] = await Promise.all([
    trx
      .selectFrom('email_accounts')
      .select(['display_name', 'email_address'])
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.accountId)
      .executeTakeFirst(),
    trx
      .selectFrom('email_account_signatures')
      .select(['signature_html'])
      .where('workspace_id', '=', input.workspaceId)
      .where('account_id', '=', input.accountId)
      .executeTakeFirst(),
    input.actorUserId
      ? trx
        .selectFrom('users')
        .select(['display_name', 'public_name'])
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', input.actorUserId)
        .executeTakeFirst()
      : Promise.resolve(undefined),
  ]);
  const sigHtml = signature?.signature_html?.trim();
  if (!sigHtml || !account) return '';
  // Automated drafts have no later client pass — resolve {{user.publicName}}
  // from the actor when present, otherwise fall back to the account display name
  // so the placeholder never reaches customers literally.
  const userDisplayName = actor?.display_name?.trim() || account.display_name;
  const userPublicName = actor?.public_name?.trim() || userDisplayName;
  return signatureHtmlToText(
    interpolateSignatureTemplate(
      sigHtml,
      buildSignatureTemplateContext({
        accountDisplayName: account.display_name,
        accountEmail: account.email_address,
        userDisplayName,
        userPublicName,
        customerName:
          typeof input.variables['customer.name'] === 'string'
            ? input.variables['customer.name']
            : '',
        customerEmail:
          typeof input.variables['customer.email'] === 'string'
            ? input.variables['customer.email']
            : '',
      }),
    ),
  );
}

function knowledgeSourcesLabel(
  chunks: ReadonlyArray<{ id?: number; title?: string | null }>,
): string {
  return chunks
    .map((c) => (c.title ? String(c.title) : `Chunk #${c.id ?? '?'}`))
    .join(', ');
}

function fingerprintReviewedDraft(draft: {
  subject?: string | null;
  body_text?: string | null;
  body_html?: string | null;
  to_json?: unknown;
  cc_json?: unknown;
  bcc_json?: unknown;
  draft_attachment_paths_json?: string | null;
}): string {
  return outboundDraftFingerprint({
    subject: draft.subject,
    bodyText: draft.body_text,
    bodyHtml: draft.body_html,
    to: recipientJsonToFingerprintString(draft.to_json),
    cc: recipientJsonToFingerprintString(draft.cc_json),
    bcc: recipientJsonToFingerprintString(draft.bcc_json),
    attachmentPaths: parseDraftAttachmentPaths(draft.draft_attachment_paths_json),
  });
}

function recipientJsonToFingerprintString(value: unknown): string {
  const raw = typeof value === 'string' ? value : value == null ? null : JSON.stringify(value);
  return addressesFromRecipientJson(raw);
}

function parseDraftAttachmentPaths(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const paths: string[] = [];
    for (const item of parsed) {
      if (typeof item === 'string' && item.trim()) {
        paths.push(item.trim());
        continue;
      }
      // Server drafts store `{ path, filename }` objects (see draftAttachmentPathsToJsonValue).
      if (item && typeof item === 'object' && 'path' in item) {
        const path = String((item as { path?: unknown }).path ?? '').trim();
        if (path) paths.push(path);
      }
    }
    return paths;
  } catch {
    return [];
  }
}

function replySubject(subject: string | null | undefined): string {
  const value = String(subject ?? '').trim();
  if (!value) return 'Re:';
  return /^re:/i.test(value) ? value : `Re: ${value}`;
}

function aiDraftReplyDedupeKey(input: {
  messageId: number;
  runId?: number;
  continuation?: { workflowId?: number } | null;
}): string {
  const workflowId = input.continuation?.workflowId;
  const runPart = Number.isInteger(input.runId) && Number(input.runId) > 0
    ? `:run:${Number(input.runId)}`
    : '';
  return Number.isInteger(workflowId) && Number(workflowId) > 0
    ? `workflow_ai_draft_reply:${Number(workflowId)}:${input.messageId}${runPart}`
    : `workflow_ai_draft_reply:${input.messageId}${runPart}`;
}

// ---------------------------------------------------------------------------
// Async job ports — OpenAI runs outside any long-lived workflow.execute TX
// (same pattern as ai.agent / ai.review).
// ---------------------------------------------------------------------------

export type AiDraftReplyJobPlan = Readonly<{
  workspaceId: string;
  messageId: number;
  actorUserId?: string;
  /** Workflow run id — scopes draft idempotency so backfill/reapply can mint a new draft. */
  runId?: number;
  profileId?: number;
  knowledgeBaseId?: number;
  systemPrompt?: string;
  includeCanned?: boolean;
  greeting?: string;
  signature?: string;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
  continuation?: AiClassificationContinuation;
}>;

export type AiDraftReplyJobPort = Readonly<{
  draftReply(input: AiDraftReplyJobPlan): Promise<void>;
}>;

export type AiReviewDraftJobPlan = Readonly<{
  workspaceId: string;
  messageId?: number;
  /** Concrete draft id (preferred for ACL); falls back to eventVariables[draftIdVariable]. */
  draftId?: number;
  actorUserId?: string;
  profileId?: number;
  draftIdVariable?: string;
  reviewPrompt?: string;
  portResumeTargets?: Readonly<Record<string, string>>;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
  continuation?: AiClassificationContinuation;
}>;

export type AiReviewDraftJobPort = Readonly<{
  reviewDraft(input: AiReviewDraftJobPlan): Promise<void>;
}>;

function jobStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

function jobVariables(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      entry === null
      || typeof entry === 'string'
      || typeof entry === 'number'
      || typeof entry === 'boolean'
    ) {
      out[key] = entry;
    }
  }
  return out;
}

export function createPostgresAiDraftReplyPort(
  deps: WorkflowAiDraftNodeDeps,
): AiDraftReplyJobPort {
  const now = () => deps.now?.() ?? new Date();
  return {
    async draftReply(input) {
      const strings = jobStrings(input.eventStrings);
      const variables = jobVariables(input.eventVariables);
      const config: Record<string, unknown> = {
        ...(input.profileId !== undefined ? { profileId: input.profileId } : {}),
        ...(input.knowledgeBaseId !== undefined ? { knowledgeBaseId: input.knowledgeBaseId } : {}),
        ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
        ...(input.includeCanned !== undefined ? { includeCanned: input.includeCanned } : {}),
        ...(input.greeting !== undefined ? { greeting: input.greeting } : {}),
        ...(input.signature !== undefined ? { signature: input.signature } : {}),
      };

      type Prep = {
        accountId: number;
        subject: string | null;
        fromJson: unknown;
        rawHeaders: string | null;
        system: string;
        user: string;
        chunks: ReadonlyArray<{ id?: number; title?: string | null }>;
      };

      const prep = await withWorkspaceTransaction(
        deps.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx): Promise<Prep | 'skip' | null> => {
          const message = await trx
            .selectFrom('email_messages')
            .select([
              'id',
              'account_id',
              'subject',
              'from_json',
              'raw_headers',
              'body_text',
              'snippet',
              'is_spam',
              'spam_status',
              'spam_score_label',
            ])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirst();
          if (!message) throw new Error('Nachricht nicht gefunden');
          if (messageIsSpamOrReviewForInboundWorkflow(message)) return 'skip';
          if (message.account_id === null) throw new Error('Nachricht ohne Konto');

          const knowledgeBaseId = optionalPositiveInt(config.knowledgeBaseId);
          const query = strings.combined_text ?? '';
          const chunks = knowledgeBaseId !== undefined
            ? await searchKnowledgeForWorkflow(
              trx,
              input.workspaceId,
              Number(message.account_id),
              'inbound',
              query,
              5,
              knowledgeBaseId,
            )
            : await searchKnowledgeForWorkflow(
              trx,
              input.workspaceId,
              Number(message.account_id),
              'inbound',
              query,
              5,
            );
          const kbText = chunks.map((c) => c.content).join('\n---\n');

          let cannedBlock = '';
          if (config.includeCanned === true) {
            const canned = await trx
              .selectFrom('email_canned_responses')
              .select(['title', 'body'])
              .where('workspace_id', '=', input.workspaceId)
              .where((eb) => eb.or([
                eb('account_id', 'is', null),
                eb('account_id', '=', Number(message.account_id)),
              ]))
              .orderBy('sort_order', 'asc')
              .orderBy('id', 'asc')
              .limit(5)
              .execute();
            if (canned.length > 0) {
              cannedBlock = canned
                .map((c) => `• ${String(c.title ?? '')}:\n${String(c.body ?? '').slice(0, 1200)}`)
                .join('\n\n');
            }
          }

          const system = String(config.systemPrompt ?? '').trim()
            || 'Beantworte die Kundenmail freundlich auf Deutsch.';
          const user = [
            'Kundenmail:',
            query,
            kbText ? `\nWissensbasis (relevante Auszüge):\n${kbText}` : '',
            cannedBlock ? `\nVorhandene Textbausteine (als Formulierungshilfe):\n${cannedBlock}` : '',
          ].filter(Boolean).join('\n');

          return {
            accountId: Number(message.account_id),
            subject: message.subject,
            fromJson: message.from_json,
            rawHeaders: message.raw_headers,
            system,
            user,
            chunks,
          };
        },
        { applySession: deps.applyWorkspaceSession },
      );
      if (prep === 'skip') {
        // Node already deferred the parent workflow.execute — must continue the
        // graph even when we skip the LLM call for spam/review.
        if (input.continuation) {
          await withWorkspaceTransaction(
            deps.db,
            { workspaceId: input.workspaceId, role: 'system' },
            async (trx) => {
              await enqueueContinuation(trx, {
                workspaceId: input.workspaceId,
                messageId: input.messageId,
                continuation: input.continuation!,
                variables: {
                  'ai.draft.status': 'skipped',
                  'ai.draft.skip_reason': 'message_spam_or_review',
                },
                now: now(),
              });
            },
            { applySession: deps.applyWorkspaceSession },
          );
        }
        return;
      }
      if (prep === null) return;

      // OpenAI outside any workspace transaction (Codex P1).
      let aiText: string;
      try {
        aiText = (await runWorkflowTrackedChatCompletion(deps, {
          workspaceId: input.workspaceId,
          messageId: input.messageId,
          nodeType: 'ai.draft_reply',
          profileId: optionalPositiveInt(config.profileId),
          actorUserId: input.actorUserId ?? null,
          system: prep.system,
          user: prep.user,
        })).trim();
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
      }
      if (!aiText) throw new Error('KI lieferte keinen Antworttext');
      if (aiText.length > MAX_AI_DRAFT_REPLY_CHARS) {
        throw new Error(
          `KI-Antwort unplausibel lang (${aiText.length} Zeichen, Limit ${MAX_AI_DRAFT_REPLY_CHARS})`,
        );
      }

      await withWorkspaceTransaction(
        deps.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          // Re-check live spam/review after the external AI call — a concurrent
          // mark_spam during the call must not still mint an auto-reply draft.
          const liveMessage = await trx
            .selectFrom('email_messages')
            .select(['is_spam', 'spam_status', 'spam_score_label'])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.messageId)
            .executeTakeFirst();
          if (!liveMessage || messageIsSpamOrReviewForInboundWorkflow(liveMessage)) {
            if (input.continuation) {
              await enqueueContinuation(trx, {
                workspaceId: input.workspaceId,
                messageId: input.messageId,
                continuation: input.continuation,
                variables: {
                  'ai.draft.status': 'skipped',
                  'ai.draft.skip_reason': 'message_spam_or_review',
                },
                now: now(),
              });
            }
            return;
          }

          // Idempotency: after a committed TX a worker crash can retry the same
          // job. Reuse the prior draft + skip a second continuation enqueue.
          const dedupeKey = aiDraftReplyDedupeKey(input);
          const prior = await trx
            .selectFrom('sync_info')
            .select(['value'])
            .where('workspace_id', '=', input.workspaceId)
            .where('key', '=', dedupeKey)
            .executeTakeFirst();
          if (prior?.value) {
            const priorDraftId = Number(prior.value);
            if (Number.isInteger(priorDraftId) && priorDraftId > 0) {
              return;
            }
          }

          const parts: string[] = [];
          if (config.greeting !== 'none' && !aiDraftLikelyIncludesGreeting(aiText)) {
            const customerName = variables['customer.name'];
            parts.push(
              buildReplyGreeting({
                customer:
                  typeof customerName === 'string' && customerName
                    ? { name: customerName }
                    : null,
                fromJson: typeof prep.fromJson === 'string'
                  ? prep.fromJson
                  : prep.fromJson == null
                    ? null
                    : JSON.stringify(prep.fromJson),
              }),
              '',
            );
          }
          parts.push(aiText);
          if (config.signature !== 'none') {
            const accountSig = await resolveAccountSignatureText(trx, {
              workspaceId: input.workspaceId,
              accountId: prep.accountId,
              variables,
              actorUserId: input.actorUserId ?? null,
            });
            parts.push('', accountSig || 'Mit freundlichen Grüßen');
          }
          const bodyText = parts.join('\n');
          const replyTo = firstReplyAddress({
            from_json: prep.fromJson,
            raw_headers: prep.rawHeaders,
          });
          if (!replyTo) throw new Error('Kein Antwort-Empfänger ermittelbar');

          const draft = await createPostgresComposeDraftInTransaction(trx, {
            workspaceId: input.workspaceId,
            accountId: prep.accountId,
            values: {
              accountId: prep.accountId,
              subject: replySubject(prep.subject),
              bodyText,
              toJson: { value: [{ address: replyTo }] },
            },
          });
          if (!draft.ok) {
            throw new Error(`Entwurf konnte nicht angelegt werden: ${draft.reason}`);
          }

          const draftId = Number(draft.message.id);
          const stampedAt = now();
          await trx
            .updateTable('email_messages')
            .set({
              reply_parent_message_id: input.messageId,
              ai_suggestion_snapshot: aiText,
              updated_at: stampedAt,
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', draftId)
            .execute();

          await trx
            .insertInto('sync_info')
            .values({
              workspace_id: input.workspaceId,
              key: dedupeKey,
              value: String(draftId),
              last_updated: stampedAt,
              source_row: kyselySql`jsonb_build_object('origin', 'workflow_ai_draft_reply')`,
              imported_in_run_id: null,
              updated_at: stampedAt,
            })
            .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
              value: String(draftId),
              last_updated: stampedAt,
              updated_at: stampedAt,
            }))
            .execute();

          if (input.continuation) {
            await enqueueContinuation(trx, {
              workspaceId: input.workspaceId,
              messageId: input.messageId,
              continuation: input.continuation,
              variables: {
                'draft.id': draftId,
                'ai.draft.text': bodyText.slice(0, 8000),
                'ai.draft.subject': replySubject(prep.subject),
                'ai.draft.sources': knowledgeSourcesLabel(prep.chunks),
              },
              now: stampedAt,
            });
          }
        },
        { applySession: deps.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresAiReviewDraftPort(
  deps: WorkflowAiDraftNodeDeps,
): AiReviewDraftJobPort {
  const now = () => deps.now?.() ?? new Date();
  return {
    async reviewDraft(input) {
      const strings = jobStrings(input.eventStrings);
      const variables = jobVariables(input.eventVariables);
      const draftIdVar = String(input.draftIdVariable ?? 'draft.id').trim() || 'draft.id';
      const draftId = input.draftId
        ?? Number(variables[draftIdVar]);
      if (!Number.isFinite(draftId) || draftId <= 0) {
        throw new Error(`Kein Entwurf unter Variable ${draftIdVar}`);
      }

      type Prep = {
        system: string;
        user: string;
        reviewedFingerprint: string;
      };

      const prep = await withWorkspaceTransaction(
        deps.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx): Promise<Prep> => {
          const draft = await trx
            .selectFrom('email_messages')
            .select([
              'id',
              'subject',
              'body_text',
              'body_html',
              'to_json',
              'cc_json',
              'bcc_json',
              'draft_attachment_paths_json',
              'folder_kind',
              'uid',
            ])
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', draftId)
            .executeTakeFirst();
          if (!draft || draft.folder_kind !== 'draft' || Number(draft.uid) >= 0) {
            throw new Error(`Entwurf ${draftId} nicht gefunden`);
          }

          const original = input.messageId === undefined
            ? null
            : await trx
              .selectFrom('email_messages')
              .select(['subject', 'body_text', 'snippet', 'from_json'])
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', input.messageId)
              .executeTakeFirst();

          const extraCriteria = String(input.reviewPrompt ?? '').trim();
          const system = [
            'Du bist die Endkontrolle für automatische Kundenservice-Antworten.',
            'Prüfe: Beantwortet der Entwurf die Fragen des Kunden vollständig und korrekt?',
            'Ist der Ton professionell? Enthält er keine erfundenen Fakten?',
            extraCriteria ? `Zusätzliche Kriterien: ${extraCriteria}` : '',
            '',
            'Antworte NUR in diesem Format:',
            'STATUS: SEND oder HOLD',
            'ANSWERED: yes oder no',
            'REASON: kurze deutsche Begründung (eine Zeile)',
            'SEND nur, wenn der Entwurf ohne Änderung verschickt werden kann. Im Zweifel HOLD.',
          ].filter(Boolean).join('\n');

          const user = [
            '--- Kundenmail ---',
            original
              ? [
                `Betreff: ${original.subject ?? ''}`,
                `Von: ${strings.from_address ?? ''}`,
                '',
                (original.body_text ?? original.snippet ?? '').slice(0, 6000),
              ].join('\n')
              : '(Original-Nachricht nicht verfügbar)',
            '',
            '--- Antwort-Entwurf ---',
            `Betreff: ${draft.subject ?? ''}`,
            '',
            (draft.body_text ?? '').slice(0, 6000),
          ].join('\n');

          return {
            system,
            user,
            reviewedFingerprint: fingerprintReviewedDraft(draft),
          };
        },
        { applySession: deps.applyWorkspaceSession },
      );

      let port: 'send' | 'hold' = 'hold';
      let continuationVariables: JobPayload = {
        'ai.review.verdict': 'hold',
        'ai.review.answered': false,
        'ai.review.reason': 'KI-Prüfung fehlgeschlagen — bitte manuell prüfen',
      };
      let approvalReason = 'KI-Prüfung fehlgeschlagen — bitte manuell prüfen';

      try {
        const out = await runWorkflowTrackedChatCompletion(deps, {
          workspaceId: input.workspaceId,
          messageId: input.messageId ?? null,
          nodeType: 'ai.review_draft',
          profileId: input.profileId,
          actorUserId: input.actorUserId ?? null,
          system: prep.system,
          user: prep.user,
        });
        const parsed = parseDraftReviewResponse(out);
        continuationVariables = {
          'ai.review.verdict': parsed.verdict,
          'ai.review.answered': parsed.answered,
          'ai.review.reason': parsed.reason,
        };
        if (parsed.verdict === 'send') {
          port = 'send';
          approvalReason = '';
        } else {
          port = 'hold';
          approvalReason = parsed.reason || 'Gegenlese-KI empfiehlt menschliche Prüfung';
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        approvalReason = `KI-Prüfung fehlgeschlagen: ${msg.slice(0, 200)}`;
        port = 'hold';
      }

      await withWorkspaceTransaction(
        deps.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          // Re-read draft after the external AI call — a human may have edited it.
          if (port === 'send') {
            const live = await trx
              .selectFrom('email_messages')
              .select([
                'subject',
                'body_text',
                'body_html',
                'to_json',
                'cc_json',
                'bcc_json',
                'draft_attachment_paths_json',
                'folder_kind',
                'uid',
              ])
              .where('workspace_id', '=', input.workspaceId)
              .where('id', '=', draftId)
              .executeTakeFirst();
            const liveFp = live && live.folder_kind === 'draft' && Number(live.uid) < 0
              ? fingerprintReviewedDraft(live)
              : null;
            if (liveFp !== prep.reviewedFingerprint) {
              port = 'hold';
              approvalReason = 'Entwurf wurde nach der KI-Prüfung geändert — bitte manuell freigeben';
              continuationVariables = {
                'ai.review.verdict': 'hold',
                'ai.review.answered': false,
                'ai.review.reason': approvalReason,
              };
            }
          }
          if (port === 'hold') {
            await setDraftApprovalPending(trx, input.workspaceId, draftId, approvalReason);
          }
          const continuation = input.continuation;
          if (!continuation) return;
          const namedTarget = input.portResumeTargets?.[port];
          let resumeNodeId = namedTarget;
          if (!resumeNodeId && port === 'send') {
            // Do not resume SEND through a HOLD-only deferral anchor.
            const holdOnlyAnchor = Boolean(input.portResumeTargets?.hold)
              && !input.portResumeTargets?.send
              && continuation.resumeNodeId === input.portResumeTargets?.hold;
            if (!holdOnlyAnchor) resumeNodeId = continuation.resumeNodeId;
          }
          if (!resumeNodeId) {
            // Terminal SEND without a success edge (e.g. hold-only graph) must
            // still advance the inbound priority chain — otherwise later
            // workflows stay stranded after a successful child.
            await enqueueNextInboundWorkflowAfterTerminalChildFailure(trx, {
              workspaceId: input.workspaceId,
              messageId: input.messageId,
              actorUserId: continuation.actorUserId,
              continuation,
            }, now());
            return;
          }
          await enqueueContinuation(trx, {
            workspaceId: input.workspaceId,
            messageId: input.messageId,
            continuation: { ...continuation, resumeNodeId },
            variables: continuationVariables,
            now: now(),
          });
        },
        { applySession: deps.applyWorkspaceSession },
      );
    },
  };
}
