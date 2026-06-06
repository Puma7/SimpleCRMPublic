import {
  createServerLogStore,
  redactSecrets,
  type ServerLogFileSystem,
} from '../../packages/server/src';

describe('server log store', () => {
  test('captures warn+ entries and filters by level', () => {
    const store = createServerLogStore({ now: () => new Date('2026-07-08T10:00:00.000Z') });
    store.capture({ level: 'warn', message: 'a warning', source: 'pino' });
    store.capture({ level: 'error', message: 'an error' });
    store.capture({ level: 'fatal', message: 'fatal!' });

    expect(store.recent().map((e) => e.message)).toEqual(['a warning', 'an error', 'fatal!']);
    expect(store.recent({ level: 'error' }).map((e) => e.message)).toEqual(['an error', 'fatal!']);
    expect(store.recent()[0]).toMatchObject({ level: 'warn', source: 'pino', time: '2026-07-08T10:00:00.000Z' });
  });

  test('selfTest writes info/warn/error sample entries through the capture pipeline', () => {
    const store = createServerLogStore();
    const written = store.selfTest();
    expect(written).toBe(3);
    // Default (warn+) view hides the info entry; the "all" (info) view shows it.
    expect(store.recent().map((e) => e.level)).toEqual(['warn', 'error']);
    const all = store.recent({ level: 'info' });
    expect(all.map((e) => e.level)).toEqual(['info', 'warn', 'error']);
    expect(all.every((e) => e.source === 'self-test')).toBe(true);
  });

  test('respects the ring buffer cap and limit', () => {
    const store = createServerLogStore({ maxEntries: 3 });
    for (let i = 1; i <= 6; i++) store.capture({ level: 'warn', message: `m${i}` });
    expect(store.count()).toBe(3);
    expect(store.recent().map((e) => e.message)).toEqual(['m4', 'm5', 'm6']);
    expect(store.recent({ limit: 2 }).map((e) => e.message)).toEqual(['m5', 'm6']);
  });

  test('clear empties the buffer', () => {
    const store = createServerLogStore();
    store.capture({ level: 'error', message: 'boom' });
    store.clear();
    expect(store.count()).toBe(0);
    expect(store.recent()).toEqual([]);
  });

  test('redacts secrets from captured messages', () => {
    const store = createServerLogStore();
    store.capture({ level: 'error', message: 'login failed password=hunter2 for user' });
    store.capture({ level: 'error', message: 'header Authorization: Bearer abc.def.ghi' });
    expect(store.recent()[0].message).toContain('password=[redacted]');
    expect(store.recent()[0].message).not.toContain('hunter2');
    expect(store.recent()[1].message).toContain('Bearer [redacted]');
    expect(redactSecrets('token: "s3cr3t"')).toBe('token: "[redacted]"');
  });

  test('persists to the file and reloads on restart (survives rebuild)', () => {
    const files = new Map<string, string>();
    const dirs = new Set<string>(['/data']);
    const fs: ServerLogFileSystem = {
      existsSync: (p) => files.has(p) || dirs.has(p),
      readFileSync: (p) => files.get(p) ?? '',
      appendFileSync: (p, d) => files.set(p, (files.get(p) ?? '') + d),
      writeFileSync: (p, d) => files.set(p, d),
      mkdirSync: (p) => { dirs.add(p); },
      dirname: () => '/data',
    };
    const path = '/data/server-log.jsonl';

    const first = createServerLogStore({ filePath: path, fs });
    first.capture({ level: 'warn', message: 'persisted warning' });
    first.capture({ level: 'error', message: 'persisted error' });

    // New store instance (simulates container restart) loads from the same file.
    const second = createServerLogStore({ filePath: path, fs });
    expect(second.recent().map((e) => e.message)).toEqual(['persisted warning', 'persisted error']);
  });
});
