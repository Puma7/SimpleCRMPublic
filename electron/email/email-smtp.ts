import nodemailer from 'nodemailer';
import { getEmailAccountById } from './email-store';
import { getEmailPassword } from './email-keytar';

export async function testSmtpConnection(input: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const transporter = nodemailer.createTransport({
    host: input.host,
    port: input.port,
    secure: input.secure,
    auth: { user: input.user, pass: input.pass },
  });
  try {
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendSmtpForAccount(
  accountId: number,
  mail: { from: string; to: string; cc?: string; subject: string; text?: string; html?: string },
): Promise<void> {
  const acc = getEmailAccountById(accountId);
  if (!acc) throw new Error('Konto nicht gefunden');

  const imapPass = await getEmailPassword(acc.keytar_account_key);
  let smtpPass: string | null = null;
  if (acc.smtp_keytar_account_key) {
    smtpPass = await getEmailPassword(acc.smtp_keytar_account_key);
  }
  const pass = smtpPass ?? imapPass;
  if (!pass) throw new Error('Kein SMTP/IMAP-Passwort im Schlüsselbund');

  const host = acc.smtp_host?.trim() || acc.imap_host;
  const port = acc.smtp_port ?? 587;
  const useTls = Boolean(acc.smtp_tls);
  const secure = useTls && port === 465;
  const requireTLS = useTls && port !== 465;
  const user =
    acc.smtp_use_imap_auth
      ? acc.imap_username
      : (acc.smtp_username?.trim() || acc.imap_username);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS,
    connectionTimeout: 90_000,
    socketTimeout: 120_000,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: mail.from,
    to: mail.to,
    cc: mail.cc || undefined,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}
