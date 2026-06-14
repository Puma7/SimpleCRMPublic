import type { EmailAccountRecord, EmailAccountMailSettingsRecord } from './api/types';

const DEFAULT_TICKET_PREFIX = 'SCR';

export type AccountMailSettingsDefaultAccount = Pick<
  EmailAccountRecord,
  'id' | 'displayName' | 'emailAddress'
>;

export function normalizeServerTicketPrefix(prefix?: string | null): string {
  const normalized = String(prefix ?? DEFAULT_TICKET_PREFIX)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return normalized || DEFAULT_TICKET_PREFIX;
}

export function defaultServerTicketPrefix(account: AccountMailSettingsDefaultAccount): string {
  const local = account.emailAddress.split('@')[0] ?? '';
  const fromEmail = local.replace(/[^a-z0-9]/gi, '').slice(0, 10);
  const base = fromEmail.length >= 2
    ? fromEmail
    : account.displayName.replace(/[^a-z0-9]/gi, '').slice(0, 10);
  const normalizedBase = normalizeServerTicketPrefix(base.length >= 2 ? base : `A${account.id}`);
  const suffix = String(account.id);
  const baseLength = Math.max(1, 12 - suffix.length);
  return normalizeServerTicketPrefix(`${normalizedBase.slice(0, baseLength)}${suffix}`);
}

export function defaultServerThreadNamespace(accountId: number, ticketPrefix: string): string {
  const prefix = normalizeServerTicketPrefix(ticketPrefix);
  return `${prefix.toLowerCase()}-${accountId}`;
}

export function buildDefaultServerAccountMailSettings(
  account: AccountMailSettingsDefaultAccount,
): EmailAccountMailSettingsRecord {
  const ticketPrefix = defaultServerTicketPrefix(account);
  return {
    accountId: account.id,
    ticketPrefix,
    ticketNextNumber: 1,
    ticketNumberPadding: 6,
    threadNamespace: defaultServerThreadNamespace(account.id, ticketPrefix),
    updatedAt: null,
  };
}
