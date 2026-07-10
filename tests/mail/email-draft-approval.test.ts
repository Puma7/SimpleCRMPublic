/** Freigabe-Zustand für KI-Entwürfe (echte In-Memory-DB). */
import Database from 'better-sqlite3';

const db = new Database(':memory:');

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
}));

import {
  clearDraftApproval,
  getDraftApproval,
  isDraftAutoSubmitted,
  markDraftAutoSubmitted,
  setDraftApprovalPending,
} from '../../electron/email/email-draft-approval';

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
    expect(getDraftApproval(42)).toEqual({
      state: 'pending',
      reason: 'Kulanz-Zusage bitte prüfen',
    });
    // Nachbar-Datensatz unberührt
    expect(getDraftApproval(43)).toEqual({ state: null, reason: null });

    setDraftApprovalPending(42, 'x'.repeat(600));
    expect(getDraftApproval(42).reason).toHaveLength(500);
  });

  test('clearDraftApproval räumt Zustand und Grund auf', () => {
    setDraftApprovalPending(42, 'Grund');
    clearDraftApproval(42);
    expect(getDraftApproval(42)).toEqual({ state: null, reason: null });
  });

  test('getDraftApproval für unbekannte Nachricht → neutral', () => {
    expect(getDraftApproval(999)).toEqual({ state: null, reason: null });
  });

  test('markDraftAutoSubmitted / isDraftAutoSubmitted (RFC-3834-Marker)', () => {
    expect(isDraftAutoSubmitted(42)).toBe(false);
    markDraftAutoSubmitted(42);
    expect(isDraftAutoSubmitted(42)).toBe(true);
    expect(isDraftAutoSubmitted(43)).toBe(false);
    expect(isDraftAutoSubmitted(999)).toBe(false);
  });
});
