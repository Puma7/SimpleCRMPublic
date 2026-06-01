import {
  resolveSyncFoldersForAccount,
  resolveArchiveMailboxPath,
  resolveSentMailboxPath,
  orderedSentMailboxCandidates,
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
});
