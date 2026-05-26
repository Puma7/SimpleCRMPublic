import { getCustomerById, getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import { listAiPrompts, type AiPromptRow } from './email-crm-store';
import { resolvePromptProfileId } from './email-ai-profiles';
import { runChatCompletion } from './email-openai';
import { getEmailMessageById, type EmailMessageRow } from './email-store';
import { hasAnyAiProfileWithKey } from './email-ai-profiles';

const REPLY_BODY_MAX = 12_000;
const INFLIGHT = new Set<number>();
const QUEUED = new Set<number>();
const PENDING_STALE_MS = 15 * 60 * 1000;
const SUGGESTION_MIN_GAP_MS = 2500;

let suggestionChain: Promise<void> = Promise.resolve();
let lastSuggestionFinishedAt = 0;

const DEFAULT_REPLY_USER_TEMPLATE = `Schreibe eine professionelle Antwort auf Deutsch auf die folgende E-Mail.
Antworte nur mit dem Antworttext (Begrüßung und Grußformel), ohne Betreffzeile und ohne das Original zitieren.

Von: {{from}}
Betreff: {{subject}}

{{body}}`;

export type ReplySuggestionStatus = 'none' | 'pending' | 'ready' | 'failed' | 'skipped';

export type ReplySuggestionRow = {
  status: ReplySuggestionStatus;
  text: string | null;
  error: string | null;
  updatedAt: string | null;
};

function extractFromAddress(fromJson: string | null): string {
  if (!fromJson) return '';
  try {
    const parsed = JSON.parse(fromJson) as { value?: { name?: string; address?: string }[] };
    const v = parsed?.value?.[0];
    if (v?.name && v?.address) return `${v.name} <${v.address}>`;
    return v?.address ?? '';
  } catch {
    return '';
  }
}

function messageBodyForReply(row: EmailMessageRow): string {
  const raw = (row.body_text ?? row.snippet ?? '').trim();
  return raw.slice(0, REPLY_BODY_MAX);
}

function findReplyPrompt(): AiPromptRow | undefined {
  const prompts = listAiPrompts();
  return prompts.find((p) => p.target === 'reply') ?? prompts[0];
}

function interpolateReplyTemplate(
  template: string,
  row: EmailMessageRow,
  customerId: number | null | undefined,
): string {
  const body = messageBodyForReply(row);
  let user = template
    .replace(/\{\{subject\}\}/g, () => row.subject ?? '')
    .replace(/\{\{from\}\}/g, () => extractFromAddress(row.from_json))
    .replace(/\{\{body\}\}/g, () => body)
    .replace(/\{\{text\}\}/g, () => body);
  if (customerId) {
    const cust = getCustomerById(customerId);
    if (cust) {
      user = user
        .replace(/\{\{customer\.name\}\}/g, () => cust.name ?? '')
        .replace(/\{\{customer\.firstName\}\}/g, () => cust.firstName ?? '')
        .replace(/\{\{customer\.email\}\}/g, () => cust.email ?? '');
    }
  }
  return user;
}

function isAutomatedInbound(row: EmailMessageRow): boolean {
  const from = extractFromAddress(row.from_json).toLowerCase();
  if (
    /mailer-daemon|mail-daemon|postmaster|noreply|no-reply|donotreply|do-not-reply/.test(from)
  ) {
    return true;
  }
  const subj = (row.subject ?? '').toLowerCase();
  if (
    subj.includes('out of office') ||
    subj.includes('abwesenheit') ||
    subj.includes('automatische antwort')
  ) {
    return true;
  }
  const hdr = (row.raw_headers ?? '').toLowerCase();
  if (/auto-submitted:\s*auto/.test(hdr)) return true;
  if (/precedence:\s*(bulk|list|junk)/.test(hdr)) return true;
  return false;
}

export function canSuggestReplyForMessage(row: EmailMessageRow): boolean {
  if (row.soft_deleted) return false;
  if (row.is_spam) return false;
  if (row.folder_kind !== 'inbox') return false;
  if (row.uid < 0 && !row.pop3_uidl) return false;
  if (isAutomatedInbound(row)) return false;
  const body = messageBodyForReply(row);
  return body.length >= 8;
}

function isPendingStale(updatedAt: string | null): boolean {
  if (!updatedAt) return true;
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > PENDING_STALE_MS;
}

/** Reset stuck reply suggestions after crash (call on DB init). */
export function recoverStaleReplySuggestions(): void {
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET reply_suggestion_status = 'failed',
           reply_suggestion_error = 'Generierung unterbrochen (Neustart)',
           reply_suggestion_updated_at = datetime('now')
       WHERE reply_suggestion_status = 'pending'`,
    )
    .run();
}

export function getReplySuggestion(messageId: number): ReplySuggestionRow {
  const row = getEmailMessageById(messageId);
  if (!row) {
    return { status: 'none', text: null, error: null, updatedAt: null };
  }
  const status = (row as EmailMessageRow & { reply_suggestion_status?: string | null })
    .reply_suggestion_status as ReplySuggestionStatus | null | undefined;
  const text = (row as EmailMessageRow & { reply_suggestion_text?: string | null }).reply_suggestion_text ?? null;
  const error = (row as EmailMessageRow & { reply_suggestion_error?: string | null }).reply_suggestion_error ?? null;
  const updatedAt =
    (row as EmailMessageRow & { reply_suggestion_updated_at?: string | null }).reply_suggestion_updated_at ?? null;
  if (status === 'ready' && text?.trim()) {
    return { status: 'ready', text: text.trim(), error: null, updatedAt };
  }
  if (status === 'pending' && !isPendingStale(updatedAt)) {
    return { status: 'pending', text: null, error: null, updatedAt };
  }
  if (status === 'failed') {
    return { status: 'failed', text: null, error: error ?? 'Generierung fehlgeschlagen', updatedAt };
  }
  if (status === 'skipped') {
    return { status: 'skipped', text: null, error: error, updatedAt };
  }
  return { status: 'none', text: null, error: null, updatedAt };
}

function setReplySuggestionDb(
  messageId: number,
  patch: {
    status: ReplySuggestionStatus;
    text?: string | null;
    error?: string | null;
  },
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET reply_suggestion_status = ?,
           reply_suggestion_text = ?,
           reply_suggestion_error = ?,
           reply_suggestion_updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.status === 'none' ? null : patch.status,
      patch.text ?? null,
      patch.error ?? null,
      now,
      messageId,
    );
}

export async function generateReplyDraftText(
  messageId: number,
  opts?: { promptId?: number; customerId?: number | null },
): Promise<{ success: true; text: string } | { success: false; error: string }> {
  const row = getEmailMessageById(messageId);
  if (!row) return { success: false, error: 'Nachricht nicht gefunden' };
  if (!canSuggestReplyForMessage(row)) {
    return { success: false, error: 'Für diese Nachricht ist keine KI-Antwort vorgesehen' };
  }
  if (!(await hasAnyAiProfileWithKey())) {
    return { success: false, error: 'Kein KI-API-Schlüssel konfiguriert' };
  }

  const customerId =
    opts?.customerId !== undefined ? opts.customerId : row.customer_id;

  const prompts = listAiPrompts();
  const prompt =
    (opts?.promptId != null ? prompts.find((p) => p.id === opts.promptId) : undefined) ??
    findReplyPrompt();
  const template = prompt?.user_template ?? DEFAULT_REPLY_USER_TEMPLATE;
  const user = interpolateReplyTemplate(template, row, customerId);

  try {
    const profileId = prompt ? resolvePromptProfileId(prompt) : null;
    const out = await runChatCompletion(
      'Du schreibst geschäftliche E-Mail-Antworten auf Deutsch. Antworte nur mit dem Antworttext, ohne Markdown und ohne Zitat der Originalnachricht.',
      user,
      profileId,
    );
    const text = out.trim();
    if (!text) return { success: false, error: 'KI-Antwort leer' };
    return { success: true, text };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function runSuggestionJob(messageId: number): Promise<void> {
  if (INFLIGHT.has(messageId)) return;
  INFLIGHT.add(messageId);
  try {
    const row = getEmailMessageById(messageId);
    if (!row || !canSuggestReplyForMessage(row)) {
      setReplySuggestionDb(messageId, { status: 'skipped', error: 'Nicht anwendbar' });
      return;
    }
    if (!(await hasAnyAiProfileWithKey())) {
      setReplySuggestionDb(messageId, { status: 'skipped', error: 'Kein API-Schlüssel' });
      return;
    }
    setReplySuggestionDb(messageId, { status: 'pending' });
    const result = await generateReplyDraftText(messageId, { customerId: row.customer_id });
    if (result.success) {
      setReplySuggestionDb(messageId, { status: 'ready', text: result.text, error: null });
    } else {
      setReplySuggestionDb(messageId, { status: 'failed', text: null, error: result.error });
    }
  } finally {
    INFLIGHT.delete(messageId);
    QUEUED.delete(messageId);
    lastSuggestionFinishedAt = Date.now();
  }
}

/** Queue background reply suggestion (serialized, rate-limited). */
export function ensureReplySuggestion(messageId: number, opts?: { force?: boolean }): void {
  const row = getEmailMessageById(messageId);
  if (!row || !canSuggestReplyForMessage(row)) return;
  const current = getReplySuggestion(messageId);
  if (!opts?.force && current.status === 'ready') return;
  if (
    !opts?.force &&
    current.status === 'pending' &&
    !isPendingStale(current.updatedAt)
  ) {
    return;
  }
  if (QUEUED.has(messageId) || INFLIGHT.has(messageId)) return;
  QUEUED.add(messageId);
  suggestionChain = suggestionChain
    .then(async () => {
      const wait = Math.max(0, SUGGESTION_MIN_GAP_MS - (Date.now() - lastSuggestionFinishedAt));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await runSuggestionJob(messageId);
    })
    .catch(() => undefined);
}

export async function generateAndStoreReplySuggestion(
  messageId: number,
  opts?: { promptId?: number; customerId?: number | null },
): Promise<{ success: true; text: string } | { success: false; error: string }> {
  const result = await generateReplyDraftText(messageId, opts);
  if (result.success) {
    setReplySuggestionDb(messageId, { status: 'ready', text: result.text, error: null });
  } else {
    setReplySuggestionDb(messageId, { status: 'failed', text: null, error: result.error });
  }
  return result;
}
