import type { MailPermission, MailResource } from '@simplecrm/core';

import type {
  ApiRequest,
  ApiResponse,
  MailRouteAccessContext,
  ServerApiPorts,
} from '../api/types';
import { error, requirePrincipal } from '../api/http';
import {
  assertMailRoutePolicy,
  type MailResourceResolution,
  type PolicyValueSelector,
} from './policy-manifest';
import { MailAccessDeniedError } from './service';
import type {
  MailAccessActor,
  MailResourceLookupTarget,
  MailSqlScope,
} from './types';

type EnforcementResult =
  | Readonly<{ ok: true; context?: MailRouteAccessContext }>
  | Readonly<{ ok: false; response: ApiResponse }>;

const EMPTY_SCOPE_READ_PATHS = new Set([
  '/api/v1/email/accounts',
  '/api/v1/email/folder-counts',
  '/api/v1/email/reporting',
  '/api/v1/email/gdpr-export',
  '/api/v1/email/messages',
  '/api/v1/email/messages/conversation',
  '/api/v1/email/folders',
  '/api/v1/email/tags',
  '/api/v1/email/categories',
  '/api/v1/email/category-counts',
  '/api/v1/email/message-categories',
  '/api/v1/email/internal-notes',
  '/api/v1/email/canned-responses',
  '/api/v1/email/account-signatures',
  '/api/v1/email/remote-content-allowlist',
  '/api/v1/email/read-receipts',
  '/api/v1/email/team-members',
  '/api/v1/email/thread-edges',
  '/api/v1/email/thread-aliases',
  '/api/v1/email/threads',
  '/api/v1/email/thread-alias-warnings',
]);

const RESTRICTED_SCOPE_READ_PATHS = new Set(
  [...EMPTY_SCOPE_READ_PATHS].filter((path) => ![
    '/api/v1/email/categories',
    '/api/v1/email/remote-content-allowlist',
    '/api/v1/email/team-members',
  ].includes(path)),
);

export async function enforceMailHttpPolicy(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<EnforcementResult> {
  let entry;
  try {
    entry = assertMailRoutePolicy(req.method, req.path);
  } catch {
    return denied();
  }
  if (entry.policy.kind === 'exempt') return { ok: true };

  const principal = requirePrincipal(req);
  if ('status' in principal) return { ok: false, response: principal };
  if (!ports.mailAccess || !ports.mailResourceLookup) return denied();

  const actor: MailAccessActor = {
    workspaceId: principal.workspaceId,
    userId: principal.userId,
    isOwner: principal.role === 'owner',
    isAdmin: principal.role === 'admin',
  };
  let scopePromise: Promise<MailSqlScope> | undefined;
  const resolveScope = (): Promise<MailSqlScope> => {
    scopePromise ??= ports.mailAccess!.resolveScope({
      workspaceId: principal.workspaceId,
      actor,
      permission: entry.policy.kind === 'permission'
        ? entry.policy.permission
        : 'mail.metadata.read',
    });
    return scopePromise;
  };

  try {
    const resources = await resolveHttpResources(
      req,
      entry.route.path,
      entry.policy.resource,
      principal.workspaceId,
      ports,
    );

    if (resources.kind === 'scope') {
      const scope = await resolveScope();
      if (
        scope.kind === 'none'
        && (req.method !== 'GET' || !EMPTY_SCOPE_READ_PATHS.has(entry.route.path))
      ) {
        return denied();
      }
      if (
        req.method === 'GET'
        && scope.kind === 'restricted'
        && !RESTRICTED_SCOPE_READ_PATHS.has(entry.route.path)
      ) {
        return denied();
      }
      return { ok: true, context: { permission: entry.policy.permission, scope } };
    }

    if (resources.resources.length === 0) {
      return entry.policy.resource.kind === 'bulk_message_lookup'
        ? { ok: true, context: { permission: entry.policy.permission } }
        : denied();
    }
    if (resources.mode === 'any') {
      await assertAnyResource(
        resources.resources,
        principal.workspaceId,
        actor,
        entry.policy.permission,
        ports,
      );
    } else {
      for (const resource of resources.resources) {
        await ports.mailAccess.assertPermission({
          workspaceId: principal.workspaceId,
          actor,
          permission: entry.policy.permission,
          resource,
        });
      }
    }

    await assertSupplementalHttpPermissions(
      req,
      entry.route.path,
      resources.resources,
      principal.workspaceId,
      actor,
      ports,
    );

    if (entry.policy.resource.kind === 'thread_lookup') {
      return {
        ok: true,
        context: { permission: entry.policy.permission, scope: await resolveScope() },
      };
    }
    return { ok: true, context: { permission: entry.policy.permission } };
  } catch (caught) {
    if (caught instanceof MailAccessDeniedError) return denied();
    throw caught;
  }
}

export function portsWithMailAccessContext(
  ports: ServerApiPorts,
  context: MailRouteAccessContext | undefined,
): ServerApiPorts {
  if (!context?.scope || context.scope.kind === 'all') return ports;
  const mailScope = context.scope;
  const scopedInput = <T extends object>(input: T): T & { mailScope: MailSqlScope } => ({
    ...input,
    mailScope,
  });
  return {
    ...ports,
    ...(ports.emailAccounts ? {
      emailAccounts: {
        ...ports.emailAccounts,
        list: (input) => ports.emailAccounts!.list(scopedInput(input)),
      },
    } : {}),
    ...(ports.emailMessages ? {
      emailMessages: {
        ...ports.emailMessages,
        list: (input) => ports.emailMessages!.list(scopedInput(input)),
        ...(ports.emailMessages.getFolderCounts ? {
          getFolderCounts: (input) => ports.emailMessages!.getFolderCounts!(scopedInput(input)),
        } : {}),
        ...(ports.emailMessages.listConversation ? {
          listConversation: (input) => ports.emailMessages!.listConversation!(scopedInput(input)),
        } : {}),
        ...(ports.emailMessages.listThread ? {
          listThread: (input) => ports.emailMessages!.listThread!(scopedInput(input)),
        } : {}),
      },
    } : {}),
    ...scopeListPort(ports, 'emailFolders', mailScope),
    ...scopeListPort(ports, 'emailMessageTags', mailScope),
    ...scopeListPort(ports, 'emailCategories', mailScope),
    ...scopeListPort(ports, 'emailInternalNotes', mailScope),
    ...scopeListPort(ports, 'emailCannedResponses', mailScope),
    ...scopeListPort(ports, 'emailAccountSignatures', mailScope),
    ...scopeListPort(ports, 'emailRemoteContentAllowlist', mailScope),
    ...scopeListPort(ports, 'emailReadReceipts', mailScope),
    ...scopeListPort(ports, 'emailTeamMembers', mailScope),
    ...scopeListPort(ports, 'emailThreadEdges', mailScope),
    ...(ports.emailThreadAliases ? {
      emailThreadAliases: {
        ...ports.emailThreadAliases,
        list: (input) => ports.emailThreadAliases!.list(scopedInput(input)),
        ...(ports.emailThreadAliases.listWarnings ? {
          listWarnings: (input) => ports.emailThreadAliases!.listWarnings!(scopedInput(input)),
        } : {}),
      },
    } : {}),
    ...(ports.emailThreads ? {
      emailThreads: {
        ...ports.emailThreads,
        list: (input) => ports.emailThreads!.list(scopedInput(input)),
        get: (input) => ports.emailThreads!.get(scopedInput(input)),
      },
    } : {}),
    ...(ports.emailMessageCategories ? {
      emailMessageCategories: {
        ...ports.emailMessageCategories,
        list: (input) => ports.emailMessageCategories!.list(scopedInput(input)),
        ...(ports.emailMessageCategories.listCounts ? {
          listCounts: (input) => ports.emailMessageCategories!.listCounts!(scopedInput(input)),
        } : {}),
      },
    } : {}),
    ...(ports.emailReporting ? {
      emailReporting: {
        collect: (input) => ports.emailReporting!.collect(scopedInput(input)),
      },
    } : {}),
    ...(ports.emailGdprExport ? {
      emailGdprExport: {
        export: (input) => ports.emailGdprExport!.export(scopedInput(input)),
      },
    } : {}),
  };
}

function scopeListPort<K extends keyof ServerApiPorts>(
  ports: ServerApiPorts,
  key: K,
  mailScope: MailSqlScope,
): Partial<ServerApiPorts> {
  const port = ports[key] as { list?: (input: Record<string, unknown>) => Promise<unknown> } | undefined;
  if (!port?.list) return {};
  return {
    [key]: {
      ...port,
      list: (input: Record<string, unknown>) => port.list!({ ...input, mailScope }),
    },
  } as Partial<ServerApiPorts>;
}

async function resolveHttpResources(
  req: ApiRequest,
  canonicalPath: string,
  resolution: MailResourceResolution,
  workspaceId: string,
  ports: ServerApiPorts,
): Promise<
  | Readonly<{ kind: 'scope' }>
  | Readonly<{ kind: 'resources'; resources: readonly MailResource[]; mode: 'all' | 'any' }>
> {
  if (
    resolution.kind === 'mail_scope'
    || resolution.kind === 'workspace_global'
    || resolution.kind === 'notice_lookup'
  ) {
    return { kind: 'scope' };
  }
  if (resolution.kind === 'event_message_then_account_lookup') return { kind: 'resources', resources: [], mode: 'all' };

  if (resolution.kind === 'optional_account') {
    const raw = selectorValue(req, canonicalPath, resolution.accountId);
    if (raw === undefined) return { kind: 'scope' };
    return lookupSingle(ports, workspaceId, { kind: 'account', id: requirePositiveInt(raw) });
  }
  if (resolution.kind === 'optional_message_lookup') {
    const raw = selectorValue(req, canonicalPath, resolution.messageId);
    if (raw === undefined && resolution.whenAbsent === 'mail_scope') return { kind: 'scope' };
    if (raw === undefined) return { kind: 'resources', resources: [], mode: 'all' };
    return lookupSingle(ports, workspaceId, { kind: 'message', id: requirePositiveInt(raw) });
  }
  if (resolution.kind === 'message_or_account_lookup') {
    const message = selectorValue(req, canonicalPath, resolution.messageId);
    if (message !== undefined) {
      return lookupSingle(ports, workspaceId, { kind: 'message', id: requirePositiveInt(message) });
    }
    const account = selectorValue(req, canonicalPath, resolution.accountId);
    if (account !== undefined) {
      return lookupSingle(ports, workspaceId, { kind: 'account', id: requirePositiveInt(account) });
    }
    return { kind: 'scope' };
  }
  if (resolution.kind === 'bulk_message_lookup') {
    const ids = requirePositiveIntList(selectorValue(req, canonicalPath, resolution.messageIds));
    const resources = await Promise.all(ids.map(async (id) => {
      const resolved = await ports.mailResourceLookup!.resolve({
        workspaceId,
        target: { kind: 'message', id },
      });
      if (resolved.length !== 1) throw new MailAccessDeniedError();
      return resolved[0]!;
    }));
    return { kind: 'resources', resources, mode: 'all' };
  }

  let target: MailResourceLookupTarget;
  if (resolution.kind === 'account') {
    target = { kind: 'account', id: requirePositiveInt(selectorValue(req, canonicalPath, resolution.accountId)) };
  } else if (resolution.kind === 'folder_lookup') {
    target = { kind: 'folder', id: requirePositiveInt(selectorValue(req, canonicalPath, resolution.folderId)) };
  } else if (resolution.kind === 'message_lookup') {
    target = { kind: 'message', id: requirePositiveInt(selectorValue(req, canonicalPath, resolution.messageId)) };
  } else if (resolution.kind === 'attachment_lookup') {
    target = { kind: 'attachment', id: requirePositiveInt(selectorValue(req, canonicalPath, resolution.attachmentId)) };
  } else if (resolution.kind === 'thread_lookup') {
    target = { kind: 'thread', id: requireThreadId(selectorValue(req, canonicalPath, resolution.threadId)) };
  } else {
    target = {
      kind: 'metadata',
      entity: resolution.entity,
      id: resolution.entity === 'account_signature'
        ? requireNonZeroInt(selectorValue(req, canonicalPath, resolution.id))
        : requirePositiveInt(selectorValue(req, canonicalPath, resolution.id)),
    };
  }
  const result = await lookupSingle(ports, workspaceId, target);
  return resolution.kind === 'thread_lookup'
    ? { ...result, mode: 'any' }
    : result;
}

async function lookupSingle(
  ports: ServerApiPorts,
  workspaceId: string,
  target: MailResourceLookupTarget,
): Promise<Readonly<{ kind: 'resources'; resources: readonly MailResource[]; mode: 'all' }>> {
  const resources = await ports.mailResourceLookup!.resolve({ workspaceId, target });
  return { kind: 'resources', resources, mode: 'all' };
}

async function assertAnyResource(
  resources: readonly MailResource[],
  workspaceId: string,
  actor: MailAccessActor,
  permission: MailPermission,
  ports: ServerApiPorts,
): Promise<void> {
  for (const resource of resources) {
    try {
      await ports.mailAccess!.assertPermission({ workspaceId, actor, permission, resource });
      return;
    } catch (caught) {
      if (!(caught instanceof MailAccessDeniedError)) throw caught;
    }
  }
  throw new MailAccessDeniedError();
}

async function assertSupplementalHttpPermissions(
  req: ApiRequest,
  canonicalPath: string,
  baseResources: readonly MailResource[],
  workspaceId: string,
  actor: MailAccessActor,
  ports: ServerApiPorts,
): Promise<void> {
  if (canonicalPath === '/api/v1/email/compose/send') {
    const accountId = requirePositiveInt(bodyField(req.body, 'accountId'));
    const target = await ports.mailResourceLookup!.resolve({
      workspaceId,
      target: { kind: 'account', id: accountId },
    });
    if (target.length !== 1) throw new MailAccessDeniedError();
    const draftAccountId = baseResources[0]?.accountId;
    if (draftAccountId !== target[0]?.accountId) {
      await ports.mailAccess!.assertPermission({
        workspaceId,
        actor,
        permission: 'mail.send_as',
        resource: target[0]!,
      });
    }
  }

  const replyParent = canonicalPath === '/api/v1/email/compose/send'
    ? optionalPositiveInt(bodyField(req.body, 'inReplyToMessageId'))
    : canonicalPath === '/api/v1/email/messages/:messageId/compose-draft'
      ? optionalPositiveInt(bodyField(req.body, 'replyParentMessageId'))
      : undefined;
  if (replyParent !== undefined) {
    const source = await ports.mailResourceLookup!.resolve({
      workspaceId,
      target: { kind: 'message', id: replyParent },
    });
    if (source.length !== 1) throw new MailAccessDeniedError();
    await ports.mailAccess!.assertPermission({
      workspaceId,
      actor,
      permission: 'mail.content.read',
      resource: source[0]!,
    });
  }
}

function selectorValue(
  req: ApiRequest,
  canonicalPath: string,
  selector: PolicyValueSelector,
): unknown {
  if (selector.source === 'query') return req.query?.[selector.field];
  if (selector.source === 'body') return bodyField(req.body, selector.field);
  if (selector.source !== 'path') return undefined;
  const canonicalSegments = canonicalPath.split('/');
  const actualSegments = req.path.split('/');
  const index = canonicalSegments.indexOf(`:${selector.field}`);
  return index < 0 ? undefined : actualSegments[index];
}

function bodyField(body: unknown, field: string): unknown {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)[field]
    : undefined;
}

function requirePositiveInt(value: unknown): number {
  const parsed = canonicalInteger(value, false);
  if (parsed === null || parsed <= 0) throw new MailAccessDeniedError();
  return parsed;
}

function requireNonZeroInt(value: unknown): number {
  const parsed = canonicalInteger(value, true);
  if (parsed === null || parsed === 0) throw new MailAccessDeniedError();
  return parsed;
}

function optionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requirePositiveInt(value);
}

function canonicalInteger(value: unknown, signed: boolean): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const pattern = signed ? /^-?[1-9]\d*$/ : /^[1-9]\d*$/;
  if (!pattern.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && String(parsed) === value ? parsed : null;
}

function requirePositiveIntList(value: unknown): number[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  if (!Array.isArray(value) && typeof value !== 'string') throw new MailAccessDeniedError();
  return [...new Set(values.map(requirePositiveInt))];
}

function requireThreadId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,255}$/.test(value)) {
    throw new MailAccessDeniedError();
  }
  return value;
}

function denied(): EnforcementResult {
  return {
    ok: false,
    response: error(404, 'mail_resource_not_found', 'Mail-Ressource nicht gefunden'),
  };
}
