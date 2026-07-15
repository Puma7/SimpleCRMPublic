import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Postgres mail diagnostics tenant scope', () => {
  test('does not aggregate workspace-less MFA challenge rows into workspace diagnostics', () => {
    const source = readFileSync(
      resolve(__dirname, '../../packages/server/src/db/postgres-mail-diagnostics-port.ts'),
      'utf8',
    );

    expect(source).not.toContain("selectFrom('auth_challenge_tokens')");
  });
});
