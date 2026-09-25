import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = jest.fn();
const mockDisableUserMfa = jest.fn(async () => ({ enabled: false }));
const mockEnableUserEmailMfa = jest.fn(async () => ({ enabled: true, method: 'email' }));
const mockConfirmUserTotpSetup = jest.fn(async () => ({ enabled: true, method: 'totp' }));

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: 'http', serverBaseUrl: 'https://crm.example.test' }),
  createServerAuthClient: () => ({
    getSession: () => ({ tokens: { accessToken: 'access-1' } }),
    disableUserMfa: (...args: unknown[]) => mockDisableUserMfa(...(args as [])),
    enableUserEmailMfa: (...args: unknown[]) => mockEnableUserEmailMfa(...(args as [])),
    beginUserTotpSetup: async () => ({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/SimpleCRM:me' }),
    confirmUserTotpSetup: (...args: unknown[]) => mockConfirmUserTotpSetup(...(args as [])),
  }),
  RendererTransportError: class RendererTransportError extends Error {},
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', role: 'admin' }, refresh: jest.fn() }),
}));

import { UsersPanel } from '@/components/settings/users-panel';

describe('users panel MFA step-up', () => {
  const rows = [
    { id: 'me', username: 'me@example.com', display_name: 'Ich', role: 'admin', is_active: 1, mfa_enabled: true, mfa_method: 'totp' },
    { id: 'other', username: 'other@example.com', display_name: 'Andere', role: 'user', is_active: 1, mfa_enabled: false },
  ];

  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async () => rows);
    mockDisableUserMfa.mockClear();
    mockEnableUserEmailMfa.mockClear();
    mockConfirmUserTotpSetup.mockClear();
  });

  // F-A1-06: MFA changes went out without the current password, which the server now requires.
  test('asks for the current password before switching MFA off', async () => {
    render(<UsersPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '2FA deaktivieren' }));

    expect(mockDisableUserMfa).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Ihr aktuelles Passwort'), { target: { value: 'mein-passwort-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));

    await waitFor(() => expect(mockDisableUserMfa).toHaveBeenCalledWith('access-1', 'me', { currentPassword: 'mein-passwort-123' }));
  });

  test('asks for the current password before enabling e-mail MFA', async () => {
    render(<UsersPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'E-Mail-2FA aktivieren' }));

    expect(mockEnableUserEmailMfa).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Ihr aktuelles Passwort'), { target: { value: 'mein-passwort-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));

    await waitFor(() => expect(mockEnableUserEmailMfa).toHaveBeenCalledWith('access-1', 'other', { currentPassword: 'mein-passwort-123' }));
  });

  test('sends the current password with the authenticator confirmation', async () => {
    render(<UsersPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Authenticator einrichten' }));

    fireEvent.change(await screen.findByLabelText('Bestaetigungscode'), { target: { value: '123456' } });
    expect(screen.getByRole('button', { name: 'Aktivieren' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Ihr aktuelles Passwort'), { target: { value: 'mein-passwort-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aktivieren' }));

    await waitFor(() => expect(mockConfirmUserTotpSetup).toHaveBeenCalledWith('access-1', 'other', {
      secret: 'JBSWY3DPEHPK3PXP',
      code: '123456',
      currentPassword: 'mein-passwort-123',
    }));
  });
});
