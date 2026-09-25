import {
  resolveSyncFoldersForAccount,
  resolveArchiveMailboxPath,
  resolveSentMailboxPath,
  orderedSentMailboxCandidates,
  resolveSpamMailboxPath,
} from '../../electron/email/imap-mailbox-resolve';
import type { EmailAccountRow } from '../../electron/email/email-store';

const baseAccount = {
  id: 1,
  sent_folder_path: 'Sent',
  sync_spam_folder_path: null,
  sync_archive_folder_path: null,
  imap_sync_sent: 0,
  imap_sync_archive: 0,
  imap_sync_spam: 0,
} as EmailAccountRow;

describe('imap-mailbox-resolve', () => {
  test('always includes INBOX', () => {
    const specs = resolveSyncFoldersForAccount(baseAccount, []);
    expect(specs.map((s) => s.path)).toEqual(['INBOX']);
    expect(specs[0]?.runInboundWorkflows).toBe(true);
  });

  test('adds sent folder when enabled', () => {
    const specs = resolveSyncFoldersForAccount(
      { ...baseAccount, imap_sync_sent: 1 } as EmailAccountRow,
      [{ path: 'INBOX/Sent', name: 'Sent', delimiter: '/', specialUse: '\\Sent', flags: new Set() }],
    );
    expect(specs.some((s) => s.folderKind === 'sent')).toBe(true);
  });

  test('resolveSentMailboxPath skips configured Sent when only Gesendet exists', () => {
    const listed = [
      { path: 'INBOX', name: 'INBOX', delimiter: '/', specialUse: undefined, flags: new Set() },
      {
        path: 'INBOX/Gesendet',
        name: 'Gesendet',
        delimiter: '/',
        specialUse: '\\Sent',
        flags: new Set(['\\Sent']),
      },
    ];
    const resolved = resolveSentMailboxPath(
      { sent_folder_path: 'Sent' } as Pick<EmailAccountRow, 'sent_folder_path'>,
      listed,
    );
    expect(resolved).toBe('INBOX/Gesendet');
  });

  test('orderedSentMailboxCandidates prefers existing server path first', () => {
    const listed = [
      { path: 'INBOX/Gesendet', name: 'Gesendet', delimiter: '/', specialUse: '\\Sent', flags: new Set() },
    ];
    const ordered = orderedSentMailboxCandidates(
      { sent_folder_path: 'Sent' } as Pick<EmailAccountRow, 'sent_folder_path'>,
      listed,
    );
    expect(ordered[0]).toBe('INBOX/Gesendet');
    expect(ordered).toContain('Sent');
  });

  test('resolveArchiveMailboxPath uses special use', () => {
    const path = resolveArchiveMailboxPath(baseAccount, [
      { path: 'Archive', name: 'Archive', delimiter: '/', specialUse: '\\Archive', flags: new Set() },
    ]);
    expect(path).toBe('Archive');
  });

  test('optional folders never rerun inbound workflows and are synchronized only once', () => {
    const specs = resolveSyncFoldersForAccount({ ...baseAccount,
      imap_sync_sent: 1, imap_sync_archive: 1, imap_sync_spam: 1,
      sent_folder_path: 'Shared', sync_archive_folder_path: 'shared', sync_spam_folder_path: 'INBOX',
    }, [{ path: 'Shared', name: 'Shared', flags: new Set() }]);
    expect(specs).toEqual([
      { path: 'INBOX', folderKind: 'inbox', archived: false, isSpam: false, runInboundWorkflows: true },
      { path: 'Shared', folderKind: 'sent', archived: false, isSpam: false, runInboundWorkflows: false },
    ]);
  });

  test('archive and spam retain their distinct flags when enabled', () => {
    expect(resolveSyncFoldersForAccount({ ...baseAccount, imap_sync_archive: 1, imap_sync_spam: 1 }, [])).toEqual([
      { path: 'INBOX', folderKind: 'inbox', archived: false, isSpam: false, runInboundWorkflows: true },
      { path: 'Archive', folderKind: 'inbox', archived: true, isSpam: false, runInboundWorkflows: false },
      { path: 'Spam', folderKind: 'inbox', archived: false, isSpam: true, runInboundWorkflows: false },
    ]);
  });

  test('resolves server flags and nested folder names across delimiters', () => {
    expect(resolveSpamMailboxPath(baseAccount, [{ path: 'INBOX|Unwanted', name: 'Custom', delimiter: '|', flags: new Set(['\\junk']) }])).toBe('INBOX|Unwanted');
    expect(resolveArchiveMailboxPath(baseAccount, [{ path: 'INBOX.Archiv', name: 'Custom' }])).toBe('INBOX.Archiv');
    expect(resolveSpamMailboxPath({ sync_spam_folder_path: ' Personal ' }, [])).toBe('Personal');
  });

  test('does not invent a sent folder when the server lists only INBOX', () => {
    expect(resolveSentMailboxPath(baseAccount, [{ path: 'INBOX', name: 'INBOX' }])).toBeNull();
    expect(resolveSyncFoldersForAccount({ ...baseAccount, imap_sync_sent: 1 }, [{ path: 'INBOX', name: 'INBOX' }])).toHaveLength(1);
    expect(resolveSentMailboxPath({ sent_folder_path: '' }, [])).toBe('Sent');
  });
});
