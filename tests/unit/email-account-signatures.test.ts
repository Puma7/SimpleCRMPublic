import {
  getComposeSignatureHtml,
  listAccountSignatureRows,
  saveAccountSignature,
} from '../../electron/email/email-store';

const account = {
  id: 7,
  display_name: 'Shop Nord',
  email_address: 'nord@example.com',
};

let perAccountSignature: string | null = null;
let teamMembers: { id: string; display_name: string; role: string; signature_html: string | null }[] =
  [{ id: 'team-1', display_name: 'Team Fallback', role: '', signature_html: '<p>Team HTML</p>' }];

jest.mock('../../electron/sqlite-service', () => {
  const prepare = jest.fn((sql: string) => ({
    all: () => {
      if (sql.includes('email_team_members')) {
        return teamMembers;
      }
      if (sql.includes('LEFT JOIN')) {
        return [
          {
            account_id: account.id,
            display_name: account.display_name,
            email_address: account.email_address,
            signature_html: perAccountSignature,
          },
        ];
      }
      return [];
    },
    get: (...args: unknown[]) => {
      if (sql.includes('email_accounts') && args[0] === account.id) {
        return account;
      }
      if (sql.includes('email_account_signatures') && args[0] === account.id) {
        return perAccountSignature ? { signature_html: perAccountSignature } : undefined;
      }
      return undefined;
    },
    run: jest.fn(),
  }));
  return { getDb: () => ({ prepare }) };
});

describe('email account signatures', () => {
  beforeEach(() => {
    perAccountSignature = null;
    teamMembers = [
      { id: 'team-1', display_name: 'Team Fallback', role: '', signature_html: '<p>Team HTML</p>' },
    ];
  });

  it('listAccountSignatureRows joins accounts with signature rows', () => {
    perAccountSignature = '<p>Per shop</p>';
    const rows = listAccountSignatureRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      account_id: account.id,
      signature_html: '<p>Per shop</p>',
    });
  });

  it('getComposeSignatureHtml prefers per-account signature', () => {
    perAccountSignature = '<p>Konto</p>';
    expect(getComposeSignatureHtml(account.id)).toBe('<p>Konto</p>');
  });

  it('getComposeSignatureHtml falls back to team signature', () => {
    expect(getComposeSignatureHtml(account.id)).toBe('<p>Team HTML</p>');
  });

  it('getComposeSignatureHtml uses the explicitly selected team member', () => {
    teamMembers = [
      { id: 'team-1', display_name: 'Anna', role: '', signature_html: '<p>Anna SIG</p>' },
      { id: 'team-2', display_name: 'Ben', role: '', signature_html: '<p>Ben SIG</p>' },
    ];
    expect(getComposeSignatureHtml(account.id, 'team-2')).toBe('<p>Ben SIG</p>');
  });

  it('interpolates an account template with the selected team member', () => {
    perAccountSignature = '<p>{{user.name}} / {{user.email}}</p>';
    teamMembers = [
      { id: 'team-1', display_name: 'Anna', role: '', signature_html: null },
      { id: 'team-2', display_name: 'Ben', role: '', signature_html: null },
    ];
    expect(getComposeSignatureHtml(account.id, 'team-2')).toBe(
      '<p>Ben / nord@example.com</p>',
    );
  });

  it('getComposeSignatureHtml falls back to account display name when team is empty', () => {
    teamMembers = [];
    expect(getComposeSignatureHtml(account.id)).toContain('Shop Nord');
  });

  it('saveAccountSignature clears row when html is empty', () => {
    const { getDb } = jest.requireMock('../../electron/sqlite-service') as {
      getDb: () => { prepare: jest.Mock };
    };
    saveAccountSignature(account.id, '  ');
    const deleteCall = getDb().prepare.mock.calls.find(([sql]: [string]) =>
      sql.includes('DELETE FROM'),
    );
    expect(deleteCall).toBeDefined();
  });
});
