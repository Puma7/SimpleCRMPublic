import fs from 'node:fs';
import path from 'node:path';

import {
  inboundLagSeconds,
  mergeJobQueueDiagnostics,
  scheduledSendFailuresFromSyncInfo,
} from '../../packages/server/src/db/postgres-mail-diagnostics-port';

describe('server mail operations diagnostics', () => {
  test('never loads unbounded sync_info payloads such as RFC822 commit snapshots', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/server/src/db/postgres-mail-diagnostics-port.ts'),
      'utf8',
    );

    expect(source).not.toContain(".select(['key', 'value'])");
    expect(source).toContain('left(value, 65536)');
  });

  test('derives only valid failed scheduled sends from sync markers', () => {
    expect(scheduledSendFailuresFromSyncInfo([
      { key: 'scheduled_send_status:44', value: 'failed' },
      { key: 'scheduled_send_failures:44', value: '5' },
      { key: 'scheduled_send_last_error:44', value: 'SMTP timeout' },
      { key: 'scheduled_send_status:not-an-id', value: 'failed' },
      { key: 'scheduled_send_status:45', value: 'pending' },
    ])).toEqual([{
      messageId: 44,
      failureCount: 5,
      lastError: 'SMTP timeout',
    }]);
  });

  test('calculates inbound lag from the oldest valid account sync without negative values', () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    expect(inboundLagSeconds([
      { id: 1, email: 'a@example.com', protocol: 'imap', inboxLastSyncedAt: '2026-07-14T11:59:00.000Z' },
      { id: 2, email: 'b@example.com', protocol: 'imap', inboxLastSyncedAt: '2026-07-14T10:00:00.000Z' },
      { id: 3, email: 'c@example.com', protocol: 'imap', inboxLastSyncedAt: 'invalid' },
      { id: 4, email: 'd@example.com', protocol: 'imap', inboxLastSyncedAt: '2026-07-14T13:00:00.000Z' },
    ], now)).toBe(7200);
    expect(inboundLagSeconds([], now)).toBeNull();
  });

  test('merges queue engines while keeping terminal jobs out of ready counts', () => {
    const merged = mergeJobQueueDiagnostics({
      ready: 2,
      locked: 1,
      deadLetter: 1,
      workflowDeadLetter: 1,
      postProcessRetrying: 1,
      lagSeconds: 20,
      oldestLockedSeconds: 10,
      samples: [{
        id: 8,
        type: 'workflow.execute',
        attempts: 3,
        maxAttempts: 3,
        lockedBy: null,
        lockedSeconds: null,
        lastError: 'failed',
        engine: 'graphile',
        terminal: true,
      }],
    }, {
      ready: 3,
      locked: 2,
      deadLetter: 2,
      workflowDeadLetter: 0,
      postProcessRetrying: 2,
      lagSeconds: 50,
      oldestLockedSeconds: 30,
      samples: [],
    });

    expect(merged).toEqual(expect.objectContaining({
      ready: 5,
      locked: 3,
      deadLetter: 3,
      workflowDeadLetter: 1,
      postProcessRetrying: 3,
      lagSeconds: 50,
      oldestLockedSeconds: 30,
    }));
    expect(merged.samples[0]).toEqual(expect.objectContaining({ terminal: true }));
  });
});
