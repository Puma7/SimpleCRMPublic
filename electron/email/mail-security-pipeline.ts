import { getEmailMessageById, type EmailMessageRow } from './email-store';
import { verifyMailAuthentication } from './mail-auth-verify';
import { checkMessageWithRspamd } from './rspamd-client';
import {
  getMailSecuritySettings,
  isMailauthEnabled,
  isRspamdEnabled,
} from './mail-security-settings';
import { saveMessageSecurity } from './mail-security-store';
import { evaluateAndSaveSpamDecision } from './email-spam-engine';
import { applyPreWorkflowMailSecurity } from './mail-security-static';
import type { SpamScoreBreakdown } from './email-spam-types';

export type MailSecurityPipelineResult = {
  authChecked: boolean;
  rspamdChecked: boolean;
  spam: SpamScoreBreakdown | null;
  preWorkflow: { skippedWorkflows: boolean; tags: string[] };
};

/**
 * Run mailauth + optional Rspamd, persist security results, then score via the local spam engine.
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
      spam: null,
      preWorkflow: { skippedWorkflows: false, tags: [] },
    };
  }

  const settings = getMailSecuritySettings();
  let auth = null;
  let rspamd = null;

  if (isMailauthEnabled()) {
    auth = await verifyMailAuthentication({
      rawRfc822B64: row.raw_rfc822_b64,
      rawHeaders: row.raw_headers,
      bodyText: row.body_text,
      bodyHtml: row.body_html,
    });
  }

  if (isRspamdEnabled()) {
    rspamd = await checkMessageWithRspamd({
      rawRfc822B64: row.raw_rfc822_b64,
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

  const rowForSpam = auth || rspamd ? getEmailMessageById(messageId) : row;
  const spam = evaluateAndSaveSpamDecision(messageId, rowForSpam ?? undefined);
  const rowForPre = rowForSpam ?? row;
  const preWorkflow = applyPreWorkflowMailSecurity(messageId, rowForPre);

  return {
    authChecked: auth != null,
    rspamdChecked: rspamd != null,
    spam,
    preWorkflow,
  };
}
