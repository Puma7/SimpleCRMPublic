import { formatEmailSyncError } from '../../shared/email-sync-error-hint';

describe('formatEmailSyncError', () => {
  test('adds settings hint for oauth errors', () => {
    expect(formatEmailSyncError('Google OAuth: refresh failed', 2)).toContain('E-Mail-Einstellungen');
    expect(formatEmailSyncError('Google OAuth: refresh failed', 2)).toContain('2');
  });

  test('adds cron hint', () => {
    expect(formatEmailSyncError('Invalid cron expression', 1)).toContain('Cron');
  });

  test('passes through generic errors', () => {
    expect(formatEmailSyncError('Network timeout', 3)).toBe('Network timeout');
  });
});
