/**
 * @jest-environment node
 */
import { createServerMailConnectionTestPort } from '../../packages/server/src/mail-connection-test';
import { createDefaultPop3Client } from '../../packages/server/src/mail-sync';
import {
  credentialCommands,
  startFakePop3Server,
  trustFakePop3Certificate,
  type FakePop3Server,
} from '../fixtures/fake-pop3-server';

// The client verifies the fake server's self-signed "localhost" certificate
// like any other one; the test only adds it to the trusted CAs.
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

// F-A4-05 (E10): POP3 sync and POP3 connection test sent USER/PASS in plaintext
// whenever implicit TLS was off, even if the server offered STLS; the IMAP side
// already upgrades opportunistically via STARTTLS.
describe('server POP3 uses STLS opportunistically', () => {
  test('sync client upgrades via STLS before USER/PASS and keeps working over TLS', async () => {
    server = await startFakePop3Server({ offerStls: true, messages: ['Subject: Eins\r\n\r\nText'] });
    const client = createDefaultPop3Client({
      host: 'localhost',
      port: server.port,
      tls: false,
      user: 'kunde@example.test',
      password: 'geheim',
      timeoutMs: 5_000,
    });

    await client.connect();
    const uidls = await client.uidl();
    const message = await client.retr(1);
    await client.quit();

    expect(server.commands.slice(0, 2)).toEqual([
      { line: 'CAPA', secure: false },
      { line: 'STLS', secure: false },
    ]);
    expect(credentialCommands(server.commands)).toEqual([
      { line: 'USER', secure: true },
      { line: 'PASS', secure: true },
    ]);
    expect(uidls).toEqual([[1, 'uid-1']]);
    expect(message.toString('latin1')).toContain('Subject: Eins');
  });

  test.each([
    ['offers no STLS', { offerStls: false }],
    ['does not know CAPA', { offerStls: true, noCapa: true }],
    ['refuses the STLS command', { offerStls: true, refuseStls: true }],
  ])('sync client logs in as before when the server %s', async (_label, options) => {
    server = await startFakePop3Server(options);
    const client = createDefaultPop3Client({
      host: 'localhost',
      port: server.port,
      tls: false,
      user: 'kunde@example.test',
      password: 'geheim',
      timeoutMs: 5_000,
    });

    await client.connect();
    await client.quit();

    expect(credentialCommands(server.commands)).toEqual([
      { line: 'USER', secure: false },
      { line: 'PASS', secure: false },
    ]);
    expect(server.commands[0]).toEqual({ line: 'CAPA', secure: false });
  });

  test('connection test upgrades via STLS before USER/PASS', async () => {
    server = await startFakePop3Server({ offerStls: true });
    const port = createServerMailConnectionTestPort({ timeoutMs: 5_000 });

    const result = await port.testPop3({
      workspaceId: 'workspace-a',
      host: 'localhost',
      port: server.port,
      tls: false,
      user: 'kunde@example.test',
      password: 'geheim',
    });

    expect(result).toEqual({ success: true });
    expect(server.commands.slice(0, 2)).toEqual([
      { line: 'CAPA', secure: false },
      { line: 'STLS', secure: false },
    ]);
    expect(credentialCommands(server.commands)).toEqual([
      { line: 'USER', secure: true },
      { line: 'PASS', secure: true },
    ]);
  });

  test('connection test stays in plaintext only when STLS is not offered', async () => {
    server = await startFakePop3Server({ offerStls: false });
    const port = createServerMailConnectionTestPort({ timeoutMs: 5_000 });

    const result = await port.testPop3({
      workspaceId: 'workspace-a',
      host: 'localhost',
      port: server.port,
      tls: false,
      user: 'kunde@example.test',
      password: 'geheim',
    });

    expect(result).toEqual({ success: true });
    expect(credentialCommands(server.commands)).toEqual([
      { line: 'USER', secure: false },
      { line: 'PASS', secure: false },
    ]);
  });

  test('fails without any plaintext login when the STLS handshake fails', async () => {
    server = await startFakePop3Server({ offerStls: true });
    restoreTrust();
    try {
      const client = createDefaultPop3Client({
        host: 'localhost',
        port: server.port,
        tls: false,
        user: 'kunde@example.test',
        password: 'geheim',
        timeoutMs: 5_000,
      });
      await expect(client.connect()).rejects.toThrow(/certificate/i);
      await client.quit();

      const result = await createServerMailConnectionTestPort({ timeoutMs: 5_000 }).testPop3({
        workspaceId: 'workspace-a',
        host: 'localhost',
        port: server.port,
        tls: false,
        user: 'kunde@example.test',
        password: 'geheim',
      });
      expect(result).toEqual({ success: false, error: expect.stringMatching(/certificate/i) });
      expect(credentialCommands(server.commands)).toEqual([]);
    } finally {
      restoreTrust = trustFakePop3Certificate();
    }
  });
});
