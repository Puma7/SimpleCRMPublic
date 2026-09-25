import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, activeProps, inactiveProps, ...rest }: any) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

jest.mock('@/components/auth/user-switcher', () => ({
  UserSwitcher: () => null,
}));

const mockIsServerClientMode = jest.fn(() => true);
jest.mock('@/lib/runtime-mode', () => ({
  isServerClientMode: () => mockIsServerClientMode(),
}));

jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    canViewSettings: true,
    hasCapability: () => true,
    canWriteCrm: true,
  }),
}));

import { MainNav } from '@/components/main-nav';

describe('MainNav', () => {
  beforeEach(() => {
    mockIsServerClientMode.mockReturnValue(true);
  });

  // F-A11b-08: Im Desktop fuehrte "Retouren" auf eine Seite ohne IPC-Handler (Returns ist server-only).
  test('hides the server-only returns link in the standalone desktop', () => {
    mockIsServerClientMode.mockReturnValue(false);
    render(<MainNav />);

    expect(screen.queryByText('Retouren')).toBeNull();
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).not.toContain('/returns');
    expect(screen.getByText('Kunden')).toBeTruthy();
  });

  test('renders the SimpleCRM brand link', () => {
    render(<MainNav />);
    expect(screen.getByText('SimpleCRM')).toBeTruthy();
  });

  test('renders all main navigation links (server edition)', () => {
    render(<MainNav />);

    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Nachverfolgung')).toBeTruthy();
    expect(screen.getByText('Kunden')).toBeTruthy();
    expect(screen.getByText('Deals')).toBeTruthy();
    expect(screen.getByText('Aufgaben')).toBeTruthy();
    expect(screen.getByText('Produkte')).toBeTruthy();
    expect(screen.getByText('Kalender')).toBeTruthy();
    expect(screen.getByText('E-Mail')).toBeTruthy();
    expect(screen.getByText('Retouren')).toBeTruthy();
  });

  test('renders settings link', () => {
    render(<MainNav />);
    expect(screen.getByText('Einstellungen')).toBeTruthy();
  });

  test('nav links point to correct routes', () => {
    render(<MainNav />);

    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));

    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/followup');
    expect(hrefs).toContain('/customers');
    expect(hrefs).toContain('/deals');
    expect(hrefs).toContain('/tasks');
    expect(hrefs).toContain('/products');
    expect(hrefs).toContain('/calendar');
    expect(hrefs).toContain('/email');
    expect(hrefs).toContain('/returns');
    expect(hrefs).toContain('/settings');
  });

  test('renders inside a nav element', () => {
    const { container } = render(<MainNav />);
    expect(container.querySelector('nav')).toBeTruthy();
  });
});
