import type { Kysely } from 'kysely';

import type { ServerDatabase } from './schema';

export type PostgresDatabaseOptions = Readonly<{
  databaseUrl: string;
  maxConnections?: number;
}>;

export async function createPostgresDatabase(options: PostgresDatabaseOptions): Promise<Kysely<ServerDatabase>> {
  if (!options.databaseUrl.trim()) {
    throw new Error('databaseUrl is required');
  }

  const { Kysely, PostgresDialect } = await importKysely();
  const { Pool } = require('pg') as typeof import('pg');
  return new Kysely<ServerDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: options.databaseUrl,
        max: options.maxConnections ?? 10,
      }),
    }),
  });
}

async function importKysely(): Promise<typeof import('kysely')> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<typeof import('kysely')>;
  return dynamicImport('kysely');
}
