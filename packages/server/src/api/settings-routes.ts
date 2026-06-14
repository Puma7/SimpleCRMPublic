import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  EmailAccountMailSettingsMutationInput,
  MssqlSettingsInput,
  ServerApiPorts,
  SyncInfoRecord,
} from './types';
import {
  data,
  error,
  requireAdmin,
  requirePrincipal,
} from './types';

const WORKFLOW_AUTOMATION_KEYS = [
  'workflow_imap_delete_opt_in',
  'workflow_http_allowlist',
  'workflow_sender_whitelist',
  'workflow_sender_blacklist',
  'workflow_spam_score_threshold',
] as const;

const EMAIL_MISC_KEYS = [
  'email_webhook_secret',
  'email_max_attachment_mb',
] as const;

function syncInfoKeyRequiresAdmin(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes('secret')
    || lower.includes('password')
    || lower.includes('_token')
    || lower.endsWith('_key')
  );
}

function maskSyncInfoSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}${'*'.repeat(Math.min(value.length - 4, 12))}${value.slice(-2)}`;
}

const MAIL_SECURITY_KEYS = [
  'mail_security_mailauth_enabled',
  'mail_security_rspamd_enabled',
  'mail_security_rspamd_url',
  'mail_security_rspamd_timeout_ms',
  'mail_security_rspamd_spam_score',
  'mail_security_auto_spam_dmarc_fail',
  'mail_security_auto_spam_spf_fail',
  'mail_security_auto_spam_rspamd',
  'workflow_sender_whitelist',
  'workflow_sender_blacklist',
  'workflow_spam_score_threshold',
  'mail_security_spam_engine_enabled',
  'mail_security_spam_review_threshold',
  'mail_security_spam_spam_threshold',
  'mail_security_spam_local_learning_enabled',
  'mail_security_spam_rspamd_contribution_enabled',
  'mail_security_spam_rspamd_learning_enabled',
  'mail_security_spam_ai_workflow_enabled',
] as const;

const SNOOZE_SETTINGS_KEY = 'snooze_default_times_v1';
const DEFAULT_RSPAMD_URL = 'http://127.0.0.1:11333';
const DEFAULT_RSPAMD_TIMEOUT_MS = 8000;
const MIN_RSPAMD_TIMEOUT_MS = 1000;
const MAX_RSPAMD_TIMEOUT_MS = 60000;

const REPLY_SUGGESTION_KEYS = [
  'reply_suggestion_auto_enabled',
  'reply_suggestion_trigger_inbound',
  'reply_suggestion_trigger_on_open',
  'reply_suggestion_category_mode',
  'reply_suggestion_category_ids',
] as const;

type SettingsPayloadParseResult =
  | { ok: true; values: Record<string, string | null> }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type SyncInfoKeyParseResult =
  | { ok: true; key: string }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type GenericSyncInfoValueParseResult =
  | { ok: true; value: string | null }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type ReplySuggestionPayloadParseResult =
  | {
    ok: true;
    accountId?: number;
    values: Partial<ReplySuggestionSettings>;
  }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type SnoozeSettings = {
  eveningHour: number;
  eveningMinute: number;
  morningHour: number;
  morningMinute: number;
  nextWeekWeekday: number;
  nextWeekHour: number;
  nextWeekMinute: number;
};

type RspamdConnectionTestInput = {
  rspamdUrl: string;
  rspamdTimeoutMs: number;
};

type ReplySuggestionSettings = {
  autoEnabled: boolean;
  triggerOnInbound: boolean;
  triggerOnOpen: boolean;
  categoryMode: 'any' | 'only_listed';
  categoryIds: number[];
};

type MssqlSettingsPayloadParseResult =
  | { ok: true; values: MssqlSettingsInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type ValidationFieldError = {
  field: string;
  message: string;
};

const DEFAULT_SNOOZE_SETTINGS: SnoozeSettings = {
  eveningHour: 18,
  eveningMinute: 0,
  morningHour: 9,
  morningMinute: 0,
  nextWeekWeekday: 1,
  nextWeekHour: 9,
  nextWeekMinute: 0,
};

const DEFAULT_REPLY_SUGGESTION_SETTINGS: ReplySuggestionSettings = {
  autoEnabled: true,
  triggerOnInbound: true,
  triggerOnOpen: true,
  categoryMode: 'any',
  categoryIds: [],
};

export async function handleSettingsRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  const syncInfoMatch = /^\/api\/v1\/sync-info\/([^/]+)$/.exec(req.path);
  if (syncInfoMatch) {
    return handleGenericSyncInfo(req, ports, syncInfoMatch[1]);
  }

  if (req.path === '/api/v1/workflow/settings/automation') {
    return handleWorkflowAutomationSettings(req, ports);
  }

  if (req.path === '/api/v1/email/settings/misc') {
    return handleEmailMiscSettings(req, ports);
  }

  if (req.path === '/api/v1/email/settings/security') {
    return handleMailSecuritySettings(req, ports);
  }

  if (req.path === '/api/v1/email/settings/security/test-rspamd') {
    return handleRspamdConnectionTest(req);
  }

  if (req.path === '/api/v1/email/settings/account-mail') {
    return handleAccountMailSettings(req, ports);
  }

  if (req.path === '/api/v1/email/settings/snooze') {
    return handleSnoozeSettings(req, ports);
  }

  if (req.path === '/api/v1/email/settings/reply-suggestion') {
    return handleReplySuggestionSettings(req, ports);
  }

  if (req.path === '/api/v1/mssql/settings') {
    return handleMssqlSettings(req, ports);
  }

  if (req.path === '/api/v1/mssql/test-connection') {
    return handleMssqlConnectionTest(req, ports);
  }

  if (req.path === '/api/v1/mssql/password') {
    return handleMssqlPassword(req, ports);
  }

  return null;
}

async function handleGenericSyncInfo(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawKey: string,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.syncInfo) return error(503, 'sync_info_unavailable', 'Sync-info API nicht konfiguriert');

  const parsedKey = parseSyncInfoPathKey(rawKey);
  if (!parsedKey.ok) return parsedKey.response;

  if (req.method === 'GET') {
    if (syncInfoKeyRequiresAdmin(parsedKey.key) && !requireAdmin(principal)) {
      return error(403, 'forbidden', 'Adminrechte erforderlich');
    }
    const rows = await ports.syncInfo.getMany({
      workspaceId: principal.workspaceId,
      keys: [parsedKey.key],
    });
    return data(200, {
      key: parsedKey.key,
      value: rows[0]?.value ?? null,
    });
  }

  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

  if (syncInfoKeyRequiresAdmin(parsedKey.key) && !requireAdmin(principal)) {
    return error(403, 'forbidden', 'Adminrechte erforderlich');
  }

  const parsedValue = parseGenericSyncInfoBody(req.body);
  if (!parsedValue.ok) return parsedValue.response;

  await ports.syncInfo.setMany({
    workspaceId: principal.workspaceId,
    values: { [parsedKey.key]: parsedValue.value },
  });
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'sync_info.updated',
    entityType: 'sync_info',
    entityId: parsedKey.key,
    metadata: { keys: [parsedKey.key] },
  });

  return data(200, { success: true });
}

async function handleWorkflowAutomationSettings(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method === 'GET') {
    const loaded = await loadSyncInfo(req, ports, WORKFLOW_AUTOMATION_KEYS);
    if ('status' in loaded) return loaded;
    return data(200, {
      imapDeleteOptIn: syncInfoFlag(loaded.values.get('workflow_imap_delete_opt_in'), false),
      httpAllowlist: loaded.values.get('workflow_http_allowlist') ?? '',
      senderWhitelist: loaded.values.get('workflow_sender_whitelist') ?? '',
      senderBlacklist: loaded.values.get('workflow_sender_blacklist') ?? '',
      spamScoreThreshold: String(syncInfoBoundedInt(loaded.values.get('workflow_spam_score_threshold'), 70, 1, 100)),
    });
  }

  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const parsed = parseWorkflowAutomationSettingsBody(req.body);
  if (!parsed.ok) return parsed.response;
  const saved = await saveSyncInfo(req, ports, parsed.values, 'workflow_settings.updated', 'workflow.settings.automation');
  if ('status' in saved) return saved;
  return data(200, { success: true });
}

async function handleEmailMiscSettings(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method === 'GET') {
    const principal = requirePrincipal(req);
    if ('status' in principal) return principal;
    const loaded = await loadSyncInfo(req, ports, EMAIL_MISC_KEYS);
    if ('status' in loaded) return loaded;
    const canReadSecret = requireAdmin(principal);
    return data(200, {
      webhookSecret: canReadSecret
        ? (loaded.values.get('email_webhook_secret') ?? '')
        : maskSyncInfoSecret(loaded.values.get('email_webhook_secret')),
      maxAttachmentMb: loaded.values.get('email_max_attachment_mb') ?? '25',
    });
  }

  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const parsed = parseEmailMiscSettingsBody(req.body);
  if (!parsed.ok) return parsed.response;
  if ('email_webhook_secret' in parsed.values && !requireAdmin(principal)) {
    return error(403, 'forbidden', 'Adminrechte erforderlich');
  }
  const saved = await saveSyncInfo(req, ports, parsed.values, 'email_settings.misc.updated', 'email.settings.misc');
  if ('status' in saved) return saved;
  return data(200, { success: true });
}

async function handleMailSecuritySettings(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method === 'GET') {
    const loaded = await loadSyncInfo(req, ports, MAIL_SECURITY_KEYS);
    if ('status' in loaded) return loaded;
    const values = loaded.values;
    const rspamdEnabled = syncInfoFlag(values.get('mail_security_rspamd_enabled'), false);
    const spamReviewThreshold = syncInfoBoundedInt(values.get('mail_security_spam_review_threshold'), 45, 0, 100);
    return data(200, {
      mailauthEnabled: syncInfoFlag(values.get('mail_security_mailauth_enabled'), true),
      rspamdEnabled,
      rspamdUrl: syncInfoUrl(values.get('mail_security_rspamd_url'), 'http://127.0.0.1:11333'),
      rspamdTimeoutMs: syncInfoBoundedInt(values.get('mail_security_rspamd_timeout_ms'), 8000, 1000, 60000),
      rspamdSpamScore: syncInfoBoundedFloat(values.get('mail_security_rspamd_spam_score'), 15, 1, 100),
      autoSpamDmarcFail: syncInfoFlag(values.get('mail_security_auto_spam_dmarc_fail'), false),
      autoSpamSpfFail: syncInfoFlag(values.get('mail_security_auto_spam_spf_fail'), false),
      autoSpamRspamd: syncInfoFlag(values.get('mail_security_auto_spam_rspamd'), false),
      senderWhitelist: values.get('workflow_sender_whitelist') ?? '',
      senderBlacklist: values.get('workflow_sender_blacklist') ?? '',
      spamScoreThreshold: syncInfoBoundedInt(values.get('workflow_spam_score_threshold'), 70, 1, 100),
      spamEngineEnabled: syncInfoFlag(values.get('mail_security_spam_engine_enabled'), true),
      spamReviewThreshold,
      spamSpamThreshold: Math.max(
        spamReviewThreshold,
        syncInfoBoundedInt(values.get('mail_security_spam_spam_threshold'), 75, 0, 100),
      ),
      localLearningEnabled: syncInfoFlag(values.get('mail_security_spam_local_learning_enabled'), true),
      rspamdContributionEnabled: syncInfoFlag(
        values.get('mail_security_spam_rspamd_contribution_enabled'),
        rspamdEnabled,
      ),
      rspamdLearningEnabled: syncInfoFlag(values.get('mail_security_spam_rspamd_learning_enabled'), false),
      aiSpamWorkflowEnabled: syncInfoFlag(values.get('mail_security_spam_ai_workflow_enabled'), false),
    });
  }

  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const parsed = parseMailSecuritySettingsBody(req.body);
  if (!parsed.ok) return parsed.response;
  const saved = await saveSyncInfo(req, ports, parsed.values, 'email_settings.security.updated', 'email.settings.security');
  if ('status' in saved) return saved;
  return data(200, { success: true });
}

async function handleRspamdConnectionTest(req: ApiRequest): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const parsed = parseRspamdConnectionTestBody(req.body);
  if (!parsed.ok) return parsed.response;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), parsed.values.rspamdTimeoutMs);
  try {
    const response = await fetch(`${parsed.values.rspamdUrl}/stat`, { signal: controller.signal });
    if (!response.ok) return data(200, { success: false, error: `HTTP ${response.status}` });
    return data(200, {
      success: true,
      message: `Rspamd erreichbar (${parsed.values.rspamdUrl})`,
    });
  } catch (e) {
    return data(200, {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    clearTimeout(timer);
  }
}


async function handleAccountMailSettings(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailAccountMailSettings) return error(503, 'account_mail_settings_unavailable', 'Account-Mail-Settings API nicht konfiguriert');

  if (req.method === 'GET') {
    const accountId = parseOptionalPositiveInt(req.query?.accountId);
    if (accountId == null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
    const settings = await ports.emailAccountMailSettings.get({
      workspaceId: principal.workspaceId,
      accountId,
    });
    return data(200, settings ?? {
      accountId,
      ticketPrefix: `ACC${accountId}`,
      ticketNextNumber: 1,
      ticketNumberPadding: 6,
      threadNamespace: `account-${accountId}`,
      updatedAt: null,
    });
  }

  if (req.method === 'PATCH') {
    const parsed = parseAccountMailSettingsPayload(req.body);
    if (!parsed.ok) return parsed.response;
    const settings = await ports.emailAccountMailSettings.set({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      values: parsed.values,
    });
    return data(200, settings);
  }

  return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeNullableBodyText(value: unknown, field: string, maxLength: number): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, message: `${field} muss ein String sein` };
  const text = value.trim();
  if (text.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value: text || null };
}

type AccountMailSettingsPayloadParseResult =
  | { ok: true; values: EmailAccountMailSettingsMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

function parseAccountMailSettingsPayload(body: unknown): AccountMailSettingsPayloadParseResult {
  if (!isPlainObject(body)) return { ok: false, response: error(400, 'invalid_account_mail_settings_payload', 'Account-Mail-Settings payload muss ein JSON-Objekt sein') };
  const accountId = parseOptionalPositiveInt(body.accountId);
  if (accountId == null) return { ok: false, response: error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein') };
  const values: EmailAccountMailSettingsMutationInput = { accountId };
  if (Object.prototype.hasOwnProperty.call(body, 'ticketPrefix')) {
    const value = normalizeNullableBodyText(body.ticketPrefix, 'ticketPrefix', 12);
    if (!value.ok || value.value == null) return { ok: false, response: error(400, 'invalid_ticket_prefix', 'ticketPrefix ist ungueltig') };
    values.ticketPrefix = value.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'ticketNextNumber')) {
    const value = parseOptionalPositiveInt(body.ticketNextNumber);
    if (value == null) return { ok: false, response: error(400, 'invalid_ticket_next_number', 'ticketNextNumber muss eine positive Ganzzahl sein') };
    values.ticketNextNumber = value;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'ticketNumberPadding')) {
    const value = parseOptionalPositiveInt(body.ticketNumberPadding);
    if (value == null) return { ok: false, response: error(400, 'invalid_ticket_number_padding', 'ticketNumberPadding muss eine positive Ganzzahl sein') };
    values.ticketNumberPadding = value;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'threadNamespace')) {
    const value = normalizeNullableBodyText(body.threadNamespace, 'threadNamespace', 200);
    if (!value.ok || value.value == null) return { ok: false, response: error(400, 'invalid_thread_namespace', 'threadNamespace ist ungueltig') };
    values.threadNamespace = value.value;
  }
  return { ok: true, values };
}

async function handleSnoozeSettings(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method === 'GET') {
    const loaded = await loadSyncInfo(req, ports, [SNOOZE_SETTINGS_KEY]);
    if ('status' in loaded) return loaded;
    return data(200, parseSnoozeSettingsJson(loaded.values.get(SNOOZE_SETTINGS_KEY)));
  }

  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const parsed = parseSnoozeSettingsBody(req.body);
  if (!parsed.ok) return parsed.response;
  const saved = await saveSyncInfo(
    req,
    ports,
    { [SNOOZE_SETTINGS_KEY]: serializeSnoozeSettings(parsed.values) },
    'email_settings.snooze.updated',
    'email.settings.snooze',
  );
  if ('status' in saved) return saved;
  return data(200, { success: true });
}

async function handleReplySuggestionSettings(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method === 'GET') {
    const accountId = parseOptionalPositiveInt(req.query?.accountId);
    if (accountId === null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
    const keys = replySuggestionReadKeys(accountId);
    const loaded = await loadSyncInfo(req, ports, keys);
    if ('status' in loaded) return loaded;
    return data(200, replySuggestionSettingsFromValues(loaded.values, accountId));
  }

  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const parsed = parseReplySuggestionSettingsBody(req.body);
  if (!parsed.ok) return parsed.response;
  const loaded = await loadSyncInfo(req, ports, replySuggestionReadKeys(parsed.accountId));
  if ('status' in loaded) return loaded;
  const next = normalizeReplySuggestionSettings({
    ...replySuggestionSettingsFromValues(loaded.values, parsed.accountId),
    ...parsed.values,
  });
  const saved = await saveSyncInfo(
    req,
    ports,
    replySuggestionWriteValues(next, parsed.accountId),
    'email_settings.reply_suggestion.updated',
    parsed.accountId === undefined
      ? 'email.settings.reply_suggestion'
      : `email.settings.reply_suggestion.account.${parsed.accountId}`,
  );
  if ('status' in saved) return saved;
  return data(200, next);
}

async function handleMssqlSettings(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.mssqlSettings) return error(503, 'mssql_settings_unavailable', 'MSSQL Settings API nicht konfiguriert');

  if (req.method === 'GET') {
    const settings = await ports.mssqlSettings.getSettings({ workspaceId: principal.workspaceId });
    return data(200, settings);
  }

  if (req.method !== 'PATCH') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  const parsed = parseMssqlSettingsBody(req.body);
  if (!parsed.ok) return parsed.response;
  const result = await ports.mssqlSettings.saveSettings({
    workspaceId: principal.workspaceId,
    settings: parsed.values,
  });
  if (result.success) {
    await ports.audit?.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      action: 'mssql_settings.updated',
      entityType: 'sync_info',
      entityId: 'mssql.settings',
      metadata: {
        keys: Object.keys(parsed.values).filter((key) => key !== 'password'),
        passwordChanged: Object.prototype.hasOwnProperty.call(parsed.values, 'password'),
      },
    });
  }
  return data(200, result);
}

async function handleMssqlConnectionTest(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.mssqlSettings) return error(503, 'mssql_settings_unavailable', 'MSSQL Settings API nicht konfiguriert');
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

  if (req.body === undefined || req.body === null) {
    return data(200, await ports.mssqlSettings.testConnection({ workspaceId: principal.workspaceId }));
  }
  const parsed = parseMssqlSettingsBody(req.body);
  if (!parsed.ok) return parsed.response;
  return data(200, await ports.mssqlSettings.testConnection({
    workspaceId: principal.workspaceId,
    settings: parsed.values,
  }));
}

async function handleMssqlPassword(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.mssqlSettings) return error(503, 'mssql_settings_unavailable', 'MSSQL Settings API nicht konfiguriert');
  if (req.method !== 'DELETE') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');

  const result = await ports.mssqlSettings.clearPassword({ workspaceId: principal.workspaceId });
  if (result.success) {
    await ports.audit?.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      action: 'mssql_settings.password_cleared',
      entityType: 'sync_info',
      entityId: 'mssql.settings',
      metadata: { passwordChanged: true },
    });
  }
  return data(200, result);
}

async function loadSyncInfo(
  req: ApiRequest,
  ports: ServerApiPorts,
  keys: readonly string[],
): Promise<{ principal: { userId: string; workspaceId: string }; values: Map<string, string | null> } | ApiResponse<ApiErrorBody>> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.syncInfo) return error(503, 'sync_info_unavailable', 'Sync-info API nicht konfiguriert');
  const rows = await ports.syncInfo.getMany({ workspaceId: principal.workspaceId, keys });
  return {
    principal,
    values: syncInfoMap(rows),
  };
}

async function saveSyncInfo(
  req: ApiRequest,
  ports: ServerApiPorts,
  values: Record<string, string | null>,
  auditAction: string,
  auditEntityId: string,
): Promise<{ success: true } | ApiResponse<ApiErrorBody>> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.syncInfo) return error(503, 'sync_info_unavailable', 'Sync-info API nicht konfiguriert');
  await ports.syncInfo.setMany({ workspaceId: principal.workspaceId, values });
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: auditAction,
    entityType: 'sync_info',
    entityId: auditEntityId,
    metadata: { keys: Object.keys(values) },
  });
  return { success: true };
}

function parseWorkflowAutomationSettingsBody(body: unknown): SettingsPayloadParseResult {
  const payload = settingsPayloadObject(body, 'invalid_workflow_automation_settings_payload', 'Workflow automation settings payload muss ein JSON-Objekt sein');
  if (!payload.ok) return payload;
  const allowed = new Set(['imapDeleteOptIn', 'httpAllowlist', 'senderWhitelist', 'senderBlacklist', 'spamScoreThreshold']);
  const errors = unknownFieldErrors(payload.value, allowed);
  const values: Record<string, string | null> = {};

  if ('imapDeleteOptIn' in payload.value) {
    const value = payload.value.imapDeleteOptIn;
    if (typeof value !== 'boolean') errors.push({ field: 'imapDeleteOptIn', message: 'imapDeleteOptIn muss ein Boolean sein' });
    else values.workflow_imap_delete_opt_in = value ? 'true' : 'false';
  }
  if ('httpAllowlist' in payload.value) {
    addTrimmedTextValue(values, errors, payload.value.httpAllowlist, 'httpAllowlist', 'workflow_http_allowlist', 10000);
  }
  if ('senderWhitelist' in payload.value) {
    addTrimmedTextValue(values, errors, payload.value.senderWhitelist, 'senderWhitelist', 'workflow_sender_whitelist', 10000);
  }
  if ('senderBlacklist' in payload.value) {
    addTrimmedTextValue(values, errors, payload.value.senderBlacklist, 'senderBlacklist', 'workflow_sender_blacklist', 10000);
  }
  if ('spamScoreThreshold' in payload.value) {
    const normalized = normalizedBoundedNumberText(payload.value.spamScoreThreshold, 1, 100, true);
    if (normalized === null) errors.push({ field: 'spamScoreThreshold', message: 'spamScoreThreshold muss eine Zahl zwischen 1 und 100 sein' });
    else values.workflow_spam_score_threshold = normalized;
  }

  return settingsParseResult(values, errors, 'Workflow automation settings payload braucht mindestens ein Feld');
}

function parseEmailMiscSettingsBody(body: unknown): SettingsPayloadParseResult {
  const payload = settingsPayloadObject(body, 'invalid_email_misc_settings_payload', 'Email misc settings payload muss ein JSON-Objekt sein');
  if (!payload.ok) return payload;
  const allowed = new Set(['webhookSecret', 'maxAttachmentMb']);
  const errors = unknownFieldErrors(payload.value, allowed);
  const values: Record<string, string | null> = {};

  if ('webhookSecret' in payload.value) {
    addTrimmedTextValue(values, errors, payload.value.webhookSecret, 'webhookSecret', 'email_webhook_secret', 2000);
  }
  if ('maxAttachmentMb' in payload.value) {
    const normalized = normalizedBoundedNumberText(payload.value.maxAttachmentMb, 1, 1000, true);
    if (normalized === null) errors.push({ field: 'maxAttachmentMb', message: 'maxAttachmentMb muss eine positive Ganzzahl sein' });
    else values.email_max_attachment_mb = normalized;
  }

  return settingsParseResult(values, errors, 'Email misc settings payload braucht mindestens ein Feld');
}

function parseMailSecuritySettingsBody(body: unknown): SettingsPayloadParseResult {
  const payload = settingsPayloadObject(body, 'invalid_mail_security_settings_payload', 'Mail security settings payload muss ein JSON-Objekt sein');
  if (!payload.ok) return payload;
  const booleanFields: Record<string, string> = {
    mailauthEnabled: 'mail_security_mailauth_enabled',
    rspamdEnabled: 'mail_security_rspamd_enabled',
    autoSpamDmarcFail: 'mail_security_auto_spam_dmarc_fail',
    autoSpamSpfFail: 'mail_security_auto_spam_spf_fail',
    autoSpamRspamd: 'mail_security_auto_spam_rspamd',
    spamEngineEnabled: 'mail_security_spam_engine_enabled',
    localLearningEnabled: 'mail_security_spam_local_learning_enabled',
    rspamdContributionEnabled: 'mail_security_spam_rspamd_contribution_enabled',
    rspamdLearningEnabled: 'mail_security_spam_rspamd_learning_enabled',
    aiSpamWorkflowEnabled: 'mail_security_spam_ai_workflow_enabled',
  };
  const textFields: Record<string, { key: string; maxLength: number }> = {
    senderWhitelist: { key: 'workflow_sender_whitelist', maxLength: 10000 },
    senderBlacklist: { key: 'workflow_sender_blacklist', maxLength: 10000 },
  };
  const numberFields: Record<string, { key: string; min: number; max: number; integer: boolean }> = {
    rspamdTimeoutMs: { key: 'mail_security_rspamd_timeout_ms', min: 1000, max: 60000, integer: true },
    rspamdSpamScore: { key: 'mail_security_rspamd_spam_score', min: 1, max: 100, integer: false },
    spamScoreThreshold: { key: 'workflow_spam_score_threshold', min: 1, max: 100, integer: true },
    spamReviewThreshold: { key: 'mail_security_spam_review_threshold', min: 0, max: 100, integer: true },
    spamSpamThreshold: { key: 'mail_security_spam_spam_threshold', min: 0, max: 100, integer: true },
  };
  const allowed = new Set([
    ...Object.keys(booleanFields),
    ...Object.keys(textFields),
    ...Object.keys(numberFields),
    'rspamdUrl',
  ]);
  const errors = unknownFieldErrors(payload.value, allowed);
  const values: Record<string, string | null> = {};

  for (const [field, key] of Object.entries(booleanFields)) {
    if (!(field in payload.value)) continue;
    const value = payload.value[field];
    if (typeof value !== 'boolean') errors.push({ field, message: `${field} muss ein Boolean sein` });
    else values[key] = value ? '1' : '0';
  }

  for (const [field, config] of Object.entries(textFields)) {
    if (field in payload.value) addTrimmedTextValue(values, errors, payload.value[field], field, config.key, config.maxLength);
  }

  for (const [field, config] of Object.entries(numberFields)) {
    if (!(field in payload.value)) continue;
    const normalized = normalizedBoundedNumberText(payload.value[field], config.min, config.max, config.integer);
    if (normalized === null) errors.push({ field, message: `${field} muss eine Zahl zwischen ${config.min} und ${config.max} sein` });
    else values[config.key] = normalized;
  }

  if ('rspamdUrl' in payload.value) {
    if (typeof payload.value.rspamdUrl !== 'string') {
      errors.push({ field: 'rspamdUrl', message: 'rspamdUrl muss ein String sein' });
    } else {
      const url = payload.value.rspamdUrl.trim().replace(/\/$/, '') || 'http://127.0.0.1:11333';
      if (url.length > 500) errors.push({ field: 'rspamdUrl', message: 'rspamdUrl darf maximal 500 Zeichen haben' });
      else values.mail_security_rspamd_url = url;
    }
  }

  return settingsParseResult(values, errors, 'Mail security settings payload braucht mindestens ein Feld');
}

function parseRspamdConnectionTestBody(
  body: unknown,
): { ok: true; values: RspamdConnectionTestInput } | { ok: false; response: ApiResponse<ApiErrorBody> } {
  const payload = settingsPayloadObject(body, 'invalid_rspamd_test_payload', 'Rspamd test payload muss ein JSON-Objekt sein');
  if (!payload.ok) return payload;
  const errors = unknownFieldErrors(payload.value, new Set(['rspamdUrl', 'rspamdTimeoutMs']));

  let rspamdUrl = DEFAULT_RSPAMD_URL;
  if ('rspamdUrl' in payload.value) {
    if (typeof payload.value.rspamdUrl !== 'string') {
      errors.push({ field: 'rspamdUrl', message: 'rspamdUrl muss ein String sein' });
    } else {
      const normalized = normalizeHttpUrl(payload.value.rspamdUrl, DEFAULT_RSPAMD_URL, 500);
      if (normalized === null) errors.push({ field: 'rspamdUrl', message: 'rspamdUrl muss eine gueltige HTTP(S)-URL mit maximal 500 Zeichen sein' });
      else rspamdUrl = normalized;
    }
  }

  let rspamdTimeoutMs = DEFAULT_RSPAMD_TIMEOUT_MS;
  if ('rspamdTimeoutMs' in payload.value) {
    const normalized = normalizedBoundedNumberText(
      payload.value.rspamdTimeoutMs,
      MIN_RSPAMD_TIMEOUT_MS,
      MAX_RSPAMD_TIMEOUT_MS,
      true,
    );
    if (normalized === null) {
      errors.push({
        field: 'rspamdTimeoutMs',
        message: `rspamdTimeoutMs muss eine Ganzzahl zwischen ${MIN_RSPAMD_TIMEOUT_MS} und ${MAX_RSPAMD_TIMEOUT_MS} sein`,
      });
    } else {
      rspamdTimeoutMs = Number.parseInt(normalized, 10);
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Rspamd test payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, values: { rspamdUrl, rspamdTimeoutMs } };
}

function parseSnoozeSettingsBody(body: unknown): { ok: true; values: SnoozeSettings } | { ok: false; response: ApiResponse<ApiErrorBody> } {
  const payload = settingsPayloadObject(body, 'invalid_snooze_settings_payload', 'Snooze settings payload muss ein JSON-Objekt sein');
  if (!payload.ok) return payload;
  const allowed = new Set([
    'eveningHour',
    'eveningMinute',
    'morningHour',
    'morningMinute',
    'nextWeekWeekday',
    'nextWeekHour',
    'nextWeekMinute',
  ]);
  const errors = unknownFieldErrors(payload.value, allowed);
  const values = {
    eveningHour: parseBoundedIntegerField(payload.value, errors, 'eveningHour', 0, 23),
    eveningMinute: parseBoundedIntegerField(payload.value, errors, 'eveningMinute', 0, 59),
    morningHour: parseBoundedIntegerField(payload.value, errors, 'morningHour', 0, 23),
    morningMinute: parseBoundedIntegerField(payload.value, errors, 'morningMinute', 0, 59),
    nextWeekWeekday: parseBoundedIntegerField(payload.value, errors, 'nextWeekWeekday', 0, 6),
    nextWeekHour: parseBoundedIntegerField(payload.value, errors, 'nextWeekHour', 0, 23),
    nextWeekMinute: parseBoundedIntegerField(payload.value, errors, 'nextWeekMinute', 0, 59),
  };
  const missing = Object.entries(values)
    .filter(([, value]) => value === undefined)
    .map(([field]) => field);
  for (const field of missing) {
    errors.push({ field, message: `${field} ist erforderlich` });
  }
  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Snooze settings payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, values: values as SnoozeSettings };
}

function parseReplySuggestionSettingsBody(body: unknown): ReplySuggestionPayloadParseResult {
  const payload = settingsPayloadObject(body, 'invalid_reply_suggestion_settings_payload', 'Reply suggestion settings payload muss ein JSON-Objekt sein');
  if (!payload.ok) return payload;
  const allowed = new Set([
    'accountId',
    'autoEnabled',
    'triggerOnInbound',
    'triggerOnOpen',
    'categoryMode',
    'categoryIds',
  ]);
  const errors = unknownFieldErrors(payload.value, allowed);
  const values: Partial<ReplySuggestionSettings> = {};
  const accountId = parseOptionalPositiveInt(payload.value.accountId);
  if (accountId === null) errors.push({ field: 'accountId', message: 'accountId muss eine positive Ganzzahl sein' });

  for (const field of ['autoEnabled', 'triggerOnInbound', 'triggerOnOpen'] as const) {
    if (!(field in payload.value)) continue;
    const value = payload.value[field];
    if (typeof value !== 'boolean') errors.push({ field, message: `${field} muss ein Boolean sein` });
    else values[field] = value;
  }

  if ('categoryMode' in payload.value) {
    const mode = payload.value.categoryMode;
    if (mode !== 'any' && mode !== 'only_listed') {
      errors.push({ field: 'categoryMode', message: 'categoryMode ist ungueltig' });
    } else {
      values.categoryMode = mode;
    }
  }

  if ('categoryIds' in payload.value) {
    if (!Array.isArray(payload.value.categoryIds)) {
      errors.push({ field: 'categoryIds', message: 'categoryIds muss ein Array sein' });
    } else {
      const ids: number[] = [];
      for (const item of payload.value.categoryIds) {
        const id = typeof item === 'number' ? item : Number(item);
        if (!Number.isSafeInteger(id) || id <= 0) {
          errors.push({ field: 'categoryIds', message: 'categoryIds darf nur positive Ganzzahlen enthalten' });
          break;
        }
        if (!ids.includes(id)) ids.push(id);
      }
      if (ids.length > 500) errors.push({ field: 'categoryIds', message: 'categoryIds darf maximal 500 Eintraege enthalten' });
      values.categoryIds = ids;
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Reply suggestion settings payload ist ungueltig', { fields: errors }),
    };
  }
  if (Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Reply suggestion settings payload braucht mindestens ein Feld'),
    };
  }
  return {
    ok: true,
    ...(accountId === undefined || accountId === null ? {} : { accountId }),
    values,
  };
}

function parseMssqlSettingsBody(body: unknown): MssqlSettingsPayloadParseResult {
  const payload = settingsPayloadObject(body, 'invalid_mssql_settings_payload', 'MSSQL settings payload muss ein JSON-Objekt sein');
  if (!payload.ok) return payload;
  const allowed = new Set([
    'server',
    'database',
    'user',
    'password',
    'port',
    'encrypt',
    'trustServerCertificate',
    'forcePort',
    'kBenutzer',
    'kShop',
    'kPlattform',
    'kSprache',
    'cWaehrung',
    'fWaehrungFaktor',
    'hasPassword',
  ]);
  const errors = unknownFieldErrors(payload.value, allowed);
  const values: MssqlSettingsInput = {
    server: '',
    database: '',
  };

  addRequiredMssqlText(values, errors, payload.value, 'server', 500);
  addRequiredMssqlText(values, errors, payload.value, 'database', 500);
  addRequiredMssqlText(values, errors, payload.value, 'user', 500);

  if ('password' in payload.value) {
    const password = payload.value.password;
    if (password !== null && typeof password !== 'string') {
      errors.push({ field: 'password', message: 'password muss ein String sein' });
    } else if (typeof password === 'string' && password.length > 4000) {
      errors.push({ field: 'password', message: 'password darf maximal 4000 Zeichen haben' });
    } else {
      values.password = password;
    }
  }

  const port = parseOptionalBoundedNumber(payload.value.port, 1, 65535, true);
  if (port === null) errors.push({ field: 'port', message: 'port muss eine Ganzzahl zwischen 1 und 65535 sein' });
  else if (port !== undefined) values.port = port;

  for (const field of ['encrypt', 'trustServerCertificate', 'forcePort'] as const) {
    if (!(field in payload.value)) continue;
    if (typeof payload.value[field] !== 'boolean') errors.push({ field, message: `${field} muss ein Boolean sein` });
    else values[field] = payload.value[field];
  }

  for (const field of ['kBenutzer', 'kShop', 'kPlattform', 'kSprache'] as const) {
    const value = parseOptionalBoundedNumber(payload.value[field], 1, Number.MAX_SAFE_INTEGER, true);
    if (value === null) errors.push({ field, message: `${field} muss eine positive Ganzzahl sein` });
    else if (value !== undefined) values[field] = value;
  }

  if ('cWaehrung' in payload.value) {
    const value = payload.value.cWaehrung;
    if (value !== undefined && value !== null && value !== '') {
      if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) {
        errors.push({ field: 'cWaehrung', message: 'cWaehrung muss ein ISO-Waehrungscode mit drei Buchstaben sein' });
      } else {
        values.cWaehrung = value.trim().toUpperCase();
      }
    }
  }

  const factor = parseOptionalBoundedNumber(payload.value.fWaehrungFaktor, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, false);
  if (factor === null) errors.push({ field: 'fWaehrungFaktor', message: 'fWaehrungFaktor muss eine positive Zahl sein' });
  else if (factor !== undefined) values.fWaehrungFaktor = factor;

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'MSSQL settings payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, values };
}

function addRequiredMssqlText(
  values: MssqlSettingsInput,
  errors: ValidationFieldError[],
  payload: Record<string, unknown>,
  field: 'server' | 'database' | 'user',
  maxLength: number,
): void {
  const value = payload[field];
  if (typeof value !== 'string' || !value.trim()) {
    errors.push({ field, message: `${field} ist erforderlich` });
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    errors.push({ field, message: `${field} darf maximal ${maxLength} Zeichen haben` });
    return;
  }
  values[field] = trimmed;
}

function settingsPayloadObject(
  body: unknown,
  code: string,
  message: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; response: ApiResponse<ApiErrorBody> } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, response: error(400, code, message) };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

function parseSyncInfoPathKey(raw: string): SyncInfoKeyParseResult {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { ok: false, response: error(400, 'invalid_sync_info_key', 'Sync-info key ist ungueltig') };
  }

  const key = decoded.trim();
  if (!key || key.length > 200) {
    return {
      ok: false,
      response: error(400, 'invalid_sync_info_key', 'Sync-info key muss 1 bis 200 Zeichen haben'),
    };
  }
  return { ok: true, key };
}

function parseGenericSyncInfoBody(body: unknown): GenericSyncInfoValueParseResult {
  const payload = settingsPayloadObject(
    body,
    'invalid_sync_info_payload',
    'Sync-info payload muss ein JSON-Objekt sein',
  );
  if (!payload.ok) return payload;

  const unknown = unknownFieldErrors(payload.value, new Set(['value']));
  if (unknown.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Sync-info payload ist ungueltig', { fields: unknown }),
    };
  }

  const value = payload.value.value;
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Sync-info payload ist ungueltig', {
        fields: [{ field: 'value', message: 'value muss ein String oder null sein' }],
      }),
    };
  }
  if (value.length > 10000) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Sync-info payload ist ungueltig', {
        fields: [{ field: 'value', message: 'value darf maximal 10000 Zeichen haben' }],
      }),
    };
  }
  return { ok: true, value };
}

function unknownFieldErrors(payload: Record<string, unknown>, allowed: Set<string>): ValidationFieldError[] {
  return Object.keys(payload)
    .filter((field) => !allowed.has(field))
    .map((field) => ({ field, message: 'Feld ist nicht erlaubt' }));
}

function addTrimmedTextValue(
  values: Record<string, string | null>,
  errors: ValidationFieldError[],
  value: unknown,
  field: string,
  key: string,
  maxLength: number,
): void {
  if (typeof value !== 'string') {
    errors.push({ field, message: `${field} muss ein String sein` });
    return;
  }
  const text = value.trim();
  if (text.length > maxLength) {
    errors.push({ field, message: `${field} darf maximal ${maxLength} Zeichen haben` });
    return;
  }
  values[key] = text;
}

function settingsParseResult(
  values: Record<string, string | null>,
  errors: ValidationFieldError[],
  emptyMessage: string,
): SettingsPayloadParseResult {
  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Settings payload ist ungueltig', { fields: errors }),
    };
  }
  if (Object.keys(values).length === 0) {
    return { ok: false, response: error(400, 'validation_error', emptyMessage) };
  }
  return { ok: true, values };
}

function syncInfoMap(rows: readonly SyncInfoRecord[]): Map<string, string | null> {
  return new Map(rows.map((row) => [row.key, row.value]));
}

function syncInfoFlag(value: string | null | undefined, defaultOn: boolean): boolean {
  if (value == null || value === '') return defaultOn;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function syncInfoBoundedInt(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function syncInfoBoundedFloat(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function syncInfoUrl(value: string | null | undefined, fallback: string): string {
  return value?.trim().replace(/\/$/, '') || fallback;
}

function normalizeHttpUrl(value: string, fallback: string, maxLength: number): string | null {
  const normalized = value.trim().replace(/\/+$/, '') || fallback;
  if (normalized.length > maxLength) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return normalized;
  } catch {
    return null;
  }
}

function normalizedBoundedNumberText(
  value: unknown,
  min: number,
  max: number,
  integer: boolean,
): string | null {
  const raw = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(raw)) return null;
  const bounded = Math.max(min, Math.min(max, integer ? Math.floor(raw) : raw));
  return String(bounded);
}

function parseOptionalPositiveInt(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseOptionalBoundedNumber(
  value: unknown,
  min: number,
  max: number,
  integer: boolean,
): number | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = integer ? Math.floor(parsed) : parsed;
  if (normalized < min || normalized > max) return null;
  return normalized;
}

function parseBoundedIntegerField(
  payload: Record<string, unknown>,
  errors: ValidationFieldError[],
  field: string,
  min: number,
  max: number,
): number | undefined {
  if (!(field in payload)) return undefined;
  const value = payload[field];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    errors.push({ field, message: `${field} muss eine Zahl sein` });
    return undefined;
  }
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    errors.push({ field, message: `${field} muss eine Ganzzahl zwischen ${min} und ${max} sein` });
    return undefined;
  }
  return parsed;
}

function parseSnoozeSettingsJson(raw: string | null | undefined): SnoozeSettings {
  if (!raw?.trim()) return { ...DEFAULT_SNOOZE_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<SnoozeSettings>;
    return serializeRoundTripSnoozeSettings(parsed);
  } catch {
    return { ...DEFAULT_SNOOZE_SETTINGS };
  }
}

function serializeSnoozeSettings(settings: SnoozeSettings): string {
  return JSON.stringify(serializeRoundTripSnoozeSettings(settings));
}

function serializeRoundTripSnoozeSettings(settings: Partial<SnoozeSettings>): SnoozeSettings {
  return {
    eveningHour: clampNumber(settings.eveningHour, DEFAULT_SNOOZE_SETTINGS.eveningHour, 0, 23),
    eveningMinute: clampNumber(settings.eveningMinute, DEFAULT_SNOOZE_SETTINGS.eveningMinute, 0, 59),
    morningHour: clampNumber(settings.morningHour, DEFAULT_SNOOZE_SETTINGS.morningHour, 0, 23),
    morningMinute: clampNumber(settings.morningMinute, DEFAULT_SNOOZE_SETTINGS.morningMinute, 0, 59),
    nextWeekWeekday: clampNumber(settings.nextWeekWeekday, DEFAULT_SNOOZE_SETTINGS.nextWeekWeekday, 0, 6),
    nextWeekHour: clampNumber(settings.nextWeekHour, DEFAULT_SNOOZE_SETTINGS.nextWeekHour, 0, 23),
    nextWeekMinute: clampNumber(settings.nextWeekMinute, DEFAULT_SNOOZE_SETTINGS.nextWeekMinute, 0, 59),
  };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function replySuggestionScopedKey(base: string, accountId?: number): string {
  return accountId === undefined ? base : `${base}@${accountId}`;
}

function replySuggestionReadKeys(accountId?: number): string[] {
  if (accountId === undefined) return [...REPLY_SUGGESTION_KEYS];
  return [
    ...REPLY_SUGGESTION_KEYS,
    ...REPLY_SUGGESTION_KEYS.map((key) => replySuggestionScopedKey(key, accountId)),
  ];
}

function replySuggestionSettingsFromValues(
  values: Map<string, string | null>,
  accountId?: number,
): ReplySuggestionSettings {
  const defaults = DEFAULT_REPLY_SUGGESTION_SETTINGS;
  const readValue = (key: string): string | null | undefined => {
    if (accountId !== undefined) {
      const scoped = values.get(replySuggestionScopedKey(key, accountId));
      if (scoped !== null && scoped !== undefined && scoped !== '') return scoped;
    }
    return values.get(key);
  };
  return normalizeReplySuggestionSettings({
    autoEnabled: syncInfoFlag(readValue('reply_suggestion_auto_enabled'), defaults.autoEnabled),
    triggerOnInbound: syncInfoFlag(readValue('reply_suggestion_trigger_inbound'), defaults.triggerOnInbound),
    triggerOnOpen: syncInfoFlag(readValue('reply_suggestion_trigger_on_open'), defaults.triggerOnOpen),
    categoryMode: readValue('reply_suggestion_category_mode') === 'only_listed' ? 'only_listed' : 'any',
    categoryIds: parseReplySuggestionCategoryIds(readValue('reply_suggestion_category_ids')),
  });
}

function replySuggestionWriteValues(
  settings: ReplySuggestionSettings,
  accountId?: number,
): Record<string, string | null> {
  return {
    [replySuggestionScopedKey('reply_suggestion_auto_enabled', accountId)]: settings.autoEnabled ? '1' : '0',
    [replySuggestionScopedKey('reply_suggestion_trigger_inbound', accountId)]: settings.triggerOnInbound ? '1' : '0',
    [replySuggestionScopedKey('reply_suggestion_trigger_on_open', accountId)]: settings.triggerOnOpen ? '1' : '0',
    [replySuggestionScopedKey('reply_suggestion_category_mode', accountId)]: settings.categoryMode,
    [replySuggestionScopedKey('reply_suggestion_category_ids', accountId)]: JSON.stringify(settings.categoryIds),
  };
}

function normalizeReplySuggestionSettings(
  partial: Partial<ReplySuggestionSettings> | null | undefined,
): ReplySuggestionSettings {
  const base = DEFAULT_REPLY_SUGGESTION_SETTINGS;
  if (!partial) return { ...base };
  return {
    autoEnabled: partial.autoEnabled ?? base.autoEnabled,
    triggerOnInbound: partial.triggerOnInbound ?? base.triggerOnInbound,
    triggerOnOpen: partial.triggerOnOpen ?? base.triggerOnOpen,
    categoryMode: partial.categoryMode === 'only_listed' ? 'only_listed' : 'any',
    categoryIds: Array.isArray(partial.categoryIds)
      ? partial.categoryIds
        .map((id) => Number(id))
        .filter((id) => Number.isSafeInteger(id) && id > 0)
      : [...base.categoryIds],
  };
}

function parseReplySuggestionCategoryIds(raw: string | null | undefined): number[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
  } catch {
    return [];
  }
}
