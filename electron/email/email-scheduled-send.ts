import { getEmailMessageById } from './email-store';
import { sendComposeDraft } from './email-compose-send';
import { listDueScheduledDraftIds, setDraftScheduledSendAt } from './email-message-features';
import { recipientFieldFromJson } from '../../shared/email-recipient-parse';
import { parseDraftAttachmentPathsJson } from '../../shared/compose-draft-attachments';
import {
  claimScheduledSend,
  clearDeferredSendHold,
  peekDeferredSendHold,
  releaseScheduledSendClaim,
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
    // Ein paralleler Versand haelt den Compose-Lock. Das ist KEIN Zustellbeweis:
    // scheitert er, muss das geparkte HOLD liegen bleiben und beim naechsten
    // faelligen Durchlauf greifen.
    let sendInFlightElsewhere = false;
    // HOLD aus einem abgestuerzten Vorlauf. Es kann hier nicht sofort angewendet
    // werden — setDraftApprovalPending verweigert den Stempel, solange unser
    // eigener Claim steht. Also merken und im finally nach der Freigabe setzen.
    let recoveredHold: string | null = null;
    try {
      const draft = getEmailMessageById(draftId);
      if (!draft || draft.uid >= 0) {
        // uid >= 0: bereits verschickt — ein nachtraegliches HOLD waere sinnlos.
        delivered = Boolean(draft && draft.uid >= 0);
        continue;
      }
      // Absturz-Recovery: hat ein frueherer Durchlauf ein HOLD geparkt, ohne es
      // anwenden zu koennen (App weg zwischen Parken und finally), dann gilt es
      // jetzt — und dieser Entwurf geht nicht raus. Ohne diese Pruefung raeumt
      // der Boot-Sweep nur den Claim ab und der naechste Tick versendet genau
      // den Entwurf, den die Gegenlese-KI zurueckhalten wollte.
      recoveredHold = peekDeferredSendHold(draftId);
      if (recoveredHold) continue;
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
          // Compose-Sendelock belegt: ein anderer Pfad sendet gerade. Ob er
          // Erfolg hat, wissen wir nicht — deshalb weder als zugestellt werten
          // noch das geparkte HOLD verbrauchen.
          sendInFlightElsewhere = true;
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
      // Bei belegtem Compose-Lock bleibt das HOLD bewusst geparkt: der parallele
      // Versand kann noch scheitern, dann greift es beim naechsten Durchlauf.
      const deferredHold = sendInFlightElsewhere
        ? null
        : recoveredHold ?? peekDeferredSendHold(draftId);
      if (deferredHold && delivered) {
        // Zugestellt ⇒ das HOLD ist gegenstandslos.
        clearDeferredSendHold(draftId);
      } else if (deferredHold) {
        // Die Gegenlese-KI wollte diesen Entwurf zurueckhalten, kam aber
        // waehrend des Versands nicht durch — und der Versand ist gescheitert.
        // Ohne das Nachholen ginge der ungeprueft gebliebene Entwurf beim
        // naechsten faelligen Durchlauf trotzdem raus.
        //
        // Reihenfolge: erst anwenden, dann den Parkplatz raeumen. Andersherum
        // waere nach einem Absturz dazwischen weder das HOLD noch der
        // Pending-Zustand da und der Entwurf ginge doch noch raus.
        if (setDraftApprovalPending(draftId, deferredHold)) {
          clearDeferredSendHold(draftId);
          logger.warn(`[email] scheduled send ${draftId}: HOLD der Gegenlese-KI nachgeholt`);
        }
      }
    }
  }
  return sent;
}
