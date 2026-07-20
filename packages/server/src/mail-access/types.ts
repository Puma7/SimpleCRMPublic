import type { MailPermission, MailResource } from '@simplecrm/core';

export type MailAccessActor = Readonly<{
  workspaceId: string;
  userId: string;
  isOwner: boolean;
  isAdmin: boolean;
}>;

export type MailAccessGrant =
  | Readonly<{ resourceType: 'account'; accountId: number; folderId: null; messageId: null }>
  | Readonly<{ resourceType: 'folder'; accountId: number; folderId: number; messageId: null }>
  | Readonly<{
    resourceType: 'message';
    accountId: number;
    folderId: number;
    messageId: number;
  }>;

export type MailSqlScope =
  | Readonly<{ kind: 'all' }>
  | Readonly<{ kind: 'none' }>
  | Readonly<{
    kind: 'restricted';
    accountIds: readonly number[];
    folderIds: readonly number[];
    messageIds: readonly number[];
  }>;

export type ResolveMailAccessGrantsInput = Readonly<{
  workspaceId: string;
  userId: string;
  permission: MailPermission;
}>;

export type MailAclRolloutEvaluationContext = Readonly<{
  workspaceId: string;
}>;

export interface MailAccessPort {
  resolveGrants(
    input: ResolveMailAccessGrantsInput,
    evaluationContext?: MailAclRolloutEvaluationContext,
  ): Promise<readonly MailAccessGrant[]>;
}

export interface MailAccessService {
  assertPermission(input: Readonly<{
    workspaceId: string;
    actor: MailAccessActor;
    permission: MailPermission;
    resource: MailResource;
  }>): Promise<void>;

  resolveScope(input: Readonly<{
    workspaceId: string;
    actor: MailAccessActor;
    permission: MailPermission;
  }>): Promise<MailSqlScope>;
}

export type MailAclRolloutMode = 'shadow' | 'enforce';

export type MailAclRolloutPersistentDiagnosticCode =
  | 'counter_update_failed'
  | 'counter_update_zero_rows'
  | 'counter_saturated';

export type MailAclRolloutDiagnosticCode =
  | MailAclRolloutPersistentDiagnosticCode
  | 'rollout_state_invalid';

export type MailAclRolloutCounters = Readonly<{
  evaluated: bigint;
  legacyAllowNewDeny: bigint;
  legacyDenyNewAllow: bigint;
  notComparable: bigint;
  inFlight: bigint;
}>;

export type MailAclRolloutState = MailAclRolloutCounters & Readonly<{
  mode: MailAclRolloutMode;
  observationStartedAt: string | null;
  observationUpdatedAt: string | null;
  telemetryHealthy: boolean;
  diagnosticCode: MailAclRolloutDiagnosticCode | null;
  diagnosticAt: string | null;
  diagnostic?: string;
}>;

export type MailAclRolloutReadiness = MailAclRolloutState & Readonly<{
  workspaceId: string;
  ready: boolean;
  enforced: boolean;
}>;

export type MailAclRolloutTransitionResult =
  | Readonly<{ ok: true }>
  | Readonly<{
    ok: false;
    code:
      | 'not_shadow'
      | 'no_observations'
      | 'mismatches_present'
      | 'telemetry_unhealthy'
      | 'evaluations_in_flight';
  }>;

export type MailAclRolloutCounterResetResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: 'not_shadow' }>;

export type MailResourceLookupTarget =
  | Readonly<{ kind: 'account'; id: number }>
  | Readonly<{ kind: 'folder'; id: number }>
  | Readonly<{ kind: 'message'; id: number }>
  | Readonly<{ kind: 'attachment'; id: number }>
  | Readonly<{ kind: 'thread'; id: string }>
  | Readonly<{
    kind: 'metadata';
    entity:
      | 'message_tag'
      | 'message_category'
      | 'internal_note'
      | 'read_receipt'
      | 'thread_edge'
      | 'thread_alias'
      | 'account_signature'
      | 'spam_decision'
      | 'spam_learning_event';
    id: number;
  }>;

export interface MailResourceLookupPort {
  resolve(input: Readonly<{
    workspaceId: string;
    target: MailResourceLookupTarget;
  }>): Promise<readonly MailResource[]>;
}
