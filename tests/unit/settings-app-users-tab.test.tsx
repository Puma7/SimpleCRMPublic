import { render, screen } from '@testing-library/react';

const mockUseAuth = jest.fn();

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const listUsers = jest.fn();
jest.mock('@/components/settings/users-panel', () => ({
  UsersPanel: () => {
    listUsers();
    return <div data-testid="users-panel" />;
  },
}));

jest.mock('@/components/settings/change-password-card', () => ({
  ChangePasswordCard: () => <div data-testid="change-password" />,
}));

import { AppUsersTab } from '@/components/email/settings-app-users-tab';

/**
 * Regression: Der Tab „App-Benutzer" ist bewusst auch ohne settings.view
 * erreichbar — wegen der Passwortkarte. Das UsersPanel darunter ruft aber schon
 * beim Mounten Auth.ListUsers auf, und dieser Endpunkt verlangt users.manage.
 * Ohne das Recht war der Tab damit eine garantierte 403-Fehlermeldung.
 */
describe('app users settings tab', () => {
  beforeEach(() => {
    listUsers.mockClear();
  });

  test('a settings reader without users.manage sees only the password card', () => {
    mockUseAuth.mockReturnValue({ canManageUsers: false });
    render(<AppUsersTab />);
    expect(screen.getByTestId('change-password')).toBeInTheDocument();
    expect(screen.queryByTestId('users-panel')).toBeNull();
    // Entscheidend: kein Abruf, der ohnehin mit 403 endet.
    expect(listUsers).not.toHaveBeenCalled();
  });

  test('a users.manage holder gets the full panel', () => {
    mockUseAuth.mockReturnValue({ canManageUsers: true });
    render(<AppUsersTab />);
    expect(screen.getByTestId('change-password')).toBeInTheDocument();
    expect(screen.getByTestId('users-panel')).toBeInTheDocument();
  });
});
