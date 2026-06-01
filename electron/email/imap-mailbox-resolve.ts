import type { EmailAccountRow } from './email-store';
import {
  findSentMailboxOnServer,
  normalizeMailboxName,
  pickFirstMailboxPathOnServer,
  resolveSentMailboxCandidates,
  type MailboxListEntry,
} from './imap-mailbox-names';

export type ImapFolderSyncSpec = {
  path: string;
  folderKind: 'inbox' | 'sent' | 'draft';
  archived: boolean;
  isSpam: boolean;
  runInboundWorkflows: boolean;
};

const ARCHIVE_NAMES = new Set(
  ['archive', 'archives', 'archiv', 'all mail', 'all'].map(normalizeMailboxName),
);
const SPAM_NAMES = new Set(
  ['spam', 'junk', 'bulk', 'unwanted', 'ungewollt'].map(normalizeMailboxName),
);

function pathLeaf(pathValue: string, delimiter: string | undefined): string {
  const delimiters = [delimiter, '/', '.'].filter(Boolean) as string[];
  let leaf = pathValue;
  for (const d of delimiters) {
    const idx = leaf.lastIndexOf(d);
    if (idx >= 0) leaf = leaf.slice(idx + d.length);
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

function mailboxHasSpecialUse(entry: MailboxListEntry, token: string): boolean {
  const t = token.toLowerCase();
  if (entry.specialUse?.toLowerCase() === t) return true;
  const flag = token.startsWith('\\') ? token : `\\${token}`;
  return entry.flags?.has?.(flag) || entry.flags?.has?.(flag.toLowerCase()) || false;
}

function resolveByHeuristic(
  configured: string | null | undefined,
  listed: MailboxListEntry[],
  specialUse: string,
  nameSet: Set<string>,
  fallbacks: string[],
): string | null {
  const candidates: string[] = [];
  const seen = new Set<string>();
  pushUnique(candidates, seen, configured?.trim() || undefined);

  for (const entry of listed) {
    if (mailboxHasSpecialUse(entry, specialUse)) {
      pushUnique(candidates, seen, entry.path);
    }
  }
  for (const entry of listed) {
    const leaf = pathLeaf(entry.path, entry.delimiter);
    if (nameSet.has(normalizeMailboxName(entry.name)) || nameSet.has(normalizeMailboxName(leaf))) {
      pushUnique(candidates, seen, entry.path);
    }
  }
  for (const fb of fallbacks) {
    pushUnique(candidates, seen, fb);
  }
  return candidates[0] ?? null;
}

export function resolveArchiveMailboxPath(
  account: Pick<EmailAccountRow, 'sync_archive_folder_path'>,
  listed: MailboxListEntry[],
): string | null {
  return resolveByHeuristic(
    account.sync_archive_folder_path,
    listed,
    '\\Archive',
    ARCHIVE_NAMES,
    ['Archive', 'Archiv'],
  );
}

export function resolveSpamMailboxPath(
  account: Pick<EmailAccountRow, 'sync_spam_folder_path'>,
  listed: MailboxListEntry[],
): string | null {
  return resolveByHeuristic(
    account.sync_spam_folder_path,
    listed,
    '\\Junk',
    SPAM_NAMES,
    ['Spam', 'Junk'],
  );
}

export function resolveSentMailboxPath(
  account: Pick<EmailAccountRow, 'sent_folder_path'>,
  listed: MailboxListEntry[],
): string | null {
  const candidates = resolveSentMailboxCandidates(account.sent_folder_path || 'Sent', listed);
  const onServer = pickFirstMailboxPathOnServer(candidates, listed);
  if (onServer) return onServer;
  if (listed.length === 0) return candidates[0] ?? null;
  return findSentMailboxOnServer(listed);
}

/** Folders to sync for one IMAP account (INBOX always; others opt-in). */
export function resolveSyncFoldersForAccount(
  account: EmailAccountRow,
  listed: MailboxListEntry[],
): ImapFolderSyncSpec[] {
  const specs: ImapFolderSyncSpec[] = [
    {
      path: 'INBOX',
      folderKind: 'inbox',
      archived: false,
      isSpam: false,
      runInboundWorkflows: true,
    },
  ];
  const seen = new Set<string>(['inbox']);

  if ((account.imap_sync_sent ?? 0) === 1) {
    const sentPath = resolveSentMailboxPath(account, listed);
    if (sentPath && !seen.has(sentPath.toLowerCase())) {
      seen.add(sentPath.toLowerCase());
      specs.push({
        path: sentPath,
        folderKind: 'sent',
        archived: false,
        isSpam: false,
        runInboundWorkflows: false,
      });
    }
  }

  if ((account.imap_sync_archive ?? 0) === 1) {
    const archivePath = resolveArchiveMailboxPath(account, listed);
    if (archivePath && !seen.has(archivePath.toLowerCase())) {
      seen.add(archivePath.toLowerCase());
      specs.push({
        path: archivePath,
        folderKind: 'inbox',
        archived: true,
        isSpam: false,
        runInboundWorkflows: false,
      });
    }
  }

  if ((account.imap_sync_spam ?? 0) === 1) {
    const spamPath = resolveSpamMailboxPath(account, listed);
    if (spamPath && !seen.has(spamPath.toLowerCase())) {
      seen.add(spamPath.toLowerCase());
      specs.push({
        path: spamPath,
        folderKind: 'inbox',
        archived: false,
        isSpam: true,
        runInboundWorkflows: false,
      });
    }
  }

  return specs;
}
