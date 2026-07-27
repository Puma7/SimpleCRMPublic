import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { TeamPanel } from '@/components/email/settings/team-panel';
import { getRendererTransport, invokeRenderer } from '@/services/transport';
import { IPCChannels } from '@shared/ipc/channels';

let transportKind: 'http' | 'electron' = 'http';

jest.mock('@/services/transport', () => ({
  invokeRenderer: jest.fn(),
  getRendererTransport: jest.fn(),
  subscribeServerEvents: jest.fn(() => ({ unsubscribe: jest.fn() })),
  isMailAccountDataRefreshEvent: jest.fn(() => false),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/components/email/signature-quill-editor', () => ({
  SignatureQuillEditor: ({ value }: { value: string }) => <div data-testid="signature">{value}</div>,
}));
jest.mock('@/components/email/workspace-context', () => ({
  useMailWorkspace: () => ({ bumpAccountsRevision: jest.fn() }),
}));

const member = {
  id: 'agent-2',
  display_name: 'Agent Zwei',
  role: 'agent',
  signature_html: '<p>Zwei</p>',
  sort_order: 0,
  linked_user_id: null,
};

describe('team panel user link', () => {
  beforeEach(() => {
    transportKind = 'http';
    jest.mocked(getRendererTransport).mockImplementation(() => ({ kind: transportKind }) as never);
    jest.mocked(invokeRenderer).mockReset();
    jest.mocked(invokeRenderer).mockResolvedValue([member] as never);
    jest.mocked(toast.error).mockReset();
    jest.mocked(toast.success).mockReset();
  });

  test('server edition offers the link field and submits it', async () => {
    render(<TeamPanel />);
    await screen.findByRole('button', { name: 'Bearbeiten' });

    expect(screen.getByPlaceholderText('Verknüpfte User-UUID (optional)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    fireEvent.change(screen.getByPlaceholderText('Workspace-User-UUID (leer = keine Verknüpfung)'), {
      target: { value: '11111111-2222-3333-4444-555555555555' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(jest.mocked(invokeRenderer)).toHaveBeenCalledWith(
      IPCChannels.Email.SaveTeamMember,
      expect.objectContaining({ id: 'agent-2', linkedUserId: '11111111-2222-3333-4444-555555555555' }),
    ));
  });

  test('desktop edition hides the link field and never submits it', async () => {
    // Das SaveTeamMember-IPC-Schema kennt linkedUserId nicht (zod strippt es) —
    // ein Eingabefeld wuerde einen Erfolgs-Toast ohne gespeicherten Wert liefern.
    transportKind = 'electron';
    render(<TeamPanel />);
    await screen.findByRole('button', { name: 'Bearbeiten' });

    expect(screen.queryByPlaceholderText('Verknüpfte User-UUID (optional)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    expect(
      screen.queryByPlaceholderText('Workspace-User-UUID (leer = keine Verknüpfung)'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(jest.mocked(invokeRenderer)).toHaveBeenCalledWith(
      IPCChannels.Email.SaveTeamMember,
      expect.not.objectContaining({ linkedUserId: expect.anything() }),
    ));
  });

  test('a rejected save surfaces the server error instead of failing silently', async () => {
    // Eine ungueltige/unbekannte User-UUID wird serverseitig abgelehnt; ohne
    // Fehler-Toast glaubte der Admin, die Verknuepfung sei gespeichert.
    jest.mocked(invokeRenderer).mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.ListTeamMembers) return [member] as never;
      throw new Error('email team member linkedUserId must reference a workspace user');
    });
    render(<TeamPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    fireEvent.change(screen.getByPlaceholderText('Workspace-User-UUID (leer = keine Verknüpfung)'), {
      target: { value: 'nicht-existent' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(jest.mocked(toast.error)).toHaveBeenCalledWith(
      'email team member linkedUserId must reference a workspace user',
    ));
    expect(jest.mocked(toast.success)).not.toHaveBeenCalled();
    // Das Bearbeiten-Panel bleibt offen, damit der Wert korrigiert werden kann.
    expect(screen.getByPlaceholderText('Workspace-User-UUID (leer = keine Verknüpfung)')).toBeInTheDocument();
  });

  test('a rejected create surfaces the server error', async () => {
    jest.mocked(invokeRenderer).mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.ListTeamMembers) return [member] as never;
      throw new Error('email team member linkedUserId must be a UUID');
    });
    render(<TeamPanel />);
    await screen.findByRole('button', { name: 'Bearbeiten' });

    fireEvent.change(screen.getByPlaceholderText('ID (z. B. agent-2)'), { target: { value: 'agent-3' } });
    fireEvent.change(screen.getByPlaceholderText('Anzeigename'), { target: { value: 'Agent Drei' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));

    await waitFor(() => expect(jest.mocked(toast.error)).toHaveBeenCalledWith(
      'email team member linkedUserId must be a UUID',
    ));
    expect(jest.mocked(toast.success)).not.toHaveBeenCalled();
    // Eingaben bleiben stehen, damit nichts verloren geht.
    expect(screen.getByPlaceholderText('ID (z. B. agent-2)')).toHaveValue('agent-3');
  });
});
