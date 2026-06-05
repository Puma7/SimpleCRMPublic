import {
  findSentMailboxOnServer,
  normalizeMailboxName,
  pickFirstMailboxPathOnServer,
  resolveSentMailboxCandidates,
} from '../../packages/core/src/email';

describe('imap mailbox names', () => {
  test('normalizes localized mailbox names', () => {
    expect(normalizeMailboxName(' Gesendete-Objekte ')).toBe('gesendete objekte');
  });

  test('prefers advertised sent mailbox candidates before generic fallbacks', () => {
    const listed = [
      {
        path: 'INBOX/Gesendet',
        name: 'Gesendet',
        delimiter: '/',
        specialUse: '\\Sent',
        flags: new Set(['\\Sent']),
      },
    ];

    const candidates = resolveSentMailboxCandidates('Sent', listed);

    expect(candidates[0]).toBe('Sent');
    expect(candidates).toContain('INBOX/Gesendet');
    expect(findSentMailboxOnServer(listed)).toBe('INBOX/Gesendet');
    expect(pickFirstMailboxPathOnServer(candidates, listed)).toBe('INBOX/Gesendet');
  });
});
