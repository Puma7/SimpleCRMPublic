import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
jest.mock('../../electron/sqlite-service', () => ({ getDb: () => db }));

import {
  saveMessageSecurity,
  securityVariablesFromRow,
} from '../../electron/email/mail-security-store';

describe('mail-security-store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.run.mockReturnValue({ changes: 1 });
  });

  test('saveMessageSecurity with auth and rspamd', () => {
    saveMessageSecurity(
      5,
      {
        spf: 'pass',
        dkim: 'pass',
        dmarc: 'pass',
        arc: 'none',
        dkimDomains: ['shop.com'],
        error: null,
      },
      { score: 2.5, action: 'add header', symbols: ['R_SPAM'], error: null },
    );
    expect(stmt.run).toHaveBeenCalled();
  });

  test('saveMessageSecurity rspamd only', () => {
    saveMessageSecurity(6, null, { score: 1, action: 'no action', symbols: [], error: 'x' });
    expect(stmt.run).toHaveBeenCalled();
  });

  test('securityVariablesFromRow maps fields', () => {
    const vars = securityVariablesFromRow({
      auth_spf: 'pass',
      auth_dkim: 'fail',
      auth_dmarc: 'pass',
      auth_arc: 'none',
      rspamd_score: 3,
      rspamd_action: 'reject',
    });
    expect(vars['auth.spf']).toBe('pass');
    expect(vars['rspamd.score']).toBe(3);
    expect(securityVariablesFromRow({})).toEqual({});
  });
});
