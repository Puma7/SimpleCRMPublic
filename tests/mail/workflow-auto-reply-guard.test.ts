/** Anti-Loop-Dedup für automatische KI-Antworten (echte In-Memory-DB). */
import Database from 'better-sqlite3';

const db = new Database(':memory:');

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  getSyncInfo: jest.fn((key: string) =>
    key === 'auto_reply_max_per_sender_per_day' ? mockedLimit : null,
  ),
  setSyncInfo: jest.fn(),
}));

let mockedLimit: string | null = null;

import { createEmailAutoReplyDedupTable } from '../../electron/database-schema';
import {
  autoReplyCountToday,
  isAutoReplyRateLimited,
  markAutoReplySent,
} from '../../electron/workflow/auto-reply-guard';

beforeAll(() => {
  db.exec(createEmailAutoReplyDedupTable);
});

beforeEach(() => {
  db.exec('DELETE FROM email_auto_reply_dedup');
  mockedLimit = null;
});

describe('auto-reply-guard', () => {
  test('Standard-Limit 1: zweite Antwort am selben Tag ist gesperrt', () => {
    expect(isAutoReplyRateLimited(1, 'kunde@firma.de')).toBe(false);
    markAutoReplySent(1, 'kunde@firma.de', 7);
    expect(autoReplyCountToday(1, 'kunde@firma.de')).toBe(1);
    expect(isAutoReplyRateLimited(1, 'kunde@firma.de')).toBe(true);
  });

  test('Absender wird normalisiert (Groß-/Kleinschreibung, Whitespace)', () => {
    markAutoReplySent(1, '  Kunde@Firma.DE ', 7);
    expect(isAutoReplyRateLimited(1, 'kunde@firma.de')).toBe(true);
  });

  test('höheres Limit erlaubt mehrere Antworten, zählt korrekt hoch', () => {
    mockedLimit = '3';
    markAutoReplySent(1, 'kunde@firma.de', 7);
    markAutoReplySent(1, 'kunde@firma.de', 8);
    expect(autoReplyCountToday(1, 'kunde@firma.de')).toBe(2);
    expect(isAutoReplyRateLimited(1, 'kunde@firma.de')).toBe(false);
    markAutoReplySent(1, 'kunde@firma.de', 9);
    expect(isAutoReplyRateLimited(1, 'kunde@firma.de')).toBe(true);
  });

  test('Konten und Absender sind unabhängig; leerer Absender gilt als gesperrt', () => {
    markAutoReplySent(1, 'kunde@firma.de', 7);
    expect(isAutoReplyRateLimited(2, 'kunde@firma.de')).toBe(false);
    expect(isAutoReplyRateLimited(1, 'andere@firma.de')).toBe(false);
    expect(isAutoReplyRateLimited(1, '')).toBe(true);
  });
});
