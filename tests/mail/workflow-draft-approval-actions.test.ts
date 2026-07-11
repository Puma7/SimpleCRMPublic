/**
 * "Jetzt senden"/"Als Entwurf behalten" (Zwei-Stufen-KI-Antwort): der
 * Approve-Pfad darf NUR Entwürfe einplanen, die noch auf Freigabe warten —
 * ein staler zweiter View (Entwurf inzwischen bearbeitet/dismisst) darf
 * nicht an der Ausgangsprüfung vorbei senden. Echte In-Memory-DB für den
 * Freigabe-Zustand; Einplanung und Tagesbudget sind gemockt.
 */
import Database from 'better-sqlite3';

const db = new Database(':memory:');

const mockPrepare = jest.fn(() => ({ ok: true as const }));
const mockMarkAutoReplySent = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (id: number) =>
    db.prepare('SELECT * FROM email_messages WHERE id = ?').get(id),
}));

jest.mock('../../electron/workflow/draft-send-prep', () => ({
  prepareDraftForWorkflowSend: (...args: unknown[]) => mockPrepare(...(args as [])),
}));

jest.mock('../../electron/workflow/auto-reply-guard', () => ({
  markAutoReplySent: (...args: unknown[]) => mockMarkAutoReplySent(...args),
}));

import {
  approveDraftSend,
  dismissDraftApproval,
} from '../../electron/workflow/draft-approval-actions';

type Row = {
  approval_state: string | null;
  approval_reason: string | null;
  auto_submitted: number;
};

function row(id: number): Row {
  return db
    .prepare('SELECT approval_state, approval_reason, auto_submitted FROM email_messages WHERE id = ?')
    .get(id) as Row;
}

beforeAll(() => {
  db.exec(`
    CREATE TABLE email_messages (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL DEFAULT 1,
      to_json TEXT,
      reply_parent_message_id INTEGER,
      approval_state TEXT,
      approval_reason TEXT,
      auto_submitted INTEGER NOT NULL DEFAULT 0
    );
  `);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrepare.mockReturnValue({ ok: true as const });
  db.exec('DELETE FROM email_messages');
  db.prepare(
    `INSERT INTO email_messages (id, account_id, to_json, reply_parent_message_id, approval_state, approval_reason)
     VALUES (42, 1, ?, 7, 'pending', 'Kulanz prüfen')`,
  ).run(JSON.stringify({ value: [{ address: 'kunde@firma.de' }] }));
});

describe('approveDraftSend', () => {
  test('pending: plant ein, stempelt RFC-3834-Marker NACH prep, zählt Budget, cleart Freigabe', () => {
    const r = approveDraftSend(42);
    expect(r).toEqual({ success: true });
    expect(mockPrepare).toHaveBeenCalledWith(42, { runOutboundReview: false });
    expect(row(42)).toMatchObject({
      approval_state: null,
      approval_reason: null,
      auto_submitted: 1,
    });
    expect(mockMarkAutoReplySent).toHaveBeenCalledWith(1, 'kunde@firma.de', 7);
  });

  test('nicht (mehr) pending: lehnt ab, plant NICHT ein', () => {
    db.prepare('UPDATE email_messages SET approval_state = NULL WHERE id = 42').run();
    const r = approveDraftSend(42);
    expect(r).toMatchObject({ success: false });
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(row(42).auto_submitted).toBe(0);
  });

  test('fehlender Entwurf: Fehler, kein prep', () => {
    expect(approveDraftSend(999)).toMatchObject({ success: false });
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  test('prep schlägt fehl: Freigabe-Zustand bleibt erhalten (Banner + Grund)', () => {
    mockPrepare.mockReturnValue({ ok: false as const, message: 'kein Entwurf' });
    const r = approveDraftSend(42);
    expect(r).toEqual({ success: false, error: 'kein Entwurf' });
    expect(row(42)).toMatchObject({
      approval_state: 'pending',
      approval_reason: 'Kulanz prüfen',
      auto_submitted: 0,
    });
    expect(mockMarkAutoReplySent).not.toHaveBeenCalled();
  });
});

describe('dismissDraftApproval', () => {
  test('cleart Freigabe UND RFC-3834-Marker — späterer manueller Versand ist keine Auto-Antwort', () => {
    db.prepare('UPDATE email_messages SET auto_submitted = 1 WHERE id = 42').run();
    const r = dismissDraftApproval(42);
    expect(r).toEqual({ success: true });
    expect(row(42)).toMatchObject({
      approval_state: null,
      approval_reason: null,
      auto_submitted: 0,
    });
    expect(mockPrepare).not.toHaveBeenCalled();
  });
});
