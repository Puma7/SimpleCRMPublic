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

/** Mirrors the bulk-mutation handler cap (parseEmailMessageBulkMutationBody). */
const MAX_BULK_MESSAGE_IDS = 500;

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
  '/api/v1/workflows/:id/runs',
  '/api/v1/workflows/by-source/:sourceId/runs',
  '/api/v1/workflow-runs',
  '/api/v1/workflow-runs/:id',
  '/api/v1/workflow-runs/:id/steps',
  '/api/v1/workflow-runs/by-source/:sourceId',
  '/api/v1/workflow-runs/by-source/:sourceId/steps',
  '/api/v1/workflow-run-steps',
  '/api/v1/workflow-run-steps/:id',
  '/api/v1/workflow-message-applied',
  '/api/v1/workflow-message-applied/:id',
  '/api/v1/workflow-forward-dedup',
  '/api/v1/workflow-forward-dedup/:id',
  '/api/v1/workflow-delayed-jobs',
  '/api/v1/workflow-delayed-jobs/:id',
]);

const RESTRICTED_SCOPE_READ_PATHS = new Set([
  ...[...EMPTY_SCOPE_READ_PATHS].filter((path) => ![
    '/api/v1/email/categories',
    '/api/v1/email/remote-content-allowlist',
    '/api/v1/email/team-members',
  ].includes(path)),
  // A delegate loads their OWN per-account signatures here, and the companion
  // upsert is already account-authorized — so a restricted-scope read must be
  // allowed too, otherwise they can save signatures they can never load. Kept out
  // of EMPTY_SCOPE_READ_PATHS so a scope-'none' user still gets nothing.
  '/api/v1/email/user-signatures',
]);

// Stateless PGP crypto helpers: they transform client-supplied plaintext —
// encrypting to recipient public keys, or signing with the workspace identity
// plus a supplied passphrase — and read/mutate no stored account or message
// resource. A delegate who holds mail.send on any account (restricted scope)
// must be able to prepare a PGP-protected outgoing body; the subsequent send is
// authorized per-account by the compose-send policy. Scope 'none' is still
// denied by the empty-scope check above, so only a genuine mail.send holder
// reaches these.
const RESTRICTED_SCOPE_WRITE_PATHS = new Set<string>([
  '/api/v1/pgp/messages/encrypt',
  '/api/v1/pgp/messages/sign',
]);

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
    const scopedMutation = isScopedWorkflowDelayedJobMutation(req.method, entry.route.path);

    if (resources.kind === 'scope') {
      const scope = await resolveScope();
      if (!scopedMutation) {
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
        if (
          req.method !== 'GET'
          && scope.kind !== 'all'
          && !RESTRICTED_SCOPE_WRITE_PATHS.has(entry.route.path)
        ) {
          return denied();
        }
      }
      await assertSupplementalHttpPermissions(
        req,
        entry.route.path,
        [],
        principal.workspaceId,
        actor,
        ports,
      );
      return { ok: true, context: { permission: entry.policy.permission, scope } };
    }

    if (resources.resources.length === 0) {
      const allowedEmpty = entry.policy.resource.kind === 'bulk_message_lookup'
        || (
          entry.policy.resource.kind === 'optional_message_lookup'
          && entry.policy.resource.whenAbsent === 'non_mail'
        );
      if (!allowedEmpty) return denied();
      await assertSupplementalHttpPermissions(
        req,
        entry.route.path,
        [],
        principal.workspaceId,
        actor,
        ports,
      );
      return scopedMutation
        ? { ok: true, context: { permission: entry.policy.permission, scope: await resolveScope() } }
        : { ok: true, context: { permission: entry.policy.permission } };
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
    if (scopedMutation) {
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
    ...(ports.workflowRuns ? {
      workflowRuns: {
        ...ports.workflowRuns,
        list: (input) => ports.workflowRuns!.list(scopedInput(input)),
        get: (input) => ports.workflowRuns!.get(scopedInput(input)),
      },
    } : {}),
    ...(ports.workflowRunSteps ? {
      workflowRunSteps: {
        ...ports.workflowRunSteps,
        list: (input) => ports.workflowRunSteps!.list(scopedInput(input)),
        get: (input) => ports.workflowRunSteps!.get(scopedInput(input)),
      },
    } : {}),
    ...(ports.workflowMessageApplied ? {
      workflowMessageApplied: {
        ...ports.workflowMessageApplied,
        list: (input) => ports.workflowMessageApplied!.list(scopedInput(input)),
        get: (input) => ports.workflowMessageApplied!.get(scopedInput(input)),
      },
    } : {}),
    ...(ports.workflowForwardDedup ? {
      workflowForwardDedup: {
        ...ports.workflowForwardDedup,
        list: (input) => ports.workflowForwardDedup!.list(scopedInput(input)),
        get: (input) => ports.workflowForwardDedup!.get(scopedInput(input)),
      },
    } : {}),
    ...(ports.workflowDelayedJobs ? {
      workflowDelayedJobs: {
        ...ports.workflowDelayedJobs,
        list: (input) => ports.workflowDelayedJobs!.list(scopedInput(input)),
        get: (input) => ports.workflowDelayedJobs!.get(scopedInput(input)),
        ...(ports.workflowDelayedJobs.create ? {
          create: (input) => ports.workflowDelayedJobs!.create!(scopedInput(input)),
        } : {}),
        ...(ports.workflowDelayedJobs.update ? {
          update: (input) => ports.workflowDelayedJobs!.update!(scopedInput(input)),
        } : {}),
        ...(ports.workflowDelayedJobs.delete ? {
          delete: (input) => ports.workflowDelayedJobs!.delete!(scopedInput(input)),
        } : {}),
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
    // An absent OR explicitly null accountId is a workspace-global write.
    if (raw === undefined || raw === null) return { kind: 'scope' };
    return lookupSingle(ports, workspaceId, { kind: 'account', id: requirePositiveInt(raw) });
  }
  if (resolution.kind === 'optional_message_lookup') {
    const raw = selectorValue(req, canonicalPath, resolution.messageId);
    if (raw === undefined && resolution.whenAbsent === 'mail_scope') return { kind: 'scope' };
    if (raw === undefined && resolution.whenAbsent === 'deny') throw new MailAccessDeniedError();
    if (raw === undefined) return { kind: 'resources', resources: [], mode: 'all' };
    if (raw === null && resolution.whenNull === 'non_mail') {
      return { kind: 'resources', resources: [], mode: 'all' };
    }
    return lookupSingle(ports, workspaceId, { kind: 'message', id: requirePositiveInt(raw) });
  }
  if (resolution.kind === 'workflow_execute_message_lookup') throw new MailAccessDeniedError();
  if (resolution.kind === 'message_or_account_lookup') {
    const message = selectorValue(req, canonicalPath, resolution.messageId);
    // Treat an explicit null messageId the same as absent (the schemas allow
    // both for account-only records) and fall through to the account.
    if (message !== undefined && message !== null) {
      return lookupSingle(ports, workspaceId, { kind: 'message', id: requirePositiveInt(message) });
    }
    const account = selectorValue(req, canonicalPath, resolution.accountId);
    if (account !== undefined && account !== null) {
      return lookupSingle(ports, workspaceId, { kind: 'account', id: requirePositiveInt(account) });
    }
    // Neither a message nor an account was supplied — a malformed payload (the
    // schemas require accountId). Deny uniformly rather than fall through to a
    // scope check that would let an owner reach the handler with garbage.
    if (resolution.whenAbsent === 'deny') throw new MailAccessDeniedError();
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
      : canonicalPath === '/api/v1/email/messages/:messageId/reply-draft'
        ? optionalPositiveInt(selectorValue(req, canonicalPath, { source: 'path', field: 'messageId' }))
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
    // Marking the reply parent "done" is a mail.triage mutation (finalizeSentDraft
    // calls markMessageDone on it). compose/send marks it done BY DEFAULT unless
    // markReplyParentDone is explicitly false; compose-draft only records the
    // intent when the flag is true. Require mail.triage on the parent in those
    // cases so a send/draft delegate without triage cannot mark it done.
    const markDone = bodyField(req.body, 'markReplyParentDone');
    const wouldMarkParent = canonicalPath === '/api/v1/email/compose/send'
      ? markDone !== false
      : canonicalPath === '/api/v1/email/messages/:messageId/compose-draft' && markDone === true;
    if (wouldMarkParent) {
      await ports.mailAccess!.assertPermission({
        workspaceId,
        actor,
        permission: 'mail.triage',
        resource: source[0]!,
      });
    }
  }

  if (
    req.method === 'PATCH'
    && canonicalPath === '/api/v1/workflow-delayed-jobs/:id'
    && isBodyObject(req.body)
    && Object.prototype.hasOwnProperty.call(req.body, 'messageId')
  ) {
    const rawMessageId = req.body.messageId;
    if (rawMessageId === null) return;
    const messageId = requirePositiveInt(rawMessageId);
    const replacement = await ports.mailResourceLookup!.resolve({
      workspaceId,
      target: { kind: 'message', id: messageId },
    });
    if (replacement.length !== 1) throw new MailAccessDeniedError();
    await ports.mailAccess!.assertPermission({
      workspaceId,
      actor,
      permission: 'mail.content.read',
      resource: replacement[0]!,
    });
  }

  // A move whose target is "trash" runs the same softDeleteMessageRows operation
  // as the dedicated mail.delete-protected /soft-delete route, so require
  // mail.delete on top of the base mail.triage. The handler trims `view`, so
  // trim here too — otherwise " trash " would slip past this check.
  if (req.method === 'PATCH' && canonicalPath === '/api/v1/email/messages/:messageId/move') {
    const moveView = bodyField(req.body, 'view');
    if (typeof moveView === 'string' && moveView.trim() === 'trash') {
      for (const resource of baseResources) {
        await ports.mailAccess!.assertPermission({
          workspaceId,
          actor,
          permission: 'mail.delete',
          resource,
        });
      }
    }
  }

  // Thread-edge creation persists BOTH parentMessageId and childMessageId, but
  // the base policy only authorizes the parent. Authorize the child too — reads
  // and deletes of the edge already require both messages to be in scope.
  if (req.method === 'POST' && canonicalPath === '/api/v1/email/thread-edges') {
    const childId = requirePositiveInt(bodyField(req.body, 'childMessageId'));
    const child = await ports.mailResourceLookup!.resolve({
      workspaceId,
      target: { kind: 'message', id: childId },
    });
    if (child.length !== 1) throw new MailAccessDeniedError();
    await ports.mailAccess!.assertPermission({
      workspaceId,
      actor,
      permission: 'mail.triage',
      resource: child[0]!,
    });
  }

  // Moving an account signature to a new account rewrites both account-reference
  // columns; the base policy only checks the current account, so require
  // mail.account.manage on the destination account too.
  if (req.method === 'PATCH' && canonicalPath === '/api/v1/email/account-signatures/:id') {
    const raw = bodyField(req.body, 'accountId');
    if (raw !== undefined) {
      const dest = await ports.mailResourceLookup!.resolve({
        workspaceId,
        target: { kind: 'account', id: requirePositiveInt(raw) },
      });
      if (dest.length !== 1) throw new MailAccessDeniedError();
      await ports.mailAccess!.assertPermission({
        workspaceId,
        actor,
        permission: 'mail.account.manage',
        resource: dest[0]!,
      });
    }
  }

  // A spam-decision PATCH may reparent the decision to a different message and/or
  // account; the base policy only authorizes the current one, so authorize each
  // replacement resource too (mirrors the workflow-delayed-job messageId block).
  if (req.method === 'PATCH' && canonicalPath === '/api/v1/spam/decisions/:id' && isBodyObject(req.body)) {
    const rawMessageId = req.body.messageId;
    if (rawMessageId !== undefined && rawMessageId !== null) {
      const message = await ports.mailResourceLookup!.resolve({
        workspaceId,
        target: { kind: 'message', id: requirePositiveInt(rawMessageId) },
      });
      if (message.length !== 1) throw new MailAccessDeniedError();
      await ports.mailAccess!.assertPermission({
        workspaceId,
        actor,
        permission: 'mail.triage',
        resource: message[0]!,
      });
    }
    const rawAccountId = req.body.accountId;
    if (rawAccountId !== undefined) {
      const account = await ports.mailResourceLookup!.resolve({
        workspaceId,
        target: { kind: 'account', id: requirePositiveInt(rawAccountId) },
      });
      if (account.length !== 1) throw new MailAccessDeniedError();
      await ports.mailAccess!.assertPermission({
        workspaceId,
        actor,
        permission: 'mail.triage',
        resource: account[0]!,
      });
    }
  }

  // A thread merge — and a thread-alias creation, which persists an alias row the
  // canonical-thread resolvers apply workspace-wide (filtered by workspace_id +
  // thread_id, NOT account_id) — rebuilds edges and the aggregate across the WHOLE
  // canonical thread (which can span accounts), while the base policy only checks
  // the submitted accountId. A delegate with triage on account A could otherwise
  // submit B's thread IDs and relabel B's threads. Require mail.triage on every
  // message in both the alias and canonical threads (mode 'all', unlike the read
  // path's 'any').
  if (
    req.method === 'POST'
    && (canonicalPath === '/api/v1/email/threads/merge' || canonicalPath === '/api/v1/email/thread-aliases')
  ) {
    for (const field of ['aliasThreadId', 'canonicalThreadId'] as const) {
      const raw = bodyField(req.body, field);
      if (typeof raw !== 'string' || !raw.trim()) throw new MailAccessDeniedError();
      const messages = await ports.mailResourceLookup!.resolve({
        workspaceId,
        target: { kind: 'thread', id: raw.trim() },
      });
      for (const resource of messages) {
        await ports.mailAccess!.assertPermission({
          workspaceId,
          actor,
          permission: 'mail.triage',
          resource,
        });
      }
    }
  }

  // A thread-alias PATCH may repoint the alias to replacement aliasThreadId /
  // canonicalThreadId that the handler applies workspace-wide, while the base
  // metadata policy only authorizes the alias's CURRENT account. Authorize every
  // replacement thread the same way alias creation does. Fields are optional on
  // update, so only check those actually supplied and non-empty (the handler
  // validates format otherwise).
  if (req.method === 'PATCH' && canonicalPath === '/api/v1/email/thread-aliases/:id') {
    for (const field of ['aliasThreadId', 'canonicalThreadId'] as const) {
      const raw = bodyField(req.body, field);
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const messages = await ports.mailResourceLookup!.resolve({
        workspaceId,
        target: { kind: 'thread', id: raw.trim() },
      });
      for (const resource of messages) {
        await ports.mailAccess!.assertPermission({
          workspaceId,
          actor,
          permission: 'mail.triage',
          resource,
        });
      }
    }
  }

  // Responding to a read-receipt request with action "send" loads the account's
  // SMTP credentials and transmits an outbound MDN to the sender — an outbound
  // send the base mail.triage policy doesn't cover. Require mail.send when
  // sending; declining stays a pure triage operation.
  if (
    req.method === 'POST'
    && canonicalPath === '/api/v1/email/messages/:messageId/read-receipt-response'
  ) {
    const action = bodyField(req.body, 'action');
    if (typeof action === 'string' && action.trim() === 'send') {
      for (const resource of baseResources) {
        await ports.mailAccess!.assertPermission({
          workspaceId,
          actor,
          permission: 'mail.send',
          resource,
        });
      }
    }
  }

  // Verifying a detached signature loads a SECOND attachment (signatureAttachmentId)
  // whose bytes reveal whether an otherwise-inaccessible file is a valid PGP
  // signature (and its fingerprint). The base policy only authorizes the path
  // attachment, so require mail.attachment.read on the supplied signature
  // attachment too.
  if (req.method === 'POST' && canonicalPath === '/api/v1/pgp/attachments/:attachmentId/verify') {
    const sigId = bodyField(req.body, 'signatureAttachmentId');
    if (sigId !== undefined && sigId !== null) {
      const signature = await ports.mailResourceLookup!.resolve({
        workspaceId,
        target: { kind: 'attachment', id: requirePositiveInt(sigId) },
      });
      if (signature.length !== 1) throw new MailAccessDeniedError();
      await ports.mailAccess!.assertPermission({
        workspaceId,
        actor,
        permission: 'mail.attachment.read',
        resource: signature[0]!,
      });
    }
  }
}

function isScopedWorkflowDelayedJobMutation(method: string, canonicalPath: string): boolean {
  return (method === 'POST' && canonicalPath === '/api/v1/workflow-delayed-jobs')
    || (
      (method === 'PATCH' || method === 'DELETE')
      && canonicalPath === '/api/v1/workflow-delayed-jobs/:id'
    );
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

function isBodyObject(body: unknown): body is Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
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
  // Bound the list BEFORE resolving each id — resolveHttpResources fires one
  // withWorkspaceTransaction per id, so an unbounded array would open millions
  // of parallel transactions and exhaust the pool before the bulk handler's own
  // 500-cap (parseEmailMessageBulkMutationBody) ever runs.
  if (values.length > MAX_BULK_MESSAGE_IDS) throw new MailAccessDeniedError();
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
