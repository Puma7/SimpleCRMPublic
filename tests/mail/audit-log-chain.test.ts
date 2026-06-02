import Database from 'better-sqlite3';
import { createAuthAuditLogTable, AUTH_AUDIT_LOG_TABLE } from '../../electron/database-schema';
import { logAuthAction, verifyAuditLogChain } from '../../electron/auth/audit-log';

describe('audit-log hash chain', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(createAuthAuditLogTable);
  });

  afterEach(() => {
    db.close();
  });

  it('verifies intact chain', () => {
    logAuthAction(db, { action: 'test.one' });
    logAuthAction(db, { userId: 'u1', action: 'test.two' });
    expect(verifyAuditLogChain(db).valid).toBe(true);
  });

  it('detects tampering', () => {
    logAuthAction(db, { action: 'test.one' });
    db.prepare(`UPDATE ${AUTH_AUDIT_LOG_TABLE} SET action = 'tampered' WHERE id = 1`).run();
    expect(verifyAuditLogChain(db).valid).toBe(false);
  });
});
