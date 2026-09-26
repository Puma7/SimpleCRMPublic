import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { startMigratedEmbeddedPostgres, type EmbeddedPostgres } from './helpers/embedded-postgres';

jest.setTimeout(120_000);

/**
 * `simplecrm disk` fragt die Datenbank mit psql ab (docker/disk-report.sh).
 * Jede dieser Abfragen muss auf dem aktuellen Schema laufen; ein Tippfehler
 * fiele sonst erst beim Betreiber auf (die Ausgabe von psql wird verworfen).
 */
describe('disk report SQL runs on the migrated schema', () => {
  let postgres: EmbeddedPostgres;

  beforeAll(async () => {
    postgres = await startMigratedEmbeddedPostgres('disk-report-sql');
  });

  afterAll(async () => {
    if (postgres) await postgres.stop();
  });

  const script = readFileSync(join(__dirname, '../../docker/disk-report.sh'), 'utf8');
  const queries = [...script.matchAll(/psql_run "((?:[^"\\]|\\.)+)"/g)]
    .map((match) => match[1]!.replace(/\\"/g, '"'))
    .filter((query) => /^\s*(SELECT|WITH)\b/i.test(query));

  test('the report has database queries', () => {
    expect(queries.length).toBeGreaterThanOrEqual(5);
  });

  test.each(queries.map((query) => [query.slice(0, 60), query]))('%s …', async (_label, query) => {
    await expect(postgres.admin.query(query)).resolves.toBeDefined();
  });
});
