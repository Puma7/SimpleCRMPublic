import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
  CanonicalApiRoute,
  CanonicalApiRouteRegistration,
  EmailAccountSignatureMutationInput,
  EmailAccountSignatureRecord,
  EmailCannedResponseMutationInput,
  EmailCannedResponseRecord,
  EmailCategoryCountRecord,
  EmailCategoryMutationInput,
  EmailCategoryRecord,
  EmailCategoryReorderItem,
  EmailFolderRecord,
  EmailInternalNoteMutationInput,
  EmailInternalNoteRecord,
  EmailMessageCategoryMutationInput,
  EmailMessageCategoryRecord,
  EmailMessageTagMutationInput,
  EmailMessageTagRecord,
  EmailNumericCursorListResult,
  EmailReadReceiptRecord,
  EmailReadReceiptMutationInput,
  EmailRemoteContentAllowlistMutationInput,
  EmailRemoteContentAllowlistRecord,
  EmailStringCursorListResult,
  EmailTeamMemberMutationInput,
  EmailTeamMemberRecord,
  EmailThreadAliasMutationInput,
  EmailThreadAliasRecord,
  EmailThreadAliasWarningRecord,
  EmailThreadEdgeMutationInput,
  EmailThreadEdgeRecord,
  EmailThreadRecord,
  ServerApiPorts,
} from './types';
import {
  data,
  error,
  positiveIntFromPath,
  requirePrincipal,
} from './http';

const DEFAULT_METADATA_LIMIT = 50;
const MAX_METADATA_LIMIT = 100;

type ParseResult<TFilters extends object> =
  | { ok: true; filters: TFilters }
  | { ok: false; response: ApiResponse };

type EmailInternalNoteMutationParseResult =
  | { ok: true; values: EmailInternalNoteMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailMessageTagMutationParseResult =
  | { ok: true; values: EmailMessageTagMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailCategoryMutationParseResult =
  | { ok: true; values: EmailCategoryMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailCategoryReorderParseResult =
  | { ok: true; updates: EmailCategoryReorderItem[] }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailMessageCategoryMutationParseResult =
  | { ok: true; values: EmailMessageCategoryMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailCannedResponseMutationParseResult =
  | { ok: true; values: EmailCannedResponseMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailRemoteContentAllowlistMutationParseResult =
  | { ok: true; values: EmailRemoteContentAllowlistMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailTeamMemberMutationParseResult =
  | { ok: true; values: EmailTeamMemberMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailThreadEdgeMutationParseResult =
  | { ok: true; values: EmailThreadEdgeMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailThreadAliasMutationParseResult =
  | { ok: true; values: EmailThreadAliasMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailThreadMergeParseResult =
  | {
    ok: true;
    values: {
      aliasThreadId: string;
      canonicalThreadId: string;
      accountId: number;
    };
  }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailThreadSplitParseResult =
  | { ok: true; values: { messageId: number } }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailAccountSignatureMutationParseResult =
  | { ok: true; values: EmailAccountSignatureMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type EmailReadReceiptMutationParseResult =
  | { ok: true; values: EmailReadReceiptMutationInput }
  | { ok: false; response: ApiResponse<ApiErrorBody> };

type AnyNumericPort<TRecord> = {
  list(input: Record<string, unknown>): Promise<EmailNumericCursorListResult<TRecord>>;
  get(input: { workspaceId: string; id: number }): Promise<TRecord | null>;
};

type AnyStringPort<TRecord> = {
  list(input: Record<string, unknown>): Promise<EmailStringCursorListResult<TRecord>>;
  get(input: { workspaceId: string; id: string }): Promise<TRecord | null>;
};

type NumericResourceConfig<TRecord> = Readonly<{
  listPath: string;
  idPattern: RegExp;
  portName: keyof ServerApiPorts;
  unavailableCode: string;
  unavailableMessage: string;
  invalidIdCode: string;
  invalidIdMessage: string;
  notFoundCode: string;
  notFoundMessage: string;
  parseBase?: (req: ApiRequest) => ParseResult<{ cursor?: number; limit: number }>;
  parseFilters: (req: ApiRequest) => ParseResult<Record<string, unknown>>;
  parseId?: (rawId: string | undefined) => number | null;
  sanitize: (record: TRecord) => TRecord;
}>;

type StringResourceConfig<TRecord> = Readonly<{
  listPath: string;
  idPattern: RegExp;
  portName: keyof ServerApiPorts;
  unavailableCode: string;
  unavailableMessage: string;
  invalidIdCode: string;
  invalidIdMessage: string;
  notFoundCode: string;
  notFoundMessage: string;
  parseFilters: (req: ApiRequest) => ParseResult<Record<string, unknown>>;
  sanitize: (record: TRecord) => TRecord;
}>;

const numericResourceRoutes: readonly NumericResourceConfig<any>[] = [
  {
    listPath: '/api/v1/email/folders',
    idPattern: /^\/api\/v1\/email\/folders\/([^/]+)$/,
    portName: 'emailFolders',
    unavailableCode: 'email_folders_unavailable',
    unavailableMessage: 'Email folder API nicht konfiguriert',
    invalidIdCode: 'invalid_email_folder_id',
    invalidIdMessage: 'email folder id muss eine positive Ganzzahl sein',
    notFoundCode: 'email_folder_not_found',
    notFoundMessage: 'Email folder nicht gefunden',
    parseFilters: parseFolderFilters,
    sanitize: sanitizeEmailFolder,
  },
  {
    listPath: '/api/v1/email/tags',
    idPattern: /^\/api\/v1\/email\/tags\/([^/]+)$/,
    portName: 'emailMessageTags',
    unavailableCode: 'email_message_tags_unavailable',
    unavailableMessage: 'Email tag API nicht konfiguriert',
    invalidIdCode: 'invalid_email_tag_id',
    invalidIdMessage: 'email tag id muss eine positive Ganzzahl sein',
    notFoundCode: 'email_tag_not_found',
    notFoundMessage: 'Email tag nicht gefunden',
    parseFilters: parseMessageTagFilters,
    sanitize: sanitizeEmailMessageTag,
  },
  {
    listPath: '/api/v1/email/categories',
    idPattern: /^\/api\/v1\/email\/categories\/([^/]+)$/,
    portName: 'emailCategories',
    unavailableCode: 'email_categories_unavailable',
    unavailableMessage: 'Email category API nicht konfiguriert',
    invalidIdCode: 'invalid_email_category_id',
    invalidIdMessage: 'email category id muss eine positive Ganzzahl sein',
    notFoundCode: 'email_category_not_found',
    notFoundMessage: 'Email category nicht gefunden',
    parseFilters: parseCategoryFilters,
    sanitize: sanitizeEmailCategory,
  },
  {
    listPath: '/api/v1/email/message-categories',
    idPattern: /^\/api\/v1\/email\/message-categories\/([^/]+)$/,
    portName: 'emailMessageCategories',
    unavailableCode: 'email_message_categories_unavailable',
    unavailableMessage: 'Email message category API nicht konfiguriert',
    invalidIdCode: 'invalid_email_message_category_id',
    invalidIdMessage: 'email message category id muss eine positive Ganzzahl sein',
    notFoundCode: 'email_message_category_not_found',
    notFoundMessage: 'Email message category nicht gefunden',
    parseFilters: parseMessageCategoryFilters,
    sanitize: sanitizeEmailMessageCategory,
  },
  {
    listPath: '/api/v1/email/internal-notes',
    idPattern: /^\/api\/v1\/email\/internal-notes\/([^/]+)$/,
    portName: 'emailInternalNotes',
    unavailableCode: 'email_internal_notes_unavailable',
    unavailableMessage: 'Email internal note API nicht konfiguriert',
    invalidIdCode: 'invalid_email_internal_note_id',
    invalidIdMessage: 'email internal note id muss eine positive Ganzzahl sein',
    notFoundCode: 'email_internal_note_not_found',
    notFoundMessage: 'Email internal note nicht gefunden',
    parseFilters: parseInternalNoteFilters,
    sanitize: sanitizeEmailInternalNote,
  },
  {
    listPath: '/api/v1/email/canned-responses',
    idPattern: /^\/api\/v1\/email\/canned-responses\/([^/]+)$/,
    portName: 'emailCannedResponses',
    unavailableCode: 'email_canned_responses_unavailable',
    unavailableMessage: 'Email canned response API nicht konfiguriert',
    invalidIdCode: 'invalid_email_canned_response_id',
    invalidIdMessage: 'email canned response id muss eine positive Ganzzahl sein',
    notFoundCode: 'email_canned_response_not_found',
    notFoundMessage: 'Email canned response nicht gefunden',
    parseFilters: parseCannedResponseFilters,
    sanitize: sanitizeEmailCannedResponse,
  },
  {
    listPath: '/api/v1/email/account-signatures',
    idPattern: /^\/api\/v1\/email\/account-signatures\/([^/]+)$/,
    portName: 'emailAccountSignatures',
    unavailableCode: 'email_account_signatures_unavailable',
    unavailableMessage: 'Email account signature API nicht konfiguriert',
    invalidIdCode: 'invalid_email_account_signature_id',
    invalidIdMessage: 'email account signature id muss eine Ganzzahl ungleich 0 sein',
    notFoundCode: 'email_account_signature_not_found',
    notFoundMessage: 'Email account signature nicht gefunden',
    parseBase: parseSignedNumericListBase,
    parseFilters: parseAccountSignatureFilters,
    parseId: sourceSqliteIdFromPath,
    sanitize: sanitizeEmailAccountSignature,
  },
  {
    listPath: '/api/v1/email/remote-content-allowlist',
    idPattern: /^\/api\/v1\/email\/remote-content-allowlist\/([^/]+)$/,
    portName: 'emailRemoteContentAllowlist',
    unavailableCode: 'email_remote_content_allowlist_unavailable',
    unavailableMessage: 'Email remote-content allowlist API nicht konfiguriert',
    invalidIdCode: 'invalid_email_remote_content_allowlist_id',
    invalidIdMessage: 'email remote-content allowlist id muss eine positive Ganzzahl sein',
    notFoundCode: 'email_remote_content_allowlist_entry_not_found',
    notFoundMessage: 'Email remote-content allowlist entry nicht gefunden',
    parseFilters: parseRemoteContentAllowlistFilters,
    sanitize: sanitizeEmailRemoteContentAllowlist,
  },
  {
    listPath: '/api/v1/email/read-receipts',
    idPattern: /^\/api\/v1\/email\/read-receipts\/([^/]+)$/,
    portName: 'emailReadReceipts',
    unavailableCode: 'email_read_receipts_unavailable',
    unavailableMessage: 'Email read receipt API nicht konfiguriert',
    invalidIdCode: 'invalid_email_read_receipt_id',
    invalidIdMessage: 'email read receipt id muss eine positive Ganzzahl sein',
    notFoundCode: 'email_read_receipt_not_found',
    notFoundMessage: 'Email read receipt nicht gefunden',
    parseFilters: parseReadReceiptFilters,
    sanitize: sanitizeEmailReadReceipt,
  },
  {
    listPath: '/api/v1/email/thread-edges',
    idPattern: /^\/api\/v1\/email\/thread-edges\/([^/]+)$/,
    portName: 'emailThreadEdges',
    unavailableCode: 'email_thread_edges_unavailable',
    unavailableMessage: 'Email thread edge API nicht konfiguriert',
    invalidIdCode: 'invalid_email_thread_edge_id',
    invalidIdMessage: 'email thread edge id muss eine positive Ganzzahl sein',
    notFoundCode: 'email_thread_edge_not_found',
    notFoundMessage: 'Email thread edge nicht gefunden',
    parseFilters: parseThreadEdgeFilters,
    sanitize: sanitizeEmailThreadEdge,
  },
  {
    listPath: '/api/v1/email/thread-aliases',
    idPattern: /^\/api\/v1\/email\/thread-aliases\/([^/]+)$/,
    portName: 'emailThreadAliases',
    unavailableCode: 'email_thread_aliases_unavailable',
    unavailableMessage: 'Email thread alias API nicht konfiguriert',
    invalidIdCode: 'invalid_email_thread_alias_id',
    invalidIdMessage: 'email thread alias id muss eine positive Ganzzahl sein',
    notFoundCode: 'email_thread_alias_not_found',
    notFoundMessage: 'Email thread alias nicht gefunden',
    parseFilters: parseThreadAliasFilters,
    sanitize: sanitizeEmailThreadAlias,
  },
];

const stringResourceRoutes: readonly StringResourceConfig<any>[] = [
  {
    listPath: '/api/v1/email/team-members',
    idPattern: /^\/api\/v1\/email\/team-members\/([^/]+)$/,
    portName: 'emailTeamMembers',
    unavailableCode: 'email_team_members_unavailable',
    unavailableMessage: 'Email team member API nicht konfiguriert',
    invalidIdCode: 'invalid_email_team_member_id',
    invalidIdMessage: 'email team member id ist ungueltig',
    notFoundCode: 'email_team_member_not_found',
    notFoundMessage: 'Email team member nicht gefunden',
    parseFilters: parseTeamMemberFilters,
    sanitize: sanitizeEmailTeamMember,
  },
  {
    listPath: '/api/v1/email/threads',
    idPattern: /^\/api\/v1\/email\/threads\/([^/]+)$/,
    portName: 'emailThreads',
    unavailableCode: 'email_threads_unavailable',
    unavailableMessage: 'Email thread API nicht konfiguriert',
    invalidIdCode: 'invalid_email_thread_id',
    invalidIdMessage: 'email thread id ist ungueltig',
    notFoundCode: 'email_thread_not_found',
    notFoundMessage: 'Email thread nicht gefunden',
    parseFilters: parseThreadFilters,
    sanitize: sanitizeEmailThread,
  },
];

type MailMetadataRouteHandler = (
  req: ApiRequest,
  ports: ServerApiPorts,
  params: readonly string[],
) => Promise<ApiResponse>;

type MailMetadataRouteRegistration = Readonly<{
  registration: CanonicalApiRouteRegistration;
  dispatchMethods?: readonly ApiRequest['method'][];
  handler: MailMetadataRouteHandler;
}>;

function metadataRoute(
  path: string,
  methods: CanonicalApiRouteRegistration['methods'],
  pattern: RegExp,
  handler: MailMetadataRouteHandler,
  dispatchMethods?: readonly ApiRequest['method'][],
): MailMetadataRouteRegistration {
  return {
    registration: { path, methods, pattern },
    handler,
    ...(dispatchMethods ? { dispatchMethods } : {}),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const metadataSpecialRouteRegistrations: readonly MailMetadataRouteRegistration[] = [
  metadataRoute('/api/v1/email/messages/:messageId/tags', ['GET', 'POST', 'DELETE'], /^\/api\/v1\/email\/messages\/([^/]+)\/tags$/, (req, ports, params) => {
    if (req.method === 'DELETE') return handleDeleteEmailMessageTagForMessage(req, ports, params[0]);
    if (req.method === 'POST') return handleCreateEmailMessageTag(req, ports, params[0]);
    return handleMessageScopedNumericList(req, ports.emailMessageTags, params[0], {
      unavailableCode: 'email_message_tags_unavailable',
      unavailableMessage: 'Email tag API nicht konfiguriert',
      sanitize: sanitizeEmailMessageTag,
    });
  }),
  metadataRoute('/api/v1/email/messages/:messageId/categories', ['GET', 'POST'], /^\/api\/v1\/email\/messages\/([^/]+)\/categories$/, (req, ports, params) => (
    req.method === 'POST'
      ? handleCreateEmailMessageCategory(req, ports, params[0])
      : handleMessageScopedNumericList(req, ports.emailMessageCategories, params[0], {
        unavailableCode: 'email_message_categories_unavailable',
        unavailableMessage: 'Email message category API nicht konfiguriert',
        sanitize: sanitizeEmailMessageCategory,
      })
  )),
  metadataRoute('/api/v1/email/messages/:messageId/internal-notes', ['GET', 'POST'], /^\/api\/v1\/email\/messages\/([^/]+)\/internal-notes$/, (req, ports, params) => (
    req.method === 'POST'
      ? handleCreateEmailInternalNote(req, ports, params[0])
      : handleMessageScopedNumericList(req, ports.emailInternalNotes, params[0], {
        unavailableCode: 'email_internal_notes_unavailable',
        unavailableMessage: 'Email internal note API nicht konfiguriert',
        sanitize: sanitizeEmailInternalNote,
      })
  )),
  metadataRoute('/api/v1/email/internal-notes', ['POST'], /^\/api\/v1\/email\/internal-notes$/, (req, ports) => handleCreateEmailInternalNote(req, ports), ['POST']),
  metadataRoute('/api/v1/email/internal-notes/:id', ['PATCH', 'DELETE'], /^\/api\/v1\/email\/internal-notes\/([^/]+)$/, (req, ports, params) => (
    req.method === 'PATCH'
      ? handleUpdateEmailInternalNote(req, ports, params[0])
      : handleDeleteEmailInternalNote(req, ports, params[0])
  ), ['PATCH', 'DELETE']),
  metadataRoute('/api/v1/email/tags', ['POST'], /^\/api\/v1\/email\/tags$/, (req, ports) => handleCreateEmailMessageTag(req, ports), ['POST']),
  metadataRoute('/api/v1/email/tags/:id', ['DELETE'], /^\/api\/v1\/email\/tags\/([^/]+)$/, (req, ports, params) => handleDeleteEmailMessageTag(req, ports, params[0]), ['DELETE']),
  metadataRoute('/api/v1/email/categories', ['POST'], /^\/api\/v1\/email\/categories$/, (req, ports) => handleCreateEmailCategory(req, ports), ['POST']),
  metadataRoute('/api/v1/email/categories/reorder', ['PATCH'], /^\/api\/v1\/email\/categories\/reorder$/, (req, ports) => handleReorderEmailCategories(req, ports)),
  metadataRoute('/api/v1/email/categories/:id', ['PATCH', 'DELETE'], /^\/api\/v1\/email\/categories\/([^/]+)$/, (req, ports, params) => (
    req.method === 'PATCH'
      ? handleUpdateEmailCategory(req, ports, params[0])
      : handleDeleteEmailCategory(req, ports, params[0])
  ), ['PATCH', 'DELETE']),
  metadataRoute('/api/v1/email/message-categories', ['POST'], /^\/api\/v1\/email\/message-categories$/, (req, ports) => handleCreateEmailMessageCategory(req, ports), ['POST']),
  metadataRoute('/api/v1/email/message-categories/:id', ['DELETE'], /^\/api\/v1\/email\/message-categories\/([^/]+)$/, (req, ports, params) => handleDeleteEmailMessageCategory(req, ports, params[0]), ['DELETE']),
  metadataRoute('/api/v1/email/canned-responses', ['POST'], /^\/api\/v1\/email\/canned-responses$/, (req, ports) => handleCreateEmailCannedResponse(req, ports), ['POST']),
  metadataRoute('/api/v1/email/canned-responses/:id', ['PATCH', 'DELETE'], /^\/api\/v1\/email\/canned-responses\/([^/]+)$/, (req, ports, params) => (
    req.method === 'PATCH'
      ? handleUpdateEmailCannedResponse(req, ports, params[0])
      : handleDeleteEmailCannedResponse(req, ports, params[0])
  ), ['PATCH', 'DELETE']),
  metadataRoute('/api/v1/email/remote-content-allowlist', ['POST'], /^\/api\/v1\/email\/remote-content-allowlist$/, (req, ports) => handleCreateEmailRemoteContentAllowlist(req, ports), ['POST']),
  metadataRoute('/api/v1/email/remote-content-allowlist/:id', ['PATCH', 'DELETE'], /^\/api\/v1\/email\/remote-content-allowlist\/([^/]+)$/, (req, ports, params) => (
    req.method === 'PATCH'
      ? handleUpdateEmailRemoteContentAllowlist(req, ports, params[0])
      : handleDeleteEmailRemoteContentAllowlist(req, ports, params[0])
  ), ['PATCH', 'DELETE']),
  metadataRoute('/api/v1/email/team-members', ['POST'], /^\/api\/v1\/email\/team-members$/, (req, ports) => handleCreateEmailTeamMember(req, ports), ['POST']),
  metadataRoute('/api/v1/email/team-members/:teamMemberId/upsert', ['POST'], /^\/api\/v1\/email\/team-members\/([^/]+)\/upsert$/, (req, ports, params) => handleUpsertEmailTeamMember(req, ports, params[0]), ['POST']),
  metadataRoute('/api/v1/email/team-members/:id', ['PATCH', 'DELETE'], /^\/api\/v1\/email\/team-members\/([^/]+)$/, (req, ports, params) => (
    req.method === 'PATCH'
      ? handleUpdateEmailTeamMember(req, ports, params[0])
      : handleDeleteEmailTeamMember(req, ports, params[0])
  ), ['PATCH', 'DELETE']),
  metadataRoute('/api/v1/email/thread-edges', ['POST'], /^\/api\/v1\/email\/thread-edges$/, (req, ports) => handleCreateEmailThreadEdge(req, ports), ['POST']),
  metadataRoute('/api/v1/email/thread-edges/:id', ['DELETE'], /^\/api\/v1\/email\/thread-edges\/([^/]+)$/, (req, ports, params) => handleDeleteEmailThreadEdge(req, ports, params[0]), ['DELETE']),
  metadataRoute('/api/v1/email/thread-aliases', ['POST'], /^\/api\/v1\/email\/thread-aliases$/, (req, ports) => handleCreateEmailThreadAlias(req, ports), ['POST']),
  metadataRoute('/api/v1/email/thread-aliases/:id', ['PATCH', 'DELETE'], /^\/api\/v1\/email\/thread-aliases\/([^/]+)$/, (req, ports, params) => (
    req.method === 'PATCH'
      ? handleUpdateEmailThreadAlias(req, ports, params[0])
      : handleDeleteEmailThreadAlias(req, ports, params[0])
  ), ['PATCH', 'DELETE']),
  metadataRoute('/api/v1/email/threads/split-message', ['POST'], /^\/api\/v1\/email\/threads\/split-message$/, (req, ports) => handleSplitEmailMessageThread(req, ports)),
  metadataRoute('/api/v1/email/threads/merge', ['POST'], /^\/api\/v1\/email\/threads\/merge$/, (req, ports) => handleMergeEmailThreads(req, ports)),
  metadataRoute('/api/v1/email/thread-alias-warnings', ['GET'], /^\/api\/v1\/email\/thread-alias-warnings$/, (req, ports) => handleListEmailThreadAliasWarnings(req, ports)),
  metadataRoute('/api/v1/email/account-signatures/by-account/:accountId/upsert', ['POST'], /^\/api\/v1\/email\/account-signatures\/by-account\/([^/]+)\/upsert$/, (req, ports, params) => handleUpsertEmailAccountSignatureByAccount(req, ports, params[0]), ['POST']),
  metadataRoute('/api/v1/email/account-signatures', ['POST'], /^\/api\/v1\/email\/account-signatures$/, (req, ports) => handleCreateEmailAccountSignature(req, ports), ['POST']),
  metadataRoute('/api/v1/email/account-signatures/:id', ['PATCH', 'DELETE'], /^\/api\/v1\/email\/account-signatures\/([^/]+)$/, (req, ports, params) => (
    req.method === 'PATCH'
      ? handleUpdateEmailAccountSignature(req, ports, params[0])
      : handleDeleteEmailAccountSignature(req, ports, params[0])
  ), ['PATCH', 'DELETE']),
  metadataRoute('/api/v1/email/read-receipts', ['POST'], /^\/api\/v1\/email\/read-receipts$/, (req, ports) => handleCreateEmailReadReceipt(req, ports), ['POST']),
  metadataRoute('/api/v1/email/category-counts', ['GET'], /^\/api\/v1\/email\/category-counts$/, (req, ports) => handleListEmailCategoryCounts(req, ports)),
];

const metadataGenericRouteRegistrations: readonly MailMetadataRouteRegistration[] = [
  ...numericResourceRoutes.flatMap((route) => [
    metadataRoute(route.listPath, ['GET'], new RegExp(`^${escapeRegExp(route.listPath)}$`), (req, ports) => handleNumericList(req, ports, route)),
    metadataRoute(`${route.listPath}/:id`, ['GET'], route.idPattern, (req, ports, params) => handleNumericGet(req, ports, route, params[0])),
  ]),
  ...stringResourceRoutes.flatMap((route) => [
    metadataRoute(route.listPath, ['GET'], new RegExp(`^${escapeRegExp(route.listPath)}$`), (req, ports) => handleStringList(req, ports, route)),
    metadataRoute(`${route.listPath}/:id`, ['GET'], route.idPattern, (req, ports, params) => handleStringGet(req, ports, route, params[0])),
  ]),
];

export const MAIL_METADATA_ROUTE_REGISTRATIONS: readonly MailMetadataRouteRegistration[] = Object.freeze([
  ...metadataSpecialRouteRegistrations,
  ...metadataGenericRouteRegistrations,
]);

export const MAIL_METADATA_ROUTE_INVENTORY: readonly CanonicalApiRoute[] = Object.freeze(
  MAIL_METADATA_ROUTE_REGISTRATIONS.flatMap(({ registration }) => registration.methods.map((method) => ({
    source: 'mail-metadata-routes',
    method,
    path: registration.path,
    pattern: registration.pattern,
  }))),
);

export async function handleMailMetadataReadRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  for (const { registration, dispatchMethods, handler } of MAIL_METADATA_ROUTE_REGISTRATIONS) {
    if (dispatchMethods && !dispatchMethods.includes(req.method)) continue;
    const match = registration.pattern.exec(req.path);
    if (match) return handler(req, ports, match.slice(1));
  }

  return null;
}

async function handleListEmailCategoryCounts(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return error(400, 'invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  if (!ports.emailMessageCategories?.listCounts) {
    return error(503, 'email_message_categories_unavailable', 'Email message category API nicht konfiguriert');
  }

  const rows = await ports.emailMessageCategories.listCounts({
    workspaceId: principal.workspaceId,
    ...(accountId === undefined ? {} : { accountId }),
  });
  return data(200, rows.map(sanitizeEmailCategoryCount));
}

async function handleNumericList<TRecord>(
  req: ApiRequest,
  ports: ServerApiPorts,
  route: NumericResourceConfig<TRecord>,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const base = (route.parseBase ?? parseNumericListBase)(req);
  if (!base.ok) return base.response;
  const parsed = route.parseFilters(req);
  if (!parsed.ok) return parsed.response;

  const port = ports[route.portName] as AnyNumericPort<TRecord> | undefined;
  if (!port) return error(503, route.unavailableCode, route.unavailableMessage);
  const result = await port.list({
    workspaceId: principal.workspaceId,
    ...base.filters,
    ...parsed.filters,
  });
  return data(200, sanitizeNumericList(result, route.sanitize));
}

async function handleNumericGet<TRecord>(
  req: ApiRequest,
  ports: ServerApiPorts,
  route: NumericResourceConfig<TRecord>,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = (route.parseId ?? positiveIntFromPath)(rawId);
  if (id === null) return error(400, route.invalidIdCode, route.invalidIdMessage);

  const port = ports[route.portName] as AnyNumericPort<TRecord> | undefined;
  if (!port) return error(503, route.unavailableCode, route.unavailableMessage);
  const item = await port.get({ workspaceId: principal.workspaceId, id });
  return item ? data(200, route.sanitize(item)) : error(404, route.notFoundCode, route.notFoundMessage);
}

async function handleListEmailThreadAliasWarnings(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const limit = parseLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_METADATA_LIMIT} liegen`);
  if (!ports.emailThreadAliases?.listWarnings) {
    return error(503, 'email_thread_alias_warnings_unavailable', 'Email thread alias warning API nicht konfiguriert');
  }
  const warnings = await ports.emailThreadAliases.listWarnings({
    workspaceId: principal.workspaceId,
    limit,
  });
  return data(200, {
    items: warnings.map(sanitizeEmailThreadAliasWarning),
    nextCursor: null,
  });
}

async function handleStringList<TRecord>(
  req: ApiRequest,
  ports: ServerApiPorts,
  route: StringResourceConfig<TRecord>,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;

  const base = parseStringListBase(req);
  if (!base.ok) return base.response;
  const parsed = route.parseFilters(req);
  if (!parsed.ok) return parsed.response;

  const port = ports[route.portName] as AnyStringPort<TRecord> | undefined;
  if (!port) return error(503, route.unavailableCode, route.unavailableMessage);
  const result = await port.list({
    workspaceId: principal.workspaceId,
    ...base.filters,
    ...parsed.filters,
  });
  return data(200, sanitizeStringList(result, route.sanitize));
}

async function handleStringGet<TRecord>(
  req: ApiRequest,
  ports: ServerApiPorts,
  route: StringResourceConfig<TRecord>,
  rawId: string | undefined,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = textIdFromPath(rawId, 300);
  if (id === null) return error(400, route.invalidIdCode, route.invalidIdMessage);

  const port = ports[route.portName] as AnyStringPort<TRecord> | undefined;
  if (!port) return error(503, route.unavailableCode, route.unavailableMessage);
  const item = await port.get({ workspaceId: principal.workspaceId, id });
  return item ? data(200, route.sanitize(item)) : error(404, route.notFoundCode, route.notFoundMessage);
}

async function handleMessageScopedNumericList<TRecord>(
  req: ApiRequest,
  port: AnyNumericPort<TRecord> | undefined,
  rawMessageId: string | undefined,
  config: Readonly<{
    unavailableCode: string;
    unavailableMessage: string;
    sanitize: (record: TRecord) => TRecord;
  }>,
): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawMessageId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');

  const base = parseNumericListBase(req);
  if (!base.ok) return base.response;
  if (!port) return error(503, config.unavailableCode, config.unavailableMessage);
  const result = await port.list({
    workspaceId: principal.workspaceId,
    ...base.filters,
    messageId,
  });
  return data(200, sanitizeNumericList(result, config.sanitize));
}

async function handleCreateEmailMessageTag(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawMessageId?: string,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailMessageTags?.create) {
    return error(503, 'email_message_tags_unavailable', 'Email tag API nicht konfiguriert');
  }

  const pathMessageId = rawMessageId === undefined ? undefined : positiveIntFromPath(rawMessageId);
  if (pathMessageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  const parsed = parseEmailMessageTagMutationBody(req.body, {
    requireMessage: pathMessageId === undefined,
    pathMessageId,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailMessageTags.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) {
    if (result.code === 'message_not_found') return error(404, 'email_message_not_found', 'Email message nicht gefunden');
    return error(409, 'email_tag_conflict', 'Email tag existiert bereits fuer diese Message');
  }

  const tag = result.tag;
  await auditEmailMessageTag(ports, principal, 'email_message_tag.created', tag, { messageId: tag.messageId, tag: tag.tag });
  await publishEmailMessageTag(ports, principal.workspaceId, 'email_message_tag.created', tag, principal.userId);
  return data(201, sanitizeEmailMessageTag(tag));
}

async function handleDeleteEmailMessageTag(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_tag_id', 'email tag id muss eine positive Ganzzahl sein');
  if (!ports.emailMessageTags?.delete) {
    return error(503, 'email_message_tags_unavailable', 'Email tag API nicht konfiguriert');
  }

  const tag = await ports.emailMessageTags.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!tag) return error(404, 'email_tag_not_found', 'Email tag nicht gefunden');

  await auditEmailMessageTag(ports, principal, 'email_message_tag.deleted', tag, { messageId: tag.messageId, tag: tag.tag });
  await publishEmailMessageTag(ports, principal.workspaceId, 'email_message_tag.deleted', tag, principal.userId);
  return data(200, { deleted: true, tag: sanitizeEmailMessageTag(tag) });
}

async function handleDeleteEmailMessageTagForMessage(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawMessageId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const messageId = positiveIntFromPath(rawMessageId);
  if (messageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  if (!ports.emailMessageTags?.list || !ports.emailMessageTags.delete) {
    return error(503, 'email_message_tags_unavailable', 'Email tag API nicht konfiguriert');
  }
  const tag = normalizeTextFilter(req.query?.tag, 200)?.trim();
  if (!tag) return error(400, 'invalid_email_tag', 'tag muss gesetzt sein und darf maximal 200 Zeichen haben');

  const existing = await ports.emailMessageTags.list({
    workspaceId: principal.workspaceId,
    limit: 1,
    messageId,
    tag,
  });
  const target = existing.items[0];
  if (!target) return error(404, 'email_tag_not_found', 'Email tag nicht gefunden');

  const deleted = await ports.emailMessageTags.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id: target.id,
  });
  if (!deleted) return error(404, 'email_tag_not_found', 'Email tag nicht gefunden');

  await auditEmailMessageTag(ports, principal, 'email_message_tag.deleted', deleted, { messageId: deleted.messageId, tag: deleted.tag });
  await publishEmailMessageTag(ports, principal.workspaceId, 'email_message_tag.deleted', deleted, principal.userId);
  return data(200, { deleted: true, tag: sanitizeEmailMessageTag(deleted) });
}

async function handleCreateEmailCategory(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailCategories?.create) {
    return error(503, 'email_categories_unavailable', 'Email category API nicht konfiguriert');
  }

  const parsed = parseEmailCategoryMutationBody(req.body, {
    requireName: true,
    requireAny: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailCategories.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return emailCategoryMutationError(result.code);

  const category = result.category;
  await auditEmailCategory(ports, principal, 'email_category.created', category, { parentId: category.parentId });
  await publishEmailCategory(ports, principal.workspaceId, 'email_category.created', category, principal.userId);
  return data(201, sanitizeEmailCategory(category));
}

async function handleUpdateEmailCategory(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_category_id', 'email category id muss eine positive Ganzzahl sein');
  if (!ports.emailCategories?.update) {
    return error(503, 'email_categories_unavailable', 'Email category API nicht konfiguriert');
  }

  const parsed = parseEmailCategoryMutationBody(req.body, {
    requireName: false,
    requireAny: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailCategories.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'email_category_not_found', 'Email category nicht gefunden');
  if (!result.ok) return emailCategoryMutationError(result.code);

  const category = result.category;
  await auditEmailCategory(ports, principal, 'email_category.updated', category, { fields: Object.keys(parsed.values).sort() });
  await publishEmailCategory(ports, principal.workspaceId, 'email_category.updated', category, principal.userId);
  return data(200, sanitizeEmailCategory(category));
}

async function handleReorderEmailCategories(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailCategories?.reorder) {
    return error(503, 'email_categories_unavailable', 'Email category API nicht konfiguriert');
  }

  const parsed = parseEmailCategoryReorderBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailCategories.reorder({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    updates: parsed.updates,
  });
  if (!result.ok) {
    if (result.code === 'category_not_found') {
      return error(404, 'email_category_not_found', 'Email category nicht gefunden');
    }
    return emailCategoryMutationError(result.code);
  }

  for (const category of result.categories) {
    await auditEmailCategory(ports, principal, 'email_category.updated', category, {
      fields: ['parentId', 'sortOrder'],
      source: 'bulk_reorder',
    });
    await publishEmailCategory(ports, principal.workspaceId, 'email_category.updated', category, principal.userId);
  }
  return data(200, { success: true, items: result.categories.map(sanitizeEmailCategory) });
}

async function handleDeleteEmailCategory(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_category_id', 'email category id muss eine positive Ganzzahl sein');
  if (!ports.emailCategories?.delete) {
    return error(503, 'email_categories_unavailable', 'Email category API nicht konfiguriert');
  }

  const category = await ports.emailCategories.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!category) return error(404, 'email_category_not_found', 'Email category nicht gefunden');

  await auditEmailCategory(ports, principal, 'email_category.deleted', category, { parentId: category.parentId });
  await publishEmailCategory(ports, principal.workspaceId, 'email_category.deleted', category, principal.userId);
  return data(200, { deleted: true, category: sanitizeEmailCategory(category) });
}

async function handleCreateEmailMessageCategory(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawMessageId?: string,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailMessageCategories?.create) {
    return error(503, 'email_message_categories_unavailable', 'Email message category API nicht konfiguriert');
  }

  const pathMessageId = rawMessageId === undefined ? undefined : positiveIntFromPath(rawMessageId);
  if (pathMessageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  const parsed = parseEmailMessageCategoryMutationBody(req.body, {
    requireMessage: pathMessageId === undefined,
    pathMessageId,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailMessageCategories.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) {
    if (result.code === 'message_not_found') return error(404, 'email_message_not_found', 'Email message nicht gefunden');
    if (result.code === 'category_not_found') return error(404, 'email_category_not_found', 'Email category nicht gefunden');
    return error(409, 'email_message_category_conflict', 'Email category ist dieser Message bereits zugeordnet');
  }

  const category = result.category;
  await auditEmailMessageCategory(ports, principal, 'email_message_category.created', category, {
    messageId: category.messageId,
    categoryId: category.categoryId,
  });
  await publishEmailMessageCategory(ports, principal.workspaceId, 'email_message_category.created', category, principal.userId);
  return data(201, sanitizeEmailMessageCategory(category));
}

async function handleDeleteEmailMessageCategory(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_message_category_id', 'email message category id muss eine positive Ganzzahl sein');
  if (!ports.emailMessageCategories?.delete) {
    return error(503, 'email_message_categories_unavailable', 'Email message category API nicht konfiguriert');
  }

  const category = await ports.emailMessageCategories.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!category) return error(404, 'email_message_category_not_found', 'Email message category nicht gefunden');

  await auditEmailMessageCategory(ports, principal, 'email_message_category.deleted', category, {
    messageId: category.messageId,
    categoryId: category.categoryId,
  });
  await publishEmailMessageCategory(ports, principal.workspaceId, 'email_message_category.deleted', category, principal.userId);
  return data(200, { deleted: true, messageCategory: sanitizeEmailMessageCategory(category) });
}

async function handleCreateEmailCannedResponse(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailCannedResponses?.create) {
    return error(503, 'email_canned_responses_unavailable', 'Email canned response API nicht konfiguriert');
  }

  const parsed = parseEmailCannedResponseMutationBody(req.body, {
    requireTitle: true,
    requireBody: true,
    requireAny: false,
  });
  if (!parsed.ok) return parsed.response;

  const response = await ports.emailCannedResponses.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  await auditEmailCannedResponse(ports, principal, 'email_canned_response.created', response, { title: response.title });
  await publishEmailCannedResponse(ports, principal.workspaceId, 'email_canned_response.created', response, principal.userId);
  return data(201, sanitizeEmailCannedResponse(response));
}

async function handleUpdateEmailCannedResponse(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_canned_response_id', 'email canned response id muss eine positive Ganzzahl sein');
  if (!ports.emailCannedResponses?.update) {
    return error(503, 'email_canned_responses_unavailable', 'Email canned response API nicht konfiguriert');
  }

  const parsed = parseEmailCannedResponseMutationBody(req.body, {
    requireTitle: false,
    requireBody: false,
    requireAny: true,
  });
  if (!parsed.ok) return parsed.response;

  const response = await ports.emailCannedResponses.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!response) return error(404, 'email_canned_response_not_found', 'Email canned response nicht gefunden');

  await auditEmailCannedResponse(ports, principal, 'email_canned_response.updated', response, { fields: Object.keys(parsed.values).sort() });
  await publishEmailCannedResponse(ports, principal.workspaceId, 'email_canned_response.updated', response, principal.userId);
  return data(200, sanitizeEmailCannedResponse(response));
}

async function handleDeleteEmailCannedResponse(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_canned_response_id', 'email canned response id muss eine positive Ganzzahl sein');
  if (!ports.emailCannedResponses?.delete) {
    return error(503, 'email_canned_responses_unavailable', 'Email canned response API nicht konfiguriert');
  }

  const response = await ports.emailCannedResponses.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!response) return error(404, 'email_canned_response_not_found', 'Email canned response nicht gefunden');

  await auditEmailCannedResponse(ports, principal, 'email_canned_response.deleted', response, { title: response.title });
  await publishEmailCannedResponse(ports, principal.workspaceId, 'email_canned_response.deleted', response, principal.userId);
  return data(200, { deleted: true, cannedResponse: sanitizeEmailCannedResponse(response) });
}

async function handleCreateEmailRemoteContentAllowlist(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailRemoteContentAllowlist?.create) {
    return error(503, 'email_remote_content_allowlist_unavailable', 'Email remote content allowlist API nicht konfiguriert');
  }

  const parsed = parseEmailRemoteContentAllowlistMutationBody(req.body, {
    requireScope: true,
    requireValue: true,
    requireAny: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailRemoteContentAllowlist.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return emailRemoteContentAllowlistConflict();

  const entry = result.entry;
  await auditEmailRemoteContentAllowlist(ports, principal, 'email_remote_content_allowlist.created', entry, {
    scope: entry.scope,
    value: entry.value,
  });
  await publishEmailRemoteContentAllowlist(ports, principal.workspaceId, 'email_remote_content_allowlist.created', entry, principal.userId);
  return data(201, sanitizeEmailRemoteContentAllowlist(entry));
}

async function handleUpdateEmailRemoteContentAllowlist(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_remote_content_allowlist_id', 'email remote content allowlist id muss eine positive Ganzzahl sein');
  if (!ports.emailRemoteContentAllowlist?.update) {
    return error(503, 'email_remote_content_allowlist_unavailable', 'Email remote content allowlist API nicht konfiguriert');
  }

  const parsed = parseEmailRemoteContentAllowlistMutationBody(req.body, {
    requireScope: false,
    requireValue: false,
    requireAny: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailRemoteContentAllowlist.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'email_remote_content_allowlist_not_found', 'Email remote content allowlist nicht gefunden');
  if (!result.ok) return emailRemoteContentAllowlistConflict();

  const entry = result.entry;
  await auditEmailRemoteContentAllowlist(ports, principal, 'email_remote_content_allowlist.updated', entry, {
    fields: Object.keys(parsed.values).sort(),
  });
  await publishEmailRemoteContentAllowlist(ports, principal.workspaceId, 'email_remote_content_allowlist.updated', entry, principal.userId);
  return data(200, sanitizeEmailRemoteContentAllowlist(entry));
}

async function handleDeleteEmailRemoteContentAllowlist(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_remote_content_allowlist_id', 'email remote content allowlist id muss eine positive Ganzzahl sein');
  if (!ports.emailRemoteContentAllowlist?.delete) {
    return error(503, 'email_remote_content_allowlist_unavailable', 'Email remote content allowlist API nicht konfiguriert');
  }

  const entry = await ports.emailRemoteContentAllowlist.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!entry) return error(404, 'email_remote_content_allowlist_not_found', 'Email remote content allowlist nicht gefunden');

  await auditEmailRemoteContentAllowlist(ports, principal, 'email_remote_content_allowlist.deleted', entry, {
    scope: entry.scope,
    value: entry.value,
  });
  await publishEmailRemoteContentAllowlist(ports, principal.workspaceId, 'email_remote_content_allowlist.deleted', entry, principal.userId);
  return data(200, { deleted: true, remoteContentAllowlist: sanitizeEmailRemoteContentAllowlist(entry) });
}

async function handleCreateEmailTeamMember(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailTeamMembers?.create) {
    return error(503, 'email_team_members_unavailable', 'Email team member API nicht konfiguriert');
  }

  const parsed = parseEmailTeamMemberMutationBody(req.body, {
    requireId: true,
    requireDisplayName: true,
    allowId: true,
    requireAny: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailTeamMembers.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return error(409, 'email_team_member_conflict', 'Email team member existiert bereits');

  const member = result.member;
  await auditEmailTeamMember(ports, principal, 'email_team_member.created', member, { role: member.role });
  await publishEmailTeamMember(ports, principal.workspaceId, 'email_team_member.created', member, principal.userId);
  return data(201, sanitizeEmailTeamMember(member));
}

async function handleUpsertEmailTeamMember(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = textIdFromPath(rawId, 100);
  if (id === null) return error(400, 'invalid_email_team_member_id', 'email team member id ist ungueltig');
  if (!ports.emailTeamMembers?.create || !ports.emailTeamMembers.update) {
    return error(503, 'email_team_members_unavailable', 'Email team member API nicht konfiguriert');
  }

  const parsed = parseEmailTeamMemberMutationBody(req.body, {
    requireId: false,
    requireDisplayName: true,
    allowId: false,
    requireAny: false,
  });
  if (!parsed.ok) return parsed.response;

  const created = await ports.emailTeamMembers.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: {
      id,
      ...parsed.values,
    },
  });
  if (created.ok) {
    const member = created.member;
    await auditEmailTeamMember(ports, principal, 'email_team_member.created', member, { role: member.role });
    await publishEmailTeamMember(ports, principal.workspaceId, 'email_team_member.created', member, principal.userId);
    return data(201, sanitizeEmailTeamMember(member));
  }

  const updated = await ports.emailTeamMembers.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!updated) return error(409, 'email_team_member_conflict', 'Email team member existiert bereits');

  await auditEmailTeamMember(ports, principal, 'email_team_member.updated', updated, { fields: Object.keys(parsed.values).sort() });
  await publishEmailTeamMember(ports, principal.workspaceId, 'email_team_member.updated', updated, principal.userId);
  return data(200, sanitizeEmailTeamMember(updated));
}

async function handleUpdateEmailTeamMember(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = textIdFromPath(rawId, 100);
  if (id === null) return error(400, 'invalid_email_team_member_id', 'email team member id ist ungueltig');
  if (!ports.emailTeamMembers?.update) {
    return error(503, 'email_team_members_unavailable', 'Email team member API nicht konfiguriert');
  }

  const parsed = parseEmailTeamMemberMutationBody(req.body, {
    requireId: false,
    requireDisplayName: false,
    allowId: false,
    requireAny: true,
  });
  if (!parsed.ok) return parsed.response;

  const member = await ports.emailTeamMembers.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!member) return error(404, 'email_team_member_not_found', 'Email team member nicht gefunden');

  await auditEmailTeamMember(ports, principal, 'email_team_member.updated', member, { fields: Object.keys(parsed.values).sort() });
  await publishEmailTeamMember(ports, principal.workspaceId, 'email_team_member.updated', member, principal.userId);
  return data(200, sanitizeEmailTeamMember(member));
}

async function handleDeleteEmailTeamMember(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = textIdFromPath(rawId, 100);
  if (id === null) return error(400, 'invalid_email_team_member_id', 'email team member id ist ungueltig');
  if (!ports.emailTeamMembers?.delete) {
    return error(503, 'email_team_members_unavailable', 'Email team member API nicht konfiguriert');
  }

  const member = await ports.emailTeamMembers.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!member) return error(404, 'email_team_member_not_found', 'Email team member nicht gefunden');

  await auditEmailTeamMember(ports, principal, 'email_team_member.deleted', member, { role: member.role });
  await publishEmailTeamMember(ports, principal.workspaceId, 'email_team_member.deleted', member, principal.userId);
  return data(200, { deleted: true, teamMember: sanitizeEmailTeamMember(member) });
}

async function handleCreateEmailThreadEdge(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailThreadEdges?.create) {
    return error(503, 'email_thread_edges_unavailable', 'Email thread edge API nicht konfiguriert');
  }

  const parsed = parseEmailThreadEdgeMutationBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailThreadEdges.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return emailThreadEdgeMutationError(result.code);

  const edge = result.edge;
  await auditEmailThreadEdge(ports, principal, 'email_thread_edge.created', edge, {
    parentMessageId: edge.parentMessageId,
    childMessageId: edge.childMessageId,
  });
  await publishEmailThreadEdge(ports, principal.workspaceId, 'email_thread_edge.created', edge, principal.userId);
  return data(201, sanitizeEmailThreadEdge(edge));
}

async function handleDeleteEmailThreadEdge(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_thread_edge_id', 'email thread edge id muss eine positive Ganzzahl sein');
  if (!ports.emailThreadEdges?.delete) {
    return error(503, 'email_thread_edges_unavailable', 'Email thread edge API nicht konfiguriert');
  }

  const edge = await ports.emailThreadEdges.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!edge) return error(404, 'email_thread_edge_not_found', 'Email thread edge nicht gefunden');

  await auditEmailThreadEdge(ports, principal, 'email_thread_edge.deleted', edge, {
    parentMessageId: edge.parentMessageId,
    childMessageId: edge.childMessageId,
  });
  await publishEmailThreadEdge(ports, principal.workspaceId, 'email_thread_edge.deleted', edge, principal.userId);
  return data(200, { deleted: true, threadEdge: sanitizeEmailThreadEdge(edge) });
}

async function handleCreateEmailThreadAlias(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailThreadAliases?.create) {
    return error(503, 'email_thread_aliases_unavailable', 'Email thread alias API nicht konfiguriert');
  }

  const parsed = parseEmailThreadAliasMutationBody(req.body, {
    allowAccountId: true,
    requireAliasThreadId: true,
    requireCanonicalThreadId: true,
    requireAny: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailThreadAliases.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return emailThreadAliasMutationError(result.code);

  const alias = result.alias;
  await auditEmailThreadAlias(ports, principal, 'email_thread_alias.created', alias, {
    aliasThreadId: alias.aliasThreadId,
    canonicalThreadId: alias.canonicalThreadId,
  });
  await publishEmailThreadAlias(ports, principal.workspaceId, 'email_thread_alias.created', alias, principal.userId);
  return data(201, sanitizeEmailThreadAlias(alias));
}

async function handleUpdateEmailThreadAlias(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_thread_alias_id', 'email thread alias id muss eine positive Ganzzahl sein');
  if (!ports.emailThreadAliases?.update) {
    return error(503, 'email_thread_aliases_unavailable', 'Email thread alias API nicht konfiguriert');
  }

  const parsed = parseEmailThreadAliasMutationBody(req.body, {
    allowAccountId: false,
    requireAliasThreadId: false,
    requireCanonicalThreadId: false,
    requireAny: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailThreadAliases.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'email_thread_alias_not_found', 'Email thread alias nicht gefunden');
  if (!result.ok) return emailThreadAliasMutationError(result.code);

  const alias = result.alias;
  await auditEmailThreadAlias(ports, principal, 'email_thread_alias.updated', alias, { fields: Object.keys(parsed.values).sort() });
  await publishEmailThreadAlias(ports, principal.workspaceId, 'email_thread_alias.updated', alias, principal.userId);
  return data(200, sanitizeEmailThreadAlias(alias));
}

async function handleDeleteEmailThreadAlias(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_thread_alias_id', 'email thread alias id muss eine positive Ganzzahl sein');
  if (!ports.emailThreadAliases?.delete) {
    return error(503, 'email_thread_aliases_unavailable', 'Email thread alias API nicht konfiguriert');
  }

  const alias = await ports.emailThreadAliases.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!alias) return error(404, 'email_thread_alias_not_found', 'Email thread alias nicht gefunden');

  await auditEmailThreadAlias(ports, principal, 'email_thread_alias.deleted', alias, {
    aliasThreadId: alias.aliasThreadId,
    canonicalThreadId: alias.canonicalThreadId,
  });
  await publishEmailThreadAlias(ports, principal.workspaceId, 'email_thread_alias.deleted', alias, principal.userId);
  return data(200, { deleted: true, threadAlias: sanitizeEmailThreadAlias(alias) });
}

async function handleMergeEmailThreads(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailThreadAliases?.merge) {
    return error(503, 'email_thread_merge_unavailable', 'Email thread merge API nicht konfiguriert');
  }

  const parsed = parseEmailThreadMergeBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailThreadAliases.merge({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    ...parsed.values,
  });
  if (!result.ok) return emailThreadMergeError(result.code);

  const alias = result.alias;
  await auditEmailThreadAlias(ports, principal, 'email_thread_alias.updated', alias, {
    aliasThreadId: alias.aliasThreadId,
    canonicalThreadId: alias.canonicalThreadId,
    accountId: parsed.values.accountId,
    movedMessageCount: result.movedMessageCount,
    orphanThreadDeleted: result.orphanThreadDeleted,
    operation: 'merge_threads',
  });
  await publishEmailThreadAlias(ports, principal.workspaceId, 'email_thread_alias.updated', alias, principal.userId);
  return data(200, {
    success: true,
    threadAlias: sanitizeEmailThreadAlias(alias),
    movedMessageCount: result.movedMessageCount,
    orphanThreadDeleted: result.orphanThreadDeleted,
  });
}

async function handleSplitEmailMessageThread(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailThreads?.splitMessage) {
    return error(503, 'email_thread_split_unavailable', 'Email thread split API nicht konfiguriert');
  }

  const parsed = parseEmailThreadSplitBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailThreads.splitMessage({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    messageId: parsed.values.messageId,
  });
  if (!result.ok) return emailThreadSplitError(result.code);

  await auditEmailThread(ports, principal, 'email_thread.updated', result.thread, {
    messageId: parsed.values.messageId,
    previousThreadId: result.previousThreadId,
    operation: 'split_message_thread',
  });
  await publishEmailThread(ports, principal.workspaceId, 'email_thread.updated', result.thread, principal.userId);
  await publishEmailMessageThreadUpdated(ports, principal.workspaceId, {
    messageId: parsed.values.messageId,
    threadId: result.threadId,
    ticketCode: result.ticketCode,
  }, principal.userId);

  return data(200, {
    success: true,
    threadId: result.threadId,
    ticketCode: result.ticketCode,
    previousThreadId: result.previousThreadId,
    thread: sanitizeEmailThread(result.thread),
  });
}

async function handleCreateEmailAccountSignature(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailAccountSignatures?.create) {
    return error(503, 'email_account_signatures_unavailable', 'Email account signature API nicht konfiguriert');
  }

  const parsed = parseEmailAccountSignatureMutationBody(req.body, {
    requireAccountId: true,
    requireAny: false,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailAccountSignatures.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return emailAccountSignatureMutationError(result.code);

  const signature = result.signature;
  await auditEmailAccountSignature(ports, principal, 'email_account_signature.created', signature, { accountId: signature.accountId });
  await publishEmailAccountSignature(ports, principal.workspaceId, 'email_account_signature.created', signature, principal.userId);
  return data(201, sanitizeEmailAccountSignature(signature));
}

async function handleUpdateEmailAccountSignature(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = sourceSqliteIdFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_account_signature_id', 'email account signature id muss eine Ganzzahl ungleich 0 sein');
  if (!ports.emailAccountSignatures?.update) {
    return error(503, 'email_account_signatures_unavailable', 'Email account signature API nicht konfiguriert');
  }

  const parsed = parseEmailAccountSignatureMutationBody(req.body, {
    requireAccountId: false,
    requireAny: true,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailAccountSignatures.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!result) return error(404, 'email_account_signature_not_found', 'Email account signature nicht gefunden');
  if (!result.ok) return emailAccountSignatureMutationError(result.code);

  const signature = result.signature;
  await auditEmailAccountSignature(ports, principal, 'email_account_signature.updated', signature, { fields: Object.keys(parsed.values).sort() });
  await publishEmailAccountSignature(ports, principal.workspaceId, 'email_account_signature.updated', signature, principal.userId);
  return data(200, sanitizeEmailAccountSignature(signature));
}

async function handleDeleteEmailAccountSignature(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = sourceSqliteIdFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_account_signature_id', 'email account signature id muss eine Ganzzahl ungleich 0 sein');
  if (!ports.emailAccountSignatures?.delete) {
    return error(503, 'email_account_signatures_unavailable', 'Email account signature API nicht konfiguriert');
  }

  const signature = await ports.emailAccountSignatures.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!signature) return error(404, 'email_account_signature_not_found', 'Email account signature nicht gefunden');

  await auditEmailAccountSignature(ports, principal, 'email_account_signature.deleted', signature, { accountId: signature.accountId });
  await publishEmailAccountSignature(ports, principal.workspaceId, 'email_account_signature.deleted', signature, principal.userId);
  return data(200, { deleted: true, accountSignature: sanitizeEmailAccountSignature(signature) });
}

async function handleUpsertEmailAccountSignatureByAccount(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawAccountId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const accountId = positiveIntFromPath(rawAccountId);
  if (accountId === null) return error(400, 'invalid_email_account_id', 'email account id muss eine positive Ganzzahl sein');
  const signaturePort = ports.emailAccountSignatures;
  if (
    !signaturePort?.list ||
    !signaturePort.create ||
    !signaturePort.update ||
    !signaturePort.delete
  ) {
    return error(503, 'email_account_signatures_unavailable', 'Email account signature API nicht konfiguriert');
  }

  const parsed = parseEmailAccountSignatureMutationBody(req.body, {
    requireAccountId: false,
    requireAny: true,
  });
  if (!parsed.ok) return parsed.response;

  const current = await signaturePort.list({
    workspaceId: principal.workspaceId,
    limit: 1,
    accountId,
  });
  const existing = current.items[0];
  const signatureHtml = parsed.values.signatureHtml ?? null;

  if (signatureHtml === null) {
    if (!existing) return data(200, { success: true, deleted: false });
    const signature = await signaturePort.delete({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      id: existing.sourceSqliteId,
    });
    if (!signature) return error(404, 'email_account_signature_not_found', 'Email account signature nicht gefunden');
    await auditEmailAccountSignature(ports, principal, 'email_account_signature.deleted', signature, { accountId: signature.accountId });
    await publishEmailAccountSignature(ports, principal.workspaceId, 'email_account_signature.deleted', signature, principal.userId);
    return data(200, { success: true, deleted: true, accountSignature: sanitizeEmailAccountSignature(signature) });
  }

  if (existing) {
    const result = await signaturePort.update({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      id: existing.sourceSqliteId,
      values: { signatureHtml },
    });
    if (!result) return error(404, 'email_account_signature_not_found', 'Email account signature nicht gefunden');
    if (!result.ok) return emailAccountSignatureMutationError(result.code);
    const signature = result.signature;
    await auditEmailAccountSignature(ports, principal, 'email_account_signature.updated', signature, { fields: ['signatureHtml'] });
    await publishEmailAccountSignature(ports, principal.workspaceId, 'email_account_signature.updated', signature, principal.userId);
    return data(200, sanitizeEmailAccountSignature(signature));
  }

  const result = await signaturePort.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: { accountId, signatureHtml },
  });
  if (!result.ok) return emailAccountSignatureMutationError(result.code);
  const signature = result.signature;
  await auditEmailAccountSignature(ports, principal, 'email_account_signature.created', signature, { accountId: signature.accountId });
  await publishEmailAccountSignature(ports, principal.workspaceId, 'email_account_signature.created', signature, principal.userId);
  return data(201, sanitizeEmailAccountSignature(signature));
}

async function handleCreateEmailReadReceipt(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailReadReceipts?.create) {
    return error(503, 'email_read_receipts_unavailable', 'Email read receipt API nicht konfiguriert');
  }

  const parsed = parseEmailReadReceiptMutationBody(req.body);
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailReadReceipts.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return error(404, 'email_message_not_found', 'Email message nicht gefunden');

  const receipt = result.receipt;
  await auditEmailReadReceipt(ports, principal, 'email_read_receipt.created', receipt, {
    messageId: receipt.messageId,
    direction: receipt.direction,
  });
  await publishEmailReadReceipt(ports, principal.workspaceId, 'email_read_receipt.created', receipt, principal.userId);
  return data(201, sanitizeEmailReadReceipt(receipt));
}

function emailAccountSignatureMutationError(code: 'account_not_found' | 'signature_conflict'): ApiResponse<ApiErrorBody> {
  if (code === 'account_not_found') return error(404, 'email_account_not_found', 'Email account nicht gefunden');
  return error(409, 'email_account_signature_conflict', 'Email account signature existiert bereits fuer diesen Account');
}

function emailThreadEdgeMutationError(
  code: 'parent_message_not_found' | 'child_message_not_found' | 'edge_conflict' | 'invalid_edge',
): ApiResponse<ApiErrorBody> {
  if (code === 'parent_message_not_found') return error(404, 'email_parent_message_not_found', 'Email parent message nicht gefunden');
  if (code === 'child_message_not_found') return error(404, 'email_child_message_not_found', 'Email child message nicht gefunden');
  if (code === 'edge_conflict') return error(409, 'email_thread_edge_conflict', 'Email thread edge existiert bereits');
  return error(400, 'invalid_email_thread_edge', 'Email thread edge ist ungueltig');
}

function emailThreadAliasMutationError(code: 'alias_conflict' | 'invalid_alias'): ApiResponse<ApiErrorBody> {
  if (code === 'alias_conflict') return error(409, 'email_thread_alias_conflict', 'Email thread alias existiert bereits');
  return error(400, 'invalid_email_thread_alias', 'Email thread alias ist ungueltig');
}

function emailThreadMergeError(
  code: 'account_not_found' | 'alias_cycle' | 'invalid_alias',
): ApiResponse<ApiErrorBody> {
  if (code === 'account_not_found') return error(404, 'email_account_not_found', 'Email account nicht gefunden');
  if (code === 'alias_cycle') return error(400, 'email_thread_alias_cycle', 'Email thread merge wuerde einen Alias-Zyklus erzeugen');
  return error(400, 'invalid_email_thread_alias', 'Email thread alias ist ungueltig');
}

function emailThreadSplitError(code: 'message_not_found'): ApiResponse<ApiErrorBody> {
  if (code === 'message_not_found') return error(404, 'email_message_not_found', 'Email Nachricht nicht gefunden');
  return error(400, 'invalid_email_thread_split', 'Email thread split ist ungueltig');
}

function emailCategoryMutationError(code: 'parent_not_found' | 'invalid_parent'): ApiResponse<ApiErrorBody> {
  if (code === 'parent_not_found') return error(404, 'email_category_parent_not_found', 'Email parent category nicht gefunden');
  return error(400, 'invalid_email_category_parent', 'Email category parent ist ungueltig');
}

function emailRemoteContentAllowlistConflict(): ApiResponse<ApiErrorBody> {
  return error(409, 'email_remote_content_allowlist_conflict', 'Email remote content allowlist entry existiert bereits');
}

async function auditEmailMessageTag(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_message_tag.created' | 'email_message_tag.deleted',
  tag: EmailMessageTagRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_message_tag',
    entityId: String(tag.id),
    metadata: {
      id: tag.id,
      sourceSqliteId: tag.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishEmailMessageTag(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_message_tag.created' | 'email_message_tag.deleted',
  tag: EmailMessageTagRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_message_tag',
    entityId: String(tag.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: tag.id,
      sourceSqliteId: tag.sourceSqliteId,
      messageId: tag.messageId,
      messageSourceSqliteId: tag.messageSourceSqliteId,
      tag: tag.tag,
    },
  });
}

async function auditEmailCategory(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_category.created' | 'email_category.updated' | 'email_category.deleted',
  category: EmailCategoryRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_category',
    entityId: String(category.id),
    metadata: {
      id: category.id,
      sourceSqliteId: category.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishEmailCategory(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_category.created' | 'email_category.updated' | 'email_category.deleted',
  category: EmailCategoryRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_category',
    entityId: String(category.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: category.id,
      sourceSqliteId: category.sourceSqliteId,
      parentSourceSqliteId: category.parentSourceSqliteId,
      parentId: category.parentId,
      name: category.name,
      sortOrder: category.sortOrder,
    },
  });
}

async function auditEmailMessageCategory(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_message_category.created' | 'email_message_category.deleted',
  category: EmailMessageCategoryRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_message_category',
    entityId: String(category.id),
    metadata: {
      id: category.id,
      sourceSqliteId: category.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishEmailMessageCategory(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_message_category.created' | 'email_message_category.deleted',
  category: EmailMessageCategoryRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_message_category',
    entityId: String(category.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: category.id,
      sourceSqliteId: category.sourceSqliteId,
      messageId: category.messageId,
      messageSourceSqliteId: category.messageSourceSqliteId,
      categoryId: category.categoryId,
      categorySourceSqliteId: category.categorySourceSqliteId,
    },
  });
}

async function auditEmailCannedResponse(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_canned_response.created' | 'email_canned_response.updated' | 'email_canned_response.deleted',
  response: EmailCannedResponseRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_canned_response',
    entityId: String(response.id),
    metadata: {
      id: response.id,
      sourceSqliteId: response.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishEmailCannedResponse(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_canned_response.created' | 'email_canned_response.updated' | 'email_canned_response.deleted',
  response: EmailCannedResponseRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_canned_response',
    entityId: String(response.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: response.id,
      sourceSqliteId: response.sourceSqliteId,
      title: response.title,
      body: response.body,
      sortOrder: response.sortOrder,
    },
  });
}

async function auditEmailRemoteContentAllowlist(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action:
    | 'email_remote_content_allowlist.created'
    | 'email_remote_content_allowlist.updated'
    | 'email_remote_content_allowlist.deleted',
  entry: EmailRemoteContentAllowlistRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_remote_content_allowlist',
    entityId: String(entry.id),
    metadata: {
      id: entry.id,
      sourceSqliteId: entry.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishEmailRemoteContentAllowlist(
  ports: ServerApiPorts,
  workspaceId: string,
  type:
    | 'email_remote_content_allowlist.created'
    | 'email_remote_content_allowlist.updated'
    | 'email_remote_content_allowlist.deleted',
  entry: EmailRemoteContentAllowlistRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_remote_content_allowlist',
    entityId: String(entry.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: entry.id,
      sourceSqliteId: entry.sourceSqliteId,
      scope: entry.scope,
      value: entry.value,
    },
  });
}

async function auditEmailTeamMember(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_team_member.created' | 'email_team_member.updated' | 'email_team_member.deleted',
  member: EmailTeamMemberRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_team_member',
    entityId: member.id,
    metadata: {
      id: member.id,
      ...metadata,
    },
  });
}

async function publishEmailTeamMember(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_team_member.created' | 'email_team_member.updated' | 'email_team_member.deleted',
  member: EmailTeamMemberRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_team_member',
    entityId: member.id,
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: member.id,
      displayName: member.displayName,
      role: member.role,
      signatureHtml: member.signatureHtml,
      sortOrder: member.sortOrder,
    },
  });
}

async function auditEmailThreadEdge(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_thread_edge.created' | 'email_thread_edge.deleted',
  edge: EmailThreadEdgeRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_thread_edge',
    entityId: String(edge.id),
    metadata: {
      id: edge.id,
      sourceSqliteId: edge.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishEmailThreadEdge(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_thread_edge.created' | 'email_thread_edge.deleted',
  edge: EmailThreadEdgeRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_thread_edge',
    entityId: String(edge.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: edge.id,
      sourceSqliteId: edge.sourceSqliteId,
      parentMessageSourceSqliteId: edge.parentMessageSourceSqliteId,
      childMessageSourceSqliteId: edge.childMessageSourceSqliteId,
      parentMessageId: edge.parentMessageId,
      childMessageId: edge.childMessageId,
    },
  });
}

async function auditEmailThreadAlias(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_thread_alias.created' | 'email_thread_alias.updated' | 'email_thread_alias.deleted',
  alias: EmailThreadAliasRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_thread_alias',
    entityId: String(alias.id),
    metadata: {
      id: alias.id,
      sourceSqliteId: alias.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishEmailThreadAlias(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_thread_alias.created' | 'email_thread_alias.updated' | 'email_thread_alias.deleted',
  alias: EmailThreadAliasRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_thread_alias',
    entityId: String(alias.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: alias.id,
      sourceSqliteId: alias.sourceSqliteId,
      aliasThreadId: alias.aliasThreadId,
      canonicalThreadId: alias.canonicalThreadId,
      confidence: alias.confidence,
      source: alias.source,
    },
  });
}

async function auditEmailThread(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_thread.updated',
  thread: EmailThreadRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_thread',
    entityId: thread.id,
    metadata: {
      id: thread.id,
      ticketCode: thread.ticketCode,
      ...metadata,
    },
  });
}

async function publishEmailThread(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_thread.updated',
  thread: EmailThreadRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_thread',
    entityId: thread.id,
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: sanitizeEmailThread(thread),
  });
}

async function publishEmailMessageThreadUpdated(
  ports: ServerApiPorts,
  workspaceId: string,
  payload: {
    messageId: number;
    threadId: string;
    ticketCode: string;
  },
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type: 'email_message.updated',
    workspaceId,
    entityType: 'email_message',
    entityId: String(payload.messageId),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload,
  });
}

async function auditEmailAccountSignature(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_account_signature.created' | 'email_account_signature.updated' | 'email_account_signature.deleted',
  signature: EmailAccountSignatureRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_account_signature',
    entityId: String(signature.sourceSqliteId),
    metadata: {
      sourceSqliteId: signature.sourceSqliteId,
      accountSourceSqliteId: signature.accountSourceSqliteId,
      ...metadata,
    },
  });
}

async function publishEmailAccountSignature(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_account_signature.created' | 'email_account_signature.updated' | 'email_account_signature.deleted',
  signature: EmailAccountSignatureRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_account_signature',
    entityId: String(signature.sourceSqliteId),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      sourceSqliteId: signature.sourceSqliteId,
      accountSourceSqliteId: signature.accountSourceSqliteId,
      accountId: signature.accountId,
      signatureHtml: signature.signatureHtml,
    },
  });
}

async function auditEmailReadReceipt(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_read_receipt.created',
  receipt: EmailReadReceiptRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_read_receipt',
    entityId: String(receipt.id),
    metadata: {
      id: receipt.id,
      sourceSqliteId: receipt.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishEmailReadReceipt(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_read_receipt.created',
  receipt: EmailReadReceiptRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_read_receipt',
    entityId: String(receipt.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: receipt.id,
      sourceSqliteId: receipt.sourceSqliteId,
      messageSourceSqliteId: receipt.messageSourceSqliteId,
      messageId: receipt.messageId,
      direction: receipt.direction,
      recipient: receipt.recipient,
      at: receipt.at,
    },
  });
}

async function handleCreateEmailInternalNote(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawMessageId?: string,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailInternalNotes?.create) {
    return error(503, 'email_internal_notes_unavailable', 'Email internal note API nicht konfiguriert');
  }

  const pathMessageId = rawMessageId === undefined ? undefined : positiveIntFromPath(rawMessageId);
  if (pathMessageId === null) return error(400, 'invalid_email_message_id', 'email message id muss eine positive Ganzzahl sein');
  const parsed = parseEmailInternalNoteMutationBody(req.body, {
    requireMessage: pathMessageId === undefined,
    requireBody: true,
    pathMessageId,
  });
  if (!parsed.ok) return parsed.response;

  const result = await ports.emailInternalNotes.create({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    values: parsed.values,
  });
  if (!result.ok) return error(404, 'email_message_not_found', 'Email message nicht gefunden');

  const note = result.note;
  await auditEmailInternalNote(ports, principal, 'email_internal_note.created', note, { messageId: note.messageId });
  await publishEmailInternalNote(ports, principal.workspaceId, 'email_internal_note.created', note, principal.userId);
  return data(201, sanitizeEmailInternalNote(note));
}

async function handleUpdateEmailInternalNote(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_internal_note_id', 'email internal note id muss eine positive Ganzzahl sein');
  if (!ports.emailInternalNotes?.update) {
    return error(503, 'email_internal_notes_unavailable', 'Email internal note API nicht konfiguriert');
  }

  const parsed = parseEmailInternalNoteMutationBody(req.body, {
    requireMessage: false,
    requireBody: true,
    allowMessageId: false,
  });
  if (!parsed.ok) return parsed.response;

  const note = await ports.emailInternalNotes.update({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
    values: parsed.values,
  });
  if (!note) return error(404, 'email_internal_note_not_found', 'Email internal note nicht gefunden');

  await auditEmailInternalNote(ports, principal, 'email_internal_note.updated', note, { fields: Object.keys(parsed.values).sort() });
  await publishEmailInternalNote(ports, principal.workspaceId, 'email_internal_note.updated', note, principal.userId);
  return data(200, sanitizeEmailInternalNote(note));
}

async function handleDeleteEmailInternalNote(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_internal_note_id', 'email internal note id muss eine positive Ganzzahl sein');
  if (!ports.emailInternalNotes?.delete) {
    return error(503, 'email_internal_notes_unavailable', 'Email internal note API nicht konfiguriert');
  }

  const note = await ports.emailInternalNotes.delete({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!note) return error(404, 'email_internal_note_not_found', 'Email internal note nicht gefunden');

  await auditEmailInternalNote(ports, principal, 'email_internal_note.deleted', note, { messageId: note.messageId });
  await publishEmailInternalNote(ports, principal.workspaceId, 'email_internal_note.deleted', note, principal.userId);
  return data(200, { deleted: true, internalNote: sanitizeEmailInternalNote(note) });
}

async function auditEmailInternalNote(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  action: 'email_internal_note.created' | 'email_internal_note.updated' | 'email_internal_note.deleted',
  note: EmailInternalNoteRecord,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action,
    entityType: 'email_internal_note',
    entityId: String(note.id),
    metadata: {
      id: note.id,
      sourceSqliteId: note.sourceSqliteId,
      ...metadata,
    },
  });
}

async function publishEmailInternalNote(
  ports: ServerApiPorts,
  workspaceId: string,
  type: 'email_internal_note.created' | 'email_internal_note.updated' | 'email_internal_note.deleted',
  note: EmailInternalNoteRecord,
  actorUserId: string,
): Promise<void> {
  await ports.events?.publish({
    type,
    workspaceId,
    entityType: 'email_internal_note',
    entityId: String(note.id),
    actorUserId,
    occurredAt: new Date().toISOString(),
    payload: {
      id: note.id,
      sourceSqliteId: note.sourceSqliteId,
      messageId: note.messageId,
      messageSourceSqliteId: note.messageSourceSqliteId,
      body: note.body,
    },
  });
}

function parseNumericListBase(req: ApiRequest): ParseResult<{ cursor?: number; limit: number }> {
  const limit = parseLimit(req.query?.limit);
  if (limit === null) return parseError('invalid_limit', `limit muss zwischen 1 und ${MAX_METADATA_LIMIT} liegen`);
  const cursor = parseOptionalPositiveInt(req.query?.cursor);
  if (cursor === null) return parseError('invalid_cursor', 'cursor muss eine positive Ganzzahl sein');
  return { ok: true, filters: { limit, ...(cursor === undefined ? {} : { cursor }) } };
}

function parseSignedNumericListBase(req: ApiRequest): ParseResult<{ cursor?: number; limit: number }> {
  const limit = parseLimit(req.query?.limit);
  if (limit === null) return parseError('invalid_limit', `limit muss zwischen 1 und ${MAX_METADATA_LIMIT} liegen`);
  const cursor = parseOptionalNonZeroInt(req.query?.cursor);
  if (cursor === null) return parseError('invalid_cursor', 'cursor muss eine Ganzzahl ungleich 0 sein');
  return { ok: true, filters: { limit, ...(cursor === undefined ? {} : { cursor }) } };
}

function parseStringListBase(req: ApiRequest): ParseResult<{ cursor?: string; offset?: number; limit: number }> {
  const limit = parseLimit(req.query?.limit);
  if (limit === null) return parseError('invalid_limit', `limit muss zwischen 1 und ${MAX_METADATA_LIMIT} liegen`);
  const cursor = normalizeTextFilter(req.query?.cursor, 300);
  if (cursor === null) return parseError('invalid_cursor', 'cursor darf maximal 300 Zeichen haben');
  const offset = parseOptionalNonNegativeInt(req.query?.offset);
  if (offset === null) return parseError('invalid_offset', 'offset muss eine nicht-negative Ganzzahl sein');
  return { ok: true, filters: { limit, ...(cursor === undefined ? {} : { cursor }), ...(offset === undefined ? {} : { offset }) } };
}

function parseFolderFilters(req: ApiRequest): ParseResult<{ accountId?: number; search?: string }> {
  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return parseError('invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  return { ok: true, filters: omitUndefined({ accountId, search }) };
}

function parseTeamMemberFilters(req: ApiRequest): ParseResult<{ search?: string; role?: string }> {
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  const role = normalizeTextFilter(req.query?.role, 50);
  if (role === null) return parseError('invalid_role', 'role darf maximal 50 Zeichen haben');
  return { ok: true, filters: omitUndefined({ search, role }) };
}

function parseThreadFilters(req: ApiRequest): ParseResult<{
  accountId?: number;
  view?: 'inbox' | 'sent' | 'archived' | 'drafts' | 'scheduled_send' | 'spam_review' | 'spam' | 'trash' | 'snoozed' | 'all';
  search?: string;
  hasUnread?: boolean;
  hasAttachments?: boolean;
}> {
  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return parseError('invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  const view = parseOptionalThreadView(req.query?.view);
  if (view === null) return parseError('invalid_view', 'view ist ungueltig');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  const hasUnread = parseOptionalBoolean(req.query?.hasUnread);
  if (hasUnread === null) return parseError('invalid_has_unread', 'hasUnread muss true oder false sein');
  const hasAttachments = parseOptionalBoolean(req.query?.hasAttachments);
  if (hasAttachments === null) return parseError('invalid_has_attachments', 'hasAttachments muss true oder false sein');
  return { ok: true, filters: omitUndefined({ accountId, view, search, hasUnread, hasAttachments }) };
}

function parseMessageTagFilters(req: ApiRequest): ParseResult<{ messageId?: number; search?: string; tag?: string }> {
  const messageId = parseOptionalPositiveInt(req.query?.messageId);
  if (messageId === null) return parseError('invalid_message_id', 'messageId muss eine positive Ganzzahl sein');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  const tag = normalizeTextFilter(req.query?.tag, 200);
  if (tag === null) return parseError('invalid_tag', 'tag darf maximal 200 Zeichen haben');
  return { ok: true, filters: omitUndefined({ messageId, search, tag }) };
}

function parseCategoryFilters(req: ApiRequest): ParseResult<{ parentId?: number; search?: string }> {
  const parentId = parseOptionalPositiveInt(req.query?.parentId);
  if (parentId === null) return parseError('invalid_parent_id', 'parentId muss eine positive Ganzzahl sein');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  return { ok: true, filters: omitUndefined({ parentId, search }) };
}

function parseMessageCategoryFilters(req: ApiRequest): ParseResult<{ messageId?: number; categoryId?: number }> {
  const messageId = parseOptionalPositiveInt(req.query?.messageId);
  if (messageId === null) return parseError('invalid_message_id', 'messageId muss eine positive Ganzzahl sein');
  const categoryId = parseOptionalPositiveInt(req.query?.categoryId);
  if (categoryId === null) return parseError('invalid_category_id', 'categoryId muss eine positive Ganzzahl sein');
  return { ok: true, filters: omitUndefined({ messageId, categoryId }) };
}

function parseInternalNoteFilters(req: ApiRequest): ParseResult<{ messageId?: number; search?: string }> {
  const messageId = parseOptionalPositiveInt(req.query?.messageId);
  if (messageId === null) return parseError('invalid_message_id', 'messageId muss eine positive Ganzzahl sein');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  return { ok: true, filters: omitUndefined({ messageId, search }) };
}

function parseEmailMessageTagMutationBody(
  body: unknown,
  options: {
    requireMessage: boolean;
    pathMessageId?: number;
  },
): EmailMessageTagMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_tag_payload', 'Email tag payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailMessageTagMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['messageId', 'tag']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (options.pathMessageId !== undefined) {
    values.messageId = options.pathMessageId;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'messageId')) {
    const messageId = normalizePositiveBodyInt(body.messageId, 'messageId');
    if (messageId.ok) {
      if (options.pathMessageId !== undefined && messageId.value !== options.pathMessageId) {
        errors.push({ field: 'messageId', message: 'messageId muss mit der URL uebereinstimmen' });
      } else {
        values.messageId = messageId.value;
      }
    } else {
      errors.push({ field: 'messageId', message: messageId.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'tag')) {
    const tag = normalizeRequiredBodyText(body.tag, 100);
    if (tag.ok) values.tag = tag.value;
    else errors.push({ field: 'tag', message: tag.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email tag payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireMessage && values.messageId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'messageId ist fuer neue Email Tags erforderlich'),
    };
  }
  if (!values.tag) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'tag ist fuer Email Tags erforderlich'),
    };
  }

  return { ok: true, values };
}

function parseEmailCategoryMutationBody(
  body: unknown,
  options: {
    requireName: boolean;
    requireAny: boolean;
  },
): EmailCategoryMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_category_payload', 'Email category payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailCategoryMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['parentId', 'name', 'sortOrder']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'parentId')) {
    if (body.parentId === null) {
      values.parentId = null;
    } else {
      const parentId = normalizePositiveBodyInt(body.parentId, 'parentId');
      if (parentId.ok) values.parentId = parentId.value;
      else errors.push({ field: 'parentId', message: parentId.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = normalizeRequiredBodyText(body.name, 200);
    if (name.ok) values.name = name.value;
    else errors.push({ field: 'name', message: name.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
    const sortOrder = normalizeIntegerBody(body.sortOrder, 'sortOrder', 0);
    if (sortOrder.ok) values.sortOrder = sortOrder.value;
    else errors.push({ field: 'sortOrder', message: sortOrder.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email category payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireName && !values.name) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'name ist fuer Email Kategorien erforderlich'),
    };
  }
  if (options.requireAny && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email category update braucht mindestens ein Feld'),
    };
  }

  return { ok: true, values };
}

function parseEmailCategoryReorderBody(body: unknown): EmailCategoryReorderParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_category_reorder_payload', 'Email category reorder payload muss ein JSON-Objekt sein'),
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['updates']);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (!Array.isArray(body.updates) || body.updates.length < 1 || body.updates.length > 500) {
    errors.push({ field: 'updates', message: 'updates muss ein Array mit 1 bis 500 Eintraegen sein' });
  }

  const updates: EmailCategoryReorderItem[] = [];
  const seenIds = new Set<number>();
  if (Array.isArray(body.updates)) {
    body.updates.forEach((rawUpdate, index) => {
      const field = `updates.${index}`;
      if (!isPlainObject(rawUpdate)) {
        errors.push({ field, message: 'Eintrag muss ein JSON-Objekt sein' });
        return;
      }
      const updateAllowedFields = new Set(['id', 'parentId', 'sortOrder']);
      for (const key of Object.keys(rawUpdate)) {
        if (!updateAllowedFields.has(key)) errors.push({ field: `${field}.${key}`, message: 'Feld ist nicht erlaubt' });
      }

      const id = normalizePositiveBodyInt(rawUpdate.id, 'id');
      const sortOrder = normalizeIntegerBody(rawUpdate.sortOrder, 'sortOrder', 0);
      let parentId: number | null | undefined;
      if (rawUpdate.parentId === null) {
        parentId = null;
      } else {
        const parsedParentId = normalizePositiveBodyInt(rawUpdate.parentId, 'parentId');
        if (parsedParentId.ok) parentId = parsedParentId.value;
        else errors.push({ field: `${field}.parentId`, message: parsedParentId.message });
      }
      if (id.ok && seenIds.has(id.value)) errors.push({ field: `${field}.id`, message: 'id darf nicht doppelt vorkommen' });
      if (!id.ok) errors.push({ field: `${field}.id`, message: id.message });
      if (!sortOrder.ok) errors.push({ field: `${field}.sortOrder`, message: sortOrder.message });
      if (id.ok && sortOrder.ok && parentId !== undefined && !seenIds.has(id.value)) {
        seenIds.add(id.value);
        updates.push({
          id: id.value,
          parentId,
          sortOrder: sortOrder.value,
        });
      }
    });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email category reorder payload ist ungueltig', { fields: errors }),
    };
  }
  return { ok: true, updates };
}

function parseEmailMessageCategoryMutationBody(
  body: unknown,
  options: {
    requireMessage: boolean;
    pathMessageId?: number;
  },
): EmailMessageCategoryMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_message_category_payload', 'Email message category payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailMessageCategoryMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['messageId', 'categoryId']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (options.pathMessageId !== undefined) {
    values.messageId = options.pathMessageId;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'messageId')) {
    const messageId = normalizePositiveBodyInt(body.messageId, 'messageId');
    if (messageId.ok) {
      if (options.pathMessageId !== undefined && messageId.value !== options.pathMessageId) {
        errors.push({ field: 'messageId', message: 'messageId muss mit der URL uebereinstimmen' });
      } else {
        values.messageId = messageId.value;
      }
    } else {
      errors.push({ field: 'messageId', message: messageId.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'categoryId')) {
    const categoryId = normalizePositiveBodyInt(body.categoryId, 'categoryId');
    if (categoryId.ok) values.categoryId = categoryId.value;
    else errors.push({ field: 'categoryId', message: categoryId.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email message category payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireMessage && values.messageId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'messageId ist fuer neue Email message categories erforderlich'),
    };
  }
  if (values.categoryId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'categoryId ist fuer neue Email message categories erforderlich'),
    };
  }

  return { ok: true, values };
}

function parseEmailCannedResponseMutationBody(
  body: unknown,
  options: {
    requireTitle: boolean;
    requireBody: boolean;
    requireAny: boolean;
  },
): EmailCannedResponseMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_canned_response_payload', 'Email canned response payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailCannedResponseMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['title', 'body', 'sortOrder', 'accountId', 'overrideKey']);
  let hasBody = false;

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = normalizeRequiredBodyText(body.title, 200);
    if (title.ok) values.title = title.value;
    else errors.push({ field: 'title', message: title.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'body')) {
    const responseBody = normalizeCannedResponseBodyText(body.body, 20000);
    if (responseBody.ok) {
      values.body = responseBody.value;
      hasBody = true;
    }
    else errors.push({ field: 'body', message: responseBody.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
    const sortOrder = normalizeIntegerBody(body.sortOrder, 'sortOrder', 0);
    if (sortOrder.ok) values.sortOrder = sortOrder.value;
    else errors.push({ field: 'sortOrder', message: sortOrder.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'accountId')) {
    if (body.accountId === null) {
      values.accountId = null;
    } else {
      const accountId = normalizePositiveBodyInt(body.accountId, 'accountId');
      if (accountId.ok) values.accountId = accountId.value;
      else errors.push({ field: 'accountId', message: accountId.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'overrideKey')) {
    if (body.overrideKey === null) {
      values.overrideKey = null;
    } else if (typeof body.overrideKey === 'string') {
      const trimmed = body.overrideKey.trim();
      values.overrideKey = trimmed || null;
    } else {
      errors.push({ field: 'overrideKey', message: 'overrideKey muss ein String oder null sein' });
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email canned response payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireTitle && !values.title) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'title ist fuer Email canned responses erforderlich'),
    };
  }
  if (options.requireBody && !hasBody) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'body ist fuer Email canned responses erforderlich'),
    };
  }
  if (options.requireAny && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email canned response update braucht mindestens ein Feld'),
    };
  }

  return { ok: true, values };
}

function parseEmailRemoteContentAllowlistMutationBody(
  body: unknown,
  options: {
    requireScope: boolean;
    requireValue: boolean;
    requireAny: boolean;
  },
): EmailRemoteContentAllowlistMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_remote_content_allowlist_payload', 'Email remote content allowlist payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailRemoteContentAllowlistMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['scope', 'value']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'scope')) {
    const scope = normalizeRequiredBodyText(body.scope, 50);
    if (scope.ok) values.scope = scope.value;
    else errors.push({ field: 'scope', message: scope.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'value')) {
    const value = normalizeRequiredBodyText(body.value, 300);
    if (value.ok) values.value = value.value;
    else errors.push({ field: 'value', message: value.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email remote content allowlist payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireScope && !values.scope) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'scope ist fuer Email remote content allowlist erforderlich'),
    };
  }
  if (options.requireValue && !values.value) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'value ist fuer Email remote content allowlist erforderlich'),
    };
  }
  if (options.requireAny && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email remote content allowlist update braucht mindestens ein Feld'),
    };
  }

  return { ok: true, values };
}

function parseEmailTeamMemberMutationBody(
  body: unknown,
  options: {
    requireId: boolean;
    requireDisplayName: boolean;
    allowId: boolean;
    requireAny: boolean;
  },
): EmailTeamMemberMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_team_member_payload', 'Email team member payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailTeamMemberMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(options.allowId
    ? ['id', 'displayName', 'role', 'signatureHtml', 'sortOrder']
    : ['displayName', 'role', 'signatureHtml', 'sortOrder']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (options.allowId && Object.prototype.hasOwnProperty.call(body, 'id')) {
    const id = normalizeRequiredBodyText(body.id, 100);
    if (id.ok) values.id = id.value;
    else errors.push({ field: 'id', message: id.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'displayName')) {
    const displayName = normalizeRequiredBodyText(body.displayName, 200);
    if (displayName.ok) values.displayName = displayName.value;
    else errors.push({ field: 'displayName', message: displayName.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'role')) {
    const role = normalizeRequiredBodyText(body.role, 50);
    if (role.ok) values.role = role.value;
    else errors.push({ field: 'role', message: role.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'signatureHtml')) {
    if (body.signatureHtml === null) {
      values.signatureHtml = null;
    } else if (typeof body.signatureHtml === 'string') {
      const signatureHtml = body.signatureHtml.trim();
      values.signatureHtml = signatureHtml ? signatureHtml : null;
      if (signatureHtml.length > 20000) {
        errors.push({ field: 'signatureHtml', message: 'signatureHtml darf maximal 20000 Zeichen haben' });
      }
    } else {
      errors.push({ field: 'signatureHtml', message: 'signatureHtml muss ein String oder null sein' });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
    const sortOrder = normalizeIntegerBody(body.sortOrder, 'sortOrder', 0);
    if (sortOrder.ok) values.sortOrder = sortOrder.value;
    else errors.push({ field: 'sortOrder', message: sortOrder.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email team member payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireId && !values.id) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'id ist fuer Email team members erforderlich'),
    };
  }
  if (options.requireDisplayName && !values.displayName) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'displayName ist fuer Email team members erforderlich'),
    };
  }
  if (options.requireAny && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email team member update braucht mindestens ein Feld'),
    };
  }

  return { ok: true, values };
}

function parseEmailThreadEdgeMutationBody(body: unknown): EmailThreadEdgeMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_thread_edge_payload', 'Email thread edge payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailThreadEdgeMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['parentMessageId', 'childMessageId']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'parentMessageId')) {
    const parentMessageId = normalizePositiveBodyInt(body.parentMessageId, 'parentMessageId');
    if (parentMessageId.ok) values.parentMessageId = parentMessageId.value;
    else errors.push({ field: 'parentMessageId', message: parentMessageId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'childMessageId')) {
    const childMessageId = normalizePositiveBodyInt(body.childMessageId, 'childMessageId');
    if (childMessageId.ok) values.childMessageId = childMessageId.value;
    else errors.push({ field: 'childMessageId', message: childMessageId.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email thread edge payload ist ungueltig', { fields: errors }),
    };
  }
  if (values.parentMessageId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'parentMessageId ist fuer Email thread edges erforderlich'),
    };
  }
  if (values.childMessageId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'childMessageId ist fuer Email thread edges erforderlich'),
    };
  }
  if (values.parentMessageId === values.childMessageId) {
    return {
      ok: false,
      response: error(400, 'invalid_email_thread_edge', 'Email thread edge ist ungueltig'),
    };
  }

  return { ok: true, values };
}

function parseEmailThreadAliasMutationBody(
  body: unknown,
  options: {
    allowAccountId: boolean;
    requireAliasThreadId: boolean;
    requireCanonicalThreadId: boolean;
    requireAny: boolean;
  },
): EmailThreadAliasMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_thread_alias_payload', 'Email thread alias payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailThreadAliasMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set([
    ...(options.allowAccountId ? ['accountId'] : []),
    'aliasThreadId',
    'canonicalThreadId',
    'confidence',
    'source',
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (options.allowAccountId && Object.prototype.hasOwnProperty.call(body, 'accountId')) {
    const accountId = normalizePositiveBodyInt(body.accountId, 'accountId');
    if (accountId.ok) values.accountId = accountId.value;
    else errors.push({ field: 'accountId', message: accountId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'aliasThreadId')) {
    const aliasThreadId = normalizeRequiredBodyText(body.aliasThreadId, 300);
    if (aliasThreadId.ok) values.aliasThreadId = aliasThreadId.value;
    else errors.push({ field: 'aliasThreadId', message: aliasThreadId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'canonicalThreadId')) {
    const canonicalThreadId = normalizeRequiredBodyText(body.canonicalThreadId, 300);
    if (canonicalThreadId.ok) values.canonicalThreadId = canonicalThreadId.value;
    else errors.push({ field: 'canonicalThreadId', message: canonicalThreadId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'confidence')) {
    const confidence = normalizeRequiredBodyText(body.confidence, 50);
    if (confidence.ok) values.confidence = confidence.value;
    else errors.push({ field: 'confidence', message: confidence.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'source')) {
    const source = normalizeRequiredBodyText(body.source, 100);
    if (source.ok) values.source = source.value;
    else errors.push({ field: 'source', message: source.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email thread alias payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAliasThreadId && !values.aliasThreadId) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'aliasThreadId ist fuer Email thread aliases erforderlich'),
    };
  }
  if (options.requireCanonicalThreadId && !values.canonicalThreadId) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'canonicalThreadId ist fuer Email thread aliases erforderlich'),
    };
  }
  if (
    values.aliasThreadId !== undefined
    && values.canonicalThreadId !== undefined
    && values.aliasThreadId === values.canonicalThreadId
  ) {
    return {
      ok: false,
      response: error(400, 'invalid_email_thread_alias', 'Email thread alias ist ungueltig'),
    };
  }
  if (options.requireAny && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email thread alias update braucht mindestens ein Feld'),
    };
  }

  return { ok: true, values };
}

function parseEmailThreadMergeBody(body: unknown): EmailThreadMergeParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_thread_merge_payload', 'Email thread merge payload muss ein JSON-Objekt sein'),
    };
  }

  const values: {
    aliasThreadId?: string;
    canonicalThreadId?: string;
    accountId?: number;
  } = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['aliasThreadId', 'canonicalThreadId', 'accountId']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'aliasThreadId')) {
    const aliasThreadId = normalizeRequiredBodyText(body.aliasThreadId, 300);
    if (aliasThreadId.ok) values.aliasThreadId = aliasThreadId.value;
    else errors.push({ field: 'aliasThreadId', message: aliasThreadId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'canonicalThreadId')) {
    const canonicalThreadId = normalizeRequiredBodyText(body.canonicalThreadId, 300);
    if (canonicalThreadId.ok) values.canonicalThreadId = canonicalThreadId.value;
    else errors.push({ field: 'canonicalThreadId', message: canonicalThreadId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'accountId')) {
    const accountId = normalizePositiveBodyInt(body.accountId, 'accountId');
    if (accountId.ok) values.accountId = accountId.value;
    else errors.push({ field: 'accountId', message: accountId.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email thread merge payload ist ungueltig', { fields: errors }),
    };
  }
  if (!values.aliasThreadId) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'aliasThreadId ist fuer Email thread merge erforderlich'),
    };
  }
  if (!values.canonicalThreadId) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'canonicalThreadId ist fuer Email thread merge erforderlich'),
    };
  }
  if (values.accountId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'accountId ist fuer Email thread merge erforderlich'),
    };
  }
  if (values.aliasThreadId === values.canonicalThreadId) {
    return {
      ok: false,
      response: error(400, 'invalid_email_thread_alias', 'Email thread alias ist ungueltig'),
    };
  }

  return {
    ok: true,
    values: {
      aliasThreadId: values.aliasThreadId,
      canonicalThreadId: values.canonicalThreadId,
      accountId: values.accountId,
    },
  };
}

function parseEmailThreadSplitBody(body: unknown): EmailThreadSplitParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_thread_split_payload', 'Email thread split payload muss ein JSON-Objekt sein'),
    };
  }

  const values: { messageId?: number } = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['messageId']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'messageId')) {
    const messageId = normalizePositiveBodyInt(body.messageId, 'messageId');
    if (messageId.ok) values.messageId = messageId.value;
    else errors.push({ field: 'messageId', message: messageId.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email thread split payload ist ungueltig', { fields: errors }),
    };
  }
  if (values.messageId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'messageId ist fuer Email thread split erforderlich'),
    };
  }

  return { ok: true, values: { messageId: values.messageId } };
}

function parseEmailAccountSignatureMutationBody(
  body: unknown,
  options: {
    requireAccountId: boolean;
    requireAny: boolean;
  },
): EmailAccountSignatureMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_account_signature_payload', 'Email account signature payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailAccountSignatureMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['accountId', 'signatureHtml']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'accountId')) {
    const accountId = normalizePositiveBodyInt(body.accountId, 'accountId');
    if (accountId.ok) values.accountId = accountId.value;
    else errors.push({ field: 'accountId', message: accountId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'signatureHtml')) {
    const signatureHtml = normalizeNullableBodyText(body.signatureHtml, 'signatureHtml', 20000);
    if (signatureHtml.ok) values.signatureHtml = signatureHtml.value;
    else errors.push({ field: 'signatureHtml', message: signatureHtml.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email account signature payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireAccountId && values.accountId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'accountId ist fuer Email account signatures erforderlich'),
    };
  }
  if (options.requireAny && Object.keys(values).length === 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email account signature update braucht mindestens ein Feld'),
    };
  }

  return { ok: true, values };
}

function parseEmailReadReceiptMutationBody(body: unknown): EmailReadReceiptMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_read_receipt_payload', 'Email read receipt payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailReadReceiptMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowedFields = new Set(['messageId', 'direction', 'recipient', 'at']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'messageId')) {
    const messageId = normalizePositiveBodyInt(body.messageId, 'messageId');
    if (messageId.ok) values.messageId = messageId.value;
    else errors.push({ field: 'messageId', message: messageId.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'direction')) {
    const direction = normalizeRequiredBodyText(body.direction, 50);
    if (direction.ok) values.direction = direction.value;
    else errors.push({ field: 'direction', message: direction.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'recipient')) {
    const recipient = normalizeNullableBodyText(body.recipient, 'recipient', 300);
    if (recipient.ok) values.recipient = recipient.value;
    else errors.push({ field: 'recipient', message: recipient.message });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'at')) {
    const at = normalizeNullableBodyTimestamp(body.at, 'at');
    if (at.ok) values.at = at.value;
    else errors.push({ field: 'at', message: at.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email read receipt payload ist ungueltig', { fields: errors }),
    };
  }
  if (values.messageId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'messageId ist fuer Email read receipts erforderlich'),
    };
  }
  if (!values.direction) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'direction ist fuer Email read receipts erforderlich'),
    };
  }

  return { ok: true, values };
}

function parseEmailInternalNoteMutationBody(
  body: unknown,
  options: {
    requireMessage: boolean;
    requireBody: boolean;
    allowMessageId?: boolean;
    pathMessageId?: number;
  },
): EmailInternalNoteMutationParseResult {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      response: error(400, 'invalid_email_internal_note_payload', 'Email internal note payload muss ein JSON-Objekt sein'),
    };
  }

  const values: EmailInternalNoteMutationInput = {};
  const errors: Array<{ field: string; message: string }> = [];
  const allowMessageId = options.allowMessageId ?? true;
  const allowedFields = new Set(allowMessageId ? ['messageId', 'body'] : ['body']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) errors.push({ field: key, message: 'Feld ist nicht erlaubt' });
  }

  if (options.pathMessageId !== undefined) {
    values.messageId = options.pathMessageId;
  }
  if (allowMessageId && Object.prototype.hasOwnProperty.call(body, 'messageId')) {
    const messageId = normalizePositiveBodyInt(body.messageId, 'messageId');
    if (messageId.ok) {
      if (options.pathMessageId !== undefined && messageId.value !== options.pathMessageId) {
        errors.push({ field: 'messageId', message: 'messageId muss mit der URL uebereinstimmen' });
      } else {
        values.messageId = messageId.value;
      }
    } else {
      errors.push({ field: 'messageId', message: messageId.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'body')) {
    const noteBody = normalizeRequiredBodyText(body.body, 10000);
    if (noteBody.ok) values.body = noteBody.value;
    else errors.push({ field: 'body', message: noteBody.message });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'Email internal note payload ist ungueltig', { fields: errors }),
    };
  }
  if (options.requireMessage && values.messageId === undefined) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'messageId ist fuer neue interne Notizen erforderlich'),
    };
  }
  if (options.requireBody && !values.body) {
    return {
      ok: false,
      response: error(400, 'validation_error', 'body ist fuer interne Notizen erforderlich'),
    };
  }

  return { ok: true, values };
}

function parseCannedResponseFilters(req: ApiRequest): ParseResult<{ search?: string; accountId?: number }> {
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return parseError('invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  return { ok: true, filters: omitUndefined({ search, accountId }) };
}

function parseAccountSignatureFilters(req: ApiRequest): ParseResult<{ accountId?: number }> {
  const accountId = parseOptionalPositiveInt(req.query?.accountId);
  if (accountId === null) return parseError('invalid_account_id', 'accountId muss eine positive Ganzzahl sein');
  return { ok: true, filters: omitUndefined({ accountId }) };
}

function parseRemoteContentAllowlistFilters(req: ApiRequest): ParseResult<{ scope?: string; search?: string }> {
  const scope = normalizeTextFilter(req.query?.scope, 50);
  if (scope === null) return parseError('invalid_scope', 'scope darf maximal 50 Zeichen haben');
  const search = normalizeTextFilter(req.query?.search, 200);
  if (search === null) return parseError('invalid_search', 'search darf maximal 200 Zeichen haben');
  return { ok: true, filters: omitUndefined({ scope, search }) };
}

function parseReadReceiptFilters(req: ApiRequest): ParseResult<{ messageId?: number; direction?: string }> {
  const messageId = parseOptionalPositiveInt(req.query?.messageId);
  if (messageId === null) return parseError('invalid_message_id', 'messageId muss eine positive Ganzzahl sein');
  const direction = normalizeTextFilter(req.query?.direction, 50);
  if (direction === null) return parseError('invalid_direction', 'direction darf maximal 50 Zeichen haben');
  return { ok: true, filters: omitUndefined({ messageId, direction }) };
}

function parseThreadEdgeFilters(req: ApiRequest): ParseResult<{ parentMessageId?: number; childMessageId?: number }> {
  const parentMessageId = parseOptionalPositiveInt(req.query?.parentMessageId);
  if (parentMessageId === null) return parseError('invalid_parent_message_id', 'parentMessageId muss eine positive Ganzzahl sein');
  const childMessageId = parseOptionalPositiveInt(req.query?.childMessageId);
  if (childMessageId === null) return parseError('invalid_child_message_id', 'childMessageId muss eine positive Ganzzahl sein');
  return { ok: true, filters: omitUndefined({ parentMessageId, childMessageId }) };
}

function parseThreadAliasFilters(req: ApiRequest): ParseResult<{
  aliasThreadId?: string;
  canonicalThreadId?: string;
  confidence?: string;
  source?: string;
}> {
  const aliasThreadId = normalizeTextFilter(req.query?.aliasThreadId, 300);
  if (aliasThreadId === null) return parseError('invalid_alias_thread_id', 'aliasThreadId darf maximal 300 Zeichen haben');
  const canonicalThreadId = normalizeTextFilter(req.query?.canonicalThreadId, 300);
  if (canonicalThreadId === null) return parseError('invalid_canonical_thread_id', 'canonicalThreadId darf maximal 300 Zeichen haben');
  const confidence = normalizeTextFilter(req.query?.confidence, 50);
  if (confidence === null) return parseError('invalid_confidence', 'confidence darf maximal 50 Zeichen haben');
  const source = normalizeTextFilter(req.query?.source, 100);
  if (source === null) return parseError('invalid_source', 'source darf maximal 100 Zeichen haben');
  return { ok: true, filters: omitUndefined({ aliasThreadId, canonicalThreadId, confidence, source }) };
}

function sanitizeNumericList<TRecord>(
  result: EmailNumericCursorListResult<TRecord>,
  sanitize: (record: TRecord) => TRecord,
): EmailNumericCursorListResult<TRecord> {
  return {
    items: result.items.map(sanitize),
    nextCursor: result.nextCursor,
  };
}

function sanitizeStringList<TRecord>(
  result: EmailStringCursorListResult<TRecord>,
  sanitize: (record: TRecord) => TRecord,
): EmailStringCursorListResult<TRecord> {
  return {
    items: result.items.map(sanitize),
    nextCursor: result.nextCursor,
  };
}

function sanitizeEmailFolder(folder: EmailFolderRecord): EmailFolderRecord {
  return {
    id: folder.id,
    sourceSqliteId: folder.sourceSqliteId,
    accountSourceSqliteId: folder.accountSourceSqliteId,
    accountId: folder.accountId,
    path: folder.path,
    delimiter: folder.delimiter,
    uidValidity: folder.uidValidity,
    uidValidityText: folder.uidValidityText,
    lastUid: folder.lastUid,
    lastSyncedAt: folder.lastSyncedAt,
    pop3Uidl: folder.pop3Uidl,
    updatedAt: folder.updatedAt,
  };
}

function sanitizeEmailTeamMember(member: EmailTeamMemberRecord): EmailTeamMemberRecord {
  return {
    id: member.id,
    displayName: member.displayName,
    role: member.role,
    signatureHtml: member.signatureHtml,
    sortOrder: member.sortOrder,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

function sanitizeEmailThread(thread: EmailThreadRecord): EmailThreadRecord {
  return {
    id: thread.id,
    ticketCode: thread.ticketCode,
    accountSourceSqliteId: thread.accountSourceSqliteId,
    accountId: thread.accountId,
    rootMessageSourceSqliteId: thread.rootMessageSourceSqliteId,
    rootMessageId: thread.rootMessageId,
    lastMessageAt: thread.lastMessageAt,
    messageCount: thread.messageCount,
    hasUnread: thread.hasUnread,
    hasAttachments: thread.hasAttachments,
    subjectNormalized: thread.subjectNormalized,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function sanitizeEmailMessageTag(tag: EmailMessageTagRecord): EmailMessageTagRecord {
  return {
    id: tag.id,
    sourceSqliteId: tag.sourceSqliteId,
    messageSourceSqliteId: tag.messageSourceSqliteId,
    messageId: tag.messageId,
    tag: tag.tag,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  };
}

function sanitizeEmailCategory(category: EmailCategoryRecord): EmailCategoryRecord {
  return {
    id: category.id,
    sourceSqliteId: category.sourceSqliteId,
    parentSourceSqliteId: category.parentSourceSqliteId,
    parentId: category.parentId,
    name: category.name,
    sortOrder: category.sortOrder,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

function sanitizeEmailCategoryCount(row: EmailCategoryCountRecord): EmailCategoryCountRecord {
  return {
    categoryId: safeCount(row.categoryId),
    count: safeCount(row.count),
  };
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function sanitizeEmailMessageCategory(category: EmailMessageCategoryRecord): EmailMessageCategoryRecord {
  return {
    id: category.id,
    sourceSqliteId: category.sourceSqliteId,
    messageSourceSqliteId: category.messageSourceSqliteId,
    categorySourceSqliteId: category.categorySourceSqliteId,
    messageId: category.messageId,
    categoryId: category.categoryId,
    updatedAt: category.updatedAt,
  };
}

function sanitizeEmailInternalNote(note: EmailInternalNoteRecord): EmailInternalNoteRecord {
  return {
    id: note.id,
    sourceSqliteId: note.sourceSqliteId,
    messageSourceSqliteId: note.messageSourceSqliteId,
    messageId: note.messageId,
    body: note.body,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function sanitizeEmailCannedResponse(response: EmailCannedResponseRecord): EmailCannedResponseRecord {
  return {
    id: response.id,
    sourceSqliteId: response.sourceSqliteId,
    title: response.title,
    body: response.body,
    accountSourceSqliteId: response.accountSourceSqliteId,
    accountId: response.accountId,
    overrideKey: response.overrideKey,
    sortOrder: response.sortOrder,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
  };
}

function sanitizeEmailAccountSignature(signature: EmailAccountSignatureRecord): EmailAccountSignatureRecord {
  return {
    sourceSqliteId: signature.sourceSqliteId,
    accountSourceSqliteId: signature.accountSourceSqliteId,
    accountId: signature.accountId,
    signatureHtml: signature.signatureHtml,
    updatedAt: signature.updatedAt,
  };
}

function sanitizeEmailRemoteContentAllowlist(entry: EmailRemoteContentAllowlistRecord): EmailRemoteContentAllowlistRecord {
  return {
    id: entry.id,
    sourceSqliteId: entry.sourceSqliteId,
    scope: entry.scope,
    value: entry.value,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function sanitizeEmailReadReceipt(receipt: EmailReadReceiptRecord): EmailReadReceiptRecord {
  return {
    id: receipt.id,
    sourceSqliteId: receipt.sourceSqliteId,
    messageSourceSqliteId: receipt.messageSourceSqliteId,
    messageId: receipt.messageId,
    direction: receipt.direction,
    recipient: receipt.recipient,
    at: receipt.at,
    updatedAt: receipt.updatedAt,
  };
}

function sanitizeEmailThreadEdge(edge: EmailThreadEdgeRecord): EmailThreadEdgeRecord {
  return {
    id: edge.id,
    sourceSqliteId: edge.sourceSqliteId,
    parentMessageSourceSqliteId: edge.parentMessageSourceSqliteId,
    childMessageSourceSqliteId: edge.childMessageSourceSqliteId,
    parentMessageId: edge.parentMessageId,
    childMessageId: edge.childMessageId,
    updatedAt: edge.updatedAt,
  };
}

function sanitizeEmailThreadAlias(alias: EmailThreadAliasRecord): EmailThreadAliasRecord {
  return {
    id: alias.id,
    sourceSqliteId: alias.sourceSqliteId,
    accountSourceSqliteId: alias.accountSourceSqliteId,
    accountId: alias.accountId,
    aliasThreadId: alias.aliasThreadId,
    canonicalThreadId: alias.canonicalThreadId,
    confidence: alias.confidence,
    source: alias.source,
    createdAt: alias.createdAt,
    updatedAt: alias.updatedAt,
  };
}

function sanitizeEmailThreadAliasWarning(warning: EmailThreadAliasWarningRecord): EmailThreadAliasWarningRecord {
  return {
    messageId: warning.messageId,
    accountId: warning.accountId,
    subject: warning.subject,
    aliasThreadId: warning.aliasThreadId,
    canonicalThreadId: warning.canonicalThreadId,
    confidence: warning.confidence,
  };
}

function parseLimit(value: string | undefined): number | null {
  if (value === undefined || value === '') return DEFAULT_METADATA_LIMIT;
  const limit = parsePositiveInt(value);
  if (limit === null || limit > MAX_METADATA_LIMIT) return null;
  return limit;
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  return parsePositiveInt(value);
}

function parseOptionalNonZeroInt(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  return parseNonZeroInt(value);
}

function parseOptionalNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositiveInt(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseNonZeroInt(value: string): number | null {
  if (!/^-?[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function sourceSqliteIdFromPath(value: string | undefined): number | null {
  if (value === undefined) return null;
  return parseNonZeroInt(value);
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function parseOptionalThreadView(value: string | undefined):
  | 'inbox'
  | 'sent'
  | 'archived'
  | 'drafts'
  | 'scheduled_send'
  | 'spam_review'
  | 'spam'
  | 'trash'
  | 'snoozed'
  | 'all'
  | undefined
  | null {
  if (value === undefined || value === '') return undefined;
  return isOneOf(value, ['inbox', 'sent', 'archived', 'drafts', 'scheduled_send', 'spam_review', 'spam', 'trash', 'snoozed', 'all'])
    ? value
    : null;
}

function isOneOf<const T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return (allowed as readonly string[]).includes(value);
}

function normalizePositiveBodyInt(
  rawValue: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const value = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string'
      ? Number(rawValue.trim())
      : NaN;
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { ok: false, message: `${field} muss eine positive Ganzzahl sein` };
  }
  return { ok: true, value };
}

function normalizeIntegerBody(
  rawValue: unknown,
  field: string,
  minValue?: number,
): { ok: true; value: number } | { ok: false; message: string } {
  const value = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string' && rawValue.trim() !== ''
      ? Number(rawValue.trim())
      : NaN;
  if (!Number.isSafeInteger(value)) return { ok: false, message: `${field} muss eine Ganzzahl sein` };
  if (minValue !== undefined && value < minValue) {
    return { ok: false, message: `${field} muss mindestens ${minValue} sein` };
  }
  return { ok: true, value };
}

function normalizeNullableBodyText(
  rawValue: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein String oder null sein` };
  const value = rawValue.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > maxLength) return { ok: false, message: `${field} darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value };
}

function normalizeNullableBodyTimestamp(
  rawValue: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (rawValue === null) return { ok: true, value: null };
  if (typeof rawValue !== 'string') return { ok: false, message: `${field} muss ein valides Datum sein` };
  const value = rawValue.trim();
  if (!value) return { ok: true, value: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false, message: `${field} muss ein valides Datum sein` };
  return { ok: true, value: date.toISOString() };
}

function normalizeRequiredBodyText(
  rawValue: unknown,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: 'Feld muss ein String sein' };
  const value = rawValue.trim();
  if (!value) return { ok: false, message: 'Feld darf nicht leer sein' };
  if (value.length > maxLength) return { ok: false, message: `Feld darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value };
}

function normalizeCannedResponseBodyText(
  rawValue: unknown,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof rawValue !== 'string') return { ok: false, message: 'Feld muss ein String sein' };
  const value = rawValue.trim();
  if (value.length > maxLength) return { ok: false, message: `Feld darf maximal ${maxLength} Zeichen haben` };
  return { ok: true, value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeTextFilter(value: string | undefined, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) return null;
  return normalized;
}

function textIdFromPath(value: string | undefined, maxLength: number): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    if (!decoded || decoded.length > maxLength) return null;
    return decoded;
  } catch {
    return null;
  }
}

function omitUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function parseError(code: string, message: string): ParseResult<never> {
  return { ok: false, response: error(400, code, message) };
}
