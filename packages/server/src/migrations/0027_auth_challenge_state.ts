import type { SqlMigration } from './types';

export const authChallengeStateMigration: SqlMigration = {
  id: '0027_auth_challenge_state',
  description: 'Shared atomic CAPTCHA and MFA challenge replay/attempt state.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS auth_challenge_tokens (
  purpose text NOT NULL CHECK (purpose IN ('captcha', 'mfa')),
  token_hash text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (purpose, token_hash)
);`,
    'CREATE INDEX IF NOT EXISTS auth_challenge_tokens_expires_idx ON auth_challenge_tokens (expires_at);',
    `COMMENT ON TABLE auth_challenge_tokens IS
'Pre-authentication replay and attempt state. Keys are SHA-256 token hashes; the table is global so every API replica observes the same atomic limit.';`,
  ],
  downSql: [
    'DROP TABLE IF EXISTS auth_challenge_tokens;',
  ],
};
