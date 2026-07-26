/**
 * Server execution for ai.draft_reply and ai.review_draft (Zwei-Stufen-KI-Antwort).
 */
import addressparser from 'nodemailer/lib/addressparser';
import {
  addressesFromRecipientJson,
  messageIsSpamOrReviewForInboundWorkflow,
  parseDraftReviewResponse,
} from '@simplecrm/core';

import type { PostgresSecretPort } from './db/postgres-secret-port';
import type { ServerDatabase } from './db/schema';
import { createPostgresComposeDraftInTransaction } from './db/postgres-mail-read-ports';
import type { WorkspaceSessionApplier, WorkspaceTransaction } from './db/workspace-context';
import { searchKnowledgeForWorkflow } from './knowledge-workflow-search';
import { runWorkflowTrackedChatCompletion, type WorkflowAiChatDeps } from './workflow-ai-chat';
import {
  buildSignatureTemplateContext,
  interpolateSignatureTemplate,
} from './signature-template.js';

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

  const system = String(input.config.systemPrompt ?? '').trim()
    || 'Beantworte die Kundenmail freundlich auf Deutsch.';
  const user = [
    'Kundenmail:',
    query,
    kbText ? `\nWissensbasis (relevante Auszüge):\n${kbText}` : '',
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
  if (input.config.greeting !== 'none') {
    parts.push('Guten Tag,', '');
  }
  parts.push(aiText);
  if (input.config.signature !== 'none') {
    const accountSig = await resolveAccountSignatureText(trx, {
      workspaceId: input.workspaceId,
      accountId: Number(message.account_id),
      variables: input.variables,
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
  await trx
    .updateTable('email_messages')
    .set({
      approval_state: 'pending',
      approval_reason: reason.slice(0, 500),
      updated_at: new Date(),
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
  },
): Promise<string> {
  const [account, signature] = await Promise.all([
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
  ]);
  const sigHtml = signature?.signature_html?.trim();
  if (!sigHtml || !account) return '';
  return signatureHtmlToText(
    interpolateSignatureTemplate(
      sigHtml,
      buildSignatureTemplateContext({
        accountDisplayName: account.display_name,
        accountEmail: account.email_address,
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

function replySubject(subject: string | null | undefined): string {
  const value = String(subject ?? '').trim();
  if (!value) return 'Re:';
  return /^re:/i.test(value) ? value : `Re: ${value}`;
}
