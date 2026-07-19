# Mailbox ACL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeden serverseitigen Zugriff auf Mailkonten, Ordner, Nachrichten und Anhaenge zentral autorisieren und Delegation ueber Profile plus Einzelrechte administrierbar machen.

**Architecture:** Ein Policy-Manifest ordnet jede Mailroute, jeden Job und jeden Eventtyp genau einer Permission zu. `MailAccessService` loest Owner/Admin-Bypass, Nutzer-/Gruppenbindungen und Konto-/Ordnervererbung auf; Read-Ports erhalten ausschliesslich daraus erzeugte SQL-Scopes.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React, Jest, Playwright.

## Global Constraints

- `default deny` fuer normale Nutzer; Owner/Admin haben dokumentierten Vollzugriff.
- Kein explizites Deny in dieser Version; Rechte sind additive Grants.
- `mail.send` erlaubt nur konfigurierte Kontoidentitaeten, `mail.send_as` alternative erlaubte Aliase.
- Account-Grants vererben auf Ordner, Folder-Grants gelten nur fuer den Ordner.
- Metadaten, Inhalt und Anhaenge bleiben getrennte Rechte.
- Bestehende `user_account_access`-Daten werden ohne Rechteverlust migriert.

---

## File Map

- Create: `packages/core/src/email/mail-permissions.ts`
- Create: `packages/server/src/migrations/0038_mail_acl.ts`
- Modify: `packages/server/src/migrations/index.ts`
- Modify: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/mail-access/types.ts`
- Create: `packages/server/src/mail-access/postgres-mail-access-port.ts`
- Create: `packages/server/src/mail-access/service.ts`
- Create: `packages/server/src/mail-access/policy-manifest.ts`
- Create: `packages/server/src/api/mail-access-routes.ts`
- Modify: `packages/server/src/api/mail-routes.ts`
- Modify: `packages/server/src/api/mail-metadata-routes.ts`
- Modify: `packages/server/src/api/events.ts`
- Modify: `packages/server/src/jobs/policy.ts`
- Modify: `packages/server/src/jobs/production-handlers.ts`
- Modify: `packages/server/src/db/postgres-mail-read-ports.ts`
- Modify: `packages/server/src/db/postgres-mail-metadata-read-ports.ts`
- Modify: `packages/server/src/db/postgres-event-port.ts`
- Modify: `packages/server/src/api/openapi.ts`
- Modify: `packages/server/src/api/types.ts`
- Modify: `src/services/transport/channel-http-registry.ts`
- Create: `src/components/settings/mail-delegation-panel.tsx`
- Modify: `src/components/email/settings-panels.tsx`
- Create: `tests/unit/mail-permissions.test.ts`
- Create: `tests/unit/server-mail-policy-manifest.test.ts`
- Create: `tests/unit/server-mail-access-service.test.ts`
- Create: `tests/integration/server-mail-access-routes.test.ts`
- Create: `tests/e2e/email-mailbox-delegation.spec.ts`

## Stable Interfaces

```ts
export const MAIL_PERMISSIONS = [
  'mail.metadata.read', 'mail.content.read', 'mail.attachment.read',
  'mail.attachment.suspicious_download', 'mail.triage', 'mail.comment',
  'mail.draft.create', 'mail.draft.edit', 'mail.send', 'mail.send_as',
  'mail.delete', 'mail.export', 'mail.account.manage',
  'mail.delegation.manage',
] as const;

export type MailPermission = (typeof MAIL_PERMISSIONS)[number];
export type MailResource =
  | { type: 'account'; accountId: string }
  | { type: 'folder'; accountId: string; folderId: string }
  | { type: 'message'; accountId: string; folderId: string; messageId: string };
```

```ts
export interface MailAccessService {
  assertPermission(input: {
    workspaceId: string;
    actor: { userId: string; isOwner: boolean; isAdmin: boolean };
    permission: MailPermission;
    resource: MailResource;
  }): Promise<void>;
  resolveScope(input: {
    workspaceId: string;
    actor: { userId: string; isOwner: boolean; isAdmin: boolean };
    permission: MailPermission;
  }): Promise<MailSqlScope>;
}
```

## Task 1: Permission vocabulary and profiles

- [ ] Add failing tests in `tests/unit/mail-permissions.test.ts` for unique keys, immutable profile expansion and the profiles `viewer`, `triage`, `editor`, `sender`, `manager`.
- [ ] Run `pnpm exec jest tests/unit/mail-permissions.test.ts --runInBand`; expect missing module/profile failures.
- [ ] Implement `packages/core/src/email/mail-permissions.ts` with the exact constants above and profile-to-permission maps; export it from `packages/core/src/email/index.ts`.
- [ ] Assert profiles never include `mail.send_as`, `mail.account.manage` or `mail.delegation.manage` unless explicitly named `manager` and documented in the test.
- [ ] Re-run the focused test; expect PASS.
- [ ] Commit: `feat(mail): define mailbox permission vocabulary`.

## Task 2: ACL schema and legacy migration

- [ ] Add migration assertions to `tests/integration/server-mail-access-routes.test.ts`: binding subjects are `user|group`, resources are `account|folder|message`, permission rows are unique, and cross-workspace references fail.
- [ ] Run the integration test; expect missing tables.
- [ ] Create `0038_mail_acl.ts` with `mail_acl_bindings(id, workspace_id, subject_type, subject_id, resource_type, account_id, folder_id, message_id, created_by, created_at, updated_at)` and `mail_acl_binding_permissions(binding_id, permission_key)`.
- [ ] Add indexes for `(workspace_id, subject_type, subject_id)`, `(workspace_id, account_id)`, `(workspace_id, folder_id)`, `(workspace_id, message_id)` and uniqueness for subject/resource tuples.
- [ ] Backfill `user_account_access`: `can_read` maps to metadata/content/attachment read; `can_send` maps to draft/create/edit/send; legacy read-only never gains send.
- [ ] Update `migrations/index.ts` and `db/schema.ts`; migration remains additive and does not drop `user_account_access`.
- [ ] Re-run integration migration tests; expect PASS.
- [ ] Commit: `feat(server): add mailbox acl schema`.

## Task 3: Resolver and SQL scope

- [ ] Add table-driven tests in `tests/unit/server-mail-access-service.test.ts` for Owner/Admin bypass, direct user grant, group grant, account inheritance, folder isolation, default deny and workspace separation.
- [ ] Add a test that `mail.content.read` does not imply `mail.attachment.read` and `mail.send` does not imply `mail.send_as`.
- [ ] Run the focused suite; expect missing service failures.
- [ ] Implement `postgres-mail-access-port.ts` with parameterized queries only; resolve active group membership and grants in one query/CTE.
- [ ] Implement `service.ts`; return a structured `MailAccessDeniedError` with code `mail_access_denied` but no resource metadata in its public message.
- [ ] Represent unrestricted Owner/Admin scope as `{ kind: 'all' }`, normal scope as account IDs plus folder/message exceptions, and no grants as `{ kind: 'none' }`.
- [ ] Re-run tests; expect PASS.
- [ ] Commit: `feat(server): resolve mailbox access centrally`.

## Task 4: Complete policy manifest

- [ ] Add `tests/unit/server-mail-policy-manifest.test.ts` that parses the registered Fastify mail routes, job names and mail event names and compares them to `policy-manifest.ts`.
- [ ] Include explicit classifications for public tracking endpoints and auth/setup endpoints so the test distinguishes intentional non-mail-principal access from omissions.
- [ ] Run the test; record every uncovered path as the initial inventory and expect FAIL.
- [ ] Create `policy-manifest.ts` mapping method/path/action to permission and resource resolver; add mappings until no registered protected mail path is unclassified.
- [ ] Extend `jobs/policy.ts` so each mail job declares actor mode, permission and resource extraction.
- [ ] Re-run; expect PASS and fail-closed behavior for a synthetic unregistered route/job.
- [ ] Commit: `test(server): require policy coverage for mail entrypoints`.

## Task 5: Enforce HTTP and query paths

- [ ] Add integration tests for direct message URL access, attachment download, search, export, mutation and account settings from unauthorized users.
- [ ] Add positive tests for folder-only grants and Owner/Admin access.
- [ ] Run the tests; expect current workspace-only checks to leak access.
- [ ] Register `MailAccessService` in server composition and call `assertPermission` before object reads/mutations in `mail-routes.ts`, `mail-metadata-routes.ts` and reporting/export routes.
- [ ] Pass `resolveScope()` into `postgres-mail-read-ports.ts` and `postgres-mail-metadata-read-ports.ts`; compose it into SQL before pagination and counts.
- [ ] Ensure lookup failures return the same public 404/denied shape where exposing existence would leak metadata.
- [ ] Re-run focused integration tests; expect PASS.
- [ ] Commit: `fix(server): enforce mailbox acl on mail routes`.

## Task 6: Enforce jobs and events

- [ ] Add tests that a queued user-triggered export loses permission before execution, and the worker refuses it on revalidation.
- [ ] Add tests that an event for an inaccessible account is neither persisted to a user feed nor emitted on its WebSocket.
- [ ] Run focused tests; expect FAIL.
- [ ] Add `actorUserId` or explicit `system` principal to protected job payloads and re-check policy immediately before reads and side effects.
- [ ] Filter `postgres-event-port.ts` and `api/events.ts` through the access scope; event payloads contain only IDs and non-sensitive state.
- [ ] Keep inbound system sync authorized only for the configured account/workspace and never use Owner/Admin bypass implicitly.
- [ ] Re-run tests; expect PASS.
- [ ] Commit: `fix(server): enforce mailbox acl for jobs and events`.

## Task 7: Delegation API and UI

- [ ] Add API tests for list/create/update/delete bindings, profile expansion, individual overrides, group subjects and the requirement `mail.delegation.manage`.
- [ ] Add a self-lockout test: an administrator can alter grants, while workspace Owner retains bypass regardless of ACL rows.
- [ ] Run tests; expect missing endpoints.
- [ ] Add `/api/v1/email/access/bindings` routes and OpenAPI schemas; accept only known permission keys and resources belonging to the workspace.
- [ ] Register transport channels and implement `mail-delegation-panel.tsx` with account/folder selector, user/group selector, profile segmented control and permission checkboxes.
- [ ] Add Playwright coverage for profile selection, an individual toggle and immediate disappearance of a revoked mailbox after event refresh.
- [ ] Run focused unit/integration/E2E tests; expect PASS.
- [ ] Commit: `feat(email): administer mailbox delegation`.

## Task 8: Shadow rollout and final gate

- [ ] Add a workspace setting `mailAclEnforcementMode: shadow|enforce`, default `shadow` only during deployment migration.
- [ ] In shadow mode, evaluate both legacy and new access and emit counters for `legacy_allow_new_deny` and `legacy_deny_new_allow` without resource identifiers.
- [ ] Add an administrative readiness endpoint that reports aggregate mismatches scoped to the workspace.
- [ ] Test switching to `enforce` and verify requests stop consulting legacy access.
- [ ] Run `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, `pnpm run test:mail:coverage`, and `pnpm run build`.
- [ ] Require zero unexplained shadow mismatches before changing the deployment default to `enforce`; retain legacy tables until one stable release later.
- [ ] Commit: `feat(server): gate mailbox acl enforcement rollout`.

## No-Regression Checklist

- [ ] Folder counts, search totals and pagination are computed after ACL scope.
- [ ] Bulk actions authorize every selected message and remain atomic on denial.
- [ ] Reply, forwarding and attachment reuse require source read permission plus target draft permission.
- [ ] Saved searches cannot reveal inaccessible counts.
- [ ] Audit records contain actor, action and resource ID but no subject/body/filename.
- [ ] Owner/Admin bypass is explicit and unit tested, never inferred from missing rows.
