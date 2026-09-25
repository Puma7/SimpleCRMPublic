import { readFileSync } from 'fs';
import net from 'net';
import path from 'path';
import tls from 'tls';

/**
 * Minimal POP3 server for protocol tests (RFC 1939 + CAPA/STLS from RFC 2449 /
 * RFC 2595). It records every command together with whether it arrived over
 * TLS, so a test can prove USER/PASS never travel in plaintext once STLS is
 * offered. The TLS side uses the self-signed "localhost" fixture of the relay
 * tests; clients connect to host "localhost" and trust it through
 * trustFakePop3Certificate(), so certificate checks stay on.
 */
export type FakePop3Command = Readonly<{ line: string; secure: boolean }>;

export type FakePop3Server = Readonly<{
  port: number;
  commands: FakePop3Command[];
  close(): Promise<void>;
}>;

const TLS_DIR = path.join(__dirname, 'relay-tls');

/** Adds the fixture certificate to the default trusted CAs; returns the undo. */
export function trustFakePop3Certificate(): () => void {
  const previous = tls.getCACertificates('default');
  tls.setDefaultCACertificates([...previous, readFileSync(path.join(TLS_DIR, 'cert.pem'), 'utf8')]);
  return () => tls.setDefaultCACertificates(previous);
}

export async function startFakePop3Server(options: Readonly<{
  offerStls: boolean;
  /** Answer CAPA with -ERR like a server without RFC 2449 support. */
  noCapa?: boolean;
  /** List STLS in CAPA but refuse the STLS command itself. */
  refuseStls?: boolean;
  /** Drop the connection in the middle of the CAPA answer. */
  closeDuringCapa?: boolean;
  messages?: readonly string[];
}>): Promise<FakePop3Server> {
  const commands: FakePop3Command[] = [];
  const sockets = new Set<net.Socket>();
  const messages = options.messages ?? ['Subject: Hallo\r\n\r\nText'];
  const key = readFileSync(path.join(TLS_DIR, 'key.pem'));
  const cert = readFileSync(path.join(TLS_DIR, 'cert.pem'));

  const server = net.createServer((raw) => {
    sockets.add(raw);
    raw.on('close', () => sockets.delete(raw));
    let socket: net.Socket = raw;
    let secure = false;
    let buffer = '';
    const send = (text: string): void => {
      socket.write(text);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('latin1');
      for (;;) {
        const index = buffer.indexOf('\r\n');
        if (index < 0) return;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handle(line);
      }
    };
    const handle = (line: string): void => {
      commands.push({ line, secure });
      const [verb = '', arg] = line.split(' ');
      switch (verb.toUpperCase()) {
        case 'CAPA':
          if (options.noCapa) {
            send('-ERR unknown command\r\n');
            return;
          }
          if (options.closeDuringCapa) {
            socket.end('+OK capability list\r\nUSER\r\n');
            return;
          }
          send(`+OK capability list\r\nUSER\r\nUIDL\r\n${options.offerStls && !secure ? 'STLS\r\n' : ''}.\r\n`);
          return;
        case 'STLS': {
          if (!options.offerStls || secure || options.refuseStls) {
            send('-ERR STLS not available\r\n');
            return;
          }
          send('+OK begin TLS negotiation\r\n');
          socket.off('data', onData);
          buffer = '';
          const upgraded = new tls.TLSSocket(socket, { isServer: true, key, cert });
          upgraded.on('data', onData);
          upgraded.on('error', () => undefined);
          socket = upgraded;
          secure = true;
          return;
        }
        case 'USER':
        case 'PASS':
          send('+OK\r\n');
          return;
        case 'UIDL':
          send(`+OK\r\n${messages.map((_, index) => `${index + 1} uid-${index + 1}`).join('\r\n')}\r\n.\r\n`);
          return;
        case 'RETR': {
          const message = messages[Number(arg) - 1];
          if (message === undefined) {
            send('-ERR no such message\r\n');
            return;
          }
          send(`+OK ${message.length} octets\r\n${message}\r\n.\r\n`);
          return;
        }
        case 'QUIT':
          send('+OK bye\r\n');
          socket.end();
          return;
        default:
          send('-ERR unknown command\r\n');
      }
    };
    raw.on('data', onData);
    raw.on('error', () => undefined);
    send('+OK fake POP3 ready\r\n');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as net.AddressInfo;
  return {
    port: address.port,
    commands,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Commands whose arguments carry credentials, without the credentials. */
export function credentialCommands(commands: readonly FakePop3Command[]): FakePop3Command[] {
  return commands
    .filter((command) => /^(USER|PASS)\b/i.test(command.line))
    .map((command) => ({ line: command.line.split(' ')[0]!, secure: command.secure }));
}
