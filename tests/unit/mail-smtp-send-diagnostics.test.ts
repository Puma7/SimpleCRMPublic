import net from 'net';

import {
  inspectRfc822ForSmtpDiagnostics,
  sendSmtpMessage,
  type SmtpSendDiagnosticEvent,
} from '../../packages/server/src/mail-smtp-send';

async function startSmtpServer(onLine: (line: string, socket: net.Socket) => void, greeting = '220 SMTP ready\r\n') {
  const server = net.createServer((socket) => {
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
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain('super-secret-password');
    expect(serialized).not.toContain('secret body');
    expect(serialized).not.toContain('recipient@example.com');
    expect(serialized).not.toContain('agent@example.com');
  });
});
