import { getEmailMessageById } from './email-store';
import { sendComposeDraft } from './email-compose-send';
import { listDueScheduledDraftIds, setDraftScheduledSendAt } from './email-message-features';
import { recipientFieldFromJson } from '../../shared/email-recipient-parse';

export async function processDueScheduledSends(
  logger: Pick<typeof console, 'warn' | 'debug'>,
): Promise<number> {
  const ids = listDueScheduledDraftIds();
  let sent = 0;
  for (const draftId of ids) {
    const draft = getEmailMessageById(draftId);
    if (!draft || draft.uid >= 0) continue;
    const to = recipientFieldFromJson(draft.to_json);
    if (!to.trim()) {
      logger.warn(`[email] scheduled send ${draftId}: no recipient`);
      continue;
    }
    const r = await sendComposeDraft({
      accountId: draft.account_id,
      draftMessageId: draftId,
      subject: draft.subject ?? '(Ohne Betreff)',
      bodyText: draft.body_text ?? '',
      bodyHtml: draft.body_html,
      to,
      cc: recipientFieldFromJson(draft.cc_json) || undefined,
      bcc: recipientFieldFromJson(draft.bcc_json) || undefined,
    });
    if (r.ok) {
      setDraftScheduledSendAt(draftId, null);
      sent += 1;
    } else {
      logger.warn(`[email] scheduled send ${draftId}: ${'error' in r ? r.error : 'failed'}`);
    }
  }
  return sent;
}
