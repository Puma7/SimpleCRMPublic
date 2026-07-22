import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  CanonicalApiRoute,
  CanonicalApiRouteRegistration,
  EmailMessageRecord,
  PgpAttachmentDecryptFailureCode,
  PgpAttachmentVerifyFailureCode,
  PgpIdentityListResult,
  PgpIdentityMutationInput,
  PgpIdentityRecord,
  PgpMessageDetectFailureCode,
  PgpMessageDecryptFailureCode,
  PgpMessageVerifyFailureCode,
  PgpPeerKeyListResult,
  PgpPeerKeyMutationInput,
  PgpPeerKeyRecord,
  ServerApiPorts,
} from './types';
import {
  data,
  error,
  positiveIntFromPath,
  requireAdmin,
  requirePrincipal,
} from './http';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_PGP_MESSAGE_ATTACHMENTS = 20;
const MAX_PGP_MESSAGE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_PGP_MESSAGE_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;

type PgpRouteHandler = (
  req: ApiRequest,
  ports: ServerApiPorts,
  params: readonly string[],
) => Promise<ApiResponse>;

type PgpRouteRegistration = Readonly<{
  registration: CanonicalApiRouteRegistration;
  handler: PgpRouteHandler;
}>;

function pgpRoute(
  path: string,
  methods: CanonicalApiRouteRegistration['methods'],
  pattern: RegExp,
  handler: PgpRouteHandler,
): PgpRouteRegistration {
  return { registration: { path, methods, pattern }, handler };
}

type PgpResource = 'identities' | 'peerKeys';

export const PGP_MAIL_ROUTE_REGISTRATIONS: readonly PgpRouteRegistration[] = Object.freeze([
  pgpRoute('/api/v1/pgp/identities/generate', ['POST'], /^\/api\/v1\/pgp\/identities\/generate$/, (req, ports) => handleGenerateIdentity(req, ports)),
  pgpRoute('/api/v1/pgp/peer-keys/import', ['POST'], /^\/api\/v1\/pgp\/peer-keys\/import$/, (req, ports) => handleImportPeerKey(req, ports)),
  pgpRoute('/api/v1/pgp/recipient-key-status', ['GET'], /^\/api\/v1\/pgp\/recipient-key-status$/, (req, ports) => handleRecipientKeyStatus(req, ports)),
  pgpRoute('/api/v1/pgp/messages/encrypt', ['POST'], /^\/api\/v1\/pgp\/messages\/encrypt$/, (req, ports) => handleEncryptMessage(req, ports)),
  pgpRoute('/api/v1/pgp/messages/sign', ['POST'], /^\/api\/v1\/pgp\/messages\/sign$/, (req, ports) => handleSignMessage(req, ports)),
  pgpRoute('/api/v1/pgp/attachments/:attachmentId/decrypt', ['POST'], /^\/api\/v1\/pgp\/attachments\/([^/]+)\/decrypt$/, (req, ports, params) => handleDecryptAttachment(req, ports, params[0])),
  pgpRoute('/api/v1/pgp/attachments/:attachmentId/verify', ['POST'], /^\/api\/v1\/pgp\/attachments\/([^/]+)\/verify$/, (req, ports, params) => handleVerifyAttachment(req, ports, params[0])),
  pgpRoute('/api/v1/pgp/messages/:messageId/decrypt', ['POST'], /^\/api\/v1\/pgp\/messages\/([^/]+)\/decrypt$/, (req, ports, params) => handleDecryptMessage(req, ports, params[0])),
  pgpRoute('/api/v1/pgp/messages/:messageId/detect', ['POST'], /^\/api\/v1\/pgp\/messages\/([^/]+)\/detect$/, (req, ports, params) => handleDetectMessage(req, ports, params[0])),
  pgpRoute('/api/v1/pgp/messages/:messageId/verify', ['POST'], /^\/api\/v1\/pgp\/messages\/([^/]+)\/verify$/, (req, ports, params) => handleVerifyMessage(req, ports, params[0])),
  pgpRoute('/api/v1/pgp/identities/by-source/:sourceId/private-key/passphrase', ['POST'], /^\/api\/v1\/pgp\/identities\/by-source\/([^/]+)\/private-key\/passphrase$/, (req, ports, params) => handleIdentitySourcePassphrase(req, ports, params[0])),
  pgpRoute('/api/v1/pgp/identities/:identityId/private-key/passphrase', ['POST'], /^\/api\/v1\/pgp\/identities\/([^/]+)\/private-key\/passphrase$/, (req, ports, params) => handleIdentityPassphrase(req, ports, params[0])),
  pgpRoute('/api/v1/pgp/identities/by-source/:sourceId', ['GET', 'PATCH', 'DELETE'], /^\/api\/v1\/pgp\/identities\/by-source\/([^/]+)$/, (req, ports, params) => handleBySourceRoute(req, ports, 'identities', params[0])),
  pgpRoute('/api/v1/pgp/peer-keys/by-source/:sourceId', ['GET', 'PATCH', 'DELETE'], /^\/api\/v1\/pgp\/peer-keys\/by-source\/([^/]+)$/, (req, ports, params) => handleBySourceRoute(req, ports, 'peerKeys', params[0])),
  pgpRoute('/api/v1/pgp/identities', ['GET', 'POST'], /^\/api\/v1\/pgp\/identities$/, (req, ports) => handleListRoute(req, ports, 'identities')),
  pgpRoute('/api/v1/pgp/identities/:id', ['GET', 'PATCH', 'DELETE'], /^\/api\/v1\/pgp\/identities\/([^/]+)$/, (req, ports, params) => handleGetRoute(req, ports, 'identities', params[0])),
  pgpRoute('/api/v1/pgp/peer-keys', ['GET', 'POST'], /^\/api\/v1\/pgp\/peer-keys$/, (req, ports) => handleListRoute(req, ports, 'peerKeys')),
  pgpRoute('/api/v1/pgp/peer-keys/:id', ['GET', 'PATCH', 'DELETE'], /^\/api\/v1\/pgp\/peer-keys\/([^/]+)$/, (req, ports, params) => handleGetRoute(req, ports, 'peerKeys', params[0])),
]);

export const PGP_MAIL_ROUTE_INVENTORY: readonly CanonicalApiRoute[] = Object.freeze(
  PGP_MAIL_ROUTE_REGISTRATIONS.flatMap(({ registration }) => registration.methods.map((method) => ({
    source: 'pgp-routes',
    method,
    path: registration.path,
    pattern: registration.pattern,
  }))),
);

type PgpPeerKeyMutationParseResult =
  | { ok: true; values: PgpPeerKeyMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type PgpIdentityMutationParseResult =
  | { ok: true; values: PgpIdentityMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type PgpGenerateIdentityParseResult =
  | { ok: true; values: { email: string; passphrase: string } }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type PgpImportPeerKeyParseResult =
  | { ok: true; values: { armored: string; source: string } }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type PgpMessageAttachmentPayload = {
  filename: string;
  contentType?: string;
  bytes: Buffer;
};

type PgpEncryptMessageParseResult =
  | { ok: true; values: { plaintext: string; recipientEmails: string[]; attachments: PgpMessageAttachmentPayload[] } }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type PgpSignMessageParseResult =
  | { ok: true; values: { plaintext: string; passphrase: string; attachments: PgpMessageAttachmentPayload[] } }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type PgpDecryptMessageParseResult =
  | { ok: true; values: { passphrase: string } }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type PgpVerifyAttachmentParseResult =
  | { ok: true; values: { signatureAttachmentId?: number; signatureBase64?: string; signerEmail?: string } }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type PgpRotateIdentityPassphraseParseResult =
  | { ok: true; values: { currentPassphrase: string; nextPassphrase: string } }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

export async function handlePgpReadRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  for (const { registration, handler } of PGP_MAIL_ROUTE_REGISTRATIONS) {
    const match = registration.pattern.exec(req.path);
    if (match) return handler(req, ports, match.slice(1));
  }

  return null;
}

async function handleIdentitySourcePassphrase(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawSourceId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpIdentities) return error(503, 'pgp_identities_unavailable', 'PGP identities API nicht konfiguriert');
  const sourceSqliteId = nonZeroIntFromPath(rawSourceId);
  if (sourceSqliteId === null) {
    return error(400, 'invalid_pgp_identity_source_sqlite_id', 'PGP identity sourceSqliteId muss eine Ganzzahl ungleich 0 sein');
  }
  const identity = await findPgpIdentityBySourceSqliteId(ports, principal.workspaceId, sourceSqliteId);
  if (!identity) return error(404, 'pgp_identity_not_found', 'PGP identity nicht gefunden');
  return handleRotateIdentityPassphrase(req, ports, principal, identity.id);
}

async function handleIdentityPassphrase(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_pgp_identity_id', 'PGP identity id muss eine positive Ganzzahl sein');
  return handleRotateIdentityPassphrase(req, ports, principal, id);
}

async function handleGenerateIdentity(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpIdentities?.create) return error(503, 'pgp_identities_unavailable', 'PGP identities API nicht konfiguriert');
  if (!ports.pgpKeyMaterial) return error(503, 'pgp_key_material_unavailable', 'PGP key material API nicht konfiguriert');

  const parsed = parsePgpGenerateIdentityBody(req.body);
  if (!parsed.ok) return parsed.response;

  let generated: Awaited<ReturnType<NonNullable<ServerApiPorts['pgpKeyMaterial']>['generateIdentity']>>;
  try {
    generated = await ports.pgpKeyMaterial.generateIdentity({
      email: parsed.values.email,
      passphrase: parsed.values.passphrase,
    });
  } catch (cause) {
    return error(400, 'pgp_identity_generation_failed', errorMessage(cause, 'PGP identity konnte nicht erzeugt werden'));
  }

  const result = await ports.pgpIdentities.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: {
      email: parsed.values.email,
      fingerprint: generated.fingerprint,
      publicKeyArmor: generated.publicKeyArmor,
      privateKeyArmored: generated.privateKeyArmored,
      privateKeyPassphrase: parsed.values.passphrase,
      isPrimary: true,
    },
  });
  if (!result.ok) return pgpIdentityMutationError(result.code);

  const identity = result.identity;
  await auditIdentity(ports, principal, 'pgp_identity.created', identity, {
    fingerprint: identity.fingerprint,
    privateKeyConfigured: identity.privateKeyConfigured,
  });
  await publishIdentity(ports, principal.workspaceId, 'pgp_identity.created', identity, principal.userId);
  return data(201, { fingerprint: identity.fingerprint });
}

async function handleImportPeerKey(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpPeerKeys?.create) return error(503, 'pgp_peer_keys_unavailable', 'PGP peer key API nicht konfiguriert');
  if (!ports.pgpKeyMaterial) return error(503, 'pgp_key_material_unavailable', 'PGP key material API nicht konfiguriert');

  const parsed = parsePgpImportPeerKeyBody(req.body);
  if (!parsed.ok) return parsed.response;

  let key: Awaited<ReturnType<NonNullable<ServerApiPorts['pgpKeyMaterial']>['readPublicKey']>>;
  try {
    key = await ports.pgpKeyMaterial.readPublicKey({ armored: parsed.values.armored });
  } catch (cause) {
    return error(400, 'pgp_peer_key_import_failed', errorMessage(cause, 'PGP public key konnte nicht importiert werden'));
  }

  const values = {
    email: key.email,
    fingerprint: key.fingerprint,
    publicKeyArmor: parsed.values.armored,
    source: parsed.values.source,
    trustLevel: 'imported',
  };
  const created = await ports.pgpPeerKeys.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values,
  });

  if (created.ok) {
    const peerKey = created.peerKey;
    await auditPeerKey(ports, principal, 'pgp_peer_key.created', peerKey, { fingerprint: peerKey.fingerprint });
    await publishPeerKey(ports, principal.workspaceId, 'pgp_peer_key.created', peerKey, principal.userId);
    return data(201, { fingerprint: peerKey.fingerprint });
  }

  if (created.code !== 'fingerprint_conflict' || !ports.pgpPeerKeys.update) {
    return pgpPeerKeyMutationError(created.code);
  }

  const existing = await findPgpPeerKeyByFingerprint(ports, principal.workspaceId, key.fingerprint);
  if (!existing) return pgpPeerKeyMutationError(created.code);

  const updated = await ports.pgpPeerKeys.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id: existing.id,
    values,
  });
  if (!updated) return error(404, 'pgp_peer_key_not_found', 'PGP peer key nicht gefunden');
  if (!updated.ok) return pgpPeerKeyMutationError(updated.code);

  const peerKey = updated.peerKey;
  await auditPeerKey(ports, principal, 'pgp_peer_key.updated', peerKey, { fields: Object.keys(values).sort() });
  await publishPeerKey(ports, principal.workspaceId, 'pgp_peer_key.updated', peerKey, principal.userId);
  return data(200, { fingerprint: peerKey.fingerprint });
}

async function handleRecipientKeyStatus(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpPeerKeys) return error(503, 'pgp_peer_keys_unavailable', 'PGP peer key API nicht konfiguriert');

  const parsed = parseRecipientEmailsQuery(req.query?.emails);
  if (!parsed.ok) return parsed.response;

  const result = [];
  for (const emailAddress of parsed.emails) {
    const page = await ports.pgpPeerKeys.list({
      workspaceId: principal.workspaceId,
      email: emailAddress,
      limit: MAX_LIMIT,
    });
    const match = selectRecipientPeerKey(page.items);
    result.push({
      email: emailAddress,
      hasKey: Boolean(match),
      ...(match ? { fingerprint: match.fingerprint } : {}),
    });
  }
  return data(200, result);
}

async function handleEncryptMessage(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpMessages?.prepareOutboundBody) return error(503, 'pgp_messages_unavailable', 'PGP message crypto API nicht konfiguriert');

  const parsed = parsePgpEncryptMessageBody(req.body);
  if (!parsed.ok) return parsed.response;

  const attachmentsResult = await preparePgpMessageAttachments({
    ports,
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    attachments: parsed.values.attachments,
    recipientEmails: parsed.values.recipientEmails,
    encrypt: true,
  });
  if ('status' in attachmentsResult) return attachmentsResult;

  const result = await ports.pgpMessages.prepareOutboundBody({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    bodyText: parsed.values.plaintext,
    recipientEmails: parsed.values.recipientEmails,
    encrypt: true,
  });
  return result.ok
    ? data(200, {
      armored: result.bodyText,
      ...(attachmentsResult.attachments.length === 0 ? {} : { attachments: attachmentsResult.attachments }),
    })
    : error(400, 'pgp_message_encrypt_failed', result.error);
}

async function handleSignMessage(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpMessages?.prepareOutboundBody) return error(503, 'pgp_messages_unavailable', 'PGP message crypto API nicht konfiguriert');

  const parsed = parsePgpSignMessageBody(req.body);
  if (!parsed.ok) return parsed.response;

  const attachmentsResult = await preparePgpMessageAttachments({
    ports,
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    attachments: parsed.values.attachments,
    recipientEmails: [],
    sign: true,
    passphrase: parsed.values.passphrase,
  });
  if ('status' in attachmentsResult) return attachmentsResult;

  const result = await ports.pgpMessages.prepareOutboundBody({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    bodyText: parsed.values.plaintext,
    recipientEmails: [],
    sign: true,
    passphrase: parsed.values.passphrase,
  });
  return result.ok
    ? data(200, {
      armored: result.bodyText,
      ...(attachmentsResult.attachments.length === 0 ? {} : { attachments: attachmentsResult.attachments }),
    })
    : error(400, 'pgp_message_sign_failed', result.error);
}

async function preparePgpMessageAttachments(input: {
  ports: ServerApiPorts;
  workspaceId: string;
  actorUserId: string;
  attachments: PgpMessageAttachmentPayload[];
  recipientEmails: string[];
  encrypt?: boolean;
  sign?: boolean;
  passphrase?: string;
}): Promise<ApiResponse | { attachments: Array<{ filename: string; contentBase64: string; contentType?: string }> }> {
  if (input.attachments.length === 0) return { attachments: [] };
  if (!input.ports.pgpMessages?.prepareOutboundAttachments) {
    return error(503, 'pgp_message_attachments_unavailable', 'PGP attachment crypto API nicht konfiguriert');
  }

  const prepared = await input.ports.pgpMessages.prepareOutboundAttachments({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    attachments: input.attachments,
    recipientEmails: input.recipientEmails,
    ...(input.encrypt === undefined ? {} : { encrypt: input.encrypt }),
    ...(input.sign === undefined ? {} : { sign: input.sign }),
    ...(input.passphrase === undefined ? {} : { passphrase: input.passphrase }),
  });

  if (!prepared.ok) return error(400, 'pgp_message_attachment_crypto_failed', prepared.error);
  return {
    attachments: prepared.attachments.map((attachment) => ({
      filename: attachment.filename,
      ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
      contentBase64: Buffer.from(attachment.content).toString('base64'),
    })),
  };
}

async function handleDecryptMessage(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawMessageId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpMessages) return error(503, 'pgp_messages_unavailable', 'PGP message crypto API nicht konfiguriert');

  const messageId = positiveIntFromPath(rawMessageId);
  if (messageId === null) {
    return error(400, 'invalid_pgp_message_id', 'PGP message id muss eine positive Ganzzahl sein');
  }

  const parsed = parsePgpDecryptMessageBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.pgpMessages.decryptMessage({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    messageId,
    passphrase: parsed.values.passphrase,
  });
  return result.ok ? data(200, result.result) : pgpMessageDecryptError(result.code, result.message);
}

async function handleDecryptAttachment(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawAttachmentId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpMessages?.decryptAttachment) {
    return error(503, 'pgp_attachment_decrypt_unavailable', 'PGP attachment decrypt API nicht konfiguriert');
  }

  const attachmentId = positiveIntFromPath(rawAttachmentId);
  if (attachmentId === null) {
    return error(400, 'invalid_pgp_attachment_id', 'PGP attachment id muss eine positive Ganzzahl sein');
  }

  const parsed = parsePgpDecryptMessageBody(req.body);
  if (!parsed.ok) return parsed.response;

  const attachment = await loadPgpAttachmentContent(ports, principal.workspaceId, attachmentId, 'attachment');
  if ('status' in attachment) return attachment;

  const result = await ports.pgpMessages.decryptAttachment({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    passphrase: parsed.values.passphrase,
    attachment: {
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      bytes: attachment.content,
    },
  });
  if (!result.ok) return pgpAttachmentDecryptError(result.code, result.message);

  return data(200, {
    filename: result.result.filename,
    contentType: result.result.contentType,
    contentBase64: Buffer.from(result.result.content).toString('base64'),
    sizeBytes: result.result.content.length,
    status: result.result.status,
  });
}

async function handleVerifyAttachment(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawAttachmentId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpMessages?.verifyAttachment) {
    return error(503, 'pgp_attachment_verify_unavailable', 'PGP attachment verify API nicht konfiguriert');
  }

  const attachmentId = positiveIntFromPath(rawAttachmentId);
  if (attachmentId === null) {
    return error(400, 'invalid_pgp_attachment_id', 'PGP attachment id muss eine positive Ganzzahl sein');
  }

  const parsed = parsePgpVerifyAttachmentBody(req.body);
  if (!parsed.ok) return parsed.response;

  const attachment = await loadPgpAttachmentContent(ports, principal.workspaceId, attachmentId, 'attachment');
  if ('status' in attachment) return attachment;

  let signature: {
    id?: number;
    filename?: string;
    contentType?: string | null;
    content: Uint8Array;
  };
  if (parsed.values.signatureAttachmentId !== undefined) {
    if (parsed.values.signatureAttachmentId === attachmentId) {
      return error(400, 'invalid_pgp_signature_attachment_id', 'Signatur-Anhang muss vom Original-Anhang verschieden sein');
    }
    const signatureAttachment = await loadPgpAttachmentContent(
      ports,
      principal.workspaceId,
      parsed.values.signatureAttachmentId,
      'signatureAttachment',
    );
    if ('status' in signatureAttachment) return signatureAttachment;
    signature = {
      id: signatureAttachment.id,
      filename: signatureAttachment.filename,
      contentType: signatureAttachment.contentType,
      content: signatureAttachment.content,
    };
  } else {
    signature = {
      filename: `${attachment.filename}.asc`,
      contentType: 'application/pgp-signature',
      content: Buffer.from(parsed.values.signatureBase64!, 'base64'),
    };
  }

  const signerEmail = parsed.values.signerEmail
    ?? await inferAttachmentSignerEmail(ports, principal.workspaceId, attachment.messageId);

  const result = await ports.pgpMessages.verifyAttachment({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    ...(signerEmail ? { signerEmail } : {}),
    attachment: {
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      bytes: attachment.content,
    },
    signature: {
      ...(signature.id === undefined ? {} : { id: signature.id }),
      ...(signature.filename === undefined ? {} : { filename: signature.filename }),
      ...(signature.contentType === undefined ? {} : { contentType: signature.contentType }),
      bytes: signature.content,
    },
  });
  return result.ok ? data(200, result.result) : pgpAttachmentVerifyError(result.code, result.message);
}

async function handleDetectMessage(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawMessageId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpMessages?.detectMessage) return error(503, 'pgp_messages_unavailable', 'PGP message crypto API nicht konfiguriert');

  const messageId = positiveIntFromPath(rawMessageId);
  if (messageId === null) {
    return error(400, 'invalid_pgp_message_id', 'PGP message id muss eine positive Ganzzahl sein');
  }

  const result = await ports.pgpMessages.detectMessage({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    messageId,
  });
  return result.ok ? data(200, result.result) : pgpMessageDetectError(result.code, result.message);
}

async function handleVerifyMessage(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawMessageId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpMessages?.verifyMessage) return error(503, 'pgp_messages_unavailable', 'PGP message crypto API nicht konfiguriert');

  const messageId = positiveIntFromPath(rawMessageId);
  if (messageId === null) {
    return error(400, 'invalid_pgp_message_id', 'PGP message id muss eine positive Ganzzahl sein');
  }

  const result = await ports.pgpMessages.verifyMessage({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    messageId,
  });
  return result.ok ? data(200, result.result) : pgpMessageVerifyError(result.code, result.message);
}

async function handleBySourceRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: PgpResource,
  rawSourceSqliteId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const sourceSqliteId = nonZeroIntFromPath(rawSourceSqliteId);
  if (sourceSqliteId === null) {
    return error(400, `invalid_pgp_${resource === 'identities' ? 'identity' : 'peer_key'}_source_sqlite_id`, `${resourceLabel(resource)} sourceSqliteId muss eine Ganzzahl ungleich 0 sein`);
  }

  switch (resource) {
    case 'identities': {
      if (!ports.pgpIdentities) return error(503, 'pgp_identities_unavailable', 'PGP identities API nicht konfiguriert');
      const identity = await findPgpIdentityBySourceSqliteId(ports, principal.workspaceId, sourceSqliteId);
      if (!identity) return error(404, 'pgp_identity_not_found', 'PGP identity nicht gefunden');
      if (req.method === 'GET') return data(200, sanitizeIdentity(identity));
      if (req.method === 'PATCH') return handleUpdateIdentity(req, ports, principal, identity.id);
      if (req.method === 'DELETE') return handleDeleteIdentity(ports, principal, identity.id);
      return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    }
    case 'peerKeys': {
      if (!ports.pgpPeerKeys) return error(503, 'pgp_peer_keys_unavailable', 'PGP peer key API nicht konfiguriert');
      const peerKey = await findPgpPeerKeyBySourceSqliteId(ports, principal.workspaceId, sourceSqliteId);
      if (!peerKey) return error(404, 'pgp_peer_key_not_found', 'PGP peer key nicht gefunden');
      if (req.method === 'GET') return data(200, sanitizePeerKey(peerKey));
      if (req.method === 'PATCH') return handleUpdatePeerKey(req, ports, principal, peerKey.id);
      if (req.method === 'DELETE') return handleDeletePeerKey(ports, principal, peerKey.id);
      return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    }
    default:
      return assertNever(resource);
  }
}

async function handleListRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: PgpResource,
): Promise<ApiResponse> {
  if (resource === 'identities' && req.method === 'POST') return handleCreateIdentity(req, ports);
  if (resource === 'peerKeys' && req.method === 'POST') return handleCreatePeerKey(req, ports);
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const limit = parseLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_LIMIT} liegen`);
  const cursor = parseOptionalPositiveInt(req.query?.cursor);
  if (cursor === null) return error(400, 'invalid_cursor', 'cursor muss eine positive Ganzzahl sein');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return error(400, 'invalid_search', 'search darf maximal 200 Zeichen haben');
  const email = normalizeTextFilter(req.query?.email, 254);
  if (email === null) return error(400, 'invalid_email', 'email darf maximal 254 Zeichen haben');

  switch (resource) {
    case 'identities': {
      if (!ports.pgpIdentities) return error(503, 'pgp_identities_unavailable', 'PGP identities API nicht konfiguriert');
      const result = await ports.pgpIdentities.list({
        workspaceId: principal.workspaceId,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(search === undefined ? {} : { search }),
        ...(email === undefined ? {} : { email }),
        // Owner/admin see the full workspace list (management); a delegated key
        // manager sees only their own private identities. Private keys are per-user,
        // so this is the correct scope for the PGP panel's fingerprints and
        // passphrase-rotation selector, and it avoids exposing the workspace-wide list.
        ...(requireAdmin(principal) ? {} : { ownerUserId: principal.userId }),
      });
      return data(200, sanitizeIdentityList(result));
    }
    case 'peerKeys': {
      const trustLevel = normalizeTextFilter(req.query?.trustLevel, 100);
      if (trustLevel === null) return error(400, 'invalid_trust_level', 'trustLevel darf maximal 100 Zeichen haben');
      if (!ports.pgpPeerKeys) return error(503, 'pgp_peer_keys_unavailable', 'PGP peer key API nicht konfiguriert');
      const result = await ports.pgpPeerKeys.list({
        workspaceId: principal.workspaceId,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(search === undefined ? {} : { search }),
        ...(email === undefined ? {} : { email }),
        ...(trustLevel === undefined ? {} : { trustLevel }),
      });
      return data(200, sanitizePeerKeyList(result));
    }
    default:
      return assertNever(resource);
  }
}

async function handleGetRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
  resource: PgpResource,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, `invalid_pgp_${resource === 'identities' ? 'identity' : 'peer_key'}_id`, `${resourceLabel(resource)} id muss eine positive Ganzzahl sein`);
  if (resource === 'identities' && req.method === 'PATCH') return handleUpdateIdentity(req, ports, principal, id);
  if (resource === 'identities' && req.method === 'DELETE') return handleDeleteIdentity(ports, principal, id);
  if (resource === 'peerKeys' && req.method === 'PATCH') return handleUpdatePeerKey(req, ports, principal, id);
  if (resource === 'peerKeys' && req.method === 'DELETE') return handleDeletePeerKey(ports, principal, id);
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');

  switch (resource) {
    case 'identities': {
      if (!ports.pgpIdentities) return error(503, 'pgp_identities_unavailable', 'PGP identities API nicht konfiguriert');
      const identity = await ports.pgpIdentities.get({ workspaceId: principal.workspaceId, id });
      return identity ? data(200, sanitizeIdentity(identity)) : error(404, 'pgp_identity_not_found', 'PGP identity nicht gefunden');
    }
    case 'peerKeys': {
      if (!ports.pgpPeerKeys) return error(503, 'pgp_peer_keys_unavailable', 'PGP peer key API nicht konfiguriert');
      const peerKey = await ports.pgpPeerKeys.get({ workspaceId: principal.workspaceId, id });
      return peerKey ? data(200, sanitizePeerKey(peerKey)) : error(404, 'pgp_peer_key_not_found', 'PGP peer key nicht gefunden');
    }
    default:
      return assertNever(resource);
  }
}

async function handleCreateIdentity(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpIdentities?.create) return error(503, 'pgp_identities_unavailable', 'PGP identities API nicht konfiguriert');

  const parsed = parsePgpIdentityMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireEmail: true,
    requireFingerprint: true,
    requirePublicKeyArmor: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.pgpIdentities.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return pgpIdentityMutationError(result.code);

  const identity = result.identity;
  await auditIdentity(ports, principal, 'pgp_identity.created', identity, {
    fingerprint: identity.fingerprint,
    privateKeyConfigured: identity.privateKeyConfigured,
  });
  await publishIdentity(ports, principal.workspaceId, 'pgp_identity.created', identity, principal.userId);
  return data(201, sanitizeIdentity(identity));
}

async function handleUpdateIdentity(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.pgpIdentities?.update) return error(503, 'pgp_identities_unavailable', 'PGP identities API nicht konfiguriert');

  const parsed = parsePgpIdentityMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireEmail: false,
    requireFingerprint: false,
    requirePublicKeyArmor: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.pgpIdentities.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'pgp_identity_not_found', 'PGP identity nicht gefunden');
  if (!result.ok) return pgpIdentityMutationError(result.code);

  const identity = result.identity;
  await auditIdentity(ports, principal, 'pgp_identity.updated', identity, {
    fields: Object.keys(parsed.values).filter((field) => field !== 'privateKeyPassphrase').sort(),
  });
  await publishIdentity(ports, principal.workspaceId, 'pgp_identity.updated', identity, principal.userId);
  return data(200, sanitizeIdentity(identity));
}

async function handleRotateIdentityPassphrase(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  if (!ports.pgpIdentities?.rotatePrivateKeyPassphrase) {
    return error(503, 'pgp_identities_unavailable', 'PGP identities API nicht konfiguriert');
  }

  const parsed = parsePgpRotateIdentityPassphraseBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.pgpIdentities.rotatePrivateKeyPassphrase({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    currentPassphrase: parsed.values.currentPassphrase,
    nextPassphrase: parsed.values.nextPassphrase,
  });
  if (!result) return error(404, 'pgp_identity_not_found', 'PGP identity nicht gefunden');
  if (!result.ok) return pgpIdentityPassphraseRotationError(result.code);

  const identity = result.identity;
  await auditIdentity(ports, principal, 'pgp_identity.private_key_passphrase_rotated', identity, {
    fingerprint: identity.fingerprint,
    privateKeyConfigured: identity.privateKeyConfigured,
  });
  await publishIdentity(ports, principal.workspaceId, 'pgp_identity.updated', identity, principal.userId);
  return data(200, sanitizeIdentity(identity));
}

async function handleDeleteIdentity(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.pgpIdentities?.delete) return error(503, 'pgp_identities_unavailable', 'PGP identities API nicht konfiguriert');

  const result = await ports.pgpIdentities.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!result) return error(404, 'pgp_identity_not_found', 'PGP identity nicht gefunden');
  if (!result.ok) return pgpIdentityMutationError(result.code);

  const identity = result.identity;
  await auditIdentity(ports, principal, 'pgp_identity.deleted', identity, { fingerprint: identity.fingerprint });
  await publishIdentity(ports, principal.workspaceId, 'pgp_identity.deleted', identity, principal.userId);
  return data(200, { deleted: true, pgpIdentity: sanitizeIdentity(identity) });
}

function pgpIdentityMutationError(code: 'fingerprint_conflict' | 'private_key_secret_unavailable' | 'private_key_rewrite_required'): ApiResponse {
  if (code === 'fingerprint_conflict') {
    return error(409, 'pgp_identity_fingerprint_conflict', 'PGP identity fingerprint existiert bereits');
  }
  if (code === 'private_key_rewrite_required') {
    return error(409, 'pgp_identity_private_key_rewrite_required', 'Fingerprint kann mit vorhandenem Private-Key-Secret nur mit neuem oder geloeschtem Private Key geaendert werden');
  }
  return error(503, 'pgp_identity_private_key_secret_unavailable', 'PGP private key secret storage ist nicht konfiguriert');
}

function pgpIdentityPassphraseRotationError(code: 'private_key_unavailable' | 'private_key_secret_unavailable' | 'decrypt_failed'): ApiResponse {
  if (code === 'private_key_unavailable') {
    return error(409, 'pgp_identity_private_key_unavailable', 'PGP identity hat keinen serverseitigen privaten Schluessel');
  }
  if (code === 'private_key_secret_unavailable') {
    return error(503, 'pgp_identity_private_key_secret_unavailable', 'PGP private key secret storage ist nicht verfuegbar');
  }
  return error(400, 'pgp_identity_private_key_decrypt_failed', 'Aktuelle PGP-Passphrase ist ungueltig');
}

async function handleCreatePeerKey(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.pgpPeerKeys?.create) return error(503, 'pgp_peer_keys_unavailable', 'PGP peer key API nicht konfiguriert');

  const parsed = parsePgpPeerKeyMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireEmail: true,
    requireFingerprint: true,
    requirePublicKeyArmor: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.pgpPeerKeys.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return pgpPeerKeyMutationError(result.code);

  const peerKey = result.peerKey;
  await auditPeerKey(ports, principal, 'pgp_peer_key.created', peerKey, { fingerprint: peerKey.fingerprint });
  await publishPeerKey(ports, principal.workspaceId, 'pgp_peer_key.created', peerKey, principal.userId);
  return data(201, sanitizePeerKey(peerKey));
}

async function handleUpdatePeerKey(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.pgpPeerKeys?.update) return error(503, 'pgp_peer_keys_unavailable', 'PGP peer key API nicht konfiguriert');

  const parsed = parsePgpPeerKeyMutationBody(req.body, {
    requireAtLeastOneField: true,
    requireEmail: false,
    requireFingerprint: false,
    requirePublicKeyArmor: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.pgpPeerKeys.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'pgp_peer_key_not_found', 'PGP peer key nicht gefunden');
  if (!result.ok) return pgpPeerKeyMutationError(result.code);

  const peerKey = result.peerKey;
  await auditPeerKey(ports, principal, 'pgp_peer_key.updated', peerKey, {
    fields: Object.keys(parsed.values).sort(),
  });
  await publishPeerKey(ports, principal.workspaceId, 'pgp_peer_key.updated', peerKey, principal.userId);
  return data(200, sanitizePeerKey(peerKey));
}

async function handleDeletePeerKey(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  id: number,
): Promise<ApiResponse> {
  if (!ports.pgpPeerKeys?.delete) return error(503, 'pgp_peer_keys_unavailable', 'PGP peer key API nicht konfiguriert');

  const peerKey = await ports.pgpPeerKeys.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!peerKey) return error(404, 'pgp_peer_key_not_found', 'PGP peer key nicht gefunden');

  await auditPeerKey(ports, principal, 'pgp_peer_key.deleted', peerKey, { fingerprint: peerKey.fingerprint });
  await publishPeerKey(ports, principal.workspaceId, 'pgp_peer_key.deleted', peerKey, principal.userId);
  return data(200, { deleted: true, pgpPeerKey: sanitizePeerKey(peerKey) });
}

function pgpPeerKeyMutationError(code: 'fingerprint_conflict'): ApiResponse {
  return error(409, 'pgp_peer_key_fingerprint_conflict', 'PGP peer key fingerprint existiert bereits');
}

function pgpMessageDecryptError(code: PgpMessageDecryptFailureCode, message?: string): ApiResponse {
  if (code === 'message_not_found') {
    return error(404, 'pgp_message_not_found', 'PGP Nachricht nicht gefunden');
  }
  if (code === 'not_pgp_message') {
    return error(400, 'pgp_message_not_encrypted', 'Nachricht enthaelt keinen PGP-Message-Block');
  }
  if (code === 'private_key_unavailable') {
    return error(409, 'pgp_private_key_unavailable', 'Kein passender privater PGP-Schluessel verfuegbar');
  }
  if (code === 'private_key_secret_unavailable') {
    return error(503, 'pgp_private_key_secret_unavailable', 'PGP Private-Key-Secret ist nicht verfuegbar');
  }
  return error(400, 'pgp_message_decrypt_failed', message ?? 'PGP Nachricht konnte nicht entschluesselt werden');
}

function pgpMessageDetectError(code: PgpMessageDetectFailureCode, _message?: string): ApiResponse {
  if (code === 'message_not_found') {
    return error(404, 'pgp_message_not_found', 'PGP Nachricht nicht gefunden');
  }
  return assertNever(code);
}

function pgpMessageVerifyError(code: PgpMessageVerifyFailureCode, message?: string): ApiResponse {
  if (code === 'message_not_found') {
    return error(404, 'pgp_message_not_found', 'PGP Nachricht nicht gefunden');
  }
  if (code === 'not_signed') {
    return error(400, 'pgp_message_not_signed', 'Nachricht enthaelt keinen PGP-Signed-Message-Block');
  }
  return error(400, 'pgp_message_verify_failed', message ?? 'PGP Signatur konnte nicht geprueft werden');
}

function pgpAttachmentDecryptError(code: PgpAttachmentDecryptFailureCode, message?: string): ApiResponse {
  if (code === 'not_pgp_attachment') {
    return error(400, 'pgp_attachment_not_encrypted', 'Anhang enthaelt keinen PGP-Message-Block');
  }
  if (code === 'private_key_unavailable') {
    return error(409, 'pgp_private_key_unavailable', 'Kein passender privater PGP-Schluessel verfuegbar');
  }
  if (code === 'private_key_secret_unavailable') {
    return error(503, 'pgp_private_key_secret_unavailable', 'PGP Private-Key-Secret ist nicht verfuegbar');
  }
  return error(400, 'pgp_attachment_decrypt_failed', message ?? 'PGP Anhang konnte nicht entschluesselt werden');
}

function pgpAttachmentVerifyError(code: PgpAttachmentVerifyFailureCode, message?: string): ApiResponse {
  if (code === 'not_signed') {
    return error(400, 'pgp_attachment_not_signed', 'Anhang-Signatur enthaelt keinen PGP-Signature-Block');
  }
  return error(400, 'pgp_attachment_verify_failed', message ?? 'PGP Anhang-Signatur konnte nicht geprueft werden');
}

async function loadPgpAttachmentContent(
  ports: ServerApiPorts,
  workspaceId: string,
  attachmentId: number,
  fieldName: 'attachment' | 'signatureAttachment',
): Promise<ApiResponse | {
  id: number;
  filename: string;
  contentType: string | null;
  content: Uint8Array;
  messageId: number | null;
}> {
  if (!ports.emailAttachments) {
    return error(503, 'email_attachments_unavailable', 'Email attachment API nicht konfiguriert');
  }
  const attachment = await ports.emailAttachments.get({ workspaceId, id: attachmentId });
  if (!attachment) {
    return error(404, 'pgp_attachment_not_found', `${fieldName} wurde nicht gefunden`);
  }
  if (attachment.sizeBytes > MAX_PGP_MESSAGE_ATTACHMENT_BYTES) {
    return error(413, 'pgp_attachment_too_large', `${fieldName} ist zu gross`, {
      attachmentBytes: attachment.sizeBytes,
      maxBytes: MAX_PGP_MESSAGE_ATTACHMENT_BYTES,
    });
  }
  if (!ports.emailAttachmentContent) {
    return error(503, 'email_attachment_content_unavailable', 'Email attachment content API nicht konfiguriert');
  }
  const content = await ports.emailAttachmentContent.get({ workspaceId, id: attachmentId });
  if (!content.ok) {
    if (content.reason === 'not_found') return error(404, 'pgp_attachment_not_found', `${fieldName} wurde nicht gefunden`);
    if (content.reason === 'file_not_found') {
      return error(404, 'pgp_attachment_file_not_found', `${fieldName}-Datei wurde nicht gefunden`);
    }
    return error(409, 'pgp_attachment_file_unavailable', `${fieldName}-Datei ist nicht aus dem konfigurierten Attachment-Root lesbar`);
  }
  if (content.record.content.length > MAX_PGP_MESSAGE_ATTACHMENT_BYTES) {
    return error(413, 'pgp_attachment_too_large', `${fieldName} ist zu gross`, {
      attachmentBytes: content.record.content.length,
      maxBytes: MAX_PGP_MESSAGE_ATTACHMENT_BYTES,
    });
  }
  return {
    id: attachment.id,
    filename: content.record.filename || attachment.filename,
    contentType: content.record.contentType ?? attachment.contentType,
    content: content.record.content,
    messageId: attachment.messageId,
  };
}

async function inferAttachmentSignerEmail(
  ports: ServerApiPorts,
  workspaceId: string,
  messageId: number | null,
): Promise<string | undefined> {
  if (!messageId || !ports.emailMessages?.get) return undefined;
  const message = await ports.emailMessages.get({ workspaceId, id: messageId, includeBody: false });
  return message ? firstMessageEmailAddress(message.from) : undefined;
}

function firstMessageEmailAddress(value: EmailMessageRecord['from']): string | undefined {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(parsed)) {
    const first = parsed[0] as { address?: unknown } | undefined;
    return typeof first?.address === 'string' && first.address.trim()
      ? first.address.trim().toLowerCase()
      : undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const valueArray = (parsed as { value?: unknown }).value;
  if (Array.isArray(valueArray)) {
    const first = valueArray[0] as { address?: unknown } | undefined;
    return typeof first?.address === 'string' && first.address.trim()
      ? first.address.trim().toLowerCase()
      : undefined;
  }
  const address = (parsed as { address?: unknown }).address;
  return typeof address === 'string' && address.trim()
    ? address.trim().toLowerCase()
    : undefined;
}

async function auditIdentity(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action:
    | 'pgp_identity.created'
    | 'pgp_identity.updated'
    | 'pgp_identity.deleted'
    | 'pgp_identity.private_key_passphrase_rotated',
  identity: PgpIdentityRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'pgp_identity',
    entityId: String(identity.id),
    metadata: {
      id: identity.id,
      sourceSqliteId: identity.sourceSqliteId,
      email: identity.email,
      userId: identity.userId,
      ...metadata,
    },
  });
}

async function publishIdentity(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'pgp_identity.created' | 'pgp_identity.updated' | 'pgp_identity.deleted',
  identity: PgpIdentityRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'pgp_identity',
    entityId: String(identity.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: identity.id,
      sourceSqliteId: identity.sourceSqliteId,
      userId: identity.userId,
      email: identity.email,
      fingerprint: identity.fingerprint,
      privateKeyConfigured: identity.privateKeyConfigured,
      expiresAt: identity.expiresAt,
      isPrimary: identity.isPrimary,
    },
  });
}

async function auditPeerKey(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'pgp_peer_key.created' | 'pgp_peer_key.updated' | 'pgp_peer_key.deleted',
  peerKey: PgpPeerKeyRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'pgp_peer_key',
    entityId: String(peerKey.id),
    metadata: {
      id: peerKey.id,
      sourceSqliteId: peerKey.sourceSqliteId,
      email: peerKey.email,
      ...metadata,
    },
  });
}

async function publishPeerKey(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'pgp_peer_key.created' | 'pgp_peer_key.updated' | 'pgp_peer_key.deleted',
  peerKey: PgpPeerKeyRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'pgp_peer_key',
    entityId: String(peerKey.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: peerKey.id,
      sourceSqliteId: peerKey.sourceSqliteId,
      email: peerKey.email,
      fingerprint: peerKey.fingerprint,
      source: peerKey.source,
      trustLevel: peerKey.trustLevel,
      verifiedAt: peerKey.verifiedAt,
      verifiedByUserId: peerKey.verifiedByUserId,
    },
  });
}

function sanitizeIdentityList(result: PgpIdentityListResult): PgpIdentityListResult {
  return {
    items: result.items.map(sanitizeIdentity),
    nextCursor: result.nextCursor,
  };
}

function sanitizeIdentity(identity: PgpIdentityRecord): PgpIdentityRecord {
  return {
    id: identity.id,
    sourceSqliteId: identity.sourceSqliteId,
    userId: identity.userId,
    legacyUserId: identity.legacyUserId,
    email: identity.email,
    fingerprint: identity.fingerprint,
    publicKeyArmor: identity.publicKeyArmor,
    hasPrivateKey: identity.hasPrivateKey,
    privateKeyConfigured: identity.privateKeyConfigured,
    expiresAt: identity.expiresAt,
    isPrimary: identity.isPrimary,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
  };
}

function sanitizePeerKeyList(result: PgpPeerKeyListResult): PgpPeerKeyListResult {
  return {
    items: result.items.map(sanitizePeerKey),
    nextCursor: result.nextCursor,
  };
}

function sanitizePeerKey(peerKey: PgpPeerKeyRecord): PgpPeerKeyRecord {
  return {
    id: peerKey.id,
    sourceSqliteId: peerKey.sourceSqliteId,
    email: peerKey.email,
    fingerprint: peerKey.fingerprint,
    publicKeyArmor: peerKey.publicKeyArmor,
    source: peerKey.source,
    verifiedAt: peerKey.verifiedAt,
    verifiedByUserId: peerKey.verifiedByUserId,
    legacyVerifiedByUserId: peerKey.legacyVerifiedByUserId,
    trustLevel: peerKey.trustLevel,
    createdAt: peerKey.createdAt,
    updatedAt: peerKey.updatedAt,
  };
}

function parsePgpGenerateIdentityBody(body: unknown): PgpGenerateIdentityParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_pgp_identity_generation_payload', 'PGP identity generation payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['email', 'passphrase']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const email = normalizeRequiredBodyText(body.email, 'email', 254);
  const passphrase = normalizeRequiredSecretText(body.passphrase, 'passphrase', 10000);
  if (!email.ok) errors.push({ field: 'email', message: email.message });
  if (!passphrase.ok) errors.push({ field: 'passphrase', message: passphrase.message });

  if (errors.length > 0 || !email.ok || !passphrase.ok) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'PGP identity generation payload ist ungueltig', { fields: errors }),
    };
  }

  return { ok: true, values: { email: email.value, passphrase: passphrase.value } };
}

function parsePgpImportPeerKeyBody(body: unknown): PgpImportPeerKeyParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_pgp_peer_key_import_payload', 'PGP peer key import payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['armored', 'source']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const armored = normalizeRequiredBodyText(body.armored, 'armored', 100000);
  if (!armored.ok) errors.push({ field: 'armored', message: armored.message });

  let source = 'manual';
  if (Object.prototype.hasOwnProperty.call(body, 'source')) {
    const parsedSource = normalizeRequiredBodyText(body.source, 'source', 100);
    if (parsedSource.ok) source = parsedSource.value;
    else errors.push({ field: 'source', message: parsedSource.message });
  }

  if (errors.length > 0 || !armored.ok) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'PGP peer key import payload ist ungueltig', { fields: errors }),
    };
  }

  return { ok: true, values: { armored: armored.value, source } };
}

function parsePgpEncryptMessageBody(body: unknown): PgpEncryptMessageParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_pgp_encrypt_payload', 'PGP encrypt payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['plaintext', 'recipientEmails', 'attachments']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const plaintext = normalizeRequiredLiteralText(body.plaintext, 'plaintext', 2_000_000);
  const recipientEmails = normalizeRecipientEmailList(body.recipientEmails, 'recipientEmails', 200);
  const attachments = normalizePgpMessageAttachments(body.attachments, 'attachments');
  if (!plaintext.ok) errors.push({ field: 'plaintext', message: plaintext.message });
  if (!recipientEmails.ok) errors.push({ field: 'recipientEmails', message: recipientEmails.message });
  if (!attachments.ok) errors.push(...attachments.fields);

  if (errors.length > 0 || !plaintext.ok || !recipientEmails.ok || !attachments.ok) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'PGP encrypt payload ist ungueltig', { fields: errors }),
    };
  }

  return {
    ok: true,
    values: {
      plaintext: plaintext.value,
      recipientEmails: recipientEmails.value,
      attachments: attachments.value,
    },
  };
}

function parsePgpSignMessageBody(body: unknown): PgpSignMessageParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_pgp_sign_payload', 'PGP sign payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['plaintext', 'passphrase', 'attachments']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const plaintext = normalizeRequiredLiteralText(body.plaintext, 'plaintext', 2_000_000);
  const passphrase = normalizeRequiredSecretText(body.passphrase, 'passphrase', 10000);
  const attachments = normalizePgpMessageAttachments(body.attachments, 'attachments');
  if (!plaintext.ok) errors.push({ field: 'plaintext', message: plaintext.message });
  if (!passphrase.ok) errors.push({ field: 'passphrase', message: passphrase.message });
  if (!attachments.ok) errors.push(...attachments.fields);

  if (errors.length > 0 || !plaintext.ok || !passphrase.ok || !attachments.ok) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'PGP sign payload ist ungueltig', { fields: errors }),
    };
  }

  return { ok: true, values: { plaintext: plaintext.value, passphrase: passphrase.value, attachments: attachments.value } };
}

function parsePgpDecryptMessageBody(body: unknown): PgpDecryptMessageParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_pgp_decrypt_payload', 'PGP decrypt payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['passphrase']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const passphrase = normalizeRequiredSecretText(body.passphrase, 'passphrase', 10000);
  if (!passphrase.ok) errors.push({ field: 'passphrase', message: passphrase.message });

  if (errors.length > 0 || !passphrase.ok) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'PGP decrypt payload ist ungueltig', { fields: errors }),
    };
  }

  return { ok: true, values: { passphrase: passphrase.value } };
}

function parsePgpVerifyAttachmentBody(body: unknown): PgpVerifyAttachmentParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_pgp_attachment_verify_payload', 'PGP attachment verify payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['signatureAttachmentId', 'signatureBase64', 'signerEmail']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  let signatureAttachmentId: number | undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'signatureAttachmentId')) {
    const parsed = normalizePositiveBodyInt(body.signatureAttachmentId, 'signatureAttachmentId');
    if (parsed.ok) signatureAttachmentId = parsed.value;
    else errors.push({ field: 'signatureAttachmentId', message: parsed.message });
  }

  let signatureBase64: string | undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'signatureBase64')) {
    const parsed = normalizeBase64AttachmentContent(body.signatureBase64, 'signatureBase64');
    if (parsed.ok) signatureBase64 = Buffer.from(parsed.value).toString('base64');
    else errors.push({ field: 'signatureBase64', message: parsed.message });
  }

  let signerEmail: string | undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'signerEmail')) {
    const parsed = normalizeRequiredBodyText(body.signerEmail, 'signerEmail', 254);
    if (parsed.ok) signerEmail = parsed.value.toLowerCase();
    else errors.push({ field: 'signerEmail', message: parsed.message });
  }

  if (signatureAttachmentId === undefined && signatureBase64 === undefined) {
    errors.push({ field: 'signatureAttachmentId', message: 'signatureAttachmentId oder signatureBase64 ist erforderlich' });
  }
  if (signatureAttachmentId !== undefined && signatureBase64 !== undefined) {
    errors.push({ field: 'signatureBase64', message: 'signatureBase64 darf nicht zusammen mit signatureAttachmentId gesetzt werden' });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'PGP attachment verify payload ist ungueltig', { fields: errors }),
    };
  }

  return {
    ok: true,
    values: {
      ...(signatureAttachmentId === undefined ? {} : { signatureAttachmentId }),
      ...(signatureBase64 === undefined ? {} : { signatureBase64 }),
      ...(signerEmail === undefined ? {} : { signerEmail }),
    },
  };
}

function parsePgpRotateIdentityPassphraseBody(body: unknown): PgpRotateIdentityPassphraseParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_pgp_passphrase_rotation_payload', 'PGP passphrase rotation payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['currentPassphrase', 'nextPassphrase']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  const currentPassphrase = normalizeRequiredSecretText(body.currentPassphrase, 'currentPassphrase', 10000);
  const nextPassphrase = normalizeRequiredSecretText(body.nextPassphrase, 'nextPassphrase', 10000);
  if (!currentPassphrase.ok) errors.push({ field: 'currentPassphrase', message: currentPassphrase.message });
  if (!nextPassphrase.ok) errors.push({ field: 'nextPassphrase', message: nextPassphrase.message });

  if (errors.length > 0 || !currentPassphrase.ok || !nextPassphrase.ok) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'PGP passphrase rotation payload ist ungueltig', { fields: errors }),
    };
  }

  return {
    ok: true,
    values: {
      currentPassphrase: currentPassphrase.value,
      nextPassphrase: nextPassphrase.value,
    },
  };
}

function parsePgpIdentityMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireEmail: boolean;
    requireFingerprint: boolean;
    requirePublicKeyArmor: boolean;
  },
): PgpIdentityMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_pgp_identity_payload', 'PGP identity payload muss ein JSON-Objekt sein'),
    };
  }

  const values: PgpIdentityMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    'email',
    'fingerprint',
    'publicKeyArmor',
    'privateKeyArmored',
    'privateKeyPassphrase',
    'expiresAt',
    'isPrimary',
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    const email = normalizeRequiredBodyText(body.email, 'email', 254);
    if (email.ok) values.email = email.value;
    else errors.push({ field: 'email', message: email.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'fingerprint')) {
    const fingerprint = normalizeRequiredBodyText(body.fingerprint, 'fingerprint', 200);
    if (fingerprint.ok) values.fingerprint = fingerprint.value;
    else errors.push({ field: 'fingerprint', message: fingerprint.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'publicKeyArmor')) {
    const publicKeyArmor = normalizeRequiredBodyText(body.publicKeyArmor, 'publicKeyArmor', 100000);
    if (publicKeyArmor.ok) values.publicKeyArmor = publicKeyArmor.value;
    else errors.push({ field: 'publicKeyArmor', message: publicKeyArmor.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'privateKeyArmored')) {
    if (body.privateKeyArmored === null) {
      values.privateKeyArmored = null;
    } else {
      const privateKeyArmored = normalizeRequiredBodyText(body.privateKeyArmored, 'privateKeyArmored', 200000);
      if (privateKeyArmored.ok) values.privateKeyArmored = privateKeyArmored.value;
      else errors.push({ field: 'privateKeyArmored', message: privateKeyArmored.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'privateKeyPassphrase')) {
    const privateKeyPassphrase = normalizeRequiredSecretText(body.privateKeyPassphrase, 'privateKeyPassphrase', 10000);
    if (privateKeyPassphrase.ok) values.privateKeyPassphrase = privateKeyPassphrase.value;
    else errors.push({ field: 'privateKeyPassphrase', message: privateKeyPassphrase.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'expiresAt')) {
    const expiresAt = normalizeNullableBodyTimestamp(body.expiresAt, 'expiresAt');
    if (expiresAt.ok) values.expiresAt = expiresAt.value;
    else errors.push({ field: 'expiresAt', message: expiresAt.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'isPrimary')) {
    const isPrimary = normalizeBodyBoolean(body.isPrimary, 'isPrimary');
    if (isPrimary.ok) values.isPrimary = isPrimary.value;
    else errors.push({ field: 'isPrimary', message: isPrimary.message });
  }

  if (typeof values.privateKeyArmored === 'string' && values.privateKeyPassphrase === undefined) {
    errors.push({ field: 'privateKeyPassphrase', message: 'privateKeyPassphrase ist fuer privateKeyArmored erforderlich' });
  }
  if (values.privateKeyArmored !== undefined && typeof values.privateKeyArmored !== 'string' && values.privateKeyPassphrase !== undefined) {
    errors.push({ field: 'privateKeyPassphrase', message: 'privateKeyPassphrase ist nur zusammen mit privateKeyArmored erlaubt' });
  }
  if (values.privateKeyArmored === undefined && values.privateKeyPassphrase !== undefined) {
    errors.push({ field: 'privateKeyPassphrase', message: 'privateKeyPassphrase ist nur zusammen mit privateKeyArmored erlaubt' });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'PGP identity payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'PGP identity mutation braucht mindestens ein Feld'),
    };
  }
  if (options.requireEmail && values.email === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'email ist erforderlich') };
  }
  if (options.requireFingerprint && values.fingerprint === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'fingerprint ist erforderlich') };
  }
  if (options.requirePublicKeyArmor && values.publicKeyArmor === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'publicKeyArmor ist erforderlich') };
  }

  return { ok: true, values };
}

function parseRecipientEmailsQuery(
  value: string | undefined,
): { ok: true; emails: string[] } | { ok: false; response: ApiResponse<ApiErrorBody> } {
  if (value === undefined || value.trim() === '') return { ok: true, emails: [] };

  let rawEmails: unknown;
  try {
    rawEmails = value.trim().startsWith('[') ? JSON.parse(value) : value.split(',');
  } catch {
    return { ok: false, response: error(400, 'invalid_recipient_emails', 'emails muss JSON oder kommagetrennt sein') };
  }

  if (!Array.isArray(rawEmails)) {
    return { ok: false, response: error(400, 'invalid_recipient_emails', 'emails muss eine Liste sein') };
  }
  if (rawEmails.length > 100) {
    return { ok: false, response: error(400, 'too_many_recipient_emails', 'maximal 100 Empfaenger erlaubt') };
  }

  const emails: string[] = [];
  const errors: Array<{ index: number; message: string }> = [];
  rawEmails.forEach((rawEmail, index) => {
    if (typeof rawEmail !== 'string') {
      errors.push({ index, message: 'email muss ein String sein' });
      return;
    }
    const emailAddress = rawEmail.trim();
    if (!emailAddress) {
      errors.push({ index, message: 'email darf nicht leer sein' });
    } else if (emailAddress.length > 254) {
      errors.push({ index, message: 'email darf maximal 254 Zeichen haben' });
    } else {
      emails.push(emailAddress);
    }
  });

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'invalid_recipient_emails', 'emails ist ungueltig', { fields: errors }),
    };
  }

  return { ok: true, emails };
}

async function findPgpIdentityBySourceSqliteId(
  ports: ServerApiPorts,
  workspaceId: string,
  sourceSqliteId: number,
): Promise<PgpIdentityRecord | null> {
  if (!ports.pgpIdentities) return null;
  let cursor: number | undefined;
  for (let guard = 0; guard < 1000; guard += 1) {
    const page = await ports.pgpIdentities.list({
      workspaceId,
      limit: MAX_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const found = page.items.find((identity) => identity.sourceSqliteId === sourceSqliteId || identity.id === sourceSqliteId);
    if (found) return found;
    if (page.nextCursor === null || page.nextCursor === undefined) return null;
    cursor = page.nextCursor;
  }
  return null;
}

async function findPgpPeerKeyBySourceSqliteId(
  ports: ServerApiPorts,
  workspaceId: string,
  sourceSqliteId: number,
): Promise<PgpPeerKeyRecord | null> {
  if (!ports.pgpPeerKeys) return null;
  let cursor: number | undefined;
  for (let guard = 0; guard < 1000; guard += 1) {
    const page = await ports.pgpPeerKeys.list({
      workspaceId,
      limit: MAX_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const found = page.items.find((peerKey) => peerKey.sourceSqliteId === sourceSqliteId || peerKey.id === sourceSqliteId);
    if (found) return found;
    if (page.nextCursor === null || page.nextCursor === undefined) return null;
    cursor = page.nextCursor;
  }
  return null;
}

async function findPgpPeerKeyByFingerprint(
  ports: ServerApiPorts,
  workspaceId: string,
  fingerprint: string,
): Promise<PgpPeerKeyRecord | null> {
  if (!ports.pgpPeerKeys) return null;
  let cursor: number | undefined;
  for (let guard = 0; guard < 1000; guard += 1) {
    const page = await ports.pgpPeerKeys.list({
      workspaceId,
      search: fingerprint,
      limit: MAX_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const found = page.items.find((peerKey) => peerKey.fingerprint.toLowerCase() === fingerprint.toLowerCase());
    if (found) return found;
    if (page.nextCursor === null || page.nextCursor === undefined) return null;
    cursor = page.nextCursor;
  }
  return null;
}

function selectRecipientPeerKey(peerKeys: readonly PgpPeerKeyRecord[]): PgpPeerKeyRecord | undefined {
  const trustPriority = new Map([
    ['verified', 0],
    ['tofu', 1],
    ['imported', 2],
  ]);
  return [...peerKeys]
    .filter((peerKey) => trustPriority.has(peerKey.trustLevel))
    .sort((a, b) => {
      const trust = (trustPriority.get(a.trustLevel) ?? 99) - (trustPriority.get(b.trustLevel) ?? 99);
      if (trust !== 0) return trust;
      return b.id - a.id;
    })[0];
}

function parsePgpPeerKeyMutationBody(
  body: unknown,
  options: {
    requireAtLeastOneField: boolean;
    requireEmail: boolean;
    requireFingerprint: boolean;
    requirePublicKeyArmor: boolean;
  },
): PgpPeerKeyMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_pgp_peer_key_payload', 'PGP peer key payload muss ein JSON-Objekt sein'),
    };
  }

  const values: PgpPeerKeyMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['email', 'fingerprint', 'publicKeyArmor', 'source', 'verifiedAt', 'trustLevel']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    const email = normalizeRequiredBodyText(body.email, 'email', 254);
    if (email.ok) values.email = email.value;
    else errors.push({ field: 'email', message: email.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'fingerprint')) {
    const fingerprint = normalizeRequiredBodyText(body.fingerprint, 'fingerprint', 200);
    if (fingerprint.ok) values.fingerprint = fingerprint.value;
    else errors.push({ field: 'fingerprint', message: fingerprint.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'publicKeyArmor')) {
    const publicKeyArmor = normalizeRequiredBodyText(body.publicKeyArmor, 'publicKeyArmor', 100000);
    if (publicKeyArmor.ok) values.publicKeyArmor = publicKeyArmor.value;
    else errors.push({ field: 'publicKeyArmor', message: publicKeyArmor.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'source')) {
    const source = normalizeRequiredBodyText(body.source, 'source', 100);
    if (source.ok) values.source = source.value;
    else errors.push({ field: 'source', message: source.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'verifiedAt')) {
    const verifiedAt = normalizeNullableBodyTimestamp(body.verifiedAt, 'verifiedAt');
    if (verifiedAt.ok) values.verifiedAt = verifiedAt.value;
    else errors.push({ field: 'verifiedAt', message: verifiedAt.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'trustLevel')) {
    const trustLevel = normalizeRequiredBodyText(body.trustLevel, 'trustLevel', 100);
    if (trustLevel.ok) values.trustLevel = trustLevel.value;
    else errors.push({ field: 'trustLevel', message: trustLevel.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'PGP peer key payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAtLeastOneField && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'PGP peer key mutation braucht mindestens ein Feld'),
    };
  }
  if (options.requireEmail && values.email === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'email ist erforderlich') };
  }
  if (options.requireFingerprint && values.fingerprint === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'fingerprint ist erforderlich') };
  }
  if (options.requirePublicKeyArmor && values.publicKeyArmor === undefined) {
    return { ok: false, response: error(400, 'validation_error', 'publicKeyArmor ist erforderlich') };
  }

  return { ok: true, values };
}

function parseLimit(value: string | undefined): number | null {
  if (value === undefined || value === '') return DEFAULT_LIMIT;
  const limit = parsePositiveInt(value);
  if (limit === null || limit > MAX_LIMIT) return null;
  return limit;
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  return parsePositiveInt(value);
}

function parsePositiveInt(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nonZeroIntFromPath(value: string | undefined): number | null {
  if (!value || !/^-?[1-9]\d*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function normalizeTextFilter(value: string | undefined, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? null : normalized;
}

function normalizePgpMessageAttachments(
  rawValue: unknown,
  field: string,
): { ok: true; value: PgpMessageAttachmentPayload[] } | { ok: false; fields: Array<{ field: string; message: string }> } {
  if (rawValue === undefined) return { ok: true, value: [] };
  if (!Array.isArray(rawValue)) {
    return { ok: false, fields: [{ field, message: `${field} muss eine Liste sein` }] };
  }
  if (rawValue.length > MAX_PGP_MESSAGE_ATTACHMENTS) {
    return {
      ok: false,
      fields: [{ field, message: `${field} darf maximal ${MAX_PGP_MESSAGE_ATTACHMENTS} Eintraege haben` }],
    };
  }

  const attachments: PgpMessageAttachmentPayload[] = [];
  const errors: Array<{ field: string; message: string }> = [];
  let totalBytes = 0;

  rawValue.forEach((item, index) => {
    const prefix = `${field}[${index}]`;
    if (!isPlainObject(item)) {
      errors.push({ field: prefix, message: 'Anhang muss ein JSON-Objekt sein' });
      return;
    }
    const allowedFields = new Set(['filename', 'contentType', 'contentBase64']);
    for (const key of Object.keys(item)) {
      if (!allowedFields.has(key)) errors.push({ field: `${prefix}.${key}`, message: 'Feld ist nicht erlaubt' });
    }

    const filename = normalizeRequiredBodyText(item.filename, `${prefix}.filename`, 260);
    if (!filename.ok) errors.push({ field: `${prefix}.filename`, message: filename.message });

    let contentType: string | undefined;
    if (Object.prototype.hasOwnProperty.call(item, 'contentType')) {
      if (item.contentType === undefined || item.contentType === null || item.contentType === '') {
        contentType = undefined;
      } else if (typeof item.contentType !== 'string') {
        errors.push({ field: `${prefix}.contentType`, message: `${prefix}.contentType muss ein String sein` });
      } else {
        const normalized = item.contentType.trim();
        if (normalized.length > 200) {
          errors.push({ field: `${prefix}.contentType`, message: `${prefix}.contentType darf maximal 200 Zeichen haben` });
        } else if (normalized) {
          contentType = normalized;
        }
      }
    }

    const content = normalizeBase64AttachmentContent(item.contentBase64, `${prefix}.contentBase64`);
    if (!content.ok) {
      errors.push({ field: `${prefix}.contentBase64`, message: content.message });
      return;
    }
    if (content.value.length > MAX_PGP_MESSAGE_ATTACHMENT_BYTES) {
      errors.push({
        field: `${prefix}.contentBase64`,
        message: `${prefix}.contentBase64 darf maximal ${MAX_PGP_MESSAGE_ATTACHMENT_BYTES} Bytes dekodieren`,
      });
      return;
    }
    totalBytes += content.value.length;
    if (filename.ok) {
      attachments.push({
        filename: filename.value,
        ...(contentType ? { contentType } : {}),
        bytes: content.value,
      });
    }
  });

  if (totalBytes > MAX_PGP_MESSAGE_ATTACHMENT_TOTAL_BYTES) {
    errors.push({
      field,
      message: `${field} darf insgesamt maximal ${MAX_PGP_MESSAGE_ATTACHMENT_TOTAL_BYTES} Bytes dekodieren`,
    });
  }

  return errors.length > 0 ? { ok: false, fields: errors } : { ok: true, value: attachments };
}

function normalizeBase64AttachmentContent(
  rawValue: unknown,
  field: string,
): { ok: true; value: Buffer } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein Base64-String sein` };
  const normalized = rawValue.trim();
  if (!normalized) return { ok: false, message: `${field} darf nicht leer sein` };
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return { ok: false, message: `${field} muss valides Base64 sein` };
  }
  return { ok: true, value: Buffer.from(normalized, 'base64') };
}

function normalizeRequiredLiteralText(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String sein` };
  if (!rawValue.trim()) return { ok: false, message: `${field} darf nicht leer sein` };
  if (rawValue.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value: rawValue };
}

function normalizeRecipientEmailList(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string[] } | { ok: false; message: string } {
  if (!Array.isArray(rawValue)) return { ok: false, message: `${field} muss eine Liste sein` };
  if (rawValue.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Eintraege haben` };
  const emails: string[] = [];
  for (const rawEmail of rawValue) {
    if (typeof rawEmail !== 'string') return { ok: false, message: `${field} darf nur Strings enthalten` };
    const email = rawEmail.trim();
    if (!email) return { ok: false, message: `${field} darf keine leeren Eintraege enthalten` };
    if (email.length > 254) return { ok: false, message: `${field} darf keine E-Mail ueber 254 Zeichen enthalten` };
    if (!emails.includes(email)) emails.push(email);
  }
  if (emails.length === 0) return { ok: false, message: `${field} darf nicht leer sein` };
  return { ok: true, value: emails };
}

function normalizeRequiredBodyText(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String sein` };
  const value = rawValue.trim();
  if (!value) return { ok: false, message: `${field} darf nicht leer sein` };
  if (value.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value };
}

function normalizeRequiredSecretText(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String sein` };
  if (!rawValue.trim()) return { ok: false, message: `${field} darf nicht leer sein` };
  if (rawValue.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value: rawValue };
}

function normalizePositiveBodyInt(
  rawValue: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { ok: false, message: `${field} muss eine positive Ganzzahl sein` };
  }
  return { ok: true, value };
}

function normalizeNullableBodyTimestamp(
  rawValue: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String oder null sein` };
  const value = rawValue.trim();
  if (!value) return { ok: true, value: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false, message: `${field} muss ein valides Datum sein` };
  return { ok: true, value: date.toISOString() };
}

function normalizeBodyBoolean(
  rawValue: unknown,
  field: string,
): { ok: true; value: boolean } | { ok: false; message: string } {
  if (typeof rawValue !== 'boolean') return { ok: false, message: `${field} muss ein Boolean sein` };
  return { ok: true, value: rawValue };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function resourceLabel(resource: PgpResource): 'PGP identity' | 'PGP peer key' {
  switch (resource) {
    case 'identities':
      return 'PGP identity';
    case 'peerKeys':
      return 'PGP peer key';
    default:
      return assertNever(resource);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected PGP resource: ${value}`);
}
