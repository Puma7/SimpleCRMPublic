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
    });

    expect(sentCorrespondents).toEqual(['first@example.com', 'second@example.com']);
    expect(threadCorrespondentsOverlap(sentCorrespondents, ['second@example.com'])).toBe(true);
    expect(threadCorrespondentsOverlap(sentCorrespondents, ['attacker@example.net'])).toBe(false);
  });
});
