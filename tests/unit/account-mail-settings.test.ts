import {
  buildDefaultAccountMailSettings,
  formatTicketSequence,
  normalizeAccountMailSettings,
  previewAccountTicketCode,
} from '../../shared/account-mail-settings';

describe('account mail settings', () => {
  test('buildDefaultAccountMailSettings derives prefix from email local part', () => {
    const settings = buildDefaultAccountMailSettings({
      id: 3,
      display_name: 'Shop A',
      email_address: 'support@shop-a.example',
    });
    expect(settings.ticketPrefix).toBe('SUPPORT3');
    expect(settings.ticketNextNumber).toBe(1);
    expect(settings.ticketNumberPadding).toBe(6);
    expect(settings.threadNamespace).toBe('support3-3');
  });

  test('normalizeAccountMailSettings clamps padding and formats preview', () => {
    const normalized = normalizeAccountMailSettings(
      {
        ticketPrefix: 'shop-b',
        ticketNextNumber: 42,
        ticketNumberPadding: 4,
        threadNamespace: 'shopb',
      },
      7,
    );
    expect(normalized.ticketPrefix).toBe('SHOPB');
    expect(formatTicketSequence(42, 4)).toBe('0042');
    expect(previewAccountTicketCode(normalized)).toBe('SHOPB-0042');
  });
});
