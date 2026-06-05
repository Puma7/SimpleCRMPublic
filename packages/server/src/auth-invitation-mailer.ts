import { randomUUID } from 'node:crypto';

import type { AuthInvitationMailerApiPort, AuthInvitationMailInput } from './api';
import { sendSmtpMessage, type ServerSmtpSendInput } from './mail-smtp-send';

export type AuthInvitationSmtpConfig = Readonly<{
  publicBaseUrl: string;
  from: string;
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password: string;
  timeoutMs?: number;
}>;

export type AuthInvitationMailerOptions = AuthInvitationSmtpConfig & Readonly<{
  smtpSend?: (input: ServerSmtpSendInput) => Promise<void>;
  now?: () => Date;
}>;

export function createAuthInvitationMailerPort(options: AuthInvitationMailerOptions): AuthInvitationMailerApiPort {
  const smtpSend = options.smtpSend ?? sendSmtpMessage;
  const now = options.now ?? (() => new Date());

  return {
    async sendInvitation(input) {
      const sentAt = now();
      const acceptUrl = buildAbsoluteUrl(options.publicBaseUrl, input.acceptPath);
      await smtpSend({
        host: options.host,
        port: options.port,
        tls: options.tls,
        user: options.user,
        password: options.password,
        envelopeFrom: options.from,
        recipients: [input.invitation.email],
        rfc822: buildInvitationMessage({
          input,
          acceptUrl,
          from: options.from,
          now: sentAt,
        }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
      return {
        status: 'sent',
        recipient: input.invitation.email,
        sentAt: sentAt.toISOString(),
      };
    },
  };
}

function buildAbsoluteUrl(publicBaseUrl: string, path: string): string {
  return new URL(path, publicBaseUrl).toString();
}

function buildInvitationMessage(input: {
  input: AuthInvitationMailInput;
  acceptUrl: string;
  from: string;
  now: Date;
}): string {
  const boundary = `simplecrm-invite-${randomUUID()}`;
  const invitation = input.input.invitation;
  const plain = [
    `Hallo ${invitation.displayName},`,
    '',
    'du wurdest zu SimpleCRM eingeladen.',
    '',
    'Einladung annehmen:',
    input.acceptUrl,
    '',
    `Dieser Link laeuft am ${invitation.expiresAt} ab.`,
    '',
    'Wenn du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.',
  ].join('\r\n');
  const html = [
    '<!doctype html>',
    '<html>',
    '<body>',
    `<p>Hallo ${escapeHtml(invitation.displayName)},</p>`,
    '<p>du wurdest zu SimpleCRM eingeladen.</p>',
    `<p><a href="${escapeHtml(input.acceptUrl)}">Einladung annehmen</a></p>`,
    `<p>Dieser Link laeuft am ${escapeHtml(invitation.expiresAt)} ab.</p>`,
    '<p>Wenn du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.</p>',
    '</body>',
    '</html>',
  ].join('');

  return [
    `From: SimpleCRM <${sanitizeAddress(input.from)}>`,
    `To: ${sanitizeAddress(invitation.email)}`,
    'Subject: SimpleCRM Einladung',
    `Date: ${input.now.toUTCString()}`,
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
