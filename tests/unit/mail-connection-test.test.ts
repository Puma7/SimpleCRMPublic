const mockWithWorkspaceTransaction = jest.fn(async (
  db: unknown,
  _context: unknown,
  operation: (trx: unknown) => Promise<unknown>,
) => operation(db));

jest.mock('../../packages/server/src/db/workspace-context', () => ({
  withWorkspaceTransaction: (...args: unknown[]) => mockWithWorkspaceTransaction(...args),
}));

import { createServerMailConnectionTestPort } from '../../packages/server/src/mail-connection-test';

describe('server mail connection test stored credentials', () => {
  test('uses the stored SMTP TLS mode together with stored host and port', async () => {
    const account = {
      id: 7,
      imap_host: 'imap.saved.example',
      imap_port: 993,
      imap_tls: true,
      imap_username: 'saved@example.com',
      smtp_host: 'smtp.saved.example',
      smtp_port: 465,
      smtp_tls: true,
      smtp_username: 'saved@example.com',
      smtp_use_imap_auth: false,
      oauth_provider: null,
      pop3_host: null,
      pop3_port: null,
      pop3_tls: null,
    };
    const query: Record<string, jest.Mock> = {};
    query.select = jest.fn(() => query);
    query.where = jest.fn(() => query);
    query.executeTakeFirst = jest.fn(async () => account);
    const db = { selectFrom: jest.fn(() => query) };
    let socketInput: { host: string; port: number; tls: boolean; timeoutMs: number } | null = null;
    const socketFactory = jest.fn(async (input) => {
      socketInput = input;
      throw new Error('stop after input resolution');
    });
    const port = createServerMailConnectionTestPort({
      db: db as never,
      secrets: {
        readSecret: async () => Buffer.from('stored-secret'),
      } as never,
      socketFactory: socketFactory as never,
      timeoutMs: 1234,
    });

    await expect(port.testSmtp({
      workspaceId: 'workspace-a',
      accountId: 7,
      host: 'attacker.example',
      port: 25,
      tls: false,
      user: '',
    })).rejects.toThrow('stop after input resolution');

    expect(socketInput).toEqual(expect.objectContaining({
      host: 'smtp.saved.example',
      port: 465,
      tls: true,
      timeoutMs: 1234,
    }));
  });
});
