import {
  resolveSyncFoldersForAccount,
  resolveArchiveMailboxPath,
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

  test('resolveArchiveMailboxPath uses special use', () => {
    const path = resolveArchiveMailboxPath(baseAccount, [
      { path: 'Archive', name: 'Archive', delimiter: '/', specialUse: '\\Archive', flags: new Set() },
    ]);
    expect(path).toBe('Archive');
  });
});
