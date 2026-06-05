import { getEmailMessageById, setMessageSpam, type EmailMessageRow } from './email-store';
import { getMailSecuritySettings } from './mail-security-settings';
import { classifySenderForMessage } from '../workflow/sender-filter';
import { addMessageTag } from './email-store';
import { evaluatePreWorkflowMailSecurity } from '../../packages/core/src/email';

/**
 * Pre-workflow rules: global sender blacklist + optional auto-spam on auth/Rspamd failures.
 */
export function applyPreWorkflowMailSecurity(
  messageId: number,
  preloadedRow?: EmailMessageRow,
): {
  skippedWorkflows: boolean;
  tags: string[];
} {
  const row = preloadedRow ?? getEmailMessageById(messageId);
  if (!row) return { skippedWorkflows: false, tags: [] };

  const settings = getMailSecuritySettings();
  const tags: string[] = [];

  const senderClass = classifySenderForMessage(row);
  const decision = evaluatePreWorkflowMailSecurity({
    senderClass,
    message: row,
    settings,
  });
  if (decision.spamStatus === 'spam') {
    setMessageSpam(messageId, true);
    for (const tag of decision.tags) addMessageTag(messageId, tag);
    tags.push(...decision.tags);
    return { skippedWorkflows: decision.skippedWorkflows, tags };
  }

  return { skippedWorkflows: false, tags };
}
