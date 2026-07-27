import type { Kysely, Selectable } from 'kysely';
import {
  addressesFromRecipientJson,
  messageIsSpamOrReviewForInboundWorkflow,
  normalizeAddressJson,
  parseOutboundReviewResponse,
} from '@simplecrm/core';
import addressparser from 'nodemailer/lib/addressparser';

import type { PostgresSecretPort } from './db/postgres-secret-port';
import type {
  EmailAiProfilesTable,
  EmailAiPromptsTable,
  EmailMessagesTable,
  CustomersTable,
  ServerDatabase,
  WorkflowKnowledgeChunksTable,
} from './db/schema';
import type { AiTextTransformApiPort } from './api/types';
import { buildTrustedServiceJobPayload, MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD } from './jobs/policy';
import { recordAiUsageSafe, type AiTokenUsage } from './ai-usage';
import { evaluateAiBudgetSafe, readAiBudgetLimitsFromEnv } from './ai-budget';
import { callAiChat } from './ai-providers';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import { createPostgresComposeDraftInTransaction } from './db/postgres-mail-read-ports';
import { cannedResponseVisibilityPredicate } from './db/postgres-mail-metadata-read-ports';
import { searchKnowledgeForWorkflow } from './knowledge-workflow-search';
import type { JobPayload } from './jobs/types';
import type { MailSqlScope } from './mail-access/types';
import {
  resumeContextInboundChainFields,
  type InboundChainContinuationFields,
} from './workflow-inbound-chain-context';
import {
  enqueueNextInboundWorkflowAfterTerminalChildFailure,
  inboundChainFromJobPayload,
  isInboundSiblingAborted,
} from './workflow-inbound-chain-advance';
import {
  completeTerminalInboundChild,
  runTerminalInboundChild,
} from './workflow-inbound-terminal-child';

const CLASSIFY_BODY_MAX = 12_000;
const AGENT_KNOWLEDGE_MAX = 12_000;
const OPENAI_CHAT_TIMEOUT_MS = 90_000;
const SERVER_CREATED_SOURCE_ID_OFFSET = 1_000_000_000_000n;
const SERVER_CREATED_SOURCE_ID_SPAN = 7_000_000_000_000_000n;

type ChatCompletionInput = Readonly<{
  profile: AiProfileRow;
  apiKey: string;
  system: string;
  user: string;
  captureUsage?: (usage: AiTokenUsage | null) => void;
}>;

type AiUsageAttribution = {
  workspaceId: string;
  aiProfileId: number | null;
  model: string | null;
  nodeType: string;
  messageId?: number | null;
  actorUserId?: string | null;
};

export type AiClassificationContextMode = 'metadata' | 'full';

export type AiClassificationContinuation = Readonly<{
  workflowId: number;
  triggerName?: string;
  actorUserId?: string;
  trustedService?: boolean;
  // True when the paused run is a MANUAL admin-gated workflow.execute; carried across
  // the async-child boundary so the resumed workflow.execute stays marked and its
  // owner/admin recheck still fires for a since-demoted initiator.
  manualAdminExecute?: boolean;
  resumeNodeId: string;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
} & InboundChainContinuationFields>;

export type AiClassificationJobPlan = Readonly<{
  workspaceId: string;
  messageId: number;
  actorUserId?: string;
  profileId?: number;
  labels: readonly string[];
  contextMode: AiClassificationContextMode;
  continuation?: AiClassificationContinuation;
}>;

export type AiClassificationJobPort = Readonly<{
  classify(input: AiClassificationJobPlan): Promise<void>;
}>;

export type AiTransformTextJobPlan = Readonly<{
  workspaceId: string;
  messageId?: number;
  actorUserId?: string;
  profileId?: number;
  promptId?: number;
  targetVariable: string;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
  continuation?: AiClassificationContinuation;
}>;

export type AiTransformTextJobPort = Readonly<{
  transformText(input: AiTransformTextJobPlan): Promise<void>;
}>;

export type AiReviewJobPlan = Readonly<{
  workspaceId: string;
  messageId?: number;
  actorUserId?: string;
  profileId?: number;
  promptId?: number;
  blockKeyword: string;
  direction: 'inbound' | 'outbound';
  systemPrompt?: string;
  fallbackUserTemplate?: string;
  parseMode?: 'outbound_structured' | 'block_keyword';
  /** Original inbound message to include when checkReplyContext is enabled. */
  replyParentMessageId?: number;
  portResumeTargets?: Readonly<Record<string, string>>;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
  continuation?: AiClassificationContinuation;
}>;

export type AiReviewJobPort = Readonly<{
  review(input: AiReviewJobPlan): Promise<void>;
}>;

export type AiReviewPreviewInput = Readonly<{
  workspaceId: string;
  direction: 'inbound' | 'outbound';
  promptId?: number;
  profileId?: number;
  blockKeyword?: string;
  systemPrompt?: string;
  fallbackUserTemplate?: string;
  eventStrings?: Record<string, string>;
  eventVariables?: Record<string, string | number | boolean | null>;
  parseMode: 'outbound_structured' | 'block_keyword';
}>;

export type AiReviewPreviewResult =
  | { ok: true }
  | { ok: false; reason: string };

export type AiReviewPreviewRunner = (
  input: AiReviewPreviewInput,
) => Promise<AiReviewPreviewResult>;

export type AiAgentJobPlan = Readonly<{
  workspaceId: string;
  messageId?: number;
  actorUserId?: string;
  profileId?: number;
  systemPrompt: string;
  knowledgeBaseId?: number;
  /** Opt-in: when no explicit knowledgeBaseId, resolve KBs by account + direction. */
  autoKnowledge?: boolean;
  direction?: string;
  createDraft: boolean;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
  continuation?: AiClassificationContinuation;
  /**
   * Roh-Payload eines TERMINALEN Knotens (keine Resume-Kante, keine
   * Continuation). Traegt Workflow- und Inbound-Kettenkontext, damit der
   * Kindjob Abbruchpruefung und Kettenabschluss selbst durchfuehren kann.
   */
  terminalChainPayload?: Record<string, unknown>;
}>;

export type AiAgentJobPort = Readonly<{
  runAgent(input: AiAgentJobPlan): Promise<void>;
}>;

export type PostgresAiClassificationPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets?: PostgresSecretPort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  chatCompletion?: (input: ChatCompletionInput) => Promise<string>;
}>;

type EmailMessageRow = Selectable<EmailMessagesTable>;
type AiProfileRow = Selectable<EmailAiProfilesTable>;
type AiPromptRow = Selectable<EmailAiPromptsTable>;
type WorkflowKnowledgeChunkRow = Pick<Selectable<WorkflowKnowledgeChunksTable>, 'id' | 'title' | 'content'>;

const classificationMessageColumns = [
  'id',
  'workspace_id',
  'source_sqlite_id',
  'account_id',
  'subject',
  'from_json',
  'to_json',
  'cc_json',
  'snippet',
  'body_text',
  'raw_headers',
  'has_attachments',
  'attachments_json',
] as const;

const aiProfileColumns = [
  'id',
  'workspace_id',
  'label',
  'provider',
  'base_url',
  'model',
  'embedding_model',
  'legacy_keytar_account',
  'secret_id',
  'is_default',
  'sort_order',
  'source_sqlite_id',
  'source_row',
  'imported_in_run_id',
  'created_at',
  'updated_at',
] as const;

const aiPromptColumns = [
  'id',
  'workspace_id',
  'label',
  'user_template',
  'target',
  'profile_source_sqlite_id',
  'profile_id',
  'account_source_sqlite_id',
  'account_id',
  'override_key',
  'sort_order',
  'source_sqlite_id',
  'source_row',
  'imported_in_run_id',
  'created_at',
  'updated_at',
] as const;

const aiTransformCustomerColumns = [
  'name',
  'first_name',
  'email',
] as const;

type AiTransformCustomerRow = Pick<Selectable<CustomersTable>, typeof aiTransformCustomerColumns[number]>;

type ClassificationMessageRow = Pick<EmailMessageRow, typeof classificationMessageColumns[number]>;

export function createPostgresAiClassificationPort(
  options: PostgresAiClassificationPortOptions,
): AiClassificationJobPort {
  const now = () => options.now?.() ?? new Date();

  return {
    async classify(input): Promise<void> {
      if (input.labels.length === 0) return;

      const context = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const message = await selectClassificationMessage(trx, input.workspaceId, input.messageId);
          if (!message) return null;
          const profile = await selectAiProfile(trx, input.workspaceId, input.profileId, null);
          return { message, profile };
        },
        { applySession: options.applyWorkspaceSession },
      );
      if (!context) return;
      if (!context.profile) throw new Error('AI-Profil nicht gefunden');

      const apiKey = await readProfileApiKey(options.secrets, input.workspaceId, context.profile);
      if (!apiKey) throw new Error('Kein KI-API-Schluessel konfiguriert');

      const output = await runTrackedChatCompletion(
        options,
        {
          workspaceId: input.workspaceId,
          aiProfileId: Number(context.profile.id),
          model: context.profile.model,
          nodeType: 'ai.classify',
          messageId: input.messageId,
          actorUserId: input.actorUserId ?? null,
        },
        {
          profile: context.profile,
          apiKey,
          system: 'Du bist ein E-Mail-Klassifizierer.',
          user: classificationPrompt(input.labels, input.contextMode, context.message),
        },
      );
      const { label, confidence } = parseClassificationOutput(output);
      if (!label) throw new Error('KI-Klassifizierung leer');

      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await addClassificationTag(trx, input.workspaceId, context.message, label, now());
          if (input.continuation) {
            await enqueueClassificationContinuation(trx, input, label, confidence, now());
          }
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };
}

export function createPostgresAiTransformTextPort(
  options: PostgresAiClassificationPortOptions,
): AiTransformTextJobPort {
  const now = () => options.now?.() ?? new Date();

  return {
    async transformText(input): Promise<void> {
      const context = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const message = input.messageId === undefined
            ? null
            : await selectClassificationMessage(trx, input.workspaceId, input.messageId);
          const prompt = await selectAiPrompt(trx, input.workspaceId, input.promptId);
          if (!prompt) return null;
          const profile = await selectAiProfile(
            trx,
            input.workspaceId,
            input.profileId,
            prompt.profile_id === null ? null : Number(prompt.profile_id),
          );
          return { message, prompt, profile };
        },
        { applySession: options.applyWorkspaceSession },
      );
      if (!context) throw new Error('Prompt nicht gefunden');
      if (!context.profile) throw new Error('AI-Profil nicht gefunden');

      const apiKey = await readProfileApiKey(options.secrets, input.workspaceId, context.profile);
      if (!apiKey) throw new Error('Kein KI-API-Schluessel konfiguriert');

      const strings = {
        ...stringsFromOptionalMessage(context.message),
        ...stringPayload(input.eventStrings),
      };
      const variables = variablePayload(input.eventVariables);
      const output = (await runTrackedChatCompletion(
        options,
        {
          workspaceId: input.workspaceId,
          aiProfileId: Number(context.profile.id),
          model: context.profile.model,
          nodeType: 'ai.transform_text',
          messageId: input.messageId ?? null,
          actorUserId: input.actorUserId ?? null,
        },
        {
          profile: context.profile,
          apiKey,
          system: 'Du bist ein Assistent fuer geschaeftliche E-Mails. Antworte nur mit dem bearbeiteten Text.',
          user: interpolateWorkflowTemplate(context.prompt.user_template, strings, variables),
        },
      )).trim();
      if (!output) throw new Error('KI-Texttransformation leer');

      if (input.continuation) {
        await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => {
            await enqueueContinuation(trx, {
              workspaceId: input.workspaceId,
              messageId: input.messageId,
              continuation: input.continuation!,
              variables: { [input.targetVariable]: output },
              now: now(),
            });
          },
          { applySession: options.applyWorkspaceSession },
        );
      }
    },
  };
}

function buildAiTransformSystemPromptForServer(input: {
  sourceText: string;
  contextText?: string;
  inboundContextText?: string;
  userContext?: string;
  insertMode?: boolean;
}): string {
  const contextText = input.contextText?.trim() ?? '';
  const selectionMode = !input.insertMode
    && contextText.length > 0
    && contextText !== input.sourceText.trim();
  const inbound = input.inboundContextText?.trim();
  const userCtx = input.userContext?.trim();

  let prompt = selectionMode
    ? 'Du bist ein Assistent fuer geschaeftliche E-Mails. Der Nutzer hat in seiner Antwort eine Stelle markiert. '
      + 'Nutze den GESAMTEN Antwort-Entwurf nur als Kontext, bearbeite und antworte aber AUSSCHLIESSLICH mit dem '
      + 'umgeschriebenen markierten Abschnitt — kein zusaetzlicher Text, keine Einleitung, keine Anrede oder '
      + 'Grussformel, sofern sie nicht markiert war.\n\nKONTEXT (gesamter Antwort-Entwurf, nicht erneut ausgeben):\n'
      + contextText
    : input.insertMode
      ? 'Du bist ein Assistent fuer geschaeftliche E-Mails. Der Nutzer moechte NEUEN Text in seine Antwort EINFUEGEN '
        + '(nicht den bestehenden ersetzen). Antworte NUR mit dem neuen Textabschnitt — ohne Einleitung, ohne '
        + 'Wiederholung des bestehenden Entwurfs, ohne Anrede oder Signatur (die sind bereits vorhanden).\n\n'
        + (contextText
          ? 'BESTEHENDER ANTWORT-ENTWURF (nur Kontext, nicht erneut ausgeben):\n' + contextText
          : '')
      : 'Du bist ein Assistent fuer geschaeftliche E-Mails. Antworte nur mit dem bearbeiteten Text, ohne Einleitung.';

  if (inbound) {
    prompt +=
      '\n\nEINGEHENDE NACHRICHT DES KUNDEN (nur Kontext, nicht erneut ausgeben):\n' + inbound;
  }
  if (userCtx) {
    prompt += '\n\n<bearbeiter_hinweis>\n' + userCtx + '\n</bearbeiter_hinweis>';
  }
  return prompt;
}

export function createPostgresAiTextTransformApiPort(
  options: PostgresAiClassificationPortOptions,
): AiTextTransformApiPort {
  return {
    async transformText(input) {
      const sourceText = input.text.trim();
      if (!sourceText && !input.insertMode) return { success: false, error: 'Text fehlt' };
      const effectiveSource = sourceText || '(neuer Absatz)';

      // Translate mode: no stored prompt — translate `sourceText` into
      // targetLanguage using the workspace's DEFAULT AI profile. contextText,
      // if present, is given only as context. Isolated from the prompt path
      // below so existing prompt-based transforms are unaffected.
      const targetLanguage = input.targetLanguage?.trim();
      if (targetLanguage) {
        try {
          const profile = await withWorkspaceTransaction(
            options.db,
            { workspaceId: input.workspaceId, userId: input.actorUserId, role: 'user' },
            async (trx) => selectAiProfile(trx, input.workspaceId, undefined, null),
            { applySession: options.applyWorkspaceSession },
          );
          if (!profile) return { success: false, error: 'AI-Profil nicht gefunden' };
          const apiKey = await readProfileApiKey(options.secrets, input.workspaceId, profile);
          if (!apiKey) return { success: false, error: 'Kein KI-API-Schluessel konfiguriert' };
          const contextText = input.contextText?.trim() ?? '';
          const useContext = contextText.length > 0 && contextText !== sourceText;
          const system =
            `Du bist ein professioneller Uebersetzer. Uebersetze den folgenden Text nach ${targetLanguage}. `
            + 'Gib AUSSCHLIESSLICH die Uebersetzung zurueck — keine Anfuehrungszeichen, keine Erklaerungen, keine Anrede.'
            + (useContext ? `\n\nKONTEXT (nur zum Verstaendnis, NICHT uebersetzen oder ausgeben):\n${contextText}` : '');
          const output = await runTrackedChatCompletion(
            options,
            {
              workspaceId: input.workspaceId,
              aiProfileId: Number(profile.id),
              model: profile.model,
              nodeType: 'ai.translate_api',
              actorUserId: input.actorUserId ?? null,
            },
            { profile, apiKey, system, user: sourceText },
          );
          if (!output.trim()) return { success: false, error: 'KI-Antwort leer' };
          return { success: true, text: output.trim() };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }

      if (input.promptId == null) return { success: false, error: 'Prompt fehlt' };
      const promptId = input.promptId;

      try {
        const context = await withWorkspaceTransaction(
          options.db,
          {
            workspaceId: input.workspaceId,
            userId: input.actorUserId,
            role: 'user',
          },
          async (trx) => {
            const prompt = await selectAiPrompt(trx, input.workspaceId, promptId);
            if (!prompt) return null;
            const profile = await selectAiProfile(
              trx,
              input.workspaceId,
              undefined,
              prompt.profile_id === null ? null : Number(prompt.profile_id),
            );
            const customer = input.customerId === undefined || input.customerId === null
              ? null
              : await selectAiTransformCustomer(trx, input.workspaceId, input.customerId);
            return { prompt, profile, customer };
          },
          { applySession: options.applyWorkspaceSession },
        );
        if (!context) return { success: false, error: 'Prompt nicht gefunden' };
        if (!context.profile) return { success: false, error: 'AI-Profil nicht gefunden' };
        if (input.customerId != null && !context.customer) {
          return { success: false, error: 'Kunde nicht gefunden' };
        }

        const apiKey = await readProfileApiKey(options.secrets, input.workspaceId, context.profile);
        if (!apiKey) return { success: false, error: 'Kein KI-API-Schluessel konfiguriert' };

        const contextText = input.contextText?.trim() ?? '';
        const systemPrompt = buildAiTransformSystemPromptForServer({
          sourceText: effectiveSource,
          contextText: contextText || undefined,
          inboundContextText: input.inboundContextText,
          userContext: input.userContext,
          insertMode: input.insertMode,
        });
        const output = await runTrackedChatCompletion(
          options,
          {
            workspaceId: input.workspaceId,
            aiProfileId: Number(context.profile.id),
            model: context.profile.model,
            nodeType: 'ai.text_transform_api',
            actorUserId: input.actorUserId ?? null,
          },
          {
            profile: context.profile,
            apiKey,
            system: systemPrompt,
            user: interpolateWorkflowTemplate(
              context.prompt.user_template,
              {
                text: effectiveSource,
                combined_text: effectiveSource,
                'customer.name': context.customer?.name ?? '',
                'customer.firstName': context.customer?.first_name ?? '',
                'customer.email': context.customer?.email ?? '',
              },
              {},
            ),
          },
        );
        if (!output.trim()) return { success: false, error: 'KI-Antwort leer' };
        return { success: true, text: output };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

export function createAiReviewPreviewRunner(
  options: PostgresAiClassificationPortOptions,
): AiReviewPreviewRunner {
  return async (input) => {
    try {
      const context = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const prompt = input.promptId === undefined && input.fallbackUserTemplate
            ? null
            : await selectAiPrompt(trx, input.workspaceId, input.promptId);
          if (!prompt && !input.fallbackUserTemplate) return null;
          const profile = await selectAiProfile(
            trx,
            input.workspaceId,
            input.profileId,
            prompt?.profile_id === null || prompt?.profile_id === undefined
              ? null
              : Number(prompt.profile_id),
          );
          return { prompt, profile };
        },
        { applySession: options.applyWorkspaceSession },
      );
      if (!context) return { ok: false, reason: 'Prompt nicht gefunden' };
      if (!context.profile) return { ok: false, reason: 'AI-Profil nicht gefunden' };

      const apiKey = await readProfileApiKey(options.secrets, input.workspaceId, context.profile);
      if (!apiKey) return { ok: false, reason: 'Kein KI-API-Schluessel konfiguriert' };

      const strings = stringPayload(input.eventStrings);
      const variables = variablePayload(input.eventVariables);
      const userTemplate = (context.prompt?.user_template ?? input.fallbackUserTemplate ?? '')
        .replace(/\{\{text\}\}/g, strings.combined_text ?? '');
      const output = await runTrackedChatCompletion(
        options,
        {
          workspaceId: input.workspaceId,
          aiProfileId: Number(context.profile.id),
          model: context.profile.model,
          nodeType: 'ai.review.preview',
          messageId: null,
          actorUserId: null,
        },
        {
          profile: context.profile,
          apiKey,
          system: input.systemPrompt
            ?? 'Antworte nur mit OK oder BLOCK. BLOCK wenn der Inhalt laut Pruefauftrag problematisch ist.',
          user: interpolateWorkflowTemplate(userTemplate, strings, variables),
        },
      );

      if (input.parseMode === 'outbound_structured') {
        const parsed = parseOutboundReviewResponse(output);
        if (!parsed.ok) {
          return {
            ok: false,
            reason: parsed.reason ?? 'Ausgehende KI-Pruefung: Versand wuerde blockiert',
          };
        }
        return { ok: true };
      }

      const blockKeyword = (input.blockKeyword ?? 'BLOCK').trim() || 'BLOCK';
      if (output.toUpperCase().includes(blockKeyword.toUpperCase())) {
        return { ok: false, reason: 'KI-Pruefung: Versand wuerde blockiert' };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'KI-Vorschau fehlgeschlagen',
      };
    }
  };
}

export function createPostgresAiReviewPort(
  options: PostgresAiClassificationPortOptions,
): AiReviewJobPort {
  const now = () => options.now?.() ?? new Date();

  return {
    async review(input): Promise<void> {
      const context = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const message = input.messageId === undefined
            ? null
            : await selectClassificationMessage(trx, input.workspaceId, input.messageId);
          const prompt = input.promptId === undefined && input.fallbackUserTemplate
            ? null
            : await selectAiPrompt(trx, input.workspaceId, input.promptId);
          if (!prompt && !input.fallbackUserTemplate) return null;
          const profile = await selectAiProfile(
            trx,
            input.workspaceId,
            input.profileId,
            prompt?.profile_id === null || prompt?.profile_id === undefined ? null : Number(prompt.profile_id),
          );
          return { message, prompt, profile };
        },
        { applySession: options.applyWorkspaceSession },
      );
      const strings = {
        ...stringsFromOptionalMessage(context?.message ?? null),
        ...stringPayload(input.eventStrings),
      };
      const variables = variablePayload(input.eventVariables);
      let userTemplate = (context?.prompt?.user_template ?? input.fallbackUserTemplate ?? '')
        .replace(/\{\{text\}\}/g, strings.combined_text ?? '');
      if (input.replyParentMessageId !== undefined) {
        const parentBlock = await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => loadReplyParentContextBlock(trx, input.workspaceId, input.replyParentMessageId!),
          { applySession: options.applyWorkspaceSession },
        );
        if (parentBlock) userTemplate = `${userTemplate}${parentBlock}`;
      }
      try {
        // Config errors (missing prompt/profile/key) must take the same fail-closed
        // error-port path as runtime KI failures — otherwise the draft stays held
        // with no continuation after retries.
        if (!context) throw new Error('Prompt nicht gefunden');
        if (!context.profile) throw new Error('AI-Profil nicht gefunden');
        const apiKey = await readProfileApiKey(options.secrets, input.workspaceId, context.profile);
        if (!apiKey) throw new Error('Kein KI-API-Schluessel konfiguriert');

        const output = await runTrackedChatCompletion(
          options,
          {
            workspaceId: input.workspaceId,
            aiProfileId: Number(context.profile.id),
            model: context.profile.model,
            nodeType: 'ai.review',
            messageId: input.messageId ?? null,
            actorUserId: input.actorUserId ?? null,
          },
          {
            profile: context.profile,
            apiKey,
            system: input.systemPrompt
              ?? 'Antworte nur mit OK oder BLOCK. BLOCK wenn der Inhalt laut Pruefauftrag problematisch ist.',
            user: interpolateWorkflowTemplate(userTemplate, strings, variables),
          },
        );
        const blockKeyword = input.blockKeyword.trim() || 'BLOCK';

        if (input.parseMode === 'outbound_structured') {
          const parsed = parseOutboundReviewResponse(output);
          await withWorkspaceTransaction(
            options.db,
            { workspaceId: input.workspaceId, role: 'system' },
            async (trx) => {
              if (!parsed.ok) {
                const reason = parsed.reason ?? 'Ausgehende KI-Pruefung: Versand blockiert';
                await persistAiReviewBlock(trx, input, now(), reason);
                await maybeEnqueueOutboundReviewContinuation(trx, input, 'block', {
                  'ai.outbound_review.verdict': 'block',
                  'ai.outbound_review.reason': reason,
                }, now());
                return;
              }
              await maybeEnqueueOutboundReviewContinuation(trx, input, 'ok', {
                'ai.outbound_review.verdict': 'ok',
                'ai.outbound_review.reason': '',
                'ai.review.status': 'ok',
              }, now());
            },
            { applySession: options.applyWorkspaceSession },
          );
          return;
        }

        const blocked = output.toUpperCase().includes(blockKeyword.toUpperCase());

        await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => {
            if (blocked) {
              await persistAiReviewBlock(trx, input, now());
              if (input.continuation) {
                await enqueueNextInboundWorkflowAfterTerminalChildFailure(trx, {
                  workspaceId: input.workspaceId,
                  messageId: input.messageId,
                  actorUserId: input.continuation.actorUserId,
                  continuation: input.continuation,
                }, now());
              }
              return;
            }
            if (input.continuation) {
              await enqueueContinuation(trx, {
                workspaceId: input.workspaceId,
                messageId: input.messageId,
                continuation: input.continuation,
                variables: { 'ai.review.status': 'ok' },
                now: now(),
              });
            }
          },
          { applySession: options.applyWorkspaceSession },
        );
      } catch (error) {
        if (input.parseMode !== 'outbound_structured') throw error;
        const msg = error instanceof Error ? error.message : String(error);
        const holdReason = `KI-Fehler: ${msg}`;
        await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => {
            await persistAiReviewBlock(trx, input, now(), holdReason);
            await maybeEnqueueOutboundReviewContinuation(trx, input, 'error', {
              'ai.outbound_review.verdict': 'error',
              'ai.outbound_review.reason': holdReason,
            }, now());
          },
          { applySession: options.applyWorkspaceSession },
        );
      }
    },
  };
}

export function createPostgresAiAgentPort(
  options: PostgresAiClassificationPortOptions,
): AiAgentJobPort {
  const now = () => options.now?.() ?? new Date();

  return {
    async runAgent(input): Promise<void> {
      // Terminaler Knoten: der Elternlauf wartet auf diesen Job. Das
      // Sicherheitsnetz holt den Kettenabschluss auf jedem normalen Ausgang
      // nach, den der Port unten nicht selbst bedient.
      await runTerminalInboundChild(options, input, now, async () => {
        const context = await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => {
            // Vor dem bezahlten Modellaufruf: hat ein Geschwisterzweig die Kette
            // gestoppt oder wurde die Mail inzwischen als Spam markiert?
            const abort = await inboundAsyncChildAbortReason(trx, {
              workspaceId: input.workspaceId,
              messageId: input.messageId,
              continuation: input.continuation,
              terminalChainPayload: input.terminalChainPayload,
            });
            if (abort) return abort;
            const message = input.messageId === undefined
              ? null
              : await selectClassificationMessage(trx, input.workspaceId, input.messageId);
            const profile = await selectAiProfile(trx, input.workspaceId, input.profileId, null);
            const strings = {
              ...stringsFromOptionalMessage(message),
              ...stringPayload(input.eventStrings),
            };
            const query = strings.combined_text ?? '';
            const chunks = input.knowledgeBaseId !== undefined
              ? await selectAgentKnowledgeChunks(trx, input.workspaceId, input.knowledgeBaseId, query, 5)
              // Opt-in fallback: resolve the account/direction knowledge bases like
              // reply suggestions do, but only when the node explicitly enabled it.
              : (input.autoKnowledge && message)
                ? await searchKnowledgeForWorkflow(
                  trx,
                  input.workspaceId,
                  message.account_id === null ? null : Number(message.account_id),
                  input.direction,
                  query,
                  5,
                )
                : [];
            return { message, profile, strings, chunks };
          },
          { applySession: options.applyWorkspaceSession },
        );
        if (!context) return;
        if (typeof context === 'string') {
          // Der Knoten hat den übergeordneten workflow.execute bereits deferred —
          // die Fortsetzung muss laufen (sie räumt Join/Kette auf), nur der
          // Modellaufruf und der Entwurf entfallen.
          await enqueueAiChildSkipContinuation(options, input, 'ai.agent', context, now());
          return;
        }
        if (!context.profile) throw new Error('AI-Profil nicht gefunden');

        const apiKey = await readProfileApiKey(options.secrets, input.workspaceId, context.profile);
        if (!apiKey) throw new Error('Kein KI-API-Schluessel konfiguriert');

        const variables = variablePayload(input.eventVariables);
        const output = (await runTrackedChatCompletion(
          options,
          {
            workspaceId: input.workspaceId,
            aiProfileId: Number(context.profile.id),
            model: context.profile.model,
            nodeType: 'ai.agent',
            messageId: input.messageId ?? null,
            actorUserId: input.actorUserId ?? null,
          },
          {
            profile: context.profile,
            apiKey,
            system: interpolateWorkflowTemplate(input.systemPrompt, context.strings, variables),
            user: buildAgentUserPrompt(context.strings, context.chunks, variables),
          },
        )).trim();
        if (!output) throw new Error('KI-Agent-Antwort leer');

        // `terminalChainPayload` gehoert in die Bedingung: ein terminaler
        // ai.agent mit createDraft:false hat weder Continuation noch Entwurf,
        // der Modellaufruf war aber erfolgreich. Ohne diesen Zweig faellt der
        // Abschluss ans Sicherheitsnetz — das kann Erfolg nicht erkennen und
        // meldet `applied: false`. Der teure Aufruf fiele bei jeder
        // Wiederverarbeitung erneut an und die Barriere saehe `ready_error`.
        if (input.continuation || input.createDraft || input.terminalChainPayload) {
          await withWorkspaceTransaction(
            options.db,
            { workspaceId: input.workspaceId, role: 'system' },
            async (trx) => {
              // Zweiter Check direkt vor der Mutation: der Modellaufruf lief
              // außerhalb der Transaktion, in dieser Zeit kann ein Geschwisterzweig
              // Spam markiert bzw. die Kette gestoppt haben.
              const abort = await inboundAsyncChildAbortReason(trx, {
                workspaceId: input.workspaceId,
                messageId: input.messageId,
                continuation: input.continuation,
                terminalChainPayload: input.terminalChainPayload,
              });
              if (abort) {
                if (input.continuation) {
                  await enqueueContinuation(trx, {
                    workspaceId: input.workspaceId,
                    ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
                    continuation: input.continuation,
                    variables: aiChildSkipVariables('ai.agent', abort),
                    now: now(),
                  });
                } else if (input.terminalChainPayload) {
                  // Abgebrochen ⇒ nicht angewendet, aber Join und Kette
                  // muessen trotzdem weiter.
                  await completeTerminalInboundChild(trx, input.terminalChainPayload, {
                    applied: false,
                    now: now(),
                  });
                }
                return;
              }
              const continuationVariables: JobPayload = {
                'ai.agent.response': output,
                // P1-8 source transparency: which knowledge chunks the answer drew on.
                'ai.agent.sources': context.chunks
                  .map((chunk) => (chunk.title?.trim() ? chunk.title.trim() : `#${Number(chunk.id)}`))
                  .join('; '),
                'ai.agent.source_count': context.chunks.length,
              };
              if (input.createDraft) {
                if (!context.message) throw new Error('Nachricht fuer KI-Agent-Entwurf nicht gefunden');
                const replyToAddress = firstReplyAddress(context.message);
                if (!replyToAddress) throw new Error('Kein Antwort-Empfaenger ermittelbar');
                const draft = await createPostgresComposeDraftInTransaction(trx, {
                  workspaceId: input.workspaceId,
                  accountId: Number(context.message.account_id),
                  values: {
                    accountId: Number(context.message.account_id),
                    subject: replySubject(context.message.subject),
                    bodyText: output,
                    toJson: { value: [{ address: replyToAddress }] },
                  },
                });
                if (!draft.ok) throw new Error(`KI-Agent-Entwurf fehlgeschlagen: ${draft.reason}`);
                continuationVariables['draft.id'] = draft.message.id;
                // P2-9: snapshot the AI draft so feedback learning can measure how
                // much a human edits it before sending.
                await trx
                  .updateTable('email_messages')
                  .set({
                    ai_suggestion_snapshot: output,
                    reply_parent_message_id: Number(context.message.id),
                  })
                  .where('workspace_id', '=', input.workspaceId)
                  .where('id', '=', Number(draft.message.id))
                  .execute();
              }
              if (!input.continuation && input.terminalChainPayload) {
                // Terminaler Knoten: Applied-Marker setzen, Join abbauen, Kette
                // weiterschalten — der Elternlauf hat auf diesen Job gewartet.
                await completeTerminalInboundChild(trx, input.terminalChainPayload, {
                  applied: true,
                  now: now(),
                });
              }
              if (input.continuation) {
                await enqueueContinuation(trx, {
                  workspaceId: input.workspaceId,
                  messageId: input.messageId,
                  continuation: input.continuation,
                  variables: continuationVariables,
                  now: now(),
                });
              }
            },
            { applySession: options.applyWorkspaceSession },
          );
        }
      });
    },
  };
}

export type AiPickCannedJobPlan = Readonly<{
  workspaceId: string;
  messageId?: number;
  actorUserId?: string;
  profileId?: number;
  createDraft: boolean;
  // The initiating user's mail.draft.create scope (compose-originated runs only).
  // Restricts the canned-template query to global + in-scope responses; absent for
  // service/automatic runs, which see every workspace template.
  cannedScope?: MailSqlScope;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
  continuation?: AiClassificationContinuation;
  /**
   * Roh-Payload eines TERMINALEN Knotens (keine Resume-Kante, keine
   * Continuation). Traegt Workflow- und Inbound-Kettenkontext, damit der
   * Kindjob Abbruchpruefung und Kettenabschluss selbst durchfuehren kann.
   */
  terminalChainPayload?: Record<string, unknown>;
}>;

export type AiPickCannedJobPort = Readonly<{
  pickCanned(input: AiPickCannedJobPlan): Promise<void>;
}>;

type CannedRow = { id: number; title: string; body: string };

/**
 * P1-5: lets the KI pick the best-matching canned response for an inbound mail
 * (instead of free-texting), fills its placeholders and creates a draft. Cheaper
 * and more controllable than freeform generation; falls through (pick 0) when no
 * canned response fits.
 */
export function createPostgresAiPickCannedPort(
  options: PostgresAiClassificationPortOptions,
): AiPickCannedJobPort {
  const now = () => options.now?.() ?? new Date();
  return {
    async pickCanned(input): Promise<void> {
      // Terminaler Knoten: der Elternlauf wartet auf diesen Job. Das
      // Sicherheitsnetz holt den Kettenabschluss auf jedem normalen Ausgang
      // nach, den der Port unten nicht selbst bedient.
      await runTerminalInboundChild(options, input, now, async () => {
        const context = await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => {
            const abort = await inboundAsyncChildAbortReason(trx, {
              workspaceId: input.workspaceId,
              messageId: input.messageId,
              continuation: input.continuation,
              terminalChainPayload: input.terminalChainPayload,
            });
            if (abort) return abort;
            const message = input.messageId === undefined
              ? null
              : await selectClassificationMessage(trx, input.workspaceId, input.messageId);
            const profile = await selectAiProfile(trx, input.workspaceId, input.profileId, null);
            const canned = await selectCannedResponses(trx, input.workspaceId, input.cannedScope);
            return { message, profile, canned };
          },
          { applySession: options.applyWorkspaceSession },
        );
        if (typeof context === 'string') {
          await enqueueAiChildSkipContinuation(options, input, 'ai.pick_canned', context, now());
          return;
        }
        if (!context.profile) throw new Error('AI-Profil nicht gefunden');
        if (context.canned.length === 0) throw new Error('Keine Textbausteine vorhanden');

        const apiKey = await readProfileApiKey(options.secrets, input.workspaceId, context.profile);
        if (!apiKey) throw new Error('Kein KI-API-Schluessel konfiguriert');

        const strings = {
          ...stringsFromOptionalMessage(context.message),
          ...stringPayload(input.eventStrings),
        };
        const list = context.canned.map((row, index) => `${index + 1}. ${row.title}`).join('\n');
        const output = await runTrackedChatCompletion(
          options,
          {
            workspaceId: input.workspaceId,
            aiProfileId: Number(context.profile.id),
            model: context.profile.model,
            nodeType: 'ai.pick_canned',
            messageId: input.messageId ?? null,
            actorUserId: input.actorUserId ?? null,
          },
          {
            profile: context.profile,
            apiKey,
            system: 'Du waehlst den am besten passenden Textbaustein fuer die Kundenmail. Antworte nur mit der Nummer des Bausteins, oder 0 wenn keiner passt.',
            user: `Textbausteine:\n${list}\n\nKundenmail:\n${strings.combined_text ?? ''}`,
          },
        );
        const pick = parseCannedPickNumber(output, context.canned.length);

        const continuationVariables: JobPayload = { 'ai.canned.pick': pick };
        let draftBody: string | null = null;
        if (pick > 0) {
          const chosen = context.canned[pick - 1]!;
          continuationVariables['ai.canned.id'] = chosen.id;
          continuationVariables['ai.canned.title'] = chosen.title;
          draftBody = interpolateWorkflowTemplate(chosen.body, strings, variablePayload(input.eventVariables));
          continuationVariables['ai.canned.text'] = draftBody.slice(0, 8000);
        }

        // When the model returns "0 = no canned template fits", draftBody stays
        // null. If a continuation is queued in that state, downstream nodes such
        // as email.send_draft would error out (no draft.id). Surface a clear
        // no-match flag in the continuation variables so the workflow can branch
        // or skip; do NOT enqueue a continuation that lacks a draft when the
        // node was configured to create one.
        if (input.createDraft && draftBody === null) {
          continuationVariables['ai.canned.no_match'] = true;
        }
        const willCreateDraft = input.createDraft && draftBody !== null;
        // Skip the continuation when createDraft was requested but no draft was
        // produced — downstream nodes that depend on draft.id would error out.
        const shouldEnqueueContinuation = !!input.continuation
          && (willCreateDraft || !input.createDraft);

        // Analog zu ai.agent: ohne passenden Baustein (pick 0) oder mit
        // createDraft:false ist der Job erfolgreich zu Ende gelaufen, nur eben
        // ohne Entwurf — das darf das Sicherheitsnetz nicht als Fehler werten.
        if (willCreateDraft || shouldEnqueueContinuation || input.terminalChainPayload) {
          await withWorkspaceTransaction(
            options.db,
            { workspaceId: input.workspaceId, role: 'system' },
            async (trx) => {
              // Zweiter Check direkt vor der Mutation (siehe ai.agent).
              const abort = await inboundAsyncChildAbortReason(trx, {
                workspaceId: input.workspaceId,
                messageId: input.messageId,
                continuation: input.continuation,
                terminalChainPayload: input.terminalChainPayload,
              });
              if (abort) {
                if (input.continuation) {
                  await enqueueContinuation(trx, {
                    workspaceId: input.workspaceId,
                    ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
                    continuation: input.continuation,
                    variables: aiChildSkipVariables('ai.pick_canned', abort),
                    now: now(),
                  });
                } else if (input.terminalChainPayload) {
                  // Abgebrochen ⇒ nicht angewendet, aber Join und Kette
                  // muessen trotzdem weiter.
                  await completeTerminalInboundChild(trx, input.terminalChainPayload, {
                    applied: false,
                    now: now(),
                  });
                }
                return;
              }
              // Narrow for the closure: TypeScript can't carry the willCreateDraft
              // discriminant into the async callback.
              const draftBodyForCreate = draftBody;
              if (willCreateDraft && draftBodyForCreate !== null && context.message) {
                // Address the canned-response draft to the original sender; without
                // a recipient, scheduled-send would clear scheduled_send_at and the
                // auto-reply would never actually go out (silently no-op).
                const replyToAddress = firstReplyAddress(context.message);
                if (!replyToAddress) throw new Error('Kein Antwort-Empfaenger ermittelbar');
                const draft = await createPostgresComposeDraftInTransaction(trx, {
                  workspaceId: input.workspaceId,
                  accountId: Number(context.message.account_id),
                  values: {
                    accountId: Number(context.message.account_id),
                    subject: replySubject(context.message.subject),
                    bodyText: draftBodyForCreate,
                    toJson: { value: [{ address: replyToAddress }] },
                  },
                });
                if (!draft.ok) throw new Error(`Textbaustein-Entwurf fehlgeschlagen: ${draft.reason}`);
                continuationVariables['draft.id'] = draft.message.id;
                await trx
                  .updateTable('email_messages')
                  .set({
                    ai_suggestion_snapshot: draftBodyForCreate,
                    reply_parent_message_id: Number(context.message.id),
                  })
                  .where('workspace_id', '=', input.workspaceId)
                  .where('id', '=', Number(draft.message.id))
                  .execute();
              }
              if (!input.continuation && input.terminalChainPayload) {
                await completeTerminalInboundChild(trx, input.terminalChainPayload, {
                  applied: true,
                  now: now(),
                });
              }
              if (shouldEnqueueContinuation) {
                await enqueueContinuation(trx, {
                  workspaceId: input.workspaceId,
                  messageId: input.messageId,
                  continuation: input.continuation!,
                  variables: continuationVariables,
                  now: now(),
                });
              }
            },
            { applySession: options.applyWorkspaceSession },
          );
        }
      });
    },
  };
}

function parseCannedPickNumber(output: string, max: number): number {
  const match = output.trim().match(/\d+/);
  if (!match) return 0;
  const value = Number(match[0]);
  if (!Number.isFinite(value) || value < 1 || value > max) return 0;
  return value;
}

async function selectCannedResponses(
  trx: WorkspaceTransaction,
  workspaceId: string,
  cannedScope?: MailSqlScope,
): Promise<CannedRow[]> {
  // A compose-originated (user) pick_canned restricts the query to the initiating
  // user's mail.draft.create scope so the AI only sees global + in-scope templates
  // (mirrors the account-aware canned-response HTTP list). Scope 'none' → no
  // templates (the job then fails closed); service/automatic runs pass no scope and
  // see everything.
  if (cannedScope?.kind === 'none') return [];
  let query = trx
    .selectFrom('email_canned_responses')
    .select(['id', 'title', 'body'])
    .where('workspace_id', '=', workspaceId);
  if (cannedScope?.kind === 'restricted') {
    query = query.where(cannedResponseVisibilityPredicate(workspaceId, cannedScope));
  }
  const rows = await query
    .orderBy('sort_order', 'asc')
    .limit(50)
    .execute();
  return rows.map((row) => ({ id: Number(row.id), title: String(row.title ?? ''), body: String(row.body ?? '') }));
}

async function selectClassificationMessage(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<ClassificationMessageRow | null> {
  return await trx
    .selectFrom('email_messages')
    .select(classificationMessageColumns)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst() ?? null;
}

type InboundAsyncChildAbortReason = 'message_spam_or_review' | 'sibling_terminal_abort';

/**
 * Darf ein bereits eingeplanter asynchroner KI-Kindjob noch laufen?
 *
 * `ai.draft_reply` prüft das seit Runde 9 selbst; `ai.agent`/`ai.pick_canned`
 * fehlte der Check. Ohne ihn sendet ein deferrter Zweig den Mailinhalt noch an
 * das Modell und legt einen Entwurf an, obwohl ein späterer Geschwisterzweig die
 * Nachricht inzwischen als Spam markiert und die Inbound-Kette gestoppt hat.
 * Vor dem externen Aufruf **und** vor der Mutation aufrufen.
 */
async function inboundAsyncChildAbortReason(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId?: number;
    continuation?: AiClassificationContinuation;
    /** Terminaler Knoten: Kettenkontext statt Continuation. */
    terminalChainPayload?: Record<string, unknown>;
  },
): Promise<InboundAsyncChildAbortReason | null> {
  const messageId = input.messageId;
  const continuation = input.continuation;
  const terminal = continuation ? null : inboundChainFromJobPayload(input.terminalChainPayload ?? {});
  // Ohne Continuation UND ohne terminalen Kettenkontext ist der Job
  // compose-initiiert (manuelle KI-Aktion) — der darf nicht am Spamstatus
  // scheitern, sonst waeren manuelle Aktionen auf „Spam pruefen"-Mails gesperrt.
  if (messageId === undefined || (!continuation && !terminal)) return null;
  if (continuation?.triggerName !== undefined && continuation.triggerName !== 'inbound') return null;

  const live = await trx
    .selectFrom('email_messages')
    .select(['is_spam', 'spam_status', 'spam_score_label'])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  if (live && messageIsSpamOrReviewForInboundWorkflow(live)) return 'message_spam_or_review';

  const workflowId = continuation?.workflowId ?? terminal?.chain.workflowIds[terminal.chain.index];
  if (workflowId == null) return null;
  const aborted = await isInboundSiblingAborted(trx, {
    workspaceId: input.workspaceId,
    messageId,
    workflowId,
    chain: continuation?.inboundWorkflowChain ?? terminal?.chain ?? null,
  });
  return aborted ? 'sibling_terminal_abort' : null;
}

function aiChildSkipVariables(
  nodeType: 'ai.agent' | 'ai.pick_canned',
  reason: InboundAsyncChildAbortReason,
): JobPayload {
  return {
    [`${nodeType}.status`]: 'skipped',
    [`${nodeType}.skip_reason`]: reason,
  };
}

/** Fortsetzung ohne KI-Ergebnis einreihen, damit Join/Kette nicht hängen bleiben. */
async function enqueueAiChildSkipContinuation(
  options: PostgresAiClassificationPortOptions,
  input: {
    workspaceId: string;
    messageId?: number;
    continuation?: AiClassificationContinuation;
    terminalChainPayload?: Record<string, unknown>;
  },
  nodeType: 'ai.agent' | 'ai.pick_canned',
  reason: InboundAsyncChildAbortReason,
  now: Date,
): Promise<void> {
  const continuation = input.continuation;
  if (!continuation) {
    // Terminaler Knoten: keine Fortsetzung, aber Join und Kette muessen weiter.
    // NICHT als angewendet markieren — die Arbeit ist ausgefallen.
    if (!input.terminalChainPayload) return;
    await withWorkspaceTransaction(
      options.db,
      { workspaceId: input.workspaceId, role: 'system' },
      async (trx) => completeTerminalInboundChild(trx, input.terminalChainPayload!, {
        applied: false,
        now,
      }),
      { applySession: options.applyWorkspaceSession },
    );
    return;
  }
  await withWorkspaceTransaction(
    options.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      await enqueueContinuation(trx, {
        workspaceId: input.workspaceId,
        ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
        continuation,
        variables: aiChildSkipVariables(nodeType, reason),
        now,
      });
    },
    { applySession: options.applyWorkspaceSession },
  );
}

async function selectAiProfile(
  trx: WorkspaceTransaction,
  workspaceId: string,
  profileId: number | undefined,
  promptProfileId: number | null,
): Promise<AiProfileRow | null> {
  const explicitProfileId = profileId ?? (promptProfileId === null ? undefined : promptProfileId);
  if (explicitProfileId !== undefined) {
    return await trx
      .selectFrom('email_ai_profiles')
      .select(aiProfileColumns)
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', explicitProfileId)
      .executeTakeFirst() ?? null;
  }

  const defaultProfile = await trx
    .selectFrom('email_ai_profiles')
    .select(aiProfileColumns)
    .where('workspace_id', '=', workspaceId)
    .where('is_default', '=', true)
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .executeTakeFirst();
  if (defaultProfile) return defaultProfile;

  return await trx
    .selectFrom('email_ai_profiles')
    .select(aiProfileColumns)
    .where('workspace_id', '=', workspaceId)
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .executeTakeFirst() ?? null;
}

async function selectAiPrompt(
  trx: WorkspaceTransaction,
  workspaceId: string,
  promptId: number | undefined,
): Promise<AiPromptRow | null> {
  if (promptId !== undefined) {
    return await trx
      .selectFrom('email_ai_prompts')
      .select(aiPromptColumns)
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', promptId)
      .executeTakeFirst() ?? null;
  }

  return await trx
    .selectFrom('email_ai_prompts')
    .select(aiPromptColumns)
    .where('workspace_id', '=', workspaceId)
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .executeTakeFirst() ?? null;
}

async function selectAiTransformCustomer(
  trx: WorkspaceTransaction,
  workspaceId: string,
  customerId: number,
): Promise<AiTransformCustomerRow | null> {
  return await trx
    .selectFrom('customers')
    .select(aiTransformCustomerColumns)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', customerId)
    .executeTakeFirst() ?? null;
}

async function selectAgentKnowledgeChunks(
  trx: WorkspaceTransaction,
  workspaceId: string,
  knowledgeBaseId: number,
  query: string,
  limit: number,
): Promise<WorkflowKnowledgeChunkRow[]> {
  const rows = await trx
    .selectFrom('workflow_knowledge_chunks')
    .select(['id', 'title', 'content'])
    .where('workspace_id', '=', workspaceId)
    .where('knowledge_base_id', '=', knowledgeBaseId)
    .orderBy('id', 'desc')
    .limit(200)
    .execute();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 12);
  if (terms.length === 0) return rows.slice(0, limit);
  return rows
    .map((row) => {
      const haystack = `${row.title ?? ''}\n${row.content ?? ''}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += 1;
      }
      return { row, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.row);
}

function classificationPrompt(
  labels: readonly string[],
  mode: AiClassificationContextMode,
  message: ClassificationMessageRow,
): string {
  return [
    `Klassifiziere die E-Mail in genau eine Kategorie: ${labels.join(', ')}.`,
    'Antworte ausschliesslich im Format "Kategorie|Sicherheit", wobei Sicherheit eine ganze Zahl von 0 bis 100 ist',
    '(wie sicher du dir bei der Kategorie bist), z. B. "Rechnung|85". Keine weiteren Worte.',
    '',
    mode === 'full' ? fullMessageText(message) : metadataMessageText(message),
  ].join('\n');
}

/** Parses the model output "Kategorie|Sicherheit" into a label + confidence (0–100).
 *  Tolerant of missing/garbled confidence (then null) and of a plain label. */
function parseClassificationOutput(output: string): { label: string; confidence: number | null } {
  const trimmed = output.trim();
  const pipeIndex = trimmed.indexOf('|');
  const labelPart = pipeIndex >= 0 ? trimmed.slice(0, pipeIndex) : trimmed;
  const label = normalizeClassificationLabel(labelPart);
  const confidenceSource = pipeIndex >= 0 ? trimmed.slice(pipeIndex + 1) : trimmed.slice(label.length);
  const match = confidenceSource.match(/\d{1,3}/);
  const confidence = match ? Math.max(0, Math.min(100, Number(match[0]))) : null;
  return { label, confidence };
}

function metadataMessageText(message: ClassificationMessageRow): string {
  return [
    `Von: ${recipientAddresses(message.from_json)}`,
    `An: ${recipientAddresses(message.to_json)}`,
    `Cc: ${recipientAddresses(message.cc_json)}`,
    `Betreff: ${message.subject ?? ''}`,
    `Textauszug: ${(message.snippet ?? message.body_text ?? '').slice(0, 2000)}`,
    `Hat Anhaenge: ${message.has_attachments ? 'ja' : 'nein'}`,
    `Anhaenge: ${attachmentNames(message.attachments_json)}`,
  ].join('\n');
}

function fullMessageText(message: ClassificationMessageRow): string {
  return [
    metadataMessageText(message),
    '',
    'Text:',
    (message.body_text ?? message.snippet ?? '').slice(0, CLASSIFY_BODY_MAX),
  ].join('\n');
}

function buildAgentUserPrompt(
  strings: Record<string, string>,
  chunks: readonly WorkflowKnowledgeChunkRow[],
  variables: JobPayload,
): string {
  const knowledge = chunks
    .map((chunk) => [
      chunk.title ? `Titel: ${chunk.title}` : '',
      String(chunk.content ?? ''),
    ].filter(Boolean).join('\n'))
    .join('\n---\n')
    .slice(0, AGENT_KNOWLEDGE_MAX);
  return interpolateWorkflowTemplate([
    'Nachricht:',
    '{{combined_text}}',
    knowledge ? `\nWissensbasis:\n${knowledge}` : '',
  ].join('\n'), strings, variables);
}

function replySubject(subject: string | null | undefined): string {
  const value = String(subject ?? '').trim();
  if (!value) return 'Re:';
  return /^re:/i.test(value) ? value : `Re: ${value}`;
}

function recipientAddresses(value: unknown): string {
  if (typeof value === 'string') return addressesFromRecipientJson(value);
  if (value === null || value === undefined) return '';
  try {
    return addressesFromRecipientJson(JSON.stringify(value));
  } catch {
    return '';
  }
}

function firstRecipientAddress(value: unknown): string {
  const normalized = normalizeAddressJson(value)
  return normalized?.value[0]?.address.trim() ?? ''
}

function firstReplyAddress(
  message: Pick<ClassificationMessageRow, 'from_json' | 'raw_headers'>,
): string {
  const fallback = firstRecipientAddress(message.from_json)
  const rawHeaders = String(message.raw_headers ?? '').slice(0, 128_000)
  if (!rawHeaders) return fallback
  try {
    const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, ' ')
    const replyTo = unfolded.match(/^Reply-To:\s*([^\r\n]+)/im)?.[1] ?? ''
    return addressparser(replyTo, { flatten: true })[0]?.address.trim() || fallback
  } catch {
    return fallback
  }
}

function attachmentNames(value: unknown): string {
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  if (!Array.isArray(parsed)) return '';
  return parsed
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        return String(record.filename_display ?? record.filename ?? record.name ?? '').trim();
      }
      return '';
    })
    .filter(Boolean)
    .join(', ');
}

function normalizeClassificationLabel(output: string): string {
  return output.trim().split(/\s+/)[0]?.trim() ?? '';
}

async function addClassificationTag(
  trx: WorkspaceTransaction,
  workspaceId: string,
  message: ClassificationMessageRow,
  label: string,
  now: Date,
): Promise<void> {
  await addMessageTag(trx, workspaceId, message, `ki:${label}`, now);
}

async function addMessageTag(
  trx: WorkspaceTransaction,
  workspaceId: string,
  message: ClassificationMessageRow,
  tag: string,
  now: Date,
): Promise<void> {
  const messageSourceSqliteId = Number(message.source_sqlite_id);
  const existing = await trx
    .selectFrom('email_message_tags')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('message_source_sqlite_id', '=', messageSourceSqliteId)
    .where('tag', '=', tag)
    .executeTakeFirst();
  if (existing) return;

  await trx
    .insertInto('email_message_tags')
    .values({
      workspace_id: workspaceId,
      source_sqlite_id: serverCreatedSourceSqliteId(
        'email_message_tags',
        workspaceId,
        String(messageSourceSqliteId),
        tag.toLowerCase(),
      ),
      message_source_sqlite_id: messageSourceSqliteId,
      message_id: Number(message.id),
      tag,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
}

async function persistAiReviewBlock(
  trx: WorkspaceTransaction,
  input: AiReviewJobPlan,
  now: Date,
  reason = 'KI-Pruefung: Versand blockiert',
): Promise<void> {
  if (input.messageId === undefined) return;
  if (input.direction === 'outbound') {
    await trx
      .updateTable('email_messages')
      .set({
        outbound_hold: true,
        outbound_block_reason: reason,
        updated_at: now,
      })
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.messageId)
      .execute();
    return;
  }

  const message = await selectClassificationMessage(trx, input.workspaceId, input.messageId);
  if (message) await addMessageTag(trx, input.workspaceId, message, 'ki-review-block', now);
}

async function maybeEnqueueOutboundReviewContinuation(
  trx: WorkspaceTransaction,
  input: AiReviewJobPlan,
  port: 'ok' | 'block' | 'error',
  variables: JobPayload,
  now: Date,
): Promise<void> {
  const continuation = input.continuation;
  if (!continuation) return;
  const resumeNodeId = input.portResumeTargets?.[port] ?? (port === 'ok' ? continuation.resumeNodeId : undefined);
  if (!resumeNodeId) {
    // No block/error edge: still advance the inbound priority chain so later
    // workflows are not stranded after a deferred AI child terminates.
    if (port !== 'ok') {
      await enqueueNextInboundWorkflowAfterTerminalChildFailure(trx, {
        workspaceId: input.workspaceId,
        messageId: input.messageId,
        actorUserId: continuation.actorUserId,
        continuation,
      }, now);
    }
    return;
  }
  await enqueueContinuation(trx, {
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    continuation: { ...continuation, resumeNodeId },
    variables,
    now,
  });
}

async function enqueueClassificationContinuation(
  trx: WorkspaceTransaction,
  input: AiClassificationJobPlan,
  label: string,
  confidence: number | null,
  now: Date,
): Promise<void> {
  const continuation = input.continuation;
  if (!continuation) return;

  await enqueueContinuation(trx, {
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    continuation,
    // `ai.class_confidence` lets a downstream logic.threshold node gate on it
    // ("nur antworten, wenn >= X%"). 0 when the model gave no usable number.
    variables: { 'ai.class': label, 'ai.class_confidence': confidence ?? 0 },
    now,
  });
}

export async function enqueueContinuation(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId?: number;
    continuation: AiClassificationContinuation;
    variables: JobPayload;
    now: Date;
  },
): Promise<void> {
  const payload = workflowContinuationPayload({
    workspaceId: input.workspaceId,
    workflowId: input.continuation.workflowId,
    ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
    ...(input.continuation.actorUserId ? { actorUserId: input.continuation.actorUserId } : {}),
    ...(input.continuation.triggerName ? { triggerName: input.continuation.triggerName } : {}),
    // Keep the resumed workflow.execute marked so assertWorkflowExecuteSideEffectPrivilege
    // re-checks a since-demoted admin instead of skipping it as an unmarked run.
    ...(input.continuation.manualAdminExecute === true ? { [MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD]: true } : {}),
    context: {
      resumeNodeId: input.continuation.resumeNodeId,
      eventStrings: input.continuation.eventStrings ?? {},
      eventVariables: {
        ...(input.continuation.eventVariables ?? {}),
        ...input.variables,
      },
      ...resumeContextInboundChainFields(input.continuation),
    },
  }, input.continuation.trustedService === true);

  await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.execute',
      payload,
      run_after: input.now,
      max_attempts: 3,
      workspace_id: input.workspaceId,
      updated_at: input.now,
    })
    .execute();
}

function workflowContinuationPayload(payload: Record<string, unknown>, trustedService: boolean): Record<string, unknown> {
  return trustedService && !payload.actorUserId ? buildTrustedServiceJobPayload(payload) : payload;
}

async function readProfileApiKey(
  secrets: PostgresSecretPort | undefined,
  workspaceId: string,
  profile: AiProfileRow,
): Promise<string | null> {
  if (!profile.secret_id || !secrets) return null;
  const secret = await secrets.readSecret({
    workspaceId,
    kind: 'email.ai_profile.api_key',
    name: `email_ai_profile:${Number(profile.id)}:api_key`,
  });
  const value = secret?.toString('utf8').trim();
  return value || null;
}

function defaultChatCompletion(
  options: PostgresAiClassificationPortOptions,
): (input: ChatCompletionInput) => Promise<string> {
  return async (input) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_CHAT_TIMEOUT_MS);
    try {
      const result = await callAiChat({
        provider: input.profile.provider,
        baseUrl: input.profile.base_url,
        model: input.profile.model,
        apiKey: input.apiKey,
        system: input.system,
        user: input.user,
        temperature: 0.1,
        signal: controller.signal,
        ...(options.fetchImpl
          ? { fetchImpl: options.fetchImpl, allowUnguardedFetch: true }
          : {}),
      });
      input.captureUsage?.(result.usage);
      return result.content;
    } finally {
      clearTimeout(timeout);
    }
  };
}

/**
 * Runs a chat completion and records token/cost/latency into `ai_usage_events`
 * (best-effort). All AI call sites go through this so usage tracking is uniform.
 */
async function runTrackedChatCompletion(
  options: PostgresAiClassificationPortOptions,
  attribution: AiUsageAttribution,
  input: ChatCompletionInput,
): Promise<string> {
  const chat = options.chatCompletion ?? defaultChatCompletion(options);
  // PROTOTYPE budget gate (default-off). No env limits configured => no-op.
  const budgetLimits = readAiBudgetLimitsFromEnv();
  if (budgetLimits.hardLimitMicroUsd != null || budgetLimits.softLimitMicroUsd != null) {
    const budget = await evaluateAiBudgetSafe(
      { db: options.db, applyWorkspaceSession: options.applyWorkspaceSession, now: options.now },
      attribution.workspaceId,
      budgetLimits,
    );
    if (budget.decision === 'block') {
      throw new Error(
        `AI budget exceeded for workspace ${attribution.workspaceId} ` +
        `(node ${attribution.nodeType}): spent ${budget.spentMicroUsd} µ$ ` +
        `>= hard limit ${budget.hardLimitMicroUsd} µ$`,
      );
    }
  }
  const started = Date.now();
  let usage: AiTokenUsage | null = null;
  const output = await chat({ ...input, captureUsage: (value) => { usage = value; } });
  await recordAiUsageSafe(
    { db: options.db, applyWorkspaceSession: options.applyWorkspaceSession, now: options.now },
    { ...attribution, usage, latencyMs: Date.now() - started },
  );
  return output;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function stringsFromOptionalMessage(message: ClassificationMessageRow | null): Record<string, string> {
  if (!message) {
    return {
      subject: '',
      body_text: '',
      snippet: '',
      from_address: '',
      to_address: '',
      cc_address: '',
      combined_text: '',
      has_attachments: 'false',
      attachment_names: '',
      attachment_types: '',
    };
  }
  const subject = message.subject ?? '';
  const body = message.body_text ?? '';
  const snippet = message.snippet ?? '';
  const from = recipientAddresses(message.from_json);
  const to = recipientAddresses(message.to_json);
  const cc = recipientAddresses(message.cc_json);
  return {
    subject,
    body_text: body,
    snippet,
    from_address: from,
    to_address: to,
    cc_address: cc,
    combined_text: [subject, body, snippet, from, to, cc].join('\n'),
    has_attachments: message.has_attachments ? 'true' : 'false',
    attachment_names: attachmentNames(message.attachments_json),
    attachment_types: '',
  };
}

function interpolateWorkflowTemplate(
  template: string,
  strings: Record<string, string>,
  variables: JobPayload,
): string {
  let output = template;
  for (const [key, value] of Object.entries(strings)) {
    output = output.replace(new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g'), value);
  }
  output = output.replace(/\{\{text\}\}/g, strings.combined_text ?? '');
  for (const [key, value] of Object.entries(variables)) {
    output = output.replace(new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g'), String(value ?? ''));
  }
  return output;
}

function stringPayload(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? '')]));
}

async function loadReplyParentContextBlock(
  trx: WorkspaceTransaction,
  workspaceId: string,
  parentId: number,
): Promise<string | null> {
  const parent = await trx
    .selectFrom('email_messages')
    .select(['subject', 'body_text', 'snippet', 'from_json', 'is_spam'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', parentId)
    .executeTakeFirst();
  if (!parent) return null;
  let fromAddr = '';
  try {
    fromAddr = addressesFromRecipientJson(
      typeof parent.from_json === 'string'
        ? parent.from_json
        : parent.from_json == null
          ? null
          : JSON.stringify(parent.from_json),
    );
  } catch {
    fromAddr = '';
  }
  return [
    '',
    '--- Ursprüngliche Nachricht (Antwort-Kontext) ---',
    `Von: ${fromAddr}`,
    `Betreff: ${parent.subject ?? ''}`,
    `Textauszug: ${(parent.body_text ?? parent.snippet ?? '').slice(0, 4000)}`,
    `Spam markiert: ${parent.is_spam ? 'ja' : 'nein'}`,
  ].join('\n');
}

function variablePayload(value: unknown): JobPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: JobPayload = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) {
      out[key] = item;
    }
  }
  return out;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serverWorkerSourceRow() {
  return { origin: 'server_worker' };
}

function serverCreatedSourceSqliteId(kind: string, ...parts: string[]): number {
  const value = [kind, ...parts].join('\u001f');
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash *= 1_099_511_628_211n;
    hash &= 0xffff_ffff_ffff_ffffn;
  }
  return -Number(SERVER_CREATED_SOURCE_ID_OFFSET + (hash % SERVER_CREATED_SOURCE_ID_SPAN));
}
