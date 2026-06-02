jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
  getSyncInfo: jest.fn(() => null),
  setSyncInfo: jest.fn(),
}));

import { normalizeSpamPattern, selectSpamListMatch } from '../../electron/email/email-spam-store';
import type { SpamListEntry } from '../../electron/email/email-spam-types';

function messageFrom(address: string): never {
  return {
    id: 1,
    account_id: 1,
    from_json: JSON.stringify({ value: [{ address }] }),
    subject: '',
    snippet: '',
    body_text: '',
    body_html: null,
    auth_spf: null,
    auth_dkim: null,
    auth_dmarc: null,
    auth_arc: null,
    attachments_json: null,
    has_attachments: 0,
  } as never;
}

function entry(
  listType: SpamListEntry['list_type'],
  patternType: SpamListEntry['pattern_type'],
  pattern: string,
): SpamListEntry {
  return {
    id: 1,
    list_type: listType,
    pattern_type: patternType,
    pattern,
    account_id: null,
    note: null,
    created_at: '2026-06-02T00:00:00.000Z',
    updated_at: '2026-06-02T00:00:00.000Z',
  };
}

describe('email spam list matching', () => {
  test('normalizes legacy-style domain and email patterns', () => {
    expect(normalizeSpamPattern(' @Example.COM ')).toEqual({
      pattern: 'example.com',
      patternType: 'domain',
    });
    expect(normalizeSpamPattern('User@Example.COM')).toEqual({
      pattern: 'user@example.com',
      patternType: 'email',
    });
  });

  test('allowlist wins before a more specific blocklist match', () => {
    const match = selectSpamListMatch(
      [
        entry('block', 'email', 'vip@example.com'),
        entry('allow', 'domain', 'example.com'),
      ],
      messageFrom('vip@example.com'),
    );

    expect(match).toMatchObject({
      listType: 'allow',
      patternType: 'domain',
      pattern: 'example.com',
    });
  });

  test('matches exact domains and subdomains with specificity', () => {
    expect(
      selectSpamListMatch([entry('block', 'domain', 'example.com')], messageFrom('a@example.com')),
    ).toMatchObject({ listType: 'block', specificity: 80 });

    expect(
      selectSpamListMatch([entry('block', 'domain', 'example.com')], messageFrom('a@mail.example.com')),
    ).toMatchObject({ listType: 'block', specificity: 60 });
  });

  test('does not match sibling domains', () => {
    expect(
      selectSpamListMatch([entry('block', 'domain', 'example.com')], messageFrom('a@badexample.com')),
    ).toBeNull();
  });
});
