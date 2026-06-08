import type { Kysely } from 'kysely';

import type { DoctorResult } from '../cli/doctor';
import { runDoctorChecks } from '../cli/doctor';
import {
  createPgMigrationDatabase,
  inspectServerMigrations,
  runServerMigrations,
  serverMigrations,
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
      const client = createPgClientFromDatabaseUrl(options.databaseUrl);
      await client.connect();
      try {
        return inspectServerMigrations(createPgMigrationDatabase(client), serverMigrations);
      } finally {
        await client.end();
      }
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
