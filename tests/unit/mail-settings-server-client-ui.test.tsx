import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { toast } from 'sonner';

import { AccountForm } from '@/components/email/settings/account-form';
import { ExportPanel } from '@/components/email/settings/export-panel';
import { KnowledgePanel } from '@/components/email/settings/knowledge-panel';
import { MailSecurityPanel } from '@/components/email/settings/mail-security-panel';
import { MiscPanel, SnoozePanel } from '@/components/email/settings/misc-panel';
import { ArchiveRecoverySection } from '@/components/email/settings/archive-recovery-section';
import { SmtpPanel } from '@/components/email/settings/smtp-panel';
import { AiPanel } from '@/components/email/settings/ai-panel';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  createIpcRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    loading: jest.fn(() => 'loading-toast'),
  },
}));

const mockUseAuth = jest.fn(() => ({ user: { id: 'admin-1', role: 'admin' }, loading: false }));
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockMailWorkspace = {
  settingsAccountId: null,
  setSettingsAccountId: jest.fn(),
  accountsRevision: 0,
  bumpAccountsRevision: jest.fn(),
};
jest.mock('@/components/email/workspace-context', () => ({
  useMailWorkspace: () => mockMailWorkspace,
}));

jest.mock('@/components/email/settings/knowledge-markdown-editor', () => ({
  KnowledgeMarkdownEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Markdown editor"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

describe('mail settings server-client UI', () => {
  beforeEach(() => {
    resetRendererTransportForTests();
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: 'admin-1', role: 'admin' }, loading: false });
  });

  afterEach(() => {
    delete (window as any).electronAPI;
    resetRendererTransportForTests();
  });

  test('account form describes server secret storage in HTTP transport', () => {
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<AccountForm onCreated={jest.fn()} />);

    expect(screen.getByText(/Serverdatenbank/)).toBeInTheDocument();
    expect(screen.queryByText(/System-Schlüsselbund/)).not.toBeInTheDocument();
  });

  test('account form uses SimpleCRM-internal POP3 read-state wording in HTTP transport', async () => {
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com' }));

    render(<AccountForm onCreated={jest.fn()} editAccount={pop3Account()} />);

    expect(await screen.findByText(/SimpleCRM zeigt den Status intern/)).toBeInTheDocument();
    expect(screen.queryByText(/lokale Anzeige/)).not.toBeInTheDocument();
  });

  test('saving an existing account does NOT close the edit view (no onCancelEdit)', async () => {
    // Regression: a successful update used to call onCancelEdit?.(), which the
    // master-detail handled with setEditAccount(null) — the whole panel went
    // blank until the user clicked the row again. After an update we want the
    // form to stay on-screen with its values (plus a confirmation toast).
    // Minimal Response-shape the transport expects (jsdom has no global Response).
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { success: true } }),
    } as Response);
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    }));
    const onCreated = jest.fn();
    const onCancelEdit = jest.fn();

    render(
      <AccountForm
        onCreated={onCreated}
        onCancelEdit={onCancelEdit}
        editAccount={imapAccount()}
      />,
    );

    // Change the display name + click "Aktualisieren".
    const nameInput = await screen.findByLabelText(/Anzeigename/i);
    fireEvent.change(nameInput, { target: { value: 'Neuer Name' } });

    const saveBtn = screen.getByRole('button', { name: /Aktualisieren/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Konto aktualisiert.'));
    expect(onCreated).toHaveBeenCalledTimes(1);
    // The critical assertion: the form must NOT request the parent to drop edit
    // mode. (It used to call this and the master-detail blanked the panel.)
    expect(onCancelEdit).not.toHaveBeenCalled();
    // And the user's value is still on screen, not reset to whatever editAccount held.
    expect((nameInput as HTMLInputElement).value).toBe('Neuer Name');
  });

  test('account form keeps user edits when parent refreshes editAccount with new reference', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { success: true } }),
    } as Response);
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    }));

    function Harness() {
      const [editAccount, setEditAccount] = useState(imapAccount());
      return (
        <AccountForm
          editAccount={editAccount}
          onCreated={() => {
            setEditAccount({ ...imapAccount(), display_name: 'Server Name' });
          }}
        />
      );
    }

    render(<Harness />);

    const nameInput = await screen.findByLabelText(/Anzeigename/i);
    fireEvent.change(nameInput, { target: { value: 'Neuer Name' } });

    const saveBtn = screen.getByRole('button', { name: /Aktualisieren/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Konto aktualisiert.'));
    expect((nameInput as HTMLInputElement).value).toBe('Neuer Name');
  });

  // F-A11a-06: Ohne Passwort testete der Server still den gespeicherten Host, das UI meldete Erfolg fuer die geaenderten Werte.
  test('IMAP-Test mit geaendertem Host ohne Passwort verlangt ein Passwort statt Erfolg zu melden', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: { success: true } }));
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl }));
    render(<AccountForm onCreated={jest.fn()} editAccount={imapAccount()} />);

    fireEvent.change(await screen.findByLabelText('IMAP-Server'), { target: { value: 'imap.neu.invalid' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'IMAP testen' }));
    });

    expect(screen.getByRole('status')).toHaveTextContent(/Passwort eingeben/);
    expect(screen.queryByText('IMAP-Verbindung erfolgreich.')).not.toBeInTheDocument();
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('test-imap'))).toBe(false);
  });

  test('IMAP-Test ohne Aenderung nutzt weiter das gespeicherte Konto', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: { success: true } }));
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl }));
    render(<AccountForm onCreated={jest.fn()} editAccount={imapAccount()} />);

    await screen.findByLabelText('IMAP-Server');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'IMAP testen' }));
    });

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('IMAP-Verbindung erfolgreich.'));
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('test-imap'))).toBe(true);
  });

  test('IMAP-Test mit geaendertem Host und neuem Passwort testet die Formularwerte', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: { success: true } }));
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl }));
    render(<AccountForm onCreated={jest.fn()} editAccount={imapAccount()} />);

    fireEvent.change(await screen.findByLabelText('IMAP-Server'), { target: { value: 'imap.neu.example' } });
    fireEvent.change(screen.getByLabelText(/^Passwort/), { target: { value: 'geheim' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'IMAP testen' }));
    });

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('IMAP-Verbindung erfolgreich.'));
    const testCall = fetchImpl.mock.calls.find(([url]) => String(url).includes('test-imap'));
    expect(JSON.parse(String(testCall?.[1]?.body))).toEqual(expect.objectContaining({ imapHost: 'imap.neu.example' }));
  });

  test('Desktop: IMAP-Test prueft geaenderte Werte auch ohne Passwort (lokales Passwort, Formularwerte)', async () => {
    const localInvoke = jest.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI = { invoke: localInvoke };
    configureRendererTransport(createIpcRendererTransport());
    render(<AccountForm onCreated={jest.fn()} editAccount={imapAccount()} />);

    fireEvent.change(await screen.findByLabelText('IMAP-Server'), { target: { value: 'imap.neu.example' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'IMAP testen' }));
    });

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('IMAP-Verbindung erfolgreich.'));
    expect(localInvoke).toHaveBeenCalledWith('email:test-imap', expect.objectContaining({ imapHost: 'imap.neu.example' }));
  });

  // F-A11a-06: Gleiches gilt fuer den POP3-Test.
  test('POP3-Test mit geaendertem Host ohne Passwort verlangt ein Passwort statt Erfolg zu melden', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: { success: true } }));
    configureRendererTransport(createHttpRendererTransport({ baseUrl: 'https://crm.example.com', fetchImpl }));
    render(<AccountForm onCreated={jest.fn()} editAccount={{ ...pop3Account(), imap_username: 'mail@example.com' }} />);

    fireEvent.change(await screen.findByLabelText('POP3-Server'), { target: { value: 'pop.neu.invalid' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'POP3 testen' }));
    });

    expect(screen.getByRole('status')).toHaveTextContent(/Passwort eingeben/);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('test-pop3'))).toBe(false);
  });

  // F-A2a-01: the server now rejects an endpoint change without a fresh
  // password; the edit form has to ask for it instead of silently saving.
  test('account form requires the password once host, port or TLS change', async () => {
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      jsonResponse({ data: { success: true } })
    ));
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<AccountForm onCreated={jest.fn()} editAccount={imapAccount()} />);

    const passwordInput = await screen.findByLabelText(/^Passwort/);
    expect(passwordInput).not.toBeRequired();

    fireEvent.change(screen.getByLabelText('IMAP-Server'), { target: { value: 'imap.other.example' } });
    expect(passwordInput).toBeRequired();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Aktualisieren/i }));
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Zugangsdaten bei Serverwechsel neu eingeben'));
    expect(fetchImpl).not.toHaveBeenCalled();

    fireEvent.change(passwordInput, { target: { value: 'fresh-secret' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Aktualisieren/i }));
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Konto aktualisiert.'));
    const patch = fetchImpl.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
      imapHost: 'imap.other.example',
      imapPassword: 'fresh-secret',
    });
  });

  // F-A5-12 (E6): the Authentication-Results fallback trusts one authserv-id per
  // account; the server edition lets the admin set it under "Erweitert".
  test('account form edits the trusted authserv-id under "Erweitert" in server mode', async () => {
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      jsonResponse({ data: { success: true } })
    ));
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<AccountForm onCreated={jest.fn()} editAccount={{ ...imapAccount(), trusted_authserv_id: 'mx.google.com' }} />);

    fireEvent.click(await screen.findByText('Erweitert'));
    const input = screen.getByLabelText(/Vertrauenswürdige authserv-id/) as HTMLInputElement;
    expect(input.value).toBe('mx.google.com');
    expect(input.placeholder).toContain('example.com');

    fireEvent.change(input, { target: { value: ' MX.Example.NET ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Aktualisieren/i }));
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Konto aktualisiert.'));
    const patch = fetchImpl.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ trustedAuthservId: 'MX.Example.NET' });

    fireEvent.change(input, { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Aktualisieren/i }));
    });
    const patches = fetchImpl.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patches[1]?.[1]?.body))).toMatchObject({ trustedAuthservId: null });
  });

  test('Desktop: account form has no authserv-id field', async () => {
    (window as any).electronAPI = { invoke: jest.fn(async () => ({ success: true })) };
    configureRendererTransport(createIpcRendererTransport());

    render(<AccountForm onCreated={jest.fn()} editAccount={imapAccount()} />);

    await screen.findByLabelText(/Anzeigename/i);
    expect(screen.queryByText('Erweitert')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/authserv-id/)).not.toBeInTheDocument();
  });

  test('account form shows the server rejection for a missing credential', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({
      error: {
        code: 'email_account_credentials_required',
        message: 'Zugangsdaten bei Serverwechsel neu eingeben: IMAP-Passwort erforderlich (POP3-Server geaendert)',
        details: { fields: [{ field: 'imapPassword', protocols: ['pop3'] }] },
      },
    }, 400));
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<AccountForm onCreated={jest.fn()} editAccount={imapAccount()} />);
    fireEvent.change(await screen.findByLabelText(/Anzeigename/i), { target: { value: 'Neuer Name' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Aktualisieren/i }));
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Zugangsdaten bei Serverwechsel neu eingeben: IMAP-Passwort erforderlich (POP3-Server geaendert)',
    ));
  });

  test('SMTP panel asks for the IMAP password when the server changes with IMAP login', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return jsonResponse({ data: { success: true } });
      if (String(input).endsWith('/api/v1/email/accounts')) {
        return jsonResponse({ data: { items: [smtpAccountRecord()] } });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    const { container } = render(<SmtpPanel embeddedAccountId={1} />);

    const hostInput = await screen.findByDisplayValue('smtp.example.com');
    const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(passwordInput).not.toBeRequired();

    fireEvent.change(hostInput, { target: { value: 'smtp.other.example' } });
    expect(passwordInput).toBeRequired();
    expect(screen.getByLabelText(/^IMAP-Passwort/)).toBe(passwordInput);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Zugangsdaten bei Serverwechsel neu eingeben'));
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);

    fireEvent.change(passwordInput, { target: { value: 'imap-secret' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('SMTP gespeichert.'));
    const patch = fetchImpl.mock.calls.find(([, init]) => init?.method === 'PATCH');
    const body = JSON.parse(String(patch?.[1]?.body));
    expect(body).toMatchObject({ smtpHost: 'smtp.other.example', imapPassword: 'imap-secret' });
    expect(body).not.toHaveProperty('smtpPassword');
  });

  // F-A2a-01 (E2): switching "SMTP-Anmeldung wie IMAP" changes which stored
  // password reaches the SMTP host; the panel saved the switch without asking.
  test.each([
    ['ausschalten', true, 'SMTP-Passwort', 'smtpPassword', 'imapPassword'],
    ['einschalten', false, 'IMAP-Passwort', 'imapPassword', 'smtpPassword'],
  ])('SMTP panel asks for the password of the new login source when "wie IMAP" is switched (%s)', async (
    _label,
    storedImapAuth,
    passwordLabel,
    sentField,
    otherField,
  ) => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return jsonResponse({ data: { success: true } });
      if (String(input).endsWith('/api/v1/email/accounts')) {
        return jsonResponse({ data: { items: [{ ...smtpAccountRecord(), smtpUseImapAuth: storedImapAuth }] } });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    const { container } = render(<SmtpPanel embeddedAccountId={1} />);
    await screen.findByDisplayValue('smtp.example.com');
    const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(passwordInput).not.toBeRequired();

    fireEvent.click(screen.getByLabelText('SMTP-Anmeldung wie IMAP'));
    expect(passwordInput).toBeRequired();
    expect(screen.getByLabelText(new RegExp(`^${passwordLabel}`))).toBe(passwordInput);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Zugangsdaten bei Serverwechsel neu eingeben'));
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);

    fireEvent.change(passwordInput, { target: { value: 'fresh-secret' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('SMTP gespeichert.'));
    const patch = fetchImpl.mock.calls.find(([, init]) => init?.method === 'PATCH');
    const body = JSON.parse(String(patch?.[1]?.body));
    expect(body).toMatchObject({ smtpUseImapAuth: !storedImapAuth, [sentField]: 'fresh-secret' });
    expect(body).not.toHaveProperty(otherField);
  });

  // F-A4-04: the SMTP test had no catch, so a rejected request (e.g. HTTP
  // 403/500) became an unhandled rejection and the user saw nothing.
  test('SMTP panel shows a failed connection test request', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/email/accounts/test-smtp')) {
        return jsonResponse({ error: { code: 'forbidden', message: 'Adminrechte erforderlich' } }, 403);
      }
      if (url.endsWith('/api/v1/email/accounts')) {
        return jsonResponse({ data: { items: [smtpAccountRecord()] } });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<SmtpPanel embeddedAccountId={1} />);
    await screen.findByDisplayValue('smtp.example.com');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Adminrechte erforderlich'));
  });

  // F-N-fe-03: Ohne Passwort testet der Server still den gespeicherten SMTP-Host; das Panel meldete Erfolg fuer die geaenderten Werte.
  describe('SMTP-Test ohne Passwort', () => {
    const smtpTestFetch = () => jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/email/accounts/test-smtp')) return jsonResponse({ data: { success: true } });
      if (url.endsWith('/api/v1/email/accounts')) {
        return jsonResponse({ data: { items: [smtpAccountRecord()] } });
      }
      return jsonResponse({ data: null }, 404);
    });
    const testCalls = (fetchImpl: jest.Mock) =>
      fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/test-smtp'));

    test.each([
      ['Host', 'smtp.example.com', 'smtp.neu.invalid'],
      ['Port', '587', '2525'],
    ])('geaenderter %s verlangt ein Passwort statt Erfolg zu melden', async (_field, current, next) => {
      const fetchImpl = smtpTestFetch();
      configureRendererTransport(createHttpRendererTransport({
        baseUrl: 'https://crm.example.com',
        fetchImpl: fetchImpl as typeof fetch,
      }));
      render(<SmtpPanel embeddedAccountId={1} />);
      await screen.findByDisplayValue('smtp.example.com');
      fireEvent.change(screen.getByDisplayValue(current), { target: { value: next } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      });

      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Passwort eingeben/));
      expect(toast.success).not.toHaveBeenCalled();
      expect(testCalls(fetchImpl)).toHaveLength(0);
    });

    test('geaenderte Anmeldung (nicht mehr wie IMAP) verlangt ein Passwort', async () => {
      const fetchImpl = smtpTestFetch();
      configureRendererTransport(createHttpRendererTransport({
        baseUrl: 'https://crm.example.com',
        fetchImpl: fetchImpl as typeof fetch,
      }));
      render(<SmtpPanel embeddedAccountId={1} />);
      await screen.findByDisplayValue('smtp.example.com');
      fireEvent.click(screen.getByLabelText('SMTP-Anmeldung wie IMAP'));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      });

      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Passwort eingeben/));
      expect(testCalls(fetchImpl)).toHaveLength(0);
    });

    test('ohne Aenderung wird weiter das gespeicherte Konto getestet', async () => {
      const fetchImpl = smtpTestFetch();
      configureRendererTransport(createHttpRendererTransport({
        baseUrl: 'https://crm.example.com',
        fetchImpl: fetchImpl as typeof fetch,
      }));
      render(<SmtpPanel embeddedAccountId={1} />);
      await screen.findByDisplayValue('smtp.example.com');

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      });

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('SMTP-Verbindung und Versand OK'));
      expect(testCalls(fetchImpl)).toHaveLength(1);
    });

    test('geaenderter Host mit Passwort testet die Formularwerte', async () => {
      const fetchImpl = smtpTestFetch();
      configureRendererTransport(createHttpRendererTransport({
        baseUrl: 'https://crm.example.com',
        fetchImpl: fetchImpl as typeof fetch,
      }));
      const { container } = render(<SmtpPanel embeddedAccountId={1} />);
      fireEvent.change(await screen.findByDisplayValue('smtp.example.com'), { target: { value: 'smtp.neu.example' } });
      fireEvent.change(container.querySelector('input[type="password"]') as HTMLInputElement, {
        target: { value: 'imap-secret' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      });

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('SMTP-Verbindung und Versand OK'));
      const [, init] = testCalls(fetchImpl)[0]!;
      expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({ host: 'smtp.neu.example' }));
    });

    test('Desktop: geaenderter Host wird auch ohne Passwort mit den Formularwerten getestet', async () => {
      const localInvoke = jest.fn(async (channel: string) => {
        if (channel === 'email:list-accounts') {
          return [{
            id: 1,
            display_name: 'Kontakt',
            email_address: 'kontakt@example.com',
            protocol: 'imap',
            imap_host: 'imap.example.com',
            imap_username: 'kontakt@example.com',
            smtp_host: 'smtp.example.com',
            smtp_port: 587,
            smtp_tls: 1,
            smtp_username: null,
            smtp_use_imap_auth: 1,
          }];
        }
        return { success: true };
      });
      (window as any).electronAPI = { invoke: localInvoke };
      configureRendererTransport(createIpcRendererTransport());
      render(<SmtpPanel embeddedAccountId={1} />);
      fireEvent.change(await screen.findByDisplayValue('smtp.example.com'), { target: { value: 'smtp.neu.example' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      });

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('SMTP-Verbindung und Versand OK'));
      expect(localInvoke).toHaveBeenCalledWith('email:test-smtp', expect.objectContaining({ host: 'smtp.neu.example' }));
    });
  });

  // F-A4-02: the server now refuses to move a profile with a stored API key to
  // another origin or provider without a new key; the panel asks for it first.
  test('AI panel requires a new API key once the base URL origin changes', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'admin-1', role: 'admin' },
      loading: false,
      hasCapability: () => true,
    } as any);
    const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return jsonResponse({ data: { ...aiProfileRecord(), baseUrl: 'https://openrouter.ai/api/v1' } });
      if (String(input).includes('/api/v1/ai/profiles')) {
        return jsonResponse({ data: { items: [aiProfileRecord()], nextCursor: null } });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    const { container } = render(<AiPanel />);

    const baseUrlInput = await screen.findByDisplayValue('https://api.openai.com/v1');
    const keyInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(keyInput).not.toBeRequired();
    const profileForm = within(keyInput.closest('.grid') as HTMLElement);

    fireEvent.change(baseUrlInput, { target: { value: 'https://openrouter.ai/api/v1' } });
    expect(keyInput).toBeRequired();

    await act(async () => {
      fireEvent.click(profileForm.getByRole('button', { name: 'Speichern' }));
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Zugangsdaten bei Serverwechsel neu eingeben'));
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);

    fireEvent.change(keyInput, { target: { value: 'or-new-key' } });
    await act(async () => {
      fireEvent.click(profileForm.getByRole('button', { name: 'Speichern' }));
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('KI-Profil gespeichert.'));
    const patch = fetchImpl.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'or-new-key',
    });
  });

  test('export panel does not fall back to local IPC when HTTP transport has no server URL', async () => {
    const localInvoke = jest.fn();
    (window as any).electronAPI = { invoke: localInvoke };
    configureRendererTransport({
      kind: 'http',
      invoke: jest.fn(),
    } as any);

    render(<ExportPanel />);
    expect(screen.getByText(/Secret-Eintr/)).toBeInTheDocument();
    expect(screen.queryByText(/Keytar/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ZIP nur Metadaten/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Server-URL fehlt. Export wurde nicht gestartet.',
    ));
    expect(localInvoke).not.toHaveBeenCalled();
  });

  test('export panel downloads server GDPR ZIP through HTTP transport', async () => {
    const blob = new Blob(['zip-bytes'], { type: 'application/zip' });
    const fetchImpl = jest.fn().mockResolvedValueOnce(blobResponse(blob, {
      'Content-Disposition': 'attachment; filename="server-export.zip"',
      'Content-Type': 'application/zip',
    }));
    const createObjectURL = jest.fn(() => 'blob:server-export');
    const revokeObjectURL = jest.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
      getAccessToken: () => 'access-1',
    }));

    try {
      render(<ExportPanel />);
      fireEvent.click(screen.getByRole('checkbox', { name: /sensible Tracking-Rohdaten/i }));
      fireEvent.click(screen.getByRole('button', { name: /ZIP nur Metadaten/ }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
        'Export ohne Anhaenge heruntergeladen.',
      ));
      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(clickSpy).toHaveBeenCalled();
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://crm.example.com/api/v1/email/gdpr-export?skipAttachments=true&includeSensitiveTracking=true',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Accept: 'application/octet-stream, application/json',
            Authorization: 'Bearer access-1',
          }),
        }),
      );
    } finally {
      if (originalCreateObjectURL) {
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
      } else {
        delete (URL as any).createObjectURL;
      }
      if (originalRevokeObjectURL) {
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
      } else {
        delete (URL as any).revokeObjectURL;
      }
      clickSpy.mockRestore();
    }
  });

  test('knowledge panel describes server-side Markdown documents in HTTP transport', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/workflow-knowledge-bases')) {
        return jsonResponse({ data: { items: [knowledgeBaseRecord()] } });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<KnowledgePanel />);

    expect(await screen.findByText('Server KB')).toBeInTheDocument();
    expect(screen.getByText(/serverseitiges Markdown-Dokument/)).toBeInTheDocument();
    expect(screen.queryByText(/workflow-knowledge/)).not.toBeInTheDocument();
  });

  test('knowledge panel refreshes knowledge-base list after server events', async () => {
    const originalWebSocket = globalThis.WebSocket;
    const webSockets: Array<{ onmessage: ((event: { data: string }) => void) | null; close: jest.Mock }> = [];
    class MockWebSocket {
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onclose: (() => void) | null = null;
      close = jest.fn();

      constructor() {
        webSockets.push(this);
      }
    }
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: MockWebSocket,
    });

    let listRequests = 0;
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/workflow-knowledge-bases')) {
        listRequests += 1;
        return jsonResponse({
          data: {
            items: listRequests === 1
              ? [knowledgeBaseRecord()]
              : [knowledgeBaseRecord(), { ...knowledgeBaseRecord(), id: 2, name: 'Updated KB' }],
          },
        });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    try {
      render(<KnowledgePanel />);

      expect(await screen.findByText('Server KB')).toBeInTheDocument();
      await waitFor(() => expect(webSockets).toHaveLength(1));

      await act(async () => {
        webSockets[0].onmessage?.({
          data: JSON.stringify({
            type: 'workflow_knowledge_base.created',
            workspaceId: 'workspace-a',
            entityType: 'workflow_knowledge_base',
            entityId: '2',
            occurredAt: '2026-06-04T12:00:00.000Z',
            payload: { id: 2, name: 'Updated KB' },
          }),
        });
      });

      expect(await screen.findByText('Updated KB')).toBeInTheDocument();
      expect(listRequests).toBe(2);
    } finally {
      if (originalWebSocket) {
        Object.defineProperty(globalThis, 'WebSocket', {
          configurable: true,
          value: originalWebSocket,
        });
      } else {
        delete (globalThis as any).WebSocket;
      }
    }
  });

  test('snooze panel loads server snooze settings', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/email/settings/snooze')) {
        return jsonResponse({ data: snoozeSettings() });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<SnoozePanel />);

    expect(await screen.findByDisplayValue('19:30')).toBeInTheDocument();
  });

  test('archive recovery section uses transport-neutral wording', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/email/accounts')) {
        return jsonResponse({ data: { items: [emailAccountRecord()] } });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<ArchiveRecoverySection />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1\. Vorschau/ })).toBeEnabled();
    });
    expect(screen.getByText(/SimpleCRM-interne Nachrichten/)).toBeInTheDocument();
    expect(screen.queryByText(/lokale Nachrichten/)).not.toBeInTheDocument();
  });

  test('misc panel shows customer link backfill', async () => {
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: jest.fn(async () => jsonResponse({ data: { count: 0 } })) as typeof fetch,
    }));

    render(<MiscPanel />);

    expect(screen.getByRole('button', { name: /Kunden-Links nachziehen/ })).toBeInTheDocument();
  });

  test('mail security panel uses SimpleCRM scoring labels in HTTP transport', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/email/settings/security')) {
        return jsonResponse({ data: mailSecuritySettings() });
      }
      if (url.includes('/api/v1/spam/list-entries')) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<MailSecurityPanel />);

    expect(await screen.findByText('SimpleCRM-Spam-Engine')).toBeInTheDocument();
    expect(screen.getByText('Rspamd-Score in SimpleCRM-Score einrechnen')).toBeInTheDocument();
    expect(screen.queryByText('Lokale Spam-Engine')).not.toBeInTheDocument();
    expect(screen.queryByText('Lokales Lernen aus Korrekturen')).not.toBeInTheDocument();
    // Admin sees the Rspamd test action (its route is admin-only).
    expect(screen.getByText('Rspamd-Verbindung testen')).toBeInTheDocument();
  });

  test('mail security panel hides the admin-only Rspamd test for delegated users', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1', role: 'user' }, loading: false });
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/email/settings/security')) {
        return jsonResponse({ data: mailSecuritySettings() });
      }
      if (url.includes('/api/v1/spam/list-entries')) return jsonResponse({ data: [] });
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<MailSecurityPanel />);

    // The panel still renders for the delegated capability holder…
    expect(await screen.findByText('SimpleCRM-Spam-Engine')).toBeInTheDocument();
    // …but the admin-only Rspamd test button (which would 403) is hidden.
    expect(screen.queryByText('Rspamd-Verbindung testen')).not.toBeInTheDocument();
  });

  test('mail security panel refreshes spam list entries after server events', async () => {
    const originalWebSocket = globalThis.WebSocket;
    const webSockets: Array<{ onmessage: ((event: { data: string }) => void) | null; close: jest.Mock }> = [];
    class MockWebSocket {
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onclose: (() => void) | null = null;
      close = jest.fn();

      constructor() {
        webSockets.push(this);
      }
    }
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: MockWebSocket,
    });

    let spamListRequests = 0;
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/email/settings/security')) {
        return jsonResponse({ data: mailSecuritySettings() });
      }
      if (url.includes('/api/v1/spam/list-entries')) {
        spamListRequests += 1;
        return jsonResponse({
          data: spamListRequests === 1 ? [] : [spamListEntry()],
        });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    try {
      render(<MailSecurityPanel />);

      expect(await screen.findByText('Noch keine Eintraege.')).toBeInTheDocument();
      await waitFor(() => expect(webSockets).toHaveLength(1));

      await act(async () => {
        webSockets[0].onmessage?.({
          data: JSON.stringify({
            type: 'spam_list_entry.created',
            workspaceId: 'workspace-a',
            entityType: 'spam_list_entry',
            entityId: '41',
            occurredAt: '2026-06-04T12:00:00.000Z',
            payload: { pattern: 'blocked@example.com' },
          }),
        });
      });

      expect(await screen.findByText('blocked@example.com')).toBeInTheDocument();
      expect(spamListRequests).toBe(2);
    } finally {
      if (originalWebSocket) {
        Object.defineProperty(globalThis, 'WebSocket', {
          configurable: true,
          value: originalWebSocket,
        });
      } else {
        delete (globalThis as any).WebSocket;
      }
    }
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function blobResponse(blob: Blob, headers: Record<string, string>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    blob: async () => blob,
    text: async () => '',
  } as Response;
}

function knowledgeBaseRecord() {
  return {
    id: 1,
    name: 'Server KB',
    description: null,
  };
}

function emailAccountRecord() {
  return {
    id: 7,
    sourceSqliteId: 7,
    displayName: 'Server Mail',
    emailAddress: 'mail@example.com',
    protocol: 'imap',
  };
}

function aiProfileRecord() {
  return {
    id: 21,
    sourceSqliteId: 21,
    label: 'Firmen-Key',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    embeddingModel: null,
    isDefault: true,
    sortOrder: 0,
    apiKeyConfigured: true,
  };
}

function smtpAccountRecord() {
  return {
    id: 1,
    sourceSqliteId: 1,
    displayName: 'Kontakt',
    emailAddress: 'kontakt@example.com',
    protocol: 'imap',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapTls: true,
    imapUsername: 'kontakt@example.com',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpTls: true,
    smtpUsername: null,
    smtpUseImapAuth: true,
    pop3Host: null,
    pop3Port: 995,
    pop3Tls: true,
  };
}

function pop3Account() {
  return {
    id: 7,
    display_name: 'Server Mail',
    email_address: 'mail@example.com',
    imap_host: '',
    imap_port: 993,
    imap_tls: 1,
    imap_username: '',
    keytar_account_key: '',
    protocol: 'pop3',
    pop3_host: 'pop.example.com',
    pop3_port: 995,
    pop3_tls: 1,
    created_at: '',
    updated_at: '',
  };
}

function imapAccount() {
  return {
    id: 1,
    display_name: 'Kontakt',
    email_address: 'kontakt@example.com',
    imap_host: 'imap.example.com',
    imap_port: 993,
    imap_tls: 1,
    imap_username: 'kontakt@example.com',
    keytar_account_key: '',
    protocol: 'imap',
    pop3_host: null,
    pop3_port: 995,
    pop3_tls: 1,
    created_at: '',
    updated_at: '',
  };
}

function snoozeSettings() {
  return {
    eveningHour: 19,
    eveningMinute: 30,
    morningHour: 8,
    morningMinute: 45,
    nextWeekWeekday: 2,
    nextWeekHour: 10,
    nextWeekMinute: 15,
  };
}

function mailSecuritySettings() {
  return {
    mailauthEnabled: true,
    rspamdEnabled: false,
    rspamdUrl: '',
    rspamdTimeoutMs: 8000,
    rspamdSpamScore: 6,
    autoSpamDmarcFail: false,
    autoSpamSpfFail: false,
    autoSpamRspamd: false,
    senderWhitelist: '',
    senderBlacklist: '',
    spamScoreThreshold: 75,
    spamEngineEnabled: true,
    spamReviewThreshold: 45,
    spamSpamThreshold: 75,
    localLearningEnabled: true,
    rspamdContributionEnabled: false,
    rspamdLearningEnabled: false,
    aiSpamWorkflowEnabled: false,
  };
}

function spamListEntry() {
  return {
    id: 41,
    list_type: 'block',
    pattern_type: 'email',
    pattern: 'blocked@example.com',
    account_id: null,
    note: null,
  };
}
