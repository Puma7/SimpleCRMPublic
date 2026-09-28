/**
 * Plan 047: Testlauf mit einer ausgewählten Mail statt einer eingetippten ID.
 * Die Auswahl zeigt die 20 neuesten Mails des passenden Ordners
 * (Posteingang bzw. Entwürfe für Ausgang) und hat die ID als Rückfall.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
}));

import { IPCChannels } from '@shared/ipc/channels';
import {
  WORKFLOW_TEST_MESSAGE_LIMIT,
  WorkflowTestMessagePicker,
  workflowTestMessageLabel,
} from '@/components/email/workflow/workflow-test-message-picker';

const inbox = [
  {
    id: 601,
    subject: 'Rückgabe meiner Jacke',
    from_json: JSON.stringify({ value: [{ name: 'Kunde', address: 'kunde@example.com' }] }),
    date_received: '2026-09-27T06:00:00Z',
  },
  { id: 602, subject: null, from_json: null, date_received: null },
];

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (channel: string, payload: { view: string }) => {
    if (channel !== IPCChannels.Email.ListMessagesByView) throw new Error(`unexpected ${channel}`);
    return payload.view === 'inbox' ? inbox : [];
  });
});

function Harness({ trigger }: { trigger: string }) {
  const [value, setValue] = React.useState('');
  return (
    <>
      <WorkflowTestMessagePicker trigger={trigger} value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  );
}

test('Eingang: neueste Mails mit Betreff · Absender · Datum, Auswahl liefert die ID', async () => {
  render(<Harness trigger="inbound" />);
  expect(await screen.findByRole('option', { name: /^Rückgabe meiner Jacke · Kunde <kunde@example.com> · / })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: '(ohne Betreff) · —' })).toBeInTheDocument();
  expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.ListMessagesByView, {
    accountId: 'all',
    view: 'inbox',
    limit: WORKFLOW_TEST_MESSAGE_LIMIT,
  });
  fireEvent.change(screen.getByLabelText('Test-Mail'), { target: { value: '601' } });
  expect(screen.getByTestId('value')).toHaveTextContent('601');
  expect(screen.queryByLabelText('Nachrichten-ID')).not.toBeInTheDocument();
});

test('Ausgang testet mit Entwürfen', async () => {
  render(<Harness trigger="outbound" />);
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(
    IPCChannels.Email.ListMessagesByView,
    expect.objectContaining({ view: 'drafts' }),
  ));
  expect(await screen.findByRole('option', { name: 'Keine Entwürfe gefunden' })).toBeInTheDocument();
});

test('Rückfall: Nachrichten-ID eintippen', async () => {
  render(<Harness trigger="inbound" />);
  await screen.findByRole('option', { name: /^Rückgabe meiner Jacke/ });
  fireEvent.change(screen.getByLabelText('Test-Mail'), { target: { value: '__manual__' } });
  fireEvent.change(screen.getByLabelText('Nachrichten-ID'), { target: { value: '4711' } });
  expect(screen.getByTestId('value')).toHaveTextContent('4711');
  expect(screen.getByLabelText('Test-Mail')).toHaveValue('__manual__');
});

test('Liste nicht ladbar: Auswahl bleibt nutzbar über die ID', async () => {
  mockInvoke.mockRejectedValue(new Error('offline'));
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    render(<Harness trigger="inbound" />);
    expect(await screen.findByRole('option', { name: 'Keine Mails gefunden' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Andere (Nachrichten-ID) …' })).toBeInTheDocument();
  } finally {
    spy.mockRestore();
  }
});

test('Beschriftung ohne Datum und Absender bleibt lesbar', () => {
  expect(workflowTestMessageLabel({ id: 1, subject: '  ', from_json: null, date_received: 'kaputt' }))
    .toBe('(ohne Betreff) · —');
});
