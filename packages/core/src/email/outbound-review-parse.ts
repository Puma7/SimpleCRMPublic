import { replaceElementBlocks, replaceTags } from './parse-utils';

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

/** Schlusssatz des Hinweises „Versand blockiert“ (Text- und HTML-Fassung). */
export const OUTBOUND_WARNING_CLOSING_TEXT = 'Bitte E-Mail prüfen, korrigieren und erneut senden.';

/**
 * Hinweis als Fließtext entfernen (Marker bis Schlusssatz, optional „---“):
 * so steht er im Text, wenn das Entwurfsfenster den Hinweis-Block beim
 * Speichern zu einem Absatz umgeformt hat.
 */
function removeFlattenedOutboundWarning(text: string): string {
  let out = text;
  for (let i = 0; i < 5; i++) {
    const idx = out.indexOf(OUTBOUND_WARNING_MARKER);
    if (idx < 0) break;
    const closing = out.indexOf(OUTBOUND_WARNING_CLOSING_TEXT, idx);
    if (closing < 0) break;
    let end = closing + OUTBOUND_WARNING_CLOSING_TEXT.length;
    const separator = /^\s*---(?:[ \t]*\n)?/.exec(out.slice(end));
    if (separator) end += separator[0].length;
    out = `${out.slice(0, idx)}${out.slice(end)}`;
  }
  return out;
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
  // Umgeformter Hinweis (Entwurfsfenster): nur den Hinweis entfernen, den Text behalten.
  if (after.includes(OUTBOUND_WARNING_CLOSING_TEXT)) return removeFlattenedOutboundWarning(text).trim();
  return text.slice(0, idx).trim();
}

/**
 * Same result as
 * `input.replace(/<div[^>]*>[\s\S]*?AUSGANGSPRÜFUNG[\s\S]*?<\/div>/gi, '')`,
 * but linear: the lazy regex backtracks over every later marker and `<div` for
 * each unclosed candidate (cubic on hostile drafts). If one `<div` has no `>`,
 * marker or `</div>` after it, no later `<div` can have one either.
 */
function removeOutboundWarningDivs(input: string): string {
  const open = /<div/gi;
  const marker = /AUSGANGSPRÜFUNG/gi;
  const close = /<\/div>/gi;
  let out = '';
  let cursor = 0;
  for (;;) {
    open.lastIndex = cursor;
    const start = open.exec(input);
    if (!start) break;
    const gt = input.indexOf('>', start.index + start[0].length);
    if (gt === -1) break;
    marker.lastIndex = gt + 1;
    const hit = marker.exec(input);
    if (!hit) break;
    close.lastIndex = hit.index + hit[0].length;
    const end = close.exec(input);
    if (!end) break;
    out += input.slice(cursor, start.index);
    cursor = end.index + end[0].length;
  }
  return cursor === 0 ? input : out + input.slice(cursor);
}

/**
 * Den vom Entwurfsfenster umgeformten Hinweis entfernen: der Editor macht aus
 * dem Hinweis-div einen Absatz (<p><strong>Marker</strong><br>Grund<br>
 * <em>Schlusssatz</em></p>). Entfernt wird vom öffnenden <p>/<div> vor dem
 * Marker bis zum schließenden Tag nach dem Schlusssatz; linear (indexOf).
 */
function removeOutboundWarningParagraphs(input: string): string {
  let out = input;
  for (let i = 0; i < 5; i++) {
    const markerIdx = out.indexOf(OUTBOUND_WARNING_MARKER);
    if (markerIdx < 0) break;
    const closingIdx = out.indexOf(OUTBOUND_WARNING_CLOSING_TEXT, markerIdx);
    if (closingIdx < 0) break;
    const lower = out.toLowerCase();
    let start = Math.max(lower.lastIndexOf('<p', markerIdx), lower.lastIndexOf('<div', markerIdx));
    // Nur der Block, der den Hinweis enthält — nie ein vorheriger Absatz.
    if (start >= 0) {
      const between = lower.slice(start, markerIdx);
      if (between.includes('</p>') || between.includes('</div>')) start = -1;
    }
    const afterClosing = closingIdx + OUTBOUND_WARNING_CLOSING_TEXT.length;
    const closeP = lower.indexOf('</p>', afterClosing);
    const closeDiv = lower.indexOf('</div>', afterClosing);
    const candidates = [closeP >= 0 ? closeP + 4 : -1, closeDiv >= 0 ? closeDiv + 6 : -1].filter((n) => n > 0);
    const end = candidates.length > 0 ? Math.min(...candidates) : afterClosing;
    out = `${out.slice(0, start >= 0 ? start : markerIdx)}${out.slice(end)}`;
  }
  return out;
}

/** Strip prior outbound-warning banner div(s) from HTML draft body. */
export function stripOutboundWarningFromHtml(html: string): string {
  let inner = (html ?? '').trim();
  if (!inner) return '';
  for (let i = 0; i < 5; i++) {
    const next = removeOutboundWarningDivs(inner).trim();
    if (next === inner) break;
    inner = next;
  }
  if (inner.includes(OUTBOUND_WARNING_MARKER)) inner = removeOutboundWarningParagraphs(inner).trim();
  return inner;
}

function htmlToPlainText(html: string): string {
  // Linear scans (parse-utils) instead of lazy/negated-class regexes, which
  // are quadratic on unclosed <script/<style/< in hostile drafts.
  const withoutBlocks = replaceElementBlocks(replaceElementBlocks(html, 'script', ''), 'style', '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n');
  return replaceTags(withoutBlocks)
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
    OUTBOUND_WARNING_CLOSING_TEXT,
    '---',
    '',
  ];
  const text = lines.join('\n');
  const html = `<div style="background:#fef3c7;border:1px solid #d97706;border-radius:6px;padding:12px;margin:0 0 16px 0;color:#78350f;font-family:sans-serif;font-size:14px;line-height:1.45"><strong>${OUTBOUND_WARNING_MARKER}</strong><br/>${reason.replace(/</g, '&lt;').replace(/>/g, '&gt;')}<br/><em>${OUTBOUND_WARNING_CLOSING_TEXT}</em></div>`;
  return { text, html };
}

/**
 * Einheitlicher Hinweis, wenn ein Workflow den Versand ohne Begründung anhält
 * (leerer Grund am Knoten „Versand sperren“, leere Block-Antwort). Beide
 * Editionen und die Oberfläche verwenden denselben Text.
 */
export const OUTBOUND_HOLD_FALLBACK_REASON =
  'Vom Workflow ohne Begründung angehalten – bitte E-Mail prüfen.';

const MAX_OUTBOUND_HOLD_REASON_LENGTH = 500;

/** Grund einer Ausgangssperre: getrimmt und begrenzt, leer ⇒ Fallback-Text. */
export function outboundHoldReasonOrFallback(reason: string | null | undefined): string {
  const trimmed = (reason ?? '').trim();
  return (trimmed || OUTBOUND_HOLD_FALLBACK_REASON).slice(0, MAX_OUTBOUND_HOLD_REASON_LENGTH);
}

function escapeBannerHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Entwurfsinhalt eines angehaltenen Entwurfs: Warn-Banner mit dem Grund vor
 * dem bereinigten Text. `snapshot` stammt aus extractDraftBodyForOutboundBlock,
 * ein vorhandener Banner (z. B. „Prüfung läuft“) ist dort schon entfernt und
 * wird so durch den neuen Grund ersetzt.
 */
export function composeOutboundHeldDraftBody(
  snapshot: DraftBodySnapshot,
  reason: string,
): { bodyText: string; bodyHtml: string; plain: string } {
  const banner = buildOutboundWarningBanner(reason);
  const { plain, html } = snapshot;
  const bannerParagraph = `<p>${escapeBannerHtml(banner.text).replace(/\n/g, '<br/>')}</p>`;
  const bodyHtml = html.trim()
    ? `${banner.html}${html}`
    : plain.trim()
      ? `${bannerParagraph}<p>${escapeBannerHtml(plain).replace(/\n/g, '<br/>')}</p>`
      : bannerParagraph;
  return { bodyText: `${banner.text}${plain}`, bodyHtml, plain };
}
