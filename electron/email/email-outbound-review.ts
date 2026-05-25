import { getEmailMessageById, updateComposeDraft } from './email-store';
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import {
  OUTBOUND_WARNING_MARKER,
  buildOutboundWarningBanner,
} from './email-outbound-review-parse';

export { OUTBOUND_WARNING_MARKER, parseOutboundReviewResponse, buildOutboundWarningBanner } from './email-outbound-review-parse';

function stripExistingWarning(body: string): string {
  const idx = body.indexOf(OUTBOUND_WARNING_MARKER);
  if (idx < 0) return body;
  const after = body.slice(idx);
  const sep = after.indexOf('\n---\n');
  if (sep >= 0) return body.slice(idx + sep + 5).trimStart();
  return body;
}

/** Entwurf bleibt bearbeitbar, erscheint im Posteingang, Versand gesperrt bis Freigabe. */
export function returnOutboundDraftToInbox(messageId: number, reason: string): void {
  const row = getEmailMessageById(messageId);
  if (!row || row.uid >= 0) return;

  const banner = buildOutboundWarningBanner(reason);
  const plain = stripExistingWarning(row.body_text ?? '');
  const htmlRaw = row.body_html ?? '';
  const htmlInner = htmlRaw.includes(OUTBOUND_WARNING_MARKER)
    ? htmlRaw.replace(/<div[^>]*>[\s\S]*?AUSGANGSPRÜFUNG[\s\S]*?<\/div>/i, '')
    : htmlRaw;

  const bodyText = `${banner.text}${plain}`;
  const bodyHtml = htmlInner.trim()
    ? `${banner.html}${htmlInner}`
    : `<p>${banner.text.replace(/\n/g, '<br/>')}</p>`;

  updateComposeDraft(messageId, {
    bodyText,
    bodyHtml,
  });

  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET outbound_hold = 1, outbound_block_reason = ?, folder_kind = 'draft', seen_local = 0, archived = 0, is_spam = 0
       WHERE id = ?`,
    )
    .run(reason.slice(0, 500), messageId);
}

export function clearOutboundHoldForResend(messageId: number): void {
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE} SET outbound_hold = 0, outbound_block_reason = NULL WHERE id = ?`,
    )
    .run(messageId);
}
