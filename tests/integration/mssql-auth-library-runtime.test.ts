import { createRequire } from 'node:module';

test('the MSSQL type dependency chain loads Azure credentials through CommonJS', () => {
  const fromTypes = createRequire(require.resolve('@types/mssql/package.json'));
  const fromTedious = createRequire(fromTypes.resolve('tedious'));
  const { ClientSecretCredential } = fromTedious('@azure/identity') as {
    ClientSecretCredential: new (tenant: string, client: string, secret: string) => { getToken: unknown };
  };
  // Construct only; requesting tokens would contact the real identity provider.
  const credential = new ClientSecretCredential(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'offline-test-only',
  );
  expect(typeof credential.getToken).toBe('function');
});
