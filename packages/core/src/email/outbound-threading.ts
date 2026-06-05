import { randomBytes } from 'crypto';

export function domainFromEmailAddress(address: string): string {
  const trimmed = address.trim();
  const angle = /<([^>]+)>/.exec(trimmed);
  const email = (angle?.[1] ?? trimmed).trim().toLowerCase();
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).replace(/[>]+$/, '') : 'simplecrm.local';
}

/** RFC 5322 Message-ID for outbound mail. */
export function generateOutboundMessageId(fromAddress: string): string {
  const domain = domainFromEmailAddress(fromAddress);
  const unique = `${Date.now()}.${randomBytes(12).toString('hex')}`;
  return `<${unique}@${domain}>`;
}

export function normalizeMessageIdHeader(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed;
  return `<${trimmed.replace(/^<|>$/g, '')}>`;
}

export type OutboundThreadingHeaders = {
  messageId: string;
  inReplyTo?: string;
  references?: string;
};

export function buildOutboundThreadingHeaders(parent: {
  message_id: string | null;
  references_header: string | null;
} | null): Pick<OutboundThreadingHeaders, 'inReplyTo' | 'references'> {
  if (!parent) return {};

  const parentId = normalizeMessageIdHeader(parent.message_id);
  if (!parentId) return {};

  const priorRefs = (parent.references_header ?? '')
    .split(/\s+/)
    .map((reference) => normalizeMessageIdHeader(reference))
    .filter((reference): reference is string => Boolean(reference));
  const references = [...priorRefs, parentId].filter(Boolean).join(' ').trim();

  return {
    inReplyTo: parentId,
    references: references || parentId,
  };
}
