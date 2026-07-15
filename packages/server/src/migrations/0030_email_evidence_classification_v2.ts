import type { SqlMigration } from './types';

export const emailEvidenceClassificationV2Migration: SqlMigration = {
  id: '0030_email_evidence_classification_v2',
  description: 'Versioned classifications for append-only email evidence events.',
  upSql: [
    'ALTER TABLE email_tracking_policies ADD COLUMN IF NOT EXISTS ip_insights_enabled boolean NOT NULL DEFAULT false;',
    `CREATE TABLE IF NOT EXISTS email_tracking_event_classifications (
  event_id bigint NOT NULL REFERENCES email_tracking_events(id) ON DELETE CASCADE,
  classification_version integer NOT NULL CHECK (classification_version = 2),
  actor_class text NOT NULL
    CHECK (actor_class IN ('system', 'probable_human', 'mail_proxy', 'privacy_proxy', 'security_scanner', 'automated_unknown', 'unknown')),
  confidence text NOT NULL
    CHECK (confidence IN ('none', 'low', 'medium', 'high', 'verified')),
  reasons_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reasons_json) = 'array'),
  classified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, classification_version)
);`,
    `INSERT INTO email_tracking_event_classifications (
  event_id,
  classification_version,
  actor_class,
  confidence,
  reasons_json
)
SELECT
  id,
  2,
  CASE
    WHEN event_type IN ('queued', 'sending', 'smtp_accepted', 'smtp_failed', 'delayed', 'bounced', 'dsn_delivered', 'mdn_displayed', 'replied', 'revoked', 'expired') THEN 'system'
    WHEN event_type IN ('open_automated', 'click_automated') THEN 'automated_unknown'
    WHEN event_type IN ('open_probable', 'click') THEN 'unknown'
    ELSE 'unknown'
  END,
  CASE
    WHEN confidence IN ('none', 'low', 'medium', 'high', 'verified') THEN confidence
    ELSE 'none'
  END,
  jsonb_build_array('legacy_event_projection_v2')
FROM email_tracking_events
ON CONFLICT (event_id, classification_version) DO NOTHING;`,
    `ALTER TABLE email_tracking_event_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_event_classifications FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY email_tracking_event_classifications_workspace_isolation ON email_tracking_event_classifications
  USING (
    EXISTS (
      SELECT 1
      FROM email_tracking_events
      WHERE email_tracking_events.id = email_tracking_event_classifications.event_id
        AND app.can_access_workspace(email_tracking_events.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM email_tracking_events
      WHERE email_tracking_events.id = email_tracking_event_classifications.event_id
        AND app.can_access_workspace(email_tracking_events.workspace_id)
    )
  );`,
  ],
  downSql: [
    'DROP POLICY IF EXISTS email_tracking_event_classifications_workspace_isolation ON email_tracking_event_classifications;',
    'DROP TABLE IF EXISTS email_tracking_event_classifications;',
    'ALTER TABLE email_tracking_policies DROP COLUMN IF EXISTS ip_insights_enabled;',
  ],
};
