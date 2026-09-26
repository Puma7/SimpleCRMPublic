import { createServer, type Server, type Socket } from 'net';

import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import { MailAccessService } from '../../packages/server/src/mail-access/service';
import { createServerMailConnectionTestPort } from '../../packages/server/src/mail-connection-test';

/**
 * Local plaintext SMTP server that offers no STARTTLS, like a server behind an
 * on-path attacker who strips it from the EHLO answer. Records every command.
 */
function startFakeSmtpServer(): Promise<{ server: Server; port: number; commands: string[] }> {
  const commands: string[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = '';
    let inData = false;
    socket.setEncoding('utf8');
    socket.write('220 fake.example ESMTP\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf('\r\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf('\r\n');
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 queued\r\n');
          }
          continue;
        }
        commands.push(line);
        if (/^EHLO /i.test(line)) socket.write('250-fake.example\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
        else if (/^AUTH /i.test(line)) socket.write('235 ok\r\n');
        else if (/^DATA$/i.test(line)) {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (/^QUIT$/i.test(line)) {
          socket.end('221 bye\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('could not allocate SMTP test port'));
        return;
      }
      resolve({ server, port: address.port, commands });
    });
  });
}

// C-A66: Der Ad-hoc-SMTP-Test (eingegebenes Passwort) verwarf den TLS-Schalter; ohne STARTTLS-Angebot gingen AUTH PLAIN und Passwort im Klartext raus.
describe('POST /api/v1/email/accounts/test-smtp with the TLS switch (G10)', () => {
  let smtp: Awaited<ReturnType<typeof startFakeSmtpServer>>;
  const admin: AuthenticatedPrincipal = {
    userId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-0000000000aa',
    role: 'admin',
  };
  const api = createServerApi({
    mailAccess: new MailAccessService({ async resolveGrants() { return []; } }),
    mailConnectionTests: createServerMailConnectionTestPort({ timeoutMs: 5_000 }),
  } as unknown as ServerApiPorts);

  beforeAll(async () => {
    smtp = await startFakeSmtpServer();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => smtp.server.close(() => resolve()));
  });

  beforeEach(() => {
    smtp.commands.length = 0;
  });

  function testSmtp(extra: Record<string, unknown>) {
    return api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/test-smtp',
      principal: admin,
      body: {
        host: '127.0.0.1',
        port: smtp.port,
        secure: false,
        user: 'adhoc@example.com',
        password: 'geheim',
        ...extra,
      },
    });
  }

  test('tls: true aborts before AUTH when the server offers no STARTTLS', async () => {
    const response = await testSmtp({ tls: true });

    expect(response).toMatchObject({
      status: 200,
      body: { data: { success: false, error: 'SMTP STARTTLS nicht verfuegbar' } },
    });
    expect(smtp.commands.some((line) => /^EHLO /i.test(line))).toBe(true);
    expect(smtp.commands.some((line) => /^AUTH /i.test(line))).toBe(false);
  });

  test.each([{}, { tls: false }])('without the TLS switch the test runs as before (%j)', async (extra) => {
    const response = await testSmtp(extra);

    expect(response).toMatchObject({ status: 200, body: { data: { success: true } } });
    expect(smtp.commands.some((line) => /^AUTH PLAIN /i.test(line))).toBe(true);
  });

  test('tls must be a boolean', async () => {
    const response = await testSmtp({ tls: 'yes' });

    expect(response).toMatchObject({ status: 400, body: { error: { code: 'validation_error' } } });
    expect(smtp.commands).toEqual([]);
  });
});
