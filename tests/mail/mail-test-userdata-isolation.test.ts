/**
 * Testumgebung der Mail-Suite: jede Testdatei bekommt ein eigenes
 * userData-Verzeichnis unter dem Wurzelverzeichnis dieses Jest-Laufs. Vorher
 * teilten sich alle Dateien eines Workers ein Verzeichnis; die Wissensbasis-Ids
 * beginnen in jeder In-Memory-DB bei 1, und eine nachlaufende Schreiboperation
 * einer früheren Datei überschrieb `workflow-knowledge/kb-1.md` einer späteren
 * (Learnings „Übernehmen“ meldete dann „Wissensbasis geändert“ statt des
 * erwarteten Fehlers). Parallele Jest-Läufe teilten sich dieselben Pfade.
 */
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

test('userData je Testdatei unter dem Wurzelverzeichnis des Laufs', () => {
  const root = process.env.SIMPLECRM_MAIL_TEST_ROOT;
  expect(root).toBeTruthy();
  const dir = app.getPath('userData');
  expect(path.dirname(dir)).toBe(root);
  expect(fs.statSync(dir).isDirectory()).toBe(true);
  expect(fs.readdirSync(dir)).toEqual([]);
});
