import {
  credentialCommands,
  startFakePop3Server,
  trustFakePop3Certificate,
  type FakePop3Server,
} from '../fixtures/fake-pop3-server';

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
  getSyncInfo: jest.fn(() => null),
  setSyncInfo: jest.fn(),
  deleteSyncInfo: jest.fn(),
}));

const { testPop3Connection } = require('../../electron/email/email-pop3-sync') as typeof import('../../electron/email/email-pop3-sync');

let restoreTrust: () => void = () => undefined;
beforeAll(() => {
  restoreTrust = trustFakePop3Certificate();
});
afterAll(() => restoreTrust());

let server: FakePop3Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

function pop3Account(port: number) {
  return {
    imap_username: 'kunde@example.test',
    imap_host: 'localhost',
    pop3_host: 'localhost',
    pop3_port: port,
    pop3_tls: 0,
  } as never;
}

// F-A4-05 (E10): node-pop3 has no STLS, so the desktop sent USER/PASS in
// plaintext whenever implicit TLS was off, even if the server offered STLS.
describe('desktop POP3 uses STLS opportunistically (real node-pop3)', () => {
  test('upgrades via STLS before USER/PASS and reads UIDL over TLS', async () => {
    server = await startFakePop3Server({ offerStls: true });

    const result = await testPop3Connection(pop3Account(server.port), 'geheim');

    expect(result).toEqual({ ok: true });
    expect(server.commands.slice(0, 2)).toEqual([
      { line: 'CAPA', secure: false },
      { line: 'STLS', secure: false },
    ]);
    expect(credentialCommands(server.commands)).toEqual([
      { line: 'USER', secure: true },
      { line: 'PASS', secure: true },
    ]);
    expect(server.commands.find((command) => command.line === 'UIDL')).toEqual({ line: 'UIDL', secure: true });
  });

  test.each([
    ['offers no STLS', { offerStls: false }],
    ['does not know CAPA', { offerStls: true, noCapa: true }],
    ['refuses the STLS command', { offerStls: true, refuseStls: true }],
  ])('logs in as before when the server %s', async (_label, options) => {
    server = await startFakePop3Server(options);

    const result = await testPop3Connection(pop3Account(server.port), 'geheim');

    expect(result).toEqual({ ok: true });
    expect(credentialCommands(server.commands)).toEqual([
      { line: 'USER', secure: false },
      { line: 'PASS', secure: false },
    ]);
  });

  test('fails without any plaintext login when the STLS handshake fails', async () => {
    server = await startFakePop3Server({ offerStls: true });
    restoreTrust();
    try {
      const result = await testPop3Connection(pop3Account(server.port), 'geheim');

      expect(result).toEqual({ ok: false, error: expect.stringMatching(/certificate/i) });
      expect(credentialCommands(server.commands)).toEqual([]);
    } finally {
      restoreTrust = trustFakePop3Certificate();
    }
  });

  test('fails without a login when the server drops the connection during CAPA', async () => {
    server = await startFakePop3Server({ offerStls: true, closeDuringCapa: true });

    const result = await testPop3Connection(pop3Account(server.port), 'geheim');

    expect(result.ok).toBe(false);
    expect(credentialCommands(server.commands)).toEqual([]);
  });
});
