import type { SqlMigration } from './types';

export const authLoginSecurityMigration: SqlMigration = {
  id: '0020_auth_login_security',
  description: 'Optional login PIN and MFA fields for users',
  upSql: [
    `ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_pin_hash text,
  ADD COLUMN IF NOT EXISTS login_pin_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_method text CHECK (mfa_method IS NULL OR mfa_method IN ('totp', 'email')),
  ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_totp_secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL;`,
    `CREATE TABLE IF NOT EXISTS auth_mfa_email_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE INDEX IF NOT EXISTS auth_mfa_email_codes_user_active_idx
  ON auth_mfa_email_codes (user_id, expires_at DESC)
  WHERE consumed_at IS NULL;`,
  ],
  downSql: [
    'DROP TABLE IF EXISTS auth_mfa_email_codes;',
    `ALTER TABLE users
  DROP COLUMN IF EXISTS mfa_totp_secret_id,
  DROP COLUMN IF EXISTS mfa_enabled,
  DROP COLUMN IF EXISTS mfa_method,
  DROP COLUMN IF EXISTS login_pin_enabled,
  DROP COLUMN IF EXISTS login_pin_hash;`,
  ],
};
