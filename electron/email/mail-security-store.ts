import { getDb } from '../sqlite-service';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import type { MailAuthVerification } from './mail-auth-verify';
import type { RspamdCheckResult } from './rspamd-client';

export type MessageSecuritySnapshot = {
  authSpf: string | null;
  authDkim: string | null;
  authDmarc: string | null;
  authArc: string | null;
  authDkimDomains: string | null;
  authError: string | null;
  rspamdScore: number | null;
  rspamdAction: string | null;
  rspamdSymbols: string | null;
  rspamdError: string | null;
  securityCheckedAt: string | null;
};

export function saveMessageSecurity(
  messageId: number,
  auth: MailAuthVerification | null,
  rspamd: RspamdCheckResult | null,
): void {
  const sets: string[] = ['security_checked_at = datetime(\'now\')'];
  const vals: (string | number | null)[] = [];

  if (auth) {
    sets.push(
      'auth_spf = ?',
      'auth_dkim = ?',
      'auth_dmarc = ?',
      'auth_arc = ?',
      'auth_dkim_domains = ?',
      'auth_error = ?',
    );
    vals.push(
      auth.spf,
      auth.dkim,
      auth.dmarc,
      auth.arc,
      auth.dkimDomains.length ? auth.dkimDomains.join(', ') : null,
      auth.error ?? null,
    );
  }
  if (rspamd) {
    sets.push('rspamd_score = ?', 'rspamd_action = ?', 'rspamd_symbols = ?', 'rspamd_error = ?');
    vals.push(
      rspamd.score,
      rspamd.action,
      rspamd.symbols.length ? rspamd.symbols.join(', ') : null,
      rspamd.error ?? null,
    );
  }

  vals.push(messageId);
  getDb()
    .prepare(`UPDATE ${EMAIL_MESSAGES_TABLE} SET ${sets.join(', ')} WHERE id = ?`)
    .run(...vals);
}

export function securityVariablesFromRow(row: {
  auth_spf?: string | null;
  auth_dkim?: string | null;
  auth_dmarc?: string | null;
  auth_arc?: string | null;
  rspamd_score?: number | null;
  rspamd_action?: string | null;
}): Record<string, string | number | boolean | null> {
  const vars: Record<string, string | number | boolean | null> = {};
  if (row.auth_spf) vars['auth.spf'] = row.auth_spf;
  if (row.auth_dkim) vars['auth.dkim'] = row.auth_dkim;
  if (row.auth_dmarc) vars['auth.dmarc'] = row.auth_dmarc;
  if (row.auth_arc) vars['auth.arc'] = row.auth_arc;
  if (row.rspamd_score != null && !Number.isNaN(row.rspamd_score)) {
    vars['rspamd.score'] = row.rspamd_score;
  }
  if (row.rspamd_action) vars['rspamd.action'] = row.rspamd_action;
  return vars;
}
