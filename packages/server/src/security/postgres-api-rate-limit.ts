import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type { ServerDatabase } from '../db/schema';
import type { ApiRateLimitResult, RateLimitBucket } from './api-rate-limit';

const WINDOW_MS = 60_000;

export type PostgresApiRateLimitPort = Readonly<{
  check(input: {
    bucket: RateLimitBucket;
    clientKey: string;
    limit: number;
    nowMs?: number;
  }): Promise<ApiRateLimitResult>;
}>;

export function createPostgresApiRateLimitPort(
  db: Kysely<ServerDatabase>,
): PostgresApiRateLimitPort {
  return {
    async check(input) {
      const nowMs = input.nowMs ?? Date.now();
      const windowStartMs = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
      const retryAfterMs = Math.max(0, WINDOW_MS - (nowMs - windowStartMs));

      const row = await db
        .insertInto('api_rate_limit_counters')
        .values({
          bucket: input.bucket,
          client_key: input.clientKey,
          window_start_ms: String(windowStartMs),
          request_count: 1,
        })
        .onConflict((oc) => oc
          .columns(['bucket', 'client_key', 'window_start_ms'])
          .doUpdateSet({
            request_count: sql`api_rate_limit_counters.request_count + 1`,
            updated_at: sql`now()`,
          }))
        .returning(['request_count'])
        .executeTakeFirst();

      const count = row?.request_count ?? 1;
      if (count > input.limit) {
        return {
          allowed: false,
          limit: input.limit,
          bucket: input.bucket,
          retryAfterMs,
        };
      }
      return { allowed: true };
    },
  };
}
