import { getEmailMessageById, setMessageSpam } from './email-store';
import { getMailSecuritySettings } from './mail-security-settings';
import { classifySenderForMessage } from '../workflow/sender-filter';
import { addMessageTag } from './email-store';
import { isAuthFailure, type AuthResultLabel } from './mail-auth-verify';

/**
 * Pre-workflow rules: global sender blacklist + optional auto-spam on auth/Rspamd failures.
 */
export function applyPreWorkflowMailSecurity(messageId: number): {
  skippedWorkflows: boolean;
  tags: string[];
} {
  const row = getEmailMessageById(messageId);
  if (!row) return { skippedWorkflows: false, tags: [] };

  const settings = getMailSecuritySettings();
  const tags: string[] = [];

  const senderClass = classifySenderForMessage(row);
  if (senderClass === 'blacklist') {
    setMessageSpam(messageId, true);
    addMessageTag(messageId, 'blacklist');
    tags.push('blacklist');
    return { skippedWorkflows: true, tags };
  }

  const dmarc = (row.auth_dmarc ?? '') as AuthResultLabel;
  const spf = (row.auth_spf ?? '') as AuthResultLabel;

  if (settings.autoSpamDmarcFail && isAuthFailure(dmarc)) {
    setMessageSpam(messageId, true);
    addMessageTag(messageId, 'auth-dmarc-fail');
    tags.push('auth-dmarc-fail');
    return { skippedWorkflows: false, tags };
  }

  if (settings.autoSpamSpfFail && isAuthFailure(spf)) {
    setMessageSpam(messageId, true);
    addMessageTag(messageId, 'auth-spf-fail');
    tags.push('auth-spf-fail');
    return { skippedWorkflows: false, tags };
  }

  if (
    settings.autoSpamRspamd &&
    row.rspamd_score != null &&
    row.rspamd_score >= settings.rspamdSpamScore
  ) {
    setMessageSpam(messageId, true);
    addMessageTag(messageId, 'rspamd-high');
    tags.push('rspamd-high');
    return { skippedWorkflows: false, tags };
  }

  return { skippedWorkflows: false, tags };
}
