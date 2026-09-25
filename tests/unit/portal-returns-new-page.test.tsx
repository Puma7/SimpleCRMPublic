import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { IPCChannels } from '@shared/ipc/channels';

const invokeMock = jest.fn();
const verifyCaptchaMock = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => invokeMock(...args),
  getRendererTransport: () => ({ kind: 'http', serverBaseUrl: 'https://crm.example' }),
  createServerAuthClient: () => ({ verifyCaptcha: (...args: unknown[]) => verifyCaptchaMock(...args) }),
}));

jest.mock('@tanstack/react-router', () => ({
  useParams: () => ({ token: 'portal-token' }),
}));

import PortalReturnsNewPage from '@/app/portal/returns-new/page';

type TurnstileOptions = { sitekey: string; callback: (token: string) => void };

let turnstileRender: jest.Mock;

function mockChannels(config: unknown) {
  invokeMock.mockImplementation(async (channel: string) => {
    if (channel === IPCChannels.Returns.PortalConfig) return config;
    if (channel === IPCChannels.Returns.PortalCreate) {
      return {
        returnNumber: 'R-CAFE0001',
        status: 'pending',
        outcome: null,
        jtlOrderNumber: null,
        createdAt: '2026-06-09T05:00:00.000Z',
      };
    }
    throw new Error(`unexpected channel ${channel}`);
  });
}

function createCall() {
  return invokeMock.mock.calls.find(([channel]) => channel === IPCChannels.Returns.PortalCreate);
}

beforeEach(() => {
  invokeMock.mockReset();
  verifyCaptchaMock.mockReset();
  turnstileRender = jest.fn(() => 'widget-1');
  window.turnstile = { render: turnstileRender, reset: jest.fn() };
});

afterEach(() => {
  delete window.turnstile;
});

// F-A3a-03: the portal form never rendered a CAPTCHA and never sent a challenge, so a
// CAPTCHA-protected workspace could not accept any return.
describe('PortalReturnsNewPage CAPTCHA', () => {
  test('renders Turnstile when the portal requires it and sends the verified challenge', async () => {
    mockChannels({ captchaRequired: true, siteKey: 'site-key' });
    verifyCaptchaMock.mockResolvedValue('challenge-1');

    render(<PortalReturnsNewPage />);

    await waitFor(() => expect(turnstileRender).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith(IPCChannels.Returns.PortalConfig, { token: 'portal-token' });
    const options = turnstileRender.mock.calls[0]![1] as TurnstileOptions;
    expect(options.sitekey).toBe('site-key');

    fireEvent.change(screen.getByPlaceholderText('SKU / Artikelnummer'), { target: { value: 'SKU-A' } });
    const submit = screen.getByRole('button', { name: /Retoure absenden/ });
    expect(submit).toBeDisabled();

    await act(async () => {
      options.callback('turnstile-token');
    });
    expect(verifyCaptchaMock).toHaveBeenCalledWith('turnstile-token');
    await waitFor(() => expect(submit).not.toBeDisabled());

    fireEvent.click(submit);
    await waitFor(() => expect(createCall()).toBeDefined());
    expect(createCall()![1]).toMatchObject({ token: 'portal-token', captchaChallenge: 'challenge-1' });
    await screen.findByTestId('portal-success');
  });

  test('submits without a widget or challenge when the portal needs no CAPTCHA', async () => {
    mockChannels({ captchaRequired: false, siteKey: null });

    render(<PortalReturnsNewPage />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      IPCChannels.Returns.PortalConfig,
      { token: 'portal-token' },
    ));
    fireEvent.change(screen.getByPlaceholderText('SKU / Artikelnummer'), { target: { value: 'SKU-A' } });
    const submit = screen.getByRole('button', { name: /Retoure absenden/ });
    await waitFor(() => expect(submit).not.toBeDisabled());

    fireEvent.click(submit);
    await waitFor(() => expect(createCall()).toBeDefined());
    expect(createCall()![1]).not.toHaveProperty('captchaChallenge');
    expect(turnstileRender).not.toHaveBeenCalled();
  });
});
