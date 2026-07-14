jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
  getCustomerById: jest.fn(),
}));

jest.mock('../../electron/email/email-remote-content', () => ({
  consumeAllowedOnceRemoteContent: jest.fn(),
  setRemoteContentPolicy: jest.fn(),
}));

import { getCustomerById, getDb } from '../../electron/sqlite-service';
import {
  detectAndFlagReadReceiptRequest,
  getReadReceiptSettings,
  logReadReceiptAction,
} from '../../electron/email/email-read-receipt';
import {
  getLocalReadReceiptSettings,
  logLocalReadReceiptDeclined,
} from '../../electron/email/email-read-receipt-store';
import {
  consumeAllowedOnceRemoteContentLocal,
  setLocalRemoteContentPolicy,
} from '../../electron/email/email-remote-content-store';
import {
  consumeAllowedOnceRemoteContent,
  setRemoteContentPolicy,
} from '../../electron/email/email-remote-content';
import { getEmailAiCustomerTemplateContext } from '../../electron/email/email-ai-customer-context-store';
import '../../electron/email/email-spam-types';

const getDbMock = getDb as jest.MockedFunction<typeof getDb>;
const getCustomerByIdMock = getCustomerById as jest.MockedFunction<typeof getCustomerById>;
const consumeRemoteMock = consumeAllowedOnceRemoteContent as jest.MockedFunction<
  typeof consumeAllowedOnceRemoteContent
>;
const setRemoteMock = setRemoteContentPolicy as jest.MockedFunction<typeof setRemoteContentPolicy>;

function fakeDb(getResult?: unknown) {
  const run = jest.fn();
  const get = jest.fn(() => getResult);
  const prepare = jest.fn(() => ({ run, get }));
  return { db: { prepare } as never, prepare, run, get };
}

describe('read receipt persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not persist a request without a disposition header', () => {
    const { db, prepare } = fakeDb();

    expect(detectAndFlagReadReceiptRequest(db, 12, 'From: sender@example.com\r\n')).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });

  test('flags and logs an incoming disposition request', () => {
    const { db, prepare, run } = fakeDb();

    expect(
      detectAndFlagReadReceiptRequest(
        db,
        12,
        'Disposition-Notification-To: Sender <sender@example.com>\r\n',
      ),
    ).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, 12);
    expect(run).toHaveBeenNthCalledWith(2, 12, 'Sender <sender@example.com>');
  });

  test('returns account settings and safe defaults', () => {
    const configured = fakeDb({
      respond_to_read_receipts: 'always_trusted',
      read_receipt_trusted_domains: 'example.com',
    });
    expect(getReadReceiptSettings(configured.db, 3)).toEqual({
      respond: 'always_trusted',
      trustedDomains: 'example.com',
    });

    const missing = fakeDb(undefined);
    expect(getReadReceiptSettings(missing.db, 99)).toEqual({
      respond: 'never',
      trustedDomains: null,
    });
  });

  test('logs actions with and without an explicit recipient', () => {
    const { db, run } = fakeDb();

    logReadReceiptAction(db, 4, 'sent_back', 'reader@example.com');
    logReadReceiptAction(db, 5, 'declined');

    expect(run).toHaveBeenNthCalledWith(1, 4, 'sent_back', 'reader@example.com');
    expect(run).toHaveBeenNthCalledWith(2, 5, 'declined', null);
  });
});

describe('local mail stores', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fails explicitly when the local database is unavailable', () => {
    getDbMock.mockReturnValue(null as never);

    expect(() => getLocalReadReceiptSettings(1)).toThrow('Database not initialized');
    expect(() => logLocalReadReceiptDeclined(1)).toThrow('Database not initialized');
    expect(() => consumeAllowedOnceRemoteContentLocal(1)).toThrow('Database not initialized');
    expect(() => setLocalRemoteContentPolicy(1, 'blocked')).toThrow('Database not initialized');
  });

  test('delegates read-receipt and remote-content operations to the shared stores', () => {
    const { db, run } = fakeDb({
      respond_to_read_receipts: 'ask',
      read_receipt_trusted_domains: null,
    });
    getDbMock.mockReturnValue(db);
    consumeRemoteMock.mockReturnValue({ policy: 'allowed_once', allowRemote: true });

    expect(getLocalReadReceiptSettings(8)).toEqual({ respond: 'ask', trustedDomains: null });
    logLocalReadReceiptDeclined(18);
    expect(run).toHaveBeenCalledWith(18, 'declined', null);

    expect(consumeAllowedOnceRemoteContentLocal(18)).toEqual({
      policy: 'allowed_once',
      allowRemote: true,
    });
    expect(consumeRemoteMock).toHaveBeenCalledWith(db, 18);

    const remember = { scope: 'domain' as const, value: 'example.com' };
    setLocalRemoteContentPolicy(18, 'allowed_domain', remember);
    expect(setRemoteMock).toHaveBeenCalledWith(db, 18, 'allowed_domain', remember);
  });
});

describe('AI customer context adapter', () => {
  test('returns null for an unknown customer and maps a known customer', () => {
    getCustomerByIdMock.mockReturnValueOnce(undefined as never).mockReturnValueOnce({
      id: 7,
      name: 'Muster GmbH',
      firstName: 'Mia',
      email: 'mia@example.com',
    } as never);

    expect(getEmailAiCustomerTemplateContext(404)).toBeNull();
    expect(getEmailAiCustomerTemplateContext(7)).toEqual({
      name: 'Muster GmbH',
      firstName: 'Mia',
      email: 'mia@example.com',
    });
  });
});
