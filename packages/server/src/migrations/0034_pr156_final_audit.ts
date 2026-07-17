import type { SqlMigration } from './types';

export const pr156FinalAuditMigration: SqlMigration = {
  id: '0034_pr156_final_audit',
  description: 'Track MFA email delivery before codes become verifiable',
  upSql: [
    `ALTER TABLE auth_mfa_email_codes
  ADD COLUMN delivery_status text NOT NULL DEFAULT 'sent'
  CHECK (delivery_status IN ('pending', 'sent', 'failed', 'superseded'));`,
  ],
  downSql: [
    'ALTER TABLE auth_mfa_email_codes DROP COLUMN IF EXISTS delivery_status;',
  ],
};
