import {
  serverUidValidityToString,
  storedUidValidityString,
  uidValidityAsOptionalNumber,
  uidValidityMismatch,
} from '../../packages/core/src/email';

describe('email-uidvalidity', () => {
  test('serverUidValidityToString', () => {
    expect(serverUidValidityToString(null)).toBeNull();
    expect(serverUidValidityToString(42n)).toBe('42');
    expect(serverUidValidityToString(7)).toBe('7');
  });

  test('storedUidValidityString prefers str column', () => {
    expect(storedUidValidityString({ uidvalidity: 1, uidvalidity_str: '99' })).toBe('99');
    expect(storedUidValidityString({ uidvalidity: 5, uidvalidity_str: null })).toBe('5');
    expect(storedUidValidityString({ uidvalidity: null, uidvalidity_str: null })).toBeNull();
  });

  test('uidValidityMismatch', () => {
    expect(uidValidityMismatch('1', '2')).toBe(true);
    expect(uidValidityMismatch('1', '1')).toBe(false);
    expect(uidValidityMismatch(null, '1')).toBe(false);
  });

  test('uidValidityAsOptionalNumber safe range', () => {
    expect(uidValidityAsOptionalNumber(100)).toBe(100);
    expect(uidValidityAsOptionalNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBeNull();
  });
});
