import { isCorruptRawHeaders } from './email-parse-utils';

/** Build a minimal RFC822 buffer from stored headers + body for mailauth / Rspamd. */

export function buildRfc822FromStored(input: {
  rawRfc822B64?: string | null;
  rawHeaders: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
}): Buffer | null {
  if (input.rawRfc822B64?.trim()) {
    return Buffer.from(input.rawRfc822B64, 'base64');
  }

  const raw =
    input.rawHeaders?.trim() && !isCorruptRawHeaders(input.rawHeaders)
      ? input.rawHeaders.trim()
      : null;
  if (!raw) return null;

  const headers = raw.replace(/\r?\n/g, '\r\n').replace(/\r\n+$/, '');
  let body = (input.bodyText ?? '').trim();
  if (!body) {
    const html = (input.bodyHtml ?? '').trim();
    if (html) body = html;
  }
  return Buffer.from(`${headers}\r\n\r\n${body}`, 'utf8');
}

/** Best-effort envelope sender for SPF (Return-Path > From). */
export function extractEnvelopeSender(rawHeaders: string | null): string | undefined {
  if (!rawHeaders) return undefined;
  const rp = rawHeaders.match(/^Return-Path:\s*<?([^>\s;]+)>?/im);
  if (rp?.[1]) return rp[1].trim();
  const from = rawHeaders.match(/^From:\s*.*<([^>]+)>/im);
  if (from?.[1]) return from[1].trim();
  const fromPlain = rawHeaders.match(/^From:\s*(\S+@\S+)/im);
  return fromPlain?.[1]?.trim();
}
