/**
 * Management routes for the workspace SMTP relays (/api/v1/email/relays).
 *
 * The inbound SMTP listener authenticates external systems against
 * `smtp_relay_credentials`; this module is the admin surface that creates the
 * relays, maps allowed sender accounts, and mints/revokes the credentials.
 * Mirrors the automation API key routes: credential creation returns the
 * generated plaintext password exactly ONCE — every read path only ever sees
 * the sanitized credential record (no password_hash, no secret ids).
 */
import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  ServerApiPorts,
  SmtpRelayAdminPort,
  SmtpRelayMutationInput,
} from './types';
import { data, error, positiveIntFromPath, requireAdmin, requirePrincipal } from './http';

const BASE_PATH = '/api/v1/email/relays';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LABEL_LENGTH = 200;
const MAX_TRACKING_PATTERNS_LENGTH = 2_000;
const MAX_FROM_ADDRESS_LENGTH = 320;
const MAX_INT4 = 2_147_483_647;
const DEFAULT_SUBMISSIONS_LIMIT = 50;
const MAX_SUBMISSIONS_LIMIT = 200;

type RelayMutationParseResult =
  | { ok: true; values: SmtpRelayMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

export async function handleSmtpRelayRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (req.path !== BASE_PATH && !req.path.startsWith(`${BASE_PATH}/`)) return null;

  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.smtpRelay) {
    return error(503, 'smtp_relay_unavailable', 'SMTP-Relay-Verwaltung ist nicht konfiguriert');
  }
  const relays = ports.smtpRelay;

  if (req.path === BASE_PATH) {
    // Reads expose security-sensitive config — allowed sender routes and SMTP
    // AUTH usernames — so the list is admin-only, matching the mutation paths
    // and the "admin only" contract the settings UI + docs describe.
    if (req.method === 'GET') {
      if (!requireAdmin(principal)) return forbidden();
      return data(200, { items: await relays.listRelays({ workspaceId: principal.workspaceId }) });
    }
    if (req.method !== 'POST') return methodNotAllowed();
    if (!requireAdmin(principal)) return forbidden();
    return handleRelayCreate(req, ports, relays, principal);
  }

  const segments = req.path.slice(BASE_PATH.length + 1).split('/');
  const relayId = parseUuid(segments[0]);
  if (relayId === null) return error(400, 'invalid_relay_id', 'Relay-ID muss eine UUID sein');

  if (segments.length === 1) {
    if (req.method !== 'PATCH' && req.method !== 'DELETE') return methodNotAllowed();
    if (!requireAdmin(principal)) return forbidden();
    return req.method === 'PATCH'
      ? handleRelayUpdate(req, ports, relays, principal, relayId)
      : handleRelayDelete(ports, relays, principal, relayId);
  }

  if (segments[1] === 'accounts') {
    if (!requireAdmin(principal)) return forbidden();
    if (segments.length === 2) {
      if (req.method !== 'POST') return methodNotAllowed();
      return handleAccountAdd(req, ports, relays, principal, relayId);
    }
    if (segments.length === 3) {
      if (req.method !== 'DELETE') return methodNotAllowed();
      const accountId = positiveIntFromPath(segments[2]);
      if (accountId === null) {
        return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
      }
      return handleAccountRemove(ports, relays, principal, relayId, accountId);
    }
    return null;
  }

  if (segments[1] === 'credentials') {
    if (!requireAdmin(principal)) return forbidden();
    if (segments.length === 2) {
      if (req.method !== 'POST') return methodNotAllowed();
      return handleCredentialCreate(ports, relays, principal, relayId);
    }
    if (segments.length === 4 && segments[3] === 'revoke') {
      if (req.method !== 'POST') return methodNotAllowed();
      const credentialId = parseUuid(segments[2]);
      if (credentialId === null) {
        return error(400, 'invalid_credential_id', 'Zugangsdaten-ID muss eine UUID sein');
      }
      return handleCredentialRevoke(ports, relays, principal, relayId, credentialId);
    }
    return null;
  }

  if (segments[1] === 'submissions' && segments.length === 2) {
    if (req.method !== 'GET') return methodNotAllowed();
    // Submissions reveal per-message relay provenance — admin-only like the
    // rest of the relay surface.
    if (!requireAdmin(principal)) return forbidden();
    return handleSubmissionsList(req, relays, principal, relayId);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleRelayCreate(
  req: ApiRequest,
  ports: ServerApiPorts,
  relays: SmtpRelayAdminPort,
  principal: AuthenticatedPrincipal,
): Promise<ApiResponse> {
  const parsed = parseRelayMutation(req.body, { requireLabel: true });
  if (!parsed.ok) return parsed.response;

  const result = await relays.createRelay({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: { ...parsed.values, label: parsed.values.label ?? '' },
  });
  if (!result.ok) return relayMutationError(result.code);

  await auditRelay(ports, principal, 'smtp_relay.created', result.relay.id, {
    label: result.relay.label,
  });
  return data(201, { relay: result.relay });
}

async function handleRelayUpdate(
  req: ApiRequest,
  ports: ServerApiPorts,
  relays: SmtpRelayAdminPort,
  principal: AuthenticatedPrincipal,
  relayId: string,
): Promise<ApiResponse> {
  const parsed = parseRelayMutation(req.body, { requireLabel: false });
  if (!parsed.ok) return parsed.response;

  const result = await relays.updateRelay({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    relayId,
    values: parsed.values,
  });
  if (!result) return relayNotFound();
  if (!result.ok) return relayMutationError(result.code);

  await auditRelay(ports, principal, 'smtp_relay.updated', result.relay.id, {
    label: result.relay.label,
    fields: Object.keys(parsed.values),
  });
  return data(200, { relay: result.relay });
}

async function handleRelayDelete(
  ports: ServerApiPorts,
  relays: SmtpRelayAdminPort,
  principal: AuthenticatedPrincipal,
  relayId: string,
): Promise<ApiResponse> {
  const deleted = await relays.deleteRelay({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    relayId,
  });
  if (!deleted) return relayNotFound();

  await auditRelay(ports, principal, 'smtp_relay.deleted', deleted.id, { label: deleted.label });
  return data(200, { deleted: true });
}

async function handleAccountAdd(
  req: ApiRequest,
  ports: ServerApiPorts,
  relays: SmtpRelayAdminPort,
  principal: AuthenticatedPrincipal,
  relayId: string,
): Promise<ApiResponse> {
  if (!isPlainObject(req.body)) {
    return error(400, 'invalid_relay_account', 'Payload muss ein JSON-Objekt sein');
  }
  const accountId = req.body.accountId;
  if (!Number.isSafeInteger(accountId) || (accountId as number) <= 0) {
    return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  }
  let fromAddress: string | null = null;
  if (req.body.fromAddress !== undefined && req.body.fromAddress !== null) {
    if (typeof req.body.fromAddress !== 'string') {
      return error(400, 'invalid_relay_from_address', 'fromAddress muss Text oder null sein');
    }
    const normalized = req.body.fromAddress.trim();
    if (normalized.length > MAX_FROM_ADDRESS_LENGTH || (normalized && !normalized.includes('@'))) {
      return error(400, 'invalid_relay_from_address', 'fromAddress muss eine E-Mail-Adresse sein');
    }
    fromAddress = normalized || null;
  }

  const result = await relays.addAllowedAccount({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    relayId,
    accountId: accountId as number,
    fromAddress,
  });
  if (!result.ok) {
    if (result.code === 'relay_not_found') return relayNotFound();
    if (result.code === 'account_not_found') {
      return error(404, 'email_account_not_found', 'E-Mail-Konto nicht gefunden');
    }
    if (result.code === 'duplicate_from_address') {
      return error(
        409,
        'duplicate_relay_from_address',
        'Diese Absenderadresse ist bereits einem anderen Konto dieses Relays zugeordnet',
      );
    }
    return error(409, 'duplicate_relay_account', 'Konto ist dem Relay bereits zugeordnet');
  }
  // The allowed-account set decides which From addresses an external system may
  // send through, so add/remove is a security-sensitive change that must leave
  // an audit trail, just like relay + credential mutations.
  await auditAllowedAccount(ports, principal, 'smtp_relay_account.added', relayId, {
    accountId: result.account.accountId,
    fromAddress: result.account.fromAddress,
  });
  return data(201, { account: result.account });
}

async function handleAccountRemove(
  ports: ServerApiPorts,
  relays: SmtpRelayAdminPort,
  principal: AuthenticatedPrincipal,
  relayId: string,
  accountId: number,
): Promise<ApiResponse> {
  const removed = await relays.removeAllowedAccount({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    relayId,
    accountId,
  });
  if (!removed) return error(404, 'relay_account_not_found', 'Konto-Zuordnung nicht gefunden');
  await auditAllowedAccount(ports, principal, 'smtp_relay_account.removed', relayId, {
    accountId,
  });
  return data(200, { removed: true });
}

async function handleCredentialCreate(
  ports: ServerApiPorts,
  relays: SmtpRelayAdminPort,
  principal: AuthenticatedPrincipal,
  relayId: string,
): Promise<ApiResponse> {
  const result = await relays.createCredential({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    relayId,
  });
  if (!result.ok) {
    if (result.code === 'relay_not_found') return relayNotFound();
    return error(503, 'smtp_relay_secret_unavailable', 'Secret-Speicher ist nicht konfiguriert');
  }

  await auditCredential(ports, principal, 'smtp_relay_credential.created', result.credential.id, {
    relayId,
    username: result.credential.username,
  });
  // The ONLY response that ever carries the plaintext password.
  return data(201, {
    id: result.credential.id,
    username: result.credential.username,
    password: result.password,
  });
}

async function handleCredentialRevoke(
  ports: ServerApiPorts,
  relays: SmtpRelayAdminPort,
  principal: AuthenticatedPrincipal,
  relayId: string,
  credentialId: string,
): Promise<ApiResponse> {
  const result = await relays.revokeCredential({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    relayId,
    credentialId,
  });
  if (!result) return error(404, 'credential_not_found', 'Zugangsdaten nicht gefunden');
  if (!result.ok) {
    return error(503, 'smtp_relay_secret_unavailable', 'Secret-Speicher ist nicht konfiguriert');
  }

  await auditCredential(ports, principal, 'smtp_relay_credential.revoked', result.credential.id, {
    relayId,
    username: result.credential.username,
    revokedAt: result.credential.revokedAt,
  });
  return data(200, { revoked: true, credential: result.credential });
}

async function handleSubmissionsList(
  req: ApiRequest,
  relays: SmtpRelayAdminPort,
  principal: AuthenticatedPrincipal,
  relayId: string,
): Promise<ApiResponse> {
  const limit = parseSubmissionsLimit(req.query?.limit);
  if (limit === null) {
    return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_SUBMISSIONS_LIMIT} liegen`);
  }

  const items = await relays.listSubmissions({
    workspaceId: principal.workspaceId,
    relayId,
    limit,
  });
  if (items === null) return relayNotFound();
  return data(200, { items });
}

// ---------------------------------------------------------------------------
// Parsing / validation (mirrors the DB CHECK constraints of migration 0030)
// ---------------------------------------------------------------------------

function parseRelayMutation(
  body: unknown,
  options: { requireLabel: boolean },
): RelayMutationParseResult {
  if (!isPlainObject(body)) {
    return invalidRelay('Payload muss ein JSON-Objekt sein');
  }
  const allowed = new Set([
    'label', 'enabled', 'trackingMode', 'trackingSubjectPatterns', 'allowHeaderOverride',
    'maxRecipients', 'maxMessageBytes', 'rateLimitPerMin', 'allowArbitraryRecipients',
    'followupWorkflowId',
  ]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    return invalidRelay('Unbekanntes Relay-Feld', { fields: unknown });
  }

  const values: SmtpRelayMutationInput = {};

  if (body.label !== undefined) {
    if (typeof body.label !== 'string' || !body.label.trim() || body.label.trim().length > MAX_LABEL_LENGTH) {
      return invalidRelay(`label muss ein nicht leerer String mit maximal ${MAX_LABEL_LENGTH} Zeichen sein`);
    }
    values.label = body.label.trim();
  } else if (options.requireLabel) {
    return invalidRelay('label ist erforderlich');
  }

  for (const key of ['enabled', 'allowHeaderOverride', 'allowArbitraryRecipients'] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'boolean') {
      return invalidRelay(`${key} muss boolesch sein`);
    }
    values[key] = body[key];
  }

  if (body.trackingMode !== undefined) {
    if (body.trackingMode !== 'off' && body.trackingMode !== 'rule' && body.trackingMode !== 'always') {
      return invalidRelay('trackingMode muss off, rule oder always sein');
    }
    values.trackingMode = body.trackingMode;
  }

  if (body.trackingSubjectPatterns !== undefined) {
    if (body.trackingSubjectPatterns !== null && typeof body.trackingSubjectPatterns !== 'string') {
      return invalidRelay('trackingSubjectPatterns muss Text oder null sein');
    }
    if (typeof body.trackingSubjectPatterns === 'string'
      && body.trackingSubjectPatterns.length > MAX_TRACKING_PATTERNS_LENGTH) {
      return invalidRelay(`trackingSubjectPatterns darf maximal ${MAX_TRACKING_PATTERNS_LENGTH} Zeichen haben`);
    }
    values.trackingSubjectPatterns = body.trackingSubjectPatterns as string | null;
  }

  if (body.maxRecipients !== undefined) {
    if (!isIntegerInRange(body.maxRecipients, 1, 1000)) {
      return invalidRelay('maxRecipients muss zwischen 1 und 1000 liegen');
    }
    values.maxRecipients = body.maxRecipients as number;
  }

  if (body.maxMessageBytes !== undefined) {
    if (!isIntegerInRange(body.maxMessageBytes, 1, MAX_INT4)) {
      return invalidRelay('maxMessageBytes muss eine positive Ganzzahl sein');
    }
    values.maxMessageBytes = body.maxMessageBytes as number;
  }

  if (body.rateLimitPerMin !== undefined) {
    if (!isIntegerInRange(body.rateLimitPerMin, 1, MAX_INT4)) {
      return invalidRelay('rateLimitPerMin muss eine positive Ganzzahl sein');
    }
    values.rateLimitPerMin = body.rateLimitPerMin as number;
  }

  if (body.followupWorkflowId !== undefined) {
    if (body.followupWorkflowId !== null && !isIntegerInRange(body.followupWorkflowId, 1, Number.MAX_SAFE_INTEGER)) {
      return invalidRelay('followupWorkflowId muss eine positive Ganzzahl oder null sein');
    }
    values.followupWorkflowId = body.followupWorkflowId as number | null;
  }

  return { ok: true, values };
}

function invalidRelay(message: string, details?: unknown): RelayMutationParseResult {
  return { ok: false, response: error(400, 'invalid_smtp_relay', message, details) };
}

function relayMutationError(code: 'duplicate_label' | 'followup_workflow_not_found'): ApiResponse {
  if (code === 'duplicate_label') {
    return error(409, 'duplicate_relay_label', 'Ein Relay mit diesem Label existiert bereits');
  }
  return error(400, 'invalid_followup_workflow', 'followupWorkflowId verweist auf keinen vorhandenen Workflow');
}

function relayNotFound(): ApiResponse<ApiErrorBody> {
  return error(404, 'relay_not_found', 'Relay nicht gefunden');
}

function methodNotAllowed(): ApiResponse<ApiErrorBody> {
  return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
}

function forbidden(): ApiResponse<ApiErrorBody> {
  return error(403, 'forbidden', 'Adminrechte erforderlich');
}

function parseUuid(value: string | undefined): string | null {
  if (!value || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function parseSubmissionsLimit(value: string | undefined): number | null {
  if (value === undefined || value === '') return DEFAULT_SUBMISSIONS_LIMIT;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit > MAX_SUBMISSIONS_LIMIT) return null;
  return limit;
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Audit (same style as automation-routes' auditApiKey)
// ---------------------------------------------------------------------------

async function auditRelay(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'smtp_relay.created' | 'smtp_relay.updated' | 'smtp_relay.deleted',
  relayId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'smtp_relay',
    entityId: relayId,
    metadata: { id: relayId, ...metadata },
  });
}

async function auditCredential(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'smtp_relay_credential.created' | 'smtp_relay_credential.revoked',
  credentialId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'smtp_relay_credential',
    entityId: credentialId,
    metadata: { id: credentialId, ...metadata },
  });
}

async function auditAllowedAccount(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'smtp_relay_account.added' | 'smtp_relay_account.removed',
  relayId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'smtp_relay',
    entityId: relayId,
    metadata: { id: relayId, ...metadata },
  });
}
