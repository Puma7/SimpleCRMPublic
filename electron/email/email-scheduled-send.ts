import { getEmailMessageById } from './email-store';
import { sendComposeDraft } from './email-compose-send';
import { listDueScheduledDraftIds, setDraftScheduledSendAt } from './email-message-features';
import { recipientFieldFromJson } from '../../shared/email-recipient-parse';
import { parseDraftAttachmentPathsJson } from '../../shared/compose-draft-attachments';
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
    try {
      const draft = getEmailMessageById(draftId);
      if (!draft || draft.uid >= 0) continue;
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
        setDraftScheduledSendAt(draftId, null);
        clearScheduledSendDraftMeta(draftId);
        sent += 1;
      } else {
        const errMsg = 'error' in r ? r.error : 'Versand fehlgeschlagen';
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
    }
  }
  return sent;
}
