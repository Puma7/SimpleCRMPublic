import type { SqlMigration } from './types';

export const emailTrackingPerMessageMigration: SqlMigration = {
  id: '0035_email_tracking_per_message',
  description: 'Per-message tracking override and a default-for-new-messages policy flag',
  upSql: [
    `ALTER TABLE email_tracking_policies
  ADD COLUMN default_track_new_messages boolean NOT NULL DEFAULT true;`,
    // NULL = follow the policy default; true/false = explicit per-message choice
    // made in the compose dialog. Survives the draft → scheduled-send path.
    `ALTER TABLE email_messages
  ADD COLUMN tracking_override boolean;`,
  ],
  downSql: [
    'ALTER TABLE email_messages DROP COLUMN IF EXISTS tracking_override;',
    'ALTER TABLE email_tracking_policies DROP COLUMN IF EXISTS default_track_new_messages;',
  ],
};
