import { pr156FollowupHardeningMigration } from '../../packages/server/src/migrations/0033_pr156_followup_hardening';
import { pr156FinalAuditMigration } from '../../packages/server/src/migrations/0034_pr156_final_audit';
import { emailTrackingPerMessageMigration } from '../../packages/server/src/migrations/0035_email_tracking_per_message';
import { serverMigrations } from '../../packages/server/src/migrations';

describe('PR 156 follow-up hardening migration', () => {
  test('keeps the follow-up, final-audit, and per-message migrations in order', () => {
    const hardeningIndex = serverMigrations.indexOf(pr156FollowupHardeningMigration);
    const finalAuditIndex = serverMigrations.indexOf(pr156FinalAuditMigration);
    const perMessageIndex = serverMigrations.indexOf(emailTrackingPerMessageMigration);
    expect(hardeningIndex).toBeGreaterThanOrEqual(0);
    // 0034 runs immediately after 0033; 0035 follows 0034.
    expect(finalAuditIndex).toBe(hardeningIndex + 1);
    expect(perMessageIndex).toBeGreaterThan(finalAuditIndex);
  });

  test('workspace-scopes MFA codes and forces RLS', () => {
    const sql = pr156FollowupHardeningMigration.upSql.join('\n');
    expect(sql).toContain('auth_mfa_email_codes');
    expect(sql).toMatch(/ADD COLUMN workspace_id uuid/i);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(sql).toContain('app.can_access_workspace(workspace_id)');
  });

  test('backfill establishes a system RLS context before reading users', () => {
    const upSql = pr156FollowupHardeningMigration.upSql;
    const contextIndex = upSql.findIndex((statement) =>
      statement.includes("set_config('app.cross_workspace_access', 'on', true)")
      && statement.includes("set_config('app.role', 'system', true)"));
    const backfillIndex = upSql.findIndex((statement) => statement.includes('FROM users'));
    expect(contextIndex).toBeGreaterThanOrEqual(0);
    expect(backfillIndex).toBeGreaterThan(contextIndex);
  });

  test('tracks MFA email delivery before codes become verifiable', () => {
    const sql = pr156FinalAuditMigration.upSql.join('\n');
    expect(sql).toMatch(/auth_mfa_email_codes[\s\S]*delivery_status/i);
    expect(sql).toMatch(/CHECK \(delivery_status IN \('pending', 'sent', 'failed', 'superseded'\)\)/i);
  });
});
