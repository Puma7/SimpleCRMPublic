import type { MailPermission, MailResource } from '@simplecrm/core';

export type MailAccessActor = Readonly<{
  userId: string;
  isOwner: boolean;
  isAdmin: boolean;
}>;

export type MailAccessGrant = Readonly<{
  resourceType: 'account' | 'folder' | 'message';
  accountId: number;
  folderId: number | null;
  messageId: number | null;
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
