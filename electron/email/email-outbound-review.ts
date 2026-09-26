import { getEmailMessageById, updateComposeDraft } from './email-store';
import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import type { OutboundDraftPayload } from './email-workflow-engine';
import { extractDraftBodyForOutboundBlock } from './email-outbound-review-parse';
import { clearScheduledSendActor } from './email-scheduled-send-actor';
import { storeOutboundHoldFingerprint } from './outbound-hold-fingerprint';
import {
  composeOutboundHeldDraftBody,
  outboundHoldReasonOrFallback,
} from '../../packages/core/src/email/outbound-review-parse';

export {
  OUTBOUND_WARNING_MARKER,
  parseOutboundReviewResponse,
  buildOutboundWarningBanner,
  stripOutboundWarningFromPlain,
  stripOutboundWarningFromHtml,
  extractDraftBodyForOutboundBlock,
} from './email-outbound-review-parse';

/**
 * Entwurf bleibt bearbeitbar, erscheint im Posteingang, Versand gesperrt bis Freigabe.
 *
 * Jeder Block des Ausgangs ist auf dem Desktop endgültig (die Prüfung läuft
 * synchron); der Fingerprint des angehaltenen Inhalts wird gespeichert. War der Entwurf geplant (Workflow-Versand, „Später senden“),
 * fallen Planung und Planer weg: der Posteingang zeigt angehaltene Entwürfe
 * nur ohne scheduled_send_at, und ein erneuter automatischer Versand ohne
 * menschliche Entscheidung wäre falsch.
 */
export function returnOutboundDraftToInbox(
  messageId: number,
  reason: string,
  opts?: { payload?: Pick<OutboundDraftPayload, 'bodyText' | 'bodyHtml'> },
): void {
  const row = getEmailMessageById(messageId);
  if (!row || row.uid >= 0) return;

  const holdReason = outboundHoldReasonOrFallback(reason);
  const { bodyText, bodyHtml } = composeOutboundHeldDraftBody(
    extractDraftBodyForOutboundBlock(row, opts?.payload),
    holdReason,
  );

  updateComposeDraft(messageId, {
    bodyText,
    bodyHtml,
  });

  // updateComposeDraft löscht den RFC-3834-Marker bei jedem Inhaltsschreiben;
  // der Banner ist aber keine menschliche Änderung — eine angehaltene
  // automatische Antwort bleibt als solche gekennzeichnet (wie auf dem Server).
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET outbound_hold = 1,
           outbound_block_reason = ?,
           folder_kind = 'draft',
           seen_local = 0,
           archived = 0,
           is_spam = 0,
           soft_deleted = 0,
           scheduled_send_at = NULL,
           auto_submitted = ?
       WHERE id = ?`,
    )
    .run(holdReason, row.auto_submitted === 1 ? 1 : 0, messageId);
  clearScheduledSendActor(messageId);
  // Nur dieser angehaltene Inhalt darf „ohne Ausgangsprüfung“ raus.
  storeOutboundHoldFingerprint(messageId);
}

export function clearOutboundHoldForResend(messageId: number): void {
  getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE} SET outbound_hold = 0, outbound_block_reason = NULL WHERE id = ?`,
    )
    .run(messageId);
}
