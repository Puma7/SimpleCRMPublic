import { getEmailMessageById } from './email-store';
import { sendComposeDraft } from './email-compose-send';
import { listDueScheduledDraftIds, setDraftScheduledSendAt } from './email-message-features';
import { recipientFieldFromJson } from '../../shared/email-recipient-parse';
import { parseDraftAttachmentPathsJson } from '../../shared/compose-draft-attachments';
import {
  claimScheduledSend,
  releaseScheduledSendClaim,
  takeDeferredSendHold,
} from './email-scheduled-send-claim';
import { setDraftApprovalPending } from './email-draft-approval';
import {
  clearScheduledSendDraftMeta,
  markScheduledSendDraftFailed,
  recordScheduledSendAttemptFailure,
} from './email-scheduled-send-state';

const MAX_SCHEDULED_SEND_FAILURES = 5;

export async function processDueScheduledSends(
  logger: Pick<typeof console, 'warn' | 'debug'>,
): Promise<number> {
  const ids = listDueScheduledDraftIds();
  let sent = 0;
  for (const draftId of ids) {
    // Claim VOR dem Lesen/Senden: solange er steht, darf die Gegenlese-KI den
    // Entwurf nicht auf „Wartet auf Freigabe" stempeln und scheduled_send_at
    // nicht löschen — der SMTP-Aufruf laeuft ausserhalb jeder Transaktion.
    if (!claimScheduledSend(draftId)) continue;
    // Ging diese Mail tatsaechlich raus? Entscheidet unten, ob ein waehrend des
    // Versands geparktes HOLD der Gegenlese-KI nachgeholt werden muss.
    let delivered = false;
    try {
      const draft = getEmailMessageById(draftId);
      if (!draft || draft.uid >= 0) {
        // uid >= 0: bereits verschickt — ein nachtraegliches HOLD waere sinnlos.
        delivered = Boolean(draft && draft.uid >= 0);
        continue;
      }
      const to = recipientFieldFromJson(draft.to_json);
      if (!to.trim()) {
        logger.warn(`[email] scheduled send ${draftId}: no recipient`);
        setDraftScheduledSendAt(draftId, null);
        continue;
      }
      const attachmentPaths = parseDraftAttachmentPathsJson(draft.draft_attachment_paths_json);
      const replyParent = (draft as { reply_parent_message_id?: number | null })
        .reply_parent_message_id;
      const r = await sendComposeDraft({
        accountId: draft.account_id,
        draftMessageId: draftId,
        subject: draft.subject ?? '(Ohne Betreff)',
        bodyText: draft.body_text ?? '',
        bodyHtml: draft.body_html,
        to,
        cc: recipientFieldFromJson(draft.cc_json) || undefined,
        bcc: recipientFieldFromJson(draft.bcc_json) || undefined,
        attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths : undefined,
        inReplyToMessageId: replyParent ?? undefined,
      });
      if (r.ok) {
        delivered = true;
        setDraftScheduledSendAt(draftId, null);
        clearScheduledSendDraftMeta(draftId);
        sent += 1;
      } else {
        const errMsg = 'error' in r ? r.error : 'Versand fehlgeschlagen';
        if (errMsg.includes('Versand') && errMsg.includes('bereits')) {
          // Ein anderer Pfad hat den Entwurf schon verschickt.
          delivered = true;
          continue;
        }
        const fails = recordScheduledSendAttemptFailure(draftId, errMsg);
        logger.warn(
          `[email] scheduled send ${draftId} (${fails}/${MAX_SCHEDULED_SEND_FAILURES}): ${errMsg}`,
        );
        if (fails >= MAX_SCHEDULED_SEND_FAILURES) {
          setDraftScheduledSendAt(draftId, null);
          markScheduledSendDraftFailed(draftId, errMsg);
          logger.warn(`[email] scheduled send ${draftId}: giving up after ${fails} failures`);
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const fails = recordScheduledSendAttemptFailure(draftId, errMsg);
      logger.warn(`[email] scheduled send ${draftId} threw:`, e);
      if (fails >= MAX_SCHEDULED_SEND_FAILURES) {
        setDraftScheduledSendAt(draftId, null);
        markScheduledSendDraftFailed(draftId, errMsg);
      }
    } finally {
      // Erst den Claim freigeben: setDraftApprovalPending verweigert den Stempel,
      // solange er steht (es koennte ein laufender Versand sein).
      releaseScheduledSendClaim(draftId);
      const deferredHold = takeDeferredSendHold(draftId);
      if (deferredHold && !delivered) {
        // Die Gegenlese-KI wollte diesen Entwurf zurueckhalten, kam aber
        // waehrend des Versands nicht durch — und der Versand ist gescheitert.
        // Ohne das Nachholen ginge der ungeprueft gebliebene Entwurf beim
        // naechsten faelligen Durchlauf trotzdem raus.
        setDraftApprovalPending(draftId, deferredHold);
        logger.warn(`[email] scheduled send ${draftId}: HOLD der Gegenlese-KI nachgeholt`);
      }
    }
  }
  return sent;
}
