import { pr156FollowupHardeningMigration } from '../../packages/server/src/migrations/0033_pr156_followup_hardening';
import { serverMigrations } from '../../packages/server/src/migrations';

describe('PR 156 follow-up hardening migration', () => {
  test('registers the migration after DMARC reports', () => {
    expect(serverMigrations.at(-1)).toBe(pr156FollowupHardeningMigration);
  });

  test('workspace-scopes MFA codes and forces RLS', () => {
    const sql = pr156FollowupHardeningMigration.upSql.join('\n');
    expect(sql).toContain('auth_mfa_email_codes');
    expect(sql).toMatch(/ADD COLUMN workspace_id uuid/i);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(sql).toContain('app.can_access_workspace(workspace_id)');
  });
});
