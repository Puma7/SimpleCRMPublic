import { buildCustomerEmailMap } from '../../electron/email/email-crm-store';

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    prepare: () => ({
      all: () => [
        { id: 10, email: 'Contact@Acme.COM' },
        { id: 11, email: 'other@example.com' },
      ],
    }),
  }),
}));

describe('buildCustomerEmailMap', () => {
  it('normalizes emails to lowercase keys', () => {
    const map = buildCustomerEmailMap();
    expect(map.get('contact@acme.com')).toBe(10);
    expect(map.get('other@example.com')).toBe(11);
    expect(map.size).toBe(2);
  });
});
