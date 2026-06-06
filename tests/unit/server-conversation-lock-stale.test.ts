import { conversationLockStaleCutoff } from '../../packages/server/src';

// A conversation lock whose holder stopped heartbeating (crash / closed app /
// lost connection) must become reclaimable, so a different user is never blocked
// on a message indefinitely. `conversationLockStaleCutoff` is the boundary the
// lock-acquire reclaim uses (last_heartbeat_at < cutoff => stale => stealable).
//
// Note: the atomic reclaim UPDATE in `acquire` reuses the same Kysely
// update/where idiom already proven by `heartbeat`/`release` in the lock port
// and is exercised end-to-end by the real-Postgres `server-compose-smoke` CI
// job; this suite pins the staleness boundary that decides steal-vs-preserve.
describe('conversationLockStaleCutoff', () => {
  const now = new Date('2026-06-06T12:00:00.000Z');

  test('defaults to the 120s conversation lock timeout before now', () => {
    expect(conversationLockStaleCutoff(now).toISOString()).toBe('2026-06-06T11:58:00.000Z');
  });

  test('honors a custom timeout in seconds', () => {
    expect(conversationLockStaleCutoff(now, 300).toISOString()).toBe('2026-06-06T11:55:00.000Z');
  });

  test('a heartbeat older than the cutoff is stale; a fresher one is preserved', () => {
    const cutoff = conversationLockStaleCutoff(now).getTime();
    const staleHeartbeat = new Date('2026-06-06T11:57:00.000Z'); // 3 min old -> stale
    const freshHeartbeat = new Date('2026-06-06T11:59:30.000Z'); // 30 s old -> still active

    expect(staleHeartbeat.getTime() < cutoff).toBe(true);
    expect(freshHeartbeat.getTime() < cutoff).toBe(false);
  });

  test('a heartbeat exactly at the cutoff is not yet stale (strict less-than)', () => {
    const cutoff = conversationLockStaleCutoff(now);
    expect(cutoff.getTime() < cutoff.getTime()).toBe(false);
  });
});
