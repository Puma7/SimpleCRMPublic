import {
  parseScheduledSendDraftStateFromValues,
  scheduledSendFailuresKey,
  scheduledSendLastErrorKey,
  scheduledSendStatusKey,
  scheduledSendSyncInfoKeys,
  truncateScheduledSendError,
} from '../../packages/core/src/email';

describe('core scheduled send state helpers', () => {
  test('uses stable sync-info keys', () => {
    expect(scheduledSendSyncInfoKeys(42)).toEqual([
      'scheduled_send_failures:42',
      'scheduled_send_status:42',
      'scheduled_send_last_error:42',
    ]);
  });

  test('normalizes scheduled-send state from sync-info values', () => {
    const values = new Map<string, string | null>([
      [scheduledSendFailuresKey(42), '3'],
      [scheduledSendStatusKey(42), 'pending'],
      [scheduledSendLastErrorKey(42), 'smtp timeout'],
    ]);

    expect(parseScheduledSendDraftStateFromValues(values, 42)).toEqual({
      failureCount: 3,
      status: 'pending',
      lastError: 'smtp timeout',
    });
  });

  test('falls back safely for invalid or empty values', () => {
    const values = new Map<string, string | null>([
      [scheduledSendFailuresKey(42), '-2'],
      [scheduledSendStatusKey(42), 'unknown'],
      [scheduledSendLastErrorKey(42), ''],
    ]);

    expect(parseScheduledSendDraftStateFromValues(values, 42)).toEqual({
      failureCount: 0,
      status: 'ok',
      lastError: null,
    });
  });

  test('truncates stored scheduled-send errors to the legacy limit', () => {
    expect(truncateScheduledSendError('x'.repeat(2100))).toHaveLength(2000);
  });
});
