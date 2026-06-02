import {
  clearEmailAccountSyncLock,
  EmailSyncAbortedError,
  withEmailAccountSyncLock,
} from '../../electron/email/email-sync-mutex';

describe('email-sync-mutex', () => {
  test('serializes concurrent sync per account', async () => {
    const order: number[] = [];
    const p1 = withEmailAccountSyncLock(1, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      order.push(2);
    });
    const p2 = withEmailAccountSyncLock(1, async () => {
      order.push(3);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2, 3]);
  });

  test('clearEmailAccountSyncLock allows fresh chain', async () => {
    clearEmailAccountSyncLock(99);
    await withEmailAccountSyncLock(99, async () => 'ok');
    clearEmailAccountSyncLock(99);
    const v = await withEmailAccountSyncLock(99, async () => 'x');
    expect(v).toBe('x');
  });

  test('propagates rejection but keeps chain alive', async () => {
    clearEmailAccountSyncLock(2);
    await expect(
      withEmailAccountSyncLock(2, async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    const ok = await withEmailAccountSyncLock(2, async () => true);
    expect(ok).toBe(true);
  });

  test('clearEmailAccountSyncLock aborts in-flight sync', async () => {
    clearEmailAccountSyncLock(7);
    let sawAbort = false;
    const running = withEmailAccountSyncLock(7, async (signal) => {
      await new Promise((r) => setTimeout(r, 80));
      if (signal.aborted) sawAbort = true;
      if (signal.aborted) throw new EmailSyncAbortedError();
      return 'done';
    });
    await new Promise((r) => setTimeout(r, 10));
    clearEmailAccountSyncLock(7);
    await expect(running).rejects.toThrow(EmailSyncAbortedError);
    expect(sawAbort).toBe(true);
    const after = await withEmailAccountSyncLock(7, async () => 'ok');
    expect(after).toBe('ok');
  });
});
