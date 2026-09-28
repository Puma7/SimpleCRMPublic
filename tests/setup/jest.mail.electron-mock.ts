/**
 * Runs before mail test files load sqlite-service (which calls app.getPath at import time).
 * Ein Verzeichnis je Testdatei unter dem Wurzelverzeichnis des Laufs
 * (jest.mail.global-setup.cjs): Dateien desselben Workers schrieben sonst
 * dieselben Dateien (z. B. Wissensbasen `workflow-knowledge/kb-<id>.md`, die Ids
 * beginnen in jeder In-Memory-DB bei 1), und eine nachlaufende Schreiboperation
 * einer früheren Datei überschrieb die der nächsten.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockUserDataDir = fs.mkdtempSync(
  path.join(process.env.SIMPLECRM_MAIL_TEST_ROOT ?? os.tmpdir(), `file-${process.env.JEST_WORKER_ID ?? '0'}-`),
);

jest.mock('electron', () => ({
  app: {
    getPath: () => mockUserDataDir,
    getName: () => 'simplecrm-test',
  },
}));
