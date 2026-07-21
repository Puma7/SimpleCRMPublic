import { isPotentiallyDangerousAttachment } from '@simplecrm/core';
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
  // Fetching a single workspace-global category/team member by id is the same
  // lookup as listing the collection (both above), so a reader allowed the list
  // must be allowed the item — otherwise the mail UI 404s on a record it may show.
  '/api/v1/email/categories/:id',
  '/api/v1/email/category-counts',
  '/api/v1/email/message-categories',
  '/api/v1/email/internal-notes',
  '/api/v1/email/canned-responses',
  // Fetching a single canned response by id follows the same list-then-item rule:
  // a reader allowed the collection must be allowed a global (or resolved-in-scope)
  // item. Account-scoped rows still authorize per account via cannedResponsePath()
  // (the resource path, not this scope gate), so this admits only global rows here.
  '/api/v1/email/canned-responses/:id',
  '/api/v1/email/account-signatures',
  '/api/v1/email/remote-content-allowlist',
  '/api/v1/email/read-receipts',
  '/api/v1/email/team-members',
  '/api/v1/email/team-members/:id',
  '/api/v1/email/thread-edges',
  '/api/v1/email/thread-aliases',
  '/api/v1/email/threads',
  '/api/v1/email/thread-alias-warnings',
  // A delegated key manager (account-scoped mail.account.manage) can generate/rotate
  // their own PGP identity but otherwise resolves to a restricted/empty metadata
  // scope. Admit the identities LIST so the PGP panel loads; the route handler scopes
  // the result to the caller's own identities for non-owner/admin (private keys are
  // per-user), so this never exposes the workspace-wide list.
  '/api/v1/pgp/identities',
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
  // Categories and team members are workspace-global lookups the mail UI needs to
  // populate the category/assignee controls; a mail.triage delegate is authorized
  // to assign them, and scope-'none' users can already read them, so restricted
  // scopes must too. remote-content-allowlist stays excluded — it is an
  // account/workspace security setting, not triage lookup data.
  ...[...EMPTY_SCOPE_READ_PATHS].filter((path) => path !== '/api/v1/email/remote-content-allowlist'),
  // A delegate loads their OWN per-account signatures here, and the companion
  // upsert is already account-authorized — so a restricted-scope read must be
  // allowed too, otherwise they can save signatures they can never load. Kept out
  // of EMPTY_SCOPE_READ_PATHS so a scope-'none' user still gets nothing.
  '/api/v1/email/user-signatures',
  // A delegated sender (restricted mail.send scope) can reach the PGP encrypt/sign
  // endpoints, so they must also be able to check whether their recipients have
  // usable keys. Read-only, no account/message resource; scope 'none' still 404s.
  '/api/v1/pgp/recipient-key-status',
  // Read-only operational workspace settings the compose/triage UI needs: the
  // tracking policy drives the per-message tracking checkbox and snooze presets
  // drive every snooze action. A sender/triage delegate is authorized to use those
  // controls, so a nonempty restricted scope must read them; their PATCH mutations
  // stay separately protected (admin / mail.triage), and scope 'none' still 404s.
  '/api/v1/email/tracking/settings',
  '/api/v1/email/settings/snooze',
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
  // PGP identities are strictly per-user (stored + AEAD-bound to user_id == actor),
  // and signing/decryption load only the actor's own identity — so an owner/admin
  // cannot provision a key on a delegate's behalf. A delegated sender who may reach
  // encrypt/sign above must therefore be able to generate and rotate their OWN key;
  // these writes still require mail.account.manage (a scope-'none' delegate is
  // rejected before this allowlist), and the generate/rotate ports are user_id
  // scoped, so a restricted delegate can only touch their own identity. Peer-key
  // import and manual identity POST stay owner/admin-only (workspace-wide effect).
  '/api/v1/pgp/identities/generate',
  '/api/v1/pgp/identities/:identityId/private-key/passphrase',
  '/api/v1/pgp/identities/by-source/:sourceId/private-key/passphrase',
]);

// Message list/search routes that expose body-derived content (snippet, search
// snippet, body-text search). For a restricted-scope caller these resolve the
// mail.content.read scope so the read port can redact content per row.
const MESSAGE_CONTENT_SCOPE_PATHS = new Set<string>([
  '/api/v1/email/messages',
  '/api/v1/email/messages/conversation',
  '/api/v1/email/threads/:threadId/messages',
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
  // Message list/search routes authorize on mail.metadata.read but expose
  // body-derived content (snippet, search snippet, body-text search matches).
  // Resolve the caller's independent mail.content.read scope so the read port can
  // redact that content per-row for a metadata-only delegate. Owner/admin never
  // reach here (portsWithMailAccessContext skips scope 'all'), so this only runs
  // for restricted delegates.
  let contentScopePromise: Promise<MailSqlScope> | undefined;
  const resolveContentScope = (): Promise<MailSqlScope> => {
    contentScopePromise ??= ports.mailAccess!.resolveScope({
      workspaceId: principal.workspaceId,
      actor,
      permission: 'mail.content.read',
    });
    return contentScopePromise;
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
      const contentScope = scope.kind !== 'all' && MESSAGE_CONTENT_SCOPE_PATHS.has(entry.route.path)
        ? await resolveContentScope()
        : undefined;
      return { ok: true, context: { permission: entry.policy.permission, scope, contentScope } };
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
      const threadScope = await resolveScope();
      const contentScope = threadScope.kind !== 'all' && MESSAGE_CONTENT_SCOPE_PATHS.has(entry.route.path)
        ? await resolveContentScope()
        : undefined;
      return {
        ok: true,
        context: { permission: entry.policy.permission, scope: threadScope, contentScope },
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
  const contentScope = context.contentScope;
  const scopedInput = <T extends object>(input: T): T & { mailScope: MailSqlScope } => ({
    ...input,
    mailScope,
  });
  // Message list/search ports additionally receive the content-read scope so they
  // can redact body-derived content per row for a metadata-only delegate.
  const scopedMessageInput = <T extends object>(
    input: T,
  ): T & { mailScope: MailSqlScope; mailContentScope?: MailSqlScope } => (
    contentScope ? { ...input, mailScope, mailContentScope: contentScope } : { ...input, mailScope }
  );
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
        list: (input) => ports.emailMessages!.list(scopedMessageInput(input)),
        ...(ports.emailMessages.getFolderCounts ? {
          getFolderCounts: (input) => ports.emailMessages!.getFolderCounts!(scopedInput(input)),
        } : {}),
        ...(ports.emailMessages.listConversation ? {
          listConversation: (input) => ports.emailMessages!.listConversation!(scopedMessageInput(input)),
        } : {}),
        ...(ports.emailMessages.listThread ? {
          listThread: (input) => ports.emailMessages!.listThread!(scopedMessageInput(input)),
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
    ...(ports.emailUserSignatures ? {
      emailUserSignatures: {
        ...ports.emailUserSignatures,
        listForUser: (input) => ports.emailUserSignatures!.listForUser(scopedInput(input)),
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
  // owner_admin_only and event_message_pair are event-stream resolutions
  // (tombstones for deleted entities); no HTTP route uses them, so fail closed.
  if (resolution.kind === 'owner_admin_only' || resolution.kind === 'event_message_pair') {
    throw new MailAccessDeniedError();
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
  if (resolution.kind === 'canned_response_lookup') {
    const id = requirePositiveInt(selectorValue(req, canonicalPath, resolution.id));
    const resources = await ports.mailResourceLookup!.resolve({
      workspaceId,
      target: { kind: 'canned_response', id },
    });
    // An account-scoped canned response authorizes that account so its delegate
    // can autosave (PATCH) or reset (DELETE) the override. A global (accountless)
    // or missing row resolves to no account → the workspace-global scope gate,
    // where the restricted-scope write check keeps global rows owner/admin only.
    return resources.length === 0
      ? { kind: 'scope' }
      : { kind: 'resources', resources, mode: 'all' };
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
    // Sending rewrites the stored draft row with the caller-supplied subject,
    // body, recipients and attachments before it transmits (mail-compose-send
    // updateDraftForSend), so a send is a draft mutation, not just a transmit.
    // The base policy only requires mail.send; also require mail.draft.edit on
    // the draft so a custom send-only delegate (mail.send without mail.draft.edit)
    // cannot replace another user's draft content and recipients at send time.
    // Every built-in sending profile (editor/sender/manager) already includes
    // mail.draft.edit, and the compose UI persists the draft (mail.draft.edit)
    // before every send, so this only closes the direct-API send-without-edit gap.
    for (const resource of baseResources) {
      await ports.mailAccess!.assertPermission({
        workspaceId,
        actor,
        permission: 'mail.draft.edit',
        resource,
      });
    }
    const accountId = requirePositiveInt(bodyField(req.body, 'accountId'));
    const target = await ports.mailResourceLookup!.resolve({
      workspaceId,
      target: { kind: 'account', id: accountId },
    });
    if (target.length !== 1) throw new MailAccessDeniedError();
    const draftAccountId = baseResources[0]?.accountId;
    if (draftAccountId !== target[0]?.accountId) {
      // Sending from a different account transmits through THAT account's SMTP
      // credentials, so the base mail.send check on the draft's account is not
      // enough. mail.send_as is an additional identity right, not permission to
      // transmit — require BOTH mail.send and mail.send_as on the replacement
      // account, else a delegate with send on A but only send-as on B could push
      // A's draft out through B's credentials.
      for (const permission of ['mail.send', 'mail.send_as'] as const) {
        await ports.mailAccess!.assertPermission({
          workspaceId,
          actor,
          permission,
          resource: target[0]!,
        });
      }
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

  // Queuing (reply-suggestion/ensure) or generating (reply-draft) an AI reply
  // reads the message body and sends it to the AI provider, so it needs
  // mail.content.read in addition to the base mail.draft.create — the two grants
  // are independent, and a draft-create-only delegate must not read the body here.
  if (
    req.method === 'POST'
    && (
      canonicalPath === '/api/v1/email/messages/:messageId/reply-suggestion/ensure'
      || canonicalPath === '/api/v1/email/messages/:messageId/reply-draft'
    )
  ) {
    for (const resource of baseResources) {
      await ports.mailAccess!.assertPermission({
        workspaceId,
        actor,
        permission: 'mail.content.read',
        resource,
      });
    }
  }

  // The security-check POST reconstructs the raw message (raw_rfc822_b64, headers,
  // body) and submits it to mailauth/Rspamd, returning Rspamd symbols and the spam
  // breakdown — content-derived data the sibling GET /security route already gates
  // behind mail.content.read. The base policy classifies this as a mail.triage
  // mutation (it may persist a spam decision/status), so also require
  // mail.content.read: a triage-only delegate without content access must not read
  // reconstructed body content through the scan result.
  if (req.method === 'POST' && canonicalPath === '/api/v1/email/messages/:messageId/security/check') {
    for (const resource of baseResources) {
      await ports.mailAccess!.assertPermission({
        workspaceId,
        actor,
        permission: 'mail.content.read',
        resource,
      });
    }
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

  // A canned-response PATCH may reparent the row to a different account, or
  // globalize it (accountId → null). The base policy authorized only the row's
  // CURRENT account (or the workspace-global gate for an already-global row), so
  // authorize the replacement too: reparenting needs mail.draft.create on the
  // destination account; globalizing is a workspace-wide write kept owner/admin
  // only, matching the base scope gate for global rows.
  if (req.method === 'PATCH' && canonicalPath === '/api/v1/email/canned-responses/:id') {
    const raw = bodyField(req.body, 'accountId');
    if (raw === null) {
      if (!actor.isOwner && !actor.isAdmin) throw new MailAccessDeniedError();
    } else if (raw !== undefined) {
      const dest = await ports.mailResourceLookup!.resolve({
        workspaceId,
        target: { kind: 'account', id: requirePositiveInt(raw) },
      });
      if (dest.length !== 1) throw new MailAccessDeniedError();
      await ports.mailAccess!.assertPermission({
        workspaceId,
        actor,
        permission: 'mail.draft.create',
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

  // Spam decision / learning-event CREATE authorizes only the message when both
  // messageId and accountId are supplied (messageOrAccountBody), so a delegate can
  // pair an accessible message with a guessed foreign accountId; the create port
  // then resolves the unchecked account and its mismatch/not-found errors enumerate
  // inaccessible account ids. When both are present, authorize mail.triage on the
  // account too (the account-only case is already covered by the base).
  if (
    req.method === 'POST'
    && (canonicalPath === '/api/v1/spam/decisions' || canonicalPath === '/api/v1/spam/learning-events')
    && isBodyObject(req.body)
  ) {
    const rawMessageId = req.body.messageId;
    const rawAccountId = req.body.accountId;
    if (
      rawMessageId !== undefined && rawMessageId !== null
      && rawAccountId !== undefined && rawAccountId !== null
    ) {
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
      // An empty resolution means the thread currently holds no messages. A
      // restricted delegate must prove access to a real thread — otherwise they
      // could plant an alias for a not-yet-existing thread id that later captures
      // a thread created in an account they cannot reach (canonical alias
      // resolution is workspace-wide). Owner/admin have full access already.
      if (messages.length === 0 && !actor.isOwner && !actor.isAdmin) {
        throw new MailAccessDeniedError();
      }
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
  // metadata policy only authorizes the alias's CURRENT account. The resulting
  // relationship spans the EFFECTIVE pair — the request value where supplied, the
  // stored value otherwise — so authorizing only the supplied field would let a
  // delegate repoint one side of a cross-account alias without holding triage on
  // the unchanged (possibly inaccessible) other side. Require mail.triage on every
  // message in both effective threads. The planting guard (empty resolution) is
  // applied only to a NEW supplied thread; a stored side that is now empty is not
  // a planting vector.
  if (
    req.method === 'PATCH'
    && canonicalPath === '/api/v1/email/thread-aliases/:id'
    && ports.mailResourceLookup!.resolveThreadAliasThreadIds
  ) {
    const aliasId = optionalPositiveInt(
      selectorValue(req, canonicalPath, { source: 'path', field: 'id' }),
    );
    const stored = aliasId !== undefined
      ? await ports.mailResourceLookup!.resolveThreadAliasThreadIds({ workspaceId, aliasId })
      : null;
    for (const field of ['aliasThreadId', 'canonicalThreadId'] as const) {
      const raw = bodyField(req.body, field);
      const supplied = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
      const effective = supplied ?? stored?.[field];
      if (effective === undefined) continue;
      const messages = await ports.mailResourceLookup!.resolve({
        workspaceId,
        target: { kind: 'thread', id: effective },
      });
      if (supplied !== undefined && messages.length === 0 && !actor.isOwner && !actor.isAdmin) {
        throw new MailAccessDeniedError();
      }
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

  // A thread-alias DELETE removes the alias by id; the canonical-thread resolvers
  // then rebuild edges and the aggregate across BOTH the alias and canonical
  // threads (which can span accounts the row's own account_id does not cover),
  // while the base metadata policy only authorizes the alias's stored account.
  // There is no request body to read the thread ids from, so resolve them from
  // the stored row and require mail.triage on every message in both threads,
  // mirroring alias creation.
  if (
    req.method === 'DELETE'
    && canonicalPath === '/api/v1/email/thread-aliases/:id'
    && ports.mailResourceLookup!.resolveThreadAliasThreadIds
  ) {
    const aliasId = optionalPositiveInt(
      selectorValue(req, canonicalPath, { source: 'path', field: 'id' }),
    );
    if (aliasId !== undefined) {
      const threads = await ports.mailResourceLookup!.resolveThreadAliasThreadIds({
        workspaceId,
        aliasId,
      });
      for (const threadId of threads ? [threads.aliasThreadId, threads.canonicalThreadId] : []) {
        const messages = await ports.mailResourceLookup!.resolve({
          workspaceId,
          target: { kind: 'thread', id: threadId },
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

  // Downloading raw attachment bytes — or PGP-decrypting them — for a filename
  // whose extension is an executable/script type requires the extra
  // mail.attachment.suspicious_download grant on top of mail.attachment.read, so
  // the "Verdächtige Anhänge laden" delegation actually gates risky downloads.
  const isPgpDecrypt = req.method === 'POST'
    && canonicalPath === '/api/v1/pgp/attachments/:attachmentId/decrypt';
  if (
    ports.emailAttachments
    && (
      (req.method === 'GET' && canonicalPath === '/api/v1/email/attachments/:attachmentId/content')
      || isPgpDecrypt
    )
  ) {
    const attachmentId = requirePositiveInt(
      selectorValue(req, canonicalPath, { source: 'path', field: 'attachmentId' }),
    );
    const attachment = await ports.emailAttachments.get({ workspaceId, id: attachmentId });
    // PGP decrypt returns the DECRYPTED name (invoice.exe.pgp → invoice.exe), so
    // classify the post-decryption name — otherwise the stored ".pgp" extension
    // reads as safe and the executable payload bypasses suspicious_download.
    const classifiedName = attachment
      ? (isPgpDecrypt ? pgpDecryptedAttachmentName(attachment.filename) : attachment.filename)
      : undefined;
    if (classifiedName !== undefined && isPotentiallyDangerousAttachment(classifiedName)) {
      for (const resource of baseResources) {
        await ports.mailAccess!.assertPermission({
          workspaceId,
          actor,
          permission: 'mail.attachment.suspicious_download',
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

  // Returning the raw EML source streams the full MIME body — including every
  // attachment's decoded bytes — through a single mail.content.read gate. The
  // dedicated attachment-content route additionally requires mail.attachment.read
  // (and suspicious_download for risky extensions), so a content-only delegate
  // could otherwise exfiltrate attachments this same message denies them on the
  // attachment route. Require mail.attachment.read on top of the base check.
  if (req.method === 'GET' && canonicalPath === '/api/v1/email/messages/:messageId/raw-headers') {
    for (const resource of baseResources) {
      await ports.mailAccess!.assertPermission({
        workspaceId,
        actor,
        permission: 'mail.attachment.read',
        resource,
      });
    }
    // Raw EML embeds every attachment's decoded bytes, so a message carrying a
    // dangerous (executable/script) attachment additionally requires the
    // suspicious-download grant — the attachment-content route gates it, so this
    // path must too, else a delegate without it exfiltrates the executable here.
    if (ports.emailAttachments?.listForMessage) {
      for (const resource of baseResources) {
        if (resource.type !== 'message') continue;
        const attachments = await ports.emailAttachments.listForMessage({
          workspaceId,
          messageId: Number(resource.messageId),
        });
        if (attachments.items.some((item) => isPotentiallyDangerousAttachment(item.filename))) {
          await ports.mailAccess!.assertPermission({
            workspaceId,
            actor,
            permission: 'mail.attachment.suspicious_download',
            resource,
          });
        }
      }
    }
  }

  // Setting a per-message remote-content decision is triage, but rememberSender /
  // rememberDomain additionally persist a row into email_remote_content_allowlist
  // scoped by workspace + sender/domain (NOT by account), which governs remote
  // content loading for ALL current and future messages workspace-wide. An
  // account-scoped mail.account.manage grant is not enough — that delegate could
  // weaken remote-content privacy for inaccessible accounts' messages. The dedicated
  // allowlist routes are owner/admin-only (workspace security setting), so require
  // the same full-workspace authority here before either remember option is honoured
  // (the handler rejects both being true at once). Scoped triage still sets the
  // per-message decision without the remember flags.
  if (req.method === 'PATCH' && canonicalPath === '/api/v1/email/messages/:messageId/remote-content-policy') {
    const remember = bodyField(req.body, 'rememberSender') === true
      || bodyField(req.body, 'rememberDomain') === true;
    if (remember && !actor.isOwner && !actor.isAdmin) {
      throw new MailAccessDeniedError();
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

// Mirrors pgpDecryptedAttachmentName in pgp/message-crypto-port.ts: the decrypt
// route derives the returned filename by stripping a trailing .pgp/.gpg/.asc, so
// the suspicious-attachment gate must classify that post-decryption name.
function pgpDecryptedAttachmentName(filename: string): string {
  const base = filename.trim() || 'attachment';
  const stripped = base.replace(/\.(?:pgp|gpg|asc)$/i, '').trim();
  return stripped || `${base}.decrypted`;
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
