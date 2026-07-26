import type { SqlMigration } from './types';

export const apiRateLimitCountersMigration: SqlMigration = {
  id: '0044_api_rate_limit_counters',
  description: 'Shared API rate-limit counters for multi-replica deployments.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS api_rate_limit_counters (
  bucket text NOT NULL,
  client_key text NOT NULL,
  window_start_ms bigint NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, client_key, window_start_ms)
);`,
    'CREATE INDEX IF NOT EXISTS api_rate_limit_counters_updated_idx ON api_rate_limit_counters (updated_at);',
    `COMMENT ON TABLE api_rate_limit_counters IS
'Global per-bucket/per-client request counters so every API replica shares the same rate limits.';`,
  ],
  downSql: [
    'DROP TABLE IF EXISTS api_rate_limit_counters;',
  ],
};
