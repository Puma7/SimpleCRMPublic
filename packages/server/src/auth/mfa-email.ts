import { randomUUID } from 'node:crypto';

import type { AuthInvitationSmtpConfig } from '../auth-invitation-mailer';
import { sendSmtpMessage } from '../mail-smtp-send';

export async function sendMfaEmailCode(input: {
  smtp: AuthInvitationSmtpConfig;
  email: string;
  displayName: string;
  code: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const boundary = `simplecrm-mfa-${randomUUID()}`;
  const plain = [
    `Hallo ${input.displayName},`,
    '',
    'Ihr SimpleCRM-Anmeldecode lautet:',
    input.code,
    '',
    'Der Code ist 10 Minuten gueltig.',
    '',
    'Wenn Sie diese Anmeldung nicht angefordert haben, ignorieren Sie diese E-Mail.',
  ].join('\r\n');
  const html = [
    '<!doctype html>',
    '<html><body>',
    `<p>Hallo ${escapeHtml(input.displayName)},</p>`,
    '<p>Ihr SimpleCRM-Anmeldecode lautet:</p>',
    `<p><strong>${escapeHtml(input.code)}</strong></p>`,
    '<p>Der Code ist 10 Minuten gueltig.</p>',
    '<p>Wenn Sie diese Anmeldung nicht angefordert haben, ignorieren Sie diese E-Mail.</p>',
    '</body></html>',
  ].join('');

  const rfc822 = [
    `From: SimpleCRM <${sanitizeAddress(input.smtp.from)}>`,
    `To: ${sanitizeAddress(input.email)}`,
    'Subject: SimpleCRM Anmeldecode',
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${randomUUID()}@simplecrm.local>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    plain,
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  await sendSmtpMessage({
    host: input.smtp.host,
    port: input.smtp.port,
    tls: input.smtp.tls,
    user: input.smtp.user,
    password: input.smtp.password,
    envelopeFrom: input.smtp.from,
    recipients: [input.email],
    rfc822,
    ...(input.smtp.timeoutMs === undefined ? {} : { timeoutMs: input.smtp.timeoutMs }),
  });
}

function sanitizeAddress(value: string): string {
  return value.replace(/[\r\n<>]/g, '').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
