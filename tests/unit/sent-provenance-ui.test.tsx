/**
 * Kennzeichnung „gesendet von“ (Teilautomatisierung P3) in der Oberfläche:
 * Kennzeichen in der Liste, Zeile in der Leseansicht, Ansicht „Gesendet (KI)“
 * in der Seitenleiste und deren Wiederherstellung aus localStorage.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

const mockSetMailView = jest.fn();
let mockMailView = 'sent';
let mockUseRealWorkspace = false;
jest.mock('@/components/email/workspace-context', () => {
  const actual = jest.requireActual('@/components/email/workspace-context');
  return {
    ...actual,
    useMailWorkspace: () => (mockUseRealWorkspace ? actual.useMailWorkspace() : {
      selectedAccountId: 'all',
      setSelectedAccountId: jest.fn(),
      mailView: mockMailView,
      setMailView: mockSetMailView,
      categoryFilterId: null,
      setCategoryFilterId: jest.fn(),
      setSearchQuery: jest.fn(),
    }),
  };
});

jest.mock('@/components/email/hooks/use-mail-folder-counts', () => ({
  useMailFolderCounts: () => ({
    counts: {
      inbox: 0, inboxUnread: 0, sentFailed: 2, drafts: 0, scheduledSend: 0,
      archived: 0, spamReview: 0, spam: 0, trash: 0, snoozed: 0,
    },
  }),
}));

jest.mock('@/services/transport', () => ({
  invokeRenderer: jest.fn(async () => []),
  getRendererTransport: () => ({ kind: 'ipc' }),
}));

import { MailSidebar } from '@/components/email/mail-sidebar';
import { SentProvenanceBadges, SentProvenanceLine } from '@/components/email/sent-provenance';
import { MailWorkspaceProvider, useMailWorkspace } from '@/components/email/workspace-context';

beforeEach(() => {
  mockSetMailView.mockReset();
  mockMailView = 'sent';
  mockUseRealWorkspace = false;
  window.localStorage.clear();
});

describe('Kennzeichen in der Nachrichtenliste', () => {
  test.each([
    ['ai_auto', 'KI'],
    ['ai_approved', 'KI · freigegeben'],
    ['workflow', 'Automatik'],
    ['relay', 'Relay'],
  ])('%s ⇒ „%s“ mit Namen als Tooltip', (kind, text) => {
    render(<SentProvenanceBadges message={{ sent_by_kind: kind, sent_by_label: 'Workflow „KI-Antwort“' }} />);
    const badge = screen.getByTestId('sent-provenance-badge');
    expect(badge).toHaveTextContent(text);
    expect(badge).toHaveAttribute('title', 'Workflow „KI-Antwort“');
    expect(screen.queryByTestId('sent-provenance-skipped-badge')).toBeNull();
  });

  test('Mensch und Altbestand bleiben unmarkiert', () => {
    const { container } = render(
      <>
        <SentProvenanceBadges message={{ sent_by_kind: 'human', sent_by_label: 'Anna' }} />
        <SentProvenanceBadges message={{ sent_by_kind: null }} />
        <SentProvenanceBadges message={{}} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('„ohne Prüfung“ auch bei einem Menschen', () => {
    render(<SentProvenanceBadges message={{ sent_by_kind: 'human', sent_outbound_review_skipped: 1 }} />);
    expect(screen.queryByTestId('sent-provenance-badge')).toBeNull();
    expect(screen.getByTestId('sent-provenance-skipped-badge')).toHaveTextContent('ohne Prüfung');
  });
});

describe('Zeile in der Leseansicht', () => {
  test.each([
    ['human', 'Anna Beispiel', 'Gesendet von: Anna Beispiel'],
    ['ai_auto', 'Workflow „KI-Antwort“', 'Automatisch von KI gesendet (Workflow „KI-Antwort“)'],
    ['ai_approved', 'Anna Beispiel', 'KI-Entwurf, freigegeben von Anna Beispiel'],
    ['workflow', 'Workflow „Rechnungen“', 'Automatisch gesendet (Workflow „Rechnungen“)'],
    ['relay', 'Shop-System', 'Über das SMTP-Relay gesendet (Shop-System)'],
  ])('%s ⇒ %s', (kind, label, text) => {
    render(<SentProvenanceLine message={{ sent_by_kind: kind, sent_by_label: label }} />);
    expect(screen.getByTestId('sent-provenance-line')).toHaveTextContent(text);
  });

  test('übersprungene Ausgangsprüfung wird genannt', () => {
    render(
      <SentProvenanceLine
        message={{ sent_by_kind: 'human', sent_by_label: 'Anna', sent_outbound_review_skipped: 1 }}
      />,
    );
    const line = screen.getByTestId('sent-provenance-line');
    expect(line).toHaveTextContent('Gesendet von: Anna');
    expect(line).toHaveTextContent('Ausgangsprüfung übersprungen');
  });

  test('ohne Kennzeichnung (Altbestand, empfangene Mail) keine Zeile', () => {
    render(<SentProvenanceLine message={{ sent_by_kind: null, sent_outbound_review_skipped: 0 }} />);
    expect(screen.queryByTestId('sent-provenance-line')).toBeNull();
  });
});

describe('Ansicht „Gesendet (KI)“', () => {
  function renderSidebar() {
    render(
      <MailSidebar
        accounts={[]}
        loadingAccounts={false}
        categories={[]}
        countForCategory={() => 0}
        onCategoriesChanged={jest.fn()}
        onMoveMessageToView={jest.fn(async () => true)}
        onMoveMessagesToView={jest.fn(async () => true)}
        onAssignMessageCategory={jest.fn(async () => true)}
        onAssignMessagesCategory={jest.fn(async () => true)}
        onSnoozeMessage={jest.fn(async () => true)}
      />,
    );
  }

  test('steht direkt unter „Gesendet“ und wählt die Ansicht sent_ai', () => {
    renderSidebar();
    const labels = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('title'))
      .filter((title): title is string => Boolean(title));
    const sentIndex = labels.findIndex((title) => title.startsWith('Gesendet:'));
    expect(sentIndex).toBeGreaterThanOrEqual(0);
    expect(labels[sentIndex + 1]).toBe('Gesendet (KI)');

    const sentAi = screen.getByTitle('Gesendet (KI)');
    // Kein eigener Zähler (die fehlgeschlagenen Server-Kopien zählt „Gesendet“).
    expect(sentAi).toHaveTextContent(/^Gesendet \(KI\)$/);
    fireEvent.click(sentAi);
    expect(mockSetMailView).toHaveBeenCalledWith('sent_ai');
  });

  test('ist kein Ablageziel für Drag & Drop', () => {
    renderSidebar();
    const dataTransfer = {
      getData: () => JSON.stringify({ messageId: 5, messageIds: [5] }),
      types: ['application/x-simplecrm-mail'],
      dropEffect: 'none',
    };
    // Gegenprobe: „Archiv“ nimmt Mails an (dragOver wird abgebrochen).
    expect(fireEvent.dragOver(screen.getByTitle('Archiv'), { dataTransfer })).toBe(false);
    expect(fireEvent.dragOver(screen.getByTitle('Gesendet (KI)'), { dataTransfer })).toBe(true);
  });

  test('wird aus localStorage wiederhergestellt, unbekannte Werte nicht', () => {
    mockUseRealWorkspace = true;
    function Probe() {
      const { mailView } = useMailWorkspace();
      return <span data-testid="view">{mailView}</span>;
    }
    window.localStorage.setItem('email:mailView', 'sent_ai');
    const first = render(<MailWorkspaceProvider><Probe /></MailWorkspaceProvider>);
    expect(screen.getByTestId('view')).toHaveTextContent('sent_ai');
    first.unmount();

    window.localStorage.setItem('email:mailView', 'sent_robot');
    render(<MailWorkspaceProvider><Probe /></MailWorkspaceProvider>);
    expect(screen.getByTestId('view')).toHaveTextContent('inbox');
  });
});
