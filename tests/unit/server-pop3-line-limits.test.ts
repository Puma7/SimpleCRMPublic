/**
 * @jest-environment node
 */
import { EventEmitter } from 'node:events';
import net from 'net';

import { MAX_INBOUND_RFC822_BYTES } from '../../packages/core/src/email/inbound-message-size';
import { createDefaultPop3Client } from '../../packages/server/src/mail-sync';
import { startFakePop3Server, type FakePop3Server } from '../fixtures/fake-pop3-server';

type RawPop3Server = Readonly<{
  port: number;
  /** Resolves when the client side closed or dropped the connection. */
  clientGone: Promise<void>;
  close(): Promise<void>;
}>;

/** Plain TCP server that sends `greeting` in 64 KiB writes and answers commands via `respond`. */
async function startRawPop3Server(
  greeting: string,
  respond: (line: string) => string = () => '+OK\r\n',
): Promise<RawPop3Server> {
  const sockets = new Set<net.Socket>();
  let markGone: () => void = () => undefined;
  const clientGone = new Promise<void>((resolve) => { markGone = resolve; });
  const server = net.createServer((socket) => {
    sockets.add(socket);
    // The client may drop the connection while we are still writing.
    socket.on('error', () => undefined);
    socket.on('close', () => {
      sockets.delete(socket);
      markGone();
    });
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      for (let index = buffer.indexOf('\r\n'); index >= 0; index = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        socket.write(respond(line), 'latin1');
      }
    });
    for (let offset = 0; offset < greeting.length; offset += 64 * 1024) {
      socket.write(greeting.slice(offset, offset + 64 * 1024), 'latin1');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as net.AddressInfo;
  return {
    port: address.port,
    clientGone,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function pop3Client(port: number) {
  return createDefaultPop3Client({
    host: '127.0.0.1',
    port,
    tls: false,
    user: 'kunde@example.test',
    password: 'geheim',
    // Far beyond the test timeout: a rejection must come from the size limit.
    timeoutMs: 60_000,
  });
}

const stillWaiting = (ms: number) => new Promise<'noch wartend'>((resolve) => {
  setTimeout(() => resolve('noch wartend'), ms).unref();
});

let raw: RawPop3Server | null = null;
let fake: FakePop3Server | null = null;
// Closing the server side first also ends a client still waiting for a line.
async function closeRawServer(): Promise<void> {
  await raw?.close();
  raw = null;
}
afterEach(async () => {
  await closeRawServer();
  await fake?.close();
  fake = null;
});

// C-A80: the POP3 sync client buffered a line without end and without limit
// (searching the whole buffer again for every chunk), and a flood of lines
// nobody read grew the buffer without bound; only the 90 s line timeout ended it.
describe('server POP3 sync client bounds what it buffers', () => {
  test('rejects an endless unterminated line right away and drops the connection', async () => {
    raw = await startRawPop3Server('A'.repeat(2 * 1024 * 1024));
    const client = pop3Client(raw.port);
    try {
      await expect(Promise.race([client.connect(), stillWaiting(3_000)]))
        .rejects.toThrow('POP3-Serverantwort zu gross');
      await expect(Promise.race([raw.clientGone.then(() => 'getrennt'), stillWaiting(3_000)]))
        .resolves.toBe('getrennt');
    } finally {
      await closeRawServer();
      await client.quit();
    }
  });

  test('drops the connection once unread lines exceed the buffer limit', async () => {
    const line = `${'x'.repeat(1022)}\r\n`;
    const flood = line.repeat(Math.ceil((MAX_INBOUND_RFC822_BYTES + 4 * 1024 * 1024) / line.length));
    raw = await startRawPop3Server('+OK ready\r\n', (command) => {
      if (command === 'CAPA') return '-ERR unknown command\r\n';
      // Right behind the PASS reply, the server floods lines the client never asked for.
      return command.startsWith('PASS ') ? `+OK\r\n${flood}` : '+OK\r\n';
    });
    const client = pop3Client(raw.port);
    try {
      await client.connect();
      await expect(Promise.race([raw.clientGone.then(() => 'getrennt'), stillWaiting(10_000)]))
        .resolves.toBe('getrennt');
      await expect(client.uidl()).rejects.toThrow();
    } finally {
      await closeRawServer();
      await client.quit();
    }
  }, 30_000);

  test('still reads long but finite lines and large messages completely', async () => {
    const longLine = 'L'.repeat(900 * 1024);
    const bigMessage = `Subject: Gross\r\n\r\n${`${'x'.repeat(76)}\r\n`.repeat(70_000)}Ende`;
    const bareLf = 'Subject: LF\n\nZeile 1\nZeile 2';
    const mixed = 'Subject: Gemischt\r\n\r\nA\nB\r\nC';
    fake = await startFakePop3Server({
      offerStls: false,
      messages: [`Subject: Lang\r\n\r\n${longLine}`, bigMessage, bareLf, mixed],
    });
    const client = pop3Client(fake.port);
    try {
      await client.connect();
      expect(await client.uidl()).toEqual([[1, 'uid-1'], [2, 'uid-2'], [3, 'uid-3'], [4, 'uid-4']]);
      expect((await client.retr(1)).toString('latin1')).toBe(`Subject: Lang\r\n\r\n${longLine}`);
      expect((await client.retr(2)).toString('latin1')).toBe(bigMessage);
      expect((await client.retr(3)).toString('latin1')).toBe(bareLf);
      expect((await client.retr(4)).toString('latin1')).toBe(mixed);
    } finally {
      await client.quit();
    }
  }, 30_000);
});

type Pop3Reply = string | { first: string; line: string; everyMs: number };

/**
 * In-memory POP3 server socket for fake-timer tests, handed to the client via
 * net.connect: `respond` answers each command with a reply or with a first line
 * followed by a trickle of lines that never ends.
 */
class TricklingPop3Socket extends EventEmitter {
  destroyed = false;
  private trickle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly respond: (command: string) => Pop3Reply) {
    super();
    setTimeout(() => this.emit('connect'), 0);
    setTimeout(() => this.emit('data', '+OK ready\r\n'), 1);
  }

  setEncoding(): this {
    return this;
  }

  setTimeout(): this {
    return this;
  }

  end(): void {}

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.trickle) clearInterval(this.trickle);
  }

  write(chunk: string | Buffer): boolean {
    const reply = this.respond(String(chunk).replace(/\r\n$/, ''));
    setTimeout(() => {
      if (this.destroyed) return;
      if (typeof reply === 'string') {
        this.emit('data', reply);
        return;
      }
      this.emit('data', reply.first);
      this.trickle = setInterval(() => this.emit('data', reply.line), reply.everyMs);
    }, 0);
    return true;
  }
}

// N-cx-07: CAPA, UIDL and RETR of the POP3 sync client were bounded only per
// line (90 s); a server sending one line just in time kept a sync job busy
// indefinitely (C-A68/C-A81 gave the other line clients a response deadline).
describe('server POP3 sync client response deadline', () => {
  const timeoutMs = 10_000;
  const trickleEveryMs = timeoutMs - 1_000;
  const MINUTE = 60_000;

  let socket: TricklingPop3Socket | null = null;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    socket?.destroy();
    socket = null;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function trickleClient(respond: (command: string) => Pop3Reply) {
    jest.spyOn(net, 'connect').mockImplementation((() => {
      socket = new TricklingPop3Socket(respond);
      return socket;
    }) as never);
    return createDefaultPop3Client({
      host: 'pop.example.test',
      port: 110,
      tls: false,
      user: 'kunde@example.test',
      password: 'geheim',
      timeoutMs,
    });
  }

  /** Runs `promise` for `stillRunningAfterMs`, then until `doneByMs`; returns how it settled. */
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
    const client = trickleClient((command) => (command === 'CAPA'
      ? { first: '+OK capability list\r\n', line: 'X-FILLER\r\n', everyMs: trickleEveryMs }
      : '+OK\r\n'));

    const error = await settleBetween(client.connect(), 2 * timeoutMs - 1_000, 2 * timeoutMs + 1_000);

    expect(error).toEqual(new Error('Zeitlimit der Server-Antwort ueberschritten'));
    expect(socket?.destroyed).toBe(true);
  });

  test.each([
    ['UIDL', (client: ReturnType<typeof createDefaultPop3Client>) => client.uidl(), '1 uid-1\r\n'],
    ['RETR 1', (client: ReturnType<typeof createDefaultPop3Client>) => client.retr(1), 'Zeile\r\n'],
  ])('gives up on a %s answer that never ends, but only after a generous deadline', async (command, run, line) => {
    const client = trickleClient((received) => (received === command
      ? { first: '+OK\r\n', line, everyMs: trickleEveryMs }
      : received === 'CAPA' ? '-ERR unknown command\r\n' : '+OK\r\n'));
    const connected = client.connect();
    await jest.advanceTimersByTimeAsync(10);
    await connected;

    // A slow but steady answer (a large message) keeps loading far beyond the
    // line timeout; only a trickle that outlasts the whole deadline is cut off.
    const error = await settleBetween(run(client), 40 * MINUTE, 45 * MINUTE);

    expect(error).toEqual(new Error('Zeitlimit der Server-Antwort ueberschritten'));
    expect(socket?.destroyed).toBe(true);
  });

  test('keeps the per-line timeout for a server that stops answering', async () => {
    const client = trickleClient((command) => (command === 'CAPA'
      ? '-ERR unknown command\r\n'
      : command === 'RETR 1' ? '+OK\r\nZeile\r\n' : '+OK\r\n'));
    const connected = client.connect();
    await jest.advanceTimersByTimeAsync(10);
    await connected;

    const error = await settleBetween(client.retr(1), timeoutMs - 1_000, timeoutMs + 1_000);

    expect(error).toEqual(new Error('Connection timed out'));
  });
});
