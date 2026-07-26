import type { SqlMigration } from './types';

export const apiRateLimitWindowIdxMigration: SqlMigration = {
  id: '0045_api_rate_limit_window_idx',
  description: 'Index api_rate_limit_counters.window_start_ms for opportunistic cleanup scans.',
  upSql: [
    'CREATE INDEX IF NOT EXISTS api_rate_limit_counters_window_idx ON api_rate_limit_counters (window_start_ms);',
  ],
  downSql: [
    'DROP INDEX IF EXISTS api_rate_limit_counters_window_idx;',
  ],
};
