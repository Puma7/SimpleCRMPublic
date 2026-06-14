import type { Kysely, Selectable } from 'kysely';

import type {
  AiReplySuggestionApiPort,
  EmailReplyDraftGenerationResult,
  EmailReplySuggestionRecord,
  EmailReplySuggestionStatus,
  EmailReplySuggestionTrigger,
} from './api/types';
import type { PostgresSecretPort } from './db/postgres-secret-port';
import { recordAiUsageSafe, type AiTokenUsage } from './ai-usage';
import { callAiChat } from './ai-providers';
import type {
  CustomersTable,
  EmailAiProfilesTable,
  EmailAiPromptsTable,
  EmailMessagesTable,
  ServerDatabase,
} from './db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import type { AiReplySuggestionJobPort } from './jobs/production-handlers';
import { buildKnowledgePromptAppend } from './knowledge-workflow-search';

const REPLY_BODY_MAX = 12_000;
const PENDING_STALE_MS = 15 * 60 * 1000;
const OPENAI_CHAT_TIMEOUT_MS = 90_000;

const DEFAULT_REPLY_SYSTEM_PROMPT =
  'Du schreibst geschaeftliche E-Mail-Antworten auf Deutsch. Antworte nur mit dem Antworttext, ohne Markdown und ohne Zitat der Originalnachricht.';

const DEFAULT_REPLY_USER_TEMPLATE = `Schreibe eine professionelle Antwort auf Deutsch auf die folgende E-Mail.
Antworte nur mit dem Antworttext (Begruessung und Grussformel), ohne Betreffzeile und ohne das Original zitieren.

Von: {{from}}
Betreff: {{subject}}

{{body}}`;

type ChatCompletionInput = Readonly<{
  profile: AiProfileRow;
  apiKey: string;
  system: string;
  user: string;
  captureUsage?: (usage: AiTokenUsage | null) => void;
}>;

export type PostgresAiReplySuggestionPortOptions = Readonly<{
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
type CustomerRow = Selectable<CustomersTable>;

const replyMessageColumns = [
  'id',
  'workspace_id',
  'account_id',
  'uid',
  'pop3_uidl',
  'soft_deleted',
  'is_spam',
  'spam_status',
  'spam_score_label',
  'folder_kind',
  'raw_headers',
  'subject',
  'from_json',
  'body_text',
  'snippet',
  'customer_id',
  'reply_suggestion_text',
  'reply_suggestion_status',
  'reply_suggestion_error',
  'reply_suggestion_updated_at',
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

type ReplyMessageRow = Pick<EmailMessageRow, typeof replyMessageColumns[number]>;
type ReplySettings = Readonly<{
  autoEnabled: boolean;
  triggerOnInbound: boolean;
  triggerOnOpen: boolean;
  categoryMode: 'any' | 'only_listed';
  categoryIds: readonly number[];
}>;

type GenerationContext = Readonly<{
  message: ReplyMessageRow;
  prompt: AiPromptRow | null;
  profile: AiProfileRow | null;
  customer: Pick<CustomerRow, 'name' | 'first_name' | 'email'> | null;
}>;

const DEFAULT_REPLY_SETTINGS: ReplySettings = {
  autoEnabled: true,
  triggerOnInbound: true,
  triggerOnOpen: true,
  categoryMode: 'any',
  categoryIds: [],
};

export function createPostgresAiReplySuggestionPort(
  options: PostgresAiReplySuggestionPortOptions,
): AiReplySuggestionApiPort & AiReplySuggestionJobPort {
  const now = () => options.now?.() ?? new Date();

  return {
    async get(input): Promise<EmailReplySuggestionRecord> {
      const message = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => selectReplyMessage(trx, input.workspaceId, input.messageId),
        { applySession: options.applyWorkspaceSession },
      );
      return mapReplySuggestion(message, input.now ?? now());
    },

    async ensure(input): Promise<void> {
      const context = await loadGenerationContext(options, {
        workspaceId: input.workspaceId,
        messageId: input.messageId,
        promptId: input.promptId,
        profileId: input.profileId,
        customerId: undefined,
        honorAuto: !input.force,
        trigger: input.trigger ?? 'inbound',
      });
      if (!context) return;

      const current = mapReplySuggestion(context.message, now());
      if ((!input.force || input.skipIfReady) && current.status === 'ready') return;
      if ((!input.force || input.skipIfReady) && current.status === 'pending') return;

      if (!canSuggestReplyForMessage(context.message)) {
        await setReplySuggestion(options, input.workspaceId, input.messageId, {
          status: 'skipped',
          error: 'Nicht anwendbar',
        });
        return;
      }

      const apiKey = await readProfileApiKey(options.secrets, input.workspaceId, context.profile);
      if (!apiKey) {
        await setReplySuggestion(options, input.workspaceId, input.messageId, {
          status: 'skipped',
          error: 'Kein API-Schluessel',
        });
        return;
      }

      await setReplySuggestion(options, input.workspaceId, input.messageId, { status: 'pending' });
      const result = await generateReplyDraftText(options, context, apiKey);
      await setReplySuggestion(options, input.workspaceId, input.messageId, result.success
        ? { status: 'ready', text: result.text, error: null }
        : { status: 'failed', text: null, error: result.error });
    },

    async generate(input): Promise<EmailReplyDraftGenerationResult> {
      const context = await loadGenerationContext(options, {
        workspaceId: input.workspaceId,
        messageId: input.messageId,
        promptId: input.promptId,
        profileId: input.profileId,
        customerId: input.customerId,
        honorAuto: false,
        trigger: 'open',
      });
      if (!context) return { success: false, error: 'Nachricht nicht gefunden' };
      if (!canSuggestReplyForMessage(context.message)) {
        const result = { success: false as const, error: 'Fuer diese Nachricht ist keine KI-Antwort vorgesehen' };
        await setReplySuggestion(options, input.workspaceId, input.messageId, {
          status: 'failed',
          text: null,
          error: result.error,
        });
        return result;
      }

      const apiKey = await readProfileApiKey(options.secrets, input.workspaceId, context.profile);
      if (!apiKey) {
        const result = { success: false as const, error: 'Kein KI-API-Schluessel konfiguriert' };
        await setReplySuggestion(options, input.workspaceId, input.messageId, {
          status: 'skipped',
          text: null,
          error: 'Kein API-Schluessel',
        });
        return result;
      }

      const result = await generateReplyDraftText(options, context, apiKey);
      await setReplySuggestion(options, input.workspaceId, input.messageId, result.success
        ? { status: 'ready', text: result.text, error: null }
        : { status: 'failed', text: null, error: result.error });
      return result;
    },
  };
}

async function loadGenerationContext(
  options: PostgresAiReplySuggestionPortOptions,
  input: Readonly<{
    workspaceId: string;
    messageId: number;
    promptId?: number;
    profileId?: number;
    customerId?: number | null;
    honorAuto: boolean;
    trigger: EmailReplySuggestionTrigger;
  }>,
): Promise<GenerationContext | null> {
  return withWorkspaceTransaction(
    options.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      const message = await selectReplyMessage(trx, input.workspaceId, input.messageId);
      if (!message) return null;

      if (input.honorAuto) {
        const settings = await selectReplySettings(trx, input.workspaceId, message.account_id);
        if (!shouldRunForTrigger(settings, input.trigger)) return null;
        if (!(await messageMatchesReplySuggestionCategories(trx, input.workspaceId, message.id, settings))) {
          return null;
        }
      }

      const prompt = await selectReplyPrompt(trx, input.workspaceId, input.promptId, message.account_id);
      const profile = await selectReplyProfile(trx, input.workspaceId, input.profileId, prompt?.profile_id ?? null);
      const customerId = input.customerId === undefined ? message.customer_id : input.customerId;
      const customer = customerId
        ? await trx
          .selectFrom('customers')
          .select(['name', 'first_name', 'email'])
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', customerId)
          .executeTakeFirst() ?? null
        : null;

      return { message, prompt, profile, customer };
    },
    { applySession: options.applyWorkspaceSession },
  );
}

async function selectReplyMessage(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<ReplyMessageRow | null> {
  return await trx
    .selectFrom('email_messages')
    .select(replyMessageColumns)
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst() ?? null;
}

async function selectReplyPrompt(
  trx: WorkspaceTransaction,
  workspaceId: string,
  promptId: number | undefined,
  accountId: number | null,
): Promise<AiPromptRow | null> {
  if (promptId !== undefined) {
    let explicit = trx
      .selectFrom('email_ai_prompts')
      .select(aiPromptColumns)
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', promptId);
    explicit = accountId == null
      ? explicit.where('account_id', 'is', null)
      : explicit.where((eb) => eb.or([
        eb('account_id', 'is', null),
        eb('account_id', '=', accountId),
      ]));
    return await explicit.executeTakeFirst() ?? null;
  }

  const replyRows = await scopedPromptQuery(trx, workspaceId, accountId)
    .where('target', '=', 'reply')
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .execute();
  const reply = firstScopedPrompt(replyRows, accountId);
  if (reply) return reply;

  const fallbackRows = await scopedPromptQuery(trx, workspaceId, accountId)
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return firstScopedPrompt(fallbackRows, accountId);
}

function scopedPromptQuery(trx: WorkspaceTransaction, workspaceId: string, accountId: number | null) {
  const base = trx
    .selectFrom('email_ai_prompts')
    .select(aiPromptColumns)
    .where('workspace_id', '=', workspaceId);
  return accountId == null
    ? base.where('account_id', 'is', null)
    : base.where((eb) => eb.or([
      eb('account_id', 'is', null),
      eb('account_id', '=', accountId),
    ]));
}

function firstScopedPrompt(rows: readonly AiPromptRow[], accountId: number | null): AiPromptRow | null {
  if (accountId == null) return rows[0] ?? null;
  const byKey = new Map<string, AiPromptRow>();
  for (const row of rows) {
    if (row.account_id == null) byKey.set(row.override_key?.trim() || `id:${row.id}`, row);
  }
  for (const row of rows) {
    if (row.account_id === accountId) byKey.set(row.override_key?.trim() || `id:${row.id}`, row);
  }
  return [...byKey.values()].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || Number(a.id) - Number(b.id))[0] ?? null;
}

async function selectReplyProfile(
  trx: WorkspaceTransaction,
  workspaceId: string,
  profileId: number | undefined,
  promptProfileId: number | null,
): Promise<AiProfileRow | null> {
  const explicitProfileId = profileId ?? (promptProfileId === null ? undefined : Number(promptProfileId));
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

async function selectReplySettings(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | null,
): Promise<ReplySettings> {
  const baseKeys = [
    'reply_suggestion_auto_enabled',
    'reply_suggestion_trigger_inbound',
    'reply_suggestion_trigger_on_open',
    'reply_suggestion_category_mode',
    'reply_suggestion_category_ids',
  ];
  const keys = accountId === null
    ? baseKeys
    : baseKeys.flatMap((key) => [key, `${key}@${Number(accountId)}`]);
  const rows = await trx
    .selectFrom('sync_info')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', 'in', keys)
    .execute();
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const read = (key: string) => {
    if (accountId !== null) {
      const scoped = values.get(`${key}@${Number(accountId)}`);
      if (scoped !== undefined) return scoped;
    }
    return values.get(key);
  };

  return {
    autoEnabled: syncFlag(read('reply_suggestion_auto_enabled'), DEFAULT_REPLY_SETTINGS.autoEnabled),
    triggerOnInbound: syncFlag(read('reply_suggestion_trigger_inbound'), DEFAULT_REPLY_SETTINGS.triggerOnInbound),
    triggerOnOpen: syncFlag(read('reply_suggestion_trigger_on_open'), DEFAULT_REPLY_SETTINGS.triggerOnOpen),
    categoryMode: read('reply_suggestion_category_mode') === 'only_listed' ? 'only_listed' : 'any',
    categoryIds: parseCategoryIds(read('reply_suggestion_category_ids')),
  };
}

async function messageMatchesReplySuggestionCategories(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
  settings: ReplySettings,
): Promise<boolean> {
  if (settings.categoryMode !== 'only_listed') return true;
  if (settings.categoryIds.length === 0) return false;
  const row = await trx
    .selectFrom('email_message_categories')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('message_id', '=', messageId)
    .where('category_id', 'in', [...settings.categoryIds])
    .executeTakeFirst();
  return Boolean(row);
}

function shouldRunForTrigger(settings: ReplySettings, trigger: EmailReplySuggestionTrigger): boolean {
  if (!settings.autoEnabled) return false;
  return trigger === 'inbound' ? settings.triggerOnInbound : settings.triggerOnOpen;
}

async function generateReplyDraftText(
  options: PostgresAiReplySuggestionPortOptions,
  context: GenerationContext,
  apiKey: string,
): Promise<EmailReplyDraftGenerationResult> {
  let user = interpolateReplyTemplate(
    context.prompt?.user_template ?? DEFAULT_REPLY_USER_TEMPLATE,
    context.message,
    context.customer,
  );

  const query = messageBodyForReply(context.message).slice(0, 2000);
  if (query.length >= 8) {
    const kbBlock = await withWorkspaceTransaction(
      options.db,
      { workspaceId: context.message.workspace_id, role: 'system' },
      async (trx) => buildKnowledgePromptAppend(
        trx,
        context.message.workspace_id,
        context.message.account_id === null ? null : Number(context.message.account_id),
        'inbound',
        query,
      ),
      { applySession: options.applyWorkspaceSession },
    );
    if (kbBlock) user = `${user}${kbBlock}`;
  }

  try {
    const started = Date.now();
    let usage: AiTokenUsage | null = null;
    const text = (await (options.chatCompletion ?? defaultChatCompletion)({
      profile: context.profile!,
      apiKey,
      system: DEFAULT_REPLY_SYSTEM_PROMPT,
      user,
      captureUsage: (value) => { usage = value; },
    })).trim();
    await recordAiUsageSafe(
      { db: options.db, applyWorkspaceSession: options.applyWorkspaceSession, now: options.now },
      {
        workspaceId: context.message.workspace_id,
        aiProfileId: context.profile ? Number(context.profile.id) : null,
        model: context.profile?.model ?? null,
        nodeType: 'ai.reply_suggestion',
        messageId: Number(context.message.id),
        usage,
        latencyMs: Date.now() - started,
      },
    );
    if (!text) return { success: false, error: 'KI-Antwort leer' };
    return { success: true, text };
  } catch (err) {
    return { success: false, error: formatAiUserError(err) };
  }

  async function defaultChatCompletion(input: ChatCompletionInput): Promise<string> {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) throw new Error('fetch is not available for AI reply suggestions');
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
        temperature: 0.3,
        fetchImpl,
        signal: controller.signal,
      });
      input.captureUsage?.(result.usage);
      return result.content;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readProfileApiKey(
  secrets: PostgresSecretPort | undefined,
  workspaceId: string,
  profile: AiProfileRow | null,
): Promise<string | null> {
  if (!profile?.secret_id || !secrets) return null;
  const secret = await secrets.readSecret(aiProfileApiKeySecretIdentifier(workspaceId, Number(profile.id)));
  const value = secret?.toString('utf8').trim();
  return value || null;
}

function aiProfileApiKeySecretIdentifier(workspaceId: string, profileId: number): {
  workspaceId: string;
  kind: string;
  name: string;
} {
  return {
    workspaceId,
    kind: 'email.ai_profile.api_key',
    name: `email_ai_profile:${profileId}:api_key`,
  };
}

function canSuggestReplyForMessage(row: ReplyMessageRow): boolean {
  if (row.soft_deleted) return false;
  if (row.is_spam) return false;
  if (row.spam_status === 'spam' || row.spam_status === 'review') return false;
  if (row.spam_score_label === 'spam' || row.spam_score_label === 'review') return false;
  if (row.folder_kind !== 'inbox') return false;
  if (Number(row.uid) < 0 && !row.pop3_uidl) return false;
  if (isAutomatedInbound(row)) return false;
  return messageBodyForReply(row).length >= 8;
}

function isAutomatedInbound(row: ReplyMessageRow): boolean {
  const from = extractFromAddress(row.from_json).toLowerCase();
  if (/mailer-daemon|mail-daemon|postmaster|noreply|no-reply|donotreply|do-not-reply/.test(from)) return true;
  const subject = (row.subject ?? '').toLowerCase();
  if (
    subject.includes('out of office')
    || subject.includes('abwesenheit')
    || subject.includes('automatische antwort')
  ) {
    return true;
  }
  const headers = (row.raw_headers ?? '').toLowerCase();
  if (/auto-submitted:\s*auto/.test(headers)) return true;
  if (/precedence:\s*(bulk|list|junk)/.test(headers)) return true;
  return false;
}

function mapReplySuggestion(row: ReplyMessageRow | null, now: Date): EmailReplySuggestionRecord {
  if (!row) return noneReplySuggestion();
  const status = normalizeReplySuggestionStatus(row.reply_suggestion_status);
  const text = row.reply_suggestion_text?.trim() || null;
  const error = row.reply_suggestion_error?.trim() || null;
  const updatedAt = timestampToIsoOrNull(row.reply_suggestion_updated_at);

  if (status === 'ready' && text) return { status: 'ready', text, error: null, updatedAt };
  if (status === 'pending' && !isPendingStale(row.reply_suggestion_updated_at, now)) {
    return { status: 'pending', text: null, error: null, updatedAt };
  }
  if (status === 'failed') {
    return { status: 'failed', text: null, error: formatAiUserError(error ?? 'Generierung fehlgeschlagen'), updatedAt };
  }
  if (status === 'skipped') return { status: 'skipped', text: null, error, updatedAt };
  return noneReplySuggestion();
}

function noneReplySuggestion(): EmailReplySuggestionRecord {
  return { status: 'none', text: null, error: null, updatedAt: null };
}

function normalizeReplySuggestionStatus(value: string | null): EmailReplySuggestionStatus {
  return value === 'pending' || value === 'ready' || value === 'failed' || value === 'skipped'
    ? value
    : 'none';
}

async function setReplySuggestion(
  options: PostgresAiReplySuggestionPortOptions,
  workspaceId: string,
  messageId: number,
  patch: Readonly<{
    status: EmailReplySuggestionStatus;
    text?: string | null;
    error?: string | null;
  }>,
): Promise<void> {
  const updatedAt = options.now?.() ?? new Date();
  await withWorkspaceTransaction(
    options.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      await trx
        .updateTable('email_messages')
        .set({
          reply_suggestion_status: patch.status === 'none' ? null : patch.status,
          reply_suggestion_text: patch.text ?? null,
          reply_suggestion_error: patch.error ?? null,
          reply_suggestion_updated_at: updatedAt,
          updated_at: updatedAt,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', messageId)
        .executeTakeFirst();
    },
    { applySession: options.applyWorkspaceSession },
  );
}

function messageBodyForReply(row: Pick<ReplyMessageRow, 'body_text' | 'snippet'>): string {
  return (row.body_text ?? row.snippet ?? '').trim().slice(0, REPLY_BODY_MAX);
}

function interpolateReplyTemplate(
  template: string,
  row: ReplyMessageRow,
  customer: Pick<CustomerRow, 'name' | 'first_name' | 'email'> | null,
): string {
  const body = messageBodyForReply(row);
  const replacements: Record<string, string> = {
    subject: row.subject ?? '',
    from: extractFromAddress(row.from_json),
    body,
    text: body,
    'customer.name': customer?.name ?? '',
    'customer.firstName': customer?.first_name ?? '',
    'customer.email': customer?.email ?? '',
  };
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => replacements[key.trim()] ?? '');
}

function extractFromAddress(fromJson: unknown): string {
  const parsed = typeof fromJson === 'string' ? parseJson(fromJson) : fromJson;
  const value = isRecord(parsed) ? parsed.value : Array.isArray(parsed) ? parsed : null;
  if (!Array.isArray(value)) return typeof fromJson === 'string' ? fromJson : '';
  const first = value[0];
  if (!isRecord(first)) return '';
  const name = typeof first.name === 'string' ? first.name.trim() : '';
  const address = typeof first.address === 'string' ? first.address.trim() : '';
  if (name && address) return `${name} <${address}>`;
  return address || name;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatAiUserError(err: unknown): string {
  const msg = errorMessage(err).trim();
  if (!msg) return 'KI-Anfrage fehlgeschlagen';
  const lower = msg.toLowerCase();
  if (
    lower.includes('operation was aborted')
    || lower.includes('aborterror')
    || lower.includes('timed out')
    || lower.includes('timeout')
  ) {
    return 'KI-Anfrage abgebrochen oder Zeitlimit (90 Sekunden) ueberschritten. Bitte erneut versuchen.';
  }
  if (/fetch failed|network|econnrefused|enotfound|socket hang up/i.test(msg)) {
    return `Netzwerkfehler bei der KI-Anfrage: ${msg}`;
  }
  return msg;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

function isPendingStale(updatedAt: Date | string | null, now: Date): boolean {
  if (!updatedAt) return true;
  const time = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();
  if (Number.isNaN(time)) return true;
  return now.getTime() - time > PENDING_STALE_MS;
}

function timestampToIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function syncFlag(value: string | null | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return value === '1' || value === 'true';
}

function parseCategoryIds(value: string | null | undefined): readonly number[] {
  if (!value?.trim()) return [];
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => Number(item))
    .filter((item) => Number.isSafeInteger(item) && item > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
