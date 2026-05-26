import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { getEmailAccountById } from './email-store';
import { getEmailPassword } from './email-keytar';
import { resolveImapAuth } from './email-imap-auth';

export async function testSmtpConnection(input: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string;
  accessToken?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth: SMTPTransport.Options['auth'] = input.accessToken
    ? { type: 'OAuth2', user: input.user, accessToken: input.accessToken }
    : { user: input.user, pass: input.pass ?? '' };

  const transporter = nodemailer.createTransport({
    host: input.host,
    port: input.port,
    secure: input.secure,
    auth,
  });
  try {
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type SmtpAttachment = {
  filename: string;
  path: string;
  cid?: string;
};

async function smtpAuthForAccount(
  acc: NonNullable<ReturnType<typeof getEmailAccountById>>,
): Promise<SMTPTransport.Options['auth']> {
  if (acc.smtp_use_imap_auth) {
    const imapAuth = await resolveImapAuth(acc);
    if ('accessToken' in imapAuth) {
      return { type: 'OAuth2', user: imapAuth.user, accessToken: imapAuth.accessToken };
    }
    return { user: imapAuth.user, pass: imapAuth.pass };
  }

  const user = acc.smtp_username?.trim() || acc.imap_username;
  if (acc.smtp_keytar_account_key) {
    const smtpPass = await getEmailPassword(acc.smtp_keytar_account_key);
    if (smtpPass) return { user, pass: smtpPass };
  }
  const imapPass = await getEmailPassword(acc.keytar_account_key);
  if (!imapPass) throw new Error('Kein SMTP-Passwort im Schlüsselbund');
  return { user, pass: imapPass };
}

export async function sendSmtpForAccount(
  accountId: number,
  mail: {
    from: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    text?: string;
    html?: string;
    attachments?: SmtpAttachment[];
    messageId?: string;
    inReplyTo?: string;
    references?: string;
    requestReadReceipt?: boolean;
    /** Extra RFC5322 headers (merged with built-in headers). */
    headers?: Record<string, string>;
  },
): Promise<void> {
  const acc = getEmailAccountById(accountId);
  if (!acc) throw new Error('Konto nicht gefunden');

  const host = acc.smtp_host?.trim() || acc.imap_host;
  const port = acc.smtp_port ?? 587;
  const useTls = Boolean(acc.smtp_tls);
  const secure = useTls && port === 465;
  const requireTLS = useTls && port !== 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS,
    connectionTimeout: 90_000,
    socketTimeout: 120_000,
    auth: await smtpAuthForAccount(acc),
  });

  await transporter.sendMail({
    from: mail.from,
    to: mail.to,
    cc: mail.cc || undefined,
    bcc: mail.bcc || undefined,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    encoding: 'utf-8',
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    headers: {
      ...(mail.headers ?? {}),
      ...(mail.requestReadReceipt ? { 'Disposition-Notification-To': mail.from } : {}),
    },
    attachments: mail.attachments?.map((a) => ({
      filename: a.filename,
      path: a.path,
      cid: a.cid,
    })),
  });
}
