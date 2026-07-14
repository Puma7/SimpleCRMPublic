/** Separates user reply from quoted original mail in compose HTML. */
export const COMPOSE_QUOTE_MARKER = '<!-- simplecrm-quote -->';
export const COMPOSE_BODY_MARKER = '<!-- simplecrm-body -->';
export const COMPOSE_SIGNATURE_MARKER = '<!-- simplecrm-signature -->';

export type SplitComposeHtml = {
  /** Content above the quote (greeting + body + optional signature). */
  editableHtml: string;
  /** Quoted thread / forwarded block below the marker (may be empty). */
  quotedHtml: string;
};

export type ComposeZones = {
  greetingHtml: string;
  bodyHtml: string;
  signatureHtml: string;
  quotedHtml: string;
};

export function splitComposeHtml(html: string): SplitComposeHtml {
  const zones = splitComposeZones(html);
  const editableParts = [zones.greetingHtml, zones.bodyHtml, zones.signatureHtml].filter(Boolean);
  return {
    editableHtml: editableParts.join('').trim(),
    quotedHtml: zones.quotedHtml,
  };
}

export function splitComposeZones(html: string): ComposeZones {
  const raw = html ?? '';
  const quoteIdx = raw.indexOf(COMPOSE_QUOTE_MARKER);
  const quotedHtml =
    quoteIdx < 0 ? '' : raw.slice(quoteIdx + COMPOSE_QUOTE_MARKER.length).trim();
  const aboveQuote = quoteIdx < 0 ? raw : raw.slice(0, quoteIdx);

  const sigIdx = aboveQuote.indexOf(COMPOSE_SIGNATURE_MARKER);
  let beforeSig = aboveQuote;
  let signatureHtml = '';
  if (sigIdx >= 0) {
    beforeSig = aboveQuote.slice(0, sigIdx);
    signatureHtml = aboveQuote.slice(sigIdx + COMPOSE_SIGNATURE_MARKER.length).trim();
  }

  const bodyIdx = beforeSig.indexOf(COMPOSE_BODY_MARKER);
  if (bodyIdx >= 0) {
    return {
      greetingHtml: beforeSig.slice(0, bodyIdx).trim(),
      bodyHtml: beforeSig.slice(bodyIdx + COMPOSE_BODY_MARKER.length).trim(),
      signatureHtml,
      quotedHtml,
    };
  }

  // Legacy: no zone markers — treat editable block as body only.
  return {
    greetingHtml: '',
    bodyHtml: beforeSig.trim(),
    signatureHtml,
    quotedHtml,
  };
}

export function mergeComposeHtml(editableHtml: string, quotedHtml: string): string {
  const top = (editableHtml ?? '').trim();
  const bottom = (quotedHtml ?? '').trim();
  if (!bottom) return top;
  if (!top) return `${COMPOSE_QUOTE_MARKER}${bottom}`;
  return `${top}${COMPOSE_QUOTE_MARKER}${bottom}`;
}

/** Splits stored compose HTML into Quill-editable content, signature, and quoted thread. */
export function splitEditorAndSignature(html: string): {
  editorHtml: string;
  signatureHtml: string;
  quotedHtml: string;
} {
  const zones = splitComposeZones(html);
  return {
    editorHtml: mergeComposeZones({
      greetingHtml: zones.greetingHtml,
      bodyHtml: zones.bodyHtml,
    }),
    signatureHtml: zones.signatureHtml,
    quotedHtml: zones.quotedHtml,
  };
}

/** Split trusted zone markers before HTML sanitization removes comments. */
export function splitAndSanitizeComposeHtml(
  html: string,
  sanitizeHtml: (value: string) => string,
): ReturnType<typeof splitEditorAndSignature> {
  const zones = splitComposeZones(html);
  return {
    editorHtml: mergeComposeZones({
      greetingHtml: sanitizeHtml(zones.greetingHtml),
      bodyHtml: sanitizeHtml(zones.bodyHtml),
    }),
    signatureHtml: sanitizeHtml(zones.signatureHtml),
    quotedHtml: sanitizeHtml(zones.quotedHtml),
  };
}

/** Sanitize each compose zone without losing the comment markers needed on restore. */
export function sanitizeComposeHtmlPreservingZones(
  html: string,
  sanitizeHtml: (value: string) => string,
): string {
  const split = splitAndSanitizeComposeHtml(html, sanitizeHtml);
  return mergeEditorAndSignature(split.editorHtml, split.signatureHtml, split.quotedHtml);
}

export function mergeEditorAndSignature(
  editorHtml: string,
  signatureHtml: string,
  quotedHtml = '',
): string {
  const zones = splitComposeZones(editorHtml);
  return mergeComposeZones({
    greetingHtml: zones.greetingHtml,
    bodyHtml: zones.bodyHtml,
    signatureHtml: (signatureHtml ?? '').trim(),
    quotedHtml: (quotedHtml ?? '').trim(),
  });
}

export function mergeComposeZones(parts: Partial<ComposeZones>): string {
  const greeting = (parts.greetingHtml ?? '').trim();
  const body = (parts.bodyHtml ?? '').trim();
  const signature = (parts.signatureHtml ?? '').trim();
  const quoted = (parts.quotedHtml ?? '').trim();

  let top = '';
  if (greeting) top += greeting;
  if (body) {
    if (top) top += COMPOSE_BODY_MARKER;
    top += body;
  } else if (greeting && (signature || quoted)) {
    top += COMPOSE_BODY_MARKER;
  }
  if (signature) {
    if (top) top += COMPOSE_SIGNATURE_MARKER;
    top += signature;
  }
  if (!quoted) return top;
  if (!top) return `${COMPOSE_QUOTE_MARKER}${quoted}`;
  return `${top}${COMPOSE_QUOTE_MARKER}${quoted}`;
}

export function plainTextToReplyHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtmlText(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

export function buildQuotedBlockHtml(quotedPlain: string): string {
  if (!quotedPlain.trim()) return '';
  return `<p>${escapeHtmlText(quotedPlain).replace(/\n/g, '<br/>')}</p>`;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildReplyComposeHtml(parts: {
  greetingHtml?: string;
  replyHtml?: string;
  quotedPlain?: string;
  signatureHtml?: string;
}): string {
  const greeting = (parts.greetingHtml ?? '').trim();
  const reply = (parts.replyHtml ?? '').trim();
  const sig = (parts.signatureHtml ?? '').trim();
  const quoteBlock = buildQuotedBlockHtml(parts.quotedPlain ?? '');
  return mergeComposeZones({
    greetingHtml: greeting,
    bodyHtml: reply || '<p><br></p>',
    signatureHtml: sig,
    quotedHtml: quoteBlock,
  });
}

/** Text context for KI transforms: greeting + body (no signature). */
export function composeAiContextText(zones: ComposeZones): string {
  const strip = (html: string) =>
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  return [zones.greetingHtml, zones.bodyHtml]
    .map(strip)
    .filter(Boolean)
    .join('\n\n');
}
