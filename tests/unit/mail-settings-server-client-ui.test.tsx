import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { AccountForm } from '@/components/email/settings/account-form';
import { ExportPanel } from '@/components/email/settings/export-panel';
import { KnowledgePanel } from '@/components/email/settings/knowledge-panel';
import { MailSecurityPanel } from '@/components/email/settings/mail-security-panel';
import { MiscPanel } from '@/components/email/settings/misc-panel';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
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
      fireEvent.click(screen.getByRole('button', { name: /ZIP nur Metadaten/ }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
        'Export ohne Anhaenge heruntergeladen.',
      ));
      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(clickSpy).toHaveBeenCalled();
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://crm.example.com/api/v1/email/gdpr-export?skipAttachments=true',
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

  test('misc panel uses transport-neutral archive recovery wording', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/email/accounts')) {
        return jsonResponse({ data: { items: [emailAccountRecord()] } });
      }
      if (url.includes('/api/v1/email/settings/snooze')) {
        return jsonResponse({ data: snoozeSettings() });
      }
      if (url.includes('/api/v1/email/settings/misc')) {
        return jsonResponse({ data: { webhookSecret: 'server-secret', maxAttachmentMb: '42' } });
      }
      return jsonResponse({ data: null }, 404);
    });
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl: fetchImpl as typeof fetch,
    }));

    render(<MiscPanel />);

    expect(await screen.findByDisplayValue('19:30')).toBeInTheDocument();
    expect(screen.getByDisplayValue('server-secret')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1\. Vorschau/ })).toBeEnabled();
    });
    expect(screen.getByText(/SimpleCRM-interne Nachrichten/)).toBeInTheDocument();
    expect(screen.queryByText(/lokale Nachrichten/)).not.toBeInTheDocument();
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
