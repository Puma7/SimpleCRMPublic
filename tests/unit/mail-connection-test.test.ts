import { EventEmitter } from 'node:events';

const mockWithWorkspaceTransaction = jest.fn(async (
  db: unknown,
  _context: unknown,
  operation: (trx: unknown) => Promise<unknown>,
) => operation(db));

jest.mock('../../packages/server/src/db/workspace-context', () => ({
  withWorkspaceTransaction: (...args: unknown[]) => mockWithWorkspaceTransaction(...args),
}));

import { createServerMailConnectionTestPort } from '../../packages/server/src/mail-connection-test';

/** Scripted SMTP server: greets, offers AUTH PLAIN, rejects the AUTH attempt. */
class FakeSmtpSocket extends EventEmitter {
  public readonly written: string[] = [];

  setEncoding(): this {
    return this;
  }

  end(): void {}

  destroy(): void {}

  write(chunk: string | Buffer): boolean {
    const line = String(chunk).replace(/\r\n$/, '');
    this.written.push(line);
    setTimeout(() => {
      if (line.startsWith('EHLO')) {
        this.emit('data', '250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
      } else if (line.startsWith('AUTH PLAIN')) {
        this.emit('data', '535 denied\r\n');
      } else if (line.startsWith('QUIT')) {
        this.emit('data', '221 bye\r\n');
      } else {
        this.emit('data', '250 OK\r\n');
      }
    }, 0);
    return true;
  }

  greet(): void {
    setTimeout(() => this.emit('data', '220 fake ready\r\n'), 0);
  }
}

function storedAccountRow() {
  return {
    id: 7,
    imap_host: 'imap.saved.example',
    imap_port: 993,
    imap_tls: true,
    imap_username: 'saved-imap@example.com',
    smtp_host: 'smtp.saved.example',
    smtp_port: 465,
    smtp_tls: true,
    smtp_username: 'saved-smtp@example.com',
    smtp_use_imap_auth: false,
    oauth_provider: null,
    pop3_host: null,
    pop3_port: null,
    pop3_tls: null,
  };
}

function dbReturning(account: unknown) {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.where = jest.fn(() => query);
  query.executeTakeFirst = jest.fn(async () => account);
  return { selectFrom: jest.fn(() => query) };
}

describe('server mail connection test stored credentials', () => {
  test('uses the stored SMTP TLS mode together with stored host and port', async () => {
    const db = dbReturning(storedAccountRow());
    let socketInput: { host: string; port: number; tls: boolean; timeoutMs: number } | null = null;
    const socketFactory = jest.fn(async (input) => {
      socketInput = input;
      throw new Error('stop after input resolution');
    });
    const port = createServerMailConnectionTestPort({
      db: db as never,
      secrets: {
        readSecret: async () => Buffer.from('stored-secret'),
      } as never,
      socketFactory: socketFactory as never,
      timeoutMs: 1234,
    });

    await expect(port.testSmtp({
      workspaceId: 'workspace-a',
      accountId: 7,
      host: 'attacker.example',
      port: 25,
      tls: false,
      user: '',
    })).rejects.toThrow('stop after input resolution');

    expect(socketInput).toEqual(expect.objectContaining({
      host: 'smtp.saved.example',
      port: 465,
      tls: true,
      timeoutMs: 1234,
    }));
  });

  test('stored credentials bind the AUTH identity and secret to the account', async () => {
    const socket = new FakeSmtpSocket();
    const readSecretKinds: string[] = [];
    const port = createServerMailConnectionTestPort({
      db: dbReturning(storedAccountRow()) as never,
      secrets: {
        readSecret: async (identifier: { kind: string }) => {
          readSecretKinds.push(identifier.kind);
          return identifier.kind === 'email.account.smtp_password'
            ? Buffer.from('smtp-stored-secret')
            : Buffer.from('imap-stored-secret');
        },
      } as never,
      socketFactory: (async () => {
        socket.greet();
        return socket;
      }) as never,
      timeoutMs: 1234,
    });

    // Request tries to redirect the AUTH identity and flip the secret source;
    // the stored-credential path must ignore user + smtpUseImapAuth.
    const result = await port.testSmtp({
      workspaceId: 'workspace-a',
      accountId: 7,
      host: 'attacker.example',
      port: 25,
      tls: false,
      user: 'attacker@evil.example',
      smtpUseImapAuth: true,
    });

    expect(result.success).toBe(false);
    const authLine = socket.written.find((line) => line.startsWith('AUTH PLAIN '));
    expect(authLine).toBeDefined();
    const decoded = Buffer.from(authLine!.slice('AUTH PLAIN '.length), 'base64').toString('utf8');
    expect(decoded).toBe('\u0000saved-smtp@example.com\u0000smtp-stored-secret');
    expect(readSecretKinds[0]).toBe('email.account.smtp_password');
  });

  test('explicit password keeps the ad-hoc request identity and host', async () => {
    const socket = new FakeSmtpSocket();
    const readSecret = jest.fn(async () => Buffer.from('should-not-be-read'));
    let socketHost = '';
    const port = createServerMailConnectionTestPort({
      db: dbReturning(storedAccountRow()) as never,
      secrets: { readSecret } as never,
      socketFactory: (async (input: { host: string }) => {
        socketHost = input.host;
        socket.greet();
        return socket;
      }) as never,
      timeoutMs: 1234,
    });

    const result = await port.testSmtp({
      workspaceId: 'workspace-a',
      accountId: 7,
      host: 'custom.example',
      port: 587,
      tls: true,
      user: 'adhoc@example.com',
      password: 'my-pass',
    });

    expect(result.success).toBe(false);
    expect(socketHost).toBe('custom.example');
    const authLine = socket.written.find((line) => line.startsWith('AUTH PLAIN '));
    expect(authLine).toBeDefined();
    const decoded = Buffer.from(authLine!.slice('AUTH PLAIN '.length), 'base64').toString('utf8');
    expect(decoded).toBe('\u0000adhoc@example.com\u0000my-pass');
    expect(readSecret).not.toHaveBeenCalled();
  });
});
