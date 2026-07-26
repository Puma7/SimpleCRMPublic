import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('codex review regression guards', () => {
  test('inbound chain continues after ordinary errors and only spam stops the chain', () => {
    const source = readRepoFile('packages/server/src/workflow-execution.ts');
    expect(source).toMatch(/result\.status === 'ok' \|\| result\.status === 'error'/);
    expect(source).toContain('inboundChainStop: result.inboundChainStop === true && result.deferred !== true');
    expect(source).toContain('inboundChainStop: true');
    // Ordinary logic.stop must not set inboundChainStop — only spam short-circuits do.
    const logicStopBlock = source.match(
      /if \(type === 'logic\.stop' \|\| type === 'stop'\) \{\s*return \{[^}]+\}/,
    )?.[0] ?? '';
    expect(logicStopBlock).toContain('stop: true');
    expect(logicStopBlock).not.toContain('inboundChainStop');
    // stopFurtherWorkflows:false must not be defeated by a spam re-bail on enqueue.
    expect(source).toContain('Do not re-bail on spam/review here');
  });

  test('draft reply uses Reply-To, account signature, greeting, canned, sources', () => {
    const source = readRepoFile('packages/server/src/workflow-ai-draft-nodes.ts');
    expect(source).toContain('raw_headers');
    expect(source).toContain('Reply-To');
    expect(source).toContain('resolveAccountSignatureText');
    expect(source).toContain('email_account_signatures');
    expect(source).toContain('includeCanned');
    expect(source).toContain('buildReplyGreeting');
    expect(source).toContain('ai.draft.sources');
    expect(source).toContain('userPublicName');
  });

  test('approval reason is redacted and draft edits clear approval', () => {
    const source = readRepoFile('packages/server/src/db/postgres-mail-read-ports.ts');
    expect(source).toContain('approvalReason: row.content_readable === false ? null');
    expect(source).toContain('approval_state: null');
    expect(source).toContain('auto_submitted: 0');
  });

  test('outbound dry-run block is fail-closed and import maps approval fields', () => {
    const execution = readRepoFile('packages/server/src/workflow-execution.ts');
    const desktop = readRepoFile('electron/workflow/nodes/ai-nodes.ts');
    const runtime = readRepoFile('electron/workflow/runtime.ts');
    const importSql = readRepoFile('packages/server/src/db/postgres-core-mail-import.ts');
    expect(execution).toMatch(/port: 'block'[\s\S]*?blocked: true/);
    expect(desktop).toMatch(/port: 'block'[\s\S]*?blocked: true/);
    // Port edges must still run when blocked is set for explicit block/error ports.
    expect(runtime).toContain("blockPort === 'block' || blockPort === 'error'");
    expect(execution).toContain("blockPort === 'block' || blockPort === 'error'");
    expect(importSql).toContain('approval_state');
    expect(importSql).toContain('approval_reason');
    expect(importSql).toContain('auto_submitted');
  });

  test('server approval UI is reachable and terminal child failures advance the chain', () => {
    const viewer = readRepoFile('src/components/email/message-viewer.tsx');
    const list = readRepoFile('src/components/email/message-list.tsx');
    const advance = readRepoFile('packages/server/src/workflow-inbound-chain-advance.ts');
    const queue = readRepoFile('packages/server/src/db/postgres-job-queue-port.ts');
    expect(viewer).toContain('approval_state === "pending"');
    expect(viewer).not.toMatch(
      /!serverClientMode &&\s*selectedMessage != null &&\s*selectedMessage\.uid < 0 &&\s*selectedMessage\.approval_state === "pending"/,
    );
    expect(list).toContain('m.approval_state === "pending"');
    expect(list).not.toContain('!serverClientMode && m.approval_state');
    expect(advance).toContain('enqueueNextInboundWorkflowAfterTerminalChildFailure');
    expect(queue).toContain('enqueueNextInboundWorkflowAfterTerminalChildFailure');
  });

  test('codex round-3: release on hold/block path is rejected and AI draft jobs are async', () => {
    const validate = readRepoFile('packages/core/src/workflow/graph-validate.ts');
    const sharedValidate = readRepoFile('shared/email-workflow-graph-validate.ts');
    const execution = readRepoFile('packages/server/src/workflow-execution.ts');
    const templates = readRepoFile('packages/core/src/workflow/templates.ts');
    const aiClass = readRepoFile('packages/server/src/ai-classification.ts');
    const desktopEngine = readRepoFile('electron/email/email-workflow-engine.ts');
    const emailNodes = readRepoFile('electron/workflow/nodes/email-nodes.ts');
    const approval = readRepoFile('packages/server/src/draft-approval-actions.ts');
    const policy = readRepoFile('packages/server/src/mail-access/async-policy-enforcer.ts');
    const jobPolicy = readRepoFile('packages/server/src/jobs/policy.ts');
    const draftNodes = readRepoFile('packages/server/src/workflow-ai-draft-nodes.ts');
    const mailPorts = readRepoFile('packages/server/src/db/postgres-mail-read-ports.ts');
    const desktopStore = readRepoFile('electron/email/email-store.ts');

    expect(validate).toContain('if (holdPath) add({ code: \'dead_end\', nodeId });');
    expect(sharedValidate).toContain('if (holdPath) add({ code: \'dead_end\', nodeId });');
    expect(templates).toContain('logic.stop_after_spam');
    expect(templates).not.toMatch(/agent-retoure[\s\S]*?field: 'is_spam'/);
    expect(aiClass).toMatch(/try \{[\s\S]*?if \(!context\) throw new Error\('Prompt nicht gefunden'\)/);
    expect(desktopEngine).toContain('if (r.inboundChainStop)');
    expect(desktopEngine).not.toContain('afterWorkflowRow.is_spam === 1');
    expect(emailNodes).toContain('inboundChainStop: true');
    expect(execution).toContain("log: ['skip:workflow_disabled']");
    expect(execution).toMatch(/skip:workflow_disabled[\s\S]*?maybeEnqueueNextInboundWorkflow/);
    expect(execution).toContain("type: 'ai.draft_reply'");
    expect(execution).toContain('scheduleAiDraftReplyJob');
    expect(execution).toContain('scheduleAiReviewDraftJob');
    expect(execution).toContain('queued_ai_draft_reply');
    expect(draftNodes).toContain('createPostgresAiDraftReplyPort');
    expect(draftNodes).toContain('createPostgresAiReviewDraftPort');
    expect(jobPolicy).toContain("'ai.draft_reply'");
    expect(jobPolicy).toContain("'ai.review_draft'");
    expect(approval).toContain('scheduled_send_at');
    expect(approval).toContain('Entwurf ist bereits zum Versand eingeplant');
    expect(policy).toContain("workflowGraphHasNodeType(loaded.graph, 'ai.draft_reply')");
    expect(mailPorts).toContain('draftAttachmentPaths !== undefined');
    expect(desktopStore).toContain('draftAttachmentPaths !== undefined');
  });

  test('codex round-4: snapshot guard, chain, ACL, approval sanitize, reply context', () => {
    const draftNodes = readRepoFile('packages/server/src/workflow-ai-draft-nodes.ts');
    const execution = readRepoFile('packages/server/src/workflow-execution.ts');
    const catalog = readRepoFile('packages/core/src/workflow/node-catalog.ts');
    const emailNodes = readRepoFile('electron/workflow/nodes/email-nodes.ts');
    const aiNodes = readRepoFile('electron/workflow/nodes/ai-nodes.ts');
    const policy = readRepoFile('packages/server/src/mail-access/async-policy-enforcer.ts');
    const sanitize = readRepoFile('packages/server/src/api/mail-routes.ts');

    expect(draftNodes).toContain('outboundDraftFingerprint');
    expect(draftNodes).toContain('reviewedFingerprint');
    expect(draftNodes).toContain('Entwurf wurde nach der KI-Prüfung geändert');
    expect(execution).toMatch(/skip:workflow_already_applied[\s\S]*?maybeEnqueueNextInboundWorkflow/);
    expect(catalog).toContain('stopFurtherWorkflows: true');
    expect(emailNodes).toContain('stopFurtherWorkflows: true');
    expect(aiNodes).toContain('getEmailMessageById(ctx.messageId)');
    expect(aiNodes).toContain("ctx.variables['email.is_spam'] === true");
    expect(policy).toContain("job.type === 'ai.draft_reply'");
    expect(policy).toContain('assertAiReviewDraftAccess');
    expect(execution).toContain('buildOutboundReviewUserTemplate');
    expect(execution).toContain('Antwort-Kontext');
    expect(execution).toContain('reply_parent_message_id');
    expect(execution).toContain('payload.draftId');
    expect(sanitize).toContain('approvalState: message.approvalState ?? null');
    expect(sanitize).toContain('approvalReason: message.approvalReason ?? null');
  });

  test('codex round-5: desktop chain-stop, fingerprint recipients, spam-guard, ACL parent, graphile advance', () => {
    const runtime = readRepoFile('electron/workflow/runtime.ts');
    const aiNodes = readRepoFile('electron/workflow/nodes/ai-nodes.ts');
    const draftNodes = readRepoFile('packages/server/src/workflow-ai-draft-nodes.ts');
    const execution = readRepoFile('packages/server/src/workflow-execution.ts');
    const chainCtx = readRepoFile('packages/server/src/workflow-inbound-chain-context.ts');
    const policy = readRepoFile('packages/server/src/mail-access/async-policy-enforcer.ts');
    const aiClass = readRepoFile('packages/server/src/ai-classification.ts');
    const handlers = readRepoFile('packages/server/src/jobs/production-handlers.ts');
    const graphile = readRepoFile('packages/server/src/jobs/graphile-worker.ts');

    expect(runtime).toContain('if (r.inboundChainStop)');
    expect(runtime).toContain('if (r.deferred)');
    expect(draftNodes).toContain('fingerprintReviewedDraft');
    expect(draftNodes).toContain('to_json');
    expect(draftNodes).toContain('draft_attachment_paths_json');
    expect(aiNodes).toContain('recipientFieldFromJson(draft.to_json)');
    expect(aiNodes).toContain('parseDraftAttachmentPathsJson');
    expect(execution).toContain('re-stamp skipIfMessageSpamOrReview');
    expect(execution).toContain('one-shot for the initial');
    expect(chainCtx).toContain('Do not re-stamp skipIfMessageSpamOrReview');
    expect(execution).toMatch(/error:workflow_not_found[\s\S]*?maybeEnqueueNextInboundWorkflow/);
    expect(execution).toContain('replyParentMessageId');
    expect(execution).toContain('workflowOutboundReviewUserTemplate()');
    expect(policy).toContain('assertAiReviewReplyParentAccess');
    expect(aiClass).toContain('replyParentMessageId');
    expect(aiClass).toContain('loadReplyParentContextBlock');
    expect(handlers).toContain("optionalPositiveInteger(payload, 'replyParentMessageId')");
    expect(graphile).toContain('maybeAdvanceInboundChainAfterGraphileTerminalFailure');
    expect(graphile).toContain('attempts >= maxAttempts');
    expect(graphile).toContain('buildTrustedServiceJobPayload');
    expect(graphile).toContain("helpers.addJob('workflow.execute'");
  });

  test('codex round-6: chain parse, draft skip continuation, stop_after_spam, fingerprint paths, approve triage', () => {
    const execution = readRepoFile('packages/server/src/workflow-execution.ts');
    const draftNodes = readRepoFile('packages/server/src/workflow-ai-draft-nodes.ts');
    const logic = readRepoFile('electron/workflow/nodes/logic-nodes.ts');
    const engine = readRepoFile('electron/email/email-workflow-engine.ts');
    const httpPolicy = readRepoFile('packages/server/src/mail-access/http-policy-enforcer.ts');

    expect(execution).toContain('parseInboundWorkflowChain(input.jobContext.inboundWorkflowChain)');
    expect(execution).not.toContain('parseInboundWorkflowChain(input.jobContext);');
    expect(draftNodes).toContain("'ai.draft.status': 'skipped'");
    expect(draftNodes).toContain("skip_reason': 'message_spam_or_review'");
    expect(draftNodes).toContain("'path' in item");
    expect(logic).toContain('inboundChainStop: true');
    expect(logic).toContain('getEmailMessageById(ctx.messageId)');
    expect(logic).toContain("typeof ctx.messageId === 'number'");
    expect(engine).toContain('const currentRow = getEmailMessageById(messageId) ?? freshRow');
    expect(httpPolicy).toContain("canonicalPath === '/api/v1/email/messages/:messageId/approve-draft-send'");
    expect(httpPolicy).toContain('resolveScheduledDraftReplyParent');
    expect(httpPolicy).toContain('approve-draft-send clears pending approval and arms scheduled send');
  });

  test('codex round-7: sibling deferred, SEND not via HOLD, HOLD disarms schedule, draft idempotent+spam recheck', () => {
    const runtime = readRepoFile('electron/workflow/runtime.ts');
    const execution = readRepoFile('packages/server/src/workflow-execution.ts');
    const draftNodes = readRepoFile('packages/server/src/workflow-ai-draft-nodes.ts');

    expect(runtime).toContain('Deferred (delay / async AI) must NOT abort sibling trigger branches');
    expect(runtime).toContain('merged.deferred === true || r.deferred === true');
    expect(execution).toContain('Keep walking sibling trigger branches after a deferred');
    expect(execution).toContain('Success-path resume only');
    expect(execution).toContain('const successResumeNodeId = portResumeTargets.send');
    expect(draftNodes).toContain('scheduled_send_at: null');
    expect(draftNodes).toContain('holdOnlyAnchor');
    expect(draftNodes).toContain('aiDraftReplyDedupeKey');
    expect(draftNodes).toContain('workflow_ai_draft_reply:');
    expect(draftNodes).toContain('Re-check live spam/review after the external AI call');
  });

  test('codex round-8: desktop HOLD disarms schedule and draft_reply rechecks spam after AI', () => {
    const approval = readRepoFile('electron/email/email-draft-approval.ts');
    const desktopAi = readRepoFile('electron/workflow/nodes/ai-nodes.ts');
    const execution = readRepoFile('packages/server/src/workflow-execution.ts');
    const draftNodes = readRepoFile('packages/server/src/workflow-ai-draft-nodes.ts');
    const handlers = readRepoFile('packages/server/src/jobs/production-handlers.ts');

    expect(approval).toContain('scheduled_send_at = NULL');
    expect(desktopAi).toContain('Re-check live spam/review after the external AI call');
    expect(desktopAi).toContain('const postAiSpamSkip = skipInboundIfSpamOrReview(ctx)');
    // Preserve accumulated sibling error across trigger branches.
    expect(execution).toContain("result.status === 'error' || branch.status === 'error' ? 'error'");
    // Terminal SEND without resume still advances the inbound chain.
    expect(draftNodes).toContain('Terminal SEND without a success edge');
    expect(draftNodes).toContain('enqueueNextInboundWorkflowAfterTerminalChildFailure');
    // Dedupe key is run-scoped so backfill/reapply can mint a new draft.
    expect(draftNodes).toContain(':run:');
    expect(execution).toContain('runId: context.runId');
    expect(handlers).toContain("optionalPositiveInteger(payload, 'runId')");
  });

  test('codex round-9: chain hop claim, approve requires To, draft_reply context caps', () => {
    const execution = readRepoFile('packages/server/src/workflow-execution.ts');
    const advance = readRepoFile('packages/server/src/workflow-inbound-chain-advance.ts');
    const approval = readRepoFile('packages/server/src/draft-approval-actions.ts');
    const draftNodes = readRepoFile('packages/server/src/workflow-ai-draft-nodes.ts');
    const graphile = readRepoFile('packages/server/src/jobs/graphile-worker.ts');
    const desktopAi = readRepoFile('electron/workflow/nodes/ai-nodes.ts');

    // Sibling deferred / already_applied hops share one sync_info claim.
    expect(advance).toContain('inboundChainHopClaimKey');
    expect(advance).toContain('tryClaimInboundChainHop');
    expect(advance).toContain("onConflict((oc) => oc.columns(['workspace_id', 'key']).doNothing())");
    expect(execution).toContain('tryClaimInboundChainHop');
    expect(execution).toMatch(/skip:workflow_already_applied[\s\S]*?maybeEnqueueNextInboundWorkflow/);
    expect(graphile).toContain('inboundChainHopClaimKey');
    expect(graphile).toContain('ON CONFLICT (workspace_id, key) DO NOTHING');

    // Empty To must fail before clearing pending approval.
    expect(approval).toContain("if (!to.trim())");
    expect(approval).toContain('Empfänger fehlt — Freigabe bleibt bestehen.');
    expect(approval).toMatch(
      /if \(!to\.trim\(\)\) \{\s*return \{ success: false, error: 'Empfänger fehlt[\s\S]*?persistManualOutboundApproval\(/,
    );

    // Cap mail + knowledge like agent/classify (12k).
    expect(draftNodes).toContain('DRAFT_REPLY_BODY_MAX = 12_000');
    expect(draftNodes).toContain('DRAFT_REPLY_KNOWLEDGE_MAX = 12_000');
    expect(draftNodes).toContain('.slice(0, DRAFT_REPLY_BODY_MAX)');
    expect(draftNodes).toContain('.slice(0, DRAFT_REPLY_KNOWLEDGE_MAX)');
    expect(desktopAi).toContain('DRAFT_REPLY_BODY_MAX = 12_000');
    expect(desktopAi).toContain('.slice(0, DRAFT_REPLY_KNOWLEDGE_MAX)');
  });
});
