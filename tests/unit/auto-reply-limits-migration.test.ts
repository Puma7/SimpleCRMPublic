import { autoReplyLimitsMigration } from '../../packages/server/src/migrations/0029_auto_reply_limits';

describe('server auto-reply limit migration', () => {
  test('creates workspace-isolated dedup and daily counter tables', () => {
    const sql = autoReplyLimitsMigration.upSql.join('\n');

    expect(sql).toContain('PRIMARY KEY (workspace_id, source_message_id)');
    expect(sql).toContain('PRIMARY KEY (workspace_id, account_id, recipient, reply_day)');
    expect(sql).toContain('CHECK (reply_count >= 0)');
    expect(sql).toContain('email_auto_reply_reservations_workspace_isolation');
    expect(sql).toContain('email_auto_reply_daily_counters_workspace_isolation');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
  });
});
