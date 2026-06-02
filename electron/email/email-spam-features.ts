import type { EmailMessageRow } from './email-store';
import { addressesFromRecipientJson } from './email-parse-utils';
import { attachmentContextFromJson } from './email-workflow-types';

export function normalizeSenderEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const angle = /<([^>]+)>/.exec(trimmed);
  if (angle?.[1]) return angle[1].trim().toLowerCase();
  const plain = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.exec(trimmed);
  return (plain?.[0] ?? trimmed).toLowerCase();
}

export function senderDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : email.toLowerCase();
}

function textFromHtml(html: string | null): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function token(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '');
}

export function extractSpamFeatureKeys(row: EmailMessageRow): string[] {
  const features = new Set<string>();
  const from = addressesFromRecipientJson(row.from_json);
  const email = normalizeSenderEmail(from);
  const domain = senderDomain(email);
  if (email.includes('@')) features.add(`sender:email:${email}`);
  if (domain) features.add(`sender:domain:${domain}`);

  for (const [name, value] of [
    ['spf', row.auth_spf],
    ['dkim', row.auth_dkim],
    ['dmarc', row.auth_dmarc],
    ['arc', row.auth_arc],
  ] as const) {
    if (value) features.add(`auth:${name}:${String(value).toLowerCase()}`);
  }

  const subject = row.subject ?? '';
  const body = `${row.body_text ?? ''}\n${textFromHtml(row.body_html)}`;
  const combined = `${subject}\n${row.snippet ?? ''}\n${body}`.toLowerCase();
  const html = row.body_html ?? '';
  const urlCount = (combined.match(/https?:\/\//g) ?? []).length;
  if (urlCount > 0) features.add('content:has_url');
  if (urlCount >= 5) features.add('content:many_urls');
  if (/https?:\/\/[^\s"'<>]+/i.test(html)) features.add('html:remote_resource');
  if (/<form\b/i.test(html)) features.add('html:form');
  if (/<script\b/i.test(html)) features.add('html:script');
  if (/\b(urgent|dringend|sofort|gewinn|lotterie|bitcoin|crypto|konto gesperrt|password|passwort|zahlung fehlgeschlagen)\b/i.test(combined)) {
    features.add('content:suspicious_terms');
  }
  if (/\b(iban|rechnung|invoice|bestellung|order)\b/i.test(combined)) {
    features.add('content:business_terms');
  }

  const att = attachmentContextFromJson(row.attachments_json, row.has_attachments);
  if (att.has_attachments === 'true') features.add('attachment:any');
  for (const name of att.attachment_names.split(/\n+/).filter(Boolean)) {
    const ext = /\.[a-z0-9]{1,8}$/i.exec(name)?.[0]?.slice(1).toLowerCase();
    if (ext) features.add(`attachment:ext:${token(ext)}`);
    if (ext && ['exe', 'scr', 'bat', 'cmd', 'js', 'vbs', 'html', 'htm', 'zip', 'rar'].includes(ext)) {
      features.add('attachment:risky_type');
    }
  }
  for (const type of att.attachment_types.split(/\n+/).filter(Boolean)) {
    features.add(`attachment:mime:${token(type)}`);
  }

  return [...features].sort();
}

export function buildFeaturePreview(row: EmailMessageRow): {
  senderEmail: string;
  senderDomain: string;
  featureKeys: string[];
} {
  const from = addressesFromRecipientJson(row.from_json);
  const email = normalizeSenderEmail(from);
  return {
    senderEmail: email,
    senderDomain: senderDomain(email),
    featureKeys: extractSpamFeatureKeys(row),
  };
}
