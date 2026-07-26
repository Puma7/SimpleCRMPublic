import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('server draft approval actions', () => {
  test('draft-approval-actions stamps schedule, auto_submitted marker and clears approval', () => {
    const source = readRepoFile('packages/server/src/draft-approval-actions.ts');
    expect(source).toContain('persistManualOutboundApproval');
    expect(source).toContain('scheduled_send_at: now');
    expect(source).toContain('auto_submitted: 1');
    expect(source).toContain('autoSubmittedDraftKey');
    expect(source).toContain('markServerAutoReplySentUnconditionally');
    expect(source).toContain('clearDraftApproval');
  });

  test('dismiss clears approval and RFC-3834 marker', () => {
    const source = readRepoFile('packages/server/src/draft-approval-actions.ts');
    expect(source).toContain('auto_submitted: 0');
    expect(source).toContain("deleteFrom('sync_info')");
  });

  test('inbox queries include approval_state pending drafts', () => {
    const mailPorts = readRepoFile('packages/server/src/db/postgres-mail-read-ports.ts');
    const metadataPorts = readRepoFile('packages/server/src/db/postgres-mail-metadata-read-ports.ts');
    const inboxPredicate = "approval_state = 'pending'";
    expect(mailPorts).toContain(inboxPredicate);
    expect(metadataPorts).toContain(inboxPredicate);
  });

  test('HTTP routes and transport map approve/dismiss channels', () => {
    const routes = readRepoFile('packages/server/src/api/mail-routes.ts');
    const transport = readRepoFile('src/services/transport/channel-http-registry.ts');
    expect(routes).toContain('/approve-draft-send');
    expect(routes).toContain('/dismiss-draft-approval');
    expect(transport).toContain('approve-draft-send');
    expect(transport).toContain('dismiss-draft-approval');
  });
});
