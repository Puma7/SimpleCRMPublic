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

export interface MailAccessPort {
  resolveGrants(input: ResolveMailAccessGrantsInput): Promise<readonly MailAccessGrant[]>;
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
