/**
 * @jest-environment node
 */
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
