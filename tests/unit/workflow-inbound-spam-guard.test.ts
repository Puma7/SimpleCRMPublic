import {
  messageIsSpamOrReviewForInboundWorkflow,
  parseDraftReviewResponse,
} from '@simplecrm/core';

describe('messageIsSpamOrReviewForInboundWorkflow', () => {
  it('detects spam via is_spam, spam_status and spam_score_label', () => {
    expect(messageIsSpamOrReviewForInboundWorkflow({ is_spam: true })).toBe(true);
    expect(messageIsSpamOrReviewForInboundWorkflow({ is_spam: 1 })).toBe(true);
    expect(messageIsSpamOrReviewForInboundWorkflow({ spam_status: 'spam' })).toBe(true);
    expect(messageIsSpamOrReviewForInboundWorkflow({ spam_status: 'review' })).toBe(true);
    expect(messageIsSpamOrReviewForInboundWorkflow({ spam_score_label: 'spam' })).toBe(true);
    expect(messageIsSpamOrReviewForInboundWorkflow({ spam_status: 'clean' })).toBe(false);
  });
});

describe('parseDraftReviewResponse (core)', () => {
  it('fail-closed to hold when format is missing', () => {
    expect(parseDraftReviewResponse('irgendwas').verdict).toBe('hold');
  });

  it('requires ANSWERED for SEND', () => {
    const parsed = parseDraftReviewResponse('STATUS: SEND\nREASON: ok');
    expect(parsed.verdict).toBe('hold');
  });
});
