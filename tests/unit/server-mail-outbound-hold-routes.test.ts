import {
  createServerApi,
  type EmailComposeSendInput,
  type EmailMessageRecord,
  type ServerApiPorts,
} from '../../packages/server/src';
import { MailAccessDeniedError } from '../../packages/server/src/mail-access/service';
import type { OutboundReviewSkipPolicy } from '../../packages/core/src/email';

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

describe('Server-Mailrouten: „gesendet von“ und Ansicht sent_ai (TA-P3)', () => {
  test('view=sent_ai erreicht den Port; die Kennzeichnung passiert den Sanitizer', async () => {
    const sent = makeMessage({
      id: 42,
      uid: 7,
      folderKind: 'sent',
      sentByKind: 'ai_approved',
      sentByLabel: 'Anna Beispiel',
      sentOutboundReviewSkipped: true,
    });
    const list = jest.fn(async () => ({ items: [sent], nextCursor: null }));
    const api = createServerApi(makePorts({
      emailMessages: { list } as unknown as ServerApiPorts['emailMessages'],
    }));

    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages',
      query: { view: 'sent_ai' },
      principal,
    });

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ view: 'sent_ai' }));
    const item = (response.body as { data: { items: Array<Record<string, unknown>> } }).data.items[0]!;
    expect(item).toEqual(expect.objectContaining({
      sentByKind: 'ai_approved',
      sentByLabel: 'Anna Beispiel',
      sentOutboundReviewSkipped: true,
    }));
  });

  test('unbekannte Ansicht wird abgewiesen', async () => {
    const list = jest.fn();
    const api = createServerApi(makePorts({
      emailMessages: { list } as unknown as ServerApiPorts['emailMessages'],
    }));
    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages',
      query: { view: 'sent_robot' },
      principal,
    });
    expect(response.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/email/messages/:id/send-skip-outbound-review (TA-P2)', () => {
  const values: EmailComposeSendInput = {
    accountId: 1,
    draftMessageId: 41,
    subject: '[T-1] Re: Frage',
    bodyText: 'Antwort',
    to: 'kunde@example.com',
  };

  function setup(input: {
    policy?: OutboundReviewSkipPolicy;
    prepared?: Awaited<ReturnType<NonNullable<ServerApiPorts['emailOutboundReviewSkip']>['prepare']>>;
    sendResult?: Awaited<ReturnType<NonNullable<ServerApiPorts['emailComposeSender']>['send']>>;
    denyPermission?: string;
  } = {}) {
    const order: string[] = [];
    const permissions: string[] = [];
    const prepare = jest.fn(async () => {
      order.push('prepare');
      return input.prepared ?? { ok: true as const, values };
    });
    const send = jest.fn(async () => {
      order.push('send');
      return input.sendResult ?? { ok: true as const, messageId: 41, accountId: 1 };
    });
    const audit = jest.fn(async (entry: { action: string }) => {
      order.push(`audit:${entry.action}`);
    });
    const api = createServerApi(makePorts({
      mailAccess: {
        async assertPermission(check: { permission: string }) {
          permissions.push(check.permission);
          if (check.permission === input.denyPermission) throw new MailAccessDeniedError();
        },
        async resolveScope() {
          return { kind: 'all' };
        },
      } as unknown as ServerApiPorts['mailAccess'],
      emailOutboundReviewSkip: {
        async readPolicy() {
          return input.policy ?? 'all';
        },
        prepare,
      },
      emailComposeSender: { send },
      audit: { record: audit } as unknown as ServerApiPorts['audit'],
    }));
    return { api, prepare, send, audit, order, permissions };
  }

  const request = (role: 'user' | 'admin' | 'owner' = 'user') => ({
    method: 'POST' as const,
    path: '/api/v1/email/messages/41/send-skip-outbound-review',
    principal: { ...principal, role },
  });

  test('sendet mit Freigabe für den aktuellen Inhalt und protokolliert das Überspringen vor dem Versand', async () => {
    const { api, prepare, send, audit, order, permissions } = setup();

    const response = await api.handle(request());

    expect(response.status).toBe(200);
    expect((response.body as { data: unknown }).data).toEqual({ success: true });
    expect(prepare).toHaveBeenCalledWith({ workspaceId: WORKSPACE, actorUserId: USER, messageId: 41 });
    expect(send).toHaveBeenCalledWith({ workspaceId: WORKSPACE, actorUserId: USER, values });
    expect(order).toEqual([
      'prepare',
      'audit:email_message.outbound_review_skipped',
      'send',
      'audit:email_message.sent',
    ]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'email_message.outbound_review_skipped',
      actorUserId: USER,
      entityType: 'email_message',
      entityId: '41',
      metadata: { draftId: 41, accountId: 1 },
    }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'email_message.sent',
      metadata: expect.objectContaining({ outboundReviewSkipped: true }),
    }));
    // Wie approve-draft-send: senden UND den gespeicherten Entwurf bearbeiten dürfen.
    expect(permissions).toEqual(expect.arrayContaining(['mail.send', 'mail.draft.edit']));
  });

  test('ohne mail.draft.edit am Entwurf wird nichts vorbereitet oder gesendet', async () => {
    const { api, prepare, send } = setup({ denyPermission: 'mail.draft.edit' });

    const response = await api.handle(request());

    expect(response.status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  test('Einstellung „niemand“ verbietet das Überspringen auch dem Owner', async () => {
    const { api, prepare, send } = setup({ policy: 'none' });

    const response = await api.handle(request('owner'));

    expect(response.status).toBe(403);
    expect((response.body as { error: { code: string } }).error.code).toBe('outbound_review_skip_forbidden');
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  test('Einstellung „nur Owner und Admin“: Nutzer abgelehnt, Admin darf', async () => {
    const denied = setup({ policy: 'admins' });
    expect((await denied.api.handle(request('user'))).status).toBe(403);
    expect(denied.prepare).not.toHaveBeenCalled();

    const allowed = setup({ policy: 'admins' });
    expect((await allowed.api.handle(request('admin'))).status).toBe(200);
    expect(allowed.send).toHaveBeenCalledTimes(1);
  });

  test('nicht angehaltener Entwurf: 409 ohne Versand und ohne Protokoll', async () => {
    const { api, send, audit } = setup({ prepared: { ok: false, reason: 'not_held' } });

    const response = await api.handle(request());

    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe('email_draft_not_held');
    expect(send).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  test('Versandfehler wird wie bei compose/send gemeldet', async () => {
    const { api } = setup({ sendResult: { ok: false, error: 'SMTP down' } });

    const response = await api.handle(request());

    expect(response.status).toBe(200);
    expect((response.body as { data: unknown }).data).toEqual({ success: false, error: 'SMTP down' });
  });
});

describe('Automatisierungs-Einstellung outboundReviewSkipPolicy (TA-P2)', () => {
  function settingsApi(stored: string | null) {
    const setMany = jest.fn(async () => undefined);
    const api = createServerApi(makePorts({
      syncInfo: {
        async getMany(input: { keys: readonly string[] }) {
          return input.keys
            .filter((key) => key === 'outbound_review_skip_policy' && stored !== null)
            .map((key) => ({ key, value: stored, lastUpdated: null }));
        },
        setMany,
      } as unknown as ServerApiPorts['syncInfo'],
    }));
    return { api, setMany };
  }

  test('GET liefert die gespeicherte Richtlinie, ungesetzt den Standard „all“', async () => {
    const stored = await settingsApi('admins').api.handle({
      method: 'GET',
      path: '/api/v1/workflow/settings/automation',
      principal,
    });
    expect((stored.body as { data: Record<string, unknown> }).data.outboundReviewSkipPolicy).toBe('admins');

    const unset = await settingsApi(null).api.handle({
      method: 'GET',
      path: '/api/v1/workflow/settings/automation',
      principal,
    });
    expect((unset.body as { data: Record<string, unknown> }).data.outboundReviewSkipPolicy).toBe('all');
  });

  test('PATCH nur für Owner/Admin und nur mit gültigem Wert', async () => {
    const { api, setMany } = settingsApi(null);
    const denied = await api.handle({
      method: 'PATCH',
      path: '/api/v1/workflow/settings/automation',
      body: { outboundReviewSkipPolicy: 'none' },
      principal,
    });
    expect(denied.status).toBe(403);

    const invalid = await api.handle({
      method: 'PATCH',
      path: '/api/v1/workflow/settings/automation',
      body: { outboundReviewSkipPolicy: 'everyone' },
      principal: { ...principal, role: 'owner' as const },
    });
    expect(invalid.status).toBe(400);
    expect(setMany).not.toHaveBeenCalled();

    const saved = await api.handle({
      method: 'PATCH',
      path: '/api/v1/workflow/settings/automation',
      body: { outboundReviewSkipPolicy: 'none' },
      principal: { ...principal, role: 'owner' as const },
    });
    expect(saved.status).toBe(200);
    expect(setMany).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      values: { outbound_review_skip_policy: 'none' },
    });
  });
});
