function normalizeTicketPrefix(prefix?: string | null): string {
  const normalized = String(prefix ?? 'SCR')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return normalized || 'SCR';
}

export type AccountMailSettings = {
  accountId: number;
  /** Buchstabenkombi für Ticket-Codes, z. B. SHOPA. */
  ticketPrefix: string;
  /** Nächste laufende Nummer im Nummernkreis dieses Kontos. */
  ticketNextNumber: number;
  /** Mindeststellen der Ticket-Nummer (Auffüllung mit führenden Nullen). */
  ticketNumberPadding: number;
  /** Interner Thread-Namespace — trennt Konversationen pro Konto. */
  threadNamespace: string;
};

export const DEFAULT_TICKET_NUMBER_PADDING = 6;
export const DEFAULT_TICKET_NEXT_NUMBER = 1;

export function formatTicketSequence(sequence: number, padding: number): string {
  const n = Math.max(1, Math.floor(sequence));
  const pad = Math.min(12, Math.max(1, Math.floor(padding)));
  return String(n).padStart(pad, '0');
}

export function defaultThreadNamespace(accountId: number, ticketPrefix?: string | null): string {
  const prefix = normalizeTicketPrefix(ticketPrefix);
  return prefix === 'SCR' ? `account-${accountId}` : prefix.toLowerCase();
}

export function deriveDefaultTicketPrefix(input: {
  id: number;
  display_name?: string | null;
  email_address?: string | null;
}): string {
  const local = input.email_address?.split('@')[0] ?? '';
  const fromEmail = local.replace(/[^a-z0-9]/gi, '').slice(0, 10);
  if (fromEmail.length >= 2) return normalizeTicketPrefix(fromEmail);
  const fromName = (input.display_name ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 10);
  if (fromName.length >= 2) return normalizeTicketPrefix(fromName);
  return normalizeTicketPrefix(`A${input.id}`);
}

export function buildDefaultAccountMailSettings(account: {
  id: number;
  display_name?: string | null;
  email_address?: string | null;
}): AccountMailSettings {
  const ticketPrefix = deriveDefaultTicketPrefix(account);
  return {
    accountId: account.id,
    ticketPrefix,
    ticketNextNumber: DEFAULT_TICKET_NEXT_NUMBER,
    ticketNumberPadding: DEFAULT_TICKET_NUMBER_PADDING,
    threadNamespace: defaultThreadNamespace(account.id, ticketPrefix),
  };
}

export function normalizeAccountMailSettings(
  partial: Partial<AccountMailSettings> | null | undefined,
  accountId: number,
): AccountMailSettings {
  const prefix = normalizeTicketPrefix(partial?.ticketPrefix);
  const nextNumberRaw = partial?.ticketNextNumber ?? DEFAULT_TICKET_NEXT_NUMBER;
  const nextNumber = Number.isFinite(nextNumberRaw)
    ? Math.max(1, Math.floor(Number(nextNumberRaw)))
    : DEFAULT_TICKET_NEXT_NUMBER;
  const paddingRaw = partial?.ticketNumberPadding ?? DEFAULT_TICKET_NUMBER_PADDING;
  const padding = Number.isFinite(paddingRaw)
    ? Math.min(12, Math.max(1, Math.floor(Number(paddingRaw))))
    : DEFAULT_TICKET_NUMBER_PADDING;
  const namespaceRaw = String(partial?.threadNamespace ?? '').trim();
  const threadNamespace =
    namespaceRaw || defaultThreadNamespace(accountId, prefix);
  return {
    accountId,
    ticketPrefix: prefix,
    ticketNextNumber: nextNumber,
    ticketNumberPadding: padding,
    threadNamespace,
  };
}

export function previewAccountTicketCode(
  settings: Pick<AccountMailSettings, 'ticketPrefix' | 'ticketNextNumber' | 'ticketNumberPadding'>,
): string {
  const prefix = normalizeTicketPrefix(settings.ticketPrefix);
  const sequence = formatTicketSequence(settings.ticketNextNumber, settings.ticketNumberPadding);
  return `${prefix}-${sequence}`;
}
