import tls from 'tls';
import { Socket } from 'net';

type Pop3CommandClass = typeof import(
  'node-pop3',
  { with: { 'resolution-mode': 'require' } }
).default;

const CAPA_MAX_LINES = 1_000;
// Each line just in time still let the CAPA list run for 1000 line timeouts;
// the whole list gets twice the line timeout (as in the server edition).
const CAPA_DEADLINE_FACTOR = 2;
// CAPA/STLS answers are a few short lines: more unread data than this (a line
// without end or a flood) comes from a hostile or broken server.
const MAX_BUFFERED_CHARS = 64 * 1024;
const LISTENER_EVENTS = ['data', 'error', 'close', 'end'] as const;

/**
 * node-pop3 0.11 knows no STLS (RFC 2595). Without implicit TLS it sent
 * USER/PASS in plaintext even when the server offered STLS; the server edition
 * and IMAP upgrade opportunistically (F-A4-05). This subclass runs CAPA after
 * the greeting and, when STLS is listed and accepted, moves node-pop3's socket
 * listeners onto a TLS socket before USER/PASS. Implicit TLS and servers
 * without STLS behave exactly as before.
 *
 * It relies on node-pop3's typed internals (`_connect`, `_socket`,
 * `_PASSInfo`); tests/mail/email-pop3-stls.test.ts runs the real library
 * against a fake POP3 server so an upgrade that changes them fails loudly.
 */
export function withOpportunisticStls(Base: Pop3CommandClass): Pop3CommandClass {
  return class OpportunisticStlsPop3Command extends Base {
    override async _connect(): Promise<string> {
      if (this.tls || this._socket) return super._connect();
      await this.connect();
      await negotiateStls(this);
      await this.command('USER', this.user);
      const [info] = await this.command('PASS', this.password);
      this._PASSInfo = info;
      return info;
    }
  };
}

type Pop3Instance = InstanceType<Pop3CommandClass>;
type SavedListeners = Record<(typeof LISTENER_EVENTS)[number], Array<(...args: unknown[]) => void>>;

async function negotiateStls(pop3: Pop3Instance): Promise<void> {
  const raw = pop3._socket as Socket | null;
  if (!raw) return;
  // node-pop3 cannot read the multi-line CAPA answer, so its listeners step
  // aside while CAPA/STLS run on the raw socket.
  const saved = detachListeners(raw);
  const reader = new RawLineReader(raw, pop3.timeout ?? 90_000);
  let secure: tls.TLSSocket | null = null;
  try {
    if (await offersStls(raw, reader)) {
      raw.write('STLS\r\n');
      if (/^\+OK\b/i.test(await reader.readLine())) {
        reader.dispose();
        secure = await startTls(raw, pop3.servername, pop3.tlsOptions, pop3.timeout ?? 90_000);
      }
    }
  } catch (error) {
    reader.dispose();
    // node-pop3 no longer listens on this socket: drop it, so QUIT does not
    // wait on a dead connection and nothing is sent in plaintext afterwards.
    raw.destroy();
    pop3._socket = null;
    throw error;
  }
  reader.dispose();
  attachListeners(secure ?? raw, saved);
  if (secure) pop3._socket = secure;
}

async function offersStls(raw: Socket, reader: RawLineReader): Promise<boolean> {
  const deadlineAt = reader.responseDeadline();
  raw.write('CAPA\r\n');
  // CAPA is optional (RFC 2449); a server without it answers -ERR.
  if (!/^\+OK\b/i.test(await reader.readLine())) return false;
  let stls = false;
  for (let count = 0; count < CAPA_MAX_LINES; count += 1) {
    const line = await reader.readLine(deadlineAt);
    if (line === '.') return stls;
    if (/^STLS\b/i.test(line)) stls = true;
  }
  throw new Error('POP3 CAPA-Antwort hat zu viele Zeilen');
}

function startTls(
  raw: Socket,
  servername: string,
  tlsOptions: tls.TlsOptions,
  timeoutMs: number,
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ ...(tlsOptions as tls.ConnectionOptions), socket: raw, servername });
    const timer = setTimeout(() => fail(new Error('timeout')), timeoutMs);
    const fail = (error: Error): void => {
      clearTimeout(timer);
      secure.destroy();
      reject(error);
    };
    secure.once('error', fail);
    secure.once('secureConnect', () => {
      clearTimeout(timer);
      secure.off('error', fail);
      resolve(secure);
    });
  });
}

// Node's own stream listeners (e.g. onReadableStreamEnd) stay where they are;
// only the ones node-pop3 added are moved.
let builtInListeners: ReadonlySet<unknown> | null = null;
function isBuiltInListener(listener: unknown): boolean {
  if (!builtInListeners) {
    const pristine = new Socket();
    builtInListeners = new Set(LISTENER_EVENTS.flatMap((event) => pristine.listeners(event)));
    pristine.destroy();
  }
  return builtInListeners.has(listener);
}

function detachListeners(socket: Socket): SavedListeners {
  const saved = {} as SavedListeners;
  for (const event of LISTENER_EVENTS) {
    saved[event] = (socket.listeners(event) as SavedListeners[typeof event])
      .filter((listener) => !isBuiltInListener(listener));
    for (const listener of saved[event]) socket.removeListener(event, listener);
  }
  return saved;
}

function attachListeners(socket: Socket, saved: SavedListeners): void {
  for (const listener of saved.data) socket.on('data', listener);
  for (const listener of saved.error) socket.on('error', listener);
  // node-pop3 registers close/end with once().
  for (const listener of saved.close) socket.once('close', listener);
  for (const listener of saved.end) socket.once('end', listener);
}

/** Reads CRLF lines from the raw socket; drops unread bytes on dispose (RFC 2595 section 4). */
class RawLineReader {
  private buffer = '';
  private waiter: { resolve: (line: string) => void; reject: (error: Error) => void } | null = null;
  private failure: Error | null = null;
  private disposed = false;
  private readonly onData = (chunk: Buffer | string): void => {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('latin1');
    if (this.buffer.length > MAX_BUFFERED_CHARS) {
      this.buffer = '';
      this.fail(new Error('POP3-Serverantwort zu groß'));
      return;
    }
    this.flush();
  };
  private readonly onError = (error: Error): void => this.fail(error);
  private readonly onClose = (): void => this.fail(new Error('close'));

  constructor(private readonly socket: Socket, private readonly timeoutMs: number) {
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  /** End of a whole (multi-line) answer started now. */
  responseDeadline(): number {
    return Date.now() + CAPA_DEADLINE_FACTOR * this.timeoutMs;
  }

  readLine(deadlineAt = Number.POSITIVE_INFINITY): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    const remainingMs = deadlineAt - Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error(remainingMs < this.timeoutMs ? 'Zeitlimit der Server-Antwort überschritten' : 'timeout')),
        Math.min(this.timeoutMs, Math.max(remainingMs, 0)),
      );
      this.waiter = {
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.flush();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.buffer = '';
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
  }

  private flush(): void {
    if (!this.waiter) return;
    const index = this.buffer.indexOf('\n');
    if (index < 0) return;
    const line = this.buffer.slice(0, index).replace(/\r$/, '');
    this.buffer = this.buffer.slice(index + 1);
    const waiter = this.waiter;
    this.waiter = null;
    waiter.resolve(line);
  }

  private fail(error: Error): void {
    this.failure = error;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(error);
  }
}
