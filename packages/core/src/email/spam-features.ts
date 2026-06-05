import { normalizeAddressJson } from './parse-utils';

export type SpamFeatureMessageInput = {
  fromJson?: unknown | null;
  from_json?: unknown | null;
  subject?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
  body_text?: string | null;
  bodyHtml?: string | null;
  body_html?: string | null;
  authSpf?: string | null;
  auth_spf?: string | null;
  authDkim?: string | null;
  auth_dkim?: string | null;
  authDmarc?: string | null;
  auth_dmarc?: string | null;
  authArc?: string | null;
  auth_arc?: string | null;
  attachmentsJson?: unknown | null;
  attachments_json?: unknown | null;
  hasAttachments?: boolean | number | string | null;
  has_attachments?: boolean | number | string | null;
};

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

export function extractSpamFeatureKeys(message: SpamFeatureMessageInput): string[] {
  const features = new Set<string>();
  const maxFeatureChars = 50_000;
  const email = normalizeSenderEmail(senderFromAddressJson(message.fromJson ?? message.from_json ?? null));
  const domain = senderDomain(email);
  if (email.includes('@')) features.add(`sender:email:${email}`);
  if (domain) features.add(`sender:domain:${domain}`);

  for (const [name, value] of [
    ['spf', message.authSpf ?? message.auth_spf],
    ['dkim', message.authDkim ?? message.auth_dkim],
    ['dmarc', message.authDmarc ?? message.auth_dmarc],
    ['arc', message.authArc ?? message.auth_arc],
  ] as const) {
    if (value) features.add(`auth:${name}:${String(value).toLowerCase()}`);
  }

  const subject = message.subject ?? '';
  const html = (message.bodyHtml ?? message.body_html ?? '').slice(0, maxFeatureChars);
  const body = `${(message.bodyText ?? message.body_text ?? '').slice(0, maxFeatureChars)}\n${textFromHtml(html)}`;
  const combined = `${subject}\n${message.snippet ?? ''}\n${body}`.toLowerCase();
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

  const attachmentContext = attachmentContextFromJson(
    message.attachmentsJson ?? message.attachments_json ?? null,
    message.hasAttachments ?? message.has_attachments ?? false,
  );
  if (attachmentContext.hasAttachments) features.add('attachment:any');
  for (const name of attachmentContext.names) {
    const ext = /\.[a-z0-9]{1,8}$/i.exec(name)?.[0]?.slice(1).toLowerCase();
    if (ext) features.add(`attachment:ext:${token(ext)}`);
    if (ext && ['exe', 'scr', 'bat', 'cmd', 'js', 'vbs', 'html', 'htm', 'zip', 'rar'].includes(ext)) {
      features.add('attachment:risky_type');
    }
  }
  for (const type of attachmentContext.contentTypes) {
    features.add(`attachment:mime:${token(type)}`);
  }

  return [...features].sort();
}

export function buildFeaturePreview(message: SpamFeatureMessageInput): {
  senderEmail: string;
  senderDomain: string;
  featureKeys: string[];
} {
  const email = normalizeSenderEmail(senderFromAddressJson(message.fromJson ?? message.from_json ?? null));
  return {
    senderEmail: email,
    senderDomain: senderDomain(email),
    featureKeys: extractSpamFeatureKeys(message),
  };
}

function senderFromAddressJson(value: unknown): string {
  if (typeof value === 'string') {
    const canonical = normalizeAddressJson(value);
    if (canonical) return canonical.value.map((entry) => entry.address).filter(Boolean).join(', ');
    return value;
  }
  const canonical = normalizeAddressJson(value);
  return canonical?.value.map((entry) => entry.address).filter(Boolean).join(', ') ?? '';
}

function attachmentContextFromJson(
  attachmentsJson: unknown,
  hasAttachments: boolean | number | string | null,
): {
  hasAttachments: boolean;
  names: string[];
  contentTypes: string[];
} {
  const names: string[] = [];
  const contentTypes: string[] = [];
  const parsed = parseAttachmentJson(attachmentsJson);
  if (Array.isArray(parsed)) {
    for (const attachment of parsed) {
      if (attachment && typeof attachment === 'object') {
        const row = attachment as { filename?: string | null; name?: string | null; contentType?: string | null };
        const name = row.filename ?? row.name;
        if (name) names.push(name);
        if (row.contentType) contentTypes.push(row.contentType);
      }
    }
  } else if (parsed && typeof parsed === 'object') {
    const doc = parsed as {
      stored?: { name?: string; filename?: string; contentType?: string | null }[];
      omitted?: { name?: string | null }[];
    };
    for (const attachment of doc.stored ?? []) {
      const name = attachment.name ?? attachment.filename;
      if (name) names.push(name);
      if (attachment.contentType) contentTypes.push(attachment.contentType);
    }
    for (const omitted of doc.omitted ?? []) {
      if (omitted.name) names.push(omitted.name);
    }
  }

  return {
    hasAttachments: truthyAttachmentFlag(hasAttachments) || names.length > 0,
    names,
    contentTypes,
  };
}

function parseAttachmentJson(value: unknown): unknown {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function truthyAttachmentFlag(value: boolean | number | string | null): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return false;
}

function textFromHtml(html: string | null): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function token(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '');
}
