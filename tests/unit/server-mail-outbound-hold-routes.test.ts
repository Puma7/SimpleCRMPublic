import {
  createServerApi,
  type EmailMessageRecord,
  type ServerApiPorts,
} from '../../packages/server/src';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function makeMessage(overrides: Partial<EmailMessageRecord> = {}): EmailMessageRecord {
  return {
    id: 41,
    sourceSqliteId: 41,
    accountId: 1,
    folderId: 2,
    uid: -41,
    messageId: null,
    subject: 'Re: Frage',
    from: null,
    to: [{ address: 'kunde@example.com' }],
    cc: [],
    bcc: [],
    dateReceived: '2026-09-26T10:00:00.000Z',
    snippet: 'Antwort',
    seenLocal: false,
    doneLocal: false,
    archived: false,
    softDeleted: false,
    folderKind: 'draft',
    threadId: null,
    imapThreadId: null,
    ticketCode: null,
    customerId: null,
    hasAttachments: false,
    assignedTo: null,
    assignedToUserId: null,
    isSpam: false,
    spamStatus: 'clean',
    pgpStatus: null,
    remoteContentPolicy: 'ask',
    readReceiptRequested: false,
    snoozedUntil: null,
    updatedAt: '2026-09-26T10:05:00.000Z',
    ...overrides,
  };
}

function makePorts(overrides: Partial<ServerApiPorts> = {}): ServerApiPorts {
  return {
    mailAccess: {
      async assertPermission() {
        return undefined;
      },
      async resolveScope() {
        return { kind: 'all' };
      },
    },
    mailResourceLookup: {
      async resolve(input: { target: { kind: string; id?: number } }) {
        if (input.target.kind === 'message') {
          return [{ type: 'message', accountId: '1', messageId: String(input.target.id) }];
        }
        if (input.target.kind === 'account') {
          return [{ type: 'account', accountId: String(input.target.id) }];
        }
        return [];
      },
    },
    ...overrides,
  } as unknown as ServerApiPorts;
}

const principal = {
  userId: USER,
  workspaceId: WORKSPACE,
  role: 'user' as const,
  capabilities: ['crm.write'],
};

describe('Server-Mailrouten: angehaltene Entwürfe (TA-P2)', () => {
  test('Liste und Einzelabruf reichen outboundHold und den Grund durch den Sanitizer', async () => {
    const held = makeMessage({ outboundHold: true, outboundBlockReason: 'Preisangabe fehlt' });
    const api = createServerApi(makePorts({
      emailMessages: {
        async list() {
          return { items: [held], nextCursor: null };
        },
        async get() {
          return { ...held, bodyText: 'Text', bodyHtml: null };
        },
      } as unknown as ServerApiPorts['emailMessages'],
    }));

    const list = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages',
      query: { view: 'inbox' },
      principal,
    });
    expect(list.status).toBe(200);
    const item = (list.body as { data: { items: Array<Record<string, unknown>> } }).data.items[0]!;
    expect(item.outboundHold).toBe(true);
    expect(item.outboundBlockReason).toBe('Preisangabe fehlt');

    const single = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/41',
      query: { includeBody: 'true' },
      principal,
    });
    expect(single.status).toBe(200);
    const message = (single.body as { data: Record<string, unknown> }).data;
    expect(message.outboundHold).toBe(true);
    expect(message.outboundBlockReason).toBe('Preisangabe fehlt');
  });
});
