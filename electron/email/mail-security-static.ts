import log from 'electron-log';
import { getEmailMessageById, setMessageSpam, addMessageTag } from './email-store';
import { evaluateSenderFilter, type SenderFilterResult } from '../workflow/sender-filter';
import {
  getMailSecuritySettings,
  type MailSecuritySettings,
} from './mail-security-settings';

export type MailSecurityStaticCheck = {
  senderFilter: SenderFilterResult;
  appliedAutoSpam: boolean;
  /** Reserved for Phase 2+ (mailauth SPF/DKIM/DMARC). */
  authSummary: string | null;
};

/**
 * Static checks that run before workflow graphs (no KI).
 * Order: blacklist → whitelist hint → (future: auth / URLs / attachments).
 */
export function runStaticInboundChecks(
  fromAddress: string,
  settings?: MailSecuritySettings,
): MailSecurityStaticCheck {
  const cfg = settings ?? getMailSecuritySettings();
  const senderFilter = evaluateSenderFilter(fromAddress, {
    useGlobalLists: true,
    useBuiltinTrusted: cfg.useBuiltinTrustedSenders,
  });
  return {
    senderFilter,
    appliedAutoSpam: false,
    authSummary: null,
  };
}

/** If global blacklist matches, mark message spam before workflows (optional). */
export async function applyPreWorkflowMailSecurity(messageId: number): Promise<MailSecurityStaticCheck> {
  const row = getEmailMessageById(messageId);
  if (!row) {
    return { senderFilter: 'default', appliedAutoSpam: false, authSummary: null };
  }

  const settings = getMailSecuritySettings();
  const check = runStaticInboundChecks(extractFirstFromAddress(row.from_json), settings);

  if (
    settings.autoBlacklistBeforeWorkflow &&
    check.senderFilter === 'blacklist' &&
    !row.is_spam
  ) {
    setMessageSpam(messageId, true);
    addMessageTag(messageId, 'security-blacklist');
    check.appliedAutoSpam = true;
    log.info(`[mail-security] Auto-spam message ${messageId} (blacklist match)`);
  }

  return check;
}

function extractFirstFromAddress(json: string | null): string {
  if (!json) return '';
  try {
    const parsed = JSON.parse(json) as { value?: { address?: string }[] };
    return parsed?.value?.[0]?.address?.trim() ?? '';
  } catch {
    return '';
  }
}
