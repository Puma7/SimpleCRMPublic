import { EventEmitter } from 'node:events';
import net from 'net';

import {
  inspectRfc822ForSmtpDiagnostics,
  sendSmtpMessage,
  type SmtpSendDiagnosticEvent,
} from '../../packages/server/src/mail-smtp-send';

async function startSmtpServer(onLine: (line: string, socket: net.Socket) => void, greeting = '220 SMTP ready\r\n') {
  const server = net.createServer((socket) => {
    // The client may drop the connection mid-write (response limits).
    socket.on('error', () => undefined);
    socket.write(greeting);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const idx = buffer.indexOf('\r\n');
        if (idx < 0) break;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        onLine(line, socket);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

describe('server SMTP diagnostics', () => {
  test('detects RFC5322 header problems without exposing message body', () => {
    const diag = inspectRfc822ForSmtpDiagnostics([
      'Date: Sat, 13 Jun 2026 12:36:00 GMT',
      'Date: Sat, 13 Jun 2026 12:37:00 GMT',
      'From:',
      'To: recipient@example.com',
      'Subject: Test',
      '',
      'secret body that must not be logged',
    ].join('\r\n'));

    expect(diag.headerBytes).toBeGreaterThan(0);
    expect(diag.bodyBytes).toBeGreaterThan(0);
    expect(diag.issues).toEqual(expect.arrayContaining([
      'duplicate_date_header',
      'empty_from_header',
    ]));
    expect(JSON.stringify(diag)).not.toContain('secret body');
    expect(JSON.stringify(diag)).not.toContain('recipient@example.com');
  });

  test('emits redacted SMTP diagnostics when provider rejects DATA', async () => {
    const events: SmtpSendDiagnosticEvent[] = [];
    let inData = false;
    const server = await startSmtpServer((line, socket) => {
      if (inData) {
        if (line === '.') {
          inData = false;
          socket.write('554 5.6.0 Reject due to policy restrictions\r\n');
        }
        return;
      }
      if (line === 'EHLO simplecrm.local') socket.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
      else if (line.startsWith('AUTH PLAIN ')) socket.write('235 2.7.0 Authentication successful\r\n');
      else if (line === 'MAIL FROM:<agent@example.com>') socket.write('250 sender ok\r\n');
      else if (line === 'RCPT TO:<recipient@example.com>') socket.write('250 recipient ok\r\n');
      else if (line === 'DATA') {
        inData = true;
        socket.write('354 end with dot\r\n');
      } else if (line === 'QUIT') socket.write('221 bye\r\n');
      else socket.write('500 unknown command\r\n');
    });

    try {
      await expect(sendSmtpMessage({
        host: '127.0.0.1',
        port: server.port,
        tls: false,
        user: 'agent@example.com',
        password: 'super-secret-password',
        envelopeFrom: 'agent@example.com',
        recipients: ['recipient@example.com'],
        rfc822: [
          'Date: Sat, 13 Jun 2026 12:36:00 GMT',
          'From: Agent <agent@example.com>',
          'To: Recipient <recipient@example.com>',
          'Subject: Test',
          '',
          'secret body that must not be logged',
        ].join('\r\n'),
        timeoutMs: 1000,
        diagnosticsContext: { workflowId: 24, messageId: 10, nodeType: 'workflow.forward_copy' },
        onDiagnostic: (event) => events.push(event),
      })).rejects.toThrow('554 5.6.0 Reject due to policy restrictions');
    } finally {
      await server.close();
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'smtp_send_failed',
      stage: 'DATA_FINAL',
      smtpCode: 554,
      context: { workflowId: 24, messageId: 10, nodeType: 'workflow.forward_copy' },
      recipientCount: 1,
      recipientDomains: ['example.com'],
    });
    expect(events[0].smtpResponse).toBe('554 5.6.0 Reject due to policy restrictions');
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain('super-secret-password');
    expect(serialized).not.toContain('secret body');
    expect(serialized).not.toContain('recipient@example.com');
    expect(serialized).not.toContain('agent@example.com');
  });
});

// F-A4-06: the SMTP send client buffered server data without limit and
// collected continuation lines forever, so a hostile or compromised SMTP
// server could grow worker memory or keep a send busy indefinitely.
describe('server SMTP send response limits', () => {
  const baseInput = {
    host: '127.0.0.1',
    tls: false,
    user: 'agent@example.com',
    password: 'super-secret-password',
    envelopeFrom: 'agent@example.com',
    recipients: ['recipient@example.com'],
    rfc822: 'Subject: Test\r\n\r\nbody',
    timeoutMs: 1000,
  };

  test('stops at an oversized server line instead of buffering it', async () => {
    const server = await startSmtpServer(() => undefined, `220 ${'x'.repeat(200 * 1024)}`);
    try {
      await expect(sendSmtpMessage({ ...baseInput, port: server.port })).rejects.toThrow('Server-Antwort zu gross');
    } finally {
      await server.close();
    }
  });

  test('stops at a response with too many continuation lines', async () => {
    const server = await startSmtpServer((line, socket) => {
      if (line === 'EHLO simplecrm.local') socket.write('250-x\r\n'.repeat(1500));
      else socket.write('250 OK\r\n');
    });
    try {
      await expect(sendSmtpMessage({ ...baseInput, port: server.port }))
        .rejects.toThrow('Server-Antwort hat zu viele Zeilen');
    } finally {
      await server.close();
    }
  });
});

/**
 * In-memory SMTP server socket for fake-timer tests: `respond` answers each
 * command ('.' stands for the end of the message body) with a reply or starts
 * a trickle of continuation lines that never ends.
 */
class TricklingSmtpSocket extends EventEmitter {
  destroyed = false;
  private trickle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly respond: (command: string) => string | { trickle: string; everyMs: number },
  ) {
    super();
    setTimeout(() => this.emit('data', '220 ready\r\n'), 0);
  }

  write(chunk: string | Buffer): boolean {
    const text = String(chunk);
    const reply = this.respond(text.endsWith('\r\n.\r\n') ? '.' : text.replace(/\r\n$/, ''));
    setTimeout(() => {
      if (this.destroyed) return;
      if (typeof reply === 'string') this.emit('data', reply);
      else this.trickle = setInterval(() => this.emit('data', reply.trickle), reply.everyMs);
    }, 0);
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.trickle) clearInterval(this.trickle);
    this.emit('close');
  }
}

function smtpReplies(trickleAfter: string, timeoutMs: number) {
  return (command: string): string | { trickle: string; everyMs: number } => {
    if (command === trickleAfter) return { trickle: '250-x\r\n', everyMs: timeoutMs - 1_000 };
    if (command.startsWith('EHLO')) return '250-AUTH PLAIN\r\n250 OK\r\n';
    if (command.startsWith('AUTH PLAIN')) return '235 ok\r\n';
    if (command === 'DATA') return '354 go ahead\r\n';
    return '250 OK\r\n';
  };
}

// C-A68: SMTP replies were only bounded per line (90 s) and to 1000 lines, so a
// hostile server could stretch one reply with a line every 89 s to about a day.
describe('server SMTP send response deadline', () => {
  const timeoutMs = 90_000;
  const baseInput = {
    host: 'smtp.example.com',
    port: 587,
    tls: false,
    user: 'agent@example.com',
    password: 'super-secret-password',
    envelopeFrom: 'agent@example.com',
    recipients: ['recipient@example.com'],
    rfc822: 'Subject: Test\r\n\r\nbody',
    timeoutMs,
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function send(socket: TricklingSmtpSocket) {
    const outcome: { error?: Error; done: boolean } = { done: false };
    void sendSmtpMessage({ ...baseInput, socketFactory: (async () => socket) as never }).then(
      () => { outcome.done = true; },
      (error: Error) => { outcome.done = true; outcome.error = error; },
    );
    return outcome;
  }

  test('gives up on a command reply that trickles in for more than five minutes', async () => {
    const socket = new TricklingSmtpSocket(smtpReplies('EHLO simplecrm.local', timeoutMs));
    const outcome = await send(socket);

    await jest.advanceTimersByTimeAsync(4 * 60_000 + 50_000);
    expect(outcome.done).toBe(false);
    await jest.advanceTimersByTimeAsync(15_000);

    expect(outcome.error?.message).toBe('Zeitlimit der Server-Antwort ueberschritten');
    expect(socket.destroyed).toBe(true);
  });

  test('waits up to ten minutes for the reply to the message body (RFC 5321 4.5.3.2)', async () => {
    const socket = new TricklingSmtpSocket(smtpReplies('.', timeoutMs));
    const outcome = await send(socket);

    await jest.advanceTimersByTimeAsync(9 * 60_000 + 50_000);
    expect(outcome.done).toBe(false);
    await jest.advanceTimersByTimeAsync(15_000);

    expect(outcome.error?.message).toBe('Zeitlimit der Server-Antwort ueberschritten');
    expect(socket.destroyed).toBe(true);
  });
});
