import { fireEvent, render, screen } from '@testing-library/react';

const mockInvokeRenderer = jest.fn();

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({ authRequired: true, user: { id: 'user-a' } }),
}));

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
  RendererTransportError: class RendererTransportError extends Error {},
}));

import { ChangePasswordCard } from '@/components/settings/change-password-card';

describe('change password card', () => {
  // F-A1-07: the card allowed 10-character passwords while every other password form requires the shared minimum of 12.
  test('uses the shared minimum password length', () => {
    render(<ChangePasswordCard />);

    fireEvent.change(screen.getByLabelText('Aktuelles Passwort'), { target: { value: 'aktuelles-passwort' } });
    fireEvent.change(screen.getByLabelText('Neues Passwort'), { target: { value: '01234567890' } });
    fireEvent.change(screen.getByLabelText('Neues Passwort bestätigen'), { target: { value: '01234567890' } });

    expect(screen.getByPlaceholderText('Mindestens 12 Zeichen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Passwort ändern' })).toBeDisabled();
    expect(mockInvokeRenderer).not.toHaveBeenCalled();
  });
});
