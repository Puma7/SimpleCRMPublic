/**
 * @jest-environment node
 */
// `var`: sqlite-service liest app.isPackaged schon beim Laden, bevor diese
// Datei ihre Konstanten initialisiert hat (jest.mock wird nach oben gezogen).
var mockApp: { isPackaged: boolean; version: string; userData: string } | undefined;
jest.mock('electron', () => ({
  app: {
    get isPackaged() { return mockApp?.isPackaged ?? true; },
    getVersion: () => mockApp!.version,
    getPath: () => mockApp!.userData,
  },
}));

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { closeDatabase, initializeDatabase } from '../../electron/sqlite-service';

mockApp = {
  isPackaged: true,
  version: '1.1.0',
  userData: `${process.cwd()}/.tmp-tests/simplecrm-pre-update-startup`,
};
const app = mockApp;

/** Die gepackte App sichert beim ersten Start einer neuen Version, bevor das Schema erweitert wird. */
describe('Desktop-Start: Sicherung vor der Schema-Erweiterung einer neuen Version', () => {
  const backupDir = join(app.userData, 'backups', 'pre-update');

  beforeEach(() => {
    rmSync(app.userData, { recursive: true, force: true });
    mkdirSync(app.userData, { recursive: true });
  });

  afterAll(() => {
    rmSync(app.userData, { recursive: true, force: true });
  });

  test('Neuinstallation ohne Sicherung, danach Update 1.1.0 → 1.2.0 mit Sicherung', () => {
    app.version = '1.1.0';
    initializeDatabase();
    closeDatabase();
    expect(existsSync(backupDir)).toBe(false);
    expect(readFileSync(join(app.userData, 'last-run-version'), 'utf8').trim()).toBe('1.1.0');

    initializeDatabase();
    closeDatabase();
    expect(existsSync(backupDir)).toBe(false);

    app.version = '1.2.0';
    initializeDatabase();
    closeDatabase();
    const files = readdirSync(backupDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/_1\.1\.0_to_1\.2\.0\.sqlite$/);
  });

  test('Entwicklungsmodus (nicht gepackt) sichert nie', () => {
    app.isPackaged = false;
    try {
      initializeDatabase();
      closeDatabase();
      writeFileSync(join(app.userData, 'last-run-version'), '0.0.1\n');
      initializeDatabase();
      closeDatabase();
      expect(existsSync(backupDir)).toBe(false);
    } finally {
      app.isPackaged = true;
    }
  });
});
