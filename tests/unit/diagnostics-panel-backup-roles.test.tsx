import { render, screen, waitFor } from '@testing-library/react';

const mockInvokeRenderer = jest.fn();
jest.mock('@/services/transport', () => ({
  getRendererTransport: () => ({ kind: 'ipc' }),
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
}));

jest.mock('@/components/email/types', () => ({
  hasLocalIpc: () => true,
  invokeIpc: jest.fn(),
}));

const mockUseAuth = jest.fn();
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/components/email/settings/restore-wizard-panel', () => ({
  RestoreWizardPanel: () => <div>Restore-Assistent</div>,
}));
jest.mock('@/components/email/settings/server-logs-section', () => ({
  ServerLogsSection: () => null,
}));
jest.mock('@/components/email/settings/archive-recovery-section', () => ({
  ArchiveRecoverySection: () => null,
}));

import { DiagnosticsPanel } from '@/components/email/settings/diagnostics-panel';

function renderAs(role: string) {
  mockUseAuth.mockReturnValue({ user: { id: 'u', role }, hasCapability: () => false });
  return render(<DiagnosticsPanel />);
}

describe('DiagnosticsPanel local backup actions by desktop role', () => {
  beforeEach(() => {
    mockInvokeRenderer.mockReset();
    mockInvokeRenderer.mockRejectedValue(new Error('keine Diagnose im Test'));
  });

  // F-A7b-01: Vollbackup und Restore-Assistent standen im Desktop jeder lokalen Rolle offen.
  test('agents see neither backup buttons nor the restore wizard', async () => {
    renderAs('agent');
    await waitFor(() => expect(mockInvokeRenderer).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Vollbackup/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Backup prüfen/ })).toBeNull();
    expect(screen.queryByText('Restore-Assistent')).toBeNull();
  });

  test('admins may export and verify, but not restore', async () => {
    renderAs('admin');
    expect(await screen.findByRole('button', { name: /Vollbackup/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Backup prüfen/ })).toBeEnabled();
    expect(screen.queryByText('Restore-Assistent')).toBeNull();
  });

  test('the owner also gets the restore wizard', async () => {
    renderAs('owner');
    expect(await screen.findByText('Restore-Assistent')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Vollbackup/ })).toBeEnabled();
  });
});
