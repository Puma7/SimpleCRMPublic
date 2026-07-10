import { render, screen } from '@testing-library/react';

import { MessageAddressesBlock } from '@/components/email/message-addresses-block';
import type { EmailMessage } from '@/components/email/types';

function message(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 1,
    account_id: 1,
    folder_id: 1,
    uid: 1,
    subject: 'Hallo',
    snippet: null,
    date_received: '2026-01-02T10:00:00.000Z',
    from_json: JSON.stringify({ value: [{ name: 'Anna Kundin', address: 'anna@kunde.de' }] }),
    to_json: JSON.stringify({ value: [{ address: 'team@firma.de' }] }),
    cc_json: null,
    bcc_json: null,
    body_text: null,
    body_html: null,
    seen_local: 1,
    folder_kind: 'inbox',
    ...overrides,
  } as EmailMessage;
}

describe('MessageAddressesBlock', () => {
  test('renders sender name, real address, recipients and ticket code', () => {
    render(<MessageAddressesBlock message={message({ ticket_code: 'T-42' })} />);

    expect(screen.getByText('Von:')).toBeInTheDocument();
    expect(screen.getByText('Anna Kundin')).toBeInTheDocument();
    expect(screen.getByText('anna@kunde.de')).toBeInTheDocument();
    expect(screen.getByText('team@firma.de')).toBeInTheDocument();
    expect(screen.getByText('T-42')).toBeInTheDocument();
    // A trustworthy sender must not raise the spoofing alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('flags a spoofed sender whose display name hides a different address', () => {
    render(
      <MessageAddressesBlock
        message={message({
          from_json: JSON.stringify({
            value: [{ name: 'service@paypal.com', address: 'attacker@evil.example' }],
          }),
        })}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Verdacht auf verschleierten Absender/);
    // The real (dangerous) address is surfaced verbatim.
    expect(screen.getByText('attacker@evil.example')).toBeInTheDocument();
  });
});
