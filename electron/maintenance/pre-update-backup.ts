import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Sicherung vor dem ersten Start einer neuen App-Version (Desktop).
 *
 * Ein Update ersetzt nur das Programm; beim ersten Start der neuen Version
 * erweitert initializeDatabase das Schema der bestehenden database.sqlite.
 * Vorher legt diese Funktion eine konsistente Kopie an (VACUUM INTO liest auch
 * noch nicht zurückgeschriebene WAL-Transaktionen), damit ein Update jederzeit
 * rückgängig gemacht werden kann: alte Version installieren, Kopie als
 * database.sqlite einsetzen.
 *
 * - Gesichert wird nur, wenn sich die Version seit dem letzten Start geändert
 *   hat (Datei `last-run-version` im Benutzerdatenordner) oder diese Datei
 *   fehlt (Update von einer Version ohne diese Funktion).
 * - Die letzten PRE_UPDATE_BACKUP_KEEP Sicherungen bleiben erhalten.
 * - Scheitert die Sicherung, startet die App trotzdem (sonst sperrte z. B. eine
 *   volle Platte den Zugang aus); die Version wird dann nicht vermerkt und der
 *   nächste Start versucht es erneut.
 */

export const PRE_UPDATE_BACKUP_KEEP = 3;
export const PRE_UPDATE_BACKUP_DIR = path.join('backups', 'pre-update');
export const LAST_RUN_VERSION_FILE = 'last-run-version';

export type PreUpdateBackupResult =
  | { status: 'skipped'; reason: 'no_database' | 'same_version' }
  | { status: 'created'; path: string; previousVersion: string | null }
  | { status: 'failed'; error: string };

export function backupDatabaseBeforeVersionChange(input: {
  dbPath: string;
  userDataPath: string;
  currentVersion: string;
  now?: Date;
  keep?: number;
}): PreUpdateBackupResult {
  const markerPath = path.join(input.userDataPath, LAST_RUN_VERSION_FILE);
  const previousVersion = readMarker(markerPath);

  if (!fs.existsSync(input.dbPath)) {
    // Neuinstallation: nichts zu sichern, ab jetzt gilt diese Version.
    writeMarker(markerPath, input.currentVersion);
    return { status: 'skipped', reason: 'no_database' };
  }
  if (previousVersion === input.currentVersion) {
    return { status: 'skipped', reason: 'same_version' };
  }

  const backupDir = path.join(input.userDataPath, PRE_UPDATE_BACKUP_DIR);
  const stamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const fileName = `${stamp}_${fileSafe(previousVersion ?? 'unbekannt')}_to_${fileSafe(input.currentVersion)}.sqlite`;
  const target = path.join(backupDir, fileName);
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const source = new Database(input.dbPath, { fileMustExist: true });
    try {
      source.prepare('VACUUM INTO ?').run(target);
    } finally {
      source.close();
    }
  } catch (error) {
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // Keine halbe Kopie liegen lassen — wenn schon das Aufräumen scheitert, bleibt es beim Fehler.
    }
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }

  pruneOldBackups(backupDir, input.keep ?? PRE_UPDATE_BACKUP_KEEP);
  writeMarker(markerPath, input.currentVersion);
  return { status: 'created', path: target, previousVersion };
}

function readMarker(markerPath: string): string | null {
  try {
    const value = fs.readFileSync(markerPath, 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeMarker(markerPath: string, version: string): void {
  try {
    fs.writeFileSync(markerPath, `${version}\n`, 'utf8');
  } catch {
    // Ohne Vermerk sichert der nächste Start erneut — unschädlich.
  }
}

function fileSafe(value: string): string {
  return value.replace(/[^0-9A-Za-z.-]/g, '_').slice(0, 40) || 'unbekannt';
}

/** Dateinamen beginnen mit dem Zeitstempel: alphabetisch = zeitlich. */
function pruneOldBackups(backupDir: string, keep: number): void {
  let files: string[];
  try {
    files = fs.readdirSync(backupDir).filter((name) => name.endsWith('.sqlite')).sort();
  } catch {
    return;
  }
  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    try {
      fs.rmSync(path.join(backupDir, name), { force: true });
    } catch {
      // Gesperrt oder ohne Rechte: bleibt liegen. Aufräumen darf den Start nie verhindern.
    }
  }
}
