/**
 * Räumt das Wurzelverzeichnis des Laufs weg — erst hier, wenn alle Worker
 * beendet sind, damit keine nachlaufende Operation in ein gelöschtes
 * Verzeichnis schreibt.
 */
const fs = require('fs');

module.exports = async function mailGlobalTeardown() {
  const root = process.env.SIMPLECRM_MAIL_TEST_ROOT;
  if (root) fs.rmSync(root, { recursive: true, force: true });
};
