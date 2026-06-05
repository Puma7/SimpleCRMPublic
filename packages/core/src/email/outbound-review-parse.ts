export const OUTBOUND_WARNING_MARKER = '⚠️ AUSGANGSPRÜFUNG — VERSAND BLOCKIERT';

export type OutboundReviewParse = {
  ok: boolean;
  reason: string | null;
  code: string | null;
};

/** Parse KI-Antwort für ausgehende Qualitätsprüfung (STATUS: OK | BLOCK). */
export function parseOutboundReviewResponse(raw: string): OutboundReviewParse {
  const text = raw.trim();
  const upper = text.toUpperCase();
  if (upper.includes('STATUS: OK') || upper === 'OK' || upper.startsWith('OK\n')) {
    return { ok: true, reason: null, code: null };
  }
  const reasonMatch = /REASON:\s*(.+)/i.exec(text);
  const codeMatch = /CODE:\s*(\w+)/i.exec(text);
  const reason =
    reasonMatch?.[1]?.trim() ||
    (upper.includes('BLOCK') ? text.replace(/^[\s\S]*?BLOCK\s*/i, '').trim() : null) ||
    'Ausgehende Prüfung fehlgeschlagen';
  return {
    ok: false,
    reason: reason.slice(0, 500),
    code: codeMatch?.[1]?.trim() ?? null,
  };
}

/** Strip prior outbound-warning blocks from plain-text draft body. */
export function stripOutboundWarningFromPlain(body: string): string {
  const text = body ?? '';
  const idx = text.indexOf(OUTBOUND_WARNING_MARKER);
  if (idx < 0) return text.trim();
  const after = text.slice(idx);
  const sep = after.indexOf('\n---\n');
  if (sep >= 0) {
    return text.slice(idx + sep + '\n---\n'.length).trimStart();
  }
  return text.slice(0, idx).trim();
}

/** Strip prior outbound-warning banner div(s) from HTML draft body. */
export function stripOutboundWarningFromHtml(html: string): string {
  let inner = (html ?? '').trim();
  if (!inner) return '';
  for (let i = 0; i < 5; i++) {
    const next = inner
      .replace(/<div[^>]*>[\s\S]*?AUSGANGSPRÜFUNG[\s\S]*?<\/div>/gi, '')
      .trim();
    if (next === inner) break;
    inner = next;
  }
  return inner;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type DraftBodySnapshot = { plain: string; html: string };

/**
 * Recover user compose content from a blocked outbound draft row (and optional send payload).
 * Prefers HTML when plain text is empty — compose drafts often store the letter only in body_html.
 */
export function extractDraftBodyForOutboundBlock(
  row: { body_text?: string | null; body_html?: string | null },
  payload?: { bodyText?: string; bodyHtml?: string | null },
): DraftBodySnapshot {
  let plain = stripOutboundWarningFromPlain(row.body_text ?? '');
  let html = stripOutboundWarningFromHtml(row.body_html ?? '');

  if (payload) {
    const pPlain = stripOutboundWarningFromPlain(payload.bodyText ?? '');
    const pHtml = stripOutboundWarningFromHtml(payload.bodyHtml ?? '');
    if (pPlain.trim() || pHtml.trim()) {
      plain = pPlain;
      html = pHtml;
    }
  }

  if (!plain.trim() && html.trim()) {
    plain = htmlToPlainText(html);
  }
  if (!html.trim() && plain.trim()) {
    html = `<p>${plain.replace(/\n/g, '<br/>')}</p>`;
  }

  return { plain, html };
}

export function buildOutboundWarningBanner(reason: string): { text: string; html: string } {
  const lines = [
    OUTBOUND_WARNING_MARKER,
    reason.trim(),
    'Bitte E-Mail prüfen, korrigieren und erneut senden.',
    '---',
    '',
  ];
  const text = lines.join('\n');
  const html = `<div style="background:#fef3c7;border:1px solid #d97706;border-radius:6px;padding:12px;margin:0 0 16px 0;color:#78350f;font-family:sans-serif;font-size:14px;line-height:1.45"><strong>${OUTBOUND_WARNING_MARKER}</strong><br/>${reason.replace(/</g, '&lt;').replace(/>/g, '&gt;')}<br/><em>Bitte E-Mail prüfen, korrigieren und erneut senden.</em></div>`;
  return { text, html };
}
