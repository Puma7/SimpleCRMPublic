import { emailEvidenceTrackingMigration } from '../../packages/server/src/migrations/0027_email_evidence_tracking';
import { serverMigrations } from '../../packages/server/src/migrations';

describe('email evidence tracking migration', () => {
  test('is registered in the migration sequence', () => {
    expect(serverMigrations).toContain(emailEvidenceTrackingMigration);
  });

  test('keeps public token resolution opaque and all evidence data workspace isolated', () => {
    const sql = emailEvidenceTrackingMigration.upSql.join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_tracking_policies');
    expect(sql).toContain('enabled boolean NOT NULL DEFAULT false');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_tracking_messages');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_tracking_links');
    expect(sql).toContain('target_ciphertext bytea NOT NULL');
    expect(sql).not.toMatch(/target_url\s+text/i);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_tracking_events');
    expect(sql).toContain('raw_metadata_ciphertext bytea');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_tracking_token_resolver');
    expect(sql).toContain('token_hash text PRIMARY KEY');
    expect(sql).toContain('CREATE POLICY email_tracking_token_resolver_public_lookup');
    expect(sql).toContain("token_hash = nullif(current_setting('app.email_tracking_token_hash', true), '')");

    for (const table of [
      'email_tracking_policies',
      'email_tracking_messages',
      'email_tracking_links',
      'email_tracking_events',
      'email_tracking_token_resolver',
    ]) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY ${table}_workspace_isolation`);
    }
  });

  test('adds bounded lookup, retention, correlation and event-dedupe indexes', () => {
    const sql = emailEvidenceTrackingMigration.upSql.join('\n');

    expect(sql).toContain('email_tracking_token_resolver_expiry_idx');
    expect(sql).toContain('email_tracking_token_resolver_workspace_kind_revoked_idx');
    expect(sql).toContain('email_tracking_token_resolver_tracking_message_idx');
    expect(sql).toContain('email_tracking_events_retention_idx');
    expect(sql).toContain('email_tracking_events_message_time_idx');
    expect(sql).toContain('email_tracking_messages_message_id_idx');
    expect(sql).toContain('email_tracking_events_message_id_idx');
    expect(sql).toContain('UNIQUE (workspace_id, dedupe_key)');
    expect(sql).toContain('UNIQUE (workspace_id, message_id)');
    expect(sql).toContain('recipient_count integer NOT NULL');
  });
});
