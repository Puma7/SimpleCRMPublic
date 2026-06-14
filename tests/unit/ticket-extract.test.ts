import {
  extractTicketFromSubject,
  generateTicketCode,
} from '../../packages/core/src/email/ticket';

describe('extractTicketFromSubject', () => {
  test('extracts legacy SCR ticket codes from subject', () => {
    const code = generateTicketCode();
    expect(extractTicketFromSubject(`Re: [${code}] Hello`)).toBe(code);
  });

  test('rejects third-party ticket-like subjects by default', () => {
    expect(extractTicketFromSubject('[JIRA-1234] Deploy failed')).toBeNull();
    expect(extractTicketFromSubject('[PR-42] Review requested')).toBeNull();
    expect(extractTicketFromSubject('[DHL-9876543210987654] Shipment update')).toBeNull();
  });

  test('accepts registered account prefixes when provided', () => {
    expect(
      extractTicketFromSubject('[SHOPA-000042] Order question', {
        allowedPrefixes: ['SHOPA'],
      }),
    ).toBe('SHOPA-000042');
    expect(
      extractTicketFromSubject('[JIRA-1234] Deploy failed', {
        allowedPrefixes: ['SHOPA'],
      }),
    ).toBeNull();
  });
});
