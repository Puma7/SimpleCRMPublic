import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import { maintenanceHardResetPhraseMatches } from '@simplecrm/core';
import {
  startEmailBackgroundServices,
  stopEmailBackgroundServices,
} from '../email/email-imap-services';
import {
  bootstrapFreshDatabaseSchema,
  closeDatabase,
  initializeDatabase,
} from '../sqlite-service';
import {
  directoryExists,
  readFileSizeBytes,
  resolveDesktopMaintenancePaths,
  runDesktopSchemaRepair,
  type DesktopMaintenancePaths,
} from './paths';
import { purgeDesktopKeytarSecrets } from './keytar-purge';

export const DESKTOP_HARD_RESET_PHRASE = 'SYSTEM LÖSCHEN';

export type DesktopHardResetPreview = Readonly<{
  paths: DesktopMaintenancePaths;
  databaseExists: boolean;
  databaseSizeBytes: number | null;
  attachmentsExists: boolean;
  logsExists: boolean;
  keepDeployConfig: boolean;
}>;

export function previewDesktopHardReset(): DesktopHardResetPreview {
  const paths = resolveDesktopMaintenancePaths();
  return {
    paths,
    databaseExists: fs.existsSync(paths.databasePath),
    databaseSizeBytes: readFileSizeBytes(paths.databasePath),
    attachmentsExists: directoryExists(paths.attachmentsPath),
    logsExists: directoryExists(paths.logsPath),
    keepDeployConfig: true,
  };
}

export type DesktopHardResetInput = Readonly<{
  confirmPhrase: string;
  acknowledgeDataLoss: boolean;
}>;

export function validateDesktopHardResetInput(input: DesktopHardResetInput): string | null {
  if (!input.acknowledgeDataLoss) {
    return 'Bitte den vollständigen Datenverlust bestätigen.';
  }
  if (!maintenanceHardResetPhraseMatches(input.confirmPhrase)) {
    return `Bitte „${DESKTOP_HARD_RESET_PHRASE}" exakt eingeben.`;
  }
  return null;
}

function removePathIfExists(targetPath: string): void {
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
}

export async function executeDesktopHardReset(input: DesktopHardResetInput): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const validationError = validateDesktopHardResetInput(input);
  if (validationError) return { ok: false, error: validationError };

  stopEmailBackgroundServices();
  closeDatabase();

  await purgeDesktopKeytarSecrets().catch(() => undefined);

  const paths = resolveDesktopMaintenancePaths();
  removePathIfExists(paths.databasePath);
  removePathIfExists(paths.attachmentsPath);
  removePathIfExists(paths.logsPath);
  removePathIfExists(path.join(paths.userDataPath, 'pre-restore-backups'));

  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  fs.mkdirSync(path.dirname(paths.databasePath), { recursive: true });
  const connection = new Database(paths.databasePath);
  try {
    bootstrapFreshDatabaseSchema(connection);
  } finally {
    connection.close();
  }

  initializeDatabase();
  app.relaunch();
  app.exit(0);
  return { ok: true };
}

export async function runDesktopRepair(
  logger: Pick<typeof console, 'warn' | 'error' | 'debug'>,
): Promise<{ ok: true; message: string }> {
  stopEmailBackgroundServices();
  runDesktopSchemaRepair();
  try {
    await startEmailBackgroundServices(logger);
  } catch (error) {
    logger.error('[maintenance] startEmailBackgroundServices after repair failed', error);
    return {
      ok: true,
      message: 'Schema-Migrationen wurden angewendet, aber Hintergrunddienste konnten nicht neu gestartet werden. Bitte die App neu starten.',
    };
  }
  return { ok: true, message: 'Lokale Reparatur abgeschlossen. Schema-Migrationen wurden angewendet.' };
}

export function getDesktopMaintenanceStatus(appVersion: string): Readonly<{
  edition: 'desktop-standalone';
  appVersion: string;
  preview: DesktopHardResetPreview;
}> {
  return {
    edition: 'desktop-standalone',
    appVersion,
    preview: previewDesktopHardReset(),
  };
}
