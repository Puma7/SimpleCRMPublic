export type ServerEditionEnv = {
  DATABASE_URL?: string;
  SIMPLECRM_MASTER_KEY?: string;
  ACCESS_TOKEN_SECRET?: string;
  ACCESS_TOKEN_KEY_ID?: string;
  PUBLIC_BASE_URL?: string;
  CORS_ALLOWED_ORIGINS?: string;
  TRUST_PROXY?: string;
  AUTH_INVITE_FROM?: string;
  AUTH_INVITE_SMTP_HOST?: string;
  AUTH_INVITE_SMTP_PORT?: string;
  AUTH_INVITE_SMTP_TLS?: string;
  AUTH_INVITE_SMTP_USER?: string;
  AUTH_INVITE_SMTP_PASSWORD?: string;
  AUTH_INVITE_SMTP_TIMEOUT_MS?: string;
  ATTACHMENTS_DIR?: string;
  AUDIT_ARCHIVE_DIR?: string;
  BACKUP_DIR?: string;
  VERSION?: string;
  HOST?: string;
  PORT?: string;
  JOB_WORKER_ENABLED?: string;
  JOB_WORKER_MAIL_ACCOUNT_COUNT?: string;
  JOB_WORKER_AI_CONCURRENCY?: string;
  JOB_WORKER_MIGRATE_ON_START?: string;
  JOB_WEBHOOK_ALLOWLIST?: string;
  SERVER_LOG_FILE?: string;
  LOG_LEVEL?: string;
  NODE_ENV?: string;
  CI?: string;
  INITIAL_SETUP_TOKEN?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  SMTP_RELAY_ENABLED?: string;
  SMTP_RELAY_HOSTNAME?: string;
  SMTP_RELAY_PORT_SUBMISSION?: string;
  SMTP_RELAY_PORT_SMTPS?: string;
  SMTP_RELAY_BIND_HOST?: string;
  SMTP_RELAY_TLS_CERT_FILE?: string;
  SMTP_RELAY_TLS_KEY_FILE?: string;
  SMTP_RELAY_MAX_MESSAGE_BYTES?: string;
  SMTP_RELAY_MAX_CONNECTIONS?: string;
  SMTP_RELAY_SOCKET_TIMEOUT_MS?: string;
  GEOIP_COUNTRY_DB_PATH?: string;
  GEOIP_ASN_DB_PATH?: string;
};

export type ServerEditionConfig = {
  databaseUrl: string;
  masterKey: string;
  accessTokenSecret: string;
  accessTokenKeyId: string;
  publicBaseUrl: string;
  corsAllowedOrigins: readonly string[];
  authInvitationMail?: AuthInvitationMailConfig;
  attachmentsDir: string;
  auditArchiveDir?: string;
  host: string;
  port: number;
  jobWorker: ServerJobWorkerConfig;
  smtpRelay: SmtpRelayServerConfig;
  initialSetupToken?: string;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
  emailTrackingIpIntelligence: EmailTrackingIpIntelligenceConfig;
};

export type EmailTrackingIpIntelligenceConfig = Readonly<{
  countryDatabasePath: string | undefined;
  asnDatabasePath: string | undefined;
}>;

export type ServerJobWorkerConfig = {
  enabled: boolean;
  mailAccountCount: number;
  aiConcurrency?: number;
  migrateOnStart: boolean;
  webhookAllowlist?: string;
};

export type SmtpRelayServerConfig = {
  enabled: boolean;
  hostname?: string;
  portSubmission: number;
  portSmtps: number;
  bindHost: string;
  tlsCertFile?: string;
  tlsKeyFile?: string;
  maxMessageBytes: number;
  maxConnections: number;
  socketTimeoutMs: number;
};

export type AuthInvitationMailConfig = {
  publicBaseUrl: string;
  from: string;
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password: string;
  timeoutMs?: number;
};

export const SERVER_POSTGRES_MAJOR = 18;
export const SERVER_NODE_MAJOR = 22;
export const CI_SMOKE_MASTER_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';
export const CI_SMOKE_ACCESS_TOKEN_SECRET = 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=';
export const KNOWN_WEAK_CI_SMOKE_MASTER_KEYS = [
  CI_SMOKE_MASTER_KEY,
  'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
] as const;
export const KNOWN_WEAK_CI_SMOKE_ACCESS_TOKEN_SECRETS = [
  CI_SMOKE_ACCESS_TOKEN_SECRET,
  'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNERUY=',
] as const;

export function parseServerEditionConfig(env: ServerEditionEnv): ServerEditionConfig {
  const databaseUrl = requireEnv(env, 'DATABASE_URL');
  const masterKey = requireEnv(env, 'SIMPLECRM_MASTER_KEY');
  const accessTokenSecret = requireEnv(env, 'ACCESS_TOKEN_SECRET');
  assertNoKnownWeakProductionSecrets(env, masterKey, accessTokenSecret);
  const accessTokenKeyId = env.ACCESS_TOKEN_KEY_ID?.trim() || 'default';
  const publicBaseUrl = normalizePublicBaseUrl(requireEnv(env, 'PUBLIC_BASE_URL'));
  const corsAllowedOrigins = parseCorsAllowedOrigins({ ...env, PUBLIC_BASE_URL: publicBaseUrl });
  const authInvitationMail = parseAuthInvitationMailConfig({ ...env, PUBLIC_BASE_URL: publicBaseUrl });
  const attachmentsDir = env.ATTACHMENTS_DIR?.trim() || '/app/data/attachments';
  const auditArchiveDir = env.AUDIT_ARCHIVE_DIR?.trim() || undefined;
  const host = env.HOST?.trim() || '0.0.0.0';
  const port = parsePort(env.PORT ?? '3000');
  const jobWorker = parseServerJobWorkerConfig(env);
  const smtpRelay = parseSmtpRelayServerConfig(env);
  const initialSetupToken = env.INITIAL_SETUP_TOKEN?.trim() || undefined;
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY?.trim() || undefined;
  const turnstileSecretKey = env.TURNSTILE_SECRET_KEY?.trim() || undefined;
  const emailTrackingIpIntelligence = parseEmailTrackingIpIntelligenceConfig(env);

  return {
    databaseUrl,
    masterKey,
    accessTokenSecret,
    accessTokenKeyId,
    publicBaseUrl,
    corsAllowedOrigins,
    ...(authInvitationMail ? { authInvitationMail } : {}),
    attachmentsDir,
    ...(auditArchiveDir ? { auditArchiveDir } : {}),
    host,
    port,
    jobWorker,
    smtpRelay,
    ...(initialSetupToken ? { initialSetupToken } : {}),
    ...(turnstileSiteKey ? { turnstileSiteKey } : {}),
    ...(turnstileSecretKey ? { turnstileSecretKey } : {}),
    emailTrackingIpIntelligence,
  };
}

export function parseEmailTrackingIpIntelligenceConfig(
  env: Pick<ServerEditionEnv, 'GEOIP_COUNTRY_DB_PATH' | 'GEOIP_ASN_DB_PATH'>,
): EmailTrackingIpIntelligenceConfig {
  return {
    countryDatabasePath: env.GEOIP_COUNTRY_DB_PATH?.trim() || undefined,
    asnDatabasePath: env.GEOIP_ASN_DB_PATH?.trim() || undefined,
  };
}

export function assertNoKnownWeakProductionSecrets(
  env: ServerEditionEnv,
  masterKey: string | undefined,
  accessTokenSecret: string | undefined,
): void {
  // Run for anything that is not explicitly a dev/test/CI environment — in
  // particular when NODE_ENV is UNSET, which many container deployments leave
  // as-is. The previous `!== 'production'` early-return meant an operator who
  // copied the published CI smoke ACCESS_TOKEN_SECRET/SIMPLECRM_MASTER_KEY into
  // a real deployment without NODE_ENV=production booted with no warning — and
  // since those secrets are public source constants, anyone could forge tokens.
  const nodeEnv = env.NODE_ENV?.trim();
  if (nodeEnv === 'development' || nodeEnv === 'test' || env.CI?.trim() === 'true') return;
  if (isKnownWeakSecret(masterKey, KNOWN_WEAK_CI_SMOKE_MASTER_KEYS)) {
    throw new Error('SIMPLECRM_MASTER_KEY uses the known weak CI smoke-test value');
  }
  if (isKnownWeakSecret(accessTokenSecret, KNOWN_WEAK_CI_SMOKE_ACCESS_TOKEN_SECRETS)) {
    throw new Error('ACCESS_TOKEN_SECRET uses the known weak CI smoke-test value');
  }
}

function isKnownWeakSecret(value: string | undefined, knownWeakValues: readonly string[]): boolean {
  return value !== undefined && knownWeakValues.includes(value.trim());
}

export function parseAuthInvitationMailConfig(env: ServerEditionEnv): AuthInvitationMailConfig | undefined {
  const touched = [
    env.AUTH_INVITE_FROM,
    env.AUTH_INVITE_SMTP_HOST,
    env.AUTH_INVITE_SMTP_USER,
    env.AUTH_INVITE_SMTP_PASSWORD,
  ].some((value) => Boolean(value?.trim()));
  if (!touched) return undefined;

  const publicBaseUrl = normalizePublicBaseUrl(requireEnv(env, 'PUBLIC_BASE_URL'));
  const from = requireInviteMailValue(env.AUTH_INVITE_FROM, 'AUTH_INVITE_FROM');
  const host = requireInviteMailValue(env.AUTH_INVITE_SMTP_HOST, 'AUTH_INVITE_SMTP_HOST');
  const password = requireInviteMailValue(env.AUTH_INVITE_SMTP_PASSWORD, 'AUTH_INVITE_SMTP_PASSWORD');
  const user = sanitizeInviteMailValue(env.AUTH_INVITE_SMTP_USER?.trim() || from, 'AUTH_INVITE_SMTP_USER');
  const port = env.AUTH_INVITE_SMTP_PORT?.trim()
    ? parseIntegerEnv(env.AUTH_INVITE_SMTP_PORT, 587, 'AUTH_INVITE_SMTP_PORT', { min: 1, max: 65535 })
    : 587;
  const tls = parseBooleanEnv(env.AUTH_INVITE_SMTP_TLS, true, 'AUTH_INVITE_SMTP_TLS');
  const timeoutMs = env.AUTH_INVITE_SMTP_TIMEOUT_MS?.trim()
    ? parseIntegerEnv(env.AUTH_INVITE_SMTP_TIMEOUT_MS, 90_000, 'AUTH_INVITE_SMTP_TIMEOUT_MS', { min: 1_000 })
    : undefined;

  return {
    publicBaseUrl,
    from,
    host,
    port,
    tls,
    user,
    password,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function requireEnv(env: ServerEditionEnv, key: keyof ServerEditionEnv): string {
  const value = env[key];
  if (!value?.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

export function normalizePublicBaseUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('PUBLIC_BASE_URL must use http or https');
  }
  return url.toString().replace(/\/$/, '');
}

export function parseCorsAllowedOrigins(env: Pick<ServerEditionEnv, 'PUBLIC_BASE_URL' | 'CORS_ALLOWED_ORIGINS'>): readonly string[] {
  const origins = new Set<string>();
  addCorsOrigin(origins, env.PUBLIC_BASE_URL, 'PUBLIC_BASE_URL');
  for (const rawOrigin of env.CORS_ALLOWED_ORIGINS?.split(',') ?? []) {
    addCorsOrigin(origins, rawOrigin, 'CORS_ALLOWED_ORIGINS');
  }
  return [...origins];
}

function addCorsOrigin(origins: Set<string>, value: string | undefined, key: string): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  if (trimmed === 'null' && key === 'CORS_ALLOWED_ORIGINS') {
    origins.add('null');
    return;
  }
  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${key} must use http or https origins`);
  }
  origins.add(url.origin);
}

function requireInviteMailValue(value: string | undefined, key: string): string {
  return sanitizeInviteMailValue(requirePresentValue(value, key), key);
}

function requirePresentValue(value: string | undefined, key: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${key} is required when AUTH_INVITE SMTP delivery is configured`);
  return normalized;
}

function sanitizeInviteMailValue(value: string, key: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`${key} must not contain line breaks`);
  return value;
}

export function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

export function parseServerJobWorkerConfig(env: ServerEditionEnv): ServerJobWorkerConfig {
  return {
    enabled: parseBooleanEnv(env.JOB_WORKER_ENABLED, false, 'JOB_WORKER_ENABLED'),
    mailAccountCount: parseIntegerEnv(env.JOB_WORKER_MAIL_ACCOUNT_COUNT, 0, 'JOB_WORKER_MAIL_ACCOUNT_COUNT', {
      min: 0,
    }),
    aiConcurrency: env.JOB_WORKER_AI_CONCURRENCY?.trim()
      ? parseIntegerEnv(env.JOB_WORKER_AI_CONCURRENCY, 5, 'JOB_WORKER_AI_CONCURRENCY', { min: 1, max: 100 })
      : undefined,
    migrateOnStart: parseBooleanEnv(env.JOB_WORKER_MIGRATE_ON_START, false, 'JOB_WORKER_MIGRATE_ON_START'),
    ...(env.JOB_WEBHOOK_ALLOWLIST?.trim() ? { webhookAllowlist: env.JOB_WEBHOOK_ALLOWLIST.trim() } : {}),
  };
}

export function parseSmtpRelayServerConfig(env: ServerEditionEnv): SmtpRelayServerConfig {
  return {
    enabled: parseBooleanEnv(env.SMTP_RELAY_ENABLED, false, 'SMTP_RELAY_ENABLED'),
    ...(env.SMTP_RELAY_HOSTNAME?.trim() ? { hostname: env.SMTP_RELAY_HOSTNAME.trim() } : {}),
    portSubmission: parseIntegerEnv(env.SMTP_RELAY_PORT_SUBMISSION, 587, 'SMTP_RELAY_PORT_SUBMISSION', {
      min: 1,
      max: 65535,
    }),
    portSmtps: parseIntegerEnv(env.SMTP_RELAY_PORT_SMTPS, 465, 'SMTP_RELAY_PORT_SMTPS', {
      min: 1,
      max: 65535,
    }),
    bindHost: env.SMTP_RELAY_BIND_HOST?.trim() || '0.0.0.0',
    ...(env.SMTP_RELAY_TLS_CERT_FILE?.trim() ? { tlsCertFile: env.SMTP_RELAY_TLS_CERT_FILE.trim() } : {}),
    ...(env.SMTP_RELAY_TLS_KEY_FILE?.trim() ? { tlsKeyFile: env.SMTP_RELAY_TLS_KEY_FILE.trim() } : {}),
    maxMessageBytes: parseIntegerEnv(env.SMTP_RELAY_MAX_MESSAGE_BYTES, 26_214_400, 'SMTP_RELAY_MAX_MESSAGE_BYTES', {
      min: 1,
    }),
    maxConnections: parseIntegerEnv(env.SMTP_RELAY_MAX_CONNECTIONS, 50, 'SMTP_RELAY_MAX_CONNECTIONS', {
      min: 1,
    }),
    socketTimeoutMs: parseIntegerEnv(env.SMTP_RELAY_SOCKET_TIMEOUT_MS, 120_000, 'SMTP_RELAY_SOCKET_TIMEOUT_MS', {
      min: 1_000,
    }),
  };
}

export function parseBooleanEnv(value: string | undefined, fallback: boolean, key: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${key} must be a boolean`);
}

function parseIntegerEnv(
  value: string | undefined,
  fallback: number,
  key: string,
  bounds: { min?: number; max?: number } = {},
): number {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (
    !Number.isInteger(parsed)
    || (bounds.min !== undefined && parsed < bounds.min)
    || (bounds.max !== undefined && parsed > bounds.max)
  ) {
    let range = '';
    if (bounds.min !== undefined && bounds.max !== undefined) {
      range = ` between ${bounds.min} and ${bounds.max}`;
    } else if (bounds.min !== undefined) {
      range = ` greater than or equal to ${bounds.min}`;
    } else if (bounds.max !== undefined) {
      range = ` less than or equal to ${bounds.max}`;
    }
    throw new Error(`${key} must be an integer${range}`);
  }
  return parsed;
}
