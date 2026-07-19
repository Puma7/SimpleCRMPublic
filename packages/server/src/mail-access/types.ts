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
