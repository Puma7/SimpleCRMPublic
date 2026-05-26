const syncStore = new Map<string, string>();
const dbExec = jest.fn();
const stmt = {
  get: jest.fn(),
  run: jest.fn(),
  all: jest.fn(),
};
const db = { prepare: jest.fn(() => stmt), exec: dbExec };

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  getSyncInfo: (k: string) => syncStore.get(k) ?? null,
  setSyncInfo: (k: string, v: string) => syncStore.set(k, v),
}));
jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn(),
  getEmailAccountById: jest.fn(),
}));
jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: jest.fn(),
}));

import { getEmailAccountById, getEmailMessageById } from '../../electron/email/email-store';
import { sendSmtpForAccount } from '../../electron/email/email-smtp';
import { ensureVacationDedupTable, maybeSendVacationAutoReply } from '../../electron/email/email-vacation';

const baseMsg = {
  id: 1,
  account_id: 2,
  uid: 10,
  pop3_uidl: null,
  from_json: JSON.stringify({ value: [{ address: 'guest@example.com' }] }),
  raw_headers: '',
  message_id: '<m@x>',
  is_spam: 0,
  archived: 0,
  soft_deleted: 0,
  folder_kind: 'inbox',
};

const baseAcc = {
  id: 2,
  email_address: 'me@company.de',
  vacation_enabled: 1,
  vacation_subject: 'Away',
  vacation_body_text: 'Back later',
};

describe('email-vacation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    syncStore.clear();
    dbExec.mockClear();
    stmt.get.mockReset();
    stmt.run.mockReset();
    ensureVacationDedupTable();
    dbExec.mockImplementation(() => undefined);
  });

  test('ensureVacationDedupTable runs once', () => {
    ensureVacationDedupTable();
    ensureVacationDedupTable();
    expect(dbExec).toHaveBeenCalledTimes(1);
  });

  test('skips draft local-only messages', async () => {
    (getEmailMessageById as jest.Mock).mockReturnValue({ ...baseMsg, uid: -1, pop3_uidl: null });
    await maybeSendVacationAutoReply(1);
    expect(sendSmtpForAccount).not.toHaveBeenCalled();
  });

  test('skips when vacation disabled or missing account', async () => {
    (getEmailMessageById as jest.Mock).mockReturnValue(baseMsg);
    (getEmailAccountById as jest.Mock).mockReturnValue({ ...baseAcc, vacation_enabled: 0 });
    await maybeSendVacationAutoReply(1);
    (getEmailAccountById as jest.Mock).mockReturnValue(undefined);
    await maybeSendVacationAutoReply(1);
    expect(sendSmtpForAccount).not.toHaveBeenCalled();
  });

  test('skips auto-submitted and self sender', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValue(baseAcc);
    (getEmailMessageById as jest.Mock).mockReturnValue({
      ...baseMsg,
      raw_headers: 'Auto-Submitted: auto-generated',
    });
    await maybeSendVacationAutoReply(1);
    (getEmailMessageById as jest.Mock).mockReturnValue({
      ...baseMsg,
      from_json: JSON.stringify({ value: [{ address: 'me@company.de' }] }),
    });
    await maybeSendVacationAutoReply(1);
    expect(sendSmtpForAccount).not.toHaveBeenCalled();
  });

  test('skips when dedup or recent smtp fail', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValue(baseAcc);
    (getEmailMessageById as jest.Mock).mockReturnValue(baseMsg);
    stmt.get.mockReturnValueOnce({ 1: 1 });
    await maybeSendVacationAutoReply(1);
    syncStore.set('vacation_smtp_fail:2:guest@example.com', new Date().toISOString());
    await maybeSendVacationAutoReply(1);
    expect(sendSmtpForAccount).not.toHaveBeenCalled();
  });

  test('skips spam archived deleted non-inbox on fresh check', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValue(baseAcc);
    (getEmailMessageById as jest.Mock)
      .mockReturnValueOnce(baseMsg)
      .mockReturnValueOnce({ ...baseMsg, is_spam: 1 });
    await maybeSendVacationAutoReply(1);
    expect(sendSmtpForAccount).not.toHaveBeenCalled();
  });

  test('sends vacation reply and records dedup', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValue(baseAcc);
    (getEmailMessageById as jest.Mock).mockReturnValue(baseMsg);
    stmt.get.mockReturnValue(undefined);
    (sendSmtpForAccount as jest.Mock).mockResolvedValue(undefined);
    await maybeSendVacationAutoReply(1, baseMsg as never);
    expect(sendSmtpForAccount).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ to: 'guest@example.com', subject: 'Away' }),
    );
    expect(stmt.run).toHaveBeenCalled();
  });

  test('marks smtp failure and uses default subject/body', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValue({
      ...baseAcc,
      vacation_subject: null,
      vacation_body_text: null,
    });
    (getEmailMessageById as jest.Mock).mockReturnValue(baseMsg);
    stmt.get.mockReturnValue(undefined);
    (sendSmtpForAccount as jest.Mock).mockRejectedValue(new Error('smtp down'));
    await maybeSendVacationAutoReply(1);
    expect(syncStore.has('vacation_smtp_fail:2:guest@example.com')).toBe(true);
  });

  test('wasVacationSmtpFailedRecently ignores invalid timestamp', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValue(baseAcc);
    (getEmailMessageById as jest.Mock).mockReturnValue(baseMsg);
    stmt.get.mockReturnValue(undefined);
    syncStore.set('vacation_smtp_fail:2:guest@example.com', 'not-a-date');
    (sendSmtpForAccount as jest.Mock).mockResolvedValue(undefined);
    await maybeSendVacationAutoReply(1);
    expect(sendSmtpForAccount).toHaveBeenCalled();
  });

  test('skips precedence bulk headers', async () => {
    (getEmailAccountById as jest.Mock).mockReturnValue(baseAcc);
    (getEmailMessageById as jest.Mock).mockReturnValue({
      ...baseMsg,
      raw_headers: 'Precedence: bulk',
    });
    await maybeSendVacationAutoReply(1);
    expect(sendSmtpForAccount).not.toHaveBeenCalled();
  });
});
