import type { ListResponse } from 'imapflow';

export type MailboxListEntry = Pick<ListResponse, 'path' | 'name' | 'delimiter' | 'specialUse' | 'flags'>;

const SENT_MAILBOX_NAMES = new Set(
  [
    'sent',
    'sent items',
    'sent mail',
    'sent messages',
    'gesendet',
    'gesendete objekte',
    'gesendete elemente',
    'gesendete nachrichten',
  ].map(normalizeMailboxName),
);

export function normalizeMailboxName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function mailboxHasSentSpecialUse(entry: MailboxListEntry): boolean {
  if (entry.specialUse?.toLowerCase() === '\\sent') return true;
  return entry.flags?.has?.('\\Sent') || entry.flags?.has?.('\\sent') || false;
}

function isSentLikeMailboxName(value: string | undefined): boolean {
  if (!value) return false;
  return SENT_MAILBOX_NAMES.has(normalizeMailboxName(value));
}

function pathLeaf(pathValue: string, delimiter: string | undefined): string {
  const delimiters = [delimiter, '/', '.'].filter(Boolean) as string[];
  let leaf = pathValue;
  for (const d of delimiters) {
    const idx = leaf.lastIndexOf(d);
    if (idx >= 0) {
      leaf = leaf.slice(idx + d.length);
    }
  }
  return leaf;
}

function pushUnique(target: string[], seen: Set<string>, value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  target.push(trimmed);
}

export function resolveSentMailboxCandidates(
  configuredFolder: string,
  listedMailboxes: MailboxListEntry[] = [],
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const configured = configuredFolder.trim() || 'Sent';
  pushUnique(candidates, seen, configured);

  for (const entry of listedMailboxes) {
    if (mailboxHasSentSpecialUse(entry)) {
      pushUnique(candidates, seen, entry.path);
    }
  }

  for (const entry of listedMailboxes) {
    if (
      isSentLikeMailboxName(entry.name) ||
      isSentLikeMailboxName(pathLeaf(entry.path, entry.delimiter))
    ) {
      pushUnique(candidates, seen, entry.path);
    }
  }

  const delimiters = new Set<string>(['.', '/']);
  for (const entry of listedMailboxes) {
    if (entry.delimiter) delimiters.add(entry.delimiter);
  }

  for (const folder of ['Sent', 'Sent Items', 'Sent Mail', 'Gesendet', 'Gesendete Objekte']) {
    pushUnique(candidates, seen, folder);
    for (const delimiter of delimiters) {
      pushUnique(candidates, seen, `INBOX${delimiter}${folder}`);
    }
  }

  return candidates;
}

/** First candidate that exists on the server (case-insensitive path match). */
export function pickFirstMailboxPathOnServer(
  candidates: string[],
  listedMailboxes: MailboxListEntry[],
): string | null {
  if (listedMailboxes.length === 0) {
    return candidates[0] ?? null;
  }
  const paths = new Set(listedMailboxes.map((e) => e.path.toLowerCase()));
  for (const candidate of candidates) {
    if (paths.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return null;
}

export function findSentMailboxOnServer(listedMailboxes: MailboxListEntry[]): string | null {
  for (const entry of listedMailboxes) {
    if (mailboxHasSentSpecialUse(entry)) {
      return entry.path;
    }
  }
  for (const entry of listedMailboxes) {
    if (
      isSentLikeMailboxName(entry.name) ||
      isSentLikeMailboxName(pathLeaf(entry.path, entry.delimiter))
    ) {
      return entry.path;
    }
  }
  return null;
}
