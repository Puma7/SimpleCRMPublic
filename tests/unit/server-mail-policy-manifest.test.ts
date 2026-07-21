import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from '@swc/core';
import {
  SERVER_EVENT_TYPES,
  SERVER_API_ROUTE_REGISTRATIONS,
  SERVER_MAIL_ROUTE_INVENTORY,
  type CanonicalApiRoute,
  type CanonicalApiRouteRegistration,
  type ServerApiPorts,
} from '../../packages/server/src/api';
import { EMAIL_TRACKING_ROUTE_REGISTRATIONS } from '../../packages/server/src/api/email-tracking-routes';
import { MAIL_LOCK_ROUTE_REGISTRATIONS } from '../../packages/server/src/api/lock-routes';
import {
  MAIL_METADATA_ROUTE_REGISTRATIONS,
  handleMailMetadataReadRoute,
} from '../../packages/server/src/api/mail-metadata-routes';
import { MAIL_ROUTE_REGISTRATIONS } from '../../packages/server/src/api/mail-routes';
import { MAIL_NOTICE_ROUTE_REGISTRATIONS } from '../../packages/server/src/api/notice-routes';
import { PGP_MAIL_ROUTE_REGISTRATIONS } from '../../packages/server/src/api/pgp-routes';
import { SMTP_RELAY_ROUTE_REGISTRATIONS } from '../../packages/server/src/api/relay-routes';
import { MAIL_SETTINGS_ROUTE_REGISTRATIONS } from '../../packages/server/src/api/settings-routes';
import { SPAM_MAIL_ROUTE_REGISTRATIONS } from '../../packages/server/src/api/spam-routes';
import { USER_SIGNATURE_ROUTE_REGISTRATIONS } from '../../packages/server/src/api/user-signature-routes';
import {
  WORKFLOW_MAIL_ROUTE_REGISTRATIONS,
  handleWorkflowReadRoute,
} from '../../packages/server/src/api/workflow-routes';
import {
  MAIL_EVENT_POLICY_MANIFEST,
  MAIL_ROUTE_POLICY_MANIFEST,
  assertMailEventPolicy,
  assertMailRoutePolicy,
  createMailEventPolicyIndex,
  createMailRoutePolicyIndex,
  mailRoutePolicyKey,
} from '../../packages/server/src/mail-access/policy-manifest';
import {
  SERVER_JOB_POLICIES,
  SERVER_JOB_TYPES,
  assertServerJobPolicy,
  createServerJobPolicyIndex,
} from '../../packages/server/src/jobs/policy';
import { createProductionJobHandlers } from '../../packages/server/src/jobs/production-handlers';

describe('server mail policy manifest', () => {
  test('classifies every canonical mail route exactly once', () => {
    const registeredKeys = SERVER_MAIL_ROUTE_INVENTORY.map(mailRoutePolicyKey);
    const policyKeys = MAIL_ROUTE_POLICY_MANIFEST.map(({ route }) => mailRoutePolicyKey(route));

    expect(new Set(registeredKeys).size).toBe(registeredKeys.length);
    expect(policyKeys.sort()).toEqual(registeredKeys.sort());
  });

  test('derives inventories from the registrations used by the real dispatchers', () => {
    const centralInventory = SERVER_API_ROUTE_REGISTRATIONS.flatMap((registration) => (
      registration.kind === 'mail' ? registration.routes : []
    ));
    expect(centralInventory).toEqual(SERVER_MAIL_ROUTE_INVENTORY);
    expect(SERVER_API_ROUTE_REGISTRATIONS.map(({ source }) => source)).toEqual([
      'auth-security-routes',
      'auth-routes',
      'automation-routes',
      'email-tracking-routes',
      'relay-routes',
      'user-signature-routes',
      'customer-routes',
      'user-group-routes',
      'mail-delegation-routes',
      'mail-acl-rollout-routes',
      'diagnostics-routes',
      'maintenance-routes',
      'core-crm-routes',
      'dashboard-routes',
      'extended-crm-routes',
      'follow-up-routes',
      'settings-routes',
      'mail-routes',
      'notice-routes',
      'workflow-mail-routes',
      'workflow-routes',
      'pgp-routes',
      'spam-routes',
      'returns-routes',
      'lock-routes',
    ]);

    expectRegistrationInventory('email-tracking-routes', EMAIL_TRACKING_ROUTE_REGISTRATIONS);
    expectRegistrationInventory('relay-routes', SMTP_RELAY_ROUTE_REGISTRATIONS);
    expectRegistrationInventory('user-signature-routes', USER_SIGNATURE_ROUTE_REGISTRATIONS);
    expectRegistrationInventory('settings-routes', MAIL_SETTINGS_ROUTE_REGISTRATIONS);
    expectRegistrationInventory('mail-routes', MAIL_ROUTE_REGISTRATIONS);
    expectRegistrationInventory('mail-metadata-routes', MAIL_METADATA_ROUTE_REGISTRATIONS);
    expectRegistrationInventory('notice-routes', MAIL_NOTICE_ROUTE_REGISTRATIONS);
    expectRegistrationInventory('workflow-mail-routes', WORKFLOW_MAIL_ROUTE_REGISTRATIONS);
    expectRegistrationInventory('pgp-routes', PGP_MAIL_ROUTE_REGISTRATIONS);
    expectRegistrationInventory('spam-routes', SPAM_MAIL_ROUTE_REGISTRATIONS);
    expectRegistrationInventory('lock-routes', MAIL_LOCK_ROUTE_REGISTRATIONS);
  });

  test('independently inventories every delayed-job method accepted by the workflow handler', async () => {
    const principal = {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      role: 'user' as const,
    };
    const accepted = [
      ['GET', '/api/v1/workflow-delayed-jobs'],
      ['POST', '/api/v1/workflow-delayed-jobs'],
      ['GET', '/api/v1/workflow-delayed-jobs/87'],
      ['PATCH', '/api/v1/workflow-delayed-jobs/87'],
      ['DELETE', '/api/v1/workflow-delayed-jobs/87'],
    ] as const;

    for (const [method, path] of accepted) {
      const response = await handleWorkflowReadRoute({ method, path, principal }, {} as ServerApiPorts);
      expect(response?.status).not.toBe(405);
      expect(WORKFLOW_MAIL_ROUTE_REGISTRATIONS.some(({ registration }) => (
        registration.methods.includes(method)
        && registration.pattern.test(path)
      ))).toBe(true);
    }

    await expect(handleWorkflowReadRoute({
      method: 'PUT',
      path: '/api/v1/workflow-delayed-jobs/87',
      principal,
    }, {} as ServerApiPorts)).resolves.toMatchObject({ status: 405 });
  });

  test('preserves method fallthrough for method-specific metadata upsert branches', async () => {
    const principal = {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      role: 'user' as const,
    };
    const ports = {} as ServerApiPorts;

    await expect(handleMailMetadataReadRoute({
      method: 'GET',
      path: '/api/v1/email/team-members/member-1/upsert',
      principal,
    }, ports)).resolves.toBeNull();
    await expect(handleMailMetadataReadRoute({
      method: 'GET',
      path: '/api/v1/email/account-signatures/by-account/1/upsert',
      principal,
    }, ports)).resolves.toBeNull();
  });

  test('classifies every canonical job type exactly once', () => {
    expect(SERVER_JOB_POLICIES.map(({ type }) => type).sort()).toEqual([...SERVER_JOB_TYPES].sort());
    for (const policy of SERVER_JOB_POLICIES) {
      expect(['initiating_user', 'initiating_user_or_service', 'service']).toContain(policy.actorMode);
      if (policy.kind === 'mail') {
        expect(policy.permission).toMatch(/^mail\./);
        expect(policy.resource.kind).toBeTruthy();
      } else {
        expect(['non_mail', 'system_maintenance']).toContain(policy.classification);
      }
    }
  });

  test('covers production handlers and workflow job enqueue literals with canonical policies', () => {
    const productionHandlerTypes = Object.keys(createProductionJobHandlers({}));
    const workflowEnqueueTypes = workflowJobQueueTypes();
    const executableTypes = [...new Set([...productionHandlerTypes, ...workflowEnqueueTypes])];

    expect(productionHandlerTypes).toContain('ai.pick_canned');
    expect(workflowEnqueueTypes).toContain('ai.pick_canned');
    expect(SERVER_JOB_TYPES).toEqual(expect.arrayContaining(executableTypes));
    expect(SERVER_JOB_POLICIES.map(({ type }) => type)).toEqual(expect.arrayContaining(executableTypes));
  });

  test('classifies PGP detect and verify as triage mutations, not reads', () => {
    // Both persist the shared pgp_status / signer fingerprint on the message.
    for (const path of [
      '/api/v1/pgp/messages/42/detect',
      '/api/v1/pgp/messages/42/verify',
    ]) {
      expect(assertMailRoutePolicy('POST', path).policy).toEqual({
        kind: 'permission',
        permission: 'mail.triage',
        resource: { kind: 'message_lookup', messageId: { source: 'path', field: 'messageId' } },
      });
    }
  });

  test('classifies ai.pick_canned as optional message content access', () => {
    expect(assertServerJobPolicy('ai.pick_canned')).toEqual({
      type: 'ai.pick_canned',
      kind: 'mail',
      actorMode: 'initiating_user_or_service',
      permission: 'mail.content.read',
      resource: {
        kind: 'optional_message_lookup',
        messageId: { source: 'job', field: 'messageId' },
        whenAbsent: 'non_mail',
      },
    });
  });

  test('classifies every mail event type exactly once', () => {
    const mailEventTypes = SERVER_EVENT_TYPES
      .filter(isMailEventType)
      .filter((type) => type !== 'email_acl.changed');
    expect(MAIL_EVENT_POLICY_MANIFEST.map(({ type }) => type).sort()).toEqual(mailEventTypes.sort());
    expect(MAIL_EVENT_POLICY_MANIFEST.every(({ permission }) => (
      permission === 'mail.metadata.read'
      || permission === 'mail.content.read'
      || permission === 'mail.attachment.read'
      || permission === 'mail.comment'
      || permission === 'mail.draft.create'
    ))).toBe(true);
  });

  test('internal-note events require mail.comment, matching the note routes', () => {
    const noteEvents = MAIL_EVENT_POLICY_MANIFEST.filter(({ type }) => type.startsWith('email_internal_note.'));
    expect(noteEvents.length).toBeGreaterThan(0);
    expect(noteEvents.every(({ permission }) => permission === 'mail.comment')).toBe(true);
  });

  test('canned-response events require mail.draft.create, matching the read route', () => {
    const cannedEvents = MAIL_EVENT_POLICY_MANIFEST.filter(({ type }) => type.startsWith('email_canned_response.'));
    expect(cannedEvents.length).toBeGreaterThan(0);
    expect(cannedEvents.every(({ permission }) => permission === 'mail.draft.create')).toBe(true);
  });

  test('canned-response events resolve parent-aware to their account, falling back to workspace-global for templates', () => {
    const cannedEvents = MAIL_EVENT_POLICY_MANIFEST.filter(({ type }) => type.startsWith('email_canned_response.'));
    expect(cannedEvents.length).toBeGreaterThan(0);
    // R47-3: whenPresent 'account_parent_aware' delivers create/update/delete events to a
    // folder/message-scoped draft.create editor who can read the parent account's templates.
    expect(cannedEvents.every(({ resource }) => resource.kind === 'optional_account'
      && resource.whenAbsent === 'workspace_global'
      && resource.whenPresent === 'account_parent_aware'
      && resource.accountId.source === 'event_payload'
      && resource.accountId.field === 'accountId')).toBe(true);
  });

  test('thread-alias deletion authorizes against both deleted threads (R47-4)', () => {
    const tombstone = MAIL_EVENT_POLICY_MANIFEST.find(({ type }) => type === 'email_thread_alias.deleted');
    expect(tombstone).toBeDefined();
    expect(tombstone!.resource).toMatchObject({
      kind: 'event_thread_alias_tombstone',
      aliasThreadId: { source: 'event_payload', field: 'aliasThreadId' },
      canonicalThreadId: { source: 'event_payload', field: 'canonicalThreadId' },
      accountId: { source: 'event_payload', field: 'accountId' },
    });
  });

  test('rejects duplicate route, job and event policy keys', () => {
    const route = syntheticRoute('GET', '/api/v1/email/synthetic');
    const routeEntry = {
      route,
      policy: {
        kind: 'permission' as const,
        permission: 'mail.metadata.read' as const,
        resource: { kind: 'mail_scope' as const },
      },
    };
    expect(() => createMailRoutePolicyIndex([routeEntry, routeEntry])).toThrow(/duplicate/i);

    const jobEntry = SERVER_JOB_POLICIES[0]!;
    expect(() => createServerJobPolicyIndex([jobEntry, jobEntry])).toThrow(/duplicate/i);

    const eventEntry = MAIL_EVENT_POLICY_MANIFEST[0]!;
    expect(() => createMailEventPolicyIndex([eventEntry, eventEntry])).toThrow(/duplicate/i);
  });

  test('fails closed for unknown routes, jobs and mail events', () => {
    expect(() => assertMailRoutePolicy('GET', '/api/v1/email/synthetic')).toThrow(/unclassified/i);
    expect(() => assertServerJobPolicy('mail.synthetic')).toThrow(/unsupported|unclassified/i);
    expect(() => assertMailEventPolicy('email_synthetic.updated')).toThrow(/unclassified/i);
  });

  test('keeps public tracking and auth/setup exemptions explicit and narrow', () => {
    const exemptions = MAIL_ROUTE_POLICY_MANIFEST.flatMap(({ route, policy }) => (
      policy.kind === 'exempt'
        ? [`${policy.reason}: ${route.method} ${route.path}`]
        : []
    ));

    expect(exemptions.sort()).toEqual([
      // .../oauth/:provider/app moved to admin-only (workspace_admin_security);
      // .../finish stays exempt but its handler now enforces requireAdmin.
      'mail_auth_setup: POST /api/v1/email/accounts/test-imap',
      'mail_auth_setup: POST /api/v1/email/accounts/test-pop3',
      'mail_auth_setup: POST /api/v1/email/accounts/test-smtp',
      'mail_auth_setup: POST /api/v1/email/oauth/:provider/authorize-url',
      'mail_auth_setup: POST /api/v1/email/oauth/:provider/finish',
      'signed_public_tracking: GET /t/c/:token',
      'signed_public_tracking: GET /t/o/:token.gif',
      'workspace_admin_security: DELETE /api/v1/email/messages/:messageId/tracking',
      'workspace_admin_security: GET /api/v1/email/oauth/:provider/app',
      'workspace_admin_security: PATCH /api/v1/email/oauth/:provider/app',
      'workspace_admin_security: DELETE /api/v1/email/relays/:relayId',
      'workspace_admin_security: DELETE /api/v1/email/relays/:relayId/accounts/:accountId',
      'workspace_admin_security: GET /api/v1/email/messages/:messageId/tracking/events/:eventId/ip-insight',
      'workspace_admin_security: GET /api/v1/email/relays',
      'workspace_admin_security: GET /api/v1/email/relays/:relayId/submissions',
      'workspace_admin_security: GET /api/v1/email/settings/security',
      'workspace_admin_security: PATCH /api/v1/email/relays/:relayId',
      'workspace_admin_security: PATCH /api/v1/email/settings/security',
      'workspace_admin_security: PATCH /api/v1/email/tracking/settings',
      'workspace_admin_security: POST /api/v1/email/messages/:messageId/tracking/reclassify',
      'workspace_admin_security: POST /api/v1/email/messages/:messageId/tracking/revoke',
      'workspace_admin_security: POST /api/v1/email/relays',
      'workspace_admin_security: POST /api/v1/email/relays/:relayId/accounts',
      'workspace_admin_security: POST /api/v1/email/relays/:relayId/credentials',
      'workspace_admin_security: POST /api/v1/email/relays/:relayId/credentials/:credentialId/revoke',
      'workspace_admin_security: POST /api/v1/email/settings/security/test-rspamd',
    ].sort());
  });

  test('protected routes declare one permission and a typed resource resolution', () => {
    const protectedRoutes = MAIL_ROUTE_POLICY_MANIFEST.filter(
      (entry): entry is Extract<(typeof MAIL_ROUTE_POLICY_MANIFEST)[number], { policy: { kind: 'permission' } }> => (
        entry.policy.kind === 'permission'
      ),
    );
    expect(protectedRoutes).not.toHaveLength(0);
    for (const { policy } of protectedRoutes) {
      expect(typeof policy.permission).toBe('string');
      expect(typeof policy.resource.kind).toBe('string');
      expect(Object.keys(policy).sort()).toEqual(['kind', 'permission', 'resource']);
    }
  });

  test('requires authoritative lookups for resources whose parents are not in the route', () => {
    expect(assertMailRoutePolicy('GET', '/api/v1/email/messages/42').policy).toMatchObject({
      kind: 'permission',
      resource: { kind: 'message_lookup', messageId: { source: 'path', field: 'messageId' } },
    });
    expect(assertMailRoutePolicy('GET', '/api/v1/email/attachments/7/content').policy).toMatchObject({
      kind: 'permission',
      resource: { kind: 'attachment_lookup', attachmentId: { source: 'path', field: 'attachmentId' } },
    });
    expect(assertMailRoutePolicy('GET', '/api/v1/email/folders/9').policy).toMatchObject({
      kind: 'permission',
      resource: { kind: 'folder_lookup', folderId: { source: 'path', field: 'id' } },
    });
    expect(assertMailRoutePolicy('POST', '/api/v1/email/compose/send').policy).toMatchObject({
      kind: 'permission',
      resource: { kind: 'message_lookup', messageId: { source: 'body', field: 'draftMessageId' } },
    });
  });

  test('uses exact permissions and selectors for risky route families', () => {
    const matrix = [
      ['GET', '/api/v1/email/tracking/settings', 'mail.metadata.read', { kind: 'workspace_global' }],
      ['GET', '/api/v1/email/messages/42/tracking', 'mail.metadata.read', messagePath()],
      ['GET', '/api/v1/email/settings/misc', 'mail.metadata.read', { kind: 'workspace_global' }],
      ['PATCH', '/api/v1/email/settings/misc', 'mail.account.manage', { kind: 'workspace_global' }],
      ['GET', '/api/v1/email/settings/account-mail', 'mail.metadata.read', account('query')],
      ['PATCH', '/api/v1/email/settings/account-mail', 'mail.account.manage', account('body')],
      ['GET', '/api/v1/email/settings/snooze', 'mail.metadata.read', { kind: 'workspace_global' }],
      ['PATCH', '/api/v1/email/settings/snooze', 'mail.triage', { kind: 'workspace_global' }],
      ['GET', '/api/v1/email/settings/reply-suggestion', 'mail.metadata.read', optionalAccount('query')],
      ['PATCH', '/api/v1/email/settings/reply-suggestion', 'mail.account.manage', optionalAccount('body')],
      ['POST', '/api/v1/email/compose/send', 'mail.send', messageBody('draftMessageId')],
      ['GET', '/api/v1/email/attachments/7', 'mail.attachment.read', attachmentPath()],
      ['GET', '/api/v1/email/attachments/7/content', 'mail.attachment.read', attachmentPath()],
      ['GET', '/api/v1/email/messages/42/attachments', 'mail.attachment.read', messagePath()],
      ['POST', '/api/v1/email/messages/42/compose-attachments', 'mail.draft.edit', messagePath()],
      ['PATCH', '/api/v1/email/messages/bulk/soft-delete', 'mail.delete', bulkBody()],
      ['PATCH', '/api/v1/email/messages/bulk/archive', 'mail.triage', bulkBody()],
      ['GET', '/api/v1/locks', 'mail.metadata.read', bulkQuery()],
      ['GET', '/api/v1/email/accounts', 'mail.metadata.read', { kind: 'mail_scope' }],
      ['POST', '/api/v1/email/accounts', 'mail.account.manage', { kind: 'mail_scope' }],
      ['GET', '/api/v1/email/accounts/9', 'mail.metadata.read', account('path')],
      ['PATCH', '/api/v1/email/accounts/9', 'mail.account.manage', account('path')],
      ['DELETE', '/api/v1/email/accounts/9', 'mail.account.manage', account('path')],
      ['POST', '/api/v1/email/threads/merge', 'mail.triage', optionalAccount('body')],
      ['POST', '/api/v1/email/thread-aliases', 'mail.triage', optionalAccount('body')],
      ['POST', '/api/v1/workflows/23/execute', 'mail.content.read', optionalMessageBody()],
      ['POST', '/api/v1/workflows/by-source/-23/execute', 'mail.content.read', optionalMessageBody()],
      ['GET', '/api/v1/email/messages/42/workflow-runs', 'mail.content.read', messagePath()],
      ['GET', '/api/v1/workflow-runs', 'mail.content.read', { kind: 'mail_scope' }],
      ['GET', '/api/v1/workflow-runs/80', 'mail.content.read', { kind: 'mail_scope' }],
      ['GET', '/api/v1/workflow-runs/80/steps', 'mail.content.read', { kind: 'mail_scope' }],
      ['GET', '/api/v1/workflow-runs/by-source/-91', 'mail.content.read', { kind: 'mail_scope' }],
      ['GET', '/api/v1/workflow-runs/by-source/-91/steps', 'mail.content.read', { kind: 'mail_scope' }],
      ['GET', '/api/v1/workflow-run-steps', 'mail.content.read', { kind: 'mail_scope' }],
      ['GET', '/api/v1/workflow-run-steps/81', 'mail.content.read', { kind: 'mail_scope' }],
      ['GET', '/api/v1/workflow-message-applied', 'mail.content.read', { kind: 'mail_scope' }],
      ['GET', '/api/v1/workflow-message-applied/82', 'mail.content.read', { kind: 'mail_scope' }],
      ['GET', '/api/v1/workflow-forward-dedup', 'mail.content.read', { kind: 'mail_scope' }],
      ['GET', '/api/v1/workflow-forward-dedup/83', 'mail.content.read', { kind: 'mail_scope' }],
      ['GET', '/api/v1/workflow-delayed-jobs', 'mail.content.read', { kind: 'mail_scope' }],
      ['GET', '/api/v1/workflow-delayed-jobs/84', 'mail.content.read', { kind: 'mail_scope' }],
      ['POST', '/api/v1/workflow-delayed-jobs', 'mail.content.read', optionalMessageBody({ allowNull: true })],
      ['PATCH', '/api/v1/workflow-delayed-jobs/84', 'mail.content.read', { kind: 'mail_scope' }],
      ['DELETE', '/api/v1/workflow-delayed-jobs/84', 'mail.content.read', { kind: 'mail_scope' }],
    ] as const;

    for (const [method, path, permission, resource] of matrix) {
      expect(assertMailRoutePolicy(method, path).policy).toEqual({
        kind: 'permission',
        permission,
        resource,
      });
    }
  });

  test('uses the narrower account fallback for scheduled sends without a draft', () => {
    expect(assertServerJobPolicy('mail.send.scheduled')).toMatchObject({
      permission: 'mail.send',
      resource: {
        kind: 'message_or_account_lookup',
        messageId: { source: 'job', field: 'draftId' },
        accountId: { source: 'job', field: 'accountId' },
        whenAbsent: 'mail_scope',
      },
    });
  });

  test('classifies message workflow execution jobs as content reads and preserves no-message jobs', () => {
    expect(assertServerJobPolicy('workflow.execute')).toEqual({
      type: 'workflow.execute',
      kind: 'mail',
      actorMode: 'initiating_user_or_service',
      permission: 'mail.content.read',
      resource: {
        kind: 'workflow_execute_message_lookup',
        messageId: { source: 'job', field: 'messageId' },
        delayedJobId: { source: 'job', field: 'delayedJobId' },
      },
    });
  });

  test('classifies delayed-job events by optional source message instead of non-mail passthrough', () => {
    for (const type of [
      'workflow_delayed_job.created',
      'workflow_delayed_job.updated',
      'workflow_delayed_job.deleted',
    ] as const) {
      expect(assertMailEventPolicy(type)).toEqual({
        type,
        permission: 'mail.content.read',
        resource: {
          kind: 'optional_message_lookup',
          messageId: { source: 'event_payload', field: 'messageId' },
          // An orphaned mail job nulls message_id but keeps message_source_sqlite_id;
          // consulting it fails closed (owner/admin only) instead of broadcasting the
          // job as non_mail to every workspace user.
          messageSourceSqliteId: { source: 'event_payload', field: 'messageSourceSqliteId' },
          whenAbsent: 'deny',
          whenNull: 'non_mail',
        },
      });
    }
  });

  test('resolves every spam event by message then account and denies missing resources', () => {
    const eventTypes = [
      'spam_learning_event.created',
      'spam_decision.created',
      'spam_decision.updated',
      'spam_decision.deleted',
    ] as const;
    expect(SERVER_EVENT_TYPES.filter((type) => (
      type.startsWith('spam_learning_event.') || type.startsWith('spam_decision.')
    ))).toEqual(eventTypes);
    for (const type of eventTypes) {
      expect(assertMailEventPolicy(type)).toEqual({
        type,
        permission: 'mail.metadata.read',
        resource: {
          kind: 'event_message_then_account_lookup',
          messageId: { source: 'event_payload', field: 'messageId' },
          accountId: { source: 'event_payload', field: 'accountId' },
          whenAbsent: 'deny',
        },
      });
    }
  });

  test('restricts PGP peer-key and spam-list events to owners/admins, PGP identity events to the owning user', () => {
    // pgp_peer_key and spam_list_entry mutations stay owner/admin; spam_learning_event
    // and spam_decision carry a message/account and are resolved separately above.
    // pgp_identity events are per-user and deliver to the owning user too.
    const eventTypes = SERVER_EVENT_TYPES.filter((type) => (
      (type.startsWith('pgp_') || type.startsWith('spam_'))
      && !type.startsWith('spam_learning_event.')
      && !type.startsWith('spam_decision.')
    ));
    expect(eventTypes).not.toHaveLength(0);
    expect(eventTypes.some((type) => type.startsWith('pgp_identity.'))).toBe(true);
    expect(eventTypes.some((type) => type.startsWith('pgp_peer_key.'))).toBe(true);
    expect(eventTypes.some((type) => type.startsWith('spam_list_entry.'))).toBe(true);
    for (const type of eventTypes) {
      expect(assertMailEventPolicy(type)).toEqual({
        type,
        permission: 'mail.metadata.read',
        resource: type.startsWith('pgp_identity.')
          ? { kind: 'owner_admin_or_event_user', userId: { source: 'event_payload', field: 'userId' } }
          : { kind: 'owner_admin_only' },
      });
    }
  });
});

function workflowJobQueueTypes(): string[] {
  const path = join(process.cwd(), 'packages', 'server', 'src', 'workflow-execution.ts');
  const sourceFile = parseSync(readFileSync(path, 'utf8'), { syntax: 'typescript' });
  const types: string[] = [];

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isRecord(node)) return;

    const type = jobQueueTypeFromValuesCall(node);
    if (type) types.push(type);
    for (const child of Object.values(node)) {
      visit(child);
    }
  };
  visit(sourceFile);
  return types;
}

function jobQueueTypeFromValuesCall(node: Readonly<Record<string, unknown>>): string | null {
  if (node.type !== 'CallExpression') return null;
  const valuesMember = recordValue(node.callee);
  if (valuesMember?.type !== 'MemberExpression' || identifierValue(valuesMember.property) !== 'values') return null;
  const insertCall = recordValue(valuesMember.object);
  if (insertCall?.type !== 'CallExpression') return null;
  const insertMember = recordValue(insertCall.callee);
  if (insertMember?.type !== 'MemberExpression' || identifierValue(insertMember.property) !== 'insertInto') return null;
  if (argumentStringValue(insertCall.arguments, 0) !== 'job_queue') return null;

  const valuesObject = argumentExpression(node.arguments, 0);
  if (valuesObject?.type !== 'ObjectExpression' || !Array.isArray(valuesObject.properties)) return null;
  for (const property of valuesObject.properties) {
    const candidate = recordValue(property);
    if (candidate?.type !== 'KeyValueProperty' || identifierValue(candidate.key) !== 'type') continue;
    const value = recordValue(candidate.value);
    return value?.type === 'StringLiteral' && typeof value.value === 'string' ? value.value : null;
  }
  return null;
}

function argumentStringValue(value: unknown, index: number): string | null {
  const expression = argumentExpression(value, index);
  return expression?.type === 'StringLiteral' && typeof expression.value === 'string' ? expression.value : null;
}

function argumentExpression(value: unknown, index: number): Readonly<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  return recordValue(recordValue(value[index])?.expression);
}

function identifierValue(value: unknown): string | null {
  const identifier = recordValue(value);
  return identifier?.type === 'Identifier' && typeof identifier.value === 'string' ? identifier.value : null;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isMailEventType(type: string): boolean {
  return type.startsWith('email_')
    || type.startsWith('conversation_lock.')
    || type.startsWith('spam_')
    || type.startsWith('pgp_')
    || type.startsWith('workflow_delayed_job.');
}

function account(source: 'path' | 'query' | 'body') {
  return { kind: 'account', accountId: { source, field: 'accountId' } } as const;
}

function optionalAccount(source: 'query' | 'body') {
  return {
    kind: 'optional_account',
    accountId: { source, field: 'accountId' },
    whenAbsent: 'workspace_global',
  } as const;
}

function messagePath() {
  return { kind: 'message_lookup', messageId: { source: 'path', field: 'messageId' } } as const;
}

function messageBody(field: string) {
  return { kind: 'message_lookup', messageId: { source: 'body', field } } as const;
}

function optionalMessageBody(options: { allowNull?: boolean } = {}) {
  return {
    kind: 'optional_message_lookup',
    messageId: { source: 'body', field: 'messageId' },
    whenAbsent: 'non_mail',
    ...(options.allowNull ? { whenNull: 'non_mail' as const } : {}),
  } as const;
}

function attachmentPath() {
  return { kind: 'attachment_lookup', attachmentId: { source: 'path', field: 'attachmentId' } } as const;
}

function bulkBody() {
  return { kind: 'bulk_message_lookup', messageIds: { source: 'body', field: 'messageIds' } } as const;
}

function bulkQuery() {
  return { kind: 'bulk_message_lookup', messageIds: { source: 'query', field: 'messageIds' } } as const;
}

function syntheticRoute(method: CanonicalApiRoute['method'], path: string): CanonicalApiRoute {
  return {
    source: 'synthetic',
    method,
    path,
    pattern: /^\/api\/v1\/email\/synthetic$/,
  };
}

function expectRegistrationInventory(
  source: string,
  registrations: readonly Readonly<{ registration: CanonicalApiRouteRegistration }>[],
): void {
  const inventory = SERVER_MAIL_ROUTE_INVENTORY.filter((route) => route.source === source);
  const expected = registrations.flatMap(({ registration }) => registration.methods.map((method) => ({
    method,
    path: registration.path,
    pattern: registration.pattern,
  })));

  expect(inventory.map(({ method, path, pattern }) => ({ method, path, pattern }))).toEqual(expected);
  for (const route of inventory) {
    const registration = registrations.find(({ registration: candidate }) => (
      candidate.path === route.path && candidate.methods.includes(route.method)
    ));
    expect(registration?.registration.pattern).toBe(route.pattern);
  }
}
