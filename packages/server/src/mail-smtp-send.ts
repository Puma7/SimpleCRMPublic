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
  diagnosticsContext?: SmtpSendDiagnosticsContext;
  onDiagnostic?: (event: SmtpSendDiagnosticEvent) => void;
}>;

export type SmtpSendDiagnosticsContext = Readonly<{
  workflowId?: number;
  messageId?: number;
  nodeId?: string;
  nodeType?: string;
  jobId?: number | string;
  accountId?: number;
}>;

export type SmtpRfc822Diagnostics = Readonly<{
  headerBytes: number;
  bodyBytes: number;
  lineCount: number;
  headerCounts: Readonly<Record<string, number>>;
  issues: readonly string[];
}>;

export type SmtpSendDiagnosticEvent = Readonly<{
  kind: 'smtp_send_failed';
  stage: string;
  smtpCode?: number;
  smtpResponse?: string;
  host: string;
  port: number;
  tls: boolean;
  secureSocket: boolean;
  envelopeFromDomain: string | null;
  recipientCount: number;
  recipientDomains: readonly string[];
  context?: SmtpSendDiagnosticsContext;
  rfc822: SmtpRfc822Diagnostics;
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
  const rfc822Diagnostics = inspectRfc822ForSmtpDiagnostics(input.rfc822);
  const failWithResponse = (stage: string, response: SmtpResponse): never => {
    input.onDiagnostic?.({
      kind: 'smtp_send_failed',
      stage,
      smtpCode: response.code || undefined,
      smtpResponse: sanitizeSmtpResponse(response.text),
      host: input.host,
      port: input.port,
      tls: input.tls,
      secureSocket,
      envelopeFromDomain: emailDomain(input.envelopeFrom),
      recipientCount: input.recipients.length,
      recipientDomains: uniqueDomains(input.recipients),
      ...(input.diagnosticsContext ? { context: input.diagnosticsContext } : {}),
      rfc822: rfc822Diagnostics,
    });
    throw new Error(response.text);
  };
  const socket = await socketFactory({
    host: input.host,
    port: input.port,
    tls: secureSocket,
    timeoutMs,
  });
  const client = new LineProtocolClient(socket, timeoutMs);
  try {
    let response = await readSmtpResponse(client);
    if (response.code !== 220) failWithResponse('CONNECT', response);

    response = await smtpEhlo(client);
    if (response.code !== 250) failWithResponse('EHLO', response);

    if (!secureSocket && (requireStartTls || smtpSupports(response, 'STARTTLS'))) {
      if (!smtpSupports(response, 'STARTTLS')) throw new Error('SMTP STARTTLS nicht verfuegbar');
      response = await smtpCommand(client, 'STARTTLS');
      if (response.code !== 220) failWithResponse('STARTTLS', response);
      await upgradeClientToTls(client, input.host, timeoutMs);
      response = await smtpEhlo(client);
      if (response.code !== 250) failWithResponse('EHLO_AFTER_STARTTLS', response);
    }

    const auth = await smtpAuthenticate(client, response, {
      user: input.user,
      password: input.password,
      accessToken: input.accessToken,
    });
    if (auth.code !== 235) failWithResponse('AUTH', auth);

    response = await smtpCommand(client, `MAIL FROM:<${input.envelopeFrom}>`);
    if (response.code !== 250) failWithResponse('MAIL_FROM', response);

    for (const recipient of input.recipients) {
      response = await smtpCommand(client, `RCPT TO:<${recipient}>`);
      if (response.code !== 250 && response.code !== 251) failWithResponse('RCPT_TO', response);
    }

    response = await smtpCommand(client, 'DATA');
    if (response.code !== 354) failWithResponse('DATA', response);
    client.writeData(dotStuff(input.rfc822));
    response = await readSmtpResponse(client);
    if (response.code !== 250) failWithResponse('DATA_FINAL', response);

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

export function inspectRfc822ForSmtpDiagnostics(rfc822: string): SmtpRfc822Diagnostics {
  const normalized = rfc822.replace(/\r?\n/g, '\r\n');
  const headerEnd = normalized.indexOf('\r\n\r\n');
  const headerSection = headerEnd >= 0 ? normalized.slice(0, headerEnd) : normalized;
  const body = headerEnd >= 0 ? normalized.slice(headerEnd + 4) : '';
  const unfolded = unfoldHeaderLines(headerSection);
  const headerCounts: Record<string, number> = {};
  const emptyHeaders = new Set<string>();
  const issues = new Set<string>();

  for (const line of unfolded) {
    const match = /^([^:\s]+):\s*(.*)$/.exec(line);
    if (!match) {
      if (line.trim()) issues.add('malformed_header_line');
      continue;
    }
    const name = match[1].toLowerCase();
    const value = match[2] ?? '';
    headerCounts[name] = (headerCounts[name] ?? 0) + 1;
    if (!value.trim()) emptyHeaders.add(name);
  }

  const dateCount = headerCounts.date ?? 0;
  if (dateCount === 0) issues.add('missing_date_header');
  if (dateCount > 1) issues.add('duplicate_date_header');
  const dateHeader = unfolded.find((line) => /^date:/i.test(line));
  if (dateHeader) {
    const value = dateHeader.replace(/^date:\s*/i, '').trim();
    if (!value || Number.isNaN(Date.parse(value))) issues.add('invalid_date_header');
  }

  for (const name of ['from', 'sender', 'to', 'cc', 'subject']) {
    if ((headerCounts[name] ?? 0) > 1) issues.add(`duplicate_${name}_header`);
  }
  for (const name of ['date', 'from', 'sender', 'to', 'cc', 'subject']) {
    if (emptyHeaders.has(name)) issues.add(`empty_${name}_header`);
  }

  return {
    headerBytes: Buffer.byteLength(headerSection, 'utf8'),
    bodyBytes: Buffer.byteLength(body, 'utf8'),
    lineCount: normalized ? normalized.split('\r\n').length : 0,
    headerCounts,
    issues: Array.from(issues).sort(),
  };
}

function unfoldHeaderLines(headerSection: string): string[] {
  const lines = headerSection.split('\r\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^[\t ]/.test(line) && out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

function sanitizeSmtpResponse(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const redacted = normalized
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/\b[0-9A-F]{1,4}(?::[0-9A-F]{1,4}){2,7}\b/gi, '[ip]')
    .replace(/"[^"]{2,120}"/g, '"[text]"')
    .replace(/'[^']{2,120}'/g, "'[text]'");
  return redacted.length > 300 ? `${redacted.slice(0, 300)}…` : redacted;
}

function emailDomain(value: string): string | null {
  const match = /@([^@<>\s]+)$/.exec(value.trim().replace(/[<>]/g, ''));
  return match ? match[1].toLowerCase() : null;
}

function uniqueDomains(values: readonly string[]): string[] {
  return Array.from(new Set(values.map(emailDomain).filter((domain): domain is string => Boolean(domain)))).sort();
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
