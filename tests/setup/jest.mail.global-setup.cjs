/**
 * Mail-Suite: ein Wurzelverzeichnis je Jest-Lauf für die userData-Verzeichnisse
 * der Testdateien (siehe jest.mail.electron-mock.ts). Die Worker erben die
 * Umgebungsvariable; parallele Jest-Läufe kommen sich nicht in die Quere.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async function mailGlobalSetup() {
  process.env.SIMPLECRM_MAIL_TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'simplecrm-mail-tests-'));
};
