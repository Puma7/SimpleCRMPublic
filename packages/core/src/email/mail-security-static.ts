import type { SenderFilterResult } from '../workflow/sender-filter';

export type MailSecurityAuthResultLabel =
  | 'pass'
  | 'fail'
  | 'softfail'
  | 'neutral'
  | 'none'
  | 'temperror'
  | 'permerror'
  | 'policy'
  | 'skipped'
  | 'unknown';

export type MailSecurityAutoSpamSettings = {
  autoSpamDmarcFail: boolean;
  autoSpamSpfFail: boolean;
  autoSpamRspamd: boolean;
  rspamdSpamScore: number;
};

export type MailSecurityStaticMessageInput = {
  authDmarc?: string | null;
  auth_dmarc?: string | null;
  authSpf?: string | null;
  auth_spf?: string | null;
  rspamdScore?: number | null;
  rspamd_score?: number | null;
};

export type MailSecurityPreWorkflowDecision = {
  skippedWorkflows: boolean;
  tags: string[];
  spamStatus: 'spam' | null;
};

export function isMailSecurityAuthFailure(label: string | null | undefined): boolean {
  const normalized = String(label ?? '').toLowerCase();
  return normalized === 'fail' || normalized === 'permerror';
}

export function evaluatePreWorkflowMailSecurity(input: {
  senderClass: SenderFilterResult;
  message: MailSecurityStaticMessageInput;
  settings: MailSecurityAutoSpamSettings;
}): MailSecurityPreWorkflowDecision {
  if (input.senderClass === 'blacklist') {
    return { skippedWorkflows: true, tags: ['blacklist'], spamStatus: 'spam' };
  }

  const dmarc = input.message.authDmarc ?? input.message.auth_dmarc;
  if (input.settings.autoSpamDmarcFail && isMailSecurityAuthFailure(dmarc)) {
    return { skippedWorkflows: false, tags: ['auth-dmarc-fail'], spamStatus: 'spam' };
  }

  const spf = input.message.authSpf ?? input.message.auth_spf;
  if (input.settings.autoSpamSpfFail && isMailSecurityAuthFailure(spf)) {
    return { skippedWorkflows: false, tags: ['auth-spf-fail'], spamStatus: 'spam' };
  }

  const rspamdScore = input.message.rspamdScore ?? input.message.rspamd_score;
  if (
    input.settings.autoSpamRspamd
    && rspamdScore != null
    && Number.isFinite(rspamdScore)
    && rspamdScore >= input.settings.rspamdSpamScore
  ) {
    return { skippedWorkflows: false, tags: ['rspamd-high'], spamStatus: 'spam' };
  }

  return { skippedWorkflows: false, tags: [], spamStatus: null };
}
