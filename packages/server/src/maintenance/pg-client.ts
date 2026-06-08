import type { PgQueryClient } from '../migrations';

export type DisposablePgClient = PgQueryClient & Readonly<{
  connect(): Promise<void>;
  end(): Promise<void>;
}>;

export function createPgClientFromDatabaseUrl(databaseUrl: string): DisposablePgClient {
  const { Client } = require('pg') as typeof import('pg');
  const client = new Client({ connectionString: databaseUrl });
  return {
    async connect() {
      await client.connect();
    },
    async end() {
      await client.end();
    },
    async query(sql, params) {
      const result = await client.query(sql, params ? [...params] : undefined);
      return { rows: result.rows };
    },
  };
}
