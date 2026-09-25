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

  constructor(private readonly options: { starttls?: boolean } = {}) {
    super();
  }

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
        this.emit('data', `${this.options.starttls ? '250-STARTTLS\r\n' : ''}250-AUTH PLAIN LOGIN\r\n250 OK\r\n`);
      } else if (line === 'STARTTLS') {
        this.emit('data', '454 TLS not available right now\r\n');
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

/** Scripted IMAP server: optional STARTTLS capability, rejects LOGIN. */
class FakeImapSocket extends EventEmitter {
  public readonly written: string[] = [];

  constructor(private readonly options: { starttls: boolean }) {
    super();
  }

  setEncoding(): this {
    return this;
  }

  end(): void {}

  destroy(): void {}

  write(chunk: string | Buffer): boolean {
    const line = String(chunk).replace(/\r\n$/, '');
    this.written.push(line);
    const [tag, command] = line.split(' ');
    setTimeout(() => {
      if (command === 'CAPABILITY') {
        const starttls = this.options.starttls ? ' STARTTLS' : '';
        this.emit('data', `* CAPABILITY IMAP4rev1${starttls} AUTH=PLAIN\r\n${tag} OK done\r\n`);
      } else if (command === 'STARTTLS') {
        this.emit('data', `${tag} OK Begin TLS negotiation now\r\n`);
      } else if (command === 'LOGIN') {
        this.emit('data', `${tag} NO denied\r\n`);
      } else {
        this.emit('data', `${tag} OK\r\n`);
      }
    }, 0);
    return true;
  }

  greet(): void {
    setTimeout(() => this.emit('data', '* OK fake IMAP ready\r\n'), 0);
  }
}

/** Server that answers each written line with whatever `respond` returns. */
class ScriptedSocket extends EventEmitter {
  constructor(
    private readonly greeting: string,
    private readonly respond: (line: string) => string,
  ) {
    super();
  }

  setEncoding(): this {
    return this;
  }

  end(): void {}

  destroy(): void {}

  write(chunk: string | Buffer): boolean {
    const reply = this.respond(String(chunk).replace(/\r\n$/, ''));
    setTimeout(() => this.emit('data', reply), 0);
    return true;
  }

  greet(): void {
    setTimeout(() => this.emit('data', this.greeting), 0);
  }
}

/**
 * Server whose answer to the command matched by `trickleOn` never ends: after
 * an optional first line it sends one more line every `everyMs` (fake timers).
 */
class TricklingSocket extends EventEmitter {
  destroyed = false;
  private trickle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly greeting: string,
    private readonly trickleOn: (line: string) => { first?: string; line: string } | null,
    private readonly everyMs: number,
  ) {
    super();
  }

  setEncoding(): this {
    return this;
  }

  end(): void {}

  destroy(): void {
    this.destroyed = true;
    if (this.trickle) clearInterval(this.trickle);
  }

  write(chunk: string | Buffer): boolean {
    const command = String(chunk).replace(/\r\n$/, '');
    const trickle = this.trickleOn(command);
    setTimeout(() => {
      if (this.destroyed) return;
      if (!trickle) {
        this.emit('data', /^\w+\d+ /.test(command) ? `${command.split(' ')[0]} OK\r\n` : '250 OK\r\n');
        return;
      }
      if (trickle.first) this.emit('data', trickle.first);
      this.trickle = setInterval(() => this.emit('data', trickle.line), this.everyMs);
    }, 0);
    return true;
  }

  greet(): void {
    setTimeout(() => this.emit('data', this.greeting), 0);
  }
}

function scriptedPort(socket: ScriptedSocket) {
  return createServerMailConnectionTestPort({
    socketFactory: (async () => {
      socket.greet();
      return socket;
    }) as never,
    timeoutMs: 500,
  });
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
    })).resolves.toEqual({ success: false, error: 'stop after input resolution' });

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

  // F-A4-03: the stored-account SMTP test treated smtp_tls as implicit TLS on
  // every port; with the default 587/TLS it sent a TLS ClientHello to a
  // plaintext SMTP port instead of using STARTTLS like the real send does.
  test('stored SMTP TLS on port 587 connects in plaintext and requires STARTTLS before AUTH', async () => {
    const socket = new FakeSmtpSocket({ starttls: true });
    let socketInput: { host: string; port: number; tls: boolean } | null = null;
    const port = createServerMailConnectionTestPort({
      db: dbReturning({ ...storedAccountRow(), smtp_port: 587, smtp_tls: true }) as never,
      secrets: { readSecret: async () => Buffer.from('stored-secret') } as never,
      socketFactory: (async (input: { host: string; port: number; tls: boolean }) => {
        socketInput = input;
        socket.greet();
        return socket;
      }) as never,
      timeoutMs: 1234,
    });

    const result = await port.testSmtp({
      workspaceId: 'workspace-a',
      accountId: 7,
      host: 'x',
      port: 25,
      tls: false,
      user: '',
    });

    expect(socketInput).toEqual(expect.objectContaining({ host: 'smtp.saved.example', port: 587, tls: false }));
    expect(socket.written).toContain('STARTTLS');
    expect(socket.written.some((line) => line.startsWith('AUTH'))).toBe(false);
    expect(result).toEqual({ success: false, error: '454 TLS not available right now' });
  });

  test('stored SMTP TLS on port 587 refuses AUTH when the server offers no STARTTLS', async () => {
    const socket = new FakeSmtpSocket();
    const port = createServerMailConnectionTestPort({
      db: dbReturning({ ...storedAccountRow(), smtp_port: 587, smtp_tls: true }) as never,
      secrets: { readSecret: async () => Buffer.from('stored-secret') } as never,
      socketFactory: (async () => {
        socket.greet();
        return socket;
      }) as never,
      timeoutMs: 1234,
    });

    const result = await port.testSmtp({
      workspaceId: 'workspace-a',
      accountId: 7,
      host: 'x',
      port: 25,
      tls: false,
      user: '',
    });

    expect(result).toEqual({ success: false, error: 'SMTP STARTTLS nicht verfuegbar' });
    expect(socket.written.some((line) => line.startsWith('AUTH'))).toBe(false);
  });

  // F-A4-04: a failing connect (DNS, refused, TLS certificate, timeout) was
  // awaited outside the try block, so the route answered HTTP 500 instead of
  // returning the connection error to the settings UI.
  test.each(['testImap', 'testPop3', 'testSmtp'] as const)('%s reports a failed connect as a test result', async (method) => {
    const port = createServerMailConnectionTestPort({
      socketFactory: (async () => {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND nicht-existent.invalid'), { code: 'ENOTFOUND' });
      }) as never,
      timeoutMs: 50,
    });

    await expect(port[method]({
      workspaceId: 'workspace-a',
      host: 'nicht-existent.invalid',
      port: 993,
      tls: true,
      user: 'a@example.com',
      password: 'x',
    })).resolves.toEqual({ success: false, error: 'getaddrinfo ENOTFOUND nicht-existent.invalid' });
  });

  // F-A4-05: without implicit TLS the IMAP test sent LOGIN with the (stored)
  // password in plaintext, while the sync (ImapFlow, secure=false) upgrades
  // via STARTTLS whenever the server offers it.
  test('IMAP test without TLS upgrades via STARTTLS before sending LOGIN', async () => {
    const socket = new FakeImapSocket({ starttls: true });
    const port = createServerMailConnectionTestPort({
      db: dbReturning({ ...storedAccountRow(), imap_port: 143, imap_tls: false }) as never,
      secrets: { readSecret: async () => Buffer.from('stored-secret') } as never,
      socketFactory: (async () => {
        socket.greet();
        return socket;
      }) as never,
      timeoutMs: 1234,
    });

    const result = await port.testImap({
      workspaceId: 'workspace-a',
      accountId: 7,
      host: 'x',
      port: 143,
      tls: false,
      user: '',
    });

    expect(result.success).toBe(false);
    expect(socket.written.map((line) => line.split(' ')[1])).toEqual(['CAPABILITY', 'STARTTLS']);
    expect(socket.written.join('\n')).not.toContain('stored-secret');
  });

  test('IMAP test without TLS logs in like the sync when the server offers no STARTTLS', async () => {
    const socket = new FakeImapSocket({ starttls: false });
    const port = createServerMailConnectionTestPort({
      socketFactory: (async () => {
        socket.greet();
        return socket;
      }) as never,
      timeoutMs: 1234,
    });

    const result = await port.testImap({
      workspaceId: 'workspace-a',
      host: 'imap.example.com',
      port: 143,
      tls: false,
      user: 'user@example.com',
      password: 'typed',
    });

    expect(result).toEqual({ success: false, error: expect.stringMatching(/ NO denied$/) });
    expect(socket.written.map((line) => line.split(' ')[1])).toEqual(['CAPABILITY', 'LOGIN']);
  });

  // F-A4-06: the line client buffered without limit and looped over untagged or
  // continuation lines forever, so a hostile mail server could grow memory
  // (one endless line) or keep the test busy (endless response lines).
  test('SMTP test stops at an oversized server line instead of buffering it', async () => {
    const socket = new ScriptedSocket(`220 ${'x'.repeat(200 * 1024)}`, () => '');

    await expect(scriptedPort(socket).testSmtp({
      workspaceId: 'workspace-a',
      host: 'smtp.example.com',
      port: 465,
      tls: true,
      user: 'user@example.com',
      password: 'typed',
    })).resolves.toEqual({ success: false, error: 'Server-Antwort zu gross' });
  });

  test('SMTP test stops at a response with too many continuation lines', async () => {
    const socket = new ScriptedSocket('220 ready\r\n', (line) => (
      line.startsWith('EHLO') ? '250-x\r\n'.repeat(1500) : '250 OK\r\n'
    ));

    await expect(scriptedPort(socket).testSmtp({
      workspaceId: 'workspace-a',
      host: 'smtp.example.com',
      port: 465,
      tls: true,
      user: 'user@example.com',
      password: 'typed',
    })).resolves.toEqual({ success: false, error: 'Server-Antwort hat zu viele Zeilen' });
  });

  test('IMAP test stops at a command answered with too many untagged lines', async () => {
    const socket = new ScriptedSocket('* OK ready\r\n', (line) => (
      line.startsWith('a001 LOGIN') ? '* x\r\n'.repeat(1500) : `${line.split(' ')[0]} OK\r\n`
    ));

    await expect(scriptedPort(socket).testImap({
      workspaceId: 'workspace-a',
      host: 'imap.example.com',
      port: 993,
      tls: true,
      user: 'user@example.com',
      password: 'typed',
    })).resolves.toEqual({ success: false, error: 'Server-Antwort hat zu viele Zeilen' });
  });
});

// C-A81: the connection test bounded only each line (25 s) and the line count,
// so a server answering with one line every 24 s kept a test busy for hours.
describe('server mail connection test response deadline', () => {
  const timeoutMs = 10_000;
  const trickleEveryMs = timeoutMs - 1_000;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function runUntilDeadline(
    socket: TricklingSocket,
    run: (port: ReturnType<typeof createServerMailConnectionTestPort>) => Promise<unknown>,
  ) {
    const port = createServerMailConnectionTestPort({
      socketFactory: (async () => {
        socket.greet();
        return socket;
      }) as never,
      timeoutMs,
    });
    const outcome: { result?: unknown } = {};
    void run(port).then((result) => { outcome.result = result; });
    // Twice the line timeout per response: still running shortly before, done right after.
    await jest.advanceTimersByTimeAsync(2 * timeoutMs - 1_000);
    expect(outcome.result).toBeUndefined();
    await jest.advanceTimersByTimeAsync(2_000);
    return outcome.result;
  }

  test('IMAP test gives up on a command whose untagged lines never end', async () => {
    const socket = new TricklingSocket(
      '* OK ready\r\n',
      (line) => (line.startsWith('a001 LOGIN') ? { line: '* x\r\n' } : null),
      trickleEveryMs,
    );

    await expect(runUntilDeadline(socket, (port) => port.testImap({
      workspaceId: 'workspace-a',
      host: 'imap.example.com',
      port: 993,
      tls: true,
      user: 'user@example.com',
      password: 'typed',
    }))).resolves.toEqual({ success: false, error: 'Zeitlimit der Server-Antwort ueberschritten' });
    expect(socket.destroyed).toBe(true);
  });

  test('SMTP test gives up on a reply whose continuation lines never end', async () => {
    const socket = new TricklingSocket(
      '220 ready\r\n',
      (line) => (line.startsWith('EHLO') ? { line: '250-x\r\n' } : null),
      trickleEveryMs,
    );

    await expect(runUntilDeadline(socket, (port) => port.testSmtp({
      workspaceId: 'workspace-a',
      host: 'smtp.example.com',
      port: 465,
      tls: true,
      user: 'user@example.com',
      password: 'typed',
    }))).resolves.toEqual({ success: false, error: 'Zeitlimit der Server-Antwort ueberschritten' });
    expect(socket.destroyed).toBe(true);
  });

  test('POP3 test gives up on a CAPA list that never ends', async () => {
    const socket = new TricklingSocket(
      '+OK ready\r\n',
      (line) => (line === 'CAPA' ? { first: '+OK capability list\r\n', line: 'X-FILLER\r\n' } : null),
      trickleEveryMs,
    );

    await expect(runUntilDeadline(socket, (port) => port.testPop3({
      workspaceId: 'workspace-a',
      host: 'pop.example.com',
      port: 110,
      tls: false,
      user: 'user@example.com',
      password: 'typed',
    }))).resolves.toEqual({ success: false, error: 'Zeitlimit der Server-Antwort ueberschritten' });
    expect(socket.destroyed).toBe(true);
  });
});
