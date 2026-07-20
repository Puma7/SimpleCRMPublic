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
  MailSqlScope,
} from './types';

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

      const [legacyAllowed, newDecision] = await Promise.all([
        this.options.legacy.canAccessAccount({
          workspaceId: input.workspaceId,
          userId: input.actor.userId,
          permission: input.permission,
          accountId,
        }, context),
        this.newDecision(newAcl, input),
      ]);
      return {
        value: legacyAllowed ? allowedDecision() : deniedDecision(),
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
      return {
        value: accountIds.length === 0
          ? { kind: 'none' as const }
          : { kind: 'restricted' as const, accountIds, folderIds: [], messageIds: [] },
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
    });
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

  const newFullAccounts = new Set(
    newGrants
      .filter((grant) => grant.resourceType === 'account')
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
