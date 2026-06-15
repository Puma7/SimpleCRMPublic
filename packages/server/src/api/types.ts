import type { WorkflowNodeCatalogEntry, WorkflowTemplate } from '@simplecrm/core';
import type { Readable } from 'node:stream';

import type { EnqueueJobInput, WorkflowExecutionDryRunResult, WorkflowExecutionJobPlan } from '../jobs';
import type { ConversationLockReason } from '../locks';
import type { MssqlSettingsInput, MssqlSettingsPort } from '../mssql-settings';
import type { JtlOrderLookupApiPort } from '../jtl-order-lookup';
import type { LoginPenalty } from '../auth';
import type { ServerMaintenancePort } from '../maintenance/service';

export type ServerMaintenanceApiPort = ServerMaintenancePort;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type AuthenticatedPrincipal = {
  userId: string;
  workspaceId: string;
  role: 'owner' | 'admin' | 'user';
  sessionId?: string;
  automationApiKeyId?: string;
  automationScopes?: readonly string[];
};

export type ApiRequest = {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string | undefined>;
  ip?: string;
  principal?: AuthenticatedPrincipal;
};

export type ApiResponse<T = unknown> = {
  status: number;
  body: T;
  headers?: Record<string, string>;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiDataBody<T> = {
  data: T;
};

export type AuthUserRecord = {
  id: string;
  workspaceId: string;
  email: string;
  displayName: string;
  role: AuthenticatedPrincipal['role'];
  passwordHash: string;
  disabledAt?: string | null;
  loginPinHash?: string | null;
  loginPinEnabled?: boolean;
  mfaEnabled?: boolean;
  mfaMethod?: 'totp' | 'email' | null;
  mfaTotpSecretId?: string | null;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
};

export type AuthSetupState = {
  needsInitialSetup: boolean;
};

export type InitialOwnerInput = {
  email: string;
  password: string;
  displayName: string;
  workspaceName: string;
  device?: string;
};

export type InitialOwnerCreateResult =
  | { ok: true; user: AuthUserRecord; tokens: TokenPair }
  | { ok: false; code: 'already_configured' };

export type AuthUserAdminRecord = {
  id: string;
  email: string;
  displayName: string;
  role: AuthenticatedPrincipal['role'];
  disabledAt: string | null;
  loginPinEnabled: boolean;
  mfaEnabled: boolean;
  mfaMethod: 'totp' | 'email' | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AuthInvitationRecord = {
  id: string;
  email: string;
  displayName: string;
  role: AuthenticatedPrincipal['role'];
  invitedByUserId: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedUserId?: string | null;
  revokedAt: string | null;
  createdAt?: string | null;
};

export type AuthUserSaveInput = {
  workspaceId: string;
  actorUserId: string;
  id?: string;
  email: string;
  displayName: string;
  role: AuthenticatedPrincipal['role'];
  password?: string;
  isActive?: boolean;
  loginPin?: string | null;
  mfaMethod?: 'totp' | 'email' | null;
  disableMfa?: boolean;
};

export type AuthUserSaveResult =
  | { ok: true; user: AuthUserAdminRecord }
  | { ok: false; code: 'not_found' | 'duplicate_email' | 'password_required' | 'last_owner_required' };

export type AuthInvitationCreateInput = {
  workspaceId: string;
  actorUserId: string;
  email: string;
  displayName: string;
  role: AuthenticatedPrincipal['role'];
  expiresInDays?: number;
};

export type AuthInvitationCreateResult =
  | { ok: true; invitation: AuthInvitationRecord; token: string }
  | { ok: false; code: 'duplicate_email' | 'duplicate_invitation' };

export type AuthInvitationLookupResult =
  | { ok: true; invitation: AuthInvitationRecord }
  | { ok: false; code: 'invalid_token' | 'expired' | 'accepted' | 'revoked' };

export type AuthInvitationAcceptInput = {
  token: string;
  password: string;
  device?: string;
};

export type AuthInvitationAcceptResult =
  | { ok: true; user: AuthUserRecord; tokens: TokenPair }
  | { ok: false; code: 'invalid_token' | 'expired' | 'accepted' | 'revoked' | 'duplicate_email' };

export type AuthInvitationDeliveryStatus =
  | { status: 'sent'; recipient: string; sentAt: string }
  | { status: 'not_configured' }
  | { status: 'failed'; error: 'smtp_send_failed' };

export type AuthInvitationMailInput = {
  workspaceId: string;
  actorUserId: string;
  invitation: AuthInvitationRecord;
  acceptPath: string;
};

export type AuthInvitationMailerApiPort = Readonly<{
  sendInvitation(input: AuthInvitationMailInput): Promise<AuthInvitationDeliveryStatus>;
}>;

export type AuthSecurityWorkspaceSettings = {
  captchaEnabled: boolean;
  pinKeypadEnabled: boolean;
  mfaEnabled: boolean;
  mfaTotpEnabled: boolean;
  mfaEmailEnabled: boolean;
};

export type LoginSecurityApiPort = Readonly<{
  getWorkspaceSettings(workspaceId: string): Promise<AuthSecurityWorkspaceSettings>;
  setWorkspaceSettings(
    workspaceId: string,
    settings: AuthSecurityWorkspaceSettings,
  ): Promise<AuthSecurityWorkspaceSettings>;
  getLoginConfig(email?: string): Promise<{
    captcha: { enabled: boolean; provider: 'turnstile' | null; siteKey: string | null };
    pinKeypad: { enabled: boolean };
    mfa: { enabled: boolean; methods: readonly ('totp' | 'email')[] };
    user: {
      pinRequired: boolean;
      mfaRequired: boolean;
      mfaMethod: 'totp' | 'email' | null;
    } | null;
  }>;
  verifyCaptcha(input: { token: string; ip: string }): Promise<
    | { ok: true; challenge: string }
    | { ok: false; code: string }
  >;
  assertCaptchaChallenge(input: { challenge: string | undefined; ip: string }): boolean;
  assertLoginPin(input: {
    user: AuthUserRecord;
    workspaceSettings: AuthSecurityWorkspaceSettings;
    pin: string | undefined;
  }): Promise<boolean>;
  beginMfaIfRequired(input: {
    user: AuthUserRecord;
    workspaceSettings: AuthSecurityWorkspaceSettings;
    device?: string;
  }): Promise<
    | { kind: 'complete' }
    | { kind: 'mfa_required'; mfaChallengeToken: string; mfaMethod: 'totp' | 'email' }
    | { kind: 'mfa_delivery_failed' }
  >;
  completeMfaLogin(input: {
    mfaChallengeToken: string;
    code: string;
    device?: string;
    ip?: string;
  }): Promise<
    | { ok: true; user: AuthUserRecord; tokens: TokenPair }
    | { ok: false; code: string }
  >;
  setUserPin(input: { workspaceId: string; userId: string; pin: string | null }): Promise<void>;
  beginTotpSetup(input: {
    workspaceId: string;
    userId: string;
    email: string;
  }): Promise<{ secret: string; otpauthUri: string }>;
  confirmTotpSetup(input: {
    workspaceId: string;
    userId: string;
    secret: string;
    code: string;
  }): Promise<boolean>;
  enableEmailMfa(input: { workspaceId: string; userId: string }): Promise<void>;
  disableUserMfa(input: { workspaceId: string; userId: string }): Promise<void>;
}>;

export type AuthApiPort = {
  getInitialSetupState?(): Promise<AuthSetupState>;
  createInitialOwner?(input: InitialOwnerInput): Promise<InitialOwnerCreateResult>;
  listUsers?(input: { workspaceId: string }): Promise<readonly AuthUserAdminRecord[]>;
  saveUser?(input: AuthUserSaveInput): Promise<AuthUserSaveResult>;
  createInvitation?(input: AuthInvitationCreateInput): Promise<AuthInvitationCreateResult>;
  getInvitationByToken?(input: { token: string }): Promise<AuthInvitationLookupResult>;
  acceptInvitation?(input: AuthInvitationAcceptInput): Promise<AuthInvitationAcceptResult>;
  checkLoginLock?(input: {
    email: string;
    ip: string;
  }): Promise<LoginPenalty | null>;
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
  recordFailedLogin(input: {
    email: string;
    ip: string;
    userId?: string;
  }): Promise<number>;
  recordSuccessfulLogin(input: {
    userId: string;
    email: string;
    ip: string;
  }): Promise<void>;
  issueTokenPair(input: {
    user: AuthUserRecord;
    device?: string;
  }): Promise<TokenPair>;
  rotateRefreshToken(input: {
    refreshToken: string;
  }): Promise<{ user: AuthUserRecord; tokens: TokenPair } | null>;
  revokeRefreshToken(input: {
    refreshToken: string;
    principal?: AuthenticatedPrincipal;
  }): Promise<boolean>;
  resolveAccessTokenPrincipal?(input: {
    principal: AuthenticatedPrincipal;
  }): Promise<AuthenticatedPrincipal | null>;
};

export type ConversationLockRecord = {
  messageId: number;
  userId: string;
  workspaceId: string;
  acquiredAt: string;
  lastHeartbeatAt: string;
  reason: ConversationLockReason;
  takeoverCount: number;
  displayName?: string;
  email?: string;
};

export type ServerEventType =
  | 'conversation_lock.acquired'
  | 'conversation_lock.heartbeat'
  | 'conversation_lock.released'
  | 'conversation_lock.force_takeover'
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  | 'product.created'
  | 'product.updated'
  | 'product.deleted'
  | 'deal.created'
  | 'deal.updated'
  | 'deal.deleted'
  | 'deal_product.created'
  | 'deal_product.updated'
  | 'deal_product.deleted'
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'calendar_event.created'
  | 'calendar_event.updated'
  | 'calendar_event.deleted'
  | 'custom_field.created'
  | 'custom_field.updated'
  | 'custom_field.deleted'
  | 'custom_field_value.created'
  | 'custom_field_value.updated'
  | 'custom_field_value.deleted'
  | 'saved_view.created'
  | 'saved_view.updated'
  | 'saved_view.deleted'
  | 'activity_log.created'
  | 'jtl_reference.created'
  | 'jtl_reference.updated'
  | 'jtl_reference.deleted'
  | 'jtl_order.created'
  | 'spam_list_entry.created'
  | 'spam_list_entry.updated'
  | 'spam_list_entry.deleted'
  | 'spam_learning_event.created'
  | 'spam_decision.created'
  | 'spam_decision.updated'
  | 'spam_decision.deleted'
  | 'pgp_identity.created'
  | 'pgp_identity.updated'
  | 'pgp_identity.deleted'
  | 'pgp_peer_key.created'
  | 'pgp_peer_key.updated'
  | 'pgp_peer_key.deleted'
  | 'ai_profile.created'
  | 'ai_profile.updated'
  | 'ai_profile.deleted'
  | 'ai_prompt.created'
  | 'ai_prompt.updated'
  | 'ai_prompt.deleted'
  | 'workflow.created'
  | 'workflow.updated'
  | 'workflow.deleted'
  | 'workflow_version.created'
  | 'workflow_version.updated'
  | 'workflow_version.deleted'
  | 'workflow_knowledge_base.created'
  | 'workflow_knowledge_base.updated'
  | 'workflow_knowledge_base.deleted'
  | 'workflow_knowledge_chunk.created'
  | 'workflow_knowledge_chunk.updated'
  | 'workflow_knowledge_chunk.deleted'
  | 'workflow_delayed_job.created'
  | 'workflow_delayed_job.updated'
  | 'workflow_delayed_job.deleted'
  | 'automation_api_key.created'
  | 'automation_api_key.revoked'
  | 'email_account.created'
  | 'email_account.updated'
  | 'email_account.deleted'
  | 'email_message.updated'
  | 'email_message_tag.created'
  | 'email_message_tag.deleted'
  | 'email_category.created'
  | 'email_category.updated'
  | 'email_category.deleted'
  | 'email_message_category.created'
  | 'email_message_category.deleted'
  | 'email_internal_note.created'
  | 'email_internal_note.updated'
  | 'email_internal_note.deleted'
  | 'email_canned_response.created'
  | 'email_canned_response.updated'
  | 'email_canned_response.deleted'
  | 'email_remote_content_allowlist.created'
  | 'email_remote_content_allowlist.updated'
  | 'email_remote_content_allowlist.deleted'
  | 'email_team_member.created'
  | 'email_team_member.updated'
  | 'email_team_member.deleted'
  | 'email_thread_edge.created'
  | 'email_thread_edge.deleted'
  | 'email_thread_alias.created'
  | 'email_thread_alias.updated'
  | 'email_thread_alias.deleted'
  | 'email_thread.updated'
  | 'email_account_signature.created'
  | 'email_account_signature.updated'
  | 'email_account_signature.deleted'
  | 'email_read_receipt.created';

export type ServerEventEntityType =
  | 'email_message'
  | 'customer'
  | 'product'
  | 'deal'
  | 'deal_product'
  | 'task'
  | 'calendar_event'
  | 'custom_field'
  | 'custom_field_value'
  | 'saved_view'
  | 'activity_log'
  | 'jtl_reference'
  | 'jtl_order'
  | 'spam_list_entry'
  | 'spam_learning_event'
  | 'spam_decision'
  | 'pgp_identity'
  | 'pgp_peer_key'
  | 'ai_profile'
  | 'ai_prompt'
  | 'workflow'
  | 'workflow_version'
  | 'workflow_knowledge_base'
  | 'workflow_knowledge_chunk'
  | 'workflow_delayed_job'
  | 'automation_api_key'
  | 'email_account'
  | 'email_message_tag'
  | 'email_category'
  | 'email_message_category'
  | 'email_internal_note'
  | 'email_canned_response'
  | 'email_remote_content_allowlist'
  | 'email_team_member'
  | 'email_thread_edge'
  | 'email_thread_alias'
  | 'email_thread'
  | 'email_account_signature'
  | 'email_read_receipt';

export type ServerEvent = Readonly<{
  sequence?: number;
  type: ServerEventType;
  workspaceId: string;
  entityType: ServerEventEntityType;
  entityId: string;
  actorUserId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}>;

export type ServerEventSubscription = Readonly<{
  unsubscribe(): void;
}>;

export type ServerEventPort = Readonly<{
  publish(event: ServerEvent): Promise<void>;
  subscribe?(subscriber: (event: ServerEvent) => void | Promise<void>): ServerEventSubscription;
  replay?(input: {
    workspaceId: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<readonly ServerEvent[]> | readonly ServerEvent[];
}>;

export type ConversationLockApiPort = {
  list(input: {
    messageIds: readonly number[];
    workspaceId: string;
  }): Promise<readonly ConversationLockRecord[]>;
  acquire(input: {
    messageId: number;
    userId: string;
    workspaceId: string;
    reason: ConversationLockReason;
  }): Promise<{ ok: true; lock: ConversationLockRecord } | { ok: false; existing: ConversationLockRecord }>;
  get(input: {
    messageId: number;
    workspaceId: string;
  }): Promise<ConversationLockRecord | null>;
  heartbeat(input: {
    messageId: number;
    userId: string;
    workspaceId: string;
  }): Promise<ConversationLockRecord | null>;
  release(input: {
    messageId: number;
    userId: string;
    workspaceId: string;
    allowAdminOverride: boolean;
  }): Promise<ConversationLockRecord | null>;
  forceTakeover(input: {
    messageId: number;
    newUserId: string;
    workspaceId: string;
    reason: ConversationLockReason;
  }): Promise<ConversationLockRecord>;
};

export type SyncInfoRecord = {
  key: string;
  value: string | null;
  updatedAt: string;
};

export type SyncInfoApiPort = {
  getMany(input: {
    workspaceId: string;
    keys: readonly string[];
  }): Promise<readonly SyncInfoRecord[]>;
  getByPrefix(input: {
    workspaceId: string;
    prefix: string;
    limit?: number;
  }): Promise<readonly SyncInfoRecord[]>;
  setMany(input: {
    workspaceId: string;
    values: Readonly<Record<string, string | null>>;
  }): Promise<readonly SyncInfoRecord[]>;
  deleteMany(input: {
    workspaceId: string;
    keys: readonly string[];
  }): Promise<number>;
};

export type AuditApiPort = {
  record(input: {
    workspaceId: string;
    actorUserId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  list?(input: {
    workspaceId: string;
    limit: number;
    offset?: number;
  }): Promise<readonly AuditEventRecord[]>;
  verify?(input: {
    workspaceId: string;
  }): Promise<AuditChainVerificationResult>;
};

export type AuditEventRecord = {
  id: number;
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  previousHash: string | null;
  eventHash: string;
  createdAt: string;
};

export type AuditChainVerificationResult = {
  valid: boolean;
  checked: number;
  firstBrokenId?: number;
  error?: string;
};

export type CustomerRecord = {
  id: number;
  sourceSqliteId: number;
  customerNumber: string | null;
  name: string | null;
  firstName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  street?: string | null;
  zipCode?: string | null;
  city: string | null;
  country: string | null;
  notes?: string | null;
  status: string;
  updatedAt: string;
};

export type CustomerListResult = {
  items: readonly CustomerRecord[];
  nextCursor: number | null;
  total?: number;
};

export type CustomerMutationInput = {
  customerNumber?: string | null;
  name?: string | null;
  firstName?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  street?: string | null;
  zipCode?: string | null;
  city?: string | null;
  country?: string | null;
  notes?: string | null;
  status?: string;
};

export type UserGroupRecord = {
  id: number;
  name: string;
  description: string | null;
  memberCount: number;
  updatedAt: string;
};

export type UserGroupMemberRecord = {
  userId: string;
  email: string;
  displayName: string;
  role: 'owner' | 'admin' | 'user';
};

export type UserGroupMutationResult =
  | { ok: true; group: UserGroupRecord }
  | { ok: false; code: 'duplicate_name' | 'not_found' | 'invalid_name' };

export type UserGroupAddMemberResult =
  | { ok: true }
  | { ok: false; code: 'group_not_found' | 'user_not_found' };

export type UserGroupRemoveMemberResult =
  | { ok: true }
  | { ok: false; code: 'group_not_found' };

export type UserGroupApiPort = {
  list(input: { workspaceId: string }): Promise<UserGroupRecord[]>;
  create(input: {
    workspaceId: string;
    actorUserId: string;
    name: string;
    description?: string | null;
  }): Promise<UserGroupMutationResult>;
  update(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    name?: string;
    description?: string | null;
  }): Promise<UserGroupMutationResult>;
  delete(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<UserGroupRecord | null>;
  listMembers(input: {
    workspaceId: string;
    groupId: number;
  }): Promise<UserGroupMemberRecord[] | null>;
  addMember(input: {
    workspaceId: string;
    actorUserId: string;
    groupId: number;
    userId: string;
  }): Promise<UserGroupAddMemberResult>;
  removeMember(input: {
    workspaceId: string;
    actorUserId: string;
    groupId: number;
    userId: string;
  }): Promise<UserGroupRemoveMemberResult>;
};

export type CustomerApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    status?: string;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
    cursor?: number;
    offset?: number;
    limit: number;
  }): Promise<CustomerListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<CustomerRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: CustomerMutationInput;
  }): Promise<CustomerRecord>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: CustomerMutationInput;
  }): Promise<CustomerRecord | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<CustomerRecord | null>;
};

export type DashboardStatsRecord = {
  totalCustomers: number;
  newCustomersLastMonth: number;
  activeDealsCount: number;
  activeDealsValue: number;
  pendingTasksCount: number;
  dueTodayTasksCount: number;
  conversionRate: number;
};

export type DashboardRecentCustomerRecord = {
  id: number;
  name: string | null;
  email: string | null;
  dateAdded: string | null;
};

export type DashboardUpcomingTaskRecord = {
  id: number;
  title: string;
  priority: string;
  customerId: number | null;
  dueDate: string | null;
  customerName: string | null;
};

export type DashboardApiPort = {
  getStats(input: {
    workspaceId: string;
    now?: Date;
  }): Promise<DashboardStatsRecord>;
  getRecentCustomers(input: {
    workspaceId: string;
    limit: number;
  }): Promise<readonly DashboardRecentCustomerRecord[]>;
  getUpcomingTasks(input: {
    workspaceId: string;
    limit: number;
  }): Promise<readonly DashboardUpcomingTaskRecord[]>;
};

export type FollowUpQueueCountsRecord = {
  heute: number;
  ueberfaellig: number;
  dieseWoche: number;
  zurueckgestellt: number;
  stagnierend: number;
  highValueRisk: number;
};

export type FollowUpItemRecord = {
  itemId: number;
  sourceType: 'task' | 'deal';
  customerId: number | null;
  customerName: string | null;
  dealId?: number | null;
  dealName?: string | null;
  dealValue?: number | null;
  dealStage?: string | null;
  title: string;
  reason: string;
  dueDate?: string | null;
  priority: string;
  priorityScore: number;
  lastContactDate?: string | null;
  snoozedUntil?: string | null;
  completed?: boolean;
};

export type FollowUpApiPort = {
  getQueueCounts(input: {
    workspaceId: string;
    now?: Date;
  }): Promise<FollowUpQueueCountsRecord>;
  getItems(input: {
    workspaceId: string;
    queue: string;
    filters?: {
      query?: string;
      priority?: string;
    };
    limit: number;
    offset: number;
    now?: Date;
  }): Promise<readonly FollowUpItemRecord[]>;
  snoozeTask(input: {
    workspaceId: string;
    actorUserId: string;
    taskId: number;
    snoozedUntil: string;
  }): Promise<{ success: boolean; error?: string }>;
};

export type ProductRecord = {
  id: number;
  sourceSqliteId: number;
  jtlKartikel: number | null;
  name: string;
  sku: string | null;
  description: string | null;
  price: string;
  isActive: boolean;
  updatedAt: string;
};

export type ProductListResult = {
  items: readonly ProductRecord[];
  nextCursor: number | null;
};

export type ProductMutationInput = {
  name?: string;
  sku?: string | null;
  description?: string | null;
  price?: string;
  isActive?: boolean;
};

export type ProductApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    cursor?: number;
    limit: number;
  }): Promise<ProductListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<ProductRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: ProductMutationInput;
  }): Promise<ProductRecord>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: ProductMutationInput;
  }): Promise<ProductRecord | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<ProductRecord | null>;
};

export type DealRecord = {
  id: number;
  sourceSqliteId: number;
  customerSourceSqliteId: number;
  customerId: number | null;
  name: string;
  value: string;
  valueCalculationMethod: 'static' | 'dynamic';
  stage: string;
  notes: string | null;
  createdDate: string | null;
  expectedCloseDate: string | null;
  updatedAt: string;
};

export type DealListResult = {
  items: readonly DealRecord[];
  nextCursor: number | null;
};

export type DealMutationInput = {
  customerId?: number;
  name?: string;
  value?: string;
  valueCalculationMethod?: 'static' | 'dynamic';
  stage?: string;
  notes?: string | null;
  createdDate?: string | null;
  expectedCloseDate?: string | null;
};

export type DealMutationPortResult =
  | { ok: true; deal: DealRecord }
  | { ok: false; code: 'customer_not_found' };

export type DealApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    stage?: string;
    customerId?: number;
    cursor?: number;
    limit: number;
  }): Promise<DealListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<DealRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: DealMutationInput;
  }): Promise<DealMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: DealMutationInput;
  }): Promise<DealMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<DealRecord | null>;
};

export type DealProductRecord = {
  id: number;
  sourceSqliteId: number;
  dealSourceSqliteId: number;
  productSourceSqliteId: number;
  dealId: number | null;
  productId: number | null;
  quantity: number;
  priceAtTimeOfAdding: string;
  dateAdded: string | null;
  product: ProductRecord;
};

export type DealProductMutationInput = {
  dealProductId?: number;
  dealId?: number;
  productId?: number;
  quantity?: number;
  price?: string;
};

export type DealProductMutationPortResult =
  | { ok: true; dealProduct: DealProductRecord }
  | { ok: false; code: 'deal_not_found' | 'product_not_found' | 'deal_product_not_found' };

export type DealProductDeletePortResult =
  | { ok: true; dealProduct: DealProductRecord }
  | { ok: false; code: 'deal_product_not_found' };

export type DealProductApiPort = {
  list(input: {
    workspaceId: string;
    dealId: number;
  }): Promise<readonly DealProductRecord[] | null>;
  add(input: {
    workspaceId: string;
    actorUserId: string;
    values: DealProductMutationInput;
  }): Promise<DealProductMutationPortResult>;
  update(input: {
    workspaceId: string;
    actorUserId: string;
    values: DealProductMutationInput;
  }): Promise<DealProductMutationPortResult>;
  delete(input: {
    workspaceId: string;
    actorUserId: string;
    values: DealProductMutationInput;
  }): Promise<DealProductDeletePortResult>;
};

export type TaskAssignmentScope = 'global' | 'user' | 'group';

export type TaskViewer = {
  userId: string;
  role: 'owner' | 'admin' | 'user';
};

export type TaskRecord = {
  id: number;
  sourceSqliteId: number;
  customerSourceSqliteId: number;
  customerId: number | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: string;
  completed: boolean;
  snoozedUntil: string | null;
  assignmentScope: TaskAssignmentScope;
  assignedUserId: string | null;
  assignedGroupId: number | null;
  updatedAt: string;
};

export type TaskListResult = {
  items: readonly TaskRecord[];
  nextCursor: number | null;
};

export type TaskMutationInput = {
  customerId?: number;
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  priority?: string;
  completed?: boolean;
  snoozedUntil?: string | null;
  assignmentScope?: TaskAssignmentScope;
  assignedUserId?: string | null;
  assignedGroupId?: number | null;
};

export type TaskMutationPortResult =
  | { ok: true; task: TaskRecord }
  | { ok: false; code: 'customer_not_found' | 'assigned_user_not_found' | 'assigned_group_not_found' };

export type TaskApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    customerId?: number;
    completed?: boolean;
    cursor?: number;
    limit: number;
    viewer?: TaskViewer;
  }): Promise<TaskListResult>;
  get(input: {
    workspaceId: string;
    id: number;
    viewer?: TaskViewer;
  }): Promise<TaskRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: TaskMutationInput;
  }): Promise<TaskMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: TaskMutationInput;
    viewer?: TaskViewer;
  }): Promise<TaskMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    viewer?: TaskViewer;
  }): Promise<TaskRecord | null>;
};

export type CalendarEventRecord = {
  id: number;
  sourceSqliteId: number;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  allDay: boolean;
  colorCode: string | null;
  eventType: string | null;
  recurrenceRule: string | null;
  taskSourceSqliteId: number | null;
  taskId: number | null;
  createdAt: string | null;
  updatedAt: string;
};

export type CalendarEventListResult = {
  items: readonly CalendarEventRecord[];
  nextCursor: number | null;
};

export type CalendarEventMutationInput = {
  title?: string;
  description?: string | null;
  startDate?: string;
  endDate?: string;
  allDay?: boolean;
  colorCode?: string | null;
  eventType?: string | null;
  recurrenceRule?: string | null;
  taskId?: number | null;
};

export type CalendarEventMutationPortResult =
  | { ok: true; event: CalendarEventRecord }
  | { ok: false; code: 'task_not_found' | 'invalid_date_range' };

export type CalendarEventApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    eventType?: string;
    taskId?: number;
    startFrom?: string;
    startTo?: string;
    cursor?: number;
    limit: number;
  }): Promise<CalendarEventListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<CalendarEventRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: CalendarEventMutationInput;
  }): Promise<CalendarEventMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: CalendarEventMutationInput;
  }): Promise<CalendarEventMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<CalendarEventRecord | null>;
};

export type CustomerCustomFieldRecord = {
  id: number;
  sourceSqliteId: number;
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: unknown | null;
  defaultValue: string | null;
  placeholder: string | null;
  description: string | null;
  displayOrder: number;
  active: boolean;
  createdAt: string | null;
  updatedAt: string;
};

export type CustomerCustomFieldListResult = {
  items: readonly CustomerCustomFieldRecord[];
  nextCursor: number | null;
};

export type CustomerCustomFieldMutationInput = {
  name?: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: unknown | null;
  defaultValue?: string | null;
  placeholder?: string | null;
  description?: string | null;
  displayOrder?: number;
  active?: boolean;
};

export type CustomerCustomFieldMutationPortResult =
  | { ok: true; field: CustomerCustomFieldRecord }
  | { ok: false; code: 'duplicate_name' };

export type CustomerCustomFieldApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    type?: string;
    active?: boolean;
    cursor?: number;
    limit: number;
  }): Promise<CustomerCustomFieldListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<CustomerCustomFieldRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: CustomerCustomFieldMutationInput;
  }): Promise<CustomerCustomFieldMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: CustomerCustomFieldMutationInput;
  }): Promise<CustomerCustomFieldMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<CustomerCustomFieldRecord | null>;
};

export type CustomerCustomFieldValueRecord = {
  id: number;
  sourceSqliteId: number;
  customerSourceSqliteId: number;
  fieldSourceSqliteId: number;
  customerId: number | null;
  fieldId: number | null;
  value: string | null;
  createdAt: string | null;
  updatedAt: string;
};

export type CustomerCustomFieldValueListResult = {
  items: readonly CustomerCustomFieldValueRecord[];
  nextCursor: number | null;
};

export type CustomerCustomFieldValueMutationInput = {
  customerId?: number;
  fieldId?: number;
  value?: string | null;
};

export type CustomerCustomFieldValueMutationPortResult =
  | { ok: true; value: CustomerCustomFieldValueRecord }
  | { ok: false; code: 'customer_not_found' | 'custom_field_not_found' | 'value_conflict' };

export type CustomerCustomFieldValueApiPort = {
  list(input: {
    workspaceId: string;
    customerId?: number;
    customerIds?: number[];
    fieldId?: number;
    search?: string;
    cursor?: number;
    limit: number;
  }): Promise<CustomerCustomFieldValueListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<CustomerCustomFieldValueRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: CustomerCustomFieldValueMutationInput;
  }): Promise<CustomerCustomFieldValueMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: CustomerCustomFieldValueMutationInput;
  }): Promise<CustomerCustomFieldValueMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<CustomerCustomFieldValueRecord | null>;
};

export type ActivityLogRecord = {
  id: number;
  sourceSqliteId: number;
  customerSourceSqliteId: number | null;
  dealSourceSqliteId: number | null;
  taskSourceSqliteId: number | null;
  customerId: number | null;
  dealId: number | null;
  taskId: number | null;
  activityType: string;
  title: string | null;
  description: string | null;
  metadata?: unknown | null;
  createdAt: string | null;
  updatedAt: string;
};

export type ActivityLogListResult = {
  items: readonly ActivityLogRecord[];
  nextCursor: number | null;
};

export type ActivityLogListSort = 'idAsc' | 'createdAtDesc';

export type ActivityLogMutationInput = {
  customerId?: number | null;
  dealId?: number | null;
  taskId?: number | null;
  activityType?: string;
  title?: string | null;
  description?: string | null;
  metadata?: unknown | null;
  createdAt?: string | null;
};

export type ActivityLogMutationPortResult =
  | { ok: true; activityLog: ActivityLogRecord }
  | { ok: false; code: 'customer_not_found' | 'deal_not_found' | 'task_not_found' };

export type ActivityLogApiPort = {
  list(input: {
    workspaceId: string;
    activityType?: string;
    activityTypes?: readonly string[];
    customerId?: number;
    dealId?: number;
    taskId?: number;
    search?: string;
    includeMetadata: boolean;
    cursor?: number;
    limit: number;
    sort?: ActivityLogListSort;
  }): Promise<ActivityLogListResult>;
  get(input: {
    workspaceId: string;
    id: number;
    includeMetadata: boolean;
  }): Promise<ActivityLogRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: ActivityLogMutationInput;
  }): Promise<ActivityLogMutationPortResult>;
};

export type SavedViewRecord = {
  id: number;
  sourceSqliteId: number;
  name: string;
  filters: unknown;
  displayOrder: number;
  createdAt: string | null;
  updatedAt: string;
};

export type SavedViewListResult = {
  items: readonly SavedViewRecord[];
  nextCursor: number | null;
};

export type SavedViewMutationInput = {
  name?: string;
  filters?: unknown;
  displayOrder?: number;
};

export type SavedViewApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    cursor?: number;
    limit: number;
  }): Promise<SavedViewListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<SavedViewRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: SavedViewMutationInput;
  }): Promise<SavedViewRecord>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: SavedViewMutationInput;
  }): Promise<SavedViewRecord | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<SavedViewRecord | null>;
};

export type JtlReferenceRecord = {
  sourceSqliteId: number;
  name: string | null;
  updatedAt: string;
};

export type JtlReferenceListResult = {
  items: readonly JtlReferenceRecord[];
  nextCursor: number | null;
};

export type JtlReferenceMutationInput = {
  name?: string | null;
};

export type JtlReferenceApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    cursor?: number;
    limit: number;
  }): Promise<JtlReferenceListResult>;
  get(input: {
    workspaceId: string;
    sourceSqliteId: number;
  }): Promise<JtlReferenceRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: JtlReferenceMutationInput;
  }): Promise<JtlReferenceRecord>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    sourceSqliteId: number;
    values: JtlReferenceMutationInput;
  }): Promise<JtlReferenceRecord | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    sourceSqliteId: number;
  }): Promise<JtlReferenceRecord | null>;
};

export type JtlOrderProductInput = {
  kArtikel: number;
  cName?: string | null;
  cArtNr?: string | null;
  nAnzahl: number;
  fPreis: number;
};

export type JtlOrderInput = {
  simpleCrmCustomerId: number;
  kFirma: number;
  kWarenlager: number;
  kZahlungsart: number;
  kVersandart: number;
  products: readonly JtlOrderProductInput[];
};

export type JtlOrderResult =
  | { success: true; jtlOrderId: number; jtlOrderNumber: string }
  | { success: false; error: string };

export type JtlOrderApiPort = {
  createOrder(input: {
    workspaceId: string;
    actorUserId: string;
    order: JtlOrderInput;
  }): Promise<JtlOrderResult>;
};

export type JtlSyncStatusRecord = {
  status: string;
  message: string;
  timestamp: string;
};

export type JtlSyncRunDetails = {
  found: number;
  synced: number;
  customersFound: number;
  customersSynced: number;
  productsFound: number;
  productsSynced: number;
  firmenFound: number;
  firmenSynced: number;
  warenlagerFound: number;
  warenlagerSynced: number;
  zahlungsartenFound: number;
  zahlungsartenSynced: number;
  versandartenFound: number;
  versandartenSynced: number;
};

export type JtlSyncRunResult =
  | { success: true; message: string; details: JtlSyncRunDetails }
  | { success: false; message: string; errorDetails?: unknown };

export type JtlSyncApiPort = {
  getStatus(input: {
    workspaceId: string;
  }): Promise<JtlSyncStatusRecord>;
  run(input: {
    workspaceId: string;
    actorUserId: string;
  }): Promise<JtlSyncRunResult>;
};

export type EmailAccountRecord = {
  id: number;
  sourceSqliteId: number;
  displayName: string;
  emailAddress: string;
  protocol: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapUsername: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpTls: boolean;
  smtpUsername: string | null;
  smtpUseImapAuth: boolean;
  pop3Host: string | null;
  pop3Port: number | null;
  pop3Tls: boolean;
  oauthProvider: string | null;
  sentFolderPath: string | null;
  syncSpamFolderPath: string | null;
  syncArchiveFolderPath: string | null;
  imapSyncSent: boolean;
  imapSyncArchive: boolean;
  imapSyncSpam: boolean;
  imapSyncSeenOnOpen: boolean;
  vacationEnabled: boolean;
  vacationSubject: string | null;
  vacationBodyText: string | null;
  requestReadReceipt: boolean;
  imapDeleteOptIn: boolean;
  defaultRemoteContentPolicy: string;
  respondToReadReceipts: string;
  imapPasswordConfigured: boolean;
  smtpPasswordConfigured: boolean;
  oauthRefreshConfigured: boolean;
  updatedAt: string;
};

export type EmailAccountListResult = {
  items: readonly EmailAccountRecord[];
};

export type EmailOAuthProvider = 'google' | 'microsoft';

export type EmailOAuthAppSettings = {
  clientId: string;
  clientSecret: string;
};

export type EmailOAuthTokenExchangeResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt?: string | null;
};

export type EmailOAuthApiPort = {
  buildAuthorizeUrl(input: {
    provider: EmailOAuthProvider;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): string;
  exchangeAuthCode(input: {
    provider: EmailOAuthProvider;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
  }): Promise<EmailOAuthTokenExchangeResult>;
};

export type EmailAccountMutationInput = {
  displayName?: string;
  emailAddress?: string;
  imapHost?: string;
  imapPort?: number;
  imapTls?: boolean;
  imapUsername?: string;
  imapPassword?: string;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpTls?: boolean;
  smtpUsername?: string | null;
  smtpUseImapAuth?: boolean;
  smtpPassword?: string;
  protocol?: string;
  pop3Host?: string | null;
  pop3Port?: number | null;
  pop3Tls?: boolean;
  sentFolderPath?: string | null;
  syncSpamFolderPath?: string | null;
  syncArchiveFolderPath?: string | null;
  imapSyncSent?: boolean;
  imapSyncArchive?: boolean;
  imapSyncSpam?: boolean;
  imapSyncSeenOnOpen?: boolean;
  vacationEnabled?: boolean;
  vacationSubject?: string | null;
  vacationBodyText?: string | null;
  requestReadReceipt?: boolean;
  imapDeleteOptIn?: boolean;
};

export type EmailAccountMutationPortResult =
  | { ok: true; account: EmailAccountRecord }
  | { ok: false; code: 'secret_port_unavailable' };

export type EmailAccountApiPort = {
  list(input: {
    workspaceId: string;
  }): Promise<EmailAccountListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<EmailAccountRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailAccountMutationInput;
  }): Promise<EmailAccountMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: EmailAccountMutationInput;
  }): Promise<EmailAccountMutationPortResult | null>;
  setOAuthRefreshToken?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    provider: EmailOAuthProvider;
    refreshToken: string;
  }): Promise<EmailAccountMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<EmailAccountMutationPortResult | null>;
};

export type MailConnectionTestInput = {
  workspaceId: string;
  accountId?: number;
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password?: string;
  accessToken?: string;
  smtpUseImapAuth?: boolean;
};

export type MailConnectionTestResult =
  | { success: true }
  | { success: false; error: string };

export type MailConnectionTestApiPort = Readonly<{
  testImap(input: MailConnectionTestInput): Promise<MailConnectionTestResult>;
  testPop3(input: MailConnectionTestInput): Promise<MailConnectionTestResult>;
  testSmtp(input: MailConnectionTestInput): Promise<MailConnectionTestResult>;
}>;

export type EmailVacationTestResult =
  | { success: true; accountId: number; emailAddress: string }
  | { success: false; error: string };

export type EmailVacationTestApiPort = Readonly<{
  sendTest(input: {
    workspaceId: string;
    actorUserId: string;
    accountId: number;
  }): Promise<EmailVacationTestResult>;
}>;

export type EmailMessageRecord = {
  id: number;
  sourceSqliteId: number;
  accountId: number | null;
  folderId: number | null;
  uid: number;
  messageId: string | null;
  subject: string | null;
  from: unknown;
  to: unknown;
  cc: unknown;
  bcc: unknown;
  dateReceived: string | null;
  snippet: string | null;
  seenLocal: boolean;
  doneLocal: boolean;
  archived: boolean;
  softDeleted: boolean;
  folderKind: string;
  threadId: string | null;
  imapThreadId: string | null;
  ticketCode: string | null;
  customerId: number | null;
  hasAttachments: boolean;
  assignedTo: string | null;
  assignedToUserId: string | null;
  isSpam: boolean;
  spamStatus: string;
  pgpStatus: string | null;
  remoteContentPolicy: string;
  readReceiptRequested: boolean;
  snoozedUntil: string | null;
  draftAttachmentPathsJson?: string | null;
  replyParentMessageId?: number | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  updatedAt: string;
};

export type EmailMessageListResult = {
  items: readonly EmailMessageRecord[];
  nextCursor: number | null;
  searchMode?: 'fts' | 'like' | 'regex';
};

export type EmailReplySuggestionStatus = 'none' | 'pending' | 'ready' | 'failed' | 'skipped';
export type EmailReplySuggestionTrigger = 'inbound' | 'open';

export type EmailReplySuggestionRecord = {
  status: EmailReplySuggestionStatus;
  text: string | null;
  error: string | null;
  updatedAt: string | null;
};

export type EmailReplyDraftGenerationResult =
  | { success: true; text: string }
  | { success: false; error: string };

export type AiReplySuggestionApiPort = {
  get(input: {
    workspaceId: string;
    messageId: number;
    now?: Date;
  }): Promise<EmailReplySuggestionRecord>;
  ensure(input: {
    workspaceId: string;
    actorUserId?: string;
    messageId: number;
    force?: boolean;
    skipIfReady?: boolean;
    trigger?: EmailReplySuggestionTrigger;
    promptId?: number;
    profileId?: number;
  }): Promise<void>;
  generate(input: {
    workspaceId: string;
    actorUserId?: string;
    messageId: number;
    promptId?: number;
    profileId?: number;
    customerId?: number | null;
    userContext?: string;
    /** When false, returns draft text without updating stored suggestion. Default true. */
    persistSuggestion?: boolean;
  }): Promise<EmailReplyDraftGenerationResult>;
};

export type EmailMessageRawHeadersRecord = {
  rawEml: string;
  emlSource: 'original' | 'reconstructed';
  rawHeaders: string | null;
  messageIdHeader: string | null;
  fromJson: unknown | null;
};

export type EmailReadReceiptStateResult = {
  requested: boolean;
  respond: 'never' | 'ask' | 'always_trusted';
  trustedDomains: string | null;
};

export type EmailReadReceiptRespondAction = 'send' | 'decline';

export type EmailReadReceiptResponseResult =
  | { success: true; receipt?: EmailReadReceiptRecord }
  | { success: false; error: string };

export type EmailMailFolderCounts = {
  inbox: number;
  inboxUnread: number;
  sentFailed: number;
  drafts: number;
  scheduledSend: number;
  archived: number;
  spamReview: number;
  spam: number;
  trash: number;
  snoozed: number;
};

export type EmailDiagnosticsReport = {
  collectedAt: string;
  schemaGeneration: number;
  schemaGenerationLabel: string;
  sizes: {
    databaseBytes: number | null;
    attachmentsBytes: number;
  };
  messages: {
    total: number;
    pendingPostProcess: number;
    outboundHold: number;
    byFolderKind: Record<string, number>;
  };
  workflows: {
    runsLast24h: number;
    runsBlockedLast24h: number;
    runsErrorLast24h: number;
  };
  aiUsage: {
    events24h: number;
    tokens24h: number;
    costMicroUsd24h: number;
    avgLatencyMs24h: number;
    events30d: number;
    tokens30d: number;
    costMicroUsd30d: number;
    byNodeType24h: Record<string, number>;
  };
  notices: {
    imapAuth: number;
    uidValidity: number;
  };
  syncInfo: {
    totalKeys: number;
    prefixes: Record<string, number>;
  };
  background: {
    cronScheduled: boolean;
    cronTickInFlight: boolean;
    syncInFlightAccountIds: number[];
    idleImapAccountIds: number[];
  };
  accounts: Array<{
    id: number;
    email: string;
    protocol: string;
    inboxLastSyncedAt: string | null;
  }>;
  jobQueue?: {
    ready: number;
    locked: number;
    lagSeconds: number;
    oldestLockedSeconds: number | null;
    samples: Array<{
      id: number;
      type: string;
      attempts: number;
      maxAttempts: number;
      lockedBy: string | null;
      lockedSeconds: number | null;
      lastError: string | null;
    }>;
  };
};

export type EmailDiagnosticsApiPort = {
  collect(input: {
    workspaceId: string;
    now?: Date;
  }): Promise<EmailDiagnosticsReport>;
};

export type EmailReportingSnapshot = {
  accounts: Array<{
    id: number;
    displayName: string;
    emailAddress: string;
    protocol: string;
  }>;
  totals: {
    messages: number;
    unread: number;
    archived: number;
    withCustomer: number;
    withAssignment: number;
    withAttachments: number;
  };
  perAccount: Array<{
    accountId: number;
    messages: number;
    unread: number;
    archived: number;
  }>;
  workflowRuns24h: Array<{
    workflowId: number;
    count: number;
    errors: number;
  }>;
};

export type EmailReportingApiPort = {
  collect(input: {
    workspaceId: string;
    accountId?: number;
    now?: Date;
  }): Promise<EmailReportingSnapshot>;
};

export type EmailMessageSecurityRecord = {
  authSpf: string | null;
  authDkim: string | null;
  authDmarc: string | null;
  authArc: string | null;
  authDkimDomains: string | null;
  authError: string | null;
  rspamdScore: number | null;
  rspamdAction: string | null;
  rspamdSymbols: string | null;
  rspamdError: string | null;
  securityCheckedAt: string | null;
  spamStatus: string | null;
  spamScore: number | null;
  spamScoreLabel: string | null;
  spamDecisionSource: string | null;
  spamScoreBreakdownJson: unknown | null;
  spamDecidedAt: string | null;
};

export type EmailMessageSpamStatus = 'clean' | 'review' | 'spam';

export type EmailMessageSpamStatusMutationInput = {
  status?: EmailMessageSpamStatus;
  train?: boolean;
  source?: string;
  featureKeys?: readonly string[] | null;
};

export type EmailMessageSpamDecisionMutationInput = {
  applyStatus?: boolean;
};

export type EmailMessageSpamDecisionResult = {
  message: EmailMessageRecord;
  decision: SpamDecisionRecord;
};

export type EmailMessageSecurityCheckResult = {
  message: EmailMessageRecord;
  security: EmailMessageSecurityRecord;
  decision: SpamDecisionRecord | null;
  authChecked: boolean;
  rspamdChecked: boolean;
};

export type EmailMessageBulkMutationResult = {
  count: number;
};

export type EmailMessageDraftDeleteResult =
  | { ok: true; count: number }
  | { ok: false; reason: 'not_found' | 'not_local_draft' };

export type EmailComposeDraftCreateInput = {
  accountId: number;
  subject?: string;
  bodyText?: string;
  toJson?: unknown | null;
  /** Optional attachment storage paths to persist into draft_attachment_paths_json,
   *  so a hold-then-release send picks them up later. */
  draftAttachmentPaths?: readonly string[];
};

export type EmailComposeDraftUpdateInput = {
  subject?: string;
  bodyText?: string;
  bodyHtml?: string | null;
  fromJson?: unknown | null;
  toJson?: unknown | null;
  ccJson?: unknown | null;
  bccJson?: unknown | null;
  draftAttachmentPaths?: readonly string[];
  replyParentMessageId?: number | null;
};

export type EmailComposeDraftMutationResult =
  | { ok: true; message: EmailMessageRecord }
  | { ok: false; reason: 'not_found' | 'not_local_draft' | 'account_not_found' };

export type EmailScheduledSendDraftState = {
  failureCount: number;
  status: 'ok' | 'pending' | 'failed';
  lastError: string | null;
};

export type EmailComposeDraftRecoveryState = {
  smtpCommitted: boolean;
  needsResendFinalize: boolean;
};

export type EmailComposeSendInput = {
  accountId: number;
  draftMessageId: number;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  to: string;
  cc?: string;
  bcc?: string;
  inReplyToMessageId?: number | null;
  attachmentPaths?: readonly string[];
  markReplyParentDone?: boolean;
  requestReadReceipt?: boolean;
  pgpEncrypt?: boolean;
  pgpSign?: boolean;
  pgpPassphrase?: string;
};

export type EmailComposeSendResult =
  | {
    ok: true;
    messageId: number;
    accountId: number | null;
    warning?: string;
    recoveredSentAppend?: boolean;
  }
  | {
    ok: false;
    error: string;
    workflowRunId?: number | null;
  };

export type EmailComposeSenderApiPort = {
  send(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailComposeSendInput;
  }): Promise<EmailComposeSendResult>;
};

export type EmailComposeAttachmentUploadResult =
  | {
    ok: true;
    path: string;
    filename: string;
    sizeBytes: number;
  }
  | {
    ok: false;
    reason: 'not_found' | 'not_local_draft' | 'invalid_content' | 'write_failed';
    error: string;
  };

export type EmailComposeAttachmentUploadApiPort = {
  upload(input: {
    workspaceId: string;
    draftMessageId: number;
    filename: string;
    contentBase64: string;
    contentType?: string;
  }): Promise<EmailComposeAttachmentUploadResult>;
};

export type EmailOutboundValidationInput = {
  messageId: number;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  to: string;
  cc?: string;
  bcc?: string;
  inReplyToMessageId?: number | null;
  attachmentCount?: number;
};

export type EmailOutboundValidationResult =
  | {
    allowed: true;
    reason: null;
  }
  | {
    allowed: false;
    reason: string;
    workflowRunId?: number | null;
  };

export type EmailOutboundValidationApiPort = {
  validate(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailOutboundValidationInput;
  }): Promise<EmailOutboundValidationResult>;
};

export type EmailMessageMetadataMutationResult =
  | { ok: true; message: EmailMessageRecord }
  | { ok: false; reason: 'not_found' | 'customer_not_found' | 'team_member_not_found' };

export type EmailMessageCustomerBackfillResult = {
  count: number;
};

export type EmailInboxArchiveRecoveryPreview = {
  accountId: number;
  count: number;
  accountEmail: string;
  accountLabel: string;
};

export type EmailInboxArchiveRecoveryResult =
  | { ok: true; restored: number }
  | { ok: false; error: string };

export type EmailMessageMoveTargetView = 'inbox' | 'archived' | 'trash' | 'spam_review' | 'spam';
export type EmailRemoteContentPolicy = 'blocked' | 'allowed_once' | 'allowed_sender' | 'allowed_domain';

export type EmailRemoteContentPolicyResult = {
  policy: EmailRemoteContentPolicy;
  allowRemote: boolean;
};

export type EmailRemoteContentPolicyMutationInput = {
  policy: EmailRemoteContentPolicy;
  rememberSender?: boolean;
  rememberDomain?: boolean;
};

export type EmailRemoteContentPolicyMutationResult =
  | { ok: true; result: EmailRemoteContentPolicyResult; message: EmailMessageRecord }
  | { ok: false; reason: 'not_found' };

export type EmailMessageApiPort = {
  list(input: {
    workspaceId: string;
    accountId?: number;
    folderPath?: string;
    folderKind?: string;
    seen?: boolean;
    done?: boolean;
    spam?: boolean;
    search?: string;
    view?: 'inbox' | 'sent' | 'archived' | 'drafts' | 'scheduled_send' | 'spam_review' | 'spam' | 'trash' | 'snoozed' | 'all';
    categoryId?: number;
    sort?: 'date_desc' | 'date_asc' | 'priority';
    listFilter?: 'all' | 'unread' | 'attachment' | 'customer' | 'workflow';
    doneFilter?: 'all' | 'open' | 'done';
    offset?: number;
    cursor?: number;
    limit: number;
  }): Promise<EmailMessageListResult>;
  get(input: {
    workspaceId: string;
    id: number;
    includeBody: boolean;
  }): Promise<EmailMessageRecord | null>;
  createComposeDraft?(input: {
    workspaceId: string;
    accountId: number;
    values: EmailComposeDraftCreateInput;
  }): Promise<EmailComposeDraftMutationResult>;
  updateComposeDraft?(input: {
    workspaceId: string;
    messageId: number;
    values: EmailComposeDraftUpdateInput;
  }): Promise<EmailComposeDraftMutationResult>;
  scheduleDraftSend?(input: {
    workspaceId: string;
    messageId: number;
    sendAt: string | null;
  }): Promise<EmailComposeDraftMutationResult>;
  getScheduledSendDraftState?(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<EmailScheduledSendDraftState>;
  getComposeDraftRecoveryState?(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<EmailComposeDraftRecoveryState>;
  clearScheduledSendDraftFailure?(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<{ success: true }>;
  retryScheduledSendDraft?(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<EmailComposeDraftMutationResult>;
  getSecurity?(input: {
    workspaceId: string;
    id: number;
  }): Promise<EmailMessageSecurityRecord | null>;
  runSecurityCheck?(input: {
    workspaceId: string;
    actorUserId?: string;
    messageId: number;
    values: EmailMessageSpamDecisionMutationInput;
  }): Promise<EmailMessageSecurityCheckResult | null>;
  getRawHeaders?(input: {
    workspaceId: string;
    id: number;
  }): Promise<EmailMessageRawHeadersRecord | null>;
  getReadReceiptState?(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<EmailReadReceiptStateResult | null>;
  getFolderCounts?(input: {
    workspaceId: string;
    accountId?: number;
  }): Promise<EmailMailFolderCounts>;
  consumeRemoteContentPolicy?(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<EmailRemoteContentPolicyResult | null>;
  setRemoteContentPolicy?(input: {
    workspaceId: string;
    actorUserId: string;
    messageId: number;
    values: EmailRemoteContentPolicyMutationInput;
  }): Promise<EmailRemoteContentPolicyMutationResult>;
  listConversation?(input: {
    workspaceId: string;
    accountId?: number;
    excludeMessageId?: number;
    ticketCode?: string;
    customerId?: number;
    correspondentEmail?: string;
    limit: number;
  }): Promise<EmailMessageListResult>;
  listThread?(input: {
    workspaceId: string;
    threadId: string;
    offset?: number;
    limit: number;
  }): Promise<EmailMessageListResult>;
  bulkSoftDelete?(input: {
    workspaceId: string;
    accountId?: number;
    messageIds: readonly number[];
  }): Promise<EmailMessageBulkMutationResult>;
  bulkSetArchived?(input: {
    workspaceId: string;
    accountId?: number;
    messageIds: readonly number[];
    archived: boolean;
  }): Promise<EmailMessageBulkMutationResult>;
  bulkSetDone?(input: {
    workspaceId: string;
    accountId?: number;
    messageIds: readonly number[];
    done: boolean;
  }): Promise<EmailMessageBulkMutationResult>;
  bulkSetSpamStatus?(input: {
    workspaceId: string;
    actorUserId: string;
    accountId?: number;
    messageIds: readonly number[];
    values: EmailMessageSpamStatusMutationInput;
  }): Promise<EmailMessageBulkMutationResult>;
  bulkDeleteLocalDrafts?(input: {
    workspaceId: string;
    messageIds: readonly number[];
  }): Promise<EmailMessageBulkMutationResult>;
  deleteLocalDraft?(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<EmailMessageDraftDeleteResult>;
  snooze?(input: {
    workspaceId: string;
    messageId: number;
    until: string | null;
  }): Promise<EmailMessageBulkMutationResult>;
  softDelete?(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<EmailMessageBulkMutationResult>;
  setArchived?(input: {
    workspaceId: string;
    messageId: number;
    archived: boolean;
  }): Promise<EmailMessageBulkMutationResult>;
  setSeen?(input: {
    workspaceId: string;
    messageId: number;
    seen: boolean;
    syncToServer?: boolean;
  }): Promise<EmailMessageBulkMutationResult>;
  setDone?(input: {
    workspaceId: string;
    messageId: number;
    done: boolean;
  }): Promise<EmailMessageBulkMutationResult>;
  moveToView?(input: {
    workspaceId: string;
    messageId: number;
    view: EmailMessageMoveTargetView;
  }): Promise<EmailMessageBulkMutationResult>;
  previewInboxArchiveRecovery?(input: {
    workspaceId: string;
    accountId: number;
  }): Promise<EmailInboxArchiveRecoveryPreview | null>;
  restoreInboxFromArchive?(input: {
    workspaceId: string;
    accountId: number;
    expectedCount: number;
    confirmPhrase: string;
  }): Promise<EmailInboxArchiveRecoveryResult>;
  restore?(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<EmailMessageBulkMutationResult>;
  linkCustomer?(input: {
    workspaceId: string;
    messageId: number;
    customerId: number | null;
  }): Promise<EmailMessageMetadataMutationResult>;
  backfillCustomerLinks?(input: {
    workspaceId: string;
    accountId?: number;
    limit?: number;
  }): Promise<EmailMessageCustomerBackfillResult>;
  assign?(input: {
    workspaceId: string;
    messageId: number;
    teamMemberId: string | null;
  }): Promise<EmailMessageMetadataMutationResult>;
  setSpamStatus?(input: {
    workspaceId: string;
    actorUserId: string;
    messageId: number;
    values: EmailMessageSpamStatusMutationInput;
  }): Promise<EmailMessageRecord | null>;
  evaluateSpamDecision?(input: {
    workspaceId: string;
    actorUserId?: string;
    messageId: number;
    values: EmailMessageSpamDecisionMutationInput;
  }): Promise<EmailMessageSpamDecisionResult | null>;
};

export type EmailAttachmentRecord = {
  id: number;
  sourceSqliteId: number;
  messageSourceSqliteId: number;
  messageId: number | null;
  filename: string;
  contentType: string | null;
  sizeBytes: number;
  storagePath?: string | null;
  contentSha256: string | null;
  updatedAt: string;
};

export type EmailAttachmentContentRecord = {
  id: number;
  filename: string;
  contentType: string | null;
  sizeBytes: number;
  contentSha256: string | null;
  content: Uint8Array;
};

export type EmailAttachmentContentResult =
  | { ok: true; record: EmailAttachmentContentRecord }
  | { ok: false; reason: 'not_found' | 'file_not_found' | 'unsafe_path' };

export type EmailAttachmentListResult = {
  items: readonly EmailAttachmentRecord[];
};

export type EmailAttachmentApiPort = {
  listForMessage(input: {
    workspaceId: string;
    messageId: number;
  }): Promise<EmailAttachmentListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<EmailAttachmentRecord | null>;
};

export type EmailAttachmentContentApiPort = {
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<EmailAttachmentContentResult>;
};

export type EmailGdprExportResult =
  | { ok: true; filename: string; stream: Readable }
  | { ok: false; code: 'attachments_too_large'; attachmentBytes: number; maxBytes: number };

export type EmailGdprExportApiPort = {
  export(input: {
    workspaceId: string;
    skipAttachments?: boolean;
  }): Promise<EmailGdprExportResult>;
};

export type EmailNumericCursorListResult<TRecord> = {
  items: readonly TRecord[];
  nextCursor: number | null;
};

export type EmailStringCursorListResult<TRecord> = {
  items: readonly TRecord[];
  nextCursor: string | null;
};

export type EmailNumericRecordApiPort<TRecord, TListFilters extends object = object> = {
  list(input: {
    workspaceId: string;
    cursor?: number;
    limit: number;
  } & TListFilters): Promise<EmailNumericCursorListResult<TRecord>>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<TRecord | null>;
};

export type EmailStringRecordApiPort<TRecord, TListFilters extends object = object> = {
  list(input: {
    workspaceId: string;
    cursor?: string;
    offset?: number;
    limit: number;
  } & TListFilters): Promise<EmailStringCursorListResult<TRecord>>;
  get(input: {
    workspaceId: string;
    id: string;
  }): Promise<TRecord | null>;
};

export type EmailFolderRecord = {
  id: number;
  sourceSqliteId: number;
  accountSourceSqliteId: number;
  accountId: number | null;
  path: string;
  delimiter: string | null;
  uidValidity: number | null;
  uidValidityText: string | null;
  lastUid: number;
  lastSyncedAt: string | null;
  pop3Uidl: string | null;
  updatedAt: string;
};

export type EmailFolderListResult = EmailNumericCursorListResult<EmailFolderRecord>;

export type EmailFolderApiPort = EmailNumericRecordApiPort<EmailFolderRecord, {
  accountId?: number;
  search?: string;
}>;

export type EmailTeamMemberRecord = {
  id: string;
  displayName: string;
  role: string;
  signatureHtml: string | null;
  sortOrder: number;
  createdAt: string | null;
  updatedAt: string;
};

export type EmailTeamMemberListResult = EmailStringCursorListResult<EmailTeamMemberRecord>;

export type EmailTeamMemberMutationInput = {
  id?: string;
  displayName?: string;
  role?: string;
  signatureHtml?: string | null;
  sortOrder?: number;
};

export type EmailTeamMemberMutationPortResult =
  | { ok: true; member: EmailTeamMemberRecord }
  | { ok: false; code: 'team_member_conflict' };

export type EmailTeamMemberApiPort = EmailStringRecordApiPort<EmailTeamMemberRecord, {
  search?: string;
  role?: string;
}> & {
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailTeamMemberMutationInput;
  }): Promise<EmailTeamMemberMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: string;
    values: EmailTeamMemberMutationInput;
  }): Promise<EmailTeamMemberRecord | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: string;
  }): Promise<EmailTeamMemberRecord | null>;
};

export type EmailThreadRecord = {
  id: string;
  ticketCode: string;
  accountSourceSqliteId: number | null;
  accountId: number | null;
  rootMessageSourceSqliteId: number | null;
  rootMessageId: number | null;
  lastMessageAt: string | null;
  messageCount: number;
  hasUnread: boolean;
  hasAttachments: boolean;
  subjectNormalized: string | null;
  createdAt: string | null;
  updatedAt: string;
};

export type EmailThreadListResult = EmailStringCursorListResult<EmailThreadRecord>;

export type EmailThreadSplitMessagePortResult =
  | {
    ok: true;
    threadId: string;
    ticketCode: string;
    previousThreadId: string | null;
    thread: EmailThreadRecord;
  }
  | { ok: false; code: 'message_not_found' };

export type EmailThreadApiPort = EmailStringRecordApiPort<EmailThreadRecord, {
  accountId?: number;
  view?: 'inbox' | 'sent' | 'archived' | 'drafts' | 'spam_review' | 'spam' | 'trash' | 'snoozed' | 'all';
  search?: string;
  hasUnread?: boolean;
  hasAttachments?: boolean;
}> & {
  splitMessage?(input: {
    workspaceId: string;
    actorUserId: string;
    messageId: number;
  }): Promise<EmailThreadSplitMessagePortResult>;
};

export type EmailMessageTagRecord = {
  id: number;
  sourceSqliteId: number;
  messageSourceSqliteId: number;
  messageId: number | null;
  tag: string;
  createdAt: string | null;
  updatedAt: string;
};

export type EmailMessageTagListResult = EmailNumericCursorListResult<EmailMessageTagRecord>;

export type EmailMessageTagMutationInput = {
  messageId?: number;
  tag?: string;
};

export type EmailMessageTagMutationPortResult =
  | { ok: true; tag: EmailMessageTagRecord }
  | { ok: false; code: 'message_not_found' | 'tag_conflict' };

export type EmailMessageTagApiPort = EmailNumericRecordApiPort<EmailMessageTagRecord, {
  messageId?: number;
  search?: string;
  tag?: string;
}> & {
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailMessageTagMutationInput;
  }): Promise<EmailMessageTagMutationPortResult>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<EmailMessageTagRecord | null>;
};

export type EmailCategoryRecord = {
  id: number;
  sourceSqliteId: number;
  parentSourceSqliteId: number | null;
  parentId: number | null;
  name: string;
  sortOrder: number;
  createdAt: string | null;
  updatedAt: string;
};

export type EmailCategoryListResult = EmailNumericCursorListResult<EmailCategoryRecord>;

export type EmailCategoryMutationInput = {
  parentId?: number | null;
  name?: string;
  sortOrder?: number;
};

export type EmailCategoryReorderItem = {
  id: number;
  parentId: number | null;
  sortOrder: number;
};

export type EmailCategoryMutationPortResult =
  | { ok: true; category: EmailCategoryRecord }
  | { ok: false; code: 'parent_not_found' | 'invalid_parent' };

export type EmailCategoryReorderPortResult =
  | { ok: true; categories: readonly EmailCategoryRecord[] }
  | { ok: false; code: 'category_not_found' | 'parent_not_found' | 'invalid_parent'; id?: number };

export type EmailCategoryApiPort = EmailNumericRecordApiPort<EmailCategoryRecord, {
  parentId?: number;
  search?: string;
}> & {
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailCategoryMutationInput;
  }): Promise<EmailCategoryMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: EmailCategoryMutationInput;
  }): Promise<EmailCategoryMutationPortResult | null>;
  reorder?(input: {
    workspaceId: string;
    actorUserId: string;
    updates: readonly EmailCategoryReorderItem[];
  }): Promise<EmailCategoryReorderPortResult>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<EmailCategoryRecord | null>;
};

export type EmailMessageCategoryRecord = {
  id: number;
  sourceSqliteId: number;
  messageSourceSqliteId: number;
  categorySourceSqliteId: number;
  messageId: number | null;
  categoryId: number | null;
  updatedAt: string;
};

export type EmailMessageCategoryListResult = EmailNumericCursorListResult<EmailMessageCategoryRecord>;

export type EmailCategoryCountRecord = {
  categoryId: number;
  count: number;
};

export type EmailMessageCategoryMutationInput = {
  messageId?: number;
  categoryId?: number;
};

export type EmailMessageCategoryMutationPortResult =
  | { ok: true; category: EmailMessageCategoryRecord }
  | { ok: false; code: 'message_not_found' | 'category_not_found' | 'category_conflict' };

export type EmailMessageCategoryApiPort = EmailNumericRecordApiPort<EmailMessageCategoryRecord, {
  messageId?: number;
  categoryId?: number;
}> & {
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailMessageCategoryMutationInput;
  }): Promise<EmailMessageCategoryMutationPortResult>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<EmailMessageCategoryRecord | null>;
  listCounts?(input: {
    workspaceId: string;
    accountId?: number;
  }): Promise<readonly EmailCategoryCountRecord[]>;
};

export type EmailInternalNoteRecord = {
  id: number;
  sourceSqliteId: number;
  messageSourceSqliteId: number;
  messageId: number | null;
  body: string;
  createdAt: string | null;
  updatedAt: string;
};

export type EmailInternalNoteListResult = EmailNumericCursorListResult<EmailInternalNoteRecord>;

export type EmailInternalNoteMutationInput = {
  messageId?: number;
  body?: string;
};

export type EmailInternalNoteMutationPortResult =
  | { ok: true; note: EmailInternalNoteRecord }
  | { ok: false; code: 'message_not_found' };

export type EmailInternalNoteApiPort = EmailNumericRecordApiPort<EmailInternalNoteRecord, {
  messageId?: number;
  search?: string;
}> & {
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailInternalNoteMutationInput;
  }): Promise<EmailInternalNoteMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: EmailInternalNoteMutationInput;
  }): Promise<EmailInternalNoteRecord | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<EmailInternalNoteRecord | null>;
};

export type EmailCannedResponseRecord = {
  id: number;
  sourceSqliteId: number;
  title: string;
  body: string;
  accountSourceSqliteId: number | null;
  accountId: number | null;
  overrideKey: string | null;
  sortOrder: number;
  createdAt: string | null;
  updatedAt: string;
};

export type EmailCannedResponseListResult = EmailNumericCursorListResult<EmailCannedResponseRecord>;

export type EmailCannedResponseMutationInput = {
  title?: string;
  body?: string;
  accountId?: number | null;
  overrideKey?: string | null;
  sortOrder?: number;
};

export type EmailCannedResponseApiPort = EmailNumericRecordApiPort<EmailCannedResponseRecord, {
  search?: string;
  accountId?: number;
}> & {
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailCannedResponseMutationInput;
  }): Promise<EmailCannedResponseRecord>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: EmailCannedResponseMutationInput;
  }): Promise<EmailCannedResponseRecord | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<EmailCannedResponseRecord | null>;
};


export type EmailAccountMailSettingsRecord = {
  accountId: number;
  ticketPrefix: string;
  ticketNextNumber: number;
  ticketNumberPadding: number;
  threadNamespace: string;
  updatedAt: string | null;
};

export type EmailAccountMailSettingsMutationInput = {
  accountId: number;
  ticketPrefix?: string;
  ticketNextNumber?: number;
  ticketNumberPadding?: number;
  threadNamespace?: string;
};

export type EmailAccountMailSettingsApiPort = {
  get(input: { workspaceId: string; accountId: number }): Promise<EmailAccountMailSettingsRecord | null>;
  set(input: { workspaceId: string; actorUserId: string; values: EmailAccountMailSettingsMutationInput }): Promise<EmailAccountMailSettingsRecord>;
};

export type EmailAccountSignatureRecord = {
  sourceSqliteId: number;
  accountSourceSqliteId: number;
  accountId: number | null;
  signatureHtml: string | null;
  updatedAt: string;
};

export type EmailAccountSignatureListResult = EmailNumericCursorListResult<EmailAccountSignatureRecord>;

export type EmailAccountSignatureMutationInput = {
  accountId?: number;
  signatureHtml?: string | null;
};

export type EmailAccountSignatureMutationPortResult =
  | { ok: true; signature: EmailAccountSignatureRecord }
  | { ok: false; code: 'account_not_found' | 'signature_conflict' };

export type EmailAccountSignatureApiPort = EmailNumericRecordApiPort<EmailAccountSignatureRecord, {
  accountId?: number;
}> & {
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailAccountSignatureMutationInput;
  }): Promise<EmailAccountSignatureMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: EmailAccountSignatureMutationInput;
  }): Promise<EmailAccountSignatureMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<EmailAccountSignatureRecord | null>;
};

export type EmailRemoteContentAllowlistRecord = {
  id: number;
  sourceSqliteId: number;
  scope: string;
  value: string;
  createdAt: string | null;
  updatedAt: string;
};

export type EmailRemoteContentAllowlistListResult = EmailNumericCursorListResult<EmailRemoteContentAllowlistRecord>;

export type EmailRemoteContentAllowlistMutationInput = {
  scope?: string;
  value?: string;
};

export type EmailRemoteContentAllowlistMutationPortResult =
  | { ok: true; entry: EmailRemoteContentAllowlistRecord }
  | { ok: false; code: 'allowlist_conflict' };

export type EmailRemoteContentAllowlistApiPort = EmailNumericRecordApiPort<EmailRemoteContentAllowlistRecord, {
  scope?: string;
  search?: string;
}> & {
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailRemoteContentAllowlistMutationInput;
  }): Promise<EmailRemoteContentAllowlistMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: EmailRemoteContentAllowlistMutationInput;
  }): Promise<EmailRemoteContentAllowlistMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<EmailRemoteContentAllowlistRecord | null>;
};

export type EmailReadReceiptRecord = {
  id: number;
  sourceSqliteId: number;
  messageSourceSqliteId: number;
  messageId: number | null;
  direction: string;
  recipient: string | null;
  at: string | null;
  updatedAt: string;
};

export type EmailReadReceiptListResult = EmailNumericCursorListResult<EmailReadReceiptRecord>;

export type EmailReadReceiptMutationInput = {
  messageId?: number;
  direction?: string;
  recipient?: string | null;
  at?: string | null;
};

export type EmailReadReceiptMutationPortResult =
  | { ok: true; receipt: EmailReadReceiptRecord }
  | { ok: false; code: 'message_not_found' };

export type EmailReadReceiptApiPort = EmailNumericRecordApiPort<EmailReadReceiptRecord, {
  messageId?: number;
  direction?: string;
}> & {
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailReadReceiptMutationInput;
  }): Promise<EmailReadReceiptMutationPortResult>;
};

export type EmailReadReceiptResponderApiPort = {
  send(input: {
    workspaceId: string;
    actorUserId: string;
    messageId: number;
  }): Promise<EmailReadReceiptResponseResult>;
};

export type EmailThreadEdgeRecord = {
  id: number;
  sourceSqliteId: number;
  parentMessageSourceSqliteId: number;
  childMessageSourceSqliteId: number;
  parentMessageId: number | null;
  childMessageId: number | null;
  updatedAt: string;
};

export type EmailThreadEdgeListResult = EmailNumericCursorListResult<EmailThreadEdgeRecord>;

export type EmailThreadEdgeMutationInput = {
  parentMessageId?: number;
  childMessageId?: number;
};

export type EmailThreadEdgeMutationPortResult =
  | { ok: true; edge: EmailThreadEdgeRecord }
  | { ok: false; code: 'parent_message_not_found' | 'child_message_not_found' | 'edge_conflict' | 'invalid_edge' };

export type EmailThreadEdgeApiPort = EmailNumericRecordApiPort<EmailThreadEdgeRecord, {
  parentMessageId?: number;
  childMessageId?: number;
}> & {
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailThreadEdgeMutationInput;
  }): Promise<EmailThreadEdgeMutationPortResult>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<EmailThreadEdgeRecord | null>;
};

export type EmailThreadAliasRecord = {
  id: number;
  sourceSqliteId: number;
  accountSourceSqliteId: number | null;
  accountId: number | null;
  aliasThreadId: string;
  canonicalThreadId: string;
  confidence: string;
  source: string;
  createdAt: string | null;
  updatedAt: string;
};

export type EmailThreadAliasWarningRecord = {
  messageId: number;
  accountId: number | null;
  subject: string | null;
  aliasThreadId: string;
  canonicalThreadId: string;
  confidence: string;
};

export type EmailThreadAliasListResult = EmailNumericCursorListResult<EmailThreadAliasRecord>;

export type EmailThreadAliasMutationInput = {
  accountId?: number | null;
  aliasThreadId?: string;
  canonicalThreadId?: string;
  confidence?: string;
  source?: string;
};

export type EmailThreadAliasMutationPortResult =
  | { ok: true; alias: EmailThreadAliasRecord }
  | { ok: false; code: 'alias_conflict' | 'invalid_alias' };

export type EmailThreadMergePortResult =
  | {
    ok: true;
    alias: EmailThreadAliasRecord;
    movedMessageCount: number;
    orphanThreadDeleted: boolean;
  }
  | { ok: false; code: 'account_not_found' | 'alias_cycle' | 'invalid_alias' };

export type EmailThreadAliasApiPort = EmailNumericRecordApiPort<EmailThreadAliasRecord, {
  aliasThreadId?: string;
  canonicalThreadId?: string;
  confidence?: string;
  source?: string;
}> & {
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: EmailThreadAliasMutationInput;
  }): Promise<EmailThreadAliasMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: EmailThreadAliasMutationInput;
  }): Promise<EmailThreadAliasMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<EmailThreadAliasRecord | null>;
  listWarnings?(input: {
    workspaceId: string;
    limit?: number;
  }): Promise<readonly EmailThreadAliasWarningRecord[]>;
  merge?(input: {
    workspaceId: string;
    actorUserId: string;
    aliasThreadId: string;
    canonicalThreadId: string;
    accountId: number;
  }): Promise<EmailThreadMergePortResult>;
};

export type AiProfileRecord = {
  id: number;
  sourceSqliteId: number | null;
  label: string;
  provider: string;
  baseUrl: string;
  model: string;
  embeddingModel: string | null;
  isDefault: boolean;
  sortOrder: number;
  apiKeyConfigured: boolean;
  createdAt: string | null;
  updatedAt: string;
};

export type AiProfileListResult = {
  items: readonly AiProfileRecord[];
  nextCursor: number | null;
};

export type AiProfileMutationInput = {
  label?: string;
  provider?: string;
  baseUrl?: string;
  model?: string;
  embeddingModel?: string | null;
  isDefault?: boolean;
  sortOrder?: number;
  apiKey?: string | null;
};

export type AiProfileMutationPortResult =
  | { ok: true; profile: AiProfileRecord }
  | { ok: false; code: 'secret_port_unavailable' };

export type AiProfileApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    cursor?: number;
    limit: number;
  }): Promise<AiProfileListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<AiProfileRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: AiProfileMutationInput;
  }): Promise<AiProfileMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: AiProfileMutationInput;
  }): Promise<AiProfileMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<AiProfileMutationPortResult | null>;
};

export type AiPromptRecord = {
  id: number;
  sourceSqliteId: number | null;
  label: string;
  userTemplate: string;
  target: string;
  profileSourceSqliteId: number | null;
  profileId: number | null;
  accountSourceSqliteId: number | null;
  accountId: number | null;
  overrideKey: string | null;
  sortOrder: number;
  createdAt: string | null;
  updatedAt: string;
};

export type AiPromptListResult = {
  items: readonly AiPromptRecord[];
  nextCursor: number | null;
};

export type AiPromptMutationInput = {
  label?: string;
  userTemplate?: string;
  target?: string;
  profileId?: number | null;
  accountId?: number | null;
  overrideKey?: string | null;
  sortOrder?: number;
};

export type AiPromptReorderItem = {
  id: number;
  sortOrder: number;
};

export type AiPromptMutationPortResult =
  | { ok: true; prompt: AiPromptRecord }
  | { ok: false; code: 'profile_not_found' };

export type AiPromptReorderPortResult =
  | { ok: true; prompts: readonly AiPromptRecord[] }
  | { ok: false; code: 'prompt_not_found'; id?: number };

export type AiPromptApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    target?: string;
    profileId?: number;
    accountId?: number;
    cursor?: number;
    limit: number;
  }): Promise<AiPromptListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<AiPromptRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: AiPromptMutationInput;
  }): Promise<AiPromptMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: AiPromptMutationInput;
  }): Promise<AiPromptMutationPortResult | null>;
  reorder?(input: {
    workspaceId: string;
    actorUserId: string;
    updates: readonly AiPromptReorderItem[];
  }): Promise<AiPromptReorderPortResult>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<AiPromptRecord | null>;
};

export type AiTextTransformInput = {
  workspaceId: string;
  actorUserId?: string;
  promptId: number;
  text: string;
  /** When set, `text` is a selection to rewrite and `contextText` is the full
   *  surrounding email used as context. The AI returns only the rewritten
   *  selection. */
  contextText?: string;
  inboundContextText?: string;
  userContext?: string;
  customerId?: number | null;
  /** Generate new text to insert without replacing the existing draft. */
  insertMode?: boolean;
};

export type AiTextTransformResult =
  | { success: true; text: string }
  | { success: false; error: string };

export type AiTextTransformApiPort = {
  transformText(input: AiTextTransformInput): Promise<AiTextTransformResult>;
};

export type WorkflowRecord = {
  id: number;
  sourceSqliteId: number | null;
  name: string;
  triggerName: string;
  enabled: boolean;
  priority: number;
  definition: unknown;
  graph: unknown | null;
  cronExpr: string | null;
  scheduleAccountSourceSqliteId: number | null;
  scheduleAccountId: number | null;
  accountSourceSqliteId: number | null;
  accountId: number | null;
  overrideKey: string | null;
  executionMode: string;
  engineVersion: number;
  legacyCreatedByUserId: string | null;
  createdByUserId: string | null;
  createdAt: string | null;
  updatedAt: string;
};

export type WorkflowListResult = {
  items: readonly WorkflowRecord[];
  nextCursor: number | null;
};

export type WorkflowMutationInput = {
  name?: string;
  triggerName?: string;
  enabled?: boolean;
  priority?: number;
  definition?: unknown;
  graph?: unknown | null;
  cronExpr?: string | null;
  scheduleAccountId?: number | null;
  accountId?: number | null;
  overrideKey?: string | null;
  executionMode?: string;
  engineVersion?: number;
};

export type WorkflowMutationPortResult =
  | { ok: true; workflow: WorkflowRecord }
  | { ok: false; code: 'schedule_account_not_found' };

export type WorkflowApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    triggerName?: string;
    enabled?: boolean;
    accountId?: number;
    cursor?: number;
    limit: number;
  }): Promise<WorkflowListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<WorkflowRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: WorkflowMutationInput;
  }): Promise<WorkflowMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: WorkflowMutationInput;
  }): Promise<WorkflowMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<WorkflowRecord | null>;
};

export type WorkflowInboundBackfillResult = {
  success: true;
  messages: number;
  workflows: number;
  queued: number;
  clearedApplied: number;
};

export type WorkflowInboundBackfillApiPort = {
  backfill(input: {
    workspaceId: string;
    actorUserId: string;
    limit?: number;
    clearApplied?: boolean;
  }): Promise<WorkflowInboundBackfillResult>;
};

export type WorkflowRuntimeListResult<TRecord> = {
  items: readonly TRecord[];
  nextCursor: number | null;
};

export type WorkflowVersionRecord = {
  id: number;
  sourceSqliteId: number | null;
  workflowSourceSqliteId: number;
  workflowId: number | null;
  label: string;
  graph: unknown;
  definition: unknown;
  createdAt: string | null;
  updatedAt: string;
};

export type WorkflowVersionListResult = WorkflowRuntimeListResult<WorkflowVersionRecord>;

export type WorkflowVersionMutationInput = {
  workflowId?: number;
  label?: string;
  graph?: unknown;
  definition?: unknown;
};

export type WorkflowVersionMutationPortResult =
  | { ok: true; version: WorkflowVersionRecord }
  | { ok: false; code: 'workflow_not_found' };

export type WorkflowVersionApiPort = {
  list(input: {
    workspaceId: string;
    workflowId?: number;
    search?: string;
    cursor?: number;
    limit: number;
  }): Promise<WorkflowVersionListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<WorkflowVersionRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: WorkflowVersionMutationInput;
  }): Promise<WorkflowVersionMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: WorkflowVersionMutationInput;
  }): Promise<WorkflowVersionMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<WorkflowVersionRecord | null>;
};

export type WorkflowRunRecord = {
  id: number;
  sourceSqliteId: number | null;
  workflowSourceSqliteId: number;
  messageSourceSqliteId: number | null;
  workflowId: number | null;
  messageId: number | null;
  direction: string;
  status: string;
  log?: unknown | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type WorkflowRunListResult = WorkflowRuntimeListResult<WorkflowRunRecord>;

export type WorkflowRunApiPort = {
  list(input: {
    workspaceId: string;
    workflowId?: number;
    messageId?: number;
    direction?: string;
    status?: string;
    includeLog: boolean;
    cursor?: number;
    limit: number;
  }): Promise<WorkflowRunListResult>;
  get(input: {
    workspaceId: string;
    id: number;
    includeLog: boolean;
  }): Promise<WorkflowRunRecord | null>;
};

export type WorkflowRunStepRecord = {
  id: number;
  sourceSqliteId: number | null;
  runSourceSqliteId: number;
  runId: number | null;
  nodeId: string;
  nodeType: string;
  status: string;
  port: string | null;
  durationMs: number;
  message: string | null;
  detail?: unknown | null;
  createdAt: string | null;
  updatedAt: string;
};

export type WorkflowRunStepListResult = WorkflowRuntimeListResult<WorkflowRunStepRecord>;

export type WorkflowRunStepApiPort = {
  list(input: {
    workspaceId: string;
    runId?: number;
    nodeId?: string;
    nodeType?: string;
    status?: string;
    includeDetail: boolean;
    cursor?: number;
    limit: number;
  }): Promise<WorkflowRunStepListResult>;
  get(input: {
    workspaceId: string;
    id: number;
    includeDetail: boolean;
  }): Promise<WorkflowRunStepRecord | null>;
};

export type WorkflowMessageAppliedRecord = {
  id: number;
  sourceSqliteId: number;
  messageSourceSqliteId: number;
  workflowSourceSqliteId: number;
  messageId: number | null;
  workflowId: number | null;
  appliedAt: string | null;
  updatedAt: string;
};

export type WorkflowMessageAppliedListResult = WorkflowRuntimeListResult<WorkflowMessageAppliedRecord>;

export type WorkflowMessageAppliedApiPort = {
  list(input: {
    workspaceId: string;
    messageId?: number;
    workflowId?: number;
    cursor?: number;
    limit: number;
  }): Promise<WorkflowMessageAppliedListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<WorkflowMessageAppliedRecord | null>;
};

export type WorkflowForwardDedupRecord = {
  id: number;
  sourceSqliteId: number;
  messageSourceSqliteId: number;
  workflowSourceSqliteId: number;
  messageId: number | null;
  workflowId: number | null;
  dest: string;
  createdAt: string | null;
  updatedAt: string;
};

export type WorkflowForwardDedupListResult = WorkflowRuntimeListResult<WorkflowForwardDedupRecord>;

export type WorkflowForwardDedupApiPort = {
  list(input: {
    workspaceId: string;
    messageId?: number;
    workflowId?: number;
    dest?: string;
    cursor?: number;
    limit: number;
  }): Promise<WorkflowForwardDedupListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<WorkflowForwardDedupRecord | null>;
};

export type WorkflowKnowledgeBaseRecord = {
  id: number;
  sourceSqliteId: number | null;
  name: string;
  description: string | null;
  accountSourceSqliteId: number | null;
  accountId: number | null;
  overrideKey: string | null;
  knowledgeContext: string | null;
  createdAt: string | null;
  updatedAt: string;
};

export type WorkflowKnowledgeBaseListResult = WorkflowRuntimeListResult<WorkflowKnowledgeBaseRecord>;

export type WorkflowKnowledgeBaseMutationInput = {
  name?: string;
  description?: string | null;
  accountId?: number | null;
  overrideKey?: string | null;
  knowledgeContext?: string | null;
};

export type WorkflowKnowledgeBaseApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    accountId?: number;
    cursor?: number;
    limit: number;
  }): Promise<WorkflowKnowledgeBaseListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<WorkflowKnowledgeBaseRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: WorkflowKnowledgeBaseMutationInput;
  }): Promise<WorkflowKnowledgeBaseRecord>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: WorkflowKnowledgeBaseMutationInput;
  }): Promise<WorkflowKnowledgeBaseRecord | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<WorkflowKnowledgeBaseRecord | null>;
};

export type WorkflowKnowledgeChunkRecord = {
  id: number;
  sourceSqliteId: number | null;
  knowledgeBaseSourceSqliteId: number;
  knowledgeBaseId: number | null;
  title: string | null;
  content?: string;
  sourcePath: string | null;
  embeddingConfigured: boolean;
  createdAt: string | null;
  updatedAt: string;
};

export type WorkflowKnowledgeChunkListResult = WorkflowRuntimeListResult<WorkflowKnowledgeChunkRecord>;

export type WorkflowKnowledgeChunkMutationInput = {
  knowledgeBaseId?: number;
  title?: string | null;
  content?: string;
  sourcePath?: string | null;
};

export type WorkflowKnowledgeChunkMutationPortResult =
  | { ok: true; chunk: WorkflowKnowledgeChunkRecord }
  | { ok: false; code: 'knowledge_base_not_found' };

export type WorkflowKnowledgeChunkApiPort = {
  list(input: {
    workspaceId: string;
    knowledgeBaseId?: number;
    search?: string;
    includeContent: boolean;
    cursor?: number;
    limit: number;
  }): Promise<WorkflowKnowledgeChunkListResult>;
  get(input: {
    workspaceId: string;
    id: number;
    includeContent: boolean;
  }): Promise<WorkflowKnowledgeChunkRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: WorkflowKnowledgeChunkMutationInput;
  }): Promise<WorkflowKnowledgeChunkMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: WorkflowKnowledgeChunkMutationInput;
  }): Promise<WorkflowKnowledgeChunkMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<WorkflowKnowledgeChunkRecord | null>;
};

export type WorkflowDelayedJobRecord = {
  id: number;
  sourceSqliteId: number | null;
  workflowSourceSqliteId: number;
  messageSourceSqliteId: number | null;
  workflowId: number | null;
  messageId: number | null;
  resumeNodeId: string | null;
  executeAt: string;
  context?: unknown | null;
  status: string;
  createdAt: string | null;
  updatedAt: string;
};

export type WorkflowDelayedJobListResult = WorkflowRuntimeListResult<WorkflowDelayedJobRecord>;

export type WorkflowDelayedJobMutationInput = {
  workflowId?: number;
  messageId?: number | null;
  resumeNodeId?: string | null;
  executeAt?: string;
  context?: unknown | null;
  status?: string;
};

export type WorkflowDelayedJobMutationPortResult =
  | { ok: true; job: WorkflowDelayedJobRecord }
  | { ok: false; code: 'workflow_not_found' | 'message_not_found' };

export type WorkflowDelayedJobApiPort = {
  list(input: {
    workspaceId: string;
    workflowId?: number;
    messageId?: number;
    status?: string;
    includeContext: boolean;
    cursor?: number;
    limit: number;
  }): Promise<WorkflowDelayedJobListResult>;
  get(input: {
    workspaceId: string;
    id: number;
    includeContext: boolean;
  }): Promise<WorkflowDelayedJobRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: WorkflowDelayedJobMutationInput;
  }): Promise<WorkflowDelayedJobMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: WorkflowDelayedJobMutationInput;
  }): Promise<WorkflowDelayedJobMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<WorkflowDelayedJobRecord | null>;
};

export type WorkflowTemplateApiPort = {
  list(input: {
    workspaceId: string;
  }): Promise<readonly WorkflowTemplate[]> | readonly WorkflowTemplate[];
};

export type WorkflowNodeCatalogApiPort = {
  list(input: {
    workspaceId: string;
  }): Promise<readonly WorkflowNodeCatalogEntry[]> | readonly WorkflowNodeCatalogEntry[];
};

export type PgpIdentityRecord = {
  id: number;
  sourceSqliteId: number | null;
  userId: string | null;
  legacyUserId: string | null;
  email: string;
  fingerprint: string;
  publicKeyArmor: string;
  hasPrivateKey: boolean;
  privateKeyConfigured: boolean;
  expiresAt: string | null;
  isPrimary: boolean;
  createdAt: string | null;
  updatedAt: string;
};

export type PgpIdentityListResult = {
  items: readonly PgpIdentityRecord[];
  nextCursor: number | null;
};

export type PgpIdentityMutationInput = {
  email?: string;
  fingerprint?: string;
  publicKeyArmor?: string;
  privateKeyArmored?: string | null;
  privateKeyPassphrase?: string;
  expiresAt?: string | null;
  isPrimary?: boolean;
};

export type PgpIdentityMutationPortResult =
  | { ok: true; identity: PgpIdentityRecord }
  | { ok: false; code: 'fingerprint_conflict' | 'private_key_secret_unavailable' | 'private_key_rewrite_required' };

export type PgpIdentityPassphraseRotationPortResult =
  | { ok: true; identity: PgpIdentityRecord }
  | {
      ok: false;
      code:
        | 'private_key_unavailable'
        | 'private_key_secret_unavailable'
        | 'decrypt_failed';
    };

export type PgpIdentityApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    email?: string;
    cursor?: number;
    limit: number;
  }): Promise<PgpIdentityListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<PgpIdentityRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: PgpIdentityMutationInput;
  }): Promise<PgpIdentityMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: PgpIdentityMutationInput;
  }): Promise<PgpIdentityMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<PgpIdentityMutationPortResult | null>;
  rotatePrivateKeyPassphrase?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    currentPassphrase: string;
    nextPassphrase: string;
  }): Promise<PgpIdentityPassphraseRotationPortResult | null>;
};

export type PgpPeerKeyRecord = {
  id: number;
  sourceSqliteId: number | null;
  email: string;
  fingerprint: string;
  publicKeyArmor: string;
  source: string;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
  legacyVerifiedByUserId: string | null;
  trustLevel: string;
  createdAt: string | null;
  updatedAt: string;
};

export type PgpPeerKeyListResult = {
  items: readonly PgpPeerKeyRecord[];
  nextCursor: number | null;
};

export type PgpPeerKeyMutationInput = {
  email?: string;
  fingerprint?: string;
  publicKeyArmor?: string;
  source?: string;
  verifiedAt?: string | null;
  trustLevel?: string;
};

export type PgpPeerKeyMutationPortResult =
  | { ok: true; peerKey: PgpPeerKeyRecord }
  | { ok: false; code: 'fingerprint_conflict' };

export type PgpPeerKeyApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    email?: string;
    trustLevel?: string;
    cursor?: number;
    limit: number;
  }): Promise<PgpPeerKeyListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<PgpPeerKeyRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: PgpPeerKeyMutationInput;
  }): Promise<PgpPeerKeyMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: PgpPeerKeyMutationInput;
  }): Promise<PgpPeerKeyMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<PgpPeerKeyRecord | null>;
};

export type PgpKeyMaterialPort = {
  generateIdentity(input: {
    email: string;
    passphrase: string;
  }): Promise<{
    fingerprint: string;
    publicKeyArmor: string;
    privateKeyArmored: string;
  }>;
  readPublicKey(input: {
    armored: string;
  }): Promise<{
    email: string;
    fingerprint: string;
  }>;
};

export type PgpMessageDecryptResult = {
  text: string;
  status: 'decrypted';
};

export type PgpAttachmentDecryptResult = {
  filename: string;
  contentType: string | null;
  content: Uint8Array;
  status: 'decrypted';
};

export type PgpMessageVerifyResult = {
  valid: boolean;
  status: string;
  fingerprint?: string;
};

export type PgpAttachmentVerifyResult = PgpMessageVerifyResult;

export type PgpMessageDetectResult = {
  detected: boolean;
  status: string | null;
};

export type PgpMessageDecryptFailureCode =
  | 'message_not_found'
  | 'not_pgp_message'
  | 'private_key_unavailable'
  | 'private_key_secret_unavailable'
  | 'decrypt_failed';

export type PgpMessageDetectFailureCode =
  | 'message_not_found';

export type PgpMessageVerifyFailureCode =
  | 'message_not_found'
  | 'not_signed'
  | 'verify_failed';

export type PgpAttachmentDecryptFailureCode =
  | 'not_pgp_attachment'
  | 'private_key_unavailable'
  | 'private_key_secret_unavailable'
  | 'decrypt_failed';

export type PgpAttachmentVerifyFailureCode =
  | 'not_signed'
  | 'verify_failed';

export type PgpMessageDecryptPortResult =
  | { ok: true; result: PgpMessageDecryptResult }
  | { ok: false; code: PgpMessageDecryptFailureCode; message?: string };

export type PgpMessageVerifyPortResult =
  | { ok: true; result: PgpMessageVerifyResult }
  | { ok: false; code: PgpMessageVerifyFailureCode; message?: string };

export type PgpMessageDetectPortResult =
  | { ok: true; result: PgpMessageDetectResult }
  | { ok: false; code: PgpMessageDetectFailureCode; message?: string };

export type PgpAttachmentDecryptPortResult =
  | { ok: true; result: PgpAttachmentDecryptResult }
  | { ok: false; code: PgpAttachmentDecryptFailureCode; message?: string };

export type PgpAttachmentVerifyPortResult =
  | { ok: true; result: PgpAttachmentVerifyResult }
  | { ok: false; code: PgpAttachmentVerifyFailureCode; message?: string };

export type PgpMessageCryptoApiPort = {
  decryptMessage(input: {
    workspaceId: string;
    actorUserId: string;
    messageId: number;
    passphrase: string;
  }): Promise<PgpMessageDecryptPortResult>;
  detectMessage?(input: {
    workspaceId: string;
    actorUserId: string;
    messageId: number;
  }): Promise<PgpMessageDetectPortResult>;
  verifyMessage(input: {
    workspaceId: string;
    actorUserId: string;
    messageId: number;
  }): Promise<PgpMessageVerifyPortResult>;
  decryptAttachment?(input: {
    workspaceId: string;
    actorUserId: string;
    attachment: {
      id: number;
      filename: string;
      contentType?: string | null;
      bytes: Uint8Array;
    };
    passphrase: string;
  }): Promise<PgpAttachmentDecryptPortResult>;
  verifyAttachment?(input: {
    workspaceId: string;
    actorUserId: string;
    signerEmail?: string;
    attachment: {
      id: number;
      filename: string;
      contentType?: string | null;
      bytes: Uint8Array;
    };
    signature: {
      id?: number;
      filename?: string;
      contentType?: string | null;
      bytes: Uint8Array;
    };
  }): Promise<PgpAttachmentVerifyPortResult>;
  prepareOutboundBody(input: {
    workspaceId: string;
    actorUserId: string;
    bodyText: string;
    recipientEmails: readonly string[];
    encrypt?: boolean;
    sign?: boolean;
    passphrase?: string;
  }): Promise<
    | { ok: true; bodyText: string }
    | { ok: false; error: string }
  >;
  prepareOutboundAttachments?(input: {
    workspaceId: string;
    actorUserId: string;
    attachments: readonly {
      filename: string;
      contentType?: string;
      bytes: Uint8Array;
    }[];
    recipientEmails: readonly string[];
    encrypt?: boolean;
    sign?: boolean;
    passphrase?: string;
  }): Promise<
    | {
      ok: true;
      attachments: readonly {
        filename: string;
        contentType?: string;
        content: Uint8Array;
      }[];
    }
    | { ok: false; error: string }
  >;
};

export type SpamListEntryRecord = {
  id: number;
  sourceSqliteId: number | null;
  listType: 'allow' | 'block';
  patternType: 'email' | 'domain';
  pattern: string;
  accountSourceSqliteId: number | null;
  accountId: number | null;
  note: string | null;
  createdAt: string | null;
  updatedAt: string;
};

export type SpamListEntryListResult = {
  items: readonly SpamListEntryRecord[];
  nextCursor: number | null;
};

export type SpamListEntryMutationInput = {
  listType?: 'allow' | 'block';
  patternType?: 'email' | 'domain';
  pattern?: string;
  accountId?: number | null;
  note?: string | null;
};

export type SpamListEntryMutationPortResult =
  | { ok: true; entry: SpamListEntryRecord }
  | { ok: false; code: 'account_not_found' | 'entry_conflict' };

export type SpamListEntryApiPort = {
  list(input: {
    workspaceId: string;
    listType?: 'allow' | 'block';
    patternType?: 'email' | 'domain';
    accountId?: number;
    search?: string;
    cursor?: number;
    limit: number;
  }): Promise<SpamListEntryListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<SpamListEntryRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: SpamListEntryMutationInput;
  }): Promise<SpamListEntryMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: SpamListEntryMutationInput;
  }): Promise<SpamListEntryMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<SpamListEntryRecord | null>;
};

export type SpamLearningEventRecord = {
  id: number;
  sourceSqliteId: number | null;
  messageSourceSqliteId: number | null;
  accountSourceSqliteId: number;
  messageId: number | null;
  accountId: number | null;
  label: 'spam' | 'ham';
  source: string;
  featureKeys: unknown | null;
  createdAt: string | null;
  updatedAt: string;
};

export type SpamLearningEventListResult = {
  items: readonly SpamLearningEventRecord[];
  nextCursor: number | null;
};

export type SpamLearningEventMutationInput = {
  accountId?: number;
  messageId?: number | null;
  label?: 'spam' | 'ham';
  source?: string;
  featureKeys?: unknown | null;
};

export type SpamLearningEventMutationPortResult =
  | { ok: true; event: SpamLearningEventRecord }
  | { ok: false; code: 'account_not_found' | 'message_not_found' | 'message_account_mismatch' };

export type SpamLearningEventApiPort = {
  list(input: {
    workspaceId: string;
    label?: 'spam' | 'ham';
    accountId?: number;
    messageId?: number;
    cursor?: number;
    limit: number;
  }): Promise<SpamLearningEventListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<SpamLearningEventRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: SpamLearningEventMutationInput;
  }): Promise<SpamLearningEventMutationPortResult>;
};

export type SpamDecisionRecord = {
  id: number;
  sourceSqliteId: number | null;
  messageSourceSqliteId: number | null;
  accountSourceSqliteId: number;
  messageId: number | null;
  accountId: number | null;
  score: number;
  status: 'clean' | 'review' | 'spam';
  source: string;
  breakdown: unknown | null;
  modelVersion: number;
  createdAt: string | null;
  updatedAt: string;
};

export type SpamDecisionListResult = {
  items: readonly SpamDecisionRecord[];
  nextCursor: number | null;
};

export type SpamDecisionMutationInput = {
  accountId?: number;
  messageId?: number | null;
  score?: number;
  status?: 'clean' | 'review' | 'spam';
  source?: string;
  breakdown?: unknown | null;
  modelVersion?: number;
};

export type SpamDecisionMutationPortResult =
  | { ok: true; decision: SpamDecisionRecord }
  | { ok: false; code: 'account_not_found' | 'message_not_found' | 'message_account_mismatch' };

export type SpamDecisionApiPort = {
  list(input: {
    workspaceId: string;
    status?: 'clean' | 'review' | 'spam';
    accountId?: number;
    messageId?: number;
    cursor?: number;
    limit: number;
  }): Promise<SpamDecisionListResult>;
  get(input: {
    workspaceId: string;
    id: number;
  }): Promise<SpamDecisionRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: SpamDecisionMutationInput;
  }): Promise<SpamDecisionMutationPortResult>;
  update?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    values: SpamDecisionMutationInput;
  }): Promise<SpamDecisionMutationPortResult | null>;
  delete?(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
  }): Promise<SpamDecisionRecord | null>;
};

export type SpamFeatureStatRecord = {
  featureKey: string;
  spamCount: number;
  hamCount: number;
  updatedAt: string;
};

export type SpamFeatureStatListResult = {
  items: readonly SpamFeatureStatRecord[];
  nextCursor: string | null;
};

export type SpamFeatureStatApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    cursor?: string;
    limit: number;
  }): Promise<SpamFeatureStatListResult>;
  get(input: {
    workspaceId: string;
    featureKey: string;
  }): Promise<SpamFeatureStatRecord | null>;
};

export type AutomationApiKeyRecord = {
  id: string;
  label: string;
  scopes: unknown;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdByUserId: string | null;
  secretConfigured: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AutomationApiKeyListResult = {
  items: readonly AutomationApiKeyRecord[];
  nextCursor: string | null;
};

export type AutomationApiKeyMutationInput = {
  label?: string;
  scopes?: readonly string[];
};

export type AutomationApiKeyCreateResult =
  | { ok: true; apiKey: AutomationApiKeyRecord; key: string }
  | { ok: false; code: 'secret_port_unavailable' };

export type AutomationApiKeyRevokeResult =
  | { ok: true; apiKey: AutomationApiKeyRecord }
  | { ok: false; code: 'secret_port_unavailable' };

export type AutomationApiKeyApiPort = {
  list(input: {
    workspaceId: string;
    search?: string;
    revoked?: boolean;
    cursor?: string;
    limit: number;
  }): Promise<AutomationApiKeyListResult>;
  get(input: {
    workspaceId: string;
    id: string;
  }): Promise<AutomationApiKeyRecord | null>;
  create?(input: {
    workspaceId: string;
    actorUserId: string;
    values: AutomationApiKeyMutationInput;
  }): Promise<AutomationApiKeyCreateResult>;
  revoke?(input: {
    workspaceId: string;
    actorUserId: string;
    id: string;
  }): Promise<AutomationApiKeyRevokeResult | null>;
  verify?(input: {
    key: string;
    requiredScope?: string;
  }): Promise<AuthenticatedPrincipal | null>;
};

export type ServerJobQueueApiPort = Readonly<{
  enqueue(input: EnqueueJobInput): Promise<unknown>;
  releaseAccountSyncLocks?(input: {
    workspaceId: string;
    accountId: number;
    staleBefore: Date;
    limit?: number;
  }): Promise<readonly unknown[]>;
}>;

export type ServerWorkflowExecutionApiPort = Readonly<{
  dryRun(input: WorkflowExecutionJobPlan): Promise<WorkflowExecutionDryRunResult>;
}>;

export type MssqlSettingsApiPort = Pick<
  MssqlSettingsPort,
  'getSettings' | 'saveSettings' | 'clearPassword' | 'testConnection'
>;

export type { MssqlSettingsInput };

/**
 * Readiness probe port. `pingDatabase` resolves when the database is reachable
 * and rejects otherwise; the `/health/ready` route uses it to report 200/503 so
 * orchestrators can distinguish "process alive" (liveness, `/health`) from
 * "can serve requests" (readiness). Optional — when absent the readiness route
 * degrades to a shallow OK.
 */
export type HealthCheckApiPort = {
  pingDatabase(): Promise<void>;
};

export type ServerLogReadEntry = {
  time: string;
  level: 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  source: string;
};

export type ServerLogReadPort = {
  recent(options?: { level?: 'info' | 'warn' | 'error' | 'fatal'; limit?: number }): readonly ServerLogReadEntry[];
  /** Emits sample info/warn/error entries so operators can verify the pipeline. */
  selfTest(): number;
  clear(): void;
  count(): number;
};

/** Status lifecycle / outcome / condition enums live in the DB-schema module
 *  so the Kysely table types and the API records share one source of truth. */
export type { ReturnStatus, ReturnOutcome, ReturnItemCondition } from '../db/schema';
import type { ReturnItemCondition, ReturnOutcome, ReturnStatus } from '../db/schema';

export type ReturnReasonRecord = {
  id: number;
  code: string;
  label: string;
  isActive: boolean;
  sortOrder: number;
};

export type ReturnItemRecord = {
  id: number;
  returnId: number;
  productId: number | null;
  reasonId: number | null;
  sku: string | null;
  productName: string | null;
  quantity: number;
  condition: ReturnItemCondition | null;
  notes: string | null;
};

export type ReturnRecord = {
  id: number;
  returnNumber: string;
  customerId: number | null;
  emailMessageId: number | null;
  jtlOrderNumber: string | null;
  jtlKauftrag: number | null;
  status: ReturnStatus;
  outcome: ReturnOutcome | null;
  customerEmail: string | null;
  customerName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: ReturnItemRecord[];
};

export type ReturnItemMutationInput = {
  productId?: number | null;
  reasonId?: number | null;
  sku?: string | null;
  productName?: string | null;
  quantity: number;
  condition?: ReturnItemCondition | null;
  notes?: string | null;
};

export type ReturnCreateInput = {
  customerId?: number | null;
  emailMessageId?: number | null;
  jtlOrderNumber?: string | null;
  jtlKauftrag?: number | null;
  customerEmail?: string | null;
  customerName?: string | null;
  notes?: string | null;
  items: readonly ReturnItemMutationInput[];
};

export type ReturnUpdateInput = {
  status?: ReturnStatus;
  outcome?: ReturnOutcome | null;
  notes?: string | null;
};

export type ReturnListInput = {
  workspaceId: string;
  limit: number;
  offset?: number;
  status?: ReturnStatus;
  customerId?: number;
  search?: string;
};

export type ReturnListResult = {
  items: readonly ReturnRecord[];
  totalCount: number;
};

export type ReturnsAnalyticsInput = {
  workspaceId: string;
  /** Optional rolling window; when set, only returns created in the last N days count. */
  sinceDays?: number;
};

export type ReturnsAnalyticsResult = {
  totalCount: number;
  /** Counts per status, descending by count. Only non-zero buckets are listed. */
  byStatus: ReadonlyArray<{ status: ReturnStatus; count: number }>;
  /** Counts per outcome; `outcome: null` is the not-yet-decided bucket. */
  byOutcome: ReadonlyArray<{ outcome: ReturnOutcome | null; count: number }>;
  /**
   * Top return reasons by item count. `reasonId: null` groups items with no
   * reason set; code/label are null for that bucket and for reasons that were
   * since deleted.
   */
  topReasons: ReadonlyArray<{
    reasonId: number | null;
    code: string | null;
    label: string | null;
    count: number;
  }>;
  generatedAt: string;
};

export type ReturnsApiPort = {
  list(input: ReturnListInput): Promise<ReturnListResult>;
  get(input: { workspaceId: string; id: number }): Promise<ReturnRecord | null>;
  create(input: {
    workspaceId: string;
    actorUserId: string;
    input: ReturnCreateInput;
  }): Promise<{ ok: true; record: ReturnRecord } | { ok: false; error: string }>;
  update(input: {
    workspaceId: string;
    actorUserId: string;
    id: number;
    update: ReturnUpdateInput;
  }): Promise<{ ok: true; record: ReturnRecord } | { ok: false; error: string }>;
  analytics(input: ReturnsAnalyticsInput): Promise<ReturnsAnalyticsResult>;
  /**
   * Public-shaped lookup by return_number. Returns the narrowed PortalReturnRecord
   * (no internal IDs, no customer PII beyond what the customer typed themselves),
   * or null when not found. The lookup is case-insensitive on return_number so
   * URLs printed in e-mails are forgiving.
   */
  getPublicByReturnNumber(input: {
    workspaceId: string;
    returnNumber: string;
  }): Promise<PortalReturnRecord | null>;
  /**
   * Public-shaped create. Same idempotency rules as create() but no actor,
   * and the resulting record is the narrowed PortalReturnRecord.
   */
  createPublic(input: {
    workspaceId: string;
    input: PortalReturnCreateInput;
  }): Promise<{ ok: true; record: PortalReturnRecord } | { ok: false; error: string }>;
};

export type ReturnReasonsApiPort = {
  /**
   * Returns the active reasons for the workspace, seeding a default vocabulary
   * (size_wrong, not_liked, defective, wrong_item, late_delivery, other) on
   * first call when the workspace has none. Idempotent.
   */
  list(input: { workspaceId: string }): Promise<readonly ReturnReasonRecord[]>;
};

// ---------------------------------------------------------------------------
// Portal settings (Phase 5/6: public customer portal)
//
// One row per workspace. The token is the sole credential the public portal
// uses to resolve a workspace, so rotating it invalidates every public URL
// previously printed. The `enabled` flag pauses public creates without
// destroying the URL (useful for short maintenance windows).
// ---------------------------------------------------------------------------

export type ReturnsPortalSettings = {
  enabled: boolean;
  /** Present only when admin reads the settings; never echoed to public requests. */
  token: string | null;
  /** Stable identifier the admin UI shows ("•••• last 4") even when token is hidden. */
  hasToken: boolean;
  updatedAt: string | null;
};

export type ReturnsPortalResolveResult =
  | { ok: true; workspaceId: string; enabled: true }
  | { ok: false; reason: 'unknown_token' | 'portal_disabled' };

export type ReturnsPortalSettingsApiPort = {
  get(input: { workspaceId: string }): Promise<ReturnsPortalSettings>;
  /** Rotates (or first-creates) the token. Returns the new settings including the cleartext token once. */
  rotate(input: { workspaceId: string; enable?: boolean }): Promise<ReturnsPortalSettings>;
  /** Sets `enabled` without touching the token. */
  setEnabled(input: { workspaceId: string; enabled: boolean }): Promise<ReturnsPortalSettings>;
  /** Clears the token entirely; the next public request fails until rotate() is called. */
  revoke(input: { workspaceId: string }): Promise<ReturnsPortalSettings>;
  /** Cross-workspace lookup used by the public dispatcher. Bypasses RLS by design. */
  resolveByToken(input: { token: string }): Promise<ReturnsPortalResolveResult>;
};

// ---------------------------------------------------------------------------
// Public portal records (a narrowed shape — never leaks internal fields)
// ---------------------------------------------------------------------------

export type PortalReturnItem = {
  sku: string | null;
  productName: string | null;
  quantity: number;
  condition: ReturnItemCondition | null;
  reasonCode: string | null;
  reasonLabel: string | null;
};

export type PortalReturnRecord = {
  returnNumber: string;
  status: ReturnStatus;
  outcome: ReturnOutcome | null;
  jtlOrderNumber: string | null;
  createdAt: string;
  updatedAt: string;
  items: readonly PortalReturnItem[];
};

export type PortalReturnCreateInput = {
  jtlOrderNumber?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  notes?: string | null;
  items: readonly ReturnItemMutationInput[];
};

export type ServerApiPorts = {
  activityLog?: ActivityLogApiPort;
  auth: AuthApiPort;
  /** When set, POST /auth/initial-setup requires matching X-Initial-Setup-Token header or setupToken body field. */
  initialSetupToken?: string;
  /**
   * Login hardening (CAPTCHA, PIN, MFA). Strongly recommended for deployments
   * that enable the public returns portal: the portal's CAPTCHA gate degrades
   * open when this port is missing (visible as captcha:'unavailable' in the
   * returns.portal.create audit metadata).
   */
  loginSecurity?: LoginSecurityApiPort;
  health?: HealthCheckApiPort;
  serverLogs?: ServerLogReadPort;
  calendarEvents?: CalendarEventApiPort;
  locks: ConversationLockApiPort;
  audit?: AuditApiPort;
  authInvitationMailer?: AuthInvitationMailerApiPort;
  mssqlSettings?: MssqlSettingsApiPort;
  aiReplySuggestions?: AiReplySuggestionApiPort;
  aiProfiles?: AiProfileApiPort;
  aiPrompts?: AiPromptApiPort;
  aiTextTransform?: AiTextTransformApiPort;
  automationApiKeys?: AutomationApiKeyApiPort;
  customerCustomFields?: CustomerCustomFieldApiPort;
  customerCustomFieldValues?: CustomerCustomFieldValueApiPort;
  customers?: CustomerApiPort;
  userGroups?: UserGroupApiPort;
  dashboard?: DashboardApiPort;
  deals?: DealApiPort;
  dealProducts?: DealProductApiPort;
  emailAccountMailSettings?: EmailAccountMailSettingsApiPort;
  emailAccountSignatures?: EmailAccountSignatureApiPort;
  emailAttachmentContent?: EmailAttachmentContentApiPort;
  emailAttachments?: EmailAttachmentApiPort;
  emailAccounts?: EmailAccountApiPort;
  emailCannedResponses?: EmailCannedResponseApiPort;
  emailCategories?: EmailCategoryApiPort;
  emailComposeAttachments?: EmailComposeAttachmentUploadApiPort;
  emailComposeSender?: EmailComposeSenderApiPort;
  emailOutboundValidation?: EmailOutboundValidationApiPort;
  emailDiagnostics?: EmailDiagnosticsApiPort;
  emailFolders?: EmailFolderApiPort;
  emailGdprExport?: EmailGdprExportApiPort;
  emailInternalNotes?: EmailInternalNoteApiPort;
  emailMessageCategories?: EmailMessageCategoryApiPort;
  emailMessageTags?: EmailMessageTagApiPort;
  emailMessages?: EmailMessageApiPort;
  mailConnectionTests?: MailConnectionTestApiPort;
  emailVacationTests?: EmailVacationTestApiPort;
  emailOAuth?: EmailOAuthApiPort;
  emailReadReceipts?: EmailReadReceiptApiPort;
  emailReadReceiptResponder?: EmailReadReceiptResponderApiPort;
  emailReporting?: EmailReportingApiPort;
  emailRemoteContentAllowlist?: EmailRemoteContentAllowlistApiPort;
  emailTeamMembers?: EmailTeamMemberApiPort;
  emailThreadAliases?: EmailThreadAliasApiPort;
  emailThreadEdges?: EmailThreadEdgeApiPort;
  emailThreads?: EmailThreadApiPort;
  events?: ServerEventPort;
  followUp?: FollowUpApiPort;
  jobQueue?: ServerJobQueueApiPort;
  jtlFirmen?: JtlReferenceApiPort;
  jtlOrders?: JtlOrderApiPort;
  jtlOrderLookup?: JtlOrderLookupApiPort;
  jtlSync?: JtlSyncApiPort;
  jtlVersandarten?: JtlReferenceApiPort;
  jtlWarenlager?: JtlReferenceApiPort;
  jtlZahlungsarten?: JtlReferenceApiPort;
  pgpIdentities?: PgpIdentityApiPort;
  pgpKeyMaterial?: PgpKeyMaterialPort;
  pgpMessages?: PgpMessageCryptoApiPort;
  pgpPeerKeys?: PgpPeerKeyApiPort;
  products?: ProductApiPort;
  returns?: ReturnsApiPort;
  returnReasons?: ReturnReasonsApiPort;
  returnsPortalSettings?: ReturnsPortalSettingsApiPort;
  spamDecisions?: SpamDecisionApiPort;
  spamFeatureStats?: SpamFeatureStatApiPort;
  spamLearningEvents?: SpamLearningEventApiPort;
  spamListEntries?: SpamListEntryApiPort;
  savedViews?: SavedViewApiPort;
  syncInfo?: SyncInfoApiPort;
  tasks?: TaskApiPort;
  workflowDelayedJobs?: WorkflowDelayedJobApiPort;
  workflowExecution?: ServerWorkflowExecutionApiPort;
  workflowForwardDedup?: WorkflowForwardDedupApiPort;
  workflowKnowledgeBases?: WorkflowKnowledgeBaseApiPort;
  workflowKnowledgeChunks?: WorkflowKnowledgeChunkApiPort;
  workflowMessageApplied?: WorkflowMessageAppliedApiPort;
  workflowInboundBackfill?: WorkflowInboundBackfillApiPort;
  workflowRuns?: WorkflowRunApiPort;
  workflowRunSteps?: WorkflowRunStepApiPort;
  workflowNodeCatalog?: WorkflowNodeCatalogApiPort;
  workflowTemplates?: WorkflowTemplateApiPort;
  workflowVersions?: WorkflowVersionApiPort;
  workflows?: WorkflowApiPort;
  maintenance?: ServerMaintenanceApiPort;
};

export function json<T>(status: number, body: T, headers?: Record<string, string>): ApiResponse<T> {
  return { status, body, headers };
}

export function data<T>(status: number, value: T): ApiResponse<ApiDataBody<T>> {
  return json(status, { data: value });
}

export function error(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): ApiResponse<ApiErrorBody> {
  return json(status, {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  });
}

export function requirePrincipal(req: ApiRequest): AuthenticatedPrincipal | ApiResponse<ApiErrorBody> {
  if (req.principal) return req.principal;
  return error(401, 'unauthorized', 'Authentifizierung erforderlich');
}

export function requireAdmin(principal: AuthenticatedPrincipal): boolean {
  return principal.role === 'owner' || principal.role === 'admin';
}

export function positiveIntFromPath(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export function getStringField(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}
