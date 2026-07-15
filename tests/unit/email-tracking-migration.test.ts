import { emailEvidenceTrackingMigration } from '../../packages/server/src/migrations/0027_email_evidence_tracking';
import { emailEvidenceClassificationV2Migration } from '../../packages/server/src/migrations/0030_email_evidence_classification_v2';
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

  test('adds the V2 versioned classification projection without changing raw events', () => {
    const sql = emailEvidenceClassificationV2Migration.upSql.join('\n');

    expect(serverMigrations).toContain(emailEvidenceClassificationV2Migration);
    expect(sql).toContain('ALTER TABLE email_tracking_policies ADD COLUMN IF NOT EXISTS ip_insights_enabled boolean NOT NULL DEFAULT false');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_tracking_event_classifications');
    expect(sql).toContain('event_id bigint NOT NULL REFERENCES email_tracking_events(id) ON DELETE CASCADE');
    expect(sql).toContain('classification_version integer NOT NULL CHECK (classification_version = 2)');
    expect(sql).toContain("CHECK (actor_class IN ('system', 'probable_human', 'mail_proxy', 'privacy_proxy', 'security_scanner', 'automated_unknown', 'unknown'))");
    expect(sql).toContain("CHECK (confidence IN ('none', 'low', 'medium', 'high', 'verified'))");
    expect(sql).toContain("reasons_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reasons_json) = 'array')");
    expect(sql).toContain('PRIMARY KEY (event_id, classification_version)');
    expect(sql).toContain('ALTER TABLE email_tracking_event_classifications ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE email_tracking_event_classifications FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY email_tracking_event_classifications_workspace_isolation');
    expect(sql).toContain('INSERT INTO email_tracking_event_classifications');
    expect(sql).toContain("WHEN event_type IN ('queued', 'sending', 'smtp_accepted', 'smtp_failed', 'delayed', 'bounced', 'dsn_delivered', 'mdn_displayed', 'replied', 'revoked', 'expired') THEN 'system'");
    expect(sql).toContain("WHEN event_type IN ('open_automated', 'click_automated') THEN 'automated_unknown'");
    expect(sql).toContain("WHEN event_type IN ('open_probable', 'click') THEN 'unknown'");
    expect(sql).not.toMatch(/UPDATE\s+email_tracking_events/i);
  });
});
