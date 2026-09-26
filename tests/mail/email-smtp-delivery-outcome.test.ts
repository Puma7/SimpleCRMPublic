import net from 'net';

jest.mock('../../electron/email/email-store', () => ({
  getEmailAccountById: jest.fn(),
}));

jest.mock('../../electron/email/email-keytar', () => ({
  getEmailPassword: jest.fn(async () => 'secret'),
}));

jest.mock('../../electron/email/email-imap-auth', () => ({
  resolveImapAuth: jest.fn(),
}));

import { getEmailAccountById } from '../../electron/email/email-store';
import { sendSmtpForAccount } from '../../electron/email/email-smtp';
import { SmtpDeliveryAmbiguousError } from '../../electron/email/email-smtp-errors';

type ServerMode = 'reject-message' | 'close-after-body' | 'close-at-data';

async function startSmtpServer(mode: ServerMode) {
  const server = net.createServer((socket) => {
    socket.on('error', () => undefined);
    socket.write('220 SMTP ready\r\n');
    let buffer = '';
    let inData = false;
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const idx = buffer.indexOf('\r\n');
        if (idx < 0) break;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line !== '.') continue;
          inData = false;
          if (mode === 'close-after-body') socket.destroy();
          else socket.write('554 5.7.1 rejected by policy\r\n');
          continue;
        }
        if (line.startsWith('EHLO')) socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (line.startsWith('AUTH PLAIN')) socket.write('235 2.7.0 Authentication successful\r\n');
        else if (line.startsWith('MAIL FROM:')) socket.write('250 sender ok\r\n');
        else if (line.startsWith('RCPT TO:')) socket.write('250 recipient ok\r\n');
        else if (line === 'DATA') {
          if (mode === 'close-at-data') {
            socket.destroy();
            return;
          }
          inData = true;
          socket.write('354 end with dot\r\n');
        } else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('500 unknown command\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function sendVia(mode: ServerMode): Promise<unknown> {
  const server = await startSmtpServer(mode);
  (getEmailAccountById as jest.Mock).mockReturnValue({
    id: 1,
    smtp_host: '127.0.0.1',
    smtp_port: server.port,
    smtp_tls: 0,
    imap_username: 'agent@example.com',
    keytar_account_key: 'k',
    smtp_use_imap_auth: 0,
  });
  try {
    await sendSmtpForAccount(1, {
      from: 'agent@example.com',
      to: 'kunde@example.com',
      subject: 'Angebot',
      text: 'Anbei',
    });
    return null;
  } catch (error) {
    return error;
  } finally {
    await server.close();
  }
}

describe('email-smtp delivery outcome', () => {
  // F-A5-02: Ein Verbindungsabbruch nach vollstaendig uebertragener Nachricht war nicht von Fehlern vor DATA unterscheidbar.
  test('connection loss after the message body is an ambiguous delivery', async () => {
    const error = await sendVia('close-after-body');
    expect(error).toBeInstanceOf(SmtpDeliveryAmbiguousError);
  });

  test('explicit SMTP rejection of the message is not ambiguous', async () => {
    const error = await sendVia('reject-message');
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SmtpDeliveryAmbiguousError);
    expect((error as Error).message).toContain('554 5.7.1 rejected by policy');
  });

  test('connection loss before the message body is not ambiguous', async () => {
    const error = await sendVia('close-at-data');
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SmtpDeliveryAmbiguousError);
  });
});
