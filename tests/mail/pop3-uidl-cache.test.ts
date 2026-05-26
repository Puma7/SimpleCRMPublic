import {
  POP3_UIDL_PERSIST_MAX,
  parseLegacyPop3UidlStr,
  serializePop3ServerUidls,
} from '../../electron/email/pop3-uidl-cache';

describe('pop3-uidl-cache', () => {
  test('serializePop3ServerUidls dedupes sorts and caps', () => {
    const small = serializePop3ServerUidls(['b', 'a', 'b', '']);
    expect(JSON.parse(small)).toEqual(['a', 'b']);
    const many = serializePop3ServerUidls(
      Array.from({ length: POP3_UIDL_PERSIST_MAX + 5 }, (_, i) => `u${String(i).padStart(6, '0')}`),
    );
    const parsed = JSON.parse(many) as string[];
    expect(parsed.length).toBe(POP3_UIDL_PERSIST_MAX);
    expect(parsed[0]).toBe('u000005');
  });

  test('parseLegacyPop3UidlStr handles empty invalid and non-array', () => {
    expect(parseLegacyPop3UidlStr(null).size).toBe(0);
    expect(parseLegacyPop3UidlStr('  ').size).toBe(0);
    expect(parseLegacyPop3UidlStr('not-json').size).toBe(0);
    expect(parseLegacyPop3UidlStr(JSON.stringify({ x: 1 })).size).toBe(0);
  });

  test('parseLegacyPop3UidlStr collects strings and caps', () => {
    const items = Array.from({ length: POP3_UIDL_PERSIST_MAX + 3 }, (_, i) => `id${i}`);
    const set = parseLegacyPop3UidlStr(JSON.stringify(items));
    expect(set.size).toBe(POP3_UIDL_PERSIST_MAX);
    expect(set.has('id0')).toBe(true);
    const mixed = parseLegacyPop3UidlStr(JSON.stringify([' ok ', '', 42, 'trim']));
    expect(mixed.has(' ok ')).toBe(true);
    expect(mixed.has('trim')).toBe(true);
    expect(mixed.size).toBe(2);
  });
});
