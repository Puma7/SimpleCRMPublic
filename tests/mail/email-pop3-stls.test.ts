import { EventEmitter } from 'node:events';

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
const { withOpportunisticStls } = require('../../electron/email/pop3-stls') as typeof import('../../electron/email/pop3-stls');

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

/**
 * Plaintext POP3 socket for fake-timer tests: after CAPA it sends "+OK" and
 * then `trickle` every `everyMs` until the client drops the connection (or a
 * safety stop after `maxChunks`, so an unbounded client cannot fill the test).
 */
class TricklingCapaSocket extends EventEmitter {
  destroyed = false;
  chunks = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly trickle: string, private readonly everyMs: number, private readonly maxChunks: number) {
    super();
  }

  write(chunk: string): boolean {
    if (chunk !== 'CAPA\r\n') return true;
    setTimeout(() => {
      if (this.destroyed) return;
      this.emit('data', Buffer.from('+OK capability list\r\n', 'latin1'));
      this.timer = setInterval(() => {
        if (this.destroyed || this.chunks >= this.maxChunks) return;
        this.chunks += 1;
        this.emit('data', Buffer.from(this.trickle, 'latin1'));
      }, this.everyMs);
    }, 0);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
  }
}

/** Stand-in for node-pop3's Command with just the internals the STLS subclass uses. */
function fakePop3Command(socket: TricklingCapaSocket, timeoutMs: number) {
  const commands: string[] = [];
  class FakeCommand {
    tls = false;
    _socket: unknown = null;
    _PASSInfo = '';
    timeout = timeoutMs;
    servername = 'pop.example.test';
    tlsOptions = {};
    user = 'kunde@example.test';
    password = 'geheim';
    async connect(): Promise<void> {
      this._socket = socket;
    }
    async command(name: string): Promise<[string]> {
      commands.push(name);
      return ['+OK'];
    }
    async _connect(): Promise<string> {
      return '+OK';
    }
  }
  const Stls = withOpportunisticStls(FakeCommand as never);
  return { pop3: new Stls({} as never), commands };
}

// N-cx-08: while CAPA/STLS ran on the raw socket, the desktop line reader
// buffered without limit (searching the whole buffer on every chunk) and had
// only a per-line timeout, so a CAPA list with one line just in time ran for
// up to 1000 line timeouts; the server edition bounds both.
describe('desktop POP3 STLS negotiation bounds the CAPA answer', () => {
  const timeoutMs = 10_000;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function settleBetween(promise: Promise<unknown>, stillRunningAfterMs: number, doneByMs: number) {
    const outcome: { settled: boolean; error?: unknown } = { settled: false };
    promise.then(
      () => { outcome.settled = true; },
      (error: unknown) => { outcome.settled = true; outcome.error = error; },
    );
    await jest.advanceTimersByTimeAsync(stillRunningAfterMs);
    expect(outcome.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(doneByMs - stillRunningAfterMs);
    expect(outcome.settled).toBe(true);
    return outcome.error;
  }

  test('gives up on a CAPA list that never ends after twice the line timeout', async () => {
    const socket = new TricklingCapaSocket('X-FILLER\r\n', timeoutMs - 1_000, 10_000);
    const { pop3, commands } = fakePop3Command(socket, timeoutMs);

    const error = await settleBetween(pop3._connect(), 2 * timeoutMs - 1_000, 2 * timeoutMs + 1_000);

    expect(error).toEqual(new Error('Zeitlimit der Server-Antwort überschritten'));
    expect(socket.destroyed).toBe(true);
    expect(commands).toEqual([]);
  });

  test('drops a CAPA line without end right away instead of buffering it', async () => {
    const socket = new TricklingCapaSocket('A'.repeat(16 * 1024), 1, 256);
    const { pop3, commands } = fakePop3Command(socket, timeoutMs);

    const error = await settleBetween(pop3._connect(), 0, 100);

    expect(error).toEqual(new Error('POP3-Serverantwort zu groß'));
    expect(socket.destroyed).toBe(true);
    // 64 KiB line limit: at most five 16 KiB chunks were taken in.
    expect(socket.chunks).toBeLessThanOrEqual(5);
    expect(commands).toEqual([]);
  });
});
