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
});
