export const OUTBOUND_WARNING_MARKER = '⚠️ AUSGANGSPRÜFUNG — VERSAND BLOCKIERT';

export type OutboundReviewParse = {
  ok: boolean;
  reason: string | null;
  code: string | null;
};

/**
 * Status-Zeile der Prüfantwort: nur am Zeilenanfang (optional als Aufzählung
 * oder fett), damit ein irgendwo im Fließtext zitiertes "STATUS: OK" — etwa aus
 * einer prompt-injizierten Kundenmail — keinen Versand freigibt.
 */
const OUTBOUND_STATUS_LINE = /^\s*(?:[-*>]\s*)?(?:\*\*|__)?\s*STATUS\s*(?:\*\*|__)?\s*[:=]\s*(.*)$/i;

/** Markdown-Reste und Schlusszeichen entfernen, damit „**OK**." exakt matcht. */
function normalizedStatusValue(raw: string): string {
  return raw
    .replace(/[*_`]/g, '')
    .replace(/[.,;:!]+\s*$/, '')
    .trim()
    .toUpperCase();
}

const AMBIGUOUS_STATUS_REASON =
  'Ausgehende Prüfung ohne eindeutigen STATUS — Versand vorsorglich blockiert';

/**
 * Parse KI-Antwort für ausgehende Qualitätsprüfung (STATUS: OK | BLOCK).
 *
 * Fail-closed: freigegeben wird nur bei **genau einer** Status-Zeile, die
 * eindeutig OK und nicht zugleich BLOCK nennt. Fehlender, doppelter oder in
 * sich widersprüchlicher Status ("STATUS: OK oder BLOCK") blockiert.
 */
export function parseOutboundReviewResponse(raw: string): OutboundReviewParse {
  const text = (raw ?? '').trim();
  const statusValues: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = OUTBOUND_STATUS_LINE.exec(line);
    if (match) statusValues.push((match[1] ?? '').toUpperCase());
  }

  if (statusValues.length === 1) {
    // Nur der exakte Status gibt frei. Ein blosses \bOK\b wuerde auch
    // „STATUS: NOT OK" oder „STATUS: ERROR, NOT OK" als Freigabe lesen —
    // das dokumentierte Format kennt ausschliesslich OK bzw. BLOCK.
    if (normalizedStatusValue(statusValues[0]!) === 'OK') {
      return { ok: true, reason: null, code: null };
    }
  } else if (statusValues.length === 0) {
    // Minimalantwort ohne Label ("OK" als komplette Antwort bzw. erste Zeile).
    const firstLine = text.split(/\r?\n/, 1)[0]?.trim().toUpperCase() ?? '';
    if (firstLine === 'OK' && !/\bBLOCK\b/i.test(text)) {
      return { ok: true, reason: null, code: null };
    }
  }

  const upper = text.toUpperCase();
  const ambiguous = statusValues.length > 1
    || (statusValues.length === 1
      && normalizedStatusValue(statusValues[0]!) !== 'OK'
      && normalizedStatusValue(statusValues[0]!) !== 'BLOCK');
  const reasonMatch = /REASON:\s*(.+)/i.exec(text);
  const codeMatch = /CODE:\s*(\w+)/i.exec(text);
  const reason =
    reasonMatch?.[1]?.trim() ||
    (ambiguous ? AMBIGUOUS_STATUS_REASON : null) ||
    (upper.includes('BLOCK') ? text.replace(/^[\s\S]*?BLOCK\s*/i, '').trim() : null) ||
    (statusValues.length === 0 ? AMBIGUOUS_STATUS_REASON : null) ||
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
