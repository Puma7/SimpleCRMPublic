import { IPCChannels, type InvokeChannel } from "@shared/ipc/channels"
import { AUTOMATION_SCOPES, type AutomationScope } from "@shared/automation-api"
import { AI_PROVIDER_PRESETS } from "@shared/ai-provider-presets"
import { compileGraphToDefinition } from "@shared/email-workflow-graph-compile"
import { exportWorkflowBundle, parseWorkflowImport } from "@shared/workflow-export-import"

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE"

export type HttpInvocationSpec = {
  method: HttpMethod
  path: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  responseType?: "json" | "blob"
  transform?: (responseBody: unknown, context: HttpInvocationContext) => unknown | Promise<unknown>
}

export type HttpRequestSpec = Omit<HttpInvocationSpec, "transform">

export type HttpInvocationContext = {
  fetchJson: (spec: HttpRequestSpec) => Promise<unknown>
  response?: Response
}

type RouteBuilder = (args: unknown[]) => HttpInvocationSpec

type ApiDataBody<T> = {
  data: T
}

type AuthUserRecord = {
  id: string
  email?: string | null
  displayName?: string | null
  role?: string | null
  disabledAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type AuthInvitationRecord = {
  id: string
  email?: string | null
  displayName?: string | null
  role?: string | null
  expiresAt?: string | null
  acceptedAt?: string | null
  revokedAt?: string | null
  createdAt?: string | null
}

type AuthInvitationDelivery = {
  status?: "sent" | "not_configured" | "failed" | string
  recipient?: string | null
  sentAt?: string | null
  error?: string | null
}

type ListResult<T> = {
  items: T[]
  nextCursor?: number | null
  total?: number | null
}

type CustomerRecord = {
  id: number
  sourceSqliteId?: number | null
  customerNumber?: string | null
  name?: string | null
  firstName?: string | null
  company?: string | null
  email?: string | null
  phone?: string | null
  mobile?: string | null
  street?: string | null
  zipCode?: string | null
  city?: string | null
  country?: string | null
  notes?: string | null
  status?: string | null
  updatedAt?: string | null
}

type ProductRecord = {
  id: number
  sourceSqliteId?: number | null
  jtlKartikel?: number | null
  sku?: string | null
  name?: string | null
  description?: string | null
  price?: string | number | null
  isActive?: boolean | number | null
  updatedAt?: string | null
}

type DealRecord = {
  id: number
  sourceSqliteId?: number | null
  customerSourceSqliteId?: number | null
  customerId?: number | null
  customerName?: string | null
  customer_name?: string | null
  name?: string | null
  value?: string | number | null
  valueCalculationMethod?: "static" | "dynamic" | null
  value_calculation_method?: "static" | "dynamic" | null
  stage?: string | null
  notes?: string | null
  createdDate?: string | null
  created_date?: string | null
  expectedCloseDate?: string | null
  expected_close_date?: string | null
  updatedAt?: string | null
  last_modified?: string | null
}

type DealProductRecord = {
  id: number
  sourceSqliteId?: number | null
  dealSourceSqliteId?: number | null
  productSourceSqliteId?: number | null
  dealId?: number | null
  productId?: number | null
  quantity?: number | null
  priceAtTimeOfAdding?: string | number | null
  dateAdded?: string | null
  product?: ProductRecord | null
}

type TaskRecord = {
  id: number
  sourceSqliteId?: number | null
  customerSourceSqliteId?: number | null
  customerId?: number | null
  title?: string | null
  description?: string | null
  dueDate?: string | null
  priority?: string | null
  completed?: boolean | number | null
  snoozedUntil?: string | null
  updatedAt?: string | null
}

type CalendarEventRecord = {
  id: number
  sourceSqliteId?: number | null
  title?: string | null
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  allDay?: boolean | number | null
  colorCode?: string | null
  eventType?: string | null
  recurrenceRule?: string | null
  taskId?: number | null
  createdAt?: string | null
  updatedAt?: string | null
}

type CustomFieldRecord = {
  id: number
  sourceSqliteId?: number | null
  name?: string | null
  label?: string | null
  type?: string | null
  required?: boolean | number | null
  options?: unknown
  defaultValue?: string | null
  placeholder?: string | null
  description?: string | null
  displayOrder?: number | null
  active?: boolean | number | null
  createdAt?: string | null
  updatedAt?: string | null
}

type CustomFieldValueRecord = {
  id: number
  sourceSqliteId?: number | null
  customerId?: number | null
  fieldId?: number | null
  value?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type JtlReferenceRecord = {
  sourceSqliteId: number
  name?: string | null
  updatedAt?: string | null
}

type DashboardStatsRecord = {
  totalCustomers: number
  newCustomersLastMonth: number
  activeDealsCount: number
  activeDealsValue: number
  pendingTasksCount: number
  dueTodayTasksCount: number
  conversionRate: number
}

type DashboardRecentCustomerRecord = {
  id: number
  name?: string | null
  email?: string | null
  dateAdded?: string | null
}

type DashboardUpcomingTaskRecord = {
  id: number
  title?: string | null
  priority?: string | null
  customerId?: number | null
  dueDate?: string | null
  customerName?: string | null
}

type SavedViewRecord = {
  id: number
  name?: string | null
  filters?: string | null
  displayOrder?: number | null
  createdAt?: string | null
  updatedAt?: string | null
}

type ActivityLogRecord = {
  id: number
  customerId?: number | null
  dealId?: number | null
  taskId?: number | null
  activityType?: string | null
  title?: string | null
  description?: string | null
  metadata?: unknown
  createdAt?: string | null
}

type EmailMessageTagRecord = {
  id: number
  messageId?: number | null
  tag?: string | null
}

type EmailAccountRecord = {
  id: number
  sourceSqliteId?: number | null
  displayName?: string | null
  emailAddress?: string | null
  protocol?: string | null
  imapHost?: string | null
  imapPort?: number | null
  imapTls?: boolean | number | null
  imapUsername?: string | null
  smtpHost?: string | null
  smtpPort?: number | null
  smtpTls?: boolean | number | null
  smtpUsername?: string | null
  smtpUseImapAuth?: boolean | number | null
  pop3Host?: string | null
  pop3Port?: number | null
  pop3Tls?: boolean | number | null
  sentFolderPath?: string | null
  syncSpamFolderPath?: string | null
  syncArchiveFolderPath?: string | null
  imapSyncSent?: boolean | number | null
  imapSyncArchive?: boolean | number | null
  imapSyncSpam?: boolean | number | null
  imapSyncSeenOnOpen?: boolean | number | null
  vacationEnabled?: boolean | number | null
  vacationSubject?: string | null
  vacationBodyText?: string | null
  requestReadReceipt?: boolean | number | null
  updatedAt?: string | null
}

type EmailAttachmentRecord = {
  id: number
  sourceSqliteId?: number | null
  filename?: string | null
  contentType?: string | null
  sizeBytes?: number | null
}

type EmailMessageRecord = {
  id: number
  sourceSqliteId?: number | null
  accountId?: number | null
  folderId?: number | null
  uid?: number | null
  messageId?: string | null
  subject?: string | null
  from?: unknown
  to?: unknown
  cc?: unknown
  bcc?: unknown
  dateReceived?: string | null
  snippet?: string | null
  seenLocal?: boolean | number | null
  doneLocal?: boolean | number | null
  archived?: boolean | number | null
  softDeleted?: boolean | number | null
  folderKind?: string | null
  threadId?: string | null
  imapThreadId?: string | null
  ticketCode?: string | null
  customerId?: number | null
  hasAttachments?: boolean | number | null
  assignedTo?: string | null
  assignedToUserId?: string | null
  isSpam?: boolean | number | null
  spamStatus?: string | null
  pgpStatus?: string | null
  remoteContentPolicy?: string | null
  readReceiptRequested?: boolean | number | null
  snoozedUntil?: string | null
  draftAttachmentPathsJson?: string | null
  replyParentMessageId?: number | null
  bodyText?: string | null
  bodyHtml?: string | null
  updatedAt?: string | null
}

type EmailThreadRecord = {
  id: string
  ticketCode?: string | null
  rootMessageSourceSqliteId?: number | null
  rootMessageId?: number | null
  lastMessageAt?: string | null
  messageCount?: number | null
  hasUnread?: boolean | number | null
  hasAttachments?: boolean | number | null
  subjectNormalized?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type EmailMessageSecurityRecord = {
  authSpf?: string | null
  authDkim?: string | null
  authDmarc?: string | null
  authArc?: string | null
  authDkimDomains?: string | null
  authError?: string | null
  rspamdScore?: number | null
  rspamdAction?: string | null
  rspamdSymbols?: string | null
  rspamdError?: string | null
  securityCheckedAt?: string | null
  spamStatus?: string | null
  spamScore?: number | null
  spamScoreLabel?: string | null
  spamDecisionSource?: string | null
  spamScoreBreakdownJson?: unknown | null
  spamDecidedAt?: string | null
}

type EmailMessageRawHeadersRecord = {
  rawEml?: string | null
  emlSource?: "original" | "reconstructed"
  rawHeaders?: string | null
  messageIdHeader?: string | null
  fromJson?: unknown
}

type EmailReadReceiptStateRecord = {
  success?: boolean | null
  requested?: boolean | number | null
  respond?: string | null
  trustedDomains?: string | null
}

type EmailReadReceiptResponseRecord = {
  success?: boolean | null
  error?: string | null
}

type EmailMailFolderCountsRecord = {
  inbox?: number | null
  inboxUnread?: number | null
  sentFailed?: number | null
  drafts?: number | null
  archived?: number | null
  spamReview?: number | null
  spam?: number | null
  trash?: number | null
  snoozed?: number | null
}

type EmailDiagnosticsRecord = {
  collectedAt?: string | null
  schemaGeneration?: number | null
  schemaGenerationLabel?: string | null
  sizes?: {
    databaseBytes?: number | null
    attachmentsBytes?: number | null
  } | null
  messages?: {
    total?: number | null
    pendingPostProcess?: number | null
    outboundHold?: number | null
    byFolderKind?: Record<string, number | null> | null
  } | null
  workflows?: {
    runsLast24h?: number | null
    runsBlockedLast24h?: number | null
    runsErrorLast24h?: number | null
  } | null
  notices?: {
    imapAuth?: number | null
    uidValidity?: number | null
  } | null
  syncInfo?: {
    totalKeys?: number | null
    prefixes?: Record<string, number | null> | null
  } | null
  background?: {
    cronScheduled?: boolean | null
    cronTickInFlight?: boolean | null
    syncInFlightAccountIds?: unknown
    idleImapAccountIds?: unknown
  } | null
  accounts?: unknown
}

type EmailReportingRecord = {
  accounts?: Array<{
    id?: number | null
    displayName?: string | null
    emailAddress?: string | null
    protocol?: string | null
  }>
  totals?: {
    messages?: number | null
    unread?: number | null
    archived?: number | null
    withCustomer?: number | null
    withAssignment?: number | null
    withAttachments?: number | null
  } | null
  perAccount?: Array<{
    accountId?: number | null
    messages?: number | null
    unread?: number | null
    archived?: number | null
  }>
  workflowRuns24h?: Array<{
    workflowId?: number | null
    count?: number | null
    errors?: number | null
  }>
}

type EmailOAuthResultRecord = {
  success?: boolean | null
  clientId?: string | null
  clientSecret?: string | null
  url?: string | null
  error?: string | null
}

type EmailMessageBulkMutationResult = {
  count?: number | null
}

type EmailAccountSignatureRecord = {
  id?: number | null
  sourceSqliteId?: number | null
  accountSourceSqliteId?: number | null
  accountId?: number | null
  signatureHtml?: string | null
  updatedAt?: string | null
}

type EmailCategoryRecord = {
  id: number
  sourceSqliteId?: number | null
  parentSourceSqliteId?: number | null
  parentId?: number | null
  name?: string | null
  sortOrder?: number | null
  createdAt?: string | null
  updatedAt?: string | null
}

type EmailCategoryCountRecord = {
  categoryId?: number | null
  count?: number | null
}

type EmailMessageCategoryRecord = {
  id: number
  messageId?: number | null
  categoryId?: number | null
  updatedAt?: string | null
}

type EmailInternalNoteRecord = {
  id: number
  messageId?: number | null
  body?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type EmailCannedResponseRecord = {
  id: number
  title?: string | null
  body?: string | null
  sortOrder?: number | null
  createdAt?: string | null
  updatedAt?: string | null
}

type EmailTeamMemberRecord = {
  id: string
  displayName?: string | null
  role?: string | null
  signatureHtml?: string | null
  sortOrder?: number | null
  createdAt?: string | null
  updatedAt?: string | null
}

type AiProfileRecord = {
  id: number
  sourceSqliteId?: number | null
  label?: string | null
  provider?: string | null
  baseUrl?: string | null
  model?: string | null
  embeddingModel?: string | null
  isDefault?: boolean | number | null
  sortOrder?: number | null
  apiKeyConfigured?: boolean | number | null
  createdAt?: string | null
  updatedAt?: string | null
}

type AiPromptRecord = {
  id: number
  sourceSqliteId?: number | null
  label?: string | null
  userTemplate?: string | null
  target?: string | null
  profileSourceSqliteId?: number | null
  profileId?: number | null
  sortOrder?: number | null
  createdAt?: string | null
  updatedAt?: string | null
}

type SpamListEntryRecord = {
  id: number
  sourceSqliteId?: number | null
  listType?: "allow" | "block" | null
  patternType?: "email" | "domain" | null
  pattern?: string | null
  accountSourceSqliteId?: number | null
  accountId?: number | null
  note?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type WorkflowRecord = {
  id: number
  sourceSqliteId?: number | null
  name?: string | null
  triggerName?: string | null
  enabled?: boolean | number | null
  priority?: number | null
  definition?: unknown
  graph?: unknown | null
  cronExpr?: string | null
  scheduleAccountSourceSqliteId?: number | null
  scheduleAccountId?: number | null
  executionMode?: string | null
  engineVersion?: number | null
  legacyCreatedByUserId?: string | null
  createdByUserId?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type WorkflowTemplateRecord = {
  id: string
  name: string
  description: string
  trigger: string
  graph: unknown
}

type WorkflowNodeCatalogRecord = {
  type: string
  label: string
  category: string
  description?: string
  canvasType: string
  defaultConfig?: Record<string, unknown>
}

type WorkflowVersionRecord = {
  id: number
  sourceSqliteId?: number | null
  workflowSourceSqliteId?: number | null
  workflowId?: number | null
  label?: string | null
  graph?: unknown
  definition?: unknown
  createdAt?: string | null
  updatedAt?: string | null
}

type WorkflowRunRecord = {
  id: number
  sourceSqliteId?: number | null
  workflowSourceSqliteId?: number | null
  messageSourceSqliteId?: number | null
  workflowId?: number | null
  messageId?: number | null
  direction?: string | null
  status?: string | null
  log?: unknown | null
  startedAt?: string | null
  finishedAt?: string | null
  updatedAt?: string | null
}

type WorkflowRunStepRecord = {
  id: number
  sourceSqliteId?: number | null
  runSourceSqliteId?: number | null
  runId?: number | null
  nodeId?: string | null
  nodeType?: string | null
  status?: string | null
  port?: string | null
  durationMs?: number | null
  message?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type WorkflowKnowledgeBaseRecord = {
  id: number
  sourceSqliteId?: number | null
  name?: string | null
  description?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type WorkflowKnowledgeChunkRecord = {
  id: number
  sourceSqliteId?: number | null
  knowledgeBaseSourceSqliteId?: number | null
  knowledgeBaseId?: number | null
  title?: string | null
  content?: string | null
  sourcePath?: string | null
  embeddingConfigured?: boolean | number | null
  createdAt?: string | null
  updatedAt?: string | null
}

type PgpIdentityRecord = {
  id: number
  sourceSqliteId?: number | null
  email?: string | null
  fingerprint?: string | null
  publicKeyArmor?: string | null
  hasPrivateKey?: boolean | number | null
  privateKeyConfigured?: boolean | number | null
  expiresAt?: string | null
  isPrimary?: boolean | number | null
  createdAt?: string | null
  updatedAt?: string | null
}

type PgpPeerKeyRecord = {
  id: number
  sourceSqliteId?: number | null
  email?: string | null
  fingerprint?: string | null
  publicKeyArmor?: string | null
  source?: string | null
  verifiedAt?: string | null
  verifiedByUserId?: string | null
  legacyVerifiedByUserId?: string | null
  trustLevel?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type PgpFingerprintResult = {
  fingerprint?: string | null
}

type PgpRecipientKeyStatusRecord = {
  email?: string | null
  hasKey?: boolean | number | null
  fingerprint?: string | null
}

type PgpDecryptMessageResult = {
  text?: string | null
  status?: string | null
}

type FollowUpQueueCountsRecord = {
  heute?: number | null
  ueberfaellig?: number | null
  dieseWoche?: number | null
  zurueckgestellt?: number | null
  stagnierend?: number | null
  highValueRisk?: number | null
}

type FollowUpItemRecord = {
  itemId?: number | null
  item_id?: number | null
  sourceType?: "task" | "deal" | null
  source_type?: "task" | "deal" | null
  customerId?: number | null
  customer_id?: number | null
  customerName?: string | null
  customer_name?: string | null
  dealId?: number | null
  deal_id?: number | null
  dealName?: string | null
  deal_name?: string | null
  dealValue?: number | string | null
  deal_value?: number | string | null
  dealStage?: string | null
  deal_stage?: string | null
  title?: string | null
  reason?: string | null
  dueDate?: string | null
  due_date?: string | null
  priority?: string | null
  priorityScore?: number | string | null
  priority_score?: number | string | null
  lastContactDate?: string | null
  last_contact_date?: string | null
  snoozedUntil?: string | null
  snoozed_until?: string | null
  completed?: boolean | number | null
}

type AuditEventRecord = {
  id?: number | null
  actorUserId?: string | null
  action?: string | null
  entityType?: string | null
  entityId?: string | null
  metadata?: unknown
  previousHash?: string | null
  eventHash?: string | null
  createdAt?: string | null
}

type AutomationApiKeyRecord = {
  id?: string | null
  label?: string | null
  scopes?: unknown
  lastUsedAt?: string | null
  revokedAt?: string | null
  createdByUserId?: string | null
  secretConfigured?: boolean | null
  createdAt?: string | null
  updatedAt?: string | null
}

const DEFAULT_LIST_LIMIT = 100

const routeBuilders = new Map<InvokeChannel, RouteBuilder>([
  [IPCChannels.Sync.GetStatus, () => ({
    method: "GET",
    path: "/api/v1/jtl/sync/status",
    transform: (body) => dataBody<Record<string, unknown>>(body),
  })],
  [IPCChannels.Sync.Run, () => ({
    method: "POST",
    path: "/api/v1/jtl/sync/run",
    transform: (body) => dataBody<Record<string, unknown>>(body),
  })],
  [IPCChannels.Sync.GetInfo, ([key]) => ({
    method: "GET",
    path: `/api/v1/sync-info/${pathTextSegment(key, "sync info key", 200)}`,
    transform: (body) => dataBody<{ value?: string | null }>(body).value ?? null,
  })],
  [IPCChannels.Sync.SetInfo, ([payload]) => {
    const input = objectPayload(payload, "sync info payload")
    const key = pathTextSegment(input.key, "sync info key", 200)
    const value = input.value === null
      ? null
      : typeof input.value === "string"
        ? input.value
        : String(input.value ?? "")
    return {
      method: "PATCH",
      path: `/api/v1/sync-info/${key}`,
      body: { value },
      transform: (body) => dataBody<Record<string, unknown>>(body),
    }
  }],
  [IPCChannels.Mssql.GetSettings, () => ({
    method: "GET",
    path: "/api/v1/mssql/settings",
    transform: (body) => {
      const settings = dataBody<Record<string, unknown> | null>(body)
      return settings ? { ...settings, password: undefined } : null
    },
  })],
  [IPCChannels.Mssql.SaveSettings, ([payload]) => ({
    method: "PATCH",
    path: "/api/v1/mssql/settings",
    body: mapMssqlSettingsPayload(payload),
    transform: (body) => dataBody<Record<string, unknown>>(body),
  })],
  [IPCChannels.Mssql.TestConnection, ([payload]) => ({
    method: "POST",
    path: "/api/v1/mssql/test-connection",
    body: payload === undefined || payload === null ? undefined : mapMssqlSettingsPayload(payload),
    transform: (body) => dataBody<Record<string, unknown>>(body),
  })],
  [IPCChannels.Mssql.ClearPassword, () => ({
    method: "DELETE",
    path: "/api/v1/mssql/password",
    transform: (body) => dataBody<Record<string, unknown>>(body),
  })],
  [IPCChannels.Auth.ListUsers, () => ({
    method: "GET",
    path: "/api/v1/auth/users",
    transform: (body) => listItems<AuthUserRecord>(body).map(mapAuthUserRecord),
  })],
  [IPCChannels.Auth.SaveUser, ([payload]) => {
    const input = objectPayload(payload, "auth user payload")
    const id = optionalTextQueryValue(input.id, "auth user id", 120)
    return {
      method: id ? "PATCH" : "POST",
      path: id ? `/api/v1/auth/users/${pathTextSegment(id, "auth user id", 120)}` : "/api/v1/auth/users",
      body: mapAuthUserPayload(input),
      transform: (body) => {
        const user = dataBody<AuthUserRecord>(body)
        return {
          success: true,
          id: user.id,
        }
      },
    }
  }],
  [IPCChannels.Auth.CreateInvite, ([payload]) => ({
    method: "POST",
    path: "/api/v1/auth/invitations",
    body: mapAuthInvitePayload(objectPayload(payload, "auth invite payload")),
    transform: (body) => {
      const result = dataBody<{
        invitation?: AuthInvitationRecord
        token?: string
        acceptPath?: string
        delivery?: AuthInvitationDelivery
      }>(body)
      return {
        success: true,
        invitation: result.invitation,
        token: result.token,
        acceptPath: result.acceptPath,
        delivery: result.delivery,
      }
    },
  })],
  [IPCChannels.Auth.ListAuditLog, ([payload]) => {
    const input = objectPayload(payload ?? {}, "audit log payload")
    return {
      method: "GET",
      path: "/api/v1/auth/audit-log",
      query: pruneQueryUndefined({
        limit: limitValue(input.limit),
        offset: offsetValue(input.offset),
      }),
      transform: (body) => listItems<AuditEventRecord>(body).map(mapAuditEventRecord),
    }
  }],
  [IPCChannels.Auth.VerifyAuditChain, () => ({
    method: "GET",
    path: "/api/v1/auth/audit-chain/verify",
    transform: (body) => dataBody<Record<string, unknown>>(body),
  })],
  [IPCChannels.Automation.GetSettings, () => ({
    method: "GET",
    path: "/api/v1/automation/api-keys",
    query: { limit: DEFAULT_LIST_LIMIT, revoked: false },
    transform: (body) => mapAutomationApiSettings(listItems<AutomationApiKeyRecord>(body)),
  })],
  [IPCChannels.Automation.GenerateApiKey, ([payload]) => {
    const input = objectPayload(payload ?? {}, "automation api key payload")
    const scopes = automationScopesPayload(input.scopes)
    return {
      method: "POST",
      path: "/api/v1/automation/api-keys",
      body: {
        label: automationApiKeyLabel(input.label),
        scopes,
      },
      transform: (body) => {
        const result = dataBody<{
          apiKey?: AutomationApiKeyRecord
          key?: string
        }>(body)
        return {
          success: true,
          key: result.key,
          scopes: mapAutomationScopes(result.apiKey?.scopes ?? scopes),
          apiKey: result.apiKey ? mapAutomationApiKeyRecord(result.apiKey) : undefined,
        }
      },
    }
  }],
  [IPCChannels.Automation.RevokeApiKey, ([payload]) => {
    const id = automationApiKeyId(payload)
    return {
      method: "DELETE",
      path: `/api/v1/automation/api-keys/${pathTextSegment(id, "automation api key id", 80)}`,
      transform: (body) => {
        const result = dataBody<{
          revoked?: boolean
          apiKey?: AutomationApiKeyRecord
        }>(body)
        return {
          success: result.revoked === true,
          apiKey: result.apiKey ? mapAutomationApiKeyRecord(result.apiKey) : undefined,
        }
      },
    }
  }],
  [IPCChannels.Db.GetCustomers, ([payload]) => {
    const paginatedPayload = isRecord(payload) ? payload : null
    const includeCustomFields = paginatedPayload ? Boolean(paginatedPayload.includeCustomFields) : Boolean(payload)
    const requestedLimit = clientListLimitValue(paginatedPayload?.limit)
    const limit = Math.min(requestedLimit, DEFAULT_LIST_LIMIT)
    const offset = offsetValue(paginatedPayload?.offset)
    const search = paginatedPayload && typeof paginatedPayload.query === "string" ? paginatedPayload.query : ""
    const status = paginatedPayload && typeof paginatedPayload.status === "string" ? paginatedPayload.status : ""
    const sortBy = paginatedPayload && typeof paginatedPayload.sortBy === "string" ? paginatedPayload.sortBy : ""
    const sortDirection = paginatedPayload?.sortDirection === "desc" ? "desc" : "asc"
    const baseQuery: Record<string, string | number | boolean | null | undefined> = { limit }
    if (offset > 0) baseQuery.offset = offset
    if (search) baseQuery.search = search
    if (status) baseQuery.status = status
    if (sortBy) {
      baseQuery.sortBy = sortBy
      baseQuery.sortDirection = sortDirection
    }

    return {
      method: "GET",
      path: "/api/v1/customers",
      query: baseQuery,
      transform: async (body, context) => {
      if (paginatedPayload && paginatedPayload.paginated !== false) {
        const page = listResult<CustomerRecord>(body)
        const records = await collectOffsetListItems<CustomerRecord>(body, context, {
          method: "GET",
          path: "/api/v1/customers",
          query: baseQuery,
        }, offset, requestedLimit)
        const pageRecords = records.slice(0, requestedLimit)
        const customers = pageRecords.map(mapCustomerRecord)
        const items = includeCustomFields
          ? await attachCustomerCustomFields(context, customers)
          : customers
        return {
          items,
          total: page.total ?? (records.length < offset + requestedLimit ? records.length : offset + items.length + 1),
        }
      }

      const items = await collectPagedListItems<CustomerRecord>(body, context, {
        method: "GET",
        path: "/api/v1/customers",
        query: baseQuery,
      })
      const customers = items.map(mapCustomerRecord)
      if (!includeCustomFields) return customers
      return attachCustomerCustomFields(context, customers)
    },
    }
  }],
  [IPCChannels.Db.GetCustomersDropdown, () => ({
    method: "GET",
    path: "/api/v1/customers",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: async (body, context) => {
      const items = await collectPagedListItems<CustomerRecord>(body, context, {
        method: "GET",
        path: "/api/v1/customers",
        query: { limit: DEFAULT_LIST_LIMIT },
      })
      return items.map((customer) => ({
        id: customer.id,
        name: customer.name ?? customer.company ?? "",
        company: customer.company ?? "",
        email: customer.email ?? "",
      }))
    },
  })],
  [IPCChannels.Db.SearchCustomers, ([payload]) => {
    const searchPayload = isRecord(payload) ? payload : null
    const search = searchPayload ? String(searchPayload.query ?? "") : String(payload ?? "")
    const limit = searchPayload && typeof searchPayload.limit === "number" ? searchPayload.limit : DEFAULT_LIST_LIMIT
    return {
      method: "GET",
      path: "/api/v1/customers",
      query: { limit, search },
      transform: async (body, context) => {
        const items = searchPayload
          ? listItems<CustomerRecord>(body)
          : await collectPagedListItems<CustomerRecord>(body, context, {
              method: "GET",
              path: "/api/v1/customers",
              query: { limit, search },
            })
        return items.map(mapCustomerRecord)
      },
    }
  }],
  [IPCChannels.Db.GetCustomer, ([id]) => ({
    method: "GET",
    path: `/api/v1/customers/${positiveId(id, "customer id")}`,
    transform: (body) => mapCustomerRecord(dataBody<CustomerRecord>(body)),
  })],
  [IPCChannels.Db.CreateCustomer, ([customerData]) => ({
    method: "POST",
    path: "/api/v1/customers",
    body: mapCustomerMutation(customerData),
    transform: (body) => ({ success: true, customer: mapCustomerRecord(dataBody<CustomerRecord>(body)) }),
  })],
  [IPCChannels.Db.UpdateCustomer, ([payload]) => {
    const update = objectPayload(payload, "customer update payload")
    const customFields = customerCustomFieldsPayload(update.customerData)
    return {
      method: "PATCH",
      path: `/api/v1/customers/${positiveId(update.id, "customer id")}`,
      body: mapCustomerMutation(update.customerData),
      transform: async (body, context) => {
        const customer = mapCustomerRecord(dataBody<CustomerRecord>(body))
        if (customFields) {
          await persistCustomerCustomFields(context, customer.id, customFields)
        }
        return {
          success: true,
          customer: customFields ? { ...customer, customFields } : customer,
        }
      },
    }
  }],
  [IPCChannels.Db.DeleteCustomer, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/customers/${positiveId(id, "customer id")}`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Db.GetTasksForCustomer, ([customerId]) => ({
    method: "GET",
    path: "/api/v1/tasks",
    query: { limit: DEFAULT_LIST_LIMIT, customerId: positiveId(customerId, "customer id") },
    transform: (body) => listItems<TaskRecord>(body).map(mapTaskRecord),
  })],
  [IPCChannels.Db.GetDealsForCustomer, ([customerId]) => ({
    method: "GET",
    path: "/api/v1/deals",
    query: { limit: DEFAULT_LIST_LIMIT, customerId: positiveId(customerId, "customer id") },
    transform: (body) => listItems<DealRecord>(body).map(mapDealRecord),
  })],

  [IPCChannels.Products.GetAll, () => ({
    method: "GET",
    path: "/api/v1/products",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: async (body, context) => {
      const items = await collectPagedListItems<ProductRecord>(body, context, {
        method: "GET",
        path: "/api/v1/products",
        query: { limit: DEFAULT_LIST_LIMIT },
      })
      return items.map(mapProductRecord)
    },
  })],
  [IPCChannels.Products.Search, ([payload]) => {
    const searchPayload = isRecord(payload) ? payload : null
    const search = searchPayload ? String(searchPayload.query ?? "") : String(payload ?? "")
    const requestedLimit = clientListLimitValue(searchPayload?.limit)
    const limit = Math.min(requestedLimit, DEFAULT_LIST_LIMIT)
    return {
      method: "GET",
      path: "/api/v1/products",
      query: { limit, search },
      transform: async (body, context) => {
        const items = searchPayload
          ? await collectPagedListItems<ProductRecord>(body, context, {
              method: "GET",
              path: "/api/v1/products",
              query: { limit, search },
            }, requestedLimit)
          : await collectPagedListItems<ProductRecord>(body, context, {
              method: "GET",
              path: "/api/v1/products",
              query: { limit, search },
            })
        return items.map(mapProductRecord)
      },
    }
  }],
  [IPCChannels.Products.GetById, ([id]) => ({
    method: "GET",
    path: `/api/v1/products/${positiveId(id, "product id")}`,
    transform: (body) => mapProductRecord(dataBody<ProductRecord>(body)),
  })],
  [IPCChannels.Products.Create, ([productData]) => ({
    method: "POST",
    path: "/api/v1/products",
    body: mapProductMutation(productData),
    transform: (body) => ({ success: true, product: mapProductRecord(dataBody<ProductRecord>(body)) }),
  })],
  [IPCChannels.Products.Update, ([payload]) => {
    const update = objectPayload(payload, "product update payload")
    return {
      method: "PATCH",
      path: `/api/v1/products/${positiveId(update.id, "product id")}`,
      body: mapProductMutation(update.productData ?? update),
      transform: (body) => ({ success: true, product: mapProductRecord(dataBody<ProductRecord>(body)) }),
    }
  }],
  [IPCChannels.Products.Delete, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/products/${positiveId(id, "product id")}`,
    transform: () => ({ success: true }),
  })],

  [IPCChannels.Deals.GetAll, ([params]) => {
    const input = objectPayload(params ?? {}, "deal list params")
    const filter = objectPayload(input.filter ?? {}, "deal filter")
    return {
      method: "GET",
      path: "/api/v1/deals",
      query: {
        limit: limitValue(input.limit),
        search: filter.query,
        stage: filter.stage,
        customerId: filter.customerId ?? filter.customer_id,
      },
      transform: (body) => listItems<DealRecord>(body).map(mapDealRecord),
    }
  }],
  [IPCChannels.Deals.GetById, ([id]) => ({
    method: "GET",
    path: `/api/v1/deals/${positiveId(id, "deal id")}`,
    transform: (body) => mapDealRecord(dataBody<DealRecord>(body)),
  })],
  [IPCChannels.Deals.Create, ([dealData]) => ({
    method: "POST",
    path: "/api/v1/deals",
    body: mapDealMutation(dealData),
    transform: (body) => {
      const deal = mapDealRecord(dataBody<DealRecord>(body))
      return { success: true, id: deal.id, deal }
    },
  })],
  [IPCChannels.Deals.Update, ([payload]) => {
    const update = objectPayload(payload, "deal update payload")
    return {
      method: "PATCH",
      path: `/api/v1/deals/${positiveId(update.id, "deal id")}`,
      body: mapDealMutation(update.dealData ?? update),
      transform: (body) => ({ success: true, deal: mapDealRecord(dataBody<DealRecord>(body)) }),
    }
  }],
  [IPCChannels.Deals.UpdateStage, ([payload]) => {
    const input = objectPayload(payload, "deal stage payload")
    return {
      method: "POST",
      path: `/api/v1/deals/${positiveId(input.dealId, "deal id")}/stage`,
      body: { stage: input.newStage ?? input.stage ?? input.stageId },
      transform: (body) => ({ success: true, deal: mapDealRecord(dataBody<DealRecord>(body)) }),
    }
  }],
  [IPCChannels.Deals.Delete, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/deals/${positiveId(id, "deal id")}`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Deals.GetTasks, ([dealId]) => ({
    method: "GET",
    path: `/api/v1/deals/${positiveId(dealId, "deal id")}/tasks`,
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<TaskRecord>(body).map(mapTaskRecord),
  })],
  [IPCChannels.Deals.GetProducts, ([dealId]) => ({
    method: "GET",
    path: `/api/v1/deals/${positiveId(dealId, "deal id")}/products`,
    transform: (body) => dataBody<DealProductRecord[]>(body).map(mapDealProductRecord),
  })],
  [IPCChannels.Deals.AddProduct, ([payload]) => {
    const input = objectPayload(payload, "deal product payload")
    return {
      method: "POST",
      path: `/api/v1/deals/${positiveId(input.dealId, "deal id")}/products`,
      body: mapDealProductMutation(input, { includeProduct: true }),
      transform: (body) => {
        const dealProduct = mapDealProductRecord(dataBody<DealProductRecord>(body))
        return { success: true, lastInsertRowid: dealProduct.deal_product_id, dealProduct }
      },
    }
  }],
  [IPCChannels.Deals.UpdateProduct, ([payload]) => {
    const input = objectPayload(payload, "deal product update payload")
    return {
      method: "PATCH",
      path: dealProductMutationPath(input),
      body: mapDealProductMutation(input, { includeProduct: false }),
      transform: (body) => ({ success: true, changes: 1, dealProduct: mapDealProductRecord(dataBody<DealProductRecord>(body)) }),
    }
  }],
  [IPCChannels.Deals.UpdateProductQuantityLegacy, ([payload]) => {
    const input = objectPayload(payload, "deal product update payload")
    return {
      method: "PATCH",
      path: dealProductMutationPath(input),
      body: mapDealProductMutation({
        ...input,
        quantity: input.quantity ?? input.newQuantity,
      }, { includeProduct: false }),
      transform: (body) => ({ success: true, changes: 1, dealProduct: mapDealProductRecord(dataBody<DealProductRecord>(body)) }),
    }
  }],
  [IPCChannels.Deals.RemoveProduct, ([payload]) => {
    const input = objectPayload(payload, "deal product delete payload")
    return {
      method: "DELETE",
      path: dealProductMutationPath(input),
      transform: () => ({ success: true, changes: 1 }),
    }
  }],

  [IPCChannels.Tasks.GetAll, ([params]) => {
    const input = objectPayload(params ?? {}, "task list params")
    const filter = objectPayload(input.filter ?? {}, "task filter")
    return {
      method: "GET",
      path: "/api/v1/tasks",
      query: {
        limit: limitValue(input.limit),
        search: filter.query,
        completed: filter.completed,
      },
      transform: (body) => listItems<TaskRecord>(body).map(mapTaskRecord),
    }
  }],
  [IPCChannels.Tasks.GetById, ([id]) => ({
    method: "GET",
    path: `/api/v1/tasks/${positiveId(id, "task id")}`,
    transform: (body) => mapTaskRecord(dataBody<TaskRecord>(body)),
  })],
  [IPCChannels.Tasks.Create, ([taskData]) => ({
    method: "POST",
    path: "/api/v1/tasks",
    body: mapTaskMutation(taskData),
    transform: (body) => {
      const task = mapTaskRecord(dataBody<TaskRecord>(body))
      return { success: true, id: task.id, task }
    },
  })],
  [IPCChannels.Tasks.Update, ([payload]) => {
    const update = objectPayload(payload, "task update payload")
    return {
      method: "PATCH",
      path: `/api/v1/tasks/${positiveId(update.id, "task id")}`,
      body: mapTaskMutation(update.taskData),
      transform: (body) => ({ success: true, task: mapTaskRecord(dataBody<TaskRecord>(body)) }),
    }
  }],
  [IPCChannels.Tasks.ToggleCompletion, ([payload]) => {
    const input = objectPayload(payload, "task completion payload")
    return {
      method: "POST",
      path: `/api/v1/tasks/${positiveId(input.taskId, "task id")}/toggle`,
      body: { completed: Boolean(input.completed) },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Tasks.Delete, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/tasks/${positiveId(id, "task id")}`,
    transform: () => ({ success: true }),
  })],

  [IPCChannels.Calendar.GetCalendarEvents, () => ({
    method: "GET",
    path: "/api/v1/calendar-events",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<CalendarEventRecord>(body).map(mapCalendarEventRecord),
  })],
  [IPCChannels.Calendar.AddCalendarEvent, ([eventData]) => ({
    method: "POST",
    path: "/api/v1/calendar-events",
    body: mapCalendarEventMutation(eventData),
    transform: (body) => {
      const event = mapCalendarEventRecord(dataBody<CalendarEventRecord>(body))
      return { success: true, id: event.id, lastInsertRowid: event.id, event }
    },
  })],
  [IPCChannels.Calendar.UpdateCalendarEvent, ([payload]) => {
    const update = objectPayload(payload, "calendar update payload")
    return {
      method: "PATCH",
      path: `/api/v1/calendar-events/${positiveId(update.id, "calendar event id")}`,
      body: mapCalendarEventMutation(update.eventData),
      transform: () => undefined,
    }
  }],
  [IPCChannels.Calendar.DeleteCalendarEvent, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/calendar-events/${positiveId(id, "calendar event id")}`,
    transform: () => undefined,
  })],

  [IPCChannels.CustomFields.GetAll, () => ({
    method: "GET",
    path: "/api/v1/customer-custom-fields",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<CustomFieldRecord>(body).map(mapCustomFieldRecord),
  })],
  [IPCChannels.CustomFields.GetActive, () => ({
    method: "GET",
    path: "/api/v1/customer-custom-fields",
    query: { limit: DEFAULT_LIST_LIMIT, active: true },
    transform: (body) => listItems<CustomFieldRecord>(body).map(mapCustomFieldRecord),
  })],
  [IPCChannels.CustomFields.GetById, ([id]) => ({
    method: "GET",
    path: `/api/v1/customer-custom-fields/${positiveId(id, "custom field id")}`,
    transform: (body) => mapCustomFieldRecord(dataBody<CustomFieldRecord>(body)),
  })],
  [IPCChannels.CustomFields.Create, ([fieldData]) => ({
    method: "POST",
    path: "/api/v1/customer-custom-fields",
    body: mapCustomFieldMutation(fieldData),
    transform: (body) => ({ success: true, field: mapCustomFieldRecord(dataBody<CustomFieldRecord>(body)) }),
  })],
  [IPCChannels.CustomFields.Update, ([payload]) => {
    const update = objectPayload(payload, "custom field update payload")
    return {
      method: "PATCH",
      path: `/api/v1/customer-custom-fields/${positiveId(update.id, "custom field id")}`,
      body: mapCustomFieldMutation(update.fieldData),
      transform: (body) => ({ success: true, field: mapCustomFieldRecord(dataBody<CustomFieldRecord>(body)) }),
    }
  }],
  [IPCChannels.CustomFields.Delete, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/customer-custom-fields/${positiveId(id, "custom field id")}`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.CustomFields.GetValuesForCustomer, ([customerId]) => ({
    method: "GET",
    path: "/api/v1/customer-custom-field-values",
    query: { limit: DEFAULT_LIST_LIMIT, customerId: positiveId(customerId, "customer id") },
    transform: (body) => listItems<CustomFieldValueRecord>(body).map(mapCustomFieldValueRecord),
  })],
  [IPCChannels.CustomFields.SetValue, ([payload]) => {
    const input = objectPayload(payload, "custom field value payload")
    return {
      method: "POST",
      path: "/api/v1/customer-custom-field-values",
      body: {
        customerId: positiveId(input.customerId, "customer id"),
        fieldId: positiveId(input.fieldId ?? input.customFieldId, "custom field id"),
        value: input.value === undefined || input.value === null ? null : String(input.value),
      },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.CustomFields.DeleteValue, ([payload]) => {
    const input = objectPayload(payload, "custom field value delete payload")
    return {
      method: "DELETE",
      path: `/api/v1/customers/${positiveId(input.customerId, "customer id")}/custom-field-values/${positiveId(input.fieldId ?? input.customFieldId, "custom field id")}`,
      transform: () => ({ success: true }),
    }
  }],

  [IPCChannels.Email.ListAccounts, () => ({
    method: "GET",
    path: "/api/v1/email/accounts",
    transform: (body) => listItems<EmailAccountRecord>(body).map(mapEmailAccountRecord),
  })],
  [IPCChannels.Email.CreateAccount, ([payload]) => {
    const input = objectPayload(payload, "email account payload")
    return {
      method: "POST",
      path: "/api/v1/email/accounts",
      body: mapEmailAccountMutationPayload(input),
      transform: (body) => {
        const result = dataBody<{ success?: boolean; id?: number; account?: EmailAccountRecord }>(body)
        if (result.success === false) return result
        const id = result.id ?? (result.account ? mapEmailAccountRecord(result.account).id : undefined)
        return { success: true, ...(id === undefined ? {} : { id }) }
      },
    }
  }],
  [IPCChannels.Email.UpdateAccount, ([payload]) => {
    const input = objectPayload(payload, "email account payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/accounts/${positiveId(input.id, "email account id")}`,
      body: mapEmailAccountMutationPayload(input),
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.DeleteAccount, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/email/accounts/${positiveId(id, "email account id")}`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.TestImap, ([payload]) => {
    const input = objectPayload(payload, "email imap test payload")
    return {
      method: "POST",
      path: "/api/v1/email/accounts/test-imap",
      body: pruneUndefined({
        accountId: optionalPositiveQueryId(input.accountId, "email account id"),
        imapHost: stringPayloadField(input.imapHost, "imap host"),
        imapPort: positiveId(input.imapPort, "imap port"),
        imapTls: requiredBoolean(input.imapTls, "imap tls flag"),
        imapUsername: stringPayloadField(input.imapUsername, "imap username"),
        imapPassword: input.imapPassword === undefined || input.imapPassword === null
          ? ""
          : String(input.imapPassword),
      }),
      transform: (body) => dataBody<{ success: boolean; error?: string }>(body),
    }
  }],
  [IPCChannels.Email.TestPop3, ([payload]) => {
    const input = objectPayload(payload, "email pop3 test payload")
    return {
      method: "POST",
      path: "/api/v1/email/accounts/test-pop3",
      body: pruneUndefined({
        accountId: optionalPositiveQueryId(input.accountId, "email account id"),
        host: stringPayloadField(input.host, "pop3 host"),
        port: positiveId(input.port, "pop3 port"),
        tls: requiredBoolean(input.tls, "pop3 tls flag"),
        user: stringPayloadField(input.user, "pop3 user"),
        password: input.password === undefined || input.password === null ? "" : String(input.password),
      }),
      transform: (body) => dataBody<{ success: boolean; error?: string }>(body),
    }
  }],
  [IPCChannels.Email.TestSmtp, ([payload]) => {
    const input = objectPayload(payload, "email smtp test payload")
    return {
      method: "POST",
      path: "/api/v1/email/accounts/test-smtp",
      body: pruneUndefined({
        accountId: optionalPositiveQueryId(input.accountId, "email account id"),
        host: stringPayloadField(input.host, "smtp host"),
        port: positiveId(input.port, "smtp port"),
        secure: requiredBoolean(input.secure, "smtp secure flag"),
        user: stringPayloadField(input.user, "smtp user"),
        password: input.password === undefined || input.password === null ? "" : String(input.password),
        smtpUseImapAuth: optionalBoolean(input.smtpUseImapAuth, "smtp imap auth flag"),
      }),
      transform: (body) => dataBody<{ success: boolean; error?: string }>(body),
    }
  }],
  [IPCChannels.Email.TestVacationAutoReply, ([id]) => ({
    method: "POST",
    path: `/api/v1/email/accounts/${positiveId(id, "email account id")}/vacation-test`,
    transform: (body) => {
      const result = dataBody<{ success: boolean; error?: string }>(body)
      return result.success ? { success: true } : { success: false, error: result.error ?? "Test fehlgeschlagen" }
    },
  })],
  [IPCChannels.Email.SyncAccount, ([id]) => ({
    method: "POST",
    path: `/api/v1/email/accounts/${positiveId(id, "email account id")}/sync`,
    transform: (body) => {
      const result = dataBody<Record<string, unknown>>(body)
      return {
        success: true,
        fetched: typeof result.fetched === "number" ? result.fetched : 0,
        ...result,
      }
    },
  })],
  [IPCChannels.Email.ClearAccountSyncLock, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/email/accounts/${positiveId(id, "email account id")}/sync-lock`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.MailFolderCounts, ([accountScope]) => ({
    method: "GET",
    path: "/api/v1/email/folder-counts",
    query: pruneQueryUndefined({
      accountId: accountScopeQueryValue(accountScope),
    }),
    transform: (body) => mapMailFolderCounts(dataBody<EmailMailFolderCountsRecord>(body)),
  })],
  [IPCChannels.Email.GetMailDiagnostics, () => ({
    method: "GET",
    path: "/api/v1/email/diagnostics",
    transform: (body) => mapEmailDiagnosticsReport(dataBody<EmailDiagnosticsRecord>(body)),
  })],
  [IPCChannels.Email.EmailReporting, ([accountId]) => {
    const id = accountId === null || accountId === undefined
      ? undefined
      : positiveId(accountId, "email account id")
    return {
      method: "GET",
      path: "/api/v1/email/reporting",
      query: id === undefined ? undefined : { accountId: id },
      transform: (body) => ({
        success: true,
        data: mapEmailReportingSnapshot(dataBody<EmailReportingRecord>(body)),
      }),
    }
  }],
  [IPCChannels.Email.EmailGdprExport, ([payload]) => {
    const input = objectPayload(payload, "email GDPR export payload")
    const skipAttachments = optionalBoolean(input.skipAttachments, "email GDPR export skipAttachments flag")
    return {
      method: "GET",
      path: "/api/v1/email/gdpr-export",
      query: pruneQueryUndefined({
        skipAttachments: skipAttachments === true ? true : undefined,
      }),
      responseType: "blob",
      transform: (body, context) => ({
        ok: true,
        blob: body,
        filename: contentDispositionFileName(context.response?.headers?.get("Content-Disposition") ?? null),
        contentType: context.response?.headers?.get("Content-Type") ?? null,
      }),
    }
  }],
  [IPCChannels.Email.BackfillCustomerLinks, ([payload]) => {
    const input = objectPayload(payload ?? {}, "email customer-link backfill payload")
    return {
      method: "POST",
      path: "/api/v1/email/messages/backfill-customer-links",
      body: pruneUndefined({
        accountId: optionalPositiveQueryId(input.accountId, "email account id"),
        limit: optionalPositiveQueryId(input.limit, "email customer-link backfill limit"),
      }),
      transform: (body) => {
        const result = dataBody<{ success?: boolean; count?: number }>(body)
        return { success: true, count: Number(result.count ?? 0) }
      },
    }
  }],
  [IPCChannels.Email.ListMessages, ([payload]) => {
    const input = objectPayload(payload, "email message folder list payload")
    const folderPath = input.folderPath === undefined || input.folderPath === null
      ? "INBOX"
      : String(input.folderPath)
    return {
      method: "GET",
      path: "/api/v1/email/messages",
      query: pruneQueryUndefined({
        accountId: positiveId(input.accountId, "email account id"),
        folderPath,
        limit: limitValue(input.limit),
        offset: offsetValue(input.offset),
      }),
      transform: (body) => listItems<EmailMessageRecord>(body).map(mapEmailMessageRecord),
    }
  }],
  [IPCChannels.Email.ListMessageAttachments, ([messageId]) => ({
    method: "GET",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/attachments`,
    transform: (body) => listItems<EmailAttachmentRecord>(body).map(mapEmailAttachmentRecord),
  })],
  [IPCChannels.Email.GetMessage, ([messageId]) => ({
    method: "GET",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}`,
    query: { includeBody: true },
    transform: (body) => {
      const message = dataBody<EmailMessageRecord | null>(body)
      return message ? mapEmailMessageRecord(message) : null
    },
  })],
  [IPCChannels.Email.GetReplySuggestion, ([messageId]) => ({
    method: "GET",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/reply-suggestion`,
    transform: (body) => dataBody<{
      status: "none" | "pending" | "ready" | "failed" | "skipped"
      text: string | null
      error: string | null
      updatedAt: string | null
    }>(body),
  })],
  [IPCChannels.Email.EnsureReplySuggestion, ([payload]) => {
    const input = objectPayload(payload, "email reply suggestion payload")
    return {
      method: "POST",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/reply-suggestion/ensure`,
      body: pruneUndefined({
        force: optionalBoolean(input.force, "reply suggestion force flag"),
        trigger: input.trigger === undefined ? undefined : replySuggestionTrigger(input.trigger),
      }),
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.GenerateReplyDraft, ([payload]) => {
    const input = objectPayload(payload, "email reply draft payload")
    return {
      method: "POST",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/reply-draft`,
      body: pruneUndefined({
        promptId: input.promptId === undefined ? undefined : positiveId(input.promptId, "email ai prompt id"),
        customerId: input.customerId === undefined || input.customerId === null
          ? input.customerId ?? undefined
          : positiveId(input.customerId, "customer id"),
      }),
      transform: (body) => dataBody<{ success: boolean; text?: string; error?: string }>(body),
    }
  }],
  [IPCChannels.Email.GetMessageSecurity, ([messageId]) => ({
    method: "GET",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/security`,
    transform: (body) => ({
      success: true,
      ...mapEmailMessageSecurityRecord(dataBody<EmailMessageSecurityRecord>(body)),
    }),
  })],
  [IPCChannels.Email.RunMailSecurityCheck, ([messageId]) => ({
    method: "POST",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/security/check`,
    body: { applyStatus: true },
    transform: (body) => {
      const result = dataBody<{
        message?: EmailMessageRecord | null
        security?: EmailMessageSecurityRecord | null
        decision?: { score?: number | null; status?: string | null; source?: string | null } | null
        authChecked?: boolean
        rspamdChecked?: boolean
      }>(body)
      return {
        success: true,
        authChecked: result.authChecked === true,
        rspamdChecked: result.rspamdChecked === true,
        spamScore: result.decision?.score ?? result.security?.spamScore ?? null,
        spamStatus: result.decision?.status ?? result.message?.spamStatus ?? result.security?.spamStatus ?? null,
        spamDecisionSource: result.decision?.source ?? result.security?.spamDecisionSource ?? null,
      }
    },
  })],
  [IPCChannels.Email.GetMessageRawHeaders, ([messageId]) => ({
    method: "GET",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/raw-headers`,
    transform: (body) => ({
      success: true,
      ...dataBody<EmailMessageRawHeadersRecord>(body),
    }),
  })],
  [IPCChannels.Email.ExportMessageEml, ([messageId]) => ({
    method: "GET",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/raw-headers`,
    transform: (body) => {
      const result = dataBody<EmailMessageRawHeadersRecord>(body)
      return {
        success: true,
        rawEml: result.rawEml ?? "",
        emlSource: result.emlSource ?? "reconstructed",
      }
    },
  })],
  [IPCChannels.Email.GetReadReceiptState, ([payload]) => {
    const input = objectPayload(payload, "email read receipt payload")
    return {
      method: "GET",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/read-receipt-state`,
      transform: (body) => ({
        success: true,
        ...dataBody<EmailReadReceiptStateRecord>(body),
      }),
    }
  }],
  [IPCChannels.Email.RespondReadReceipt, ([payload]) => {
    const input = objectPayload(payload, "email read receipt response payload")
    return {
      method: "POST",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/read-receipt-response`,
      body: {
        action: readReceiptResponseAction(input.action),
      },
      transform: (body) => {
        const result = dataBody<EmailReadReceiptResponseRecord>(body)
        return {
          success: result.success === true,
          ...(typeof result.error === "string" && result.error.trim() ? { error: result.error } : {}),
        }
      },
    }
  }],
  [IPCChannels.Email.GetRemoteContentPolicy, ([payload]) => {
    const input = objectPayload(payload, "email remote content payload")
    return {
      method: "POST",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/remote-content-policy/consume`,
      transform: (body) => dataBody<Record<string, unknown>>(body),
    }
  }],
  [IPCChannels.Email.SetRemoteContentPolicy, ([payload]) => {
    const input = objectPayload(payload, "email remote content payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/remote-content-policy`,
      body: {
        policy: remoteContentPolicyValue(input.policy),
        ...(input.rememberSender === undefined ? {} : {
          rememberSender: optionalBoolean(input.rememberSender, "remote content remember sender flag"),
        }),
        ...(input.rememberDomain === undefined ? {} : {
          rememberDomain: optionalBoolean(input.rememberDomain, "remote content remember domain flag"),
        }),
      },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.ListConversationMessages, ([payload]) => {
    const input = objectPayload(payload, "email conversation message list payload")
    return {
      method: "GET",
      path: "/api/v1/email/messages/conversation",
      query: pruneQueryUndefined({
        accountId: accountScopeQueryValue(input.accountId),
        messageId: optionalPositiveQueryId(input.messageId, "email message id"),
        ticketCode: optionalTextQueryValue(input.ticketCode, "ticket code", 100),
        customerId: optionalPositiveQueryId(input.customerId, "customer id"),
        correspondentEmail: optionalTextQueryValue(input.correspondentEmail, "correspondent email", 320),
        limit: limitValue(input.limit),
      }),
      transform: (body) => listItems<EmailMessageRecord>(body).map(mapEmailMessageRecord),
    }
  }],
  [IPCChannels.Email.ListThreadMessages, ([payload]) => {
    const input = objectPayload(payload, "email thread message list payload")
    return {
      method: "GET",
      path: `/api/v1/email/threads/${pathTextSegment(input.threadId, "email thread id", 300)}/messages`,
      query: pruneQueryUndefined({
        limit: limitValue(input.limit),
        offset: offsetValue(input.offset),
      }),
      transform: (body) => listItems<EmailMessageRecord>(body).map(mapEmailMessageRecord),
    }
  }],
  [IPCChannels.Email.ListThreadAliasWarnings, () => ({
    method: "GET",
    path: "/api/v1/email/thread-alias-warnings",
    query: { limit: 50 },
    transform: (body) => listItems<Record<string, unknown>>(body),
  })],
  [IPCChannels.Email.ListThreadsByView, ([payload]) => {
    const input = objectPayload(payload, "email thread list payload")
    return {
      method: "GET",
      path: "/api/v1/email/threads",
      query: pruneQueryUndefined({
        accountId: accountScopeQueryValue(input.accountScope ?? input.accountId),
        view: messageViewValue(input.view),
        limit: limitValue(input.limit),
        offset: offsetValue(input.offset),
      }),
      transform: (body) => listItems<EmailThreadRecord>(body).map(mapEmailThreadRecord),
    }
  }],
  [IPCChannels.Email.MergeThreads, ([payload]) => {
    const input = objectPayload(payload, "email thread merge payload")
    return {
      method: "POST",
      path: "/api/v1/email/threads/merge",
      body: {
        aliasThreadId: stringPayloadField(input.aliasThreadId, "email alias thread id"),
        canonicalThreadId: stringPayloadField(input.canonicalThreadId, "email canonical thread id"),
        accountId: positiveId(input.accountId, "email account id"),
      },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.SplitMessageThread, ([payload]) => {
    const input = objectPayload(payload, "email thread split payload")
    return {
      method: "POST",
      path: "/api/v1/email/threads/split-message",
      body: {
        messageId: positiveId(input.messageId, "email message id"),
      },
      transform: (body) => {
        const result = dataBody<{ threadId?: string }>(body)
        return { success: true, threadId: result.threadId }
      },
    }
  }],
  [IPCChannels.Email.BulkSoftDeleteMessages, ([payload]) => {
    const input = objectPayload(payload, "email bulk soft-delete payload")
    return {
      method: "PATCH",
      path: "/api/v1/email/messages/bulk/soft-delete",
      body: pruneUndefined({
        messageIds: messageIdArray(input.messageIds),
        accountId: optionalPositiveQueryId(input.accountId, "email account id"),
      }),
      transform: (body) => ({
        success: true,
        count: dataBody<EmailMessageBulkMutationResult>(body).count ?? 0,
      }),
    }
  }],
  [IPCChannels.Email.BulkSetMessagesArchived, ([payload]) => {
    const input = objectPayload(payload, "email bulk archive payload")
    return {
      method: "PATCH",
      path: "/api/v1/email/messages/bulk/archive",
      body: pruneUndefined({
        messageIds: messageIdArray(input.messageIds),
        archived: requiredBoolean(input.archived, "email archived flag"),
        accountId: optionalPositiveQueryId(input.accountId, "email account id"),
      }),
      transform: (body) => ({
        success: true,
        count: dataBody<EmailMessageBulkMutationResult>(body).count ?? 0,
      }),
    }
  }],
  [IPCChannels.Email.BulkSetMessageDone, ([payload]) => {
    const input = objectPayload(payload, "email bulk done payload")
    return {
      method: "PATCH",
      path: "/api/v1/email/messages/bulk/done",
      body: pruneUndefined({
        messageIds: messageIdArray(input.messageIds),
        done: requiredBoolean(input.done, "email done flag"),
        accountId: optionalPositiveQueryId(input.accountId, "email account id"),
      }),
      transform: (body) => ({
        success: true,
        count: dataBody<EmailMessageBulkMutationResult>(body).count ?? 0,
      }),
    }
  }],
  [IPCChannels.Email.BulkSetMessageSpam, ([payload]) => {
    const input = objectPayload(payload, "email bulk spam payload")
    return {
      method: "PATCH",
      path: "/api/v1/email/messages/bulk/spam-status",
      body: pruneUndefined({
        messageIds: messageIdArray(input.messageIds),
        status: requiredBoolean(input.spam, "email spam flag") ? "spam" : "clean",
        accountId: optionalPositiveQueryId(input.accountId, "email account id"),
      }),
      transform: (body) => ({
        success: true,
        count: dataBody<EmailMessageBulkMutationResult>(body).count ?? 0,
      }),
    }
  }],
  [IPCChannels.Email.BulkSetMessageSpamStatus, ([payload]) => {
    const input = objectPayload(payload, "email bulk spam-status payload")
    return {
      method: "PATCH",
      path: "/api/v1/email/messages/bulk/spam-status",
      body: pruneUndefined({
        messageIds: messageIdArray(input.messageIds),
        status: spamStatusValue(input.status),
        accountId: optionalPositiveQueryId(input.accountId, "email account id"),
        train: optionalBoolean(input.train, "email message spam training flag"),
      }),
      transform: (body) => ({
        success: true,
        count: dataBody<EmailMessageBulkMutationResult>(body).count ?? 0,
      }),
    }
  }],
  [IPCChannels.Email.BulkDeleteComposeDrafts, ([payload]) => {
    const input = objectPayload(payload, "email bulk draft delete payload")
    return {
      method: "DELETE",
      path: "/api/v1/email/messages/bulk/local-drafts",
      body: {
        messageIds: messageIdArray(input.messageIds),
      },
      transform: (body) => ({
        success: true,
        count: dataBody<EmailMessageBulkMutationResult>(body).count ?? 0,
      }),
    }
  }],
  [IPCChannels.Email.CreateComposeDraft, ([payload]) => {
    const input = objectPayload(payload, "email compose draft payload")
    return {
      method: "POST",
      path: "/api/v1/email/compose-drafts",
      body: mapComposeDraftCreatePayload(input),
      transform: (body) => {
        const result = dataBody<{ success: boolean; id?: number }>(body)
        return { success: true, id: result.id }
      },
    }
  }],
  [IPCChannels.Email.UpdateComposeDraft, ([payload]) => {
    const input = objectPayload(payload, "email compose draft update payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/compose-draft`,
      body: mapComposeDraftUpdatePayload(input),
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.ValidateOutbound, ([payload]) => {
    const input = objectPayload(payload, "email outbound validation payload")
    return {
      method: "POST",
      path: "/api/v1/email/compose/validate-outbound",
      body: mapOutboundValidationPayload(input),
      transform: (body) => dataBody<{
        success: true
        allowed: boolean
        reason: string | null
      }>(body),
    }
  }],
  [IPCChannels.Email.SendCompose, ([payload]) => {
    const input = objectPayload(payload, "email compose send payload")
    return {
      method: "POST",
      path: "/api/v1/email/compose/send",
      body: mapComposeSendPayload(input),
      transform: (body) => dataBody<{
        success: boolean
        error?: string
        warning?: string
        recoveredSentAppend?: true
        workflowRunId?: number | null
      }>(body),
    }
  }],
  [IPCChannels.Email.ListConversationLocks, ([payload]) => {
    const input = objectPayload(payload, "email conversation lock list payload")
    const messageIds = positiveIdArray(input.messageIds, "email message ids", 500)
    return {
      method: "GET",
      path: "/api/v1/locks",
      query: { messageIds: messageIds.join(",") },
      transform: (body) => dataBody<{ locks: Record<string, unknown>[] }>(body),
    }
  }],
  [IPCChannels.Email.GetConversationLock, ([messageId]) => ({
    method: "GET",
    path: `/api/v1/locks/${positiveId(messageId, "email message id")}`,
    transform: (body) => dataBody<{ lock: Record<string, unknown> | null }>(body),
  })],
  [IPCChannels.Email.AcquireConversationLock, ([payload]) => {
    const input = objectPayload(payload, "email conversation lock acquire payload")
    return {
      method: "POST",
      path: `/api/v1/locks/${positiveId(input.messageId, "email message id")}`,
      body: {
        reason: optionalConversationLockReason(input.reason) ?? "reply",
      },
      transform: (body) => dataBody<{ lock: Record<string, unknown> }>(body),
    }
  }],
  [IPCChannels.Email.HeartbeatConversationLock, ([messageId]) => ({
    method: "PATCH",
    path: `/api/v1/locks/${positiveId(messageId, "email message id")}/heartbeat`,
    transform: (body) => dataBody<{ lock: Record<string, unknown> }>(body),
  })],
  [IPCChannels.Email.ReleaseConversationLock, ([messageId]) => ({
    method: "DELETE",
    path: `/api/v1/locks/${positiveId(messageId, "email message id")}`,
    transform: (body) => dataBody<{ released: boolean; lock: Record<string, unknown> }>(body),
  })],
  [IPCChannels.Email.TakeoverConversationLock, ([payload]) => {
    const input = objectPayload(payload, "email conversation lock takeover payload")
    return {
      method: "POST",
      path: `/api/v1/locks/${positiveId(input.messageId, "email message id")}/takeover`,
      body: {
        reason: optionalConversationLockReason(input.reason) ?? "reply",
      },
      transform: (body) => dataBody<{ lock: Record<string, unknown> }>(body),
    }
  }],
  [IPCChannels.Email.ScheduleDraftSend, ([payload]) => {
    const input = objectPayload(payload, "email scheduled-send payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/scheduled-send`,
      body: {
        sendAt: input.sendAt === null || input.sendAt === undefined
          ? null
          : stringPayloadField(input.sendAt, "scheduled send timestamp"),
      },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.GetScheduledSendDraftState, ([messageId]) => ({
    method: "GET",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/scheduled-send-state`,
    transform: (body) => dataBody<{
      success: true
      failureCount: number
      status: "ok" | "pending" | "failed"
      lastError: string | null
    }>(body),
  })],
  [IPCChannels.Email.GetComposeDraftRecoveryState, ([messageId]) => ({
    method: "GET",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/compose-draft-recovery-state`,
    transform: (body) => dataBody<{
      success: true
      smtpCommitted: boolean
      needsResendFinalize: boolean
    }>(body),
  })],
  [IPCChannels.Email.ClearScheduledSendDraftFailure, ([messageId]) => ({
    method: "DELETE",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/scheduled-send-failure`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.RetryScheduledSendDraft, ([messageId]) => ({
    method: "PATCH",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/scheduled-send/retry`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.SnoozeMessage, ([payload]) => {
    const input = objectPayload(payload, "email snooze payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/snooze`,
      body: {
        until: input.until === null || input.until === undefined
          ? null
          : optionalTextQueryValue(input.until, "snooze until", 100),
      },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.SoftDeleteMessage, ([messageId]) => ({
    method: "PATCH",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/soft-delete`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.RestoreMessage, ([messageId]) => ({
    method: "PATCH",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/restore`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.DeleteComposeDraft, ([messageId]) => ({
    method: "DELETE",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/local-draft`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.LinkCustomer, ([payload]) => {
    const input = objectPayload(payload, "email message customer link payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/customer-link`,
      body: {
        customerId: input.customerId === null || input.customerId === undefined
          ? null
          : positiveId(input.customerId, "customer id"),
      },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.AssignMessage, ([payload]) => {
    const input = objectPayload(payload, "email message assignment payload")
    const rawTeamMemberId = input.teamMemberId
    const teamMemberId = rawTeamMemberId === null || rawTeamMemberId === undefined
      ? null
      : String(rawTeamMemberId).trim()
    if (teamMemberId !== null && (!teamMemberId || teamMemberId.length > 200)) {
      throw new Error("Invalid email team member id")
    }
    return {
      method: "PATCH",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/assignment`,
      body: { teamMemberId },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.SetMessageArchived, ([payload]) => {
    const input = objectPayload(payload, "email archive payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/archive`,
      body: { archived: requiredBoolean(input.archived, "email archived flag") },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.PreviewRestoreInboxFromArchive, ([accountId]) => ({
    method: "GET",
    path: `/api/v1/email/accounts/${positiveId(accountId, "email account id")}/inbox-archive-recovery`,
    transform: (body) => {
      const result = dataBody<{
        success?: boolean
        accountId?: number
        count?: number
        accountEmail?: string
        accountLabel?: string
      }>(body)
      return {
        success: result.success !== false,
        accountId: positiveId(result.accountId, "email account id"),
        count: countValue(result.count),
        accountEmail: String(result.accountEmail ?? ""),
        accountLabel: String(result.accountLabel ?? ""),
      }
    },
  })],
  [IPCChannels.Email.RestoreInboxFromArchive, ([payload]) => {
    const input = objectPayload(payload, "email inbox archive recovery payload")
    return {
      method: "POST",
      path: `/api/v1/email/accounts/${positiveId(input.accountId, "email account id")}/inbox-archive-recovery`,
      body: {
        expectedCount: nonNegativeInteger(input.expectedCount, "expected message count"),
        confirmPhrase: stringPayloadField(input.confirmPhrase, "confirm phrase"),
      },
      transform: (body) => {
        const result = dataBody<{ success?: boolean; restored?: number }>(body)
        return {
          success: result.success !== false,
          restored: countValue(result.restored),
        }
      },
    }
  }],
  [IPCChannels.Email.SetMessageSeen, ([payload]) => {
    const input = objectPayload(payload, "email seen payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/seen`,
      body: pruneUndefined({
        seen: requiredBoolean(input.seen, "email seen flag"),
        syncToServer: optionalBoolean(input.syncToServer, "email seen server sync flag"),
      }),
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.SetMessageDone, ([payload]) => {
    const input = objectPayload(payload, "email done payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/done`,
      body: { done: requiredBoolean(input.done, "email done flag") },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.MoveMessageToView, ([payload]) => {
    const input = objectPayload(payload, "email move payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/move`,
      body: { view: messageViewValue(input.view) },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.ListMessagesByView, ([payload]) => {
    const input = objectPayload(payload, "email message list payload")
    return {
      method: "GET",
      path: "/api/v1/email/messages",
      query: pruneQueryUndefined({
        accountId: accountScopeQueryValue(input.accountId),
        view: messageViewValue(input.view),
        limit: limitValue(input.limit),
        offset: offsetValue(input.offset),
        categoryId: optionalPositiveQueryId(input.categoryId, "email category id"),
        sort: optionalMessageSortValue(input.sort),
        listFilter: optionalMessageListFilterValue(input.listFilter),
        doneFilter: optionalMessageDoneFilterValue(input.doneFilter),
      }),
      transform: (body) => listItems<EmailMessageRecord>(body).map(mapEmailMessageRecord),
    }
  }],
  [IPCChannels.Email.ListMessageIdsByView, ([payload]) => {
    const input = objectPayload(payload, "email message id list payload")
    return {
      method: "GET",
      path: "/api/v1/email/messages",
      query: pruneQueryUndefined({
        accountId: accountScopeQueryValue(input.accountId),
        view: messageViewValue(input.view),
        limit: bulkMessageIdLimitValue(input.limit),
        offset: offsetValue(input.offset),
        categoryId: optionalPositiveQueryId(input.categoryId, "email category id"),
        listFilter: optionalMessageListFilterValue(input.listFilter),
        doneFilter: optionalMessageDoneFilterValue(input.doneFilter),
      }),
      transform: (body) => listItems<EmailMessageRecord>(body).map((record) => record.id),
    }
  }],
  [IPCChannels.Email.SearchMessages, ([payload]) => {
    const input = objectPayload(payload, "email message search payload")
    return {
      method: "GET",
      path: "/api/v1/email/messages",
      query: pruneQueryUndefined({
        accountId: accountScopeQueryValue(input.accountId),
        search: messageSearchQueryValue(input.query),
        limit: limitValue(input.limit),
        offset: offsetValue(input.offset),
        view: optionalMessageViewValue(input.view),
        categoryId: optionalPositiveQueryId(input.categoryId, "email category id"),
        doneFilter: optionalMessageDoneFilterValue(input.doneFilter),
      }),
      transform: (body) => {
        const result = dataBody<ListResult<EmailMessageRecord> & { searchMode?: "fts" | "like" | "regex" }>(body)
        return {
          messages: (Array.isArray(result) ? result : result.items ?? []).map(mapEmailMessageRecord),
          searchMode: Array.isArray(result) ? "like" : result.searchMode ?? "like",
          hasMore: Array.isArray(result) ? false : result.nextCursor != null,
        }
      },
    }
  }],
  [IPCChannels.Email.SetMessageSpam, ([payload]) => {
    const input = objectPayload(payload, "email message spam payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/spam-status`,
      body: {
        status: requiredBoolean(input.spam, "email spam flag") ? "spam" : "clean",
      },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.SetMessageSpamStatus, ([payload]) => {
    const input = objectPayload(payload, "email message spam status payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/spam-status`,
      body: pruneUndefined({
        status: spamStatusValue(input.status),
        train: optionalBoolean(input.train, "email message spam training flag"),
        source: "manual",
      }),
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.GetGoogleOAuthApp, () => ({
    method: "GET",
    path: "/api/v1/email/oauth/google/app",
    transform: (body) => dataBody<EmailOAuthResultRecord>(body),
  })],
  [IPCChannels.Email.SetGoogleOAuthApp, ([payload]) => ({
    method: "PATCH",
    path: "/api/v1/email/oauth/google/app",
    body: mapEmailOAuthAppPayload(payload),
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.BuildGoogleOAuthUrl, ([redirectUri]) => ({
    method: "POST",
    path: "/api/v1/email/oauth/google/authorize-url",
    body: { redirectUri: stringPayloadField(redirectUri, "google oauth redirect uri") },
    transform: (body) => dataBody<EmailOAuthResultRecord>(body),
  })],
  [IPCChannels.Email.FinishGoogleOAuth, ([payload]) => ({
    method: "POST",
    path: "/api/v1/email/oauth/google/finish",
    body: mapEmailOAuthFinishPayload(payload),
    transform: (body) => dataBody<EmailOAuthResultRecord>(body),
  })],
  [IPCChannels.Email.GetMicrosoftOAuthApp, () => ({
    method: "GET",
    path: "/api/v1/email/oauth/microsoft/app",
    transform: (body) => dataBody<EmailOAuthResultRecord>(body),
  })],
  [IPCChannels.Email.SetMicrosoftOAuthApp, ([payload]) => ({
    method: "PATCH",
    path: "/api/v1/email/oauth/microsoft/app",
    body: mapEmailOAuthAppPayload(payload),
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.BuildMicrosoftOAuthUrl, ([redirectUri]) => ({
    method: "POST",
    path: "/api/v1/email/oauth/microsoft/authorize-url",
    body: { redirectUri: stringPayloadField(redirectUri, "microsoft oauth redirect uri") },
    transform: (body) => dataBody<EmailOAuthResultRecord>(body),
  })],
  [IPCChannels.Email.FinishMicrosoftOAuth, ([payload]) => ({
    method: "POST",
    path: "/api/v1/email/oauth/microsoft/finish",
    body: mapEmailOAuthFinishPayload(payload),
    transform: (body) => dataBody<EmailOAuthResultRecord>(body),
  })],
  [IPCChannels.Email.GetEmailMiscSettings, () => ({
    method: "GET",
    path: "/api/v1/email/settings/misc",
    transform: (body) => dataBody<{
      webhookSecret: string
      maxAttachmentMb: string
    }>(body),
  })],
  [IPCChannels.Email.SetEmailMiscSettings, ([payload]) => ({
    method: "PATCH",
    path: "/api/v1/email/settings/misc",
    body: mapEmailMiscSettingsPayload(payload),
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.FireWebhookWorkflow, ([payload]) => {
    const input = objectPayload(payload, "email webhook payload")
    return {
      method: "POST",
      path: "/api/v1/workflows/webhook/incoming",
      body: {
        secret: stringPayloadField(input.secret, "webhook secret"),
        body: input.body === undefined || input.body === null ? {} : objectPayload(input.body, "webhook body"),
      },
      transform: (body) => dataBody<{ success: boolean; fired: number; error?: string; deduplicated?: boolean }>(body),
    }
  }],
  [IPCChannels.Email.GetMailSecuritySettings, () => ({
    method: "GET",
    path: "/api/v1/email/settings/security",
    transform: (body) => dataBody<Record<string, unknown>>(body),
  })],
  [IPCChannels.Email.SetMailSecuritySettings, ([payload]) => ({
    method: "PATCH",
    path: "/api/v1/email/settings/security",
    body: mapMailSecuritySettingsPayload(payload),
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.TestRspamdConnection, ([payload]) => ({
    method: "POST",
    path: "/api/v1/email/settings/security/test-rspamd",
    body: mapRspamdConnectionTestPayload(payload),
    transform: (body) => dataBody<Record<string, unknown>>(body),
  })],
  [IPCChannels.Email.GetSnoozeSettings, () => ({
    method: "GET",
    path: "/api/v1/email/settings/snooze",
    transform: (body) => dataBody<Record<string, unknown>>(body),
  })],
  [IPCChannels.Email.SetSnoozeSettings, ([payload]) => ({
    method: "PATCH",
    path: "/api/v1/email/settings/snooze",
    body: mapSnoozeSettingsPayload(payload),
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.GetReplySuggestionSettings, ([payload]) => {
    const input = objectPayload(payload, "email reply suggestion settings query")
    return {
      method: "GET",
      path: "/api/v1/email/settings/reply-suggestion",
      query: pruneQueryUndefined({
        accountId: optionalPositiveQueryId(input.accountId, "email account id"),
      }),
      transform: (body) => dataBody<Record<string, unknown>>(body),
    }
  }],
  [IPCChannels.Email.SetReplySuggestionSettings, ([payload]) => ({
    method: "PATCH",
    path: "/api/v1/email/settings/reply-suggestion",
    body: mapReplySuggestionSettingsPayload(payload),
    transform: (body) => dataBody<Record<string, unknown>>(body),
  })],
  [IPCChannels.Email.ListUidValidityNotices, () => ({
    method: "GET",
    path: "/api/v1/email/notices/uid-validity",
    transform: (body) => listItems<Record<string, unknown>>(body),
  })],
  [IPCChannels.Email.DismissUidValidityNotice, ([payload]) => {
    const input = objectPayload(payload, "email uid validity notice payload")
    return {
      method: "DELETE",
      path: "/api/v1/email/notices/uid-validity",
      query: {
        noticeId: stringPayloadField(input.noticeId, "email uid validity notice id"),
      },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.ListImapAuthNotices, () => ({
    method: "GET",
    path: "/api/v1/email/notices/imap-auth",
    transform: (body) => listItems<Record<string, unknown>>(body),
  })],
  [IPCChannels.Email.DismissImapAuthNotice, ([payload]) => {
    const input = objectPayload(payload, "email imap auth notice payload")
    return {
      method: "DELETE",
      path: "/api/v1/email/notices/imap-auth",
      query: {
        accountId: positiveId(input.accountId, "email account id"),
      },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.ListAccountSignatures, () => ({
    method: "GET",
    path: "/api/v1/email/account-signatures",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: async (body, context) => {
      const accountsBody = await context.fetchJson({
        method: "GET",
        path: "/api/v1/email/accounts",
      })
      const accounts = listItems<EmailAccountRecord>(accountsBody).map(mapEmailAccountRecord)
      const signaturesByAccountId = new Map<number, EmailAccountSignatureRecord>()
      for (const signature of listItems<EmailAccountSignatureRecord>(body)) {
        const accountId = signature.accountSourceSqliteId ?? signature.accountId
        if (accountId !== undefined && accountId !== null) {
          signaturesByAccountId.set(Number(accountId), signature)
        }
      }
      return accounts.map((account) => {
        const signature = signaturesByAccountId.get(account.id)
        return {
          account_id: account.id,
          display_name: account.display_name,
          email_address: account.email_address,
          signature_html: signature?.signatureHtml ?? null,
        }
      })
    },
  })],
  [IPCChannels.Email.GetComposeSignature, ([payload]) => {
    const input = objectPayload(payload, "email compose signature payload")
    return {
      method: "GET",
      path: "/api/v1/email/account-signatures",
      query: {
        accountId: positiveId(input.accountId, "email account id"),
        limit: 1,
      },
      transform: (body) => {
        const signature = listItems<EmailAccountSignatureRecord>(body)[0]
        return { html: signature?.signatureHtml ?? null }
      },
    }
  }],
  [IPCChannels.Email.SaveAccountSignature, ([payload]) => {
    const input = objectPayload(payload, "email account signature payload")
    return {
      method: "POST",
      path: `/api/v1/email/account-signatures/by-account/${positiveId(input.accountId, "email account id")}/upsert`,
      body: {
        signatureHtml: accountSignatureHtmlValue(input.signatureHtml),
      },
      transform: () => ({ success: true }),
    }
  }],

  [IPCChannels.Email.GetWorkflowAutomationSettings, () => ({
    method: "GET",
    path: "/api/v1/workflow/settings/automation",
    transform: (body) => dataBody<{
      imapDeleteOptIn: boolean
      httpAllowlist: string
      senderWhitelist: string
      senderBlacklist: string
      spamScoreThreshold: string
    }>(body),
  })],
  [IPCChannels.Email.SetWorkflowAutomationSettings, ([payload]) => ({
    method: "PATCH",
    path: "/api/v1/workflow/settings/automation",
    body: mapWorkflowAutomationSettingsPayload(payload),
    transform: () => ({ success: true }),
  })],

  [IPCChannels.Email.CompileWorkflowGraph, ([payload]) => ({
    method: "POST",
    path: "/api/v1/workflows/compile-graph",
    body: objectPayload(payload, "workflow graph compile payload"),
    transform: (body) => dataBody<{
      success: boolean
      definitionJson?: string
      registryOnly?: boolean
      error?: string
    }>(body),
  })],
  [IPCChannels.Email.ExportWorkflowBundle, ([id]) => ({
    method: "GET",
    path: `/api/v1/workflows/by-source/${nonZeroPathId(id, "workflow id")}`,
    transform: (body) => {
      const workflow = dataBody<WorkflowRecord | null>(body)
      if (!workflow) return { success: false, error: "Workflow nicht gefunden" }
      return {
        success: true,
        bundle: exportWorkflowBundle(workflowExportSource(workflow)),
      }
    },
  })],
  [IPCChannels.Email.ImportWorkflowBundle, ([payload]) => ({
    method: "POST",
    path: "/api/v1/workflows",
    body: workflowImportMutationBody(payload),
    transform: (body) => {
      const workflow = dataBody<WorkflowRecord>(body)
      return { success: true, id: workflow.sourceSqliteId ?? workflow.id }
    },
  })],
  [IPCChannels.Email.ListWorkflowTemplates, () => ({
    method: "GET",
    path: "/api/v1/workflow/templates",
    transform: (body) => dataBody<WorkflowTemplateRecord[]>(body),
  })],
  [IPCChannels.Email.ListWorkflowNodeCatalog, () => ({
    method: "GET",
    path: "/api/v1/workflow/node-catalog",
    transform: (body) => dataBody<WorkflowNodeCatalogRecord[]>(body),
  })],
  [IPCChannels.Email.ListWorkflowPlugins, () => ({
    method: "GET",
    path: "/api/v1/workflow/plugins",
    transform: (body) => dataBody<Record<string, unknown>[]>(body),
  })],
  [IPCChannels.Email.ListWorkflows, () => ({
    method: "GET",
    path: "/api/v1/workflows",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<WorkflowRecord>(body).map(mapWorkflowRecord),
  })],
  [IPCChannels.Email.GetWorkflow, ([id]) => ({
    method: "GET",
    path: `/api/v1/workflows/by-source/${nonZeroPathId(id, "workflow id")}`,
    transform: (body) => {
      const workflow = dataBody<WorkflowRecord | null>(body)
      return workflow ? mapWorkflowRecord(workflow) : null
    },
  })],
  [IPCChannels.Email.CreateWorkflow, ([payload]) => ({
    method: "POST",
    path: "/api/v1/workflows",
    body: mapWorkflowMutation(payload, { requireDefinition: true }),
    transform: (body) => {
      const workflow = dataBody<WorkflowRecord>(body)
      return { success: true, id: workflow.sourceSqliteId ?? workflow.id }
    },
  })],
  [IPCChannels.Email.UpdateWorkflow, ([payload]) => {
    const input = objectPayload(payload, "workflow update payload")
    return {
      method: "PATCH",
      path: `/api/v1/workflows/by-source/${nonZeroPathId(input.id, "workflow id")}`,
      body: mapWorkflowMutation(input, { requireDefinition: false }),
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.DeleteWorkflow, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/workflows/by-source/${nonZeroPathId(id, "workflow id")}`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.BackfillInboundWorkflows, ([payload]) => {
    const input = payload === undefined || payload === null
      ? {}
      : objectPayload(payload, "workflow backfill payload")
    return {
      method: "POST",
      path: "/api/v1/workflows/inbound/backfill",
      body: pruneUndefined({
        limit: input.limit === undefined || input.limit === null
          ? undefined
          : positiveId(input.limit, "workflow backfill limit"),
        clearApplied: input.clearApplied,
      }),
      transform: (body) => {
        const result = dataBody<{
          success?: boolean
          messages?: number
          workflows?: number
          queued?: number
          clearedApplied?: number
        }>(body)
        return {
          success: result.success !== false,
          processed: countValue(result.messages),
          workflows: countValue(result.workflows),
          queued: countValue(result.queued),
          clearedApplied: countValue(result.clearedApplied),
        }
      },
    }
  }],
  [IPCChannels.Email.ExecuteWorkflowNow, ([payload]) => {
    const input = objectPayload(payload, "workflow execute payload")
    return {
      method: "POST",
      path: `/api/v1/workflows/by-source/${nonZeroPathId(input.workflowId, "workflow id")}/execute`,
      body: pruneUndefined({
        messageId: input.messageId === null || input.messageId === undefined
          ? undefined
          : positiveId(input.messageId, "email message id"),
        dryRun: input.dryRun === true,
      }),
      transform: (body) => dataBody<Record<string, unknown>>(body),
    }
  }],
  [IPCChannels.Email.TestWorkflowOnMessage, ([payload]) => {
    const input = objectPayload(payload, "workflow test payload")
    return {
      method: "POST",
      path: `/api/v1/workflows/by-source/${nonZeroPathId(input.workflowId, "workflow id")}/execute`,
      body: {
        messageId: positiveId(input.messageId, "email message id"),
        dryRun: input.dryRun !== false,
      },
      transform: (body) => dataBody<Record<string, unknown>>(body),
    }
  }],
  [IPCChannels.Email.ListWorkflowVersions, ([workflowId]) => ({
    method: "GET",
    path: `/api/v1/workflows/by-source/${nonZeroPathId(workflowId, "workflow id")}/versions`,
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<WorkflowVersionRecord>(body).map(mapWorkflowVersionRecord),
  })],
  [IPCChannels.Email.SaveWorkflowVersion, ([payload]) => {
    const input = objectPayload(payload, "workflow version snapshot payload")
    return {
      method: "POST",
      path: `/api/v1/workflows/by-source/${nonZeroPathId(input.workflowId, "workflow id")}/versions/snapshot`,
      body: pruneUndefined({
        label: input.label,
      }),
      transform: (body) => {
        const version = dataBody<WorkflowVersionRecord>(body)
        return { success: true, id: version.sourceSqliteId ?? version.id }
      },
    }
  }],
  [IPCChannels.Email.RestoreWorkflowVersion, ([payload]) => {
    const input = objectPayload(payload, "workflow version restore payload")
    return {
      method: "POST",
      path: `/api/v1/workflow-versions/by-source/${nonZeroPathId(input.versionId, "workflow version id")}/restore`,
      body: pruneUndefined({
        workflowId: input.workflowId,
      }),
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.ListWorkflowRuns, ([workflowId]) => ({
    method: "GET",
    path: `/api/v1/workflows/by-source/${nonZeroPathId(workflowId, "workflow id")}/runs`,
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<WorkflowRunRecord>(body).map(mapWorkflowRunRecord),
  })],
  [IPCChannels.Email.GetLatestWorkflowRunForMessage, ([payload]) => {
    const input = objectPayload(payload, "latest workflow run payload")
    const messageId = positiveId(input.messageId, "email message id")
    return {
      method: "GET",
      path: `/api/v1/email/messages/${messageId}/workflow-runs`,
      query: { limit: DEFAULT_LIST_LIMIT },
      transform: async (body, context) => {
        const latest = await collectLatestWorkflowRunFromFirstPage(body, context, messageId)
        return latest ? mapWorkflowRunRecord(latest) : null
      },
    }
  }],
  [IPCChannels.Email.ListWorkflowRunSteps, ([runId]) => ({
    method: "GET",
    path: `/api/v1/workflow-runs/by-source/${nonZeroPathId(runId, "workflow run id")}/steps`,
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<WorkflowRunStepRecord>(body).map(mapWorkflowRunStepRecord),
  })],
  [IPCChannels.Email.ListKnowledgeBases, () => ({
    method: "GET",
    path: "/api/v1/workflow-knowledge-bases",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<WorkflowKnowledgeBaseRecord>(body).map(mapWorkflowKnowledgeBaseRecord),
  })],
  [IPCChannels.Email.CreateKnowledgeBase, ([payload]) => {
    const input = objectPayload(payload, "workflow knowledge base payload")
    return {
      method: "POST",
      path: "/api/v1/workflow-knowledge-bases",
      body: mapWorkflowKnowledgeBaseMutation(input),
      transform: (body) => {
        const knowledgeBase = dataBody<WorkflowKnowledgeBaseRecord>(body)
        return { success: true, id: knowledgeBase.id }
      },
    }
  }],
  [IPCChannels.Email.DeleteKnowledgeBase, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/workflow-knowledge-bases/${positiveId(id, "workflow knowledge base id")}`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.AddKnowledgeChunk, ([payload]) => {
    const input = objectPayload(payload, "workflow knowledge chunk payload")
    return {
      method: "POST",
      path: "/api/v1/workflow-knowledge-chunks",
      body: {
        knowledgeBaseId: positiveId(input.knowledgeBaseId, "workflow knowledge base id"),
        title: input.title === undefined || input.title === null ? "Eintrag" : String(input.title),
        content: knowledgeMarkdownContent(input.content),
      },
      transform: (body) => {
        const chunk = dataBody<WorkflowKnowledgeChunkRecord>(body)
        return { success: true, id: chunk.id }
      },
    }
  }],
  [IPCChannels.Email.GetKnowledgeBaseDocument, ([knowledgeBaseId]) => ({
    method: "GET",
    path: `/api/v1/workflow-knowledge-bases/${positiveId(knowledgeBaseId, "workflow knowledge base id")}`,
    transform: async (body, context) => {
      const knowledgeBase = dataBody<WorkflowKnowledgeBaseRecord>(body)
      const chunks = await fetchWorkflowKnowledgeChunks(context, knowledgeBase.id, true)
      return {
        success: true,
        content: mergeKnowledgeChunksToMarkdown(knowledgeBase, chunks),
        fileName: knowledgeDocumentFileName(knowledgeBase),
      }
    },
  })],
  [IPCChannels.Email.SaveKnowledgeBaseDocument, ([payload]) => {
    const input = objectPayload(payload, "workflow knowledge base document payload")
    const knowledgeBaseId = positiveId(input.knowledgeBaseId, "workflow knowledge base id")
    const content = normalizeKnowledgeMarkdownContent(knowledgeMarkdownContent(input.content))
    return {
      method: "GET",
      path: "/api/v1/workflow-knowledge-chunks",
      query: { knowledgeBaseId, includeContent: true, limit: DEFAULT_LIST_LIMIT },
      transform: async (body, context) => {
        const chunks = await collectWorkflowKnowledgeChunksFromFirstPage(
          body,
          context,
          knowledgeBaseId,
          true,
        )
        const [documentChunk, ...obsoleteChunks] = chunks
        if (documentChunk) {
          await context.fetchJson({
            method: "PATCH",
            path: `/api/v1/workflow-knowledge-chunks/${positiveId(documentChunk.id, "workflow knowledge chunk id")}`,
            body: {
              knowledgeBaseId,
              title: "Dokument",
              content,
              sourcePath: null,
            },
          })
        } else {
          await context.fetchJson({
            method: "POST",
            path: "/api/v1/workflow-knowledge-chunks",
            body: {
              knowledgeBaseId,
              title: "Dokument",
              content,
              sourcePath: null,
            },
          })
        }
        for (const chunk of obsoleteChunks) {
          await context.fetchJson({
            method: "DELETE",
            path: `/api/v1/workflow-knowledge-chunks/${positiveId(chunk.id, "workflow knowledge chunk id")}`,
          })
        }
        return { success: true }
      },
    }
  }],

  [IPCChannels.Pgp.ListIdentities, () => ({
    method: "GET",
    path: "/api/v1/pgp/identities",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<PgpIdentityRecord>(body).map(mapPgpIdentityRecord),
  })],
  [IPCChannels.Pgp.GenerateIdentity, ([payload]) => {
    const input = objectPayload(payload, "pgp identity generation payload")
    return {
      method: "POST",
      path: "/api/v1/pgp/identities/generate",
      body: {
        email: stringPayloadField(input.email, "pgp identity email"),
        passphrase: secretPayloadField(input.passphrase, "pgp identity passphrase", 10_000),
      },
      transform: (body) => dataBody<PgpFingerprintResult>(body),
    }
  }],
  [IPCChannels.Pgp.DeleteIdentity, ([payload]) => {
    const input = objectPayload(payload, "pgp identity delete payload")
    return {
      method: "DELETE",
      path: `/api/v1/pgp/identities/by-source/${nonZeroPathId(input.id, "pgp identity id")}`,
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Pgp.RotateIdentityPassphrase, ([payload]) => {
    const input = objectPayload(payload, "pgp identity passphrase rotation payload")
    return {
      method: "POST",
      path: `/api/v1/pgp/identities/by-source/${nonZeroPathId(input.id, "pgp identity id")}/private-key/passphrase`,
      body: {
        currentPassphrase: secretPayloadField(input.currentPassphrase, "current pgp passphrase", 10_000),
        nextPassphrase: secretPayloadField(input.nextPassphrase, "next pgp passphrase", 10_000),
      },
      transform: (body) => mapPgpIdentityRecord(dataBody<PgpIdentityRecord>(body)),
    }
  }],
  [IPCChannels.Pgp.ListPeerKeys, () => ({
    method: "GET",
    path: "/api/v1/pgp/peer-keys",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<PgpPeerKeyRecord>(body).map(mapPgpPeerKeyRecord),
  })],
  [IPCChannels.Pgp.ImportPeerKey, ([payload]) => {
    const input = objectPayload(payload, "pgp peer key import payload")
    return {
      method: "POST",
      path: "/api/v1/pgp/peer-keys/import",
      body: {
        armored: stringPayloadField(input.armored, "pgp public key armor"),
      },
      transform: (body) => dataBody<PgpFingerprintResult>(body),
    }
  }],
  [IPCChannels.Pgp.DeletePeerKey, ([payload]) => {
    const input = objectPayload(payload, "pgp peer key delete payload")
    return {
      method: "DELETE",
      path: `/api/v1/pgp/peer-keys/by-source/${nonZeroPathId(input.id, "pgp peer key id")}`,
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Pgp.CheckRecipientKeys, ([payload]) => {
    const input = objectPayload(payload, "pgp recipient key check payload")
    const emails = Array.isArray(input.emails) ? input.emails.map((email) => String(email)) : []
    return {
      method: "GET",
      path: "/api/v1/pgp/recipient-key-status",
      query: { emails: JSON.stringify(emails) },
      transform: (body) => dataBody<PgpRecipientKeyStatusRecord[]>(body).map(mapPgpRecipientKeyStatusRecord),
    }
  }],
  [IPCChannels.Pgp.EncryptMessage, ([payload]) => {
    const input = objectPayload(payload, "pgp message encrypt payload")
    return {
      method: "POST",
      path: "/api/v1/pgp/messages/encrypt",
      body: pruneUndefined({
        plaintext: literalTextPayloadField(input.plaintext, "pgp plaintext", 2_000_000),
        recipientEmails: stringArrayPayloadField(input.recipientEmails, "pgp recipient email", 200, 254),
        attachments: pgpMessageAttachmentPayloads(input.attachments),
      }),
      transform: (body) => {
        const result = dataBody<{ armored?: string | null; attachments?: unknown }>(body)
        return pruneUndefined({
          armored: String(result.armored ?? ""),
          attachments: Array.isArray(result.attachments) ? result.attachments : undefined,
        })
      },
    }
  }],
  [IPCChannels.Pgp.SignMessage, ([payload]) => {
    const input = objectPayload(payload, "pgp message sign payload")
    return {
      method: "POST",
      path: "/api/v1/pgp/messages/sign",
      body: pruneUndefined({
        plaintext: literalTextPayloadField(input.plaintext, "pgp plaintext", 2_000_000),
        passphrase: secretPayloadField(input.passphrase, "pgp passphrase", 10_000),
        attachments: pgpMessageAttachmentPayloads(input.attachments),
      }),
      transform: (body) => {
        const result = dataBody<{ armored?: string | null; attachments?: unknown }>(body)
        return pruneUndefined({
          armored: String(result.armored ?? ""),
          attachments: Array.isArray(result.attachments) ? result.attachments : undefined,
        })
      },
    }
  }],
  [IPCChannels.Pgp.DecryptMessage, ([payload]) => {
    const input = objectPayload(payload, "pgp message decrypt payload")
    return {
      method: "POST",
      path: `/api/v1/pgp/messages/${positiveId(input.messageId, "pgp message id")}/decrypt`,
      body: {
        passphrase: secretPayloadField(input.passphrase, "pgp passphrase", 10_000),
      },
      transform: (body) => {
        const result = dataBody<PgpDecryptMessageResult>(body)
        return {
          text: String(result.text ?? ""),
          status: String(result.status ?? "decrypted"),
        }
      },
    }
  }],
  [IPCChannels.Pgp.DetectInbound, ([payload]) => {
    const input = objectPayload(payload, "pgp inbound detect payload")
    return {
      method: "POST",
      path: `/api/v1/pgp/messages/${positiveId(input.messageId, "pgp message id")}/detect`,
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Pgp.VerifyMessage, ([payload]) => {
    const input = objectPayload(payload, "pgp message verify payload")
    return {
      method: "POST",
      path: `/api/v1/pgp/messages/${positiveId(input.messageId, "pgp message id")}/verify`,
      transform: (body) => {
        const result = dataBody<{ valid?: boolean; status?: string; fingerprint?: string }>(body)
        return {
          valid: Boolean(result.valid),
          status: String(result.status ?? ""),
          ...(typeof result.fingerprint === "string" ? { fingerprint: result.fingerprint } : {}),
        }
      },
    }
  }],

  [IPCChannels.Email.ListMessageTags, ([messageId]) => ({
    method: "GET",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/tags`,
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<EmailMessageTagRecord>(body)
      .map((record) => record.tag)
      .filter((tag): tag is string => typeof tag === "string" && tag.length > 0),
  })],
  [IPCChannels.Email.AddMessageTag, ([payload]) => {
    const input = objectPayload(payload, "email message tag payload")
    return {
      method: "POST",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/tags`,
      body: { tag: messageTagValue(input.tag) },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.RemoveMessageTag, ([payload]) => {
    const input = objectPayload(payload, "email message tag delete payload")
    return {
      method: "DELETE",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/tags`,
      query: { tag: messageTagValue(input.tag) },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.GetMessageCategory, ([messageId]) => ({
    method: "GET",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/categories`,
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => ({
      categoryId: firstMessageCategoryId(listItems<EmailMessageCategoryRecord>(body)),
    }),
  })],
  [IPCChannels.Email.SetMessageCategory, ([payload]) => {
    const input = objectPayload(payload, "email message category payload")
    const messageId = positiveId(input.messageId, "email message id")
    const categoryId = input.categoryId === null
      ? null
      : positiveId(input.categoryId, "email category id")
    return {
      method: "GET",
      path: `/api/v1/email/messages/${messageId}/categories`,
      query: { limit: DEFAULT_LIST_LIMIT },
      transform: async (body, context) => {
        const existing = listItems<EmailMessageCategoryRecord>(body)
        const keepExisting = categoryId !== null
          && existing.some((record) => record.categoryId === categoryId)
        for (const record of existing) {
          if (categoryId !== null && record.categoryId === categoryId) continue
          await context.fetchJson({
            method: "DELETE",
            path: `/api/v1/email/message-categories/${positiveId(record.id, "email message category id")}`,
          })
        }
        if (categoryId !== null && !keepExisting) {
          await context.fetchJson({
            method: "POST",
            path: `/api/v1/email/messages/${messageId}/categories`,
            body: { categoryId },
          })
        }
        return { success: true }
      },
    }
  }],
  [IPCChannels.Email.ListInternalNotes, ([messageId]) => ({
    method: "GET",
    path: `/api/v1/email/messages/${positiveId(messageId, "email message id")}/internal-notes`,
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<EmailInternalNoteRecord>(body).map(mapEmailInternalNoteRecord),
  })],
  [IPCChannels.Email.AddInternalNote, ([payload]) => {
    const input = objectPayload(payload, "email internal note payload")
    return {
      method: "POST",
      path: `/api/v1/email/messages/${positiveId(input.messageId, "email message id")}/internal-notes`,
      body: { body: internalNoteBodyValue(input.body) },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.UpdateInternalNote, ([payload]) => {
    const input = objectPayload(payload, "email internal note update payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/internal-notes/${positiveId(input.noteId ?? input.id, "email internal note id")}`,
      body: { body: internalNoteBodyValue(input.body) },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.DeleteInternalNote, ([noteId]) => ({
    method: "DELETE",
    path: `/api/v1/email/internal-notes/${positiveId(noteId, "email internal note id")}`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.ListCannedResponses, () => ({
    method: "GET",
    path: "/api/v1/email/canned-responses",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<EmailCannedResponseRecord>(body).map(mapEmailCannedResponseRecord),
  })],
  [IPCChannels.Email.SaveCannedResponse, ([payload]) => {
    const input = objectPayload(payload, "email canned response payload")
    const body = mapEmailCannedResponseMutation(input)
    if (input.id !== undefined && input.id !== null) {
      return {
        method: "PATCH",
        path: `/api/v1/email/canned-responses/${positiveId(input.id, "email canned response id")}`,
        body,
        transform: (responseBody) => ({
          success: true,
          id: dataBody<EmailCannedResponseRecord>(responseBody).id,
        }),
      }
    }
    return {
      method: "POST",
      path: "/api/v1/email/canned-responses",
      body,
      transform: (responseBody) => ({
        success: true,
        id: dataBody<EmailCannedResponseRecord>(responseBody).id,
      }),
    }
  }],
  [IPCChannels.Email.DeleteCannedResponse, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/email/canned-responses/${positiveId(id, "email canned response id")}`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.GetAiSettings, () => ({
    method: "GET",
    path: "/api/v1/ai/profiles",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => {
      const profiles = listItems<AiProfileRecord>(body).map(mapAiProfileRecord)
      const defaultProfile = profiles.find((profile) => profile.isDefault) ?? profiles[0]
      const fallback = AI_PROVIDER_PRESETS.openai
      return {
        success: true,
        baseUrl: defaultProfile?.baseUrl || fallback.baseUrl,
        model: defaultProfile?.model || fallback.defaultModel,
        embeddingModel: defaultProfile?.embeddingModel ?? fallback.defaultEmbeddingModel,
        profiles,
        providerPresets: AI_PROVIDER_PRESETS,
      }
    },
  })],
  [IPCChannels.Email.SetAiSettings, ([payload]) => {
    const input = objectPayload(payload, "email ai settings payload")
    const patch = mapLegacyAiSettingsPatch(input)
    return {
      method: "GET",
      path: "/api/v1/ai/profiles",
      query: { limit: DEFAULT_LIST_LIMIT },
      transform: async (body, context) => {
        if (Object.keys(patch).length === 0) return { success: true }
        const profile = selectDefaultAiProfileRecord(listItems<AiProfileRecord>(body))
        if (profile) {
          await context.fetchJson({
            method: "PATCH",
            path: `/api/v1/ai/profiles/${positiveId(profile.id, "email ai profile id")}`,
            body: patch,
          })
        } else {
          await context.fetchJson({
            method: "POST",
            path: "/api/v1/ai/profiles",
            body: legacyDefaultAiProfileBody(patch),
          })
        }
        return { success: true }
      },
    }
  }],
  [IPCChannels.Email.SetAiApiKey, ([apiKey]) => ({
    method: "GET",
    path: "/api/v1/ai/profiles",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: async (body, context) => {
      const profile = selectDefaultAiProfileRecord(listItems<AiProfileRecord>(body))
      const key = aiProfileApiKeyValue(apiKey)
      if (profile) {
        await context.fetchJson({
          method: "PATCH",
          path: `/api/v1/ai/profiles/${positiveId(profile.id, "email ai profile id")}`,
          body: { apiKey: key },
        })
      } else {
        await context.fetchJson({
          method: "POST",
          path: "/api/v1/ai/profiles",
          body: legacyDefaultAiProfileBody({ apiKey: key }),
        })
      }
      return { success: true }
    },
  })],
  [IPCChannels.Email.ClearAiApiKey, () => ({
    method: "GET",
    path: "/api/v1/ai/profiles",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: async (body, context) => {
      const profile = selectDefaultAiProfileRecord(listItems<AiProfileRecord>(body))
      if (profile) {
        await context.fetchJson({
          method: "PATCH",
          path: `/api/v1/ai/profiles/${positiveId(profile.id, "email ai profile id")}`,
          body: { apiKey: null },
        })
      }
      return { success: true }
    },
  })],
  [IPCChannels.Email.ListAiProfiles, () => ({
    method: "GET",
    path: "/api/v1/ai/profiles",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<AiProfileRecord>(body).map(mapAiProfileRecord),
  })],
  [IPCChannels.Email.SaveAiProfile, ([payload]) => {
    const input = objectPayload(payload, "email ai profile payload")
    const body = mapAiProfileMutation(input)
    if (input.id !== undefined && input.id !== null) {
      return {
        method: "PATCH",
        path: `/api/v1/ai/profiles/${positiveId(input.id, "email ai profile id")}`,
        body,
        transform: (responseBody) => ({
          success: true,
          id: dataBody<AiProfileRecord>(responseBody).id,
        }),
      }
    }
    return {
      method: "POST",
      path: "/api/v1/ai/profiles",
      body,
      transform: (responseBody) => ({
        success: true,
        id: dataBody<AiProfileRecord>(responseBody).id,
      }),
    }
  }],
  [IPCChannels.Email.DeleteAiProfile, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/ai/profiles/${positiveId(id, "email ai profile id")}`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.SetAiProfileApiKey, ([payload]) => {
    const input = objectPayload(payload, "email ai profile api key payload")
    return {
      method: "PATCH",
      path: `/api/v1/ai/profiles/${positiveId(input.profileId, "email ai profile id")}`,
      body: { apiKey: aiProfileApiKeyValue(input.apiKey) },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.ClearAiProfileApiKey, ([id]) => ({
    method: "PATCH",
    path: `/api/v1/ai/profiles/${positiveId(id, "email ai profile id")}`,
    body: { apiKey: null },
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.ListAiPrompts, () => ({
    method: "GET",
    path: "/api/v1/ai/prompts",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<AiPromptRecord>(body).map(mapAiPromptRecord),
  })],
  [IPCChannels.Email.SaveAiPrompt, ([payload]) => {
    const input = objectPayload(payload, "email ai prompt payload")
    if (input.id !== undefined && input.id !== null) {
      return {
        method: "PATCH",
        path: `/api/v1/ai/prompts/${positiveId(input.id, "email ai prompt id")}`,
        body: mapAiPromptMutation(input),
        transform: (responseBody) => ({
          success: true,
          id: dataBody<AiPromptRecord>(responseBody).id,
        }),
      }
    }
    return {
      method: "POST",
      path: "/api/v1/ai/prompts",
      body: mapAiPromptMutation(input, { defaultTarget: "full_body" }),
      transform: (responseBody) => ({
        success: true,
        id: dataBody<AiPromptRecord>(responseBody).id,
      }),
    }
  }],
  [IPCChannels.Email.DeleteAiPrompt, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/ai/prompts/${positiveId(id, "email ai prompt id")}`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.ReorderAiPrompt, ([payload]) => {
    const input = objectPayload(payload, "email ai prompt reorder payload")
    const id = positiveId(input.id, "email ai prompt id")
    const direction = input.direction === "up" || input.direction === "down" ? input.direction : null
    if (!direction) throw new Error("Invalid email ai prompt reorder direction")
    return {
      method: "GET",
      path: "/api/v1/ai/prompts",
      query: { limit: DEFAULT_LIST_LIMIT },
      transform: async (body, context) => {
        const prompts = listItems<AiPromptRecord>(body)
        const idx = prompts.findIndex((prompt) => prompt.id === id)
        const swapIdx = direction === "up" ? idx - 1 : idx + 1
        if (idx < 0 || swapIdx < 0 || swapIdx >= prompts.length) {
          return { success: false, error: "Verschieben nicht möglich." }
        }
        const current = prompts[idx]!
        const other = prompts[swapIdx]!
        await context.fetchJson({
          method: "POST",
          path: "/api/v1/ai/prompts/reorder",
          body: {
            updates: [
              { id: positiveId(current.id, "email ai prompt id"), sortOrder: Number(other.sortOrder ?? 0) },
              { id: positiveId(other.id, "email ai prompt id"), sortOrder: Number(current.sortOrder ?? 0) },
            ],
          },
        })
        return { success: true }
      },
    }
  }],
  [IPCChannels.Email.AiTransformText, ([payload]) => {
    const input = objectPayload(payload, "email ai transform text payload")
    return {
      method: "POST",
      path: "/api/v1/ai/transform-text",
      body: pruneUndefined({
        promptId: positiveId(input.promptId, "email ai prompt id"),
        text: stringPayloadField(input.text, "email ai transform text"),
        customerId: input.customerId === undefined || input.customerId === null
          ? undefined
          : positiveId(input.customerId, "customer id"),
      }),
      transform: (body) => dataBody<{ success: boolean; text?: string; error?: string }>(body),
    }
  }],
  [IPCChannels.Email.ListSpamListEntries, ([accountId]) => ({
    method: "GET",
    path: "/api/v1/spam/list-entries",
    query: {
      limit: DEFAULT_LIST_LIMIT,
      accountId: accountId === "all" || accountId === undefined || accountId === null
        ? undefined
        : positiveId(accountId, "email spam list account id"),
    },
    transform: (body) => listItems<SpamListEntryRecord>(body).map(mapSpamListEntryRecord),
  })],
  [IPCChannels.Email.SaveSpamListEntry, ([payload]) => {
    const input = objectPayload(payload, "email spam list entry payload")
    const body = mapSpamListEntryMutation(input)
    if (input.id !== undefined && input.id !== null) {
      return {
        method: "PATCH",
        path: `/api/v1/spam/list-entries/${positiveId(input.id, "email spam list entry id")}`,
        body,
        transform: (responseBody) => ({
          success: true,
          entry: mapSpamListEntryRecord(dataBody<SpamListEntryRecord>(responseBody)),
        }),
      }
    }
    return {
      method: "POST",
      path: "/api/v1/spam/list-entries/upsert",
      body,
      transform: (responseBody) => ({
        success: true,
        entry: mapSpamListEntryRecord(dataBody<SpamListEntryRecord>(responseBody)),
      }),
    }
  }],
  [IPCChannels.Email.DeleteSpamListEntry, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/spam/list-entries/${positiveId(id, "email spam list entry id")}`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.ListCategories, () => ({
    method: "GET",
    path: "/api/v1/email/categories",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<EmailCategoryRecord>(body).map(mapEmailCategoryRecord),
  })],
  [IPCChannels.Email.CategoryCounts, ([accountScope]) => ({
    method: "GET",
    path: "/api/v1/email/category-counts",
    query: pruneQueryUndefined({
      accountId: accountScopeQueryValue(accountScope),
    }),
    transform: (body) => dataBody<EmailCategoryCountRecord[]>(body).map(mapEmailCategoryCountRecord),
  })],
  [IPCChannels.Email.CreateCategory, ([payload]) => ({
    method: "POST",
    path: "/api/v1/email/categories",
    body: mapEmailCategoryMutation(objectPayload(payload, "email category payload")),
    transform: (responseBody) => ({
      success: true,
      id: dataBody<EmailCategoryRecord>(responseBody).id,
    }),
  })],
  [IPCChannels.Email.UpdateCategory, ([payload]) => {
    const input = objectPayload(payload, "email category update payload")
    return {
      method: "PATCH",
      path: `/api/v1/email/categories/${positiveId(input.categoryId ?? input.id, "email category id")}`,
      body: mapEmailCategoryMutation(input),
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.DeleteCategory, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/email/categories/${positiveId(id, "email category id")}`,
    transform: () => ({ success: true }),
  })],
  [IPCChannels.Email.ReorderCategories, ([payload]) => {
    const { updates } = objectPayload(payload, "email category reorder payload")
    const normalizedUpdates = emailCategoryReorderUpdates(updates)
    return {
      method: "POST",
      path: "/api/v1/email/categories/reorder",
      body: { updates: normalizedUpdates.map(mapEmailCategoryReorderMutation) },
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.ListTeamMembers, () => ({
    method: "GET",
    path: "/api/v1/email/team-members",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<EmailTeamMemberRecord>(body).map(mapEmailTeamMemberRecord),
  })],
  [IPCChannels.Email.SaveTeamMember, ([payload]) => {
    const input = objectPayload(payload, "email team member payload")
    return {
      method: "POST",
      path: `/api/v1/email/team-members/${pathTextSegment(input.id, "email team member id", 100)}/upsert`,
      body: mapEmailTeamMemberMutation(input),
      transform: () => ({ success: true }),
    }
  }],
  [IPCChannels.Email.DeleteTeamMember, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/email/team-members/${pathTextSegment(id, "email team member id", 100)}`,
    transform: () => ({ success: true }),
  })],

  [IPCChannels.Jtl.GetFirmen, () => ({
    method: "GET",
    path: "/api/v1/jtl/firmen",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<JtlReferenceRecord>(body).map((item) => mapJtlReference(item, "kFirma")),
  })],
  [IPCChannels.Jtl.GetWarenlager, () => ({
    method: "GET",
    path: "/api/v1/jtl/warenlager",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<JtlReferenceRecord>(body).map((item) => mapJtlReference(item, "kWarenlager")),
  })],
  [IPCChannels.Jtl.GetZahlungsarten, () => ({
    method: "GET",
    path: "/api/v1/jtl/zahlungsarten",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<JtlReferenceRecord>(body).map((item) => mapJtlReference(item, "kZahlungsart")),
  })],
  [IPCChannels.Jtl.GetVersandarten, () => ({
    method: "GET",
    path: "/api/v1/jtl/versandarten",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<JtlReferenceRecord>(body).map((item) => mapJtlReference(item, "kVersandart")),
  })],
  [IPCChannels.Jtl.CreateOrder, ([payload]) => ({
    method: "POST",
    path: "/api/v1/jtl/orders",
    body: mapJtlOrderPayload(payload),
    transform: (body) => dataBody<{ success: boolean; jtlOrderId?: number; jtlOrderNumber?: string; error?: string }>(body),
  })],

  [IPCChannels.Dashboard.GetStats, () => ({
    method: "GET",
    path: "/api/v1/dashboard/stats",
    transform: (body) => mapDashboardStats(dataBody<DashboardStatsRecord>(body)),
  })],
  [IPCChannels.Dashboard.GetRecentCustomers, ([limit]) => ({
    method: "GET",
    path: "/api/v1/dashboard/recent-customers",
    query: { limit: dashboardLimitValue(limit) },
    transform: (body) => listItems<DashboardRecentCustomerRecord>(body).map(mapDashboardRecentCustomer),
  })],
  [IPCChannels.Dashboard.GetUpcomingTasks, ([limit]) => ({
    method: "GET",
    path: "/api/v1/dashboard/upcoming-tasks",
    query: { limit: dashboardLimitValue(limit) },
    transform: (body) => listItems<DashboardUpcomingTaskRecord>(body).map(mapDashboardUpcomingTask),
  })],

  [IPCChannels.FollowUp.GetItems, ([payload]) => {
    const input = objectPayload(payload ?? {}, "follow-up items payload")
    const filters = objectPayload(input.filters ?? {}, "follow-up filters")
    return {
      method: "GET",
      path: "/api/v1/follow-up/items",
      query: {
        queue: input.queue ?? "heute",
        limit: limitValue(input.limit),
        offset: offsetValue(input.offset),
        query: filters.query,
        priority: filters.priority,
      },
      transform: (body) => listItems<FollowUpItemRecord>(body).map(mapFollowUpItem),
    }
  }],
  [IPCChannels.FollowUp.GetQueueCounts, () => ({
    method: "GET",
    path: "/api/v1/follow-up/queue-counts",
    transform: (body) => mapFollowUpQueueCounts(dataBody<FollowUpQueueCountsRecord>(body)),
  })],
  [IPCChannels.FollowUp.SnoozeTask, ([payload]) => {
    const input = objectPayload(payload, "follow-up snooze payload")
    return {
      method: "PATCH",
      path: `/api/v1/follow-up/tasks/${positiveId(input.taskId, "task id")}/snooze`,
      body: { snoozedUntil: input.snoozedUntil },
      transform: (body) => dataBody<{ success: boolean; error?: string }>(body),
    }
  }],
  [IPCChannels.FollowUp.LogActivity, ([payload]) => ({
    method: "POST",
    path: "/api/v1/activity-log",
    body: mapActivityLogMutation(payload),
    transform: (body) => ({ success: true, id: dataBody<ActivityLogRecord>(body).id }),
  })],
  [IPCChannels.FollowUp.GetTimeline, ([payload]) => {
    const input = objectPayload(payload, "timeline payload")
    return {
      method: "GET",
      path: "/api/v1/activity-log",
      query: {
        limit: limitValue(input.limit),
        customerId: positiveId(input.customerId, "customer id"),
        sort: "createdAtDesc",
        ...mapTimelineFilterQuery(input.filter),
      },
      transform: (body) => listItems<ActivityLogRecord>(body).map(mapActivityLogRecord),
    }
  }],
  [IPCChannels.FollowUp.GetSavedViews, () => ({
    method: "GET",
    path: "/api/v1/saved-views",
    query: { limit: DEFAULT_LIST_LIMIT },
    transform: (body) => listItems<SavedViewRecord>(body).map(mapSavedViewRecord),
  })],
  [IPCChannels.FollowUp.CreateSavedView, ([payload]) => ({
    method: "POST",
    path: "/api/v1/saved-views",
    body: payload,
    transform: (body) => ({ success: true, id: dataBody<SavedViewRecord>(body).id }),
  })],
  [IPCChannels.FollowUp.DeleteSavedView, ([id]) => ({
    method: "DELETE",
    path: `/api/v1/saved-views/${positiveId(id, "saved view id")}`,
    transform: () => ({ success: true }),
  })],
])

export function buildHttpInvocation(channel: InvokeChannel, args: unknown[]): HttpInvocationSpec {
  const builder = routeBuilders.get(channel)
  if (!builder) {
    throw new Error(`No HTTP transport mapping registered for IPC channel ${channel}`)
  }
  return builder(args)
}

export function hasHttpInvocation(channel: InvokeChannel): boolean {
  return routeBuilders.has(channel)
}

function dataBody<T>(body: unknown): T {
  if (isRecord(body) && "data" in body) {
    return (body as ApiDataBody<T>).data
  }
  return body as T
}

function listItems<T>(body: unknown): T[] {
  const data = dataBody<ListResult<T> | T[]>(body)
  if (Array.isArray(data)) return data
  if (isRecord(data) && Array.isArray(data.items)) return data.items as T[]
  return []
}

function listResult<T>(body: unknown): ListResult<T> {
  const data = dataBody<ListResult<T> | T[]>(body)
  if (Array.isArray(data)) return { items: data, nextCursor: null }
  if (isRecord(data) && Array.isArray(data.items)) {
    const nextCursor = typeof data.nextCursor === "number" ? data.nextCursor : null
    const total = typeof data.total === "number" && Number.isFinite(data.total) && data.total >= 0
      ? Math.floor(data.total)
      : null
    return { items: data.items as T[], nextCursor, total }
  }
  return { items: [], nextCursor: null }
}

async function collectPagedListItems<T>(
  firstPageBody: unknown,
  context: HttpInvocationContext,
  request: HttpRequestSpec,
  maxItems?: number,
): Promise<T[]> {
  const items: T[] = []
  const seenCursors = new Set<number>()
  let page = listResult<T>(firstPageBody)

  for (;;) {
    items.push(...page.items)
    if (typeof maxItems === "number" && items.length >= maxItems) return items.slice(0, maxItems)
    const cursor = page.nextCursor ?? null
    if (cursor === null) return items
    if (seenCursors.has(cursor)) throw new Error("Invalid paged list cursor")
    seenCursors.add(cursor)
    const body = await context.fetchJson({
      ...request,
      query: {
        ...request.query,
        limit: request.query?.limit ?? DEFAULT_LIST_LIMIT,
        cursor,
      },
    })
    page = listResult<T>(body)
  }
}

async function collectOffsetListItems<T>(
  firstPageBody: unknown,
  context: HttpInvocationContext,
  request: HttpRequestSpec,
  startOffset: number,
  maxItems: number,
): Promise<T[]> {
  const items: T[] = []
  let page = listResult<T>(firstPageBody)
  let nextOffset = startOffset

  for (;;) {
    items.push(...page.items)
    if (items.length >= maxItems) return items.slice(0, maxItems)
    if ((page.nextCursor ?? null) === null || page.items.length === 0) return items
    nextOffset += page.items.length
    const body = await context.fetchJson({
      ...request,
      query: {
        ...request.query,
        limit: request.query?.limit ?? DEFAULT_LIST_LIMIT,
        offset: nextOffset,
      },
    })
    page = listResult<T>(body)
  }
}

function mapAuditEventRecord(record: AuditEventRecord) {
  return {
    id: Number(record.id ?? 0),
    user_id: record.actorUserId ?? null,
    action: record.action ?? "",
    resource_type: record.entityType ?? null,
    resource_id: record.entityId ?? null,
    detail_json: record.metadata === undefined || record.metadata === null
      ? null
      : JSON.stringify(record.metadata),
    prev_hash: record.previousHash ?? null,
    row_hash: record.eventHash ?? "",
    at: record.createdAt ?? "",
  }
}

function mapAuthUserRecord(record: AuthUserRecord) {
  return {
    id: record.id,
    username: record.email ?? "",
    display_name: record.displayName ?? record.email ?? "",
    role: legacyAuthUserRole(record.role),
    is_active: record.disabledAt ? 0 : 1,
    created_at: record.createdAt ?? null,
    updated_at: record.updatedAt ?? null,
    last_login_at: null,
  }
}

function mapAutomationApiSettings(records: AutomationApiKeyRecord[]) {
  const keys = records
    .map(mapAutomationApiKeyRecord)
    .filter((key) => key.id && !key.revokedAt)
  const firstKey = keys[0]

  return {
    enabled: true,
    port: 0,
    bindLan: false,
    hasApiKey: keys.length > 0,
    keyPreview: firstKey ? `${firstKey.label} (${firstKey.id.slice(0, 8)})` : null,
    scopes: firstKey ? firstKey.scopes : [...AUTOMATION_SCOPES],
    keys,
  }
}

function mapAutomationApiKeyRecord(record: AutomationApiKeyRecord) {
  const id = record.id ?? ""
  return {
    id,
    label: record.label ?? id,
    scopes: mapAutomationScopes(record.scopes),
    lastUsedAt: record.lastUsedAt ?? null,
    revokedAt: record.revokedAt ?? null,
    createdByUserId: record.createdByUserId ?? null,
    secretConfigured: record.secretConfigured === true,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
  }
}

function mapAutomationScopes(value: unknown): AutomationScope[] {
  if (!Array.isArray(value)) return []
  const scopes: AutomationScope[] = []
  for (const item of value) {
    if (isAutomationScope(item) && !scopes.includes(item)) {
      scopes.push(item)
    }
  }
  return scopes
}

function automationScopesPayload(value: unknown): AutomationScope[] {
  if (value === undefined || value === null) return [...AUTOMATION_SCOPES]
  if (!Array.isArray(value)) throw new Error("Invalid automation api key scopes")
  const scopes: AutomationScope[] = []
  for (const item of value) {
    if (!isAutomationScope(item)) throw new Error("Invalid automation api key scope")
    if (!scopes.includes(item)) scopes.push(item)
  }
  return scopes
}

function automationApiKeyLabel(value: unknown): string {
  const label = value === undefined || value === null
    ? "SimpleCRM Server API"
    : optionalTrimmedText(value, "automation api key label", 200)
  if (!label) throw new Error("Invalid automation api key label")
  return label
}

function automationApiKeyId(value: unknown): string {
  if (typeof value === "string") return stringPayloadField(value, "automation api key id")
  const input = objectPayload(value ?? {}, "automation api key revoke payload")
  return stringPayloadField(input.id ?? input.apiKeyId, "automation api key id")
}

function isAutomationScope(value: unknown): value is AutomationScope {
  return typeof value === "string" && (AUTOMATION_SCOPES as readonly string[]).includes(value)
}

function mapAuthUserPayload(input: Record<string, any>): Record<string, unknown> {
  const email = Object.prototype.hasOwnProperty.call(input, "email")
    ? authUserEmailValue(input.email)
    : authUserEmailValue(input.username)
  const displayName = Object.prototype.hasOwnProperty.call(input, "displayName")
    ? optionalAuthUserText(input.displayName, "auth user display name", 120)
    : Object.prototype.hasOwnProperty.call(input, "display_name")
      ? optionalAuthUserText(input.display_name, "auth user display name", 120)
      : undefined
  const password = Object.prototype.hasOwnProperty.call(input, "password")
    ? authUserPasswordValue(input.password)
    : Object.prototype.hasOwnProperty.call(input, "passphrase")
      ? authUserPasswordValue(input.passphrase)
      : undefined

  return pruneUndefined({
    email,
    displayName,
    role: authUserRoleValue(input.role),
    password,
    isActive: authUserActiveValue(input.isActive ?? input.is_active),
  })
}

function mapAuthInvitePayload(input: Record<string, any>): Record<string, unknown> {
  const email = Object.prototype.hasOwnProperty.call(input, "email")
    ? authUserEmailValue(input.email)
    : authUserEmailValue(input.username)
  const displayName = Object.prototype.hasOwnProperty.call(input, "displayName")
    ? optionalAuthUserText(input.displayName, "auth invite display name", 120)
    : Object.prototype.hasOwnProperty.call(input, "display_name")
      ? optionalAuthUserText(input.display_name, "auth invite display name", 120)
      : undefined

  return pruneUndefined({
    email,
    displayName,
    role: input.role === undefined ? "user" : authUserRoleValue(input.role),
    expiresInDays: input.expiresInDays === undefined ? undefined : inviteExpiryDaysValue(input.expiresInDays),
  })
}

function legacyAuthUserRole(role: string | null | undefined): string {
  if (role === "owner" || role === "admin") return role
  return "agent"
}

function authUserRoleValue(value: unknown): "owner" | "admin" | "user" {
  if (value === "owner" || value === "admin" || value === "user") return value
  if (value === "agent" || value === "viewer") return "user"
  throw new Error("Invalid auth user role")
}

function authUserEmailValue(value: unknown): string {
  const email = stringPayloadField(value, "auth user email").toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid auth user email")
  }
  return email
}

function authUserPasswordValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid auth user password")
  if (value.length < 10 || value.length > 1000) throw new Error("Invalid auth user password")
  return value
}

function optionalAuthUserText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = optionalTrimmedText(value, label, maxLength)
  return text || undefined
}

function authUserActiveValue(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["1", "true", "yes", "on"].includes(normalized)) return true
    if (["0", "false", "no", "off"].includes(normalized)) return false
  }
  throw new Error("Invalid auth user active flag")
}

function inviteExpiryDaysValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 30) {
    throw new Error("Invalid auth invite expiry")
  }
  return parsed
}

function mapCustomerRecord(record: CustomerRecord) {
  return {
    id: record.id,
    jtl_kKunde: record.sourceSqliteId ?? record.id,
    customerNumber: record.customerNumber ?? undefined,
    name: record.name ?? "",
    firstName: record.firstName ?? undefined,
    company: record.company ?? undefined,
    email: record.email ?? undefined,
    phone: record.phone ?? undefined,
    mobile: record.mobile ?? undefined,
    street: record.street ?? undefined,
    zip: record.zipCode ?? "",
    city: record.city ?? undefined,
    country: record.country ?? undefined,
    notes: record.notes ?? undefined,
    status: record.status ?? "Active",
    lastModifiedLocally: record.updatedAt ?? undefined,
  }
}

function mapCustomerMutation(value: unknown): Record<string, unknown> {
  const input = objectPayload(value ?? {}, "customer payload")
  return pruneUndefined({
    customerNumber: input.customerNumber,
    name: input.name,
    firstName: input.firstName,
    company: input.company,
    email: input.email,
    phone: input.phone,
    mobile: input.mobile,
    street: input.street,
    zipCode: input.zipCode ?? input.zip,
    city: input.city,
    country: input.country,
    notes: input.notes,
    status: input.status,
  })
}

function customerCustomFieldsPayload(value: unknown): Record<string, unknown> | undefined {
  const input = objectPayload(value ?? {}, "customer payload")
  return isRecord(input.customFields) ? input.customFields : undefined
}

async function persistCustomerCustomFields(
  context: HttpInvocationContext,
  customerId: number,
  customFields: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(customFields)
  if (entries.length === 0) return

  const fields = await fetchAllCustomerCustomFields(context)
  const fieldIdsByName = new Map(fields.map((field) => [field.name ?? "", field.id]))

  for (const [fieldName, fieldValue] of entries) {
    const fieldId = fieldIdsByName.get(fieldName)
    if (fieldId === undefined) continue
    await context.fetchJson({
      method: "POST",
      path: "/api/v1/customer-custom-field-values",
      body: {
        customerId,
        fieldId,
        value: customFieldValuePayload(fieldValue),
      },
    })
  }
}

async function attachCustomerCustomFields<T extends { id: number }>(
  context: HttpInvocationContext,
  customers: T[],
): Promise<Array<T & { customFields: Record<string, string> }>> {
  if (customers.length === 0) return customers.map((customer) => ({ ...customer, customFields: {} }))

  const fields = await fetchAllCustomerCustomFields(context)
  const fieldNamesById = new Map(fields.map((field) => [field.id, field.name ?? ""]))
  const customFieldsByCustomerId = new Map<number, Record<string, string>>()

  await Promise.all(customers.map(async (customer) => {
    const body = await context.fetchJson({
      method: "GET",
      path: "/api/v1/customer-custom-field-values",
      query: { limit: DEFAULT_LIST_LIMIT, customerId: customer.id },
    })
    const values = listItems<CustomFieldValueRecord>(body)
    const customFields: Record<string, string> = {}
    for (const value of values) {
      const fieldName = fieldNamesById.get(Number(value.fieldId ?? 0))
      if (!fieldName) continue
      customFields[fieldName] = value.value ?? ""
    }
    customFieldsByCustomerId.set(customer.id, customFields)
  }))

  return customers.map((customer) => ({
    ...customer,
    customFields: customFieldsByCustomerId.get(customer.id) ?? {},
  }))
}

async function fetchAllCustomerCustomFields(context: HttpInvocationContext): Promise<CustomFieldRecord[]> {
  const body = await context.fetchJson({
    method: "GET",
    path: "/api/v1/customer-custom-fields",
    query: { limit: DEFAULT_LIST_LIMIT },
  })
  return collectPagedListItems<CustomFieldRecord>(body, context, {
    method: "GET",
    path: "/api/v1/customer-custom-fields",
    query: { limit: DEFAULT_LIST_LIMIT },
  })
}

function customFieldValuePayload(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return typeof value === "object" ? JSON.stringify(value) : String(value)
}

function mapProductRecord(record: ProductRecord) {
  return {
    id: record.id,
    jtl_kArtikel: record.jtlKartikel ?? record.sourceSqliteId ?? record.id,
    sku: record.sku ?? undefined,
    name: record.name ?? "",
    description: record.description ?? undefined,
    price: record.price === null || record.price === undefined ? undefined : Number(record.price),
    isActive: Boolean(record.isActive),
    jtl_dateCreated: record.updatedAt ?? undefined,
  }
}

function mapProductMutation(value: unknown): Record<string, unknown> {
  const input = objectPayload(value ?? {}, "product payload")
  return pruneUndefined({
    name: input.name,
    sku: input.sku,
    description: input.description,
    price: input.price === undefined || input.price === null ? undefined : String(input.price),
    isActive: input.isActive,
  })
}

function mapDealRecord(record: DealRecord) {
  const customerName = record.customerName ?? record.customer_name ?? ""
  const customerId = record.customerId ?? null
  const valueCalculationMethod = record.valueCalculationMethod ?? record.value_calculation_method ?? "static"
  const createdDate = record.createdDate ?? record.created_date ?? ""
  const expectedCloseDate = record.expectedCloseDate ?? record.expected_close_date ?? ""
  const updatedAt = record.updatedAt ?? record.last_modified ?? undefined

  return {
    id: record.id,
    source_sqlite_id: record.sourceSqliteId ?? record.id,
    customer_source_sqlite_id: record.customerSourceSqliteId ?? undefined,
    customer_id: customerId === null ? 0 : Number(customerId),
    customer: customerName,
    customer_name: customerName,
    name: record.name ?? "",
    value: record.value ?? "0",
    valueCalculationMethod,
    value_calculation_method: valueCalculationMethod,
    stage: record.stage ?? "Interessent",
    notes: record.notes ?? "",
    createdDate,
    created_date: createdDate,
    expectedCloseDate,
    expected_close_date: expectedCloseDate,
    last_modified: updatedAt,
  }
}

function mapDealProductRecord(record: DealProductRecord) {
  const product = mapProductRecord(record.product ?? { id: record.productId ?? record.id })
  return {
    ...product,
    deal_product_id: record.id,
    deal_id: record.dealId ?? undefined,
    product_id: record.productId ?? product.id,
    quantity: Number(record.quantity ?? 0),
    price_at_time_of_adding: Number(record.priceAtTimeOfAdding ?? 0),
    dateAdded: record.dateAdded ?? undefined,
  }
}

function mapDealMutation(value: unknown): Record<string, unknown> {
  const input = objectPayload(value ?? {}, "deal payload")
  return pruneUndefined({
    customerId: input.customerId ?? input.customer_id,
    name: input.name,
    value: input.value === undefined || input.value === null ? undefined : String(input.value),
    valueCalculationMethod: input.valueCalculationMethod ?? input.value_calculation_method,
    stage: input.stage,
    notes: input.notes,
    createdDate: normalizeDealDateInput(input.createdDate ?? input.created_date),
    expectedCloseDate: normalizeDealDateInput(input.expectedCloseDate ?? input.expected_close_date),
  })
}

function mapDealProductMutation(
  value: unknown,
  options: {
    includeProduct: boolean
  },
): Record<string, unknown> {
  const input = objectPayload(value ?? {}, "deal product payload")
  return pruneUndefined({
    ...(options.includeProduct ? { productId: input.productId } : {}),
    quantity: input.quantity,
    price: input.price === undefined || input.price === null
      ? input.priceAtTime
      : input.price,
  })
}

function dealProductMutationPath(input: Record<string, any>): string {
  if (input.dealProductId !== undefined && input.dealProductId !== null) {
    return `/api/v1/deal-products/${positiveId(input.dealProductId, "deal product id")}`
  }
  return `/api/v1/deals/${positiveId(input.dealId, "deal id")}/products/by-product/${positiveId(input.productId, "product id")}`
}

function mapTaskRecord(record: TaskRecord) {
  return {
    id: record.id,
    customer_id: record.customerId ?? record.customerSourceSqliteId ?? "",
    title: record.title ?? "",
    description: record.description ?? undefined,
    due_date: record.dueDate ?? "",
    priority: record.priority ?? "Medium",
    completed: Boolean(record.completed),
    snoozed_until: record.snoozedUntil ?? undefined,
    last_modified: record.updatedAt ?? undefined,
    calendar_event_id: null,
  }
}

function mapTaskMutation(value: unknown): Record<string, unknown> {
  const input = objectPayload(value ?? {}, "task payload")
  // Customer is optional: a missing or 0 id means "no customer", not customer 0.
  const rawCustomerId = input.customerId ?? input.customer_id
  const customerId = typeof rawCustomerId === "number" && rawCustomerId > 0 ? rawCustomerId : undefined
  return pruneUndefined({
    customerId,
    title: input.title,
    description: input.description,
    dueDate: input.dueDate ?? input.due_date,
    priority: input.priority,
    completed: input.completed === undefined ? undefined : Boolean(input.completed),
    snoozedUntil: input.snoozedUntil ?? input.snoozed_until,
  })
}

function mapCalendarEventRecord(record: CalendarEventRecord) {
  return {
    id: record.id,
    title: record.title ?? "",
    description: record.description ?? "",
    start_date: record.startDate ?? "",
    end_date: record.endDate ?? "",
    all_day: record.allDay ? 1 : 0,
    color_code: record.colorCode ?? undefined,
    event_type: record.eventType ?? undefined,
    recurrence_rule: record.recurrenceRule ?? undefined,
    task_id: record.taskId ?? undefined,
    created_at: record.createdAt ?? undefined,
    updated_at: record.updatedAt ?? undefined,
  }
}

function mapCalendarEventMutation(value: unknown): Record<string, unknown> {
  const input = objectPayload(value ?? {}, "calendar event payload")
  return pruneUndefined({
    title: input.title,
    description: input.description,
    startDate: input.startDate ?? input.start_date,
    endDate: input.endDate ?? input.end_date,
    allDay: input.allDay ?? (input.all_day === undefined ? undefined : Boolean(input.all_day)),
    colorCode: input.colorCode ?? input.color_code,
    eventType: input.eventType ?? input.event_type,
    recurrenceRule: input.recurrenceRule ?? input.recurrence_rule,
    taskId: input.taskId ?? input.task_id,
  })
}

function mapCustomFieldRecord(record: CustomFieldRecord) {
  return {
    id: record.id,
    name: record.name ?? "",
    label: record.label ?? "",
    type: record.type ?? "text",
    required: Boolean(record.required),
    options: stringifyOptions(record.options),
    default_value: record.defaultValue ?? undefined,
    placeholder: record.placeholder ?? undefined,
    description: record.description ?? undefined,
    display_order: record.displayOrder ?? 0,
    active: Boolean(record.active ?? true),
    created_at: record.createdAt ?? "",
    updated_at: record.updatedAt ?? "",
  }
}

function mapCustomFieldMutation(value: unknown): Record<string, unknown> {
  const input = objectPayload(value ?? {}, "custom field payload")
  return pruneUndefined({
    name: input.name,
    label: input.label,
    type: input.type,
    required: input.required === undefined ? undefined : Boolean(input.required),
    options: parseOptions(input.options),
    defaultValue: input.defaultValue ?? input.default_value,
    placeholder: input.placeholder,
    description: input.description,
    displayOrder: input.displayOrder ?? input.display_order,
    active: input.active === undefined ? undefined : Boolean(input.active),
  })
}

function mapCustomFieldValueRecord(record: CustomFieldValueRecord) {
  return {
    id: record.id,
    customer_id: record.customerId ?? undefined,
    field_id: record.fieldId ?? undefined,
    value: record.value ?? "",
    created_at: record.createdAt ?? "",
    updated_at: record.updatedAt ?? "",
  }
}

function mapJtlReference(record: JtlReferenceRecord, idKey: string) {
  return {
    [idKey]: record.sourceSqliteId,
    cName: record.name ?? "",
  }
}

function mapJtlOrderPayload(value: unknown) {
  const input = objectPayload(value, "jtl order payload")
  const products = arrayPayloadField(input.products, "jtl order products", 200).map((item, index) => {
    const product = objectPayload(item, `jtl order product ${index + 1}`)
    return {
      kArtikel: positiveId(product.kArtikel, `jtl order product ${index + 1} kArtikel`),
      cName: optionalStringPayloadField(product.cName, `jtl order product ${index + 1} name`, 510),
      cArtNr: optionalStringPayloadField(product.cArtNr, `jtl order product ${index + 1} sku`, 200),
      nAnzahl: positiveNumberPayloadField(product.nAnzahl, `jtl order product ${index + 1} quantity`),
      fPreis: nonNegativeNumberPayloadField(product.fPreis, `jtl order product ${index + 1} price`),
    }
  })
  if (products.length === 0) throw new Error("Invalid jtl order products")
  return {
    simpleCrmCustomerId: positiveId(input.simpleCrmCustomerId, "jtl order customer id"),
    kFirma: positiveId(input.kFirma, "jtl order company id"),
    kWarenlager: positiveId(input.kWarenlager, "jtl order warehouse id"),
    kZahlungsart: positiveId(input.kZahlungsart, "jtl order payment id"),
    kVersandart: positiveId(input.kVersandart, "jtl order shipping id"),
    products,
  }
}

function mapDashboardStats(record: DashboardStatsRecord) {
  return {
    totalCustomers: Number(record.totalCustomers ?? 0),
    newCustomersLastMonth: Number(record.newCustomersLastMonth ?? 0),
    activeDealsCount: Number(record.activeDealsCount ?? 0),
    activeDealsValue: Number(record.activeDealsValue ?? 0),
    pendingTasksCount: Number(record.pendingTasksCount ?? 0),
    dueTodayTasksCount: Number(record.dueTodayTasksCount ?? 0),
    conversionRate: Number(record.conversionRate ?? 0),
  }
}

function mapDashboardRecentCustomer(record: DashboardRecentCustomerRecord) {
  return {
    id: String(record.id),
    name: record.name ?? "",
    email: record.email ?? undefined,
    dateAdded: record.dateAdded ?? "",
  }
}

function mapDashboardUpcomingTask(record: DashboardUpcomingTaskRecord) {
  return {
    id: record.id,
    title: record.title ?? "",
    priority: record.priority ?? "Medium",
    customer_id: record.customerId ?? undefined,
    dueDate: record.dueDate ?? "",
    customerName: record.customerName ?? undefined,
  }
}

function mapActivityLogMutation(value: unknown): Record<string, unknown> {
  const input = objectPayload(value ?? {}, "activity log payload")
  return pruneUndefined({
    customerId: input.customerId ?? input.customer_id,
    dealId: input.dealId ?? input.deal_id,
    taskId: input.taskId ?? input.task_id,
    activityType: input.activityType ?? input.activity_type,
    title: input.title,
    description: input.description,
    metadata: input.metadata,
  })
}

function mapTimelineFilterQuery(value: unknown): Record<string, unknown> {
  const filter = typeof value === "string" ? value.trim() : undefined
  if (!filter) return {}
  if (filter === "tasks" || filter === "deals" || filter === "communication") {
    return { timelineFilter: filter }
  }
  return { activityType: filter }
}

function mapActivityLogRecord(record: ActivityLogRecord) {
  return {
    id: record.id,
    customer_id: record.customerId ?? undefined,
    deal_id: record.dealId ?? undefined,
    task_id: record.taskId ?? undefined,
    activity_type: record.activityType ?? "",
    title: record.title ?? undefined,
    description: record.description ?? undefined,
    metadata: record.metadata === undefined ? undefined : JSON.stringify(record.metadata),
    created_at: record.createdAt ?? "",
  }
}

function mapEmailAccountRecord(record: EmailAccountRecord) {
  const legacyId = record.sourceSqliteId != null && record.sourceSqliteId > 0
    ? record.sourceSqliteId
    : record.id
  return {
    id: legacyId,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    display_name: record.displayName ?? "",
    email_address: record.emailAddress ?? "",
    protocol: record.protocol ?? "imap",
    imap_host: record.imapHost ?? "",
    imap_port: record.imapPort ?? 993,
    imap_tls: record.imapTls ? 1 : 0,
    imap_username: record.imapUsername ?? "",
    keytar_account_key: "",
    smtp_host: record.smtpHost ?? null,
    smtp_port: record.smtpPort ?? null,
    smtp_tls: record.smtpTls ? 1 : 0,
    smtp_username: record.smtpUsername ?? null,
    smtp_use_imap_auth: record.smtpUseImapAuth ? 1 : 0,
    pop3_host: record.pop3Host ?? null,
    pop3_port: record.pop3Port ?? null,
    pop3_tls: record.pop3Tls == null || record.pop3Tls ? 1 : 0,
    sent_folder_path: record.sentFolderPath ?? null,
    sync_spam_folder_path: record.syncSpamFolderPath ?? null,
    sync_archive_folder_path: record.syncArchiveFolderPath ?? null,
    imap_sync_sent: record.imapSyncSent ? 1 : 0,
    imap_sync_archive: record.imapSyncArchive ? 1 : 0,
    imap_sync_spam: record.imapSyncSpam ? 1 : 0,
    imap_sync_seen_on_open: record.imapSyncSeenOnOpen === false || record.imapSyncSeenOnOpen === 0 ? 0 : 1,
    vacation_enabled: record.vacationEnabled ? 1 : 0,
    vacation_subject: record.vacationSubject ?? null,
    vacation_body_text: record.vacationBodyText ?? null,
    request_read_receipt: record.requestReadReceipt ? 1 : 0,
    created_at: record.updatedAt ?? "",
    updated_at: record.updatedAt ?? "",
  }
}

function mapEmailAccountMutationPayload(value: Record<string, any>): Record<string, unknown> {
  return pruneUndefined({
    displayName: value.displayName === undefined ? undefined : optionalTrimmedText(value.displayName, "email account display name", 320),
    emailAddress: value.emailAddress === undefined ? undefined : optionalTrimmedText(value.emailAddress, "email account address", 320),
    imapHost: value.imapHost === undefined ? undefined : optionalTrimmedText(value.imapHost, "imap host", 500),
    imapPort: value.imapPort === undefined ? undefined : positiveId(value.imapPort, "imap port"),
    imapTls: optionalBoolean(value.imapTls, "imap tls flag"),
    imapUsername: value.imapUsername === undefined ? undefined : optionalTrimmedText(value.imapUsername, "imap username", 500),
    imapPassword: value.imapPassword === undefined ? undefined : passwordValue(value.imapPassword, "imap password"),
    smtpHost: value.smtpHost === undefined ? undefined : nullableTrimmedText(value.smtpHost, "smtp host", 500),
    smtpPort: value.smtpPort === undefined ? undefined : nullablePositiveId(value.smtpPort, "smtp port"),
    smtpTls: optionalBoolean(value.smtpTls, "smtp tls flag"),
    smtpUsername: value.smtpUsername === undefined ? undefined : nullableTrimmedText(value.smtpUsername, "smtp username", 500),
    smtpUseImapAuth: optionalBoolean(value.smtpUseImapAuth, "smtp imap auth flag"),
    smtpPassword: value.smtpPassword === undefined ? undefined : passwordValue(value.smtpPassword, "smtp password"),
    protocol: value.protocol === undefined ? undefined : accountProtocol(value.protocol),
    pop3Host: value.pop3Host === undefined ? undefined : nullableTrimmedText(value.pop3Host, "pop3 host", 500),
    pop3Port: value.pop3Port === undefined ? undefined : nullablePositiveId(value.pop3Port, "pop3 port"),
    pop3Tls: optionalBoolean(value.pop3Tls, "pop3 tls flag"),
    sentFolderPath: value.sentFolderPath === undefined ? undefined : nullableTrimmedText(value.sentFolderPath, "sent folder path", 500),
    syncSpamFolderPath: value.syncSpamFolderPath === undefined ? undefined : nullableTrimmedText(value.syncSpamFolderPath, "sync spam folder path", 500),
    syncArchiveFolderPath: value.syncArchiveFolderPath === undefined ? undefined : nullableTrimmedText(value.syncArchiveFolderPath, "sync archive folder path", 500),
    imapSyncSent: optionalBoolean(value.imapSyncSent, "imap sent sync flag"),
    imapSyncArchive: optionalBoolean(value.imapSyncArchive, "imap archive sync flag"),
    imapSyncSpam: optionalBoolean(value.imapSyncSpam, "imap spam sync flag"),
    imapSyncSeenOnOpen: optionalBoolean(value.imapSyncSeenOnOpen, "imap seen sync flag"),
    vacationEnabled: optionalBoolean(value.vacationEnabled, "vacation enabled flag"),
    vacationSubject: value.vacationSubject === undefined ? undefined : nullableTrimmedText(value.vacationSubject, "vacation subject", 500),
    vacationBodyText: value.vacationBodyText === undefined ? undefined : nullableTrimmedText(value.vacationBodyText, "vacation body", 10000),
    requestReadReceipt: optionalBoolean(value.requestReadReceipt, "read receipt request flag"),
  })
}

function mapComposeDraftCreatePayload(value: Record<string, any>): Record<string, unknown> {
  return pruneUndefined({
    accountId: positiveId(value.accountId, "email account id"),
    subject: value.subject === undefined ? undefined : composeTextValue(value.subject, "compose subject", 1000),
    bodyText: value.bodyText === undefined ? undefined : composeTextValue(value.bodyText, "compose body", 2_000_000),
    to: value.to === undefined ? undefined : optionalTrimmedText(value.to, "compose to", 10_000),
  })
}

function mapComposeDraftUpdatePayload(value: Record<string, any>): Record<string, unknown> {
  return pruneUndefined({
    subject: value.subject === undefined ? undefined : composeTextValue(value.subject, "compose subject", 1000),
    bodyText: value.bodyText === undefined ? undefined : composeTextValue(value.bodyText, "compose body", 2_000_000),
    bodyHtml: value.bodyHtml === undefined ? undefined : composeTextValue(value.bodyHtml, "compose html", 2_000_000),
    to: value.to === undefined ? undefined : optionalTrimmedText(value.to, "compose to", 10_000),
    cc: value.cc === undefined ? undefined : optionalTrimmedText(value.cc, "compose cc", 10_000),
    bcc: value.bcc === undefined ? undefined : optionalTrimmedText(value.bcc, "compose bcc", 10_000),
    draftAttachmentPaths: value.draftAttachmentPaths === undefined
      ? undefined
      : draftAttachmentPathArray(value.draftAttachmentPaths),
    replyParentMessageId: value.replyParentMessageId === undefined
      ? undefined
      : value.replyParentMessageId === null
        ? null
        : positiveId(value.replyParentMessageId, "reply parent message id"),
    markReplyParentDone: optionalBoolean(value.markReplyParentDone, "mark reply parent done flag"),
  })
}

function mapComposeSendPayload(value: Record<string, any>): Record<string, unknown> {
  return pruneUndefined({
    accountId: positiveId(value.accountId, "email account id"),
    draftMessageId: positiveId(value.draftMessageId, "email draft message id"),
    subject: composeTextValue(value.subject, "compose subject", 1000),
    bodyText: composeTextValue(value.bodyText, "compose body", 2_000_000),
    bodyHtml: value.bodyHtml === undefined || value.bodyHtml === null
      ? value.bodyHtml
      : composeTextValue(value.bodyHtml, "compose html", 2_000_000),
    to: stringPayloadField(value.to, "compose to"),
    cc: value.cc === undefined ? undefined : optionalTrimmedText(value.cc, "compose cc", 10_000),
    bcc: value.bcc === undefined ? undefined : optionalTrimmedText(value.bcc, "compose bcc", 10_000),
    inReplyToMessageId: value.inReplyToMessageId === undefined
      ? undefined
      : value.inReplyToMessageId === null
        ? null
        : positiveId(value.inReplyToMessageId, "reply parent message id"),
    attachmentPaths: value.attachmentPaths === undefined ? undefined : draftAttachmentPathArray(value.attachmentPaths),
    markReplyParentDone: optionalBoolean(value.markReplyParentDone, "mark reply parent done flag"),
    requestReadReceipt: optionalBoolean(value.requestReadReceipt, "request read receipt flag"),
    pgpEncrypt: optionalBoolean(value.pgpEncrypt, "pgp encrypt flag"),
    pgpSign: optionalBoolean(value.pgpSign, "pgp sign flag"),
    pgpPassphrase: value.pgpPassphrase === undefined
      ? undefined
      : composeTextValue(value.pgpPassphrase, "pgp passphrase", 10_000),
    pgpUserId: value.pgpUserId === undefined
      ? undefined
      : optionalTrimmedText(value.pgpUserId, "pgp user id", 500),
  })
}

function mapOutboundValidationPayload(value: Record<string, any>): Record<string, unknown> {
  return pruneUndefined({
    messageId: positiveId(value.messageId, "email message id"),
    subject: composeTextValue(value.subject, "compose subject", 1000),
    bodyText: composeTextValue(value.bodyText, "compose body", 2_000_000),
    bodyHtml: value.bodyHtml === undefined || value.bodyHtml === null
      ? value.bodyHtml
      : composeTextValue(value.bodyHtml, "compose html", 2_000_000),
    to: stringPayloadField(value.to, "compose to"),
    cc: value.cc === undefined ? undefined : optionalTrimmedText(value.cc, "compose cc", 10_000),
    bcc: value.bcc === undefined ? undefined : optionalTrimmedText(value.bcc, "compose bcc", 10_000),
    inReplyToMessageId: value.inReplyToMessageId === undefined
      ? undefined
      : value.inReplyToMessageId === null
        ? null
        : positiveId(value.inReplyToMessageId, "reply parent message id"),
    attachmentCount: value.attachmentCount === undefined
      ? undefined
      : nonNegativeInteger(value.attachmentCount, "attachment count"),
  })
}

function mapEmailOAuthAppPayload(value: unknown): Record<string, unknown> {
  const input = objectPayload(value, "email oauth app payload")
  return {
    clientId: optionalTrimmedText(input.clientId, "email oauth client id", 1000),
    clientSecret: optionalTrimmedText(input.clientSecret, "email oauth client secret", 2000),
  }
}

function mapEmailOAuthFinishPayload(value: unknown): Record<string, unknown> {
  const input = objectPayload(value, "email oauth finish payload")
  return {
    accountId: positiveId(input.accountId, "email account id"),
    redirectUri: stringPayloadField(input.redirectUri, "email oauth redirect uri"),
    code: stringPayloadField(input.code, "email oauth code"),
  }
}

function mapEmailAttachmentRecord(record: EmailAttachmentRecord) {
  return {
    id: record.id,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    filename_display: record.filename ?? "",
    size_bytes: record.sizeBytes ?? 0,
    content_type: record.contentType ?? null,
  }
}

function mapEmailMessageRecord(record: EmailMessageRecord) {
  return {
    id: record.id,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    account_id: record.accountId ?? 0,
    folder_id: record.folderId ?? 0,
    uid: record.uid ?? 0,
    message_id: record.messageId ?? null,
    subject: record.subject ?? null,
    snippet: record.snippet ?? null,
    date_received: record.dateReceived ?? null,
    from_json: addressJsonString(record.from),
    to_json: addressJsonString(record.to),
    cc_json: addressJsonString(record.cc),
    bcc_json: addressJsonString(record.bcc),
    body_text: record.bodyText ?? null,
    body_html: record.bodyHtml ?? null,
    seen_local: record.seenLocal ? 1 : 0,
    done_local: record.doneLocal ? 1 : 0,
    is_spam: record.isSpam ? 1 : 0,
    spam_status: record.spamStatus ?? null,
    archived: record.archived ? 1 : 0,
    ticket_code: record.ticketCode ?? null,
    thread_id: record.threadId ?? null,
    imap_thread_id: record.imapThreadId ?? null,
    customer_id: record.customerId ?? null,
    folder_kind: record.folderKind ?? undefined,
    assigned_to: record.assignedTo ?? record.assignedToUserId ?? null,
    has_attachments: record.hasAttachments ? 1 : 0,
    pgp_status: record.pgpStatus ?? null,
    snoozed_until: record.snoozedUntil ?? null,
    draft_attachment_paths_json: record.draftAttachmentPathsJson ?? null,
    reply_parent_message_id: record.replyParentMessageId ?? null,
    updated_at: record.updatedAt ?? undefined,
    remote_content_policy: record.remoteContentPolicy ?? undefined,
    read_receipt_requested: record.readReceiptRequested ? 1 : 0,
  }
}

function mapEmailThreadRecord(record: EmailThreadRecord) {
  const hasUnread = Boolean(record.hasUnread)
  const hasAttachments = Boolean(record.hasAttachments)
  return {
    threadId: record.id,
    thread_id: record.id,
    ticketCode: record.ticketCode ?? null,
    ticket_code: record.ticketCode ?? null,
    messageCount: record.messageCount ?? 0,
    message_count: record.messageCount ?? 0,
    lastMessageAt: record.lastMessageAt ?? null,
    last_message_at: record.lastMessageAt ?? null,
    hasUnread,
    has_unread: hasUnread ? 1 : 0,
    hasAttachments,
    has_attachments: hasAttachments ? 1 : 0,
    subject: record.subjectNormalized ?? null,
    subject_normalized: record.subjectNormalized ?? null,
    latestMessageId: record.rootMessageId ?? null,
    latest_message_id: record.rootMessageId ?? null,
    root_message_id: record.rootMessageId ?? null,
    root_message_source_sqlite_id: record.rootMessageSourceSqliteId ?? null,
    created_at: record.createdAt ?? undefined,
    updated_at: record.updatedAt ?? undefined,
  }
}

function mapMailFolderCounts(record: EmailMailFolderCountsRecord) {
  return {
    inbox: countValue(record.inbox),
    inboxUnread: countValue(record.inboxUnread),
    sentFailed: countValue(record.sentFailed),
    drafts: countValue(record.drafts),
    archived: countValue(record.archived),
    spamReview: countValue(record.spamReview),
    spam: countValue(record.spam),
    trash: countValue(record.trash),
    snoozed: countValue(record.snoozed),
  }
}

function mapEmailDiagnosticsReport(record: EmailDiagnosticsRecord) {
  const messages = record.messages ?? {}
  const workflows = record.workflows ?? {}
  const notices = record.notices ?? {}
  const syncInfo = record.syncInfo ?? {}
  const background = record.background ?? {}
  const sizes = record.sizes ?? {}
  return {
    collectedAt: typeof record.collectedAt === "string" ? record.collectedAt : new Date().toISOString(),
    schemaGeneration: countValue(record.schemaGeneration),
    schemaGenerationLabel: record.schemaGenerationLabel ?? "",
    sizes: {
      databaseBytes: sizes.databaseBytes == null ? null : countValue(sizes.databaseBytes),
      attachmentsBytes: countValue(sizes.attachmentsBytes),
    },
    messages: {
      total: countValue(messages.total),
      pendingPostProcess: countValue(messages.pendingPostProcess),
      outboundHold: countValue(messages.outboundHold),
      byFolderKind: countMap(messages.byFolderKind),
    },
    workflows: {
      runsLast24h: countValue(workflows.runsLast24h),
      runsBlockedLast24h: countValue(workflows.runsBlockedLast24h),
      runsErrorLast24h: countValue(workflows.runsErrorLast24h),
    },
    notices: {
      imapAuth: countValue(notices.imapAuth),
      uidValidity: countValue(notices.uidValidity),
    },
    syncInfo: {
      totalKeys: countValue(syncInfo.totalKeys),
      prefixes: countMap(syncInfo.prefixes),
    },
    background: {
      cronScheduled: background.cronScheduled === true,
      cronTickInFlight: background.cronTickInFlight === true,
      syncInFlightAccountIds: numberArray(background.syncInFlightAccountIds),
      idleImapAccountIds: numberArray(background.idleImapAccountIds),
    },
    accounts: Array.isArray(record.accounts)
      ? record.accounts.filter(isRecord).map((account) => ({
        id: countValue(account.id),
        email: typeof account.email === "string" ? account.email : "",
        protocol: typeof account.protocol === "string" ? account.protocol : "imap",
        inboxLastSyncedAt: typeof account.inboxLastSyncedAt === "string" ? account.inboxLastSyncedAt : null,
      }))
      : [],
  }
}

function mapEmailReportingSnapshot(record: EmailReportingRecord) {
  const totals = record.totals ?? {}
  return {
    accounts: Array.isArray(record.accounts)
      ? record.accounts.map((account) => ({
        id: countValue(account.id),
        display_name: typeof account.displayName === "string" ? account.displayName : "",
        email_address: typeof account.emailAddress === "string" ? account.emailAddress : "",
        protocol: typeof account.protocol === "string" && account.protocol.trim()
          ? account.protocol.trim()
          : "imap",
      }))
      : [],
    totals: {
      messages: countValue(totals.messages),
      unread: countValue(totals.unread),
      archived: countValue(totals.archived),
      withCustomer: countValue(totals.withCustomer),
      withAssignment: countValue(totals.withAssignment),
      withAttachments: countValue(totals.withAttachments),
    },
    perAccount: Array.isArray(record.perAccount)
      ? record.perAccount.map((row) => ({
        accountId: countValue(row.accountId),
        messages: countValue(row.messages),
        unread: countValue(row.unread),
        archived: countValue(row.archived),
      }))
      : [],
    workflowRuns24h: Array.isArray(record.workflowRuns24h)
      ? record.workflowRuns24h.map((row) => ({
        workflow_id: countValue(row.workflowId),
        count: countValue(row.count),
        errors: countValue(row.errors),
      }))
      : [],
  }
}

function countValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0
}

function countMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, count]) => [key, countValue(count)]),
  )
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => Number.isSafeInteger(item) && item > 0)
    .map((item) => Math.trunc(item))
}

function mapEmailMessageSecurityRecord(record: EmailMessageSecurityRecord) {
  return {
    authSpf: record.authSpf ?? null,
    authDkim: record.authDkim ?? null,
    authDmarc: record.authDmarc ?? null,
    authArc: record.authArc ?? null,
    authDkimDomains: record.authDkimDomains ?? null,
    authError: record.authError ?? null,
    rspamdScore: record.rspamdScore ?? null,
    rspamdAction: record.rspamdAction ?? null,
    rspamdSymbols: record.rspamdSymbols ?? null,
    rspamdError: record.rspamdError ?? null,
    securityCheckedAt: record.securityCheckedAt ?? null,
    spamStatus: record.spamStatus ?? null,
    spamScore: record.spamScore ?? null,
    spamScoreLabel: record.spamScoreLabel ?? null,
    spamDecisionSource: record.spamDecisionSource ?? null,
    spamScoreBreakdownJson: record.spamScoreBreakdownJson === undefined || record.spamScoreBreakdownJson === null
      ? null
      : stringifyJsonValue(record.spamScoreBreakdownJson, null),
    spamDecidedAt: record.spamDecidedAt ?? null,
  }
}

function mapEmailInternalNoteRecord(record: EmailInternalNoteRecord) {
  return {
    id: record.id,
    body: record.body ?? "",
    created_at: record.createdAt ?? record.updatedAt ?? "",
  }
}

function mapEmailCannedResponseRecord(record: EmailCannedResponseRecord) {
  return {
    id: record.id,
    title: record.title ?? "",
    body: record.body ?? "",
  }
}

function mapEmailCannedResponseMutation(value: Record<string, any>): Record<string, unknown> {
  return pruneUndefined({
    title: value.title === undefined || value.title === null ? undefined : String(value.title),
    body: value.body === undefined || value.body === null ? undefined : String(value.body),
    sortOrder: value.sortOrder ?? value.sort_order,
  })
}

function mapEmailTeamMemberRecord(record: EmailTeamMemberRecord) {
  return {
    id: record.id,
    display_name: record.displayName ?? "",
    role: record.role ?? "agent",
    signature_html: record.signatureHtml ?? null,
    sort_order: record.sortOrder ?? 0,
  }
}

function mapEmailTeamMemberMutation(value: Record<string, any>): Record<string, unknown> {
  const signatureHtml = Object.prototype.hasOwnProperty.call(value, "signatureHtml")
    ? value.signatureHtml
    : value.signature_html
  return pruneUndefined({
    displayName: value.displayName ?? value.display_name,
    role: value.role,
    signatureHtml,
    sortOrder: value.sortOrder ?? value.sort_order,
  })
}

function mapAiProfileRecord(record: AiProfileRecord) {
  return {
    id: record.id,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    label: record.label ?? "",
    provider: record.provider ?? "openai",
    baseUrl: record.baseUrl ?? "",
    base_url: record.baseUrl ?? "",
    model: record.model ?? "",
    embeddingModel: record.embeddingModel ?? null,
    embedding_model: record.embeddingModel ?? null,
    isDefault: Boolean(record.isDefault),
    is_default: Boolean(record.isDefault) ? 1 : 0,
    sortOrder: record.sortOrder ?? 0,
    sort_order: record.sortOrder ?? 0,
    hasApiKey: Boolean(record.apiKeyConfigured),
    api_key_configured: Boolean(record.apiKeyConfigured),
    created_at: record.createdAt ?? undefined,
    updated_at: record.updatedAt ?? undefined,
  }
}

function mapAiProfileMutation(value: Record<string, any>): Record<string, unknown> {
  return pruneUndefined({
    label: value.label === undefined || value.label === null ? undefined : String(value.label),
    provider: value.provider === undefined || value.provider === null ? undefined : String(value.provider),
    baseUrl: value.baseUrl ?? value.base_url,
    model: value.model === undefined || value.model === null ? undefined : String(value.model),
    embeddingModel: Object.prototype.hasOwnProperty.call(value, "embeddingModel")
      ? value.embeddingModel
      : value.embedding_model,
    isDefault: value.isDefault ?? value.is_default,
    sortOrder: value.sortOrder ?? value.sort_order,
    apiKey: value.apiKey,
  })
}

function selectDefaultAiProfileRecord(records: readonly AiProfileRecord[]): AiProfileRecord | undefined {
  return records.find((record) => Boolean(record.isDefault)) ?? records[0]
}

function legacyDefaultAiProfileBody(overrides: Record<string, unknown>): Record<string, unknown> {
  const fallback = AI_PROVIDER_PRESETS.openai
  return {
    label: "Standard",
    provider: "custom",
    baseUrl: fallback.baseUrl,
    model: fallback.defaultModel,
    embeddingModel: fallback.defaultEmbeddingModel ?? null,
    isDefault: true,
    sortOrder: 0,
    ...overrides,
  }
}

function mapLegacyAiSettingsPatch(value: Record<string, any>): Record<string, unknown> {
  const hasBaseUrl = Object.prototype.hasOwnProperty.call(value, "baseUrl")
    || Object.prototype.hasOwnProperty.call(value, "base_url")
  return pruneUndefined({
    baseUrl: hasBaseUrl
      ? aiProfileBaseUrlValue(value.baseUrl ?? value.base_url)
      : undefined,
    model: Object.prototype.hasOwnProperty.call(value, "model")
      ? aiProfileModelValue(value.model)
      : undefined,
  })
}

function mapAiPromptRecord(record: AiPromptRecord) {
  return {
    id: record.id,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    label: record.label ?? "",
    user_template: record.userTemplate ?? "",
    userTemplate: record.userTemplate ?? "",
    target: record.target ?? "compose",
    profile_source_sqlite_id: record.profileSourceSqliteId ?? undefined,
    profile_id: record.profileId ?? null,
    profileId: record.profileId ?? null,
    sort_order: record.sortOrder ?? 0,
    sortOrder: record.sortOrder ?? 0,
    created_at: record.createdAt ?? undefined,
    updated_at: record.updatedAt ?? undefined,
  }
}

function mapAiPromptMutation(
  value: Record<string, any>,
  options: { defaultTarget?: string } = {},
): Record<string, unknown> {
  const target = value.target === undefined || value.target === null
    ? options.defaultTarget
    : String(value.target)
  const profileId = Object.prototype.hasOwnProperty.call(value, "profileId")
    ? value.profileId
    : value.profile_id
  return pruneUndefined({
    label: value.label === undefined || value.label === null ? undefined : String(value.label),
    userTemplate: value.userTemplate ?? value.user_template,
    target,
    profileId,
    sortOrder: value.sortOrder ?? value.sort_order,
  })
}

function mapSpamListEntryRecord(record: SpamListEntryRecord) {
  return {
    id: record.id,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    list_type: record.listType ?? "block",
    pattern_type: record.patternType ?? "domain",
    pattern: record.pattern ?? "",
    account_source_sqlite_id: record.accountSourceSqliteId ?? undefined,
    account_id: record.accountId ?? null,
    note: record.note ?? null,
    created_at: record.createdAt ?? undefined,
    updated_at: record.updatedAt ?? undefined,
  }
}

function mapSpamListEntryMutation(value: Record<string, any>): Record<string, unknown> {
  const normalized = normalizeSpamListPattern(value.pattern, value.patternType ?? value.pattern_type)
  const accountId = Object.prototype.hasOwnProperty.call(value, "accountId")
    ? value.accountId
    : value.account_id
  const note = Object.prototype.hasOwnProperty.call(value, "note") ? value.note : undefined
  return pruneUndefined({
    listType: value.listType ?? value.list_type,
    patternType: normalized.patternType,
    pattern: normalized.pattern,
    accountId,
    note,
  })
}

function mapEmailCategoryRecord(record: EmailCategoryRecord) {
  return {
    id: record.id,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    parent_source_sqlite_id: record.parentSourceSqliteId ?? undefined,
    parent_id: record.parentId ?? null,
    name: record.name ?? "",
    sort_order: record.sortOrder ?? 0,
    created_at: record.createdAt ?? undefined,
    updated_at: record.updatedAt ?? undefined,
  }
}

function mapEmailCategoryCountRecord(record: EmailCategoryCountRecord) {
  return {
    categoryId: countValue(record.categoryId),
    count: countValue(record.count),
  }
}

function mapEmailCategoryMutation(value: Record<string, any>): Record<string, unknown> {
  const parentId = Object.prototype.hasOwnProperty.call(value, "parentId")
    ? value.parentId
    : value.parent_id
  return pruneUndefined({
    name: value.name === undefined || value.name === null ? undefined : String(value.name),
    parentId,
    sortOrder: value.sortOrder ?? value.sort_order,
  })
}

function emailCategoryReorderUpdates(
  value: unknown,
): Array<{ id: number; parentId: number | null; sortOrder: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
    throw new Error("Invalid email category reorder updates")
  }
  return value.map((raw) => {
    const update = objectPayload(raw, "email category reorder update")
    const parentId = Object.prototype.hasOwnProperty.call(update, "parentId")
      ? update.parentId
      : update.parent_id
    const sortOrder = typeof update.sortOrder === "number"
      ? update.sortOrder
      : typeof update.sort_order === "number"
        ? update.sort_order
        : NaN
    if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) {
      throw new Error("Invalid email category sort order")
    }
    return {
      id: positiveId(update.id, "email category id"),
      parentId: parentId === null ? null : positiveId(parentId, "email category parent id"),
      sortOrder,
    }
  })
}

function mapEmailCategoryReorderMutation(
  update: { id: number; parentId: number | null; sortOrder: number },
): Record<string, unknown> {
  return {
    id: update.id,
    parentId: update.parentId,
    sortOrder: update.sortOrder,
  }
}

function firstMessageCategoryId(records: EmailMessageCategoryRecord[]): number | null {
  for (const record of records) {
    if (typeof record.categoryId === "number" && Number.isSafeInteger(record.categoryId) && record.categoryId > 0) {
      return record.categoryId
    }
  }
  return null
}

function mapWorkflowRecord(record: WorkflowRecord) {
  const trigger = record.triggerName ?? "inbound"
  return {
    id: record.sourceSqliteId ?? record.id,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    name: record.name ?? "",
    trigger,
    trigger_name: trigger,
    enabled: record.enabled ? 1 : 0,
    priority: record.priority ?? 100,
    definition_json: stringifyJsonValue(record.definition, "{}"),
    graph_json: record.graph === undefined || record.graph === null
      ? null
      : stringifyJsonValue(record.graph, null),
    cron_expr: record.cronExpr ?? null,
    schedule_account_id: record.scheduleAccountSourceSqliteId ?? record.scheduleAccountId ?? null,
    schedule_account_source_sqlite_id: record.scheduleAccountSourceSqliteId ?? undefined,
    execution_mode: record.executionMode ?? "graph",
    engine_version: record.engineVersion ?? 1,
    legacy_created_by_user_id: record.legacyCreatedByUserId ?? null,
    created_by_user_id: record.createdByUserId ?? null,
    created_at: record.createdAt ?? "",
    updated_at: record.updatedAt ?? "",
  }
}

function workflowExportSource(record: WorkflowRecord) {
  const row = mapWorkflowRecord(record)
  return {
    name: row.name,
    trigger: row.trigger,
    priority: row.priority,
    enabled: row.enabled,
    definition_json: row.definition_json ?? "{}",
    graph_json: row.graph_json,
    cron_expr: row.cron_expr,
    schedule_account_id: row.schedule_account_id,
    execution_mode: row.execution_mode,
    engine_version: row.engine_version,
  }
}

function workflowImportMutationBody(value: unknown): Record<string, unknown> {
  const input = objectPayload(value, "workflow import bundle payload")
  const bundle = parseWorkflowImport(stringPayloadField(input.json, "workflow import bundle json"))
  const workflow = bundle.workflow
  const graph = workflow.graph_json ?? null
  const definition = graph
    ? compileGraphToDefinition(graph)
    : parseJsonPayload(workflow.definition_json, "workflow definition")
  return {
    name: `${workflow.name} (Import)`,
    triggerName: workflow.trigger,
    priority: workflow.priority,
    definition,
    graph,
    cronExpr: workflow.cron_expr,
    scheduleAccountId: workflow.schedule_account_id,
    enabled: workflow.enabled,
    executionMode: workflow.execution_mode ?? "graph",
    engineVersion: workflow.engine_version ?? 1,
  }
}

function mapWorkflowVersionRecord(record: WorkflowVersionRecord) {
  return {
    id: record.sourceSqliteId ?? record.id,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    workflow_id: record.workflowSourceSqliteId ?? record.workflowId ?? null,
    workflow_source_sqlite_id: record.workflowSourceSqliteId ?? undefined,
    label: record.label ?? "",
    graph_json: stringifyJsonValue(record.graph, "{}"),
    definition_json: stringifyJsonValue(record.definition, "{}"),
    created_at: record.createdAt ?? "",
    updated_at: record.updatedAt ?? "",
  }
}

function mapWorkflowRunRecord(record: WorkflowRunRecord) {
  return {
    id: record.sourceSqliteId ?? record.id,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    workflow_id: record.workflowSourceSqliteId ?? record.workflowId ?? null,
    workflow_source_sqlite_id: record.workflowSourceSqliteId ?? undefined,
    message_id: record.messageSourceSqliteId ?? record.messageId ?? null,
    message_source_sqlite_id: record.messageSourceSqliteId ?? undefined,
    direction: record.direction ?? "",
    status: record.status ?? "",
    log_json: record.log === undefined || record.log === null ? null : stringifyJsonValue(record.log, null),
    started_at: record.startedAt ?? null,
    finished_at: record.finishedAt ?? null,
    updated_at: record.updatedAt ?? "",
  }
}

async function collectLatestWorkflowRunFromFirstPage(
  body: unknown,
  context: HttpInvocationContext,
  messageId: number,
): Promise<WorkflowRunRecord | null> {
  let page = listResult<WorkflowRunRecord>(body)
  let latest = latestWorkflowRunByServerId(page.items)
  let cursor = page.nextCursor
  while (cursor !== null) {
    const nextBody = await context.fetchJson({
      method: "GET",
      path: `/api/v1/email/messages/${messageId}/workflow-runs`,
      query: { limit: DEFAULT_LIST_LIMIT, cursor },
    })
    page = listResult<WorkflowRunRecord>(nextBody)
    latest = latestWorkflowRunByServerId(page.items, latest)
    cursor = page.nextCursor
  }
  return latest
}

function latestWorkflowRunByServerId(
  records: WorkflowRunRecord[],
  current: WorkflowRunRecord | null = null,
): WorkflowRunRecord | null {
  let latest = current
  for (const record of records) {
    if (!latest || record.id > latest.id) latest = record
  }
  return latest
}

function mapWorkflowRunStepRecord(record: WorkflowRunStepRecord) {
  return {
    id: record.sourceSqliteId ?? record.id,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    run_id: record.runSourceSqliteId ?? record.runId ?? null,
    run_source_sqlite_id: record.runSourceSqliteId ?? undefined,
    node_id: record.nodeId ?? "",
    node_type: record.nodeType ?? "",
    status: record.status ?? "",
    port: record.port ?? null,
    duration_ms: record.durationMs ?? 0,
    message: record.message ?? null,
    created_at: record.createdAt ?? "",
    updated_at: record.updatedAt ?? "",
  }
}

function mapWorkflowKnowledgeBaseRecord(record: WorkflowKnowledgeBaseRecord) {
  return {
    id: record.id,
    name: record.name ?? "",
    description: record.description ?? null,
  }
}

function mapWorkflowKnowledgeBaseMutation(value: Record<string, any>): Record<string, unknown> {
  const description = Object.prototype.hasOwnProperty.call(value, "description")
    ? value.description
    : undefined
  return pruneUndefined({
    name: stringPayloadField(value.name, "workflow knowledge base name"),
    description: description === undefined || description === null ? description : String(description),
  })
}

async function fetchWorkflowKnowledgeChunks(
  context: HttpInvocationContext,
  knowledgeBaseId: number,
  includeContent: boolean,
): Promise<WorkflowKnowledgeChunkRecord[]> {
  const body = await context.fetchJson({
    method: "GET",
    path: "/api/v1/workflow-knowledge-chunks",
    query: {
      knowledgeBaseId,
      includeContent,
      limit: DEFAULT_LIST_LIMIT,
    },
  })
  return collectWorkflowKnowledgeChunksFromFirstPage(body, context, knowledgeBaseId, includeContent)
}

async function collectWorkflowKnowledgeChunksFromFirstPage(
  firstPageBody: unknown,
  context: HttpInvocationContext,
  knowledgeBaseId: number,
  includeContent: boolean,
): Promise<WorkflowKnowledgeChunkRecord[]> {
  const chunks: WorkflowKnowledgeChunkRecord[] = []
  const seenCursors = new Set<number>()
  let page = listResult<WorkflowKnowledgeChunkRecord>(firstPageBody)
  for (;;) {
    chunks.push(...page.items)
    const cursor = page.nextCursor ?? null
    if (cursor === null) return chunks
    if (seenCursors.has(cursor)) throw new Error("Invalid workflow knowledge chunk cursor")
    seenCursors.add(cursor)
    const body = await context.fetchJson({
      method: "GET",
      path: "/api/v1/workflow-knowledge-chunks",
      query: {
        knowledgeBaseId,
        includeContent,
        limit: DEFAULT_LIST_LIMIT,
        cursor,
      },
    })
    page = listResult<WorkflowKnowledgeChunkRecord>(body)
  }
}

function mergeKnowledgeChunksToMarkdown(
  knowledgeBase: WorkflowKnowledgeBaseRecord,
  chunks: WorkflowKnowledgeChunkRecord[],
): string {
  if (chunks.length === 0) return defaultKnowledgeMarkdown(knowledgeBase.name ?? "Wissensbasis")
  return chunks
    .map((chunk) => {
      const title = chunk.title?.trim()
      const content = chunk.content ?? ""
      if (title && title !== "Dokument") return `## ${title}\n\n${content}`
      return content
    })
    .join("\n\n---\n\n")
}

function defaultKnowledgeMarkdown(name: string): string {
  return `# ${name.trim() || "Wissensbasis"}\n\nHier steht der Wissenstext für diesen Bereich (Markdown).\n`
}

function knowledgeDocumentFileName(record: WorkflowKnowledgeBaseRecord): string {
  const slug = (record.name ?? "wissensbasis")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
  return `${record.id}-${slug || "wissensbasis"}.md`
}

function knowledgeMarkdownContent(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid workflow knowledge document content")
  if (!value.trim()) throw new Error("Invalid workflow knowledge document content")
  if (value.length > 100000) throw new Error("Invalid workflow knowledge document content")
  return value
}

function normalizeKnowledgeMarkdownContent(content: string): string {
  return `${content.trimEnd()}\n`
}

function mapPgpIdentityRecord(record: PgpIdentityRecord) {
  return {
    id: record.sourceSqliteId ?? record.id,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    email: record.email ?? "",
    fingerprint: record.fingerprint ?? "",
    public_key_armor: record.publicKeyArmor ?? "",
    has_private_key: record.hasPrivateKey ? 1 : 0,
    private_key_configured: record.privateKeyConfigured ? 1 : 0,
    is_primary: record.isPrimary ? 1 : 0,
    expires_at: record.expiresAt ?? null,
    created_at: record.createdAt ?? "",
    updated_at: record.updatedAt ?? "",
  }
}

function mapPgpPeerKeyRecord(record: PgpPeerKeyRecord) {
  return {
    id: record.sourceSqliteId ?? record.id,
    source_sqlite_id: record.sourceSqliteId ?? undefined,
    email: record.email ?? "",
    fingerprint: record.fingerprint ?? "",
    public_key_armor: record.publicKeyArmor ?? "",
    source: record.source ?? "import",
    verified_at: record.verifiedAt ?? null,
    verified_by_user_id: record.verifiedByUserId ?? record.legacyVerifiedByUserId ?? null,
    legacy_verified_by_user_id: record.legacyVerifiedByUserId ?? null,
    trust_level: record.trustLevel ?? "unknown",
    created_at: record.createdAt ?? "",
    updated_at: record.updatedAt ?? "",
  }
}

function mapPgpRecipientKeyStatusRecord(record: PgpRecipientKeyStatusRecord) {
  return {
    email: record.email ?? "",
    hasKey: Boolean(record.hasKey),
    ...(record.fingerprint ? { fingerprint: record.fingerprint } : {}),
  }
}

function mapWorkflowMutation(
  value: unknown,
  options: { requireDefinition: boolean },
): Record<string, unknown> {
  const input = objectPayload(value ?? {}, "workflow payload")
  const definition = Object.prototype.hasOwnProperty.call(input, "definitionJson")
    ? parseJsonPayload(input.definitionJson, "workflow definition")
    : Object.prototype.hasOwnProperty.call(input, "definition")
      ? input.definition
      : undefined
  const graph = Object.prototype.hasOwnProperty.call(input, "graphJson")
    ? parseNullableJsonPayload(input.graphJson, "workflow graph")
    : Object.prototype.hasOwnProperty.call(input, "graph")
      ? input.graph
      : undefined
  if (options.requireDefinition && definition === undefined) {
    throw new Error("Invalid workflow definition")
  }
  return pruneUndefined({
    name: input.name,
    triggerName: input.triggerName ?? input.trigger,
    priority: input.priority,
    definition,
    graph,
    cronExpr: input.cronExpr,
    scheduleAccountId: input.scheduleAccountId,
    enabled: input.enabled,
    executionMode: input.executionMode,
    engineVersion: input.engineVersion,
  })
}

function mapSavedViewRecord(record: SavedViewRecord) {
  return {
    id: record.id,
    name: record.name ?? "",
    filters: record.filters ?? "{}",
    display_order: record.displayOrder ?? 0,
    created_at: record.createdAt ?? undefined,
    updated_at: record.updatedAt ?? undefined,
  }
}

function mapFollowUpQueueCounts(record: FollowUpQueueCountsRecord) {
  return {
    heute: Number(record.heute ?? 0),
    ueberfaellig: Number(record.ueberfaellig ?? 0),
    dieseWoche: Number(record.dieseWoche ?? 0),
    zurueckgestellt: Number(record.zurueckgestellt ?? 0),
    stagnierend: Number(record.stagnierend ?? 0),
    highValueRisk: Number(record.highValueRisk ?? 0),
  }
}

function mapFollowUpItem(record: FollowUpItemRecord) {
  const itemId = record.itemId ?? record.item_id ?? 0
  const sourceType = record.sourceType ?? record.source_type ?? "task"
  const customerId = record.customerId ?? record.customer_id ?? null
  const dealId = record.dealId ?? record.deal_id
  const dealValue = record.dealValue ?? record.deal_value

  return {
    item_id: Number(itemId),
    source_type: sourceType,
    customer_id: customerId === null ? 0 : Number(customerId),
    customer_name: record.customerName ?? record.customer_name ?? "",
    ...(dealId === undefined || dealId === null ? {} : { deal_id: Number(dealId) }),
    deal_name: record.dealName ?? record.deal_name ?? undefined,
    deal_value: dealValue === undefined || dealValue === null ? undefined : Number(dealValue),
    deal_stage: record.dealStage ?? record.deal_stage ?? undefined,
    title: record.title ?? "",
    reason: record.reason ?? "",
    due_date: record.dueDate ?? record.due_date ?? undefined,
    priority: record.priority ?? "Medium",
    priority_score: Number(record.priorityScore ?? record.priority_score ?? 0),
    last_contact_date: record.lastContactDate ?? record.last_contact_date ?? undefined,
    snoozed_until: record.snoozedUntil ?? record.snoozed_until ?? undefined,
    completed: Boolean(record.completed),
  }
}

function positiveId(value: unknown, label: string): number {
  const id = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid ${label}`)
  }
  return id
}

function nonNegativeInteger(value: unknown, label: string): number {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error(`Invalid ${label}`)
  }
  return numberValue
}

function nonZeroPathId(value: unknown, label: string): number {
  const id = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  if (!Number.isSafeInteger(id) || id === 0) {
    throw new Error(`Invalid ${label}`)
  }
  return id
}

function pathTextSegment(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`Invalid ${label}`)
  const text = value.trim()
  if (!text || text.length > maxLength) throw new Error(`Invalid ${label}`)
  return encodeURIComponent(text)
}

function optionalTextQueryValue(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = String(value).trim()
  if (!text) return undefined
  if (text.length > maxLength) throw new Error(`Invalid ${label}`)
  return text
}

function limitValue(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_LIST_LIMIT
  const limit = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(limit) || limit <= 0) return DEFAULT_LIST_LIMIT
  return Math.min(limit, DEFAULT_LIST_LIMIT)
}

function clientListLimitValue(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_LIST_LIMIT
  const limit = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(limit) || limit <= 0) return DEFAULT_LIST_LIMIT
  return Math.min(limit, 500)
}

function bulkMessageIdLimitValue(value: unknown): number {
  if (value === undefined || value === null) return 500
  const limit = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(limit) || limit <= 0) return 500
  return Math.min(limit, 500)
}

function offsetValue(value: unknown): number {
  if (value === undefined || value === null) return 0
  const offset = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(offset) || offset < 0) return 0
  return offset
}

function accountScopeQueryValue(value: unknown): number | undefined {
  if (value === "all" || value === undefined || value === null) return undefined
  return positiveId(value, "email account id")
}

function optionalPositiveQueryId(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  return positiveId(value, label)
}

function messageViewValue(value: unknown): "inbox" | "sent" | "archived" | "drafts" | "spam_review" | "spam" | "trash" | "snoozed" | "all" {
  const view = optionalMessageViewValue(value)
  if (!view) throw new Error("Invalid email message view")
  return view
}

function optionalMessageViewValue(value: unknown): "inbox" | "sent" | "archived" | "drafts" | "spam_review" | "spam" | "trash" | "snoozed" | "all" | undefined {
  if (value === undefined || value === null) return undefined
  if (
    value === "inbox"
    || value === "sent"
    || value === "archived"
    || value === "drafts"
    || value === "spam_review"
    || value === "spam"
    || value === "trash"
    || value === "snoozed"
    || value === "all"
  ) return value
  throw new Error("Invalid email message view")
}

function optionalMessageSortValue(value: unknown): "date_desc" | "date_asc" | "priority" | undefined {
  if (value === undefined || value === null) return undefined
  if (value === "date_desc" || value === "date_asc" || value === "priority") return value
  throw new Error("Invalid email message sort")
}

function optionalMessageListFilterValue(value: unknown): "all" | "unread" | "attachment" | "customer" | "workflow" | undefined {
  if (value === undefined || value === null) return undefined
  if (value === "all" || value === "unread" || value === "attachment" || value === "customer" || value === "workflow") return value
  throw new Error("Invalid email message list filter")
}

function optionalMessageDoneFilterValue(value: unknown): "all" | "open" | "done" | undefined {
  if (value === undefined || value === null) return undefined
  if (value === "all" || value === "open" || value === "done") return value
  throw new Error("Invalid email message done filter")
}

function optionalConversationLockReason(value: unknown): "reply" | "forward" | "edit" | undefined {
  if (value === undefined || value === null) return undefined
  if (value === "reply" || value === "forward" || value === "edit") return value
  throw new Error("Invalid conversation lock reason")
}

function dashboardLimitValue(value: unknown): number {
  if (value === undefined || value === null) return 5
  const limit = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(limit) || limit <= 0) return 5
  return Math.min(limit, 25)
}

function objectPayload(value: unknown, label: string): Record<string, any> {
  if (!isRecord(value)) {
    if (value === undefined) return {}
    throw new Error(`Invalid ${label}`)
  }
  return value as Record<string, any>
}

function arrayPayloadField(value: unknown, label: string, maxLength: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`Invalid ${label}`)
  return value
}

function pruneUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function pruneQueryUndefined(
  input: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean | null | undefined> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function stringifyOptions(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return typeof value === "string" ? value : JSON.stringify(value)
}

function stringifyJsonValue(value: unknown, fallback: string | null): string | null {
  if (value === undefined || value === null) return fallback
  return typeof value === "string" ? value : JSON.stringify(value)
}

function addressJsonString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === "string") return value
  return JSON.stringify(Array.isArray(value) ? { value } : value)
}

function parseOptions(value: unknown): unknown {
  if (typeof value !== "string") return value
  if (!value.trim()) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function parseJsonPayload(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value
  if (!value.trim()) throw new Error(`Invalid ${label}`)
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`Invalid ${label}`)
  }
}

function parseNullableJsonPayload(value: unknown, label: string): unknown {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === "string" && !value.trim()) return null
  return parseJsonPayload(value, label)
}

function normalizeDealDateInput(value: unknown): unknown {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  const germanDate = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed)
  if (!germanDate) return value
  return `${germanDate[3]}-${germanDate[2]}-${germanDate[1]}`
}

function messageTagValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid email message tag")
  const tag = value.trim()
  if (!tag || tag.length > 200) throw new Error("Invalid email message tag")
  return tag
}

function messageSearchQueryValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid email message search query")
  const query = value.trim()
  if (!query || query.length > 200) throw new Error("Invalid email message search query")
  return query
}

function spamStatusValue(value: unknown): "clean" | "review" | "spam" {
  if (value === "clean" || value === "review" || value === "spam") return value
  throw new Error("Invalid email message spam status")
}

function readReceiptResponseAction(value: unknown): "send" | "decline" {
  if (value === "send" || value === "decline") return value
  throw new Error("Invalid email read receipt response action")
}

function mapEmailMiscSettingsPayload(value: unknown): Record<string, unknown> {
  const input = objectPayload(value, "email misc settings payload")
  return pruneUndefined({
    webhookSecret: input.webhookSecret === undefined ? undefined : optionalTrimmedText(input.webhookSecret, "email webhook secret", 2000),
    maxAttachmentMb: input.maxAttachmentMb === undefined ? undefined : positiveId(input.maxAttachmentMb, "email max attachment mb"),
  })
}

function mapMssqlSettingsPayload(value: unknown): Record<string, unknown> {
  const input = objectPayload(value, "mssql settings payload")
  return pruneUndefined({
    server: input.server,
    database: input.database,
    user: input.user,
    password: Object.prototype.hasOwnProperty.call(input, "password") ? input.password : undefined,
    port: input.port,
    encrypt: input.encrypt,
    trustServerCertificate: input.trustServerCertificate,
    forcePort: input.forcePort,
    kBenutzer: input.kBenutzer,
    kShop: input.kShop,
    kPlattform: input.kPlattform,
    kSprache: input.kSprache,
    cWaehrung: input.cWaehrung,
    fWaehrungFaktor: input.fWaehrungFaktor,
    hasPassword: input.hasPassword,
  })
}

function mapWorkflowAutomationSettingsPayload(value: unknown): Record<string, unknown> {
  const input = objectPayload(value, "workflow automation settings payload")
  return pruneUndefined({
    imapDeleteOptIn: optionalBoolean(input.imapDeleteOptIn, "workflow imap delete opt-in"),
    httpAllowlist: input.httpAllowlist === undefined ? undefined : optionalTrimmedText(input.httpAllowlist, "workflow http allowlist", 10000),
    senderWhitelist: input.senderWhitelist === undefined ? undefined : optionalTrimmedText(input.senderWhitelist, "workflow sender whitelist", 10000),
    senderBlacklist: input.senderBlacklist === undefined ? undefined : optionalTrimmedText(input.senderBlacklist, "workflow sender blacklist", 10000),
    spamScoreThreshold: input.spamScoreThreshold === undefined ? undefined : boundedNumberText(input.spamScoreThreshold, "workflow spam score threshold", 1, 100, true),
  })
}

function mapMailSecuritySettingsPayload(value: unknown): Record<string, unknown> {
  const input = objectPayload(value, "email mail security settings payload")
  return pruneUndefined({
    mailauthEnabled: optionalBoolean(input.mailauthEnabled, "mailauth enabled flag"),
    rspamdEnabled: optionalBoolean(input.rspamdEnabled, "rspamd enabled flag"),
    rspamdUrl: input.rspamdUrl === undefined ? undefined : optionalTrimmedUrl(input.rspamdUrl, "rspamd url", 500, "http://127.0.0.1:11333"),
    rspamdTimeoutMs: input.rspamdTimeoutMs === undefined ? undefined : boundedNumber(input.rspamdTimeoutMs, "rspamd timeout", 1000, 60000, true),
    rspamdSpamScore: input.rspamdSpamScore === undefined ? undefined : boundedNumber(input.rspamdSpamScore, "rspamd spam score", 1, 100, false),
    autoSpamDmarcFail: optionalBoolean(input.autoSpamDmarcFail, "auto spam dmarc fail flag"),
    autoSpamSpfFail: optionalBoolean(input.autoSpamSpfFail, "auto spam spf fail flag"),
    autoSpamRspamd: optionalBoolean(input.autoSpamRspamd, "auto spam rspamd flag"),
    senderWhitelist: input.senderWhitelist === undefined ? undefined : optionalTrimmedText(input.senderWhitelist, "sender whitelist", 10000),
    senderBlacklist: input.senderBlacklist === undefined ? undefined : optionalTrimmedText(input.senderBlacklist, "sender blacklist", 10000),
    spamScoreThreshold: input.spamScoreThreshold === undefined ? undefined : boundedNumber(input.spamScoreThreshold, "spam score threshold", 1, 100, true),
    spamEngineEnabled: optionalBoolean(input.spamEngineEnabled, "spam engine enabled flag"),
    spamReviewThreshold: input.spamReviewThreshold === undefined ? undefined : boundedNumber(input.spamReviewThreshold, "spam review threshold", 0, 100, true),
    spamSpamThreshold: input.spamSpamThreshold === undefined ? undefined : boundedNumber(input.spamSpamThreshold, "spam spam threshold", 0, 100, true),
    localLearningEnabled: optionalBoolean(input.localLearningEnabled, "local learning enabled flag"),
    rspamdContributionEnabled: optionalBoolean(input.rspamdContributionEnabled, "rspamd contribution enabled flag"),
    rspamdLearningEnabled: optionalBoolean(input.rspamdLearningEnabled, "rspamd learning enabled flag"),
    aiSpamWorkflowEnabled: optionalBoolean(input.aiSpamWorkflowEnabled, "ai spam workflow enabled flag"),
  })
}

function mapRspamdConnectionTestPayload(value: unknown): Record<string, unknown> {
  const input = objectPayload(value, "rspamd connection test payload")
  return pruneUndefined({
    rspamdUrl: input.rspamdUrl === undefined ? undefined : optionalTrimmedUrl(input.rspamdUrl, "rspamd url", 500, "http://127.0.0.1:11333"),
    rspamdTimeoutMs: input.rspamdTimeoutMs === undefined ? undefined : boundedNumber(input.rspamdTimeoutMs, "rspamd timeout", 1000, 60000, true),
  })
}

function mapSnoozeSettingsPayload(value: unknown): Record<string, unknown> {
  const input = objectPayload(value, "email snooze settings payload")
  return {
    eveningHour: boundedNumber(input.eveningHour, "snooze evening hour", 0, 23, true),
    eveningMinute: boundedNumber(input.eveningMinute, "snooze evening minute", 0, 59, true),
    morningHour: boundedNumber(input.morningHour, "snooze morning hour", 0, 23, true),
    morningMinute: boundedNumber(input.morningMinute, "snooze morning minute", 0, 59, true),
    nextWeekWeekday: boundedNumber(input.nextWeekWeekday, "snooze next week weekday", 0, 6, true),
    nextWeekHour: boundedNumber(input.nextWeekHour, "snooze next week hour", 0, 23, true),
    nextWeekMinute: boundedNumber(input.nextWeekMinute, "snooze next week minute", 0, 59, true),
  }
}

function mapReplySuggestionSettingsPayload(value: unknown): Record<string, unknown> {
  const input = objectPayload(value, "email reply suggestion settings payload")
  return pruneUndefined({
    accountId: input.accountId === undefined ? undefined : positiveId(input.accountId, "email account id"),
    autoEnabled: optionalBoolean(input.autoEnabled, "reply suggestion auto enabled flag"),
    triggerOnInbound: optionalBoolean(input.triggerOnInbound, "reply suggestion inbound trigger flag"),
    triggerOnOpen: optionalBoolean(input.triggerOnOpen, "reply suggestion open trigger flag"),
    categoryMode: input.categoryMode === undefined ? undefined : replySuggestionCategoryMode(input.categoryMode),
    categoryIds: input.categoryIds === undefined ? undefined : positiveIdArray(input.categoryIds, "reply suggestion category id", 500),
  })
}

function replySuggestionTrigger(value: unknown): "inbound" | "open" {
  if (value === "inbound" || value === "open") return value
  throw new Error("Invalid reply suggestion trigger")
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === "boolean") return value
  throw new Error(`Invalid ${label}`)
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value
  throw new Error(`Invalid ${label}`)
}

function messageIdArray(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Invalid email message ids")
  const ids: number[] = []
  for (const item of value) {
    const id = positiveId(item, "email message id")
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

function positiveIdArray(value: unknown, label: string, maxLength: number): number[] {
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`Invalid ${label}s`)
  const ids: number[] = []
  for (const item of value) {
    const id = positiveId(item, label)
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

function replySuggestionCategoryMode(value: unknown): "any" | "only_listed" {
  if (value === "any" || value === "only_listed") return value
  throw new Error("Invalid reply suggestion category mode")
}

function internalNoteBodyValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid email internal note body")
  const body = value.trim()
  if (!body || body.length > 10000) throw new Error("Invalid email internal note body")
  return body
}

function stringPayloadField(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Invalid ${label}`)
  const text = value.trim()
  if (!text) throw new Error(`Invalid ${label}`)
  return text
}

function secretPayloadField(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength || !value.trim()) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function literalTextPayloadField(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength || !value.trim()) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function stringArrayPayloadField(value: unknown, label: string, maxLength: number, itemMaxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`Invalid ${label}s`)
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== "string") throw new Error(`Invalid ${label}`)
    const text = item.trim()
    if (!text || text.length > itemMaxLength) throw new Error(`Invalid ${label}`)
    if (!items.includes(text)) items.push(text)
  }
  if (items.length === 0) throw new Error(`Invalid ${label}s`)
  return items
}

function pgpMessageAttachmentPayloads(value: unknown): Array<{ filename: string; contentBase64: string; contentType?: string }> | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length > 20) throw new Error("Invalid pgp attachments")
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Invalid pgp attachment ${index}`)
    const filename = stringPayloadField(item.filename, "pgp attachment filename")
    if (filename.length > 260) throw new Error("Invalid pgp attachment filename")
    const contentBase64 = literalTextPayloadField(item.contentBase64, "pgp attachment content", 70_000_000)
    const contentType = optionalStringPayloadField(item.contentType, "pgp attachment content type", 200)
    return pruneUndefined({ filename, contentBase64, contentType }) as {
      filename: string
      contentBase64: string
      contentType?: string
    }
  })
}

function optionalStringPayloadField(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string") throw new Error(`Invalid ${label}`)
  const text = value.trim()
  if (text.length > maxLength) throw new Error(`Invalid ${label}`)
  return text || undefined
}

function positiveNumberPayloadField(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Invalid ${label}`)
  return number
}

function nonNegativeNumberPayloadField(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label}`)
  return number
}

function composeTextValue(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`Invalid ${label}`)
  return value
}

function draftAttachmentPathArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error("Invalid draft attachment paths")
  const paths: string[] = []
  for (const item of value) {
    if (typeof item !== "string") throw new Error("Invalid draft attachment path")
    const path = item.trim()
    if (!path) continue
    if (path.length > 4000) throw new Error("Invalid draft attachment path")
    if (!paths.includes(path)) paths.push(path)
  }
  return paths
}

function optionalTrimmedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`Invalid ${label}`)
  const text = value.trim()
  if (text.length > maxLength) throw new Error(`Invalid ${label}`)
  return text
}

function nullableTrimmedText(value: unknown, label: string, maxLength: number): string | null {
  if (value === null) return null
  if (typeof value !== "string") throw new Error(`Invalid ${label}`)
  const text = value.trim()
  if (!text) return null
  if (text.length > maxLength) throw new Error(`Invalid ${label}`)
  return text
}

function nullablePositiveId(value: unknown, label: string): number | null {
  if (value === null || value === "") return null
  return positiveId(value, label)
}

function passwordValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 10000) throw new Error(`Invalid ${label}`)
  return value
}

function accountProtocol(value: unknown): "imap" | "pop3" {
  if (value === "imap" || value === "pop3") return value
  throw new Error("Invalid email account protocol")
}

function remoteContentPolicyValue(value: unknown): "blocked" | "allowed_once" | "allowed_sender" | "allowed_domain" {
  if (value === "blocked" || value === "allowed_once" || value === "allowed_sender" || value === "allowed_domain") {
    return value
  }
  throw new Error("Invalid remote content policy")
}

function optionalTrimmedUrl(value: unknown, label: string, maxLength: number, fallback: string): string {
  const text = optionalTrimmedText(value, label, maxLength).replace(/\/$/, "")
  return text || fallback
}

function boundedNumber(value: unknown, label: string, min: number, max: number, integer: boolean): number {
  const raw = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(raw)) throw new Error(`Invalid ${label}`)
  return Math.max(min, Math.min(max, integer ? Math.floor(raw) : raw))
}

function boundedNumberText(value: unknown, label: string, min: number, max: number, integer: boolean): string {
  return String(boundedNumber(value, label, min, max, integer))
}

function accountSignatureHtmlValue(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== "string") throw new Error("Invalid email account signature html")
  const html = value.trim()
  if (!html) return null
  if (html.length > 20000) throw new Error("Invalid email account signature html")
  return html
}

function aiProfileApiKeyValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid email ai profile api key")
  const apiKey = value.trim()
  if (!apiKey || apiKey.length > 20000) throw new Error("Invalid email ai profile api key")
  return apiKey
}

function aiProfileBaseUrlValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid email ai profile base url")
  const text = value.trim()
  if (!text || text.length > 2048) throw new Error("Invalid email ai profile base url")
  try {
    const url = new URL(text)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Invalid email ai profile base url")
    }
    return url.toString().replace(/\/$/, "")
  } catch {
    throw new Error("Invalid email ai profile base url")
  }
}

function aiProfileModelValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid email ai profile model")
  const model = value.trim()
  if (!model || model.length > 200) throw new Error("Invalid email ai profile model")
  return model
}

function normalizeSpamListPattern(
  rawPattern: unknown,
  rawPatternType: unknown,
): { pattern: string; patternType: "email" | "domain" } {
  if (typeof rawPattern !== "string") throw new Error("Invalid email spam list entry pattern")
  const trimmed = rawPattern.trim().toLowerCase()
  if (!trimmed) throw new Error("Invalid email spam list entry pattern")
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed
  const patternType = rawPatternType === "email" || rawPatternType === "domain"
    ? rawPatternType
    : withoutAt.includes("@")
      ? "email"
      : "domain"
  const pattern = patternType === "email"
    ? withoutAt
    : withoutAt.replace(/^\.+|\.+$/g, "")
  if (!pattern) throw new Error("Invalid email spam list entry pattern")
  return { pattern, patternType }
}

function contentDispositionFileName(header: string | null): string {
  const fallback = `simplecrm-email-export-${new Date().toISOString().slice(0, 10)}.zip`
  if (!header) return fallback
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1])
    } catch {
      return fallback
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] || fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
