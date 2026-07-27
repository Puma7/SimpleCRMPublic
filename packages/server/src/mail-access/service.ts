import type { MailResource } from '@simplecrm/core';

import { hasMailBindingConstraints } from './mail-acl-constraints';
import type {
  MailAccessGrant,
  MailAccessPort,
  MailAccessService as MailAccessServiceContract,
  MailBindingVisibilityConstraints,
  MailScopeActorContext,
  MailScopeClause,
  MailSqlScope,
} from './types';
import { explainConstraintMismatch, messageMatchesConstraints } from './types';

const PUBLIC_DENIAL_MESSAGE = 'Keine Berechtigung fuer diese E-Mail-Aktion.';

type NumericMailResource =
  | Readonly<{ type: 'account'; accountId: number }>
  | Readonly<{ type: 'folder'; accountId: number; folderId: number }>
  | Readonly<{ type: 'message'; accountId: number; folderId: number; messageId: number }>;

export class MailAccessDeniedError extends Error {
  readonly code = 'mail_access_denied' as const;

  constructor() {
    super(PUBLIC_DENIAL_MESSAGE);
    this.name = 'MailAccessDeniedError';
  }
}

export class MailAccessService implements MailAccessServiceContract {
  constructor(private readonly port: MailAccessPort) {}

  async assertPermission(
    input: Parameters<MailAccessServiceContract['assertPermission']>[0],
  ): Promise<void> {
    if (input.actor.workspaceId !== input.workspaceId) throw new MailAccessDeniedError();
    const resource = normalizeResource(input.resource);
    if (!resource) throw new MailAccessDeniedError();
    if (input.actor.isOwner || input.actor.isAdmin) return;

    const grants = await this.port.resolveGrants({
      workspaceId: input.workspaceId,
      userId: input.actor.userId,
      permission: input.permission,
    });
    const matching = grants.filter((grant) => grantAllowsResource(grant, resource));
    if (matching.length === 0) throw new MailAccessDeniedError();

    if (resource.type !== 'message' || !matching.some((g) => hasMailBindingConstraints(g.constraints))) {
      return;
    }

    const facts = this.port.resolveMessageVisibilityFacts
      ? await this.port.resolveMessageVisibilityFacts({
        workspaceId: input.workspaceId,
        messageId: resource.messageId,
      })
      : null;
    if (!facts) throw new MailAccessDeniedError();
    const actor = await this.resolveActorContext(input.workspaceId, input.actor.userId);
    if (!matching.some((grant) => messageMatchesConstraints(facts, grant.constraints, actor))) {
      throw new MailAccessDeniedError();
    }
  }

  async resolveScope(
    input: Parameters<MailAccessServiceContract['resolveScope']>[0],
  ): Promise<MailSqlScope> {
    if (input.actor.workspaceId !== input.workspaceId) return { kind: 'none' };
    if (input.actor.isOwner || input.actor.isAdmin) return { kind: 'all' };

    const grants = await this.port.resolveGrants({
      workspaceId: input.workspaceId,
      userId: input.actor.userId,
      permission: input.permission,
    });
    if (grants.length === 0) return { kind: 'none' };

    const flat = grantsToFlatScope(grants);
    if (flat.kind === 'none') return flat;

    const needsClauses = grants.some((grant) => hasMailBindingConstraints(grant.constraints));
    if (!needsClauses) return flat;

    const actor = await this.resolveActorContext(input.workspaceId, input.actor.userId);
    return {
      ...flat,
      clauses: grantsToClauses(grants),
      actor,
    };
  }

  async explainMessageVisibility(input: Readonly<{
    workspaceId: string;
    userId: string;
    resource: Extract<MailResource, { type: 'message' }>;
  }>): Promise<Readonly<{
    visible: boolean;
    reason: string;
    bindings: readonly { bindingId: number; ok: boolean; reason: string | null }[];
    facts: {
      assignedToUserId: string | null;
      assignedTo: string | null;
      categoryIds: readonly number[];
      tags: readonly string[];
    } | null;
  }>> {
    const resource = normalizeResource(input.resource);
    if (!resource || resource.type !== 'message') {
      return { visible: false, reason: 'Ungueltige Nachricht', bindings: [], facts: null };
    }

    const grants = await this.port.resolveGrants({
      workspaceId: input.workspaceId,
      userId: input.userId,
      permission: 'mail.metadata.read',
    });
    const matching = grants.filter((grant) => grantAllowsResource(grant, resource));
    if (matching.length === 0) {
      return {
        visible: false,
        reason: 'Kein ACL-Binding deckt diese Nachricht ab',
        bindings: [],
        facts: null,
      };
    }

    const needsFacts = matching.some((grant) => hasMailBindingConstraints(grant.constraints));
    if (!needsFacts) {
      return {
        visible: true,
        reason: 'Nachricht ist fuer den Nutzer ueber Mail-ACL sichtbar',
        bindings: matching.map((grant) => ({ bindingId: grant.bindingId, ok: true, reason: null })),
        facts: null,
      };
    }

    const facts = this.port.resolveMessageVisibilityFacts
      ? await this.port.resolveMessageVisibilityFacts({
        workspaceId: input.workspaceId,
        messageId: resource.messageId,
      })
      : null;
    if (!facts) {
      return {
        visible: false,
        reason: 'Nachrichtendaten fuer Sichtbarkeitsfilter nicht ladbar',
        bindings: matching.map((grant) => ({
          bindingId: grant.bindingId,
          ok: false,
          reason: 'Fakten fehlen',
        })),
        facts: null,
      };
    }

    const actor = await this.resolveActorContext(input.workspaceId, input.userId);
    const bindings = matching.map((grant) => {
      const mismatch = explainConstraintMismatch(facts, grant.constraints, actor);
      return { bindingId: grant.bindingId, ok: mismatch === null, reason: mismatch };
    });
    const visible = bindings.some((entry) => entry.ok);
    return {
      visible,
      reason: visible
        ? 'Nachricht ist fuer den Nutzer ueber Mail-ACL sichtbar'
        : (bindings.find((entry) => entry.reason)?.reason
          ?? 'Sichtbarkeitsfilter blockieren die Nachricht'),
      bindings,
      facts: {
        assignedToUserId: facts.assignedToUserId,
        assignedTo: facts.assignedTo,
        categoryIds: facts.categoryIds,
        tags: facts.tags,
      },
    };
  }

  /**
   * Nutzer, die sich mit `userId` eine Gruppe teilen (inklusive ihm selbst) —
   * genau der Satz, den assigned_to_my_groups in die Sichtbarkeit einbezieht.
   * Routen brauchen ihn, um ACL-Invalidierungen an alle Betroffenen zu fassen.
   */
  async resolveGroupPeerUserIds(workspaceId: string, userId: string): Promise<readonly string[]> {
    const context = await this.resolveActorContext(workspaceId, userId);
    return context.groupMemberUserIds.length > 0 ? context.groupMemberUserIds : [userId];
  }

  /**
   * Nutzer, deren Sichtbarkeitsfilter die genannten Kategorien/Tags nennen —
   * genau die, deren Sicht auf eine Nachricht mit einer Kategorie-/Tag-Aenderung
   * kippen kann.
   */
  async resolveConstraintSubjectUserIds(
    input: Readonly<{
      workspaceId: string;
      categoryIds?: readonly number[];
      tags?: readonly string[];
      includeAssignmentModes?: boolean;
    }>,
  ): Promise<readonly string[]> {
    const resolve = this.port.resolveConstraintSubjectUserIds;
    if (!resolve) return [];
    return resolve.call(this.port, input);
  }

  private async resolveActorContext(workspaceId: string, userId: string): Promise<MailScopeActorContext> {
    if (this.port.resolveScopeActorContext) {
      return this.port.resolveScopeActorContext({ workspaceId, userId });
    }
    return { userId, groupMemberUserIds: [userId] };
  }
}

function normalizeResource(resource: MailResource): NumericMailResource | null {
  const accountId = parseResourceId(resource.accountId);
  if (accountId === null) return null;
  if (resource.type === 'account') return { type: 'account', accountId };

  const folderId = parseResourceId(resource.folderId);
  if (folderId === null) return null;
  if (resource.type === 'folder') return { type: 'folder', accountId, folderId };

  const messageId = parseResourceId(resource.messageId);
  if (messageId === null) return null;
  return { type: 'message', accountId, folderId, messageId };
}

function parseResourceId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== value) return null;
  return parsed;
}

function grantAllowsResource(grant: MailAccessGrant, resource: NumericMailResource): boolean {
  if (grant.accountId !== resource.accountId) return false;
  if (grant.resourceType === 'account') return true;
  if (resource.type === 'account' || grant.folderId !== resource.folderId) return false;
  if (grant.resourceType === 'folder') return true;
  return resource.type === 'message' && grant.messageId === resource.messageId;
}

function grantsToFlatScope(grants: readonly MailAccessGrant[]): Extract<MailSqlScope, { kind: 'restricted' | 'none' }> {
  const accountIds = new Set(
    grants
      .filter((grant) => grant.resourceType === 'account')
      .map((grant) => grant.accountId),
  );
  const uncoveredFolderGrants = grants
    .filter((grant) => grant.resourceType === 'folder')
    .filter((grant) => !accountIds.has(grant.accountId));
  const folderKeys = new Set(
    uncoveredFolderGrants.map((grant) => `${grant.accountId}:${grant.folderId}`),
  );
  const folderIds = new Set(uncoveredFolderGrants.map((grant) => grant.folderId));
  const messageIds = new Set(
    grants
      .filter((grant) => grant.resourceType === 'message')
      .filter((grant) => (
        !accountIds.has(grant.accountId)
        && !folderKeys.has(`${grant.accountId}:${grant.folderId}`)
      ))
      .map((grant) => grant.messageId),
  );

  if (accountIds.size === 0 && folderIds.size === 0 && messageIds.size === 0) {
    return { kind: 'none' };
  }
  return {
    kind: 'restricted',
    accountIds: [...accountIds].sort(compareNumbers),
    folderIds: [...folderIds].sort(compareNumbers),
    messageIds: [...messageIds].sort(compareNumbers),
  };
}

function grantsToClauses(grants: readonly MailAccessGrant[]): MailScopeClause[] {
  // One clause per grant so different constraints on the same mailbox OR correctly.
  return grants.map((grant) => {
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
  });
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

export type { MailBindingVisibilityConstraints };
