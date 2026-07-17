import {
  threadCorrespondentEmail,
  threadCorrespondentEmails,
  threadCorrespondentsOverlap,
} from '../../packages/server/src/db/postgres-mail-metadata-read-ports';

const recipient = (address: string) => JSON.stringify({ value: [{ address }] });

describe('reference-thread correspondent continuity', () => {
  test('uses the external sender for inbound mail and recipient for sent mail', () => {
    expect(threadCorrespondentEmail({
      folderKind: 'inbox',
      fromJson: recipient('Customer+case@Example.COM'),
      toJson: recipient('agent@example.com'),
    })).toBe('customer@example.com');
    expect(threadCorrespondentEmail({
      folderKind: 'sent',
      fromJson: recipient('agent@example.com'),
      toJson: recipient('customer@example.com'),
    })).toBe('customer@example.com');
  });

  test('keeps an unrelated forged-reference sender distinct', () => {
    const legitimate = threadCorrespondentEmail({
      folderKind: 'inbox',
      fromJson: recipient('customer@example.com'),
      toJson: recipient('agent@example.com'),
    });
    const forged = threadCorrespondentEmail({
      folderKind: 'inbox',
      fromJson: recipient('attacker@example.net'),
      toJson: recipient('agent@example.com'),
    });
    expect(forged).not.toBe(legitimate);
  });

  test('keeps every external recipient on sent mail eligible for a reply thread', () => {
    const sentCorrespondents = threadCorrespondentEmails({
      folderKind: 'sent',
      fromJson: recipient('agent@example.com'),
      toJson: JSON.stringify({
        value: [
          { address: 'first@example.com' },
          { address: 'Second+case@Example.COM' },
        ],
      }),
      ccJson: recipient('copy@example.com'),
      bccJson: recipient('hidden@example.com'),
    });

    expect(sentCorrespondents).toEqual([
      'first@example.com',
      'second@example.com',
      'copy@example.com',
      'hidden@example.com',
    ]);
    expect(threadCorrespondentsOverlap(sentCorrespondents, ['second@example.com'])).toBe(true);
    expect(threadCorrespondentsOverlap(sentCorrespondents, ['attacker@example.net'])).toBe(false);
  });

  test('treats account-authored archive copies (inbox kind) as sent mail', () => {
    // Archive/All-Mail folders sync with folderKind 'inbox'; a sent copy
    // living only there must expose its recipients, not the own address.
    expect(threadCorrespondentEmails({
      folderKind: 'inbox',
      fromJson: recipient('Agent+alias@Example.COM'),
      toJson: recipient('customer@example.com'),
      ccJson: recipient('copy@example.com'),
      accountEmails: ['agent@example.com'],
    })).toEqual(['customer@example.com', 'copy@example.com']);

    // Foreign senders stay sender-based even when accountEmails is supplied.
    expect(threadCorrespondentEmails({
      folderKind: 'inbox',
      fromJson: recipient('customer@example.com'),
      toJson: recipient('agent@example.com'),
      accountEmails: ['agent@example.com'],
    })).toEqual(['customer@example.com']);

    // Without accountEmails the previous behavior is unchanged.
    expect(threadCorrespondentEmails({
      folderKind: 'inbox',
      fromJson: recipient('agent@example.com'),
      toJson: recipient('customer@example.com'),
    })).toEqual(['agent@example.com']);
  });
});
