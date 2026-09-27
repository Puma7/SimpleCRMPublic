/**
 * Runs before mail test files load sqlite-service (which calls app.getPath at import time).
 * Ein Verzeichnis je Jest-Worker: parallel laufende Testdateien schrieben sonst
 * dieselben Dateien (z. B. Wissensbasen `workflow-knowledge/kb-<id>.md`, die Ids
 * beginnen in jeder In-Memory-DB bei 1) und überschrieben sich gegenseitig.
 */
jest.mock('electron', () => ({
  app: {
    getPath: () => `/tmp/simplecrm-mail-test-${process.env.JEST_WORKER_ID ?? '0'}`,
    getName: () => 'simplecrm-test',
  },
}));
