import { getEmailMessageById, updateComposeDraft } from './email-store';
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import type { OutboundDraftPayload } from './email-workflow-engine';
import {
  buildOutboundWarningBanner,
  extractDraftBodyForOutboundBlock,
} from './email-outbound-review-parse';

export {
  OUTBOUND_WARNING_MARKER,
  parseOutboundReviewResponse,
  buildOutboundWarningBanner,
  stripOutboundWarningFromPlain,
  stripOutboundWarningFromHtml,
  extractDraftBodyForOutboundBlock,
} from './email-outbound-review-parse';

/** Entwurf bleibt bearbeitbar, erscheint im Posteingang, Versand gesperrt bis Freigabe. */
export function returnOutboundDraftToInbox(
  messageId: number,
  reason: string,
  opts?: { payload?: Pick<OutboundDraftPayload, 'bodyText' | 'bodyHtml'> },
): void {
  const row = getEmailMessageById(messageId);
  if (!row || row.uid >= 0) return;

  const { plain, html } = extractDraftBodyForOutboundBlock(row, opts?.payload);
  const banner = buildOutboundWarningBanner(reason);

  const bodyText = `${banner.text}${plain}`;
  const bodyHtml = html.trim()
    ? `${banner.html}${html}`
    : plain.trim()
      ? `<p>${banner.text.replace(/\n/g, '<br/>')}</p><p>${plain.replace(/\n/g, '<br/>')}</p>`
      : `<p>${banner.text.replace(/\n/g, '<br/>')}</p>`;

  updateComposeDraft(messageId, {
    bodyText,
    bodyHtml,
  });

  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET outbound_hold = 1,
           outbound_block_reason = ?,
           folder_kind = 'draft',
           seen_local = 0,
           archived = 0,
           is_spam = 0,
           soft_deleted = 0
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
