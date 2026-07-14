import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { IPCChannels } from '../../shared/ipc/channels';
import { DeploySetupGate } from '../../src/components/setup/deploy-setup-gate';
import {
  BROWSER_DEPLOY_CONFIG_STORAGE_KEY,
  getRendererTransport,
  resetRendererTransportForTests,
} from '../../src/services/transport';

describe('DeploySetupGate', () => {
  afterEach(() => {
    delete (window as any).electronAPI;
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    resetRendererTransportForTests();
  });

  test('shows browser setup wizard outside Electron and persists server-client choice', async () => {
    render(
      <DeploySetupGate>
        <div>App content</div>
      </DeploySetupGate>,
    );

    expect(await screen.findByText('Betriebsmodus auswaehlen')).toBeInTheDocument();
    expect(screen.getByText('Ausgewaehlt: Server verbinden')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Lokal/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /^Server installieren/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Server-URL'), {
      target: { value: 'https://crm.example.com/' },
    });
    fireEvent.change(screen.getByLabelText('Benutzername'), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Speichern/i }));

    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem(BROWSER_DEPLOY_CONFIG_STORAGE_KEY) ?? '{}')).toMatchObject({
      mode: 'server-client',
      server: {
        baseUrl: 'https://crm.example.com',
        lastLoginUsername: 'owner@example.com',
      },
    });
    expect(getRendererTransport()).toMatchObject({
      kind: 'http',
      serverBaseUrl: 'https://crm.example.com',
    });
  });

  test('bootstraps browser server-client mode from URL and persists it', async () => {
    window.history.replaceState(
      {},
      '',
      '/?simplecrmServer=https%3A%2F%2Fcrm.example.com%2F&simplecrmUser=owner%40example.com',
    );

    render(
      <DeploySetupGate>
        <div>App content</div>
      </DeploySetupGate>,
    );

    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem(BROWSER_DEPLOY_CONFIG_STORAGE_KEY) ?? '{}')).toMatchObject({
      mode: 'server-client',
      server: {
        baseUrl: 'https://crm.example.com',
        lastLoginUsername: 'owner@example.com',
      },
    });
    expect(getRendererTransport()).toMatchObject({
      kind: 'http',
      serverBaseUrl: 'https://crm.example.com',
    });
  });

  test('renders browser app immediately when a stored server-client config exists', async () => {
    window.localStorage.setItem(BROWSER_DEPLOY_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 1,
      mode: 'server-client',
      selectedAt: '2026-06-03T12:00:00.000Z',
      server: { baseUrl: 'https://crm.example.com/' },
    }));

    render(
      <DeploySetupGate>
        <div>App content</div>
      </DeploySetupGate>,
    );

    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument());
    expect(getRendererTransport()).toMatchObject({
      kind: 'http',
      serverBaseUrl: 'https://crm.example.com',
    });
  });

  test('shows setup wizard for missing config and persists standalone choice', async () => {
    const invoke = jest.fn()
      .mockResolvedValueOnce({ status: 'missing' })
      .mockResolvedValueOnce({
        success: true,
        config: {
          version: 1,
          mode: 'standalone',
          selectedAt: '2026-06-03T12:00:00.000Z',
        },
      });
    (window as any).electronAPI = { invoke };

    render(
      <DeploySetupGate>
        <div>App content</div>
      </DeploySetupGate>,
    );

    expect(await screen.findByText('Betriebsmodus auswaehlen')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Speichern/i }));

    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith(IPCChannels.Setup.GetDeployConfig);
    expect(invoke).toHaveBeenCalledWith(IPCChannels.Setup.SaveDeployConfig, { mode: 'standalone' });
  });

  test('renders Electron server-client app once HTTP transport is configured', async () => {
    const invoke = jest.fn().mockResolvedValueOnce({
      status: 'ok',
      config: {
        version: 1,
        mode: 'server-client',
        selectedAt: '2026-06-03T12:00:00.000Z',
        server: { baseUrl: 'https://crm.example.com' },
      },
    });
    (window as any).electronAPI = { invoke };

    render(
      <DeploySetupGate>
        <div>App content</div>
      </DeploySetupGate>,
    );

    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument());
    expect(getRendererTransport()).toMatchObject({
      kind: 'http',
      serverBaseUrl: 'https://crm.example.com',
    });
  });
});
