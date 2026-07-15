import { createHash } from 'node:crypto';

import { sql as kyselySql, type Kysely } from 'kysely';

import type { ServerDatabase } from '../db/schema';

export type AuthChallengePurpose = 'captcha' | 'mfa';

export type AuthChallengeStore = Readonly<{
  consume(input: {
    token: string;
    purpose: AuthChallengePurpose;
    ttlMs: number;
    now: Date;
  }): Promise<boolean>;
  registerAttempt(input: {
    token: string;
    purpose: AuthChallengePurpose;
    maxAttempts: number;
    ttlMs: number;
    now: Date;
  }): Promise<boolean>;
}>;

export function createPostgresAuthChallengeStore(
  db: Kysely<ServerDatabase>,
): AuthChallengeStore {
  return {
    async consume(input) {
      const normalized = validInputToken(input.token, input.ttlMs);
      if (!normalized) return false;
      await db
        .deleteFrom('auth_challenge_tokens')
        .where('expires_at', '<=', input.now)
        .execute();
      const expiresAt = new Date(input.now.getTime() + input.ttlMs);
      const row = await db
        .insertInto('auth_challenge_tokens')
        .values({
          purpose: input.purpose,
          token_hash: authChallengeTokenHash(normalized),
          attempt_count: 0,
          consumed_at: input.now,
          expires_at: expiresAt,
          updated_at: input.now,
        })
        .onConflict((oc) => oc
          .columns(['purpose', 'token_hash'])
          .doUpdateSet({
            attempt_count: 0,
            consumed_at: input.now,
            expires_at: expiresAt,
            updated_at: input.now,
          })
          .where((eb) => eb.or([
            eb('auth_challenge_tokens.expires_at', '<=', input.now),
            eb('auth_challenge_tokens.consumed_at', 'is', null),
          ])))
        .returning('token_hash')
        .executeTakeFirst();
      return Boolean(row);
    },

    async registerAttempt(input) {
      const normalized = validInputToken(input.token, input.ttlMs);
      if (!normalized || !Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
        return false;
      }
      await db
        .deleteFrom('auth_challenge_tokens')
        .where('expires_at', '<=', input.now)
        .execute();
      const expiresAt = new Date(input.now.getTime() + input.ttlMs);
      const row = await db
        .insertInto('auth_challenge_tokens')
        .values({
          purpose: input.purpose,
          token_hash: authChallengeTokenHash(normalized),
          attempt_count: 1,
          consumed_at: null,
          expires_at: expiresAt,
          updated_at: input.now,
        })
        .onConflict((oc) => oc
          .columns(['purpose', 'token_hash'])
          .doUpdateSet({
            attempt_count: kyselySql<number>`case
              when auth_challenge_tokens.expires_at <= ${input.now} then 1
              else auth_challenge_tokens.attempt_count + 1
            end`,
            consumed_at: null,
            expires_at: kyselySql<Date>`case
              when auth_challenge_tokens.expires_at <= ${input.now} then ${expiresAt}
              else auth_challenge_tokens.expires_at
            end`,
            updated_at: input.now,
          })
          .where((eb) => eb.or([
            eb('auth_challenge_tokens.expires_at', '<=', input.now),
            eb.and([
              eb('auth_challenge_tokens.consumed_at', 'is', null),
              eb('auth_challenge_tokens.attempt_count', '<', input.maxAttempts),
            ]),
          ])))
        .returning('token_hash')
        .executeTakeFirst();
      return Boolean(row);
    },
  };
}

export function authChallengeTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function validInputToken(token: string, ttlMs: number): string | null {
  const normalized = token.trim();
  if (!normalized || normalized.length > 4096) return null;
  if (!Number.isInteger(ttlMs) || ttlMs < 1) return null;
  return normalized;
}
