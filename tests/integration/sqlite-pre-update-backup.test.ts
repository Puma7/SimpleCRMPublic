import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

import {
  LAST_RUN_VERSION_FILE,
  PRE_UPDATE_BACKUP_DIR,
  backupDatabaseBeforeVersionChange,
} from '../../electron/maintenance/pre-update-backup';

/**
 * Desktop-Update: vor dem ersten Start einer neuen Version wird die Datenbank
 * gesichert, bevor initializeDatabase das Schema erweitert. Die Kopie muss
 * auch Transaktionen enthalten, die noch im WAL stehen.
 */
describe('Desktop: Sicherung vor dem ersten Start einer neuen Version', () => {
  let userData: string;
  let dbPath: string;

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'simplecrm-pre-update-'));
    dbPath = path.join(userData, 'database.sqlite');
  });

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  function seedDatabase(rows: number): Database.Database {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT)');
    const insert = db.prepare('INSERT INTO customers (name) VALUES (?)');
    for (let i = 0; i < rows; i += 1) insert.run(`Kunde ${i}`);
    return db;
  }

  const backups = () => fs.readdirSync(path.join(userData, PRE_UPDATE_BACKUP_DIR)).sort();
  const marker = () => fs.readFileSync(path.join(userData, LAST_RUN_VERSION_FILE), 'utf8').trim();

  test('Neuinstallation: nichts zu sichern, Version wird vermerkt', () => {
    expect(backupDatabaseBeforeVersionChange({ dbPath, userDataPath: userData, currentVersion: '1.1.0' }))
      .toEqual({ status: 'skipped', reason: 'no_database' });
    expect(marker()).toBe('1.1.0');
  });

  test('Versionswechsel: vollständige Kopie inklusive WAL, dann nicht noch einmal', () => {
    const live = seedDatabase(25);
    // Die App läuft noch bzw. wurde nicht sauber beendet: Daten stehen im WAL.
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(true);
    fs.writeFileSync(path.join(userData, LAST_RUN_VERSION_FILE), '1.0.9\n');

    const result = backupDatabaseBeforeVersionChange({
      dbPath, userDataPath: userData, currentVersion: '1.1.0', now: new Date('2026-09-26T16:00:00.000Z'),
    });
    live.close();

    expect(result).toMatchObject({ status: 'created', previousVersion: '1.0.9' });
    expect(backups()).toEqual(['2026-09-26T16-00-00-000Z_1.0.9_to_1.1.0.sqlite']);
    const copy = new Database(path.join(userData, PRE_UPDATE_BACKUP_DIR, backups()[0]!), { readonly: true });
    try {
      expect(copy.prepare('SELECT COUNT(*) AS n FROM customers').get()).toEqual({ n: 25 });
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      copy.close();
    }
    expect(marker()).toBe('1.1.0');

    expect(backupDatabaseBeforeVersionChange({ dbPath, userDataPath: userData, currentVersion: '1.1.0' }))
      .toEqual({ status: 'skipped', reason: 'same_version' });
    expect(backups()).toHaveLength(1);
  });

  test('Update von einer Version ohne Vermerk sichert ebenfalls; nur die letzten drei bleiben', () => {
    seedDatabase(3).close();
    const versions = ['1.1.0', '1.1.1', '1.2.0', '1.3.0'];
    versions.forEach((version, index) => {
      const result = backupDatabaseBeforeVersionChange({
        dbPath, userDataPath: userData, currentVersion: version, now: new Date(Date.UTC(2026, 9, 1 + index)),
      });
      expect(result.status).toBe('created');
    });
    expect(backups()).toEqual([
      '2026-10-02T00-00-00-000Z_1.1.0_to_1.1.1.sqlite',
      '2026-10-03T00-00-00-000Z_1.1.1_to_1.2.0.sqlite',
      '2026-10-04T00-00-00-000Z_1.2.0_to_1.3.0.sqlite',
    ]);
  });

  test('scheitert die Sicherung, startet die App trotzdem und versucht es beim nächsten Start erneut', () => {
    seedDatabase(1).close();
    fs.writeFileSync(path.join(userData, LAST_RUN_VERSION_FILE), '1.0.9\n');
    // Zielordner nicht anlegbar: an seiner Stelle liegt eine Datei.
    fs.mkdirSync(path.join(userData, 'backups'));
    fs.writeFileSync(path.join(userData, PRE_UPDATE_BACKUP_DIR), 'keine Ordner');

    const result = backupDatabaseBeforeVersionChange({ dbPath, userDataPath: userData, currentVersion: '1.1.0' });

    expect(result.status).toBe('failed');
    expect(marker()).toBe('1.0.9');
  });
});
