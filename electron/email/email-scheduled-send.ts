import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import { getEmailMessageById } from './email-store';
import { sendComposeDraft } from './email-compose-send';
import { listDueScheduledDraftIds, setDraftScheduledSendAt } from './email-message-features';
import { recipientFieldFromJson } from '../../shared/email-recipient-parse';

const MAX_SCHEDULED_SEND_FAILURES = 5;

function scheduledFailKey(draftId: number): string {
  return `scheduled_send_failures:${draftId}`;
}

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
        setSyncInfo(scheduledFailKey(draftId), '0');
        sent += 1;
      } else {
        const fails = parseInt(getSyncInfo(scheduledFailKey(draftId)) ?? '0', 10) + 1;
        setSyncInfo(scheduledFailKey(draftId), String(fails));
        logger.warn(
          `[email] scheduled send ${draftId} (${fails}/${MAX_SCHEDULED_SEND_FAILURES}): ${'error' in r ? r.error : 'failed'}`,
        );
        if (fails >= MAX_SCHEDULED_SEND_FAILURES) {
          setDraftScheduledSendAt(draftId, null);
          setSyncInfo(scheduledFailKey(draftId), '0');
          logger.warn(`[email] scheduled send ${draftId}: giving up after ${fails} failures`);
        }
      }
    } catch (e) {
      const fails = parseInt(getSyncInfo(scheduledFailKey(draftId)) ?? '0', 10) + 1;
      setSyncInfo(scheduledFailKey(draftId), String(fails));
      logger.warn(`[email] scheduled send ${draftId} threw:`, e);
      if (fails >= MAX_SCHEDULED_SEND_FAILURES) {
        setDraftScheduledSendAt(draftId, null);
        setSyncInfo(scheduledFailKey(draftId), '0');
      }
    }
  }
  return sent;
}
