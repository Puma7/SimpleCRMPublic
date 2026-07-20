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

export interface MailAclRolloutStatePort {
  getState(workspaceId: string): Promise<MailAclRolloutState>;
  increment(workspaceId: string, delta: MailAclRolloutDelta): Promise<void>;
  getReadiness(workspaceId: string): Promise<MailAclRolloutReadiness>;
  transitionToEnforce(input: { workspaceId: string }): Promise<MailAclRolloutTransitionResult>;
  resetShadowCounters(input: { workspaceId: string }): Promise<MailAclRolloutCounterResetResult>;
}

export interface MailAclRolloutLegacyPort {
  canAccessAccount(input: Readonly<{
    workspaceId: string;
    userId: string;
    permission: MailPermission;
    accountId: number;
  }>): Promise<boolean>;
  resolveAccountScope(input: Readonly<{
    workspaceId: string;
    userId: string;
    permission: MailPermission;
  }>): Promise<readonly number[]>;
}

export class MailAccessRolloutService implements MailAccessService {
  private readonly newAcl: NewMailAccessService;

  constructor(private readonly options: Readonly<{
    state: MailAclRolloutStatePort;
    legacy: MailAclRolloutLegacyPort;
    newAcl: MailAccessPort;
  }>) {
    this.newAcl = new NewMailAccessService(options.newAcl);
  }

  async assertPermission(input: Parameters<MailAccessService['assertPermission']>[0]): Promise<void> {
    if (input.actor.workspaceId !== input.workspaceId) {
      throw new MailAccessDeniedError();
    }
    if (input.actor.isOwner || input.actor.isAdmin) return;

    const comparable = comparableLegacyFlag(input.permission);
    if (!comparable) {
      const state = await this.options.state.getState(input.workspaceId);
      try {
        await this.newAcl.assertPermission(input);
      } finally {
        if (state.mode === 'shadow' && !state.diagnostic) {
          await this.options.state.increment(input.workspaceId, { notComparable: 1n });
        }
      }
      return undefined;
    }

    const state = await this.options.state.getState(input.workspaceId);
    if (state.mode !== 'shadow' || state.diagnostic) {
      await this.newAcl.assertPermission(input);
      return;
    }

    const accountId = resourceAccountId(input.resource);
    if (accountId === null) throw new MailAccessDeniedError();

    const [legacyAllowed, newAllowed] = await Promise.all([
      this.options.legacy.canAccessAccount({
        workspaceId: input.workspaceId,
        userId: input.actor.userId,
        permission: input.permission,
        accountId,
      }),
      this.newAllows(input),
    ]);
    await this.options.state.increment(input.workspaceId, {
      evaluated: 1n,
      legacyAllowNewDeny: legacyAllowed && !newAllowed ? 1n : 0n,
      legacyDenyNewAllow: !legacyAllowed && newAllowed ? 1n : 0n,
    });

    if (!legacyAllowed) throw new MailAccessDeniedError();
  }

  async resolveScope(input: Parameters<MailAccessService['resolveScope']>[0]): Promise<MailSqlScope> {
    if (input.actor.workspaceId !== input.workspaceId) return { kind: 'none' };
    if (input.actor.isOwner || input.actor.isAdmin) return { kind: 'all' };

    const comparable = comparableLegacyFlag(input.permission);
    if (!comparable) {
      const scope = await this.newAcl.resolveScope(input);
      await this.incrementIfShadow(input.workspaceId, { notComparable: 1n });
      return scope;
    }

    const state = await this.options.state.getState(input.workspaceId);
    if (state.mode !== 'shadow' || state.diagnostic) {
      return this.newAcl.resolveScope(input);
    }

    const [legacyAccountIds, newGrants] = await Promise.all([
      this.options.legacy.resolveAccountScope({
        workspaceId: input.workspaceId,
        userId: input.actor.userId,
        permission: input.permission,
      }),
      this.options.newAcl.resolveGrants({
        workspaceId: input.workspaceId,
        userId: input.actor.userId,
        permission: input.permission,
      }),
    ]);
    const mismatch = compareLegacyAccountScopeToNewGrants(legacyAccountIds, newGrants);
    await this.options.state.increment(input.workspaceId, {
      evaluated: 1n,
      legacyAllowNewDeny: mismatch.legacyAllowNewDeny,
      legacyDenyNewAllow: mismatch.legacyDenyNewAllow,
    });

    const accountIds = [...new Set(legacyAccountIds)].sort(compareNumbers);
    return accountIds.length === 0
      ? { kind: 'none' }
      : { kind: 'restricted', accountIds, folderIds: [], messageIds: [] };
  }

  private async newAllows(input: Parameters<MailAccessService['assertPermission']>[0]): Promise<boolean> {
    try {
      await this.newAcl.assertPermission(input);
      return true;
    } catch (error) {
      if (error instanceof MailAccessDeniedError) return false;
      throw error;
    }
  }

  private async incrementIfShadow(workspaceId: string, delta: MailAclRolloutDelta): Promise<void> {
    const state = await this.options.state.getState(workspaceId);
    if (state.mode === 'shadow' && !state.diagnostic) {
      await this.options.state.increment(workspaceId, delta);
    }
  }
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
