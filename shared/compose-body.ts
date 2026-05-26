/** Separates user reply from quoted original mail in compose HTML. */
export const COMPOSE_QUOTE_MARKER = '<!-- simplecrm-quote -->';

export type SplitComposeHtml = {
  /** Content above the quote (user reply + optional signature). */
  editableHtml: string;
  /** Quoted thread / forwarded block below the marker (may be empty). */
  quotedHtml: string;
};

export function splitComposeHtml(html: string): SplitComposeHtml {
  const raw = html ?? '';
  const idx = raw.indexOf(COMPOSE_QUOTE_MARKER);
  if (idx < 0) {
    return { editableHtml: raw.trim(), quotedHtml: '' };
  }
  return {
    editableHtml: raw.slice(0, idx).trim(),
    quotedHtml: raw.slice(idx + COMPOSE_QUOTE_MARKER.length).trim(),
  };
}

export function mergeComposeHtml(editableHtml: string, quotedHtml: string): string {
  const top = (editableHtml ?? '').trim();
  const bottom = (quotedHtml ?? '').trim();
  if (!bottom) return top;
  if (!top) return `${COMPOSE_QUOTE_MARKER}${bottom}`;
  return `${top}${COMPOSE_QUOTE_MARKER}${bottom}`;
}

export function plainTextToReplyHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

export function buildQuotedBlockHtml(quotedPlain: string): string {
  if (!quotedPlain.trim()) return '';
  return `<p>${quotedPlain.replace(/\n/g, '<br/>')}</p>`;
}

export function buildReplyComposeHtml(parts: {
  replyHtml?: string;
  quotedPlain?: string;
  signatureHtml?: string;
}): string {
  const reply = (parts.replyHtml ?? '').trim();
  const sig = (parts.signatureHtml ?? '').trim();
  const quoteBlock = buildQuotedBlockHtml(parts.quotedPlain ?? '');
  const editable = [reply, sig].filter(Boolean).join('<br/><br/>');
  if (!quoteBlock) return editable;
  return mergeComposeHtml(editable, quoteBlock);
}
