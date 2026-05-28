/** Shared ImapFlow mock for mail IMAP unit tests. */
export function createImapFlowMock() {
  const release = jest.fn();
  const lock = { release };
  const client = {
    connect: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn().mockResolvedValue(undefined),
    getMailboxLock: jest.fn().mockResolvedValue(lock),
    list: jest.fn().mockResolvedValue([]),
    mailboxOpen: jest.fn().mockResolvedValue(undefined),
    append: jest.fn().mockResolvedValue(undefined),
    status: jest.fn().mockResolvedValue({ uidValidity: 1, uidNext: 10, messages: 0 }),
    search: jest.fn().mockResolvedValue([]),
    fetch: jest.fn().mockReturnValue((async function* () {})()),
    fetchOne: jest.fn().mockResolvedValue(undefined),
    idle: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    messageFlagsAdd: jest.fn().mockResolvedValue(undefined),
    messageFlagsRemove: jest.fn().mockResolvedValue(undefined),
    messageMove: jest.fn().mockResolvedValue(undefined),
    messageDelete: jest.fn().mockResolvedValue(undefined),
  };
  const ImapFlow = jest.fn(() => client);
  return { ImapFlow, client, lock };
}
