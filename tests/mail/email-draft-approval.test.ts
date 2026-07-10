/** Freigabe-Zustand für KI-Entwürfe (echte In-Memory-DB). */
import Database from 'better-sqlite3';

const db = new Database(':memory:');

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
}));

import {
  clearDraftApproval,
  markDraftAutoSubmitted,
  setDraftApprovalPending,
} from '../../electron/email/email-draft-approval';

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
      approval_state TEXT,
      approval_reason TEXT,
      auto_submitted INTEGER NOT NULL DEFAULT 0
    );
  `);
});

beforeEach(() => {
  db.exec('DELETE FROM email_messages');
  db.exec("INSERT INTO email_messages (id) VALUES (42), (43)");
});

describe('email-draft-approval', () => {
  test('setDraftApprovalPending setzt Zustand und Grund (Grund gekappt auf 500 Zeichen)', () => {
    setDraftApprovalPending(42, 'Kulanz-Zusage bitte prüfen');
    expect(row(42)).toMatchObject({
      approval_state: 'pending',
      approval_reason: 'Kulanz-Zusage bitte prüfen',
    });
    // Nachbar-Datensatz unberührt
    expect(row(43)).toMatchObject({ approval_state: null, approval_reason: null });

    setDraftApprovalPending(42, 'x'.repeat(600));
    expect(row(42).approval_reason).toHaveLength(500);
  });

  test('clearDraftApproval räumt Zustand und Grund auf', () => {
    setDraftApprovalPending(42, 'Grund');
    clearDraftApproval(42);
    expect(row(42)).toMatchObject({ approval_state: null, approval_reason: null });
  });

  test('markDraftAutoSubmitted setzt den RFC-3834-Marker nur für den Ziel-Entwurf', () => {
    markDraftAutoSubmitted(42);
    expect(row(42).auto_submitted).toBe(1);
    expect(row(43).auto_submitted).toBe(0);
  });
});
