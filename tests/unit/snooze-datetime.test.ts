import {
  computeSnoozeUntil,
  formatSnoozePresetLabel,
} from '../../shared/snooze-datetime';
import { DEFAULT_SNOOZE_SETTINGS } from '../../shared/snooze-settings';

describe('computeSnoozeUntil', () => {
  it('uses evening settings for tonight', () => {
    const now = new Date('2026-05-24T10:00:00');
    const until = computeSnoozeUntil('tonight', DEFAULT_SNOOZE_SETTINGS, now);
    expect(until).toContain('2026-05-24');
    const wake = new Date(until);
    expect(wake.getHours()).toBe(18);
    expect(wake.getMinutes()).toBe(0);
  });

  it('uses morning settings for tomorrow', () => {
    const now = new Date('2026-05-24T10:00:00');
    const until = computeSnoozeUntil('tomorrow', DEFAULT_SNOOZE_SETTINGS, now);
    const wake = new Date(until);
    expect(wake.getDate()).toBe(25);
    expect(wake.getHours()).toBe(9);
  });

  it('formats preset labels with configured times', () => {
    expect(formatSnoozePresetLabel('tonight', DEFAULT_SNOOZE_SETTINGS)).toContain('18:00');
    expect(formatSnoozePresetLabel('tomorrow', DEFAULT_SNOOZE_SETTINGS)).toContain('09:00');
  });
});
