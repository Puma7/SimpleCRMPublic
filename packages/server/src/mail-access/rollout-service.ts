import type { MailPermission, MailResource } from '@simplecrm/core';

import {
  MailAccessDeniedError,
  MailAccessService as NewMailAccessService,
} from './service';
import type {
  MailAccessGrant,
  MailAccessPort,
  MailAccessService,
  MailAclRolloutCounterResetResult,
  MailAclRolloutEvaluationContext,
  MailAclRolloutPersistentDiagnosticCode,
  MailAclRolloutReadiness,
  MailAclRolloutState,
  MailAclRolloutTransitionResult,
  MailScopeClause,
  MailSqlScope,
} from './types';
import { hasMailBindingConstraints } from './mail-acl-constraints';

export type MailAclRolloutDelta = Readonly<Partial<{
  evaluated: bigint;
  legacyAllowNewDeny: bigint;
  legacyDenyNewAllow: bigint;
  notComparable: bigint;
}>>;

export type MailAclRolloutTelemetryResult =
  | Readonly<{ healthy: true }>
  | Readonly<{ healthy: false; code: MailAclRolloutPersistentDiagnosticCode }>;

export type MailAclRolloutEvaluationOutcome<T> = Readonly<{
  value: T;
  delta?: MailAclRolloutDelta;
}>;

export type MailAclRolloutEvaluationCompletion<T> = Readonly<{
  value: T;
  telemetry: MailAclRolloutTelemetryResult;
}>;

export interface MailAclRolloutStatePort {
  withSharedEvaluation<T>(
    workspaceId: string,
    operation: (
      context: MailAclRolloutEvaluationContext,
    ) => Promise<MailAclRolloutEvaluationOutcome<T>>,
  ): Promise<MailAclRolloutEvaluationCompletion<T>>;
  getState(
    workspaceId: string,
    evaluationContext?: MailAclRolloutEvaluationContext,
  ): Promise<MailAclRolloutState>;
  increment(
    workspaceId: string,
    delta: MailAclRolloutDelta,
    evaluationContext?: MailAclRolloutEvaluationContext,
  ): Promise<MailAclRolloutTelemetryResult>;
  markTelemetryUnhealthy(
    workspaceId: string,
    code: MailAclRolloutPersistentDiagnosticCode,
    evaluationContext?: MailAclRolloutEvaluationContext,
  ): Promise<void>;
  getReadiness(workspaceId: string): Promise<MailAclRolloutReadiness>;
  transitionToEnforce(input: {
    workspaceId: string;
    actorUserId: string;
  }): Promise<MailAclRolloutTransitionResult>;
  resetShadowCounters(input: {
    workspaceId: string;
    actorUserId: string;
  }): Promise<MailAclRolloutCounterResetResult>;
}

export interface MailAclRolloutLegacyPort {
  canAccessAccount(input: Readonly<{
    workspaceId: string;
    userId: string;
    permission: MailPermission;
    accountId: number;
  }>, evaluationContext?: MailAclRolloutEvaluationContext): Promise<boolean>;
  resolveAccountScope(input: Readonly<{
    workspaceId: string;
    userId: string;
    permission: MailPermission;
  }>, evaluationContext?: MailAclRolloutEvaluationContext): Promise<readonly number[]>;
}

export type MailAclRolloutDiagnosticReporter = (
  event: Readonly<{ code: MailAclRolloutPersistentDiagnosticCode }>,
) => void;

type PermissionDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; error: MailAccessDeniedError }>;

export class MailAccessRolloutService implements MailAccessService {
  constructor(private readonly options: Readonly<{
    state: MailAclRolloutStatePort;
    legacy: MailAclRolloutLegacyPort;
    newAcl: MailAccessPort;
    onTelemetryDiagnostic?: MailAclRolloutDiagnosticReporter;
  }>) {}

  async assertPermission(input: Parameters<MailAccessService['assertPermission']>[0]): Promise<void> {
    if (input.actor.workspaceId !== input.workspaceId) {
      throw new MailAccessDeniedError();
    }
    if (input.actor.isOwner || input.actor.isAdmin) return;

    const evaluation = await this.options.state.withSharedEvaluation(input.workspaceId, async (context) => {
      const state = await this.options.state.getState(input.workspaceId, context);
      const newAcl = this.contextualNewAcl(context);
      const comparable = comparableLegacyFlag(input.permission);
      if (!comparable) {
        const newDecision = await this.newDecision(newAcl, input);
        return {
          value: newDecision,
          ...(state.mode === 'shadow' && !state.diagnostic
            ? { delta: { notComparable: 1n } }
            : {}),
        };
      }

      if (state.mode !== 'shadow' || state.diagnostic) {
        return { value: await this.newDecision(newAcl, input) };
      }

      const accountId = resourceAccountId(input.resource);
      if (accountId === null) return { value: deniedDecision() };

      const [legacyAllowed, newDecision, newGrants] = await Promise.all([
        this.options.legacy.canAccessAccount({
          workspaceId: input.workspaceId,
          userId: input.actor.userId,
          permission: input.permission,
          accountId,
        }, context),
        this.newDecision(newAcl, input),
        this.options.newAcl.resolveGrants({
          workspaceId: input.workspaceId,
          userId: input.actor.userId,
          permission: input.permission,
        }, context),
      ]);
      // Shadow keeps legacy account allow/deny for readiness comparison, but still
      // enforces assignment/category/tag filters so constrained bindings are not inert.
      const enforceConstraints = shouldEnforceConstraintsInShadow(input.resource, newGrants);
      const allowed = legacyAllowed && (!enforceConstraints || newDecision.allowed);
      return {
        value: allowed ? allowedDecision() : deniedDecision(),
        delta: {
          evaluated: 1n,
          legacyAllowNewDeny: legacyAllowed && !newDecision.allowed ? 1n : 0n,
          legacyDenyNewAllow: !legacyAllowed && newDecision.allowed ? 1n : 0n,
        },
      };
    });

    if (!evaluation.telemetry.healthy) this.reportTelemetryDiagnostic(evaluation.telemetry.code);
    const decision = evaluation.value;
    if (!decision.allowed) throw decision.error;
  }

  async resolveScope(input: Parameters<MailAccessService['resolveScope']>[0]): Promise<MailSqlScope> {
    if (input.actor.workspaceId !== input.workspaceId) return { kind: 'none' };
    if (input.actor.isOwner || input.actor.isAdmin) return { kind: 'all' };

    const evaluation = await this.options.state.withSharedEvaluation(input.workspaceId, async (context) => {
      const state = await this.options.state.getState(input.workspaceId, context);
      const newAcl = this.contextualNewAcl(context);
      const comparable = comparableLegacyFlag(input.permission);
      if (!comparable) {
        const scope = await newAcl.resolveScope(input);
        return {
          value: scope,
          ...(state.mode === 'shadow' && !state.diagnostic
            ? { delta: { notComparable: 1n } }
            : {}),
        };
      }

      if (state.mode !== 'shadow' || state.diagnostic) {
        return { value: await newAcl.resolveScope(input) };
      }

      const [legacyAccountIds, newGrants] = await Promise.all([
        this.options.legacy.resolveAccountScope({
          workspaceId: input.workspaceId,
          userId: input.actor.userId,
          permission: input.permission,
        }, context),
        this.options.newAcl.resolveGrants({
          workspaceId: input.workspaceId,
          userId: input.actor.userId,
          permission: input.permission,
        }, context),
      ]);
      const mismatch = compareLegacyAccountScopeToNewGrants(legacyAccountIds, newGrants);
      const accountIds = [...new Set(legacyAccountIds)].sort(compareNumbers);
      if (accountIds.length === 0) {
        return {
          value: { kind: 'none' as const },
          delta: {
            evaluated: 1n,
            legacyAllowNewDeny: mismatch.legacyAllowNewDeny,
            legacyDenyNewAllow: mismatch.legacyDenyNewAllow,
          },
        };
      }

      const scope = await buildShadowScopeWithConstraints({
        accountIds,
        newGrants,
        resolveActor: this.options.newAcl.resolveScopeActorContext
          ? () => this.options.newAcl.resolveScopeActorContext!({
            workspaceId: input.workspaceId,
            userId: input.actor.userId,
          })
          : async () => ({ userId: input.actor.userId, groupMemberUserIds: [input.actor.userId] }),
      });
      return {
        value: scope,
        delta: {
          evaluated: 1n,
          legacyAllowNewDeny: mismatch.legacyAllowNewDeny,
          legacyDenyNewAllow: mismatch.legacyDenyNewAllow,
        },
      };
    });
    if (!evaluation.telemetry.healthy) this.reportTelemetryDiagnostic(evaluation.telemetry.code);
    return evaluation.value;
  }

  private contextualNewAcl(context: MailAclRolloutEvaluationContext): NewMailAccessService {
    return new NewMailAccessService({
      resolveGrants: (input) => this.options.newAcl.resolveGrants(input, context),
      resolveScopeActorContext: this.options.newAcl.resolveScopeActorContext
        ? (input) => this.options.newAcl.resolveScopeActorContext!(input)
        : undefined,
      resolveMessageVisibilityFacts: this.options.newAcl.resolveMessageVisibilityFacts
        ? (input) => this.options.newAcl.resolveMessageVisibilityFacts!(input)
        : undefined,
    });
  }

  async explainMessageVisibility(input: Readonly<{
    workspaceId: string;
    userId: string;
    resource: Extract<import('@simplecrm/core').MailResource, { type: 'message' }>;
  }>) {
    const state = await this.options.state.getState(input.workspaceId);
    const newExplanation = await this.contextualNewAcl({ workspaceId: input.workspaceId })
      .explainMessageVisibility(input);

    if (state.mode !== 'shadow' || state.diagnostic) {
      return newExplanation;
    }

    const comparable = comparableLegacyFlag('mail.metadata.read');
    if (!comparable) return newExplanation;
    const accountId = resourceAccountId(input.resource);
    if (accountId === null) return newExplanation;

    const [legacyAllowed, newGrants] = await Promise.all([
      this.options.legacy.canAccessAccount({
        workspaceId: input.workspaceId,
        userId: input.userId,
        permission: 'mail.metadata.read',
        accountId,
      }),
      this.options.newAcl.resolveGrants({
        workspaceId: input.workspaceId,
        userId: input.userId,
        permission: 'mail.metadata.read',
      }),
    ]);
    const enforceConstraints = shouldEnforceConstraintsInShadow(input.resource, newGrants);
    const effectiveVisible = legacyAllowed && (!enforceConstraints || Boolean(newExplanation.visible));

    return {
      ...newExplanation,
      visible: effectiveVisible,
      reason: effectiveVisible
        ? (enforceConstraints
          ? newExplanation.reason
          : (legacyAllowed && !newExplanation.visible
            ? 'Shadow-Mode: Legacy-Kontozugriff erlaubt die Nachricht (neues ACL noch nicht deckungsgleich)'
            : newExplanation.reason))
        : (legacyAllowed
          ? (newExplanation.reason || 'Sichtbarkeitsfilter blockieren die Nachricht')
          : 'Kein Legacy-Kontozugriff und kein neues ACL-Binding'),
      rolloutMode: 'shadow' as const,
      legacyAllowed,
      newAclVisible: Boolean(newExplanation.visible),
    };
  }

  private async newDecision(
    newAcl: NewMailAccessService,
    input: Parameters<MailAccessService['assertPermission']>[0],
  ): Promise<PermissionDecision> {
    try {
      await newAcl.assertPermission(input);
      return allowedDecision();
    } catch (error) {
      if (error instanceof MailAccessDeniedError) return { allowed: false, error };
      throw error;
    }
  }

  private reportTelemetryDiagnostic(code: MailAclRolloutPersistentDiagnosticCode): void {
    try {
      this.options.onTelemetryDiagnostic?.({ code });
    } catch {
      // Diagnostics are deliberately isolated from authorization behavior.
    }
  }
}

function allowedDecision(): PermissionDecision {
  return { allowed: true };
}

function deniedDecision(): PermissionDecision {
  return { allowed: false, error: new MailAccessDeniedError() };
}

export function comparableLegacyFlag(permission: MailPermission): 'can_read' | 'can_send' | null {
  if (
    permission === 'mail.metadata.read'
    || permission === 'mail.content.read'
    || permission === 'mail.attachment.read'
  ) return 'can_read';
  if (
    permission === 'mail.draft.create'
    || permission === 'mail.draft.edit'
    || permission === 'mail.send'
  ) return 'can_send';
  return null;
}

function resourceAccountId(resource: MailResource): number | null {
  if (!/^[1-9]\d*$/.test(resource.accountId)) return null;
  const parsed = Number(resource.accountId);
  return Number.isSafeInteger(parsed) && String(parsed) === resource.accountId ? parsed : null;
}

function compareLegacyAccountScopeToNewGrants(
  legacyAccountIds: readonly number[],
  newGrants: readonly MailAccessGrant[],
): { legacyAllowNewDeny: bigint; legacyDenyNewAllow: bigint } {
  const legacyAccounts = new Set(legacyAccountIds);
  if (newGrants.length === 0) {
    return legacyAccounts.size > 0
      ? { legacyAllowNewDeny: 1n, legacyDenyNewAllow: 0n }
      : { legacyAllowNewDeny: 0n, legacyDenyNewAllow: 0n };
  }

  // Constrained account grants are narrower than legacy full-account scope and
  // must not count as parity with unconstrained legacy account access.
  const newFullAccounts = new Set(
    newGrants
      .filter((grant) => grant.resourceType === 'account' && !hasMailBindingConstraints(grant.constraints))
      .map((grant) => grant.accountId),
  );
  const newTouchedAccounts = new Set(newGrants.map((grant) => grant.accountId));
  const legacyAllowNewDeny = [...legacyAccounts].some((accountId) => !newFullAccounts.has(accountId)) ? 1n : 0n;
  const legacyDenyNewAllow = [...newTouchedAccounts].some((accountId) => !legacyAccounts.has(accountId)) ? 1n : 0n;
  return { legacyAllowNewDeny, legacyDenyNewAllow };
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function shouldEnforceConstraintsInShadow(
  resource: MailResource,
  newGrants: readonly MailAccessGrant[],
): boolean {
  if (resource.type !== 'message') return false;
  const accountId = resourceAccountId(resource);
  const folderId = parsePositiveId(resource.folderId);
  const messageId = parsePositiveId(resource.messageId);
  if (accountId === null || folderId === null || messageId === null) return false;
  return newGrants.some((grant) => (
    hasMailBindingConstraints(grant.constraints)
    && grantCoversMessage(grant, accountId, folderId, messageId)
  ));
}

async function buildShadowScopeWithConstraints(input: Readonly<{
  accountIds: readonly number[];
  newGrants: readonly MailAccessGrant[];
  resolveActor: () => Promise<{ userId: string; groupMemberUserIds: readonly string[] }>;
}>): Promise<MailSqlScope> {
  const accountIds = [...input.accountIds];
  const hasConstrainedGrant = input.newGrants.some((grant) => (
    accountIds.includes(grant.accountId) && hasMailBindingConstraints(grant.constraints)
  ));
  if (!hasConstrainedGrant) {
    return { kind: 'restricted', accountIds, folderIds: [], messageIds: [] };
  }

  const clauses: MailScopeClause[] = [];
  for (const accountId of accountIds) {
    const grantsForAccount = input.newGrants.filter((grant) => grant.accountId === accountId);
    if (!grantsForAccount.some((grant) => hasMailBindingConstraints(grant.constraints))) {
      clauses.push({
        accountIds: [accountId],
        folderIds: [],
        messageIds: [],
        constraints: null,
      });
      continue;
    }

    const hasUnconstrainedAccountGrant = grantsForAccount.some((grant) => (
      grant.resourceType === 'account' && !hasMailBindingConstraints(grant.constraints)
    ));
    const hasConstrainedAccountGrant = grantsForAccount.some((grant) => (
      grant.resourceType === 'account' && hasMailBindingConstraints(grant.constraints)
    ));

    for (const grant of grantsForAccount) {
      clauses.push(grantToClause(grant));
    }

    // Legacy remainder: folders/messages not covered by constrained new grants stay
    // visible via the legacy full-account allow (assertPermission already does this).
    if (!hasUnconstrainedAccountGrant && !hasConstrainedAccountGrant) {
      const excludeFolderIds = [...new Set(
        grantsForAccount
          .filter((grant) => grant.resourceType === 'folder' || grant.resourceType === 'message')
          .map((grant) => grant.folderId)
          .filter((id): id is number => typeof id === 'number'),
      )].sort(compareNumbers);
      const excludeMessageIds = [...new Set(
        grantsForAccount
          .filter((grant) => grant.resourceType === 'message')
          .map((grant) => grant.messageId)
          .filter((id): id is number => typeof id === 'number'),
      )].sort(compareNumbers);
      clauses.push({
        accountIds: [accountId],
        folderIds: [],
        messageIds: [],
        constraints: null,
        ...(excludeFolderIds.length > 0 ? { excludeFolderIds } : {}),
        ...(excludeMessageIds.length > 0 ? { excludeMessageIds } : {}),
      });
    }
  }

  const actor = await input.resolveActor();
  return {
    kind: 'restricted',
    accountIds,
    folderIds: [],
    messageIds: [],
    clauses,
    actor,
  };
}

function grantToClause(grant: MailAccessGrant): MailScopeClause {
  if (grant.resourceType === 'account') {
    return {
      accountIds: [grant.accountId],
      folderIds: [],
      messageIds: [],
      constraints: grant.constraints,
    };
  }
  if (grant.resourceType === 'folder') {
    return {
      accountIds: [],
      folderIds: [grant.folderId],
      messageIds: [],
      constraints: grant.constraints,
    };
  }
  return {
    accountIds: [],
    folderIds: [],
    messageIds: [grant.messageId],
    constraints: grant.constraints,
  };
}

function grantCoversMessage(
  grant: MailAccessGrant,
  accountId: number,
  folderId: number,
  messageId: number,
): boolean {
  if (grant.accountId !== accountId) return false;
  if (grant.resourceType === 'account') return true;
  if (grant.folderId !== folderId) return false;
  if (grant.resourceType === 'folder') return true;
  return grant.messageId === messageId;
}

function parsePositiveId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && String(parsed) === value ? parsed : null;
}
