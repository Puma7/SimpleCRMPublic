import React from 'react';
import { render, screen } from '@testing-library/react';

import EmailModuleLayout from '../../src/app/email/layout';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  resetRendererTransportForTests,
} from '../../src/services/transport';

jest.mock('@tanstack/react-router', () => ({
  Outlet: () => <div data-testid="email-outlet">Email outlet</div>,
}));

jest.mock('../../src/components/email/email-sub-nav', () => ({
  EmailSubNav: () => <nav data-testid="email-sub-nav" />,
}));

jest.mock('../../src/components/email/workspace-context', () => ({
  MailWorkspaceProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mail-workspace-provider">{children}</div>
  ),
}));

describe('EmailModuleLayout', () => {
  afterEach(() => {
    delete (window as any).electronAPI;
    resetRendererTransportForTests();
  });

  test('renders the desktop/server requirement when no transport is available', () => {
    render(<EmailModuleLayout />);

    expect(screen.getByText('E-Mail')).toBeInTheDocument();
    expect(screen.getByText(/Das E-Mail-Modul benoetigt/)).toBeInTheDocument();
    expect(screen.queryByTestId('email-outlet')).not.toBeInTheDocument();
  });

  test('renders the email module in browser server-client mode without Electron IPC', () => {
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<EmailModuleLayout />);

    expect(screen.getByTestId('mail-workspace-provider')).toBeInTheDocument();
    expect(screen.getByTestId('email-sub-nav')).toBeInTheDocument();
    expect(screen.getByTestId('email-outlet')).toBeInTheDocument();
  });
});
