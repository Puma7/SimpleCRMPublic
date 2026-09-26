import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockInvoke = jest.fn();
let mockTransportKind: 'ipc' | 'http' = 'ipc';
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  getRendererTransport: () => ({ kind: mockTransportKind }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('@/components/email/settings/knowledge-markdown-editor', () => ({
  KnowledgeMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Markdown editor" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
jest.mock('@/components/email/ai-profile-select', () => ({
  AiProfileSelect: ({ label }: { label: string }) => <div>{label}</div>,
}));

let mockRole = 'admin';
let mockCapabilities: string[] = [];
jest.mock('@/components/auth/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: mockRole },
    hasCapability: (capability: string) => mockRole === 'owner' || mockRole === 'admin' || mockCapabilities.includes(capability),
  }),
}));

import { LearningsPanel } from '@/components/email/settings/learnings-panel';
import { LearningsDiffView } from '@/components/email/settings/learnings-diff-view';
import { LearningNoteButton } from '@/components/email/learning-note-button';
import { IPCChannels } from '@shared/ipc/channels';
import { toast } from 'sonner';

const mockToast = toast as unknown as { success: jest.Mock; error: jest.Mock; info: jest.Mock };

const baseContent = '# Firma\n\n## Rückgabe\n\n14 Tage.\n';
const proposed = '# Firma\n\n## Rückgabe\n\n30 Tage.\n';

function overview(extra: Record<string, unknown> = {}) {
  return {
    settings: { collectEnabled: false, targetKnowledgeBaseId: null, profileId: null },
    counts: { draft_edit: 1, human_reply: 2, note: 1, total: 4 },
    pendingDigestId: 7,
    running: false,
    lastDigestAt: null,
    effectiveKnowledgeBaseId: 3,
    ...extra,
  };
}

const pendingDetail = {
  id: 7,
  knowledgeBaseId: 3,
  knowledgeBaseName: 'Learnings',
  status: 'pending',
  trigger: 'manual',
  requestedByUserId: 'u1',
  requestedByName: 'Erika',
  workflowId: null,
  periodFrom: null,
  periodTo: '2026-09-26T10:00:00.000Z',
  candidateCount: 4,
  summary: 'Rückgabefrist korrigiert.',
  operations: [],
  error: null,
  createdAt: '2026-09-26T10:00:00.000Z',
  decidedByUserId: null,
  decidedByName: null,
  decidedAt: null,
  baseContent,
  proposedContent: proposed,
  currentContent: baseContent,
  knowledgeBaseChanged: false,
};

function mockBackend(options: {
  overview?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  knowledgeBases?: Array<Record<string, unknown>>;
} = {}) {
  mockInvoke.mockImplementation(async (channel: string) => {
    switch (channel) {
      case IPCChannels.Email.GetLearningsOverview:
        return overview(options.overview);
      case IPCChannels.Email.ListLearningDigests:
        return [
          { ...pendingDetail },
          { ...pendingDetail, id: 6, status: 'failed', error: 'Antwort der KI enthält kein gültiges JSON', createdAt: '2026-09-20T10:00:00.000Z' },
          { ...pendingDetail, id: 5, status: 'accepted', decidedByName: 'Admin', decidedAt: '2026-09-19T10:00:00.000Z' },
        ];
      case IPCChannels.Email.ListKnowledgeBases:
        return options.knowledgeBases ?? [{ id: 3, name: 'Learnings', knowledge_context: 'learnings', account_id: null }];
      case IPCChannels.Email.GetLearningDigest:
        return { ...pendingDetail, ...options.detail };
      case IPCChannels.Email.ListLearningCandidates:
        return [{
          id: 11, kind: 'draft_edit', accountId: null, sourceMessageId: 1, sentMessageId: 2,
          questionText: 'Betreff: Rückgabe', aiText: '14 Tage.', humanText: '30 Tage.', noteText: null,
          createdByUserId: null, createdAt: '2026-09-25T10:00:00.000Z', digestId: null, processedAt: null,
        }];
      case IPCChannels.Email.SaveLearningsSettings:
        return { success: true, settings: { collectEnabled: true, targetKnowledgeBaseId: null, profileId: null } };
      default:
        return { success: true };
    }
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
  Object.values(mockToast).forEach((fn) => fn.mockReset());
  mockRole = 'admin';
  mockCapabilities = [];
  mockTransportKind = 'ipc';
});

describe('Einstellungen → Learnings (TA-P5)', () => {
  test.each([
    ['ipc', 'agent', []],
    ['http', 'user', ['workflows.view']],
  ] as const)('%s/%s ohne Verwaltungsrecht sieht nur den Hinweis', (kind, role, capabilities) => {
    mockTransportKind = kind;
    mockRole = role;
    mockCapabilities = [...capabilities];
    render(<LearningsPanel />);
    expect(screen.getByText('Nur für Owner und Admins')).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test('Ziel-Hinweis: eigene Learnings-Basis wird immer gelesen, gewählte Basis behält ihren Kontext', async () => {
    mockBackend();
    const { unmount } = render(<LearningsPanel />);
    expect(await screen.findByTestId('learnings-target-hint')).toHaveTextContent(
      'KI-Bausteine lesen sie immer zusätzlich zu den übrigen Wissensbasen.',
    );
    expect(screen.queryByText('Hinweis zur allgemeinen Wissensbasis')).not.toBeInTheDocument();
    unmount();

    mockBackend({
      overview: { settings: { collectEnabled: false, targetKnowledgeBaseId: 4, profileId: null } },
      knowledgeBases: [{ id: 4, name: 'Firma', knowledge_context: 'general', account_id: null }],
    });
    const second = render(<LearningsPanel />);
    expect(await screen.findByTestId('learnings-target-hint')).toHaveTextContent(
      'Diese Wissensbasis behält ihren Kontext „Allgemein (Firma)“ und wird wie bisher gelesen.',
    );
    second.unmount();

    mockBackend({
      overview: { settings: { collectEnabled: false, targetKnowledgeBaseId: 5, profileId: null } },
      knowledgeBases: [{ id: 5, name: 'Ohne Kontext', knowledge_context: null, account_id: null }],
    });
    render(<LearningsPanel />);
    expect(await screen.findByTestId('learnings-target-hint')).toHaveTextContent(
      'nur, wenn sie im Baustein ausdrücklich gewählt ist',
    );
  });

  test('Server-Nutzer mit workflows.manage verwaltet Learnings', async () => {
    mockTransportKind = 'http';
    mockRole = 'user';
    mockCapabilities = ['workflows.manage'];
    mockBackend();
    render(<LearningsPanel />);
    expect(await screen.findByText('Rückgabefrist korrigiert.')).toBeInTheDocument();
  });

  test('zeigt Einträge, Vorschlag mit Änderungsansicht, Verlauf und Datenschutz', async () => {
    mockBackend();
    render(<LearningsPanel />);
    expect(await screen.findByText('Rückgabefrist korrigiert.')).toBeInTheDocument();
    expect(screen.getByTestId('learnings-counts')).toHaveTextContent('4 offen · 1 geänderte KI-Entwürfe · 2 Antworten · 1 Notizen');
    expect(await screen.findByText('30 Tage.', { selector: 'p' })).toBeInTheDocument();
    const diff = screen.getByLabelText('Änderungen an der Wissensbasis');
    expect(within(diff).getByTitle('entfernt')).toHaveTextContent('14');
    expect(within(diff).getByTitle('neu')).toHaveTextContent('30');
    expect(screen.getByTestId('learnings-privacy')).toHaveTextContent('personenbezogene Daten');
    const history = screen.getByRole('region', { name: 'Verlauf' });
    expect(within(history).getByText('Fehlgeschlagen')).toBeInTheDocument();
    expect(within(history).getByText('Antwort der KI enthält kein gültiges JSON')).toBeInTheDocument();
    expect(within(history).getByText(/von Admin/)).toBeInTheDocument();
    // Offener Vorschlag sperrt eine neue Auswertung.
    expect(screen.getByRole('button', { name: 'Learnings jetzt auswerten' })).toBeDisabled();
  });

  test('Bearbeiten ändert die Vorschau live; Übernehmen mit Konfliktwarnung und Bestätigung', async () => {
    mockBackend();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LearningsPanel />);
    await screen.findByText('Rückgabefrist korrigiert.');
    fireEvent.click(screen.getByRole('button', { name: /Bearbeiten/ }));
    fireEvent.change(screen.getByLabelText('Markdown editor'), { target: { value: '# Firma\n\n## Rückgabe\n\n30 Tage, kostenlos.\n' } });
    expect(screen.getByText('Der Vorschlag wurde bearbeitet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Änderungen' }));
    expect(within(screen.getByLabelText('Änderungen an der Wissensbasis')).getAllByTitle('neu').map((el) => el.textContent).join(''))
      .toContain('kostenlos');

    mockInvoke.mockImplementation(async (channel: string, payload: { confirmOverwrite?: boolean }) => {
      if (channel === IPCChannels.Email.AcceptLearningDigest) {
        return payload.confirmOverwrite
          ? { success: true, digest: { ...pendingDetail, status: 'accepted' } }
          : { success: false, code: 'knowledge_base_changed', error: 'geändert', currentContent: '# Neu' };
      }
      if (channel === IPCChannels.Email.GetLearningsOverview) return overview({ pendingDigestId: null });
      if (channel === IPCChannels.Email.ListLearningDigests || channel === IPCChannels.Email.ListKnowledgeBases
        || channel === IPCChannels.Email.ListLearningCandidates) return [];
      return { success: true };
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Vorschlag in die Wissensbasis übernommen.'));
    const acceptCalls = mockInvoke.mock.calls.filter(([channel]) => channel === IPCChannels.Email.AcceptLearningDigest);
    expect(acceptCalls).toEqual([
      [IPCChannels.Email.AcceptLearningDigest, { id: 7, content: '# Firma\n\n## Rückgabe\n\n30 Tage, kostenlos.\n' }],
      [IPCChannels.Email.AcceptLearningDigest, { id: 7, content: '# Firma\n\n## Rückgabe\n\n30 Tage, kostenlos.\n', confirmOverwrite: true }],
    ]);
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Rückgabefrist korrigiert.')).not.toBeInTheDocument());
    confirm.mockRestore();
  });

  test('warnt vorab, wenn die Wissensbasis seit dem Vorschlag geändert wurde; Verwerfen', async () => {
    mockBackend({ detail: { currentContent: '# Firma\n\n## Rückgabe\n\n21 Tage.\n', knowledgeBaseChanged: true } });
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LearningsPanel />);
    expect(await screen.findByText('Wissensbasis wurde zwischenzeitlich geändert')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    });
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.RejectLearningDigest, { id: 7 });
    expect(mockToast.success).toHaveBeenCalledWith('Vorschlag verworfen.');
    confirm.mockRestore();
  });

  test('Sammeln einschalten, Eintrag löschen, Auswertung starten', async () => {
    mockBackend({ overview: { pendingDigestId: null } });
    render(<LearningsPanel />);
    await screen.findByText('Betreff: Rückgabe', { exact: false });
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.SaveLearningsSettings, { collectEnabled: true });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Eintrag löschen' }));
    });
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.DeleteLearningCandidate, { id: 11 });

    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === IPCChannels.Email.RunLearningsDigest) return { status: 'skipped_no_candidates', digestId: null, candidateCount: 0 };
      if (channel === IPCChannels.Email.GetLearningsOverview) return overview({ pendingDigestId: null });
      return [];
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Learnings jetzt auswerten' }));
    });
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.RunLearningsDigest, { period: 'since_last' });
    expect(mockToast.info).toHaveBeenCalledWith('Im gewählten Zeitraum gibt es keine gesammelten Einträge.');
  });
});

describe('Änderungsansicht (TA-P5)', () => {
  test('markiert Entferntes und Neues und zählt Wörter', () => {
    render(<LearningsDiffView before={'A b c\n'} after={'A x c\nNeu\n'} />);
    expect(screen.getByTestId('learnings-diff-summary')).toHaveTextContent('2 Wörter neu · 1 Wörter entfernt');
    expect(screen.getByTitle('entfernt').tagName).toBe('DEL');
    expect(screen.getAllByTitle('neu')[0]!.tagName).toBe('INS');
  });

  test('meldet unveränderte Fassung', () => {
    render(<LearningsDiffView before="gleich" after="gleich" />);
    expect(screen.getByTestId('learnings-diff-summary')).toHaveTextContent('Keine Änderungen');
  });
});

describe('Learning notieren (TA-P5)', () => {
  test('speichert mit und ohne Mail-Bezug', async () => {
    mockInvoke.mockResolvedValue({ success: true });
    render(<LearningNoteButton messageId={42} />);
    fireEvent.click(screen.getByRole('button', { name: /Learning notieren/ }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Speichern' });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Notiz'), { target: { value: '  Sie-Form verwenden.  ' } });
    await act(async () => {
      fireEvent.click(save);
    });
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.AddLearningNote, { text: 'Sie-Form verwenden.', messageId: 42 });
    expect(mockToast.success).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Learning notieren/ }));
    const second = await screen.findByRole('dialog');
    fireEvent.click(within(second).getByRole('checkbox'));
    fireEvent.change(within(second).getByLabelText('Notiz'), { target: { value: 'Ohne Bezug.' } });
    await act(async () => {
      fireEvent.click(within(second).getByRole('button', { name: 'Speichern' }));
    });
    expect(mockInvoke).toHaveBeenLastCalledWith(IPCChannels.Email.AddLearningNote, { text: 'Ohne Bezug.' });
  });

  test('zeigt Fehler und lässt den Dialog offen', async () => {
    mockInvoke.mockResolvedValue({ success: false, error: 'E-Mail nicht gefunden' });
    render(<LearningNoteButton messageId={null} />);
    fireEvent.click(screen.getByRole('button', { name: /Learning notieren/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Notiz'), { target: { value: 'x' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    });
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.AddLearningNote, { text: 'x' });
    expect(mockToast.error).toHaveBeenCalledWith('E-Mail nicht gefunden');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
