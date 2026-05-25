import { getEmailMessageById } from './email-store';
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
export async function runMailSecurityPipeline(messageId: number): Promise<MailSecurityPipelineResult> {
  const row = getEmailMessageById(messageId);
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

  const preWorkflow = applyPreWorkflowMailSecurity(messageId);

  return {
    authChecked: auth != null,
    rspamdChecked: rspamd != null,
    preWorkflow,
  };
}
