import {
  matchSenderList,
  evaluateSenderFilter,
  extractSenderEmail,
  BUILTIN_TRUSTED_SENDER_ENTRIES,
} from '../../electron/workflow/sender-filter';
import { evaluateSenderFilterFromLists } from '../../packages/core/src/workflow';

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn((key: string) => {
    if (key === 'workflow_sender_whitelist') return 'buchhaltung@firma.de';
    if (key === 'workflow_sender_blacklist') return 'spam.bad.com';
    return null;
  }),
}));

describe('workflow sender filter', () => {
  test('extractSenderEmail from display name', () => {
    expect(extractSenderEmail('PayPal <service@paypal.com>')).toBe('service@paypal.com');
  });

  test('matchSenderList by domain', () => {
    expect(matchSenderList('Shop <noreply@amazon.de>', ['amazon.de'])).toBe(true);
    expect(matchSenderList('x@other.com', ['amazon.de'])).toBe(false);
  });

  test('builtin trusted matches paypal', () => {
    expect(matchSenderList('PayPal <notify@paypal.com>', BUILTIN_TRUSTED_SENDER_ENTRIES)).toBe(
      true,
    );
  });

  test('evaluateSenderFilter respects global whitelist', () => {
    expect(evaluateSenderFilter('Buchhaltung <buchhaltung@firma.de>')).toBe('whitelist');
  });

  test('evaluateSenderFilter respects global blacklist', () => {
    expect(evaluateSenderFilter('Spammer <x@spam.bad.com>')).toBe('blacklist');
  });

  test('unknown sender is default', () => {
    expect(evaluateSenderFilter('Someone <random@unknown.org>')).toBe('default');
  });

  test('core evaluator works from explicit lists without sqlite globals', () => {
    expect(
      evaluateSenderFilterFromLists('Ops <ops@example.test>', {
        whitelist: ['example.test'],
        blacklist: ['blocked.example'],
        useBuiltinTrusted: false,
      }),
    ).toBe('whitelist');
  });
});
