import net from 'node:net';
import tls from 'node:tls';

export type SmtpSocketFactory = (input: {
  host: string;
  port: number;
  tls: boolean;
  timeoutMs: number;
}) => Promise<net.Socket>;

export type ServerSmtpSendInput = Readonly<{
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password?: string;
  accessToken?: string;
  envelopeFrom: string;
  recipients: readonly string[];
  rfc822: string;
  timeoutMs?: number;
  socketFactory?: SmtpSocketFactory;
}>;

const DEFAULT_TIMEOUT_MS = 90_000;

export async function sendSmtpMessage(input: ServerSmtpSendInput): Promise<void> {
  const unsafe = validateCommandValue(input.user, 'Benutzername')
    ?? (input.password === undefined ? null : validateCommandValue(input.password, 'Passwort'))
    ?? validatePathAddress(input.envelopeFrom, 'Absender')
    ?? validateRecipients(input.recipients);
  if (unsafe) throw new Error(unsafe);
  if (input.password === undefined && !input.accessToken) {
    throw new Error('SMTP-Auth-Daten fehlen');
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const secureSocket = input.tls && input.port === 465;
  const requireStartTls = input.tls && input.port !== 465;
  const socketFactory = input.socketFactory ?? connectSocket;
  const socket = await socketFactory({
    host: input.host,
    port: input.port,
    tls: secureSocket,
    timeoutMs,
  });
  const client = new LineProtocolClient(socket, timeoutMs);
  try {
    let response = await readSmtpResponse(client);
    if (response.code !== 220) throw new Error(response.text);

    response = await smtpEhlo(client);
    if (response.code !== 250) throw new Error(response.text);

    if (!secureSocket && (requireStartTls || smtpSupports(response, 'STARTTLS'))) {
      if (!smtpSupports(response, 'STARTTLS')) throw new Error('SMTP STARTTLS nicht verfuegbar');
      response = await smtpCommand(client, 'STARTTLS');
      if (response.code !== 220) throw new Error(response.text);
      await upgradeClientToTls(client, input.host, timeoutMs);
      response = await smtpEhlo(client);
      if (response.code !== 250) throw new Error(response.text);
    }

    const auth = await smtpAuthenticate(client, response, {
      user: input.user,
      password: input.password,
      accessToken: input.accessToken,
    });
    if (auth.code !== 235) throw new Error(auth.text);

    response = await smtpCommand(client, `MAIL FROM:<${input.envelopeFrom}>`);
    if (response.code !== 250) throw new Error(response.text);

    for (const recipient of input.recipients) {
      response = await smtpCommand(client, `RCPT TO:<${recipient}>`);
      if (response.code !== 250 && response.code !== 251) throw new Error(response.text);
    }

    response = await smtpCommand(client, 'DATA');
    if (response.code !== 354) throw new Error(response.text);
    client.writeData(dotStuff(input.rfc822));
    response = await readSmtpResponse(client);
    if (response.code !== 250) throw new Error(response.text);

    await smtpCommand(client, 'QUIT').catch(() => undefined);
  } finally {
    client.close();
  }
}

type SmtpResponse = Readonly<{
  code: number;
  lines: readonly string[];
  text: string;
}>;

async function smtpEhlo(client: LineProtocolClient): Promise<SmtpResponse> {
  return smtpCommand(client, 'EHLO simplecrm.local');
}

async function smtpCommand(client: LineProtocolClient, command: string): Promise<SmtpResponse> {
  client.writeLine(command);
  return readSmtpResponse(client);
}

async function readSmtpResponse(client: LineProtocolClient): Promise<SmtpResponse> {
  const lines: string[] = [];
  for (;;) {
    const line = await client.readLine();
    lines.push(line);
    const match = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!match) return { code: 0, lines, text: line };
    if (match[2] === ' ') {
      return {
        code: Number(match[1]),
        lines,
        text: lines.join('\n'),
      };
    }
  }
}

function smtpSupports(response: SmtpResponse, extension: string): boolean {
  const needle = extension.toUpperCase();
  return response.lines.some((line) => {
    const match = /^\d{3}[ -](.*)$/.exec(line);
    if (!match) return false;
    const [keyword] = match[1].trim().split(/\s+/, 1);
    return keyword?.toUpperCase() === needle;
  });
}

function smtpAuthMechanisms(response: SmtpResponse): Set<string> {
  const mechanisms = new Set<string>();
  for (const line of response.lines) {
    const match = /^\d{3}[ -]AUTH(?:[ =](.*))?$/i.exec(line.trim());
    if (!match) continue;
    for (const mechanism of (match[1] ?? '').split(/\s+/)) {
      if (mechanism) mechanisms.add(mechanism.toUpperCase());
    }
  }
  return mechanisms;
}

async function smtpAuthenticate(
  client: LineProtocolClient,
  ehloResponse: SmtpResponse,
  input: { user: string; password?: string; accessToken?: string },
): Promise<SmtpResponse> {
  const mechanisms = smtpAuthMechanisms(ehloResponse);
  if (input.accessToken) {
    if (!mechanisms.has('XOAUTH2')) {
      return {
        code: 504,
        lines: ['504 AUTH XOAUTH2 not supported by SMTP server'],
        text: '504 AUTH XOAUTH2 not supported by SMTP server',
      };
    }
    const token = Buffer.from(`user=${input.user}\u0001auth=Bearer ${input.accessToken}\u0001\u0001`, 'utf8')
      .toString('base64');
    return smtpCommand(client, `AUTH XOAUTH2 ${token}`);
  }

  if (input.password === undefined) {
    return {
      code: 504,
      lines: ['504 SMTP password missing'],
      text: '504 SMTP password missing',
    };
  }

  if (mechanisms.has('PLAIN')) {
    const token = Buffer.from(`\u0000${input.user}\u0000${input.password}`, 'utf8').toString('base64');
    return smtpCommand(client, `AUTH PLAIN ${token}`);
  }

  if (mechanisms.size > 0 && !mechanisms.has('LOGIN')) {
    return {
      code: 504,
      lines: ['504 AUTH mechanism not supported by SimpleCRM server sender'],
      text: '504 AUTH mechanism not supported by SimpleCRM server sender',
    };
  }

  let response = await smtpCommand(client, 'AUTH LOGIN');
  if (response.code !== 334) return response;
  response = await smtpCommand(client, Buffer.from(input.user, 'utf8').toString('base64'));
  if (response.code !== 334) return response;
  return smtpCommand(client, Buffer.from(input.password, 'utf8').toString('base64'));
}

async function upgradeClientToTls(
  client: LineProtocolClient,
  host: string,
  timeoutMs: number,
): Promise<void> {
  const rawSocket = client.detachSocket();
  const secureSocket = tls.connect({
    socket: rawSocket,
    servername: host,
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      cleanup();
      secureSocket.destroy();
      reject(error);
    };
    const timer = setTimeout(() => onError(new Error('Connection timed out')), timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      secureSocket.off('error', onError);
      secureSocket.off('secureConnect', onConnect);
    };
    const onConnect = (): void => {
      cleanup();
      secureSocket.setTimeout(0);
      client.attachSocket(secureSocket);
      resolve();
    };
    secureSocket.once('error', onError);
    secureSocket.once('secureConnect', onConnect);
  });
}

async function connectSocket(input: {
  host: string;
  port: number;
  tls: boolean;
  timeoutMs: number;
}): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = input.tls
      ? tls.connect({ host: input.host, port: input.port, servername: input.host })
      : net.connect({ host: input.host, port: input.port });
    const onError = (error: Error): void => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    const timer = setTimeout(() => onError(new Error('Connection timed out')), input.timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('error', onError);
      socket.off('connect', onConnect);
      socket.off('secureConnect', onConnect);
    };
    const onConnect = (): void => {
      cleanup();
      socket.setTimeout(0);
      resolve(socket);
    };
    socket.once('error', onError);
    socket.once(input.tls ? 'secureConnect' : 'connect', onConnect);
  });
}

function validateCommandValue(value: string, label: string): string | null {
  return /[\r\n]/.test(value) ? `${label} enthaelt ungueltige Zeilenumbrueche` : null;
}

function validatePathAddress(value: string, label: string): string | null {
  if (!value.trim() || /[\r\n<>]/.test(value)) return `${label} ist ungueltig`;
  return null;
}

function validateRecipients(recipients: readonly string[]): string | null {
  if (recipients.length === 0) return 'Mindestens ein Empfaenger ist erforderlich';
  for (const recipient of recipients) {
    const invalid = validatePathAddress(recipient, 'Empfaenger');
    if (invalid) return invalid;
  }
  return null;
}

function dotStuff(value: string): string {
  const normalized = value.replace(/\r?\n/g, '\r\n').replace(/\r\n?$/g, '');
  const stuffed = normalized
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
  return `${stuffed}\r\n.\r\n`;
}

class LineProtocolClient {
  private buffer = Buffer.alloc(0);
  private waiters: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
  }> = [];
  private socket: net.Socket;

  constructor(socket: net.Socket, private readonly timeoutMs: number) {
    this.socket = socket;
    this.attachListeners(socket);
  }

  attachSocket(socket: net.Socket): void {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.attachListeners(socket);
  }

  detachSocket(): net.Socket {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');
    return this.socket;
  }

  readLine(): Promise<string> {
    const existing = this.shiftLine();
    if (existing !== null) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.resolve !== resolve);
        reject(new Error('Connection timed out'));
      }, this.timeoutMs);
      this.waiters.push({
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  writeLine(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  writeData(data: string): void {
    this.socket.write(data);
  }

  close(): void {
    this.socket.destroy();
  }

  private attachListeners(socket: net.Socket): void {
    socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
      this.flushWaiters();
    });
    socket.once('error', (error) => this.rejectWaiters(error));
    socket.once('close', () => this.rejectWaiters(new Error('Connection closed')));
  }

  private flushWaiters(): void {
    while (this.waiters.length > 0) {
      const line = this.shiftLine();
      if (line === null) return;
      this.waiters.shift()?.resolve(line);
    }
  }

  private rejectWaiters(error: Error): void {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }

  private shiftLine(): string | null {
    const idx = this.buffer.indexOf(10);
    if (idx < 0) return null;
    const line = this.buffer.subarray(0, idx + 1);
    this.buffer = this.buffer.subarray(idx + 1);
    return line.toString('utf8').replace(/\r?\n$/, '');
  }
}
