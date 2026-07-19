import type { MailResource } from '@simplecrm/core';

import type {
  MailAccessGrant,
  MailAccessPort,
  MailAccessService as MailAccessServiceContract,
  MailSqlScope,
} from './types';

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
    const resource = normalizeResource(input.resource);
    if (!resource) throw new MailAccessDeniedError();
    if (input.actor.isOwner || input.actor.isAdmin) return;

    const grants = await this.port.resolveGrants({
      workspaceId: input.workspaceId,
      userId: input.actor.userId,
      permission: input.permission,
    });
    if (!grants.some((grant) => grantAllowsResource(grant, resource))) {
      throw new MailAccessDeniedError();
    }
  }

  async resolveScope(
    input: Parameters<MailAccessServiceContract['resolveScope']>[0],
  ): Promise<MailSqlScope> {
    if (input.actor.isOwner || input.actor.isAdmin) return { kind: 'all' };

    const grants = await this.port.resolveGrants({
      workspaceId: input.workspaceId,
      userId: input.actor.userId,
      permission: input.permission,
    });
    if (grants.length === 0) return { kind: 'none' };

    return grantsToScope(grants);
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

function grantsToScope(grants: readonly MailAccessGrant[]): MailSqlScope {
  const accountIds = new Set(
    grants
      .filter((grant) => grant.resourceType === 'account')
      .map((grant) => grant.accountId),
  );
  const uncoveredFolderGrants = grants.filter((grant) => (
    grant.resourceType === 'folder'
    && grant.folderId !== null
    && !accountIds.has(grant.accountId)
  ));
  const folderKeys = new Set(
    uncoveredFolderGrants.map((grant) => `${grant.accountId}:${grant.folderId}`),
  );
  const folderIds = new Set(uncoveredFolderGrants.map((grant) => grant.folderId as number));
  const messageIds = new Set(
    grants
      .filter((grant) => (
        grant.resourceType === 'message'
        && grant.folderId !== null
        && grant.messageId !== null
        && !accountIds.has(grant.accountId)
        && !folderKeys.has(`${grant.accountId}:${grant.folderId}`)
      ))
      .map((grant) => grant.messageId as number),
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

function compareNumbers(left: number, right: number): number {
  return left - right;
}
