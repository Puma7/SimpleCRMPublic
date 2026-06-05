import {
  POP3_UIDL_PERSIST_MAX,
  parseLegacyPop3UidlStr,
  serializePop3ServerUidls,
} from '../../packages/core/src/email';

describe('pop3-uidl-cache', () => {
  it('serializes current server UIDLs sorted and deduped', () => {
    const json = serializePop3ServerUidls(['b', 'a', 'b']);
    expect(JSON.parse(json)).toEqual(['a', 'b']);
  });

  it('caps persisted server UIDL list', () => {
    const many = Array.from({ length: POP3_UIDL_PERSIST_MAX + 100 }, (_, i) => `uid-${String(i).padStart(6, '0')}`);
    const json = serializePop3ServerUidls(many);
    const parsed = JSON.parse(json) as string[];
    expect(parsed.length).toBe(POP3_UIDL_PERSIST_MAX);
    expect(parsed[0]).toBe('uid-000100');
    expect(parsed[parsed.length - 1]).toBe(`uid-${String(POP3_UIDL_PERSIST_MAX + 99).padStart(6, '0')}`);
  });

  it('parseLegacyPop3UidlStr ignores invalid JSON', () => {
    expect(parseLegacyPop3UidlStr('not-json').size).toBe(0);
    expect(parseLegacyPop3UidlStr('["a","b"]').has('a')).toBe(true);
  });
});
