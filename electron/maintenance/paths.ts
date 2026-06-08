import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import { initializeDatabase } from '../sqlite-service';

export type DesktopMaintenancePaths = Readonly<{
  databasePath: string;
  attachmentsPath: string;
  logsPath: string;
  userDataPath: string;
}>;

export function resolveDesktopMaintenancePaths(): DesktopMaintenancePaths {
  const userDataPath = app.getPath('userData');
  return {
    userDataPath,
    databasePath: path.join(userDataPath, 'database.sqlite'),
    attachmentsPath: path.join(userDataPath, 'email-attachments'),
    logsPath: path.join(userDataPath, 'logs'),
  };
}

export function readFileSizeBytes(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

export function directoryExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

export function runDesktopSchemaRepair(): { ok: true; message: string } {
  initializeDatabase();
  return { ok: true, message: 'Schema-Migrationen wurden angewendet.' };
}
