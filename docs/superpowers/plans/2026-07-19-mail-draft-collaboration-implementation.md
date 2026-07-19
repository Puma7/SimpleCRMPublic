# Mail Draft Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entwuerfe mit Nutzern oder Gruppen teilen, exklusiv bearbeiten, versionieren und kommentieren koennen, ohne eine formale Freigabe- oder Live-Collaboration-Schicht einzufuehren.

**Architecture:** Draft-Zugriff wird ueber die zentrale Mail-ACL erteilt. Bestehende Conversation Locks sichern genau einen Editor; jede Speicherung verwendet eine erwartete Revisionsnummer. Revisionen, flache Kommentare und Feedback-Anfragen liegen verschluesselt im Content Store und senden nur nicht-sensitive In-App-Events.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React, existing conversation locks, Jest, Playwright.

## Global Constraints

- Teilen verleiht nie `mail.send`, `mail.send_as`, `mail.delete` oder Kontoadministration.
- Kein gleichzeitiges Live-Editing, keine CRDT/OT und keine Inline-Kommentaranker.
- Feedback ist informell und blockiert das Senden nicht.
- Speichern ohne gueltigen Lock oder mit veralteter Revision wird abgelehnt; kein Last-Write-Wins.
- Revisionen standardmaessig 180 Tage, konfigurierbar zwischen 30 und 3650 Tagen.
- Der finale Sendesnapshot bleibt mit der gesendeten Nachricht erhalten.

---

## File Map

- Create: `packages/core/src/email/draft-collaboration.ts`
- Modify: `packages/core/src/email/index.ts`
- Create: `packages/server/src/migrations/0042_mail_draft_collaboration.ts`
- Modify: `packages/server/src/migrations/index.ts`
- Modify: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/mail-collaboration/types.ts`
- Create: `packages/server/src/mail-collaboration/postgres-mail-collaboration-port.ts`
- Create: `packages/server/src/mail-collaboration/service.ts`
- Create: `packages/server/src/api/mail-collaboration-routes.ts`
- Modify: `packages/server/src/locks/conversation-locks.ts`
- Modify: `packages/server/src/db/postgres-lock-port.ts`
- Modify: `packages/server/src/api/lock-routes.ts`
- Modify: `packages/server/src/mail-compose-send.ts`
- Modify: `packages/server/src/db/postgres-event-port.ts`
- Modify: `packages/server/src/api/openapi.ts`
- Modify: `src/services/transport/channel-http-registry.ts`
- Modify: `src/components/email/compose-dialog.tsx`
- Create: `src/components/email/draft-sharing-dialog.tsx`
- Create: `src/components/email/draft-comments-panel.tsx`
- Create: `src/components/email/draft-history-dialog.tsx`
- Create: `tests/unit/mail-draft-collaboration.test.ts`
- Create: `tests/integration/server-mail-draft-collaboration.test.ts`
- Create: `tests/integration/server-mail-draft-revision-conflict.test.ts`
- Create: `tests/e2e/email-draft-collaboration.spec.ts`

## Stable Interfaces

```ts
export interface SaveSharedDraftInput {
  draftMessageId: string;
  expectedRevision: number;
  lockToken: string;
  content: DraftContentInput;
}

export interface DraftRevisionSummary {
  revision: number;
  authorUserId: string;
  createdAt: string;
  changeKind: 'created' | 'edited' | 'restored' | 'sent_snapshot';
}
```

```ts
export type DraftCommentStatus = 'open' | 'resolved';
export type FeedbackRequestStatus = 'open' | 'acknowledged' | 'closed';
```

## Task 1: Collaboration domain rules

- [ ] Add unit tests for revision increments, allowed comment transitions, feedback transitions, retention bounds and non-transfer of send permissions.
- [ ] Run focused tests; expect missing module failures.
- [ ] Implement pure validators and shared schemas in `draft-collaboration.ts`.
- [ ] Reject empty comments, oversized comments, unknown statuses and client-supplied author/timestamp fields.
- [ ] Re-run; expect PASS.
- [ ] Commit: `feat(mail): define draft collaboration contracts`.

## Task 2: Persistence and encrypted content refs

- [ ] Add integration tests for `mail_draft_revisions`, `mail_comments`, `mail_feedback_requests`, workspace isolation and cascade/tombstone behavior.
- [ ] Create `0042_mail_draft_collaboration.ts`; store body/subject snapshot and comment text only as encrypted content-object refs.
- [ ] Add uniqueness `(draft_message_id, revision)` and indexes for open comments, feedback recipients and retention cleanup.
- [ ] Migrate existing internal draft notes as `legacy` comments while preserving author/time where known.
- [ ] Register migration/schema and run tests; expect PASS.
- [ ] Commit: `feat(server): persist encrypted draft collaboration`.

## Task 3: Lock-bound optimistic saves

- [ ] Add `server-mail-draft-revision-conflict.test.ts` for two editors, expired lock, stolen token, stale revision, reconnect and process restart.
- [ ] Assert one concurrent save succeeds and one receives `409 draft_revision_conflict` with current revision metadata but no leaked content.
- [ ] Extend conversation lock resource identity to shared drafts without changing unrelated customer/task locks.
- [ ] In one database transaction, verify lock ownership, compare `expectedRevision`, write encrypted draft content, append revision and increment draft revision.
- [ ] Do not auto-merge stale content; expose an explicit reload/restore choice to the client.
- [ ] Run conflict tests repeatedly; expect PASS.
- [ ] Commit: `fix(server): prevent shared draft lost updates`.

## Task 4: Sharing through Mail ACL

- [ ] Add tests for user/group sharing with `mail.content.read`, `mail.comment` and `mail.draft.edit` combinations.
- [ ] Assert edit sharing does not grant `mail.send`; source account send policy remains independently evaluated.
- [ ] Implement sharing routes by creating scoped message bindings through the central ACL service; do not introduce a second share table for authorization.
- [ ] Require current actor `mail.draft.edit` plus `mail.delegation.manage` or account-management policy to alter sharing.
- [ ] Revoke active draft lock when edit permission is removed and notify the affected user with an ID-only event.
- [ ] Run access tests; expect PASS.
- [ ] Commit: `feat(server): share drafts through mailbox acl`.

## Task 5: Revisions and restore

- [ ] Add tests for initial revision, edit revision, restore-as-new-revision, unchanged save suppression and final sent snapshot.
- [ ] Implement summary list and authorized revision read; decrypt only the requested revision after `mail.content.read`.
- [ ] Restore by writing a new head revision with `changeKind=restored`; never rewrite history.
- [ ] During SMTP commit preparation, persist `sent_snapshot` in the same logical send commit so retries cannot create divergent history.
- [ ] Add cleanup job retaining sent snapshots and deleting expired non-final revisions reference-safely.
- [ ] Run tests; expect PASS.
- [ ] Commit: `feat(server): version and restore shared drafts`.

## Task 6: Comments and feedback requests

- [ ] Add tests for create/resolve/reopen comment, author/admin edit policy, feedback recipient visibility and no send blocking.
- [ ] Implement flat draft-level comments; no HTML input, mentions or external notification payloads.
- [ ] Implement feedback request as recipient/status/dueAt optional metadata and an in-app event; acknowledgement is informational.
- [ ] Authorize comment body with both draft content visibility and `mail.comment`; event includes comment ID/status only.
- [ ] Ensure send route ignores open feedback for authorization and records their count only in internal history.
- [ ] Run tests; expect PASS.
- [ ] Commit: `feat(server): add lightweight draft feedback`.

## Task 7: Collaboration UI

- [ ] Add Playwright scenarios for share, view-only, comment-only, edit lock, stale save conflict, revision restore and feedback acknowledgement.
- [ ] Add sharing dialog with user/group selector and compact permission toggles.
- [ ] Add comments panel and history dialog beside the compose surface; keep compose fields primary and avoid nested cards.
- [ ] On lock loss or `409`, stop autosave, retain unsaved local text in memory, show compare/reload actions and never silently retry over the new revision.
- [ ] Revoke local decrypted revision/comment data when access is removed or dialog closes.
- [ ] Run UI/E2E tests; expect PASS.
- [ ] Commit: `feat(email): add shared draft collaboration ui`.

## Task 8: Final verification

- [ ] Property-test revision monotonicity and comment transitions under randomized concurrent calls.
- [ ] Verify event reconnect refetches authoritative revision/comment status and never duplicates displayed comments.
- [ ] Verify encrypted content scanner covers revisions/comments and logs contain neither.
- [ ] Run `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, `pnpm run test:mail:coverage`, and `pnpm run build`.
- [ ] Commit: `test(email): verify shared draft consistency`.

## No-Regression Checklist

- [ ] Existing personal drafts continue to save without an explicit share binding but still use revision checks.
- [ ] Send recovery remains idempotent when crash occurs after SMTP acceptance.
- [ ] Removing a user/group does not delete revision authorship history.
- [ ] Comment permissions cannot reveal recipients, body or attachment names without corresponding read rights.
- [ ] Retention cleanup preserves content referenced by sent messages or legal/export holds.
- [ ] Feedback requests never become a hidden approval requirement.
