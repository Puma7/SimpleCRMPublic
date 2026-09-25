/**
 * @jest-environment node
 *
 * IMAP ohne TLS-Schalter (Port 143) nutzt STARTTLS, sobald der Server es
 * anbietet — wie der Server (mail-sync.ts), mit dem echten ImapFlow.
 */
import net from 'net';

jest.mock('../../electron/sqlite-service', () => ({ getDb: () => null }));

import { testImapConnection } from '../../electron/email/email-imap-sync';
import type { EmailAccountRow } from '../../electron/email/email-store';

type FakeImapServer = { port: number; commands: string[]; close: () => Promise<void> };

/** Bietet STARTTLS an und bricht nach dem OK ab: ein Client ohne Upgrade meldet sich im Klartext an. */
function startFakeImapServer(): Promise<FakeImapServer> {
  const commands: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.write('* OK [CAPABILITY IMAP4rev1 STARTTLS AUTH=PLAIN] Fake bereit\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      let newline = buffer.indexOf('\r\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        newline = buffer.indexOf('\r\n');
        const [tag, command = ''] = line.split(' ');
        commands.push(command.toUpperCase());
        if (command.toUpperCase() === 'CAPABILITY') {
          socket.write(`* CAPABILITY IMAP4rev1 STARTTLS AUTH=PLAIN\r\n${tag} OK CAPABILITY erledigt\r\n`);
        } else if (command.toUpperCase() === 'STARTTLS') {
          // Kein TLS-Zertifikat im Test: nach dem OK endet die Verbindung, der Handshake scheitert.
          socket.end(`${tag} OK Begin TLS negotiation now\r\n`);
        } else {
          socket.write(`${tag} OK erledigt\r\n`);
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        port,
        commands,
        close: () => new Promise<void>((done) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}

function plainImapAccount(port: number): EmailAccountRow {
  return {
    imap_host: '127.0.0.1',
    imap_port: port,
    imap_tls: 0,
    imap_username: 'kunde@example.com',
  } as EmailAccountRow;
}

describe('IMAP STARTTLS bei ausgeschaltetem TLS-Schalter', () => {
  let fake: FakeImapServer;

  beforeEach(async () => {
    fake = await startFakeImapServer();
  });

  afterEach(async () => {
    await fake.close();
  });

  // F-A7b-09: Bei ausgeschaltetem TLS-Schalter darf das Passwort nicht im Klartext gehen, wenn der Server STARTTLS anbietet.
  test('der Verbindungstest wechselt vor der Anmeldung auf STARTTLS', async () => {
    const result = await testImapConnection(plainImapAccount(fake.port), 'geheim');

    expect(result.ok).toBe(false);
    expect(fake.commands).toContain('STARTTLS');
    expect(fake.commands).not.toContain('LOGIN');
    expect(fake.commands).not.toContain('AUTHENTICATE');
  }, 30_000);
});
