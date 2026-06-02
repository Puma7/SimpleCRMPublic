import { resolveThreadListKey, normalizeSubject } from '../../electron/email/email-thread-resolve';

describe('normalizeSubject', () => {
  it('strips re/fwd prefixes', () => {
    expect(normalizeSubject('Re: Fwd: Hello')).toBe('hello');
  });
});

describe('resolveThreadListKey', () => {
  const base = {
    id: 1,
    account_id: 2,
    ticket_code: null,
    imap_thread_id: null,
    thread_id: null,
    subject: 'Hello',
    from_json: '{"value":[{"address":"a@b.com"}]}',
  };

  it('prefers ticket_code over thread_id', () => {
    const r = resolveThreadListKey({
      ...base,
      ticket_code: 'T-99',
      thread_id: 'thread-abc',
      imap_thread_id: 'imap-1',
    });
    expect(r.key).toBe('ticket:T-99');
    expect(r.confidence).toBe('high');
  });

  it('uses imap before thread_id', () => {
    const r = resolveThreadListKey({
      ...base,
      imap_thread_id: 'imap-1',
      thread_id: 'thread-abc',
    });
    expect(r.key).toBe('imap:2:imap-1');
  });

  it('uses thread_id before heuristic', () => {
    const r = resolveThreadListKey({
      ...base,
      thread_id: 'thread-abc',
    });
    expect(r.key).toBe('thread:thread-abc');
  });
});
