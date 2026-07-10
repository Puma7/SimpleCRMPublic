import { CompiledQuery, type Kysely } from 'kysely';

import type { DoctorResult } from '../cli/doctor';
import { runDoctorChecks } from '../cli/doctor';
import {
  createPgMigrationDatabase,
  inspectServerMigrations,
  runServerMigrations,
  serverMigrations,
  type MigrationDatabase,
  type MigrationPlan,
  type MigrationRunResult,
} from '../migrations';
import type { ServerDatabase } from '../db/schema';
import {
  executeServerHardReset,
  previewServerHardReset,
  type ServerHardResetPreview,
} from './hard-reset';
import { createPgClientFromDatabaseUrl } from './pg-client';

export type MaintenanceStatus = Readonly<{
  edition: 'server';
  appVersion: string;
  needsInitialSetup: boolean;
}>;

export type ServerMaintenancePortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  databaseUrl: string;
  appVersion: string;
  backupDir?: string;
  attachmentsRoot?: string;
  auditArchiveRoot?: string;
  getNeedsInitialSetup: () => Promise<boolean>;
}>;

export type ServerMaintenancePort = Readonly<{
  getStatus(): Promise<MaintenanceStatus>;
  runDoctor(): Promise<DoctorResult>;
  checkMigrations(): Promise<MigrationPlan>;
  applyMigrations(): Promise<MigrationRunResult>;
  previewHardReset(): Promise<ServerHardResetPreview>;
  executeHardReset(): Promise<{ truncatedTables: number }>;
}>;

/**
 * A read-only MigrationDatabase backed by the shared Kysely pool. Used only for
 * the migration *inspection* (checkMigrations). It deliberately omits
 * `transaction`, so it can never be wired into applyMigrations /
 * reconcileAppliedChecksums — those must keep a dedicated single connection for
 * their BEGIN/COMMIT.
 */
function createKyselyMigrationDatabase(db: Kysely<ServerDatabase>): MigrationDatabase {
  return {
    async execute(text: string, params?: readonly unknown[]): Promise<void> {
      await db.executeQuery(CompiledQuery.raw(text, params ? [...params] : []));
    },
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params?: readonly unknown[],
    ): Promise<readonly T[]> {
      const result = await db.executeQuery<T>(
        CompiledQuery.raw(text, params ? [...params] : []) as CompiledQuery<T>,
      );
      return result.rows;
    },
  };
}

export function createServerMaintenancePort(options: ServerMaintenancePortOptions): ServerMaintenancePort {
  return {
    async getStatus() {
      return {
        edition: 'server',
        appVersion: options.appVersion,
        needsInitialSetup: await options.getNeedsInitialSetup(),
      };
    },

    async runDoctor() {
      const client = createPgClientFromDatabaseUrl(options.databaseUrl);
      await client.connect();
      try {
        return await runDoctorChecks(client, { backupDir: options.backupDir });
      } finally {
        await client.end();
      }
    },

    async checkMigrations() {
      // Run the READ-ONLY migration inspection over the existing Kysely pool
      // instead of opening a fresh short-lived pg.Client. That fresh connection
      // is what surfaced "Connection terminated" for POST /migrations/check;
      // the pool is already established and healthy. inspectServerMigrations only
      // runs CREATE TABLE IF NOT EXISTS + a SELECT (no transaction), so a
      // transaction-less adapter is safe — and it can never be misused for
      // applyMigrations, which keeps its own dedicated connection below.
      return inspectServerMigrations(createKyselyMigrationDatabase(options.db), serverMigrations);
    },

    async applyMigrations() {
      const client = createPgClientFromDatabaseUrl(options.databaseUrl);
      await client.connect();
      try {
        return await runServerMigrations(createPgMigrationDatabase(client), serverMigrations);
      } finally {
        await client.end();
      }
    },

    async previewHardReset() {
      return previewServerHardReset(options.db, {
        attachmentsRoot: options.attachmentsRoot,
        auditArchiveRoot: options.auditArchiveRoot,
      });
    },

    async executeHardReset() {
      return executeServerHardReset(options.db, {
        attachmentsRoot: options.attachmentsRoot,
        auditArchiveRoot: options.auditArchiveRoot,
      });
    },
  };
}
