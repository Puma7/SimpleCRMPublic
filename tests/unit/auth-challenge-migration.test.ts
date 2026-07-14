import { authChallengeStateMigration } from '../../packages/server/src/migrations/0028_auth_challenge_state';
import { authChallengeTokenHash } from '../../packages/server/src/security/auth-challenge-store';

describe('shared auth challenge state', () => {
  test('uses a global hashed compound key with expiry lookup', () => {
    const sql = authChallengeStateMigration.upSql.join('\n');

    expect(sql).toContain('PRIMARY KEY (purpose, token_hash)');
    expect(sql).toContain('CHECK (purpose IN');
    expect(sql).toContain('attempt_count integer NOT NULL');
    expect(sql).toContain('auth_challenge_tokens_expires_idx');
    expect(sql).not.toContain('ENABLE ROW LEVEL SECURITY');
  });

  test('stores only deterministic SHA-256 token hashes', () => {
    const first = authChallengeTokenHash('secret-challenge');
    const second = authChallengeTokenHash('secret-challenge');

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('secret-challenge');
  });
});
