import { getEmailMessageById, type EmailMessageRow } from './email-store';
import { verifyMailAuthentication } from './mail-auth-verify';
import { checkMessageWithRspamd } from './rspamd-client';
import {
  getMailSecuritySettings,
  isMailauthEnabled,
  isRspamdEnabled,
} from './mail-security-settings';
import { saveMessageSecurity } from './mail-security-store';
import { applyPreWorkflowMailSecurity } from './mail-security-static';

export type MailSecurityPipelineResult = {
  authChecked: boolean;
  rspamdChecked: boolean;
  preWorkflow: { skippedWorkflows: boolean; tags: string[] };
};

/**
 * Run mailauth + optional Rspamd, persist results, apply static pre-workflow rules.
 */
export async function runMailSecurityPipeline(
  messageId: number,
  preloadedRow?: EmailMessageRow,
): Promise<MailSecurityPipelineResult> {
  const row = preloadedRow ?? getEmailMessageById(messageId);
  if (!row) {
    return {
      authChecked: false,
      rspamdChecked: false,
      preWorkflow: { skippedWorkflows: false, tags: [] },
    };
  }

  const settings = getMailSecuritySettings();
  let auth = null;
  let rspamd = null;

  if (isMailauthEnabled()) {
    auth = await verifyMailAuthentication({
      rawHeaders: row.raw_headers,
      bodyText: row.body_text,
      bodyHtml: row.body_html,
    });
  }

  if (isRspamdEnabled()) {
    rspamd = await checkMessageWithRspamd({
      rawHeaders: row.raw_headers,
      bodyText: row.body_text,
      bodyHtml: row.body_html,
      baseUrl: settings.rspamdUrl,
      timeoutMs: settings.rspamdTimeoutMs,
    });
  }

  if (auth || rspamd) {
    saveMessageSecurity(messageId, auth, rspamd);
  }

  const rowForPre = auth || rspamd ? getEmailMessageById(messageId) : row;
  const preWorkflow = applyPreWorkflowMailSecurity(messageId, rowForPre ?? undefined);

  return {
    authChecked: auth != null,
    rspamdChecked: rspamd != null,
    preWorkflow,
  };
}
