import type { Kysely } from 'kysely';

import {
  createPostgresAiAgentPort,
  createPostgresAiPickCannedPort,
} from '../../packages/server/src/ai-classification';
import type { ServerDatabase } from '../../packages/server/src/db/schema';
import {
  createPostgresAiDraftReplyPort,
  createPostgresAiReviewDraftPort,
} from '../../packages/server/src/workflow-ai-draft-nodes';
import { inboundSiblingAbortKey } from '../../packages/server/src/workflow-inbound-chain-advance';
import { completeTerminalInboundChild } from '../../packages/server/src/workflow-inbound-terminal-child';
import { runWorkflowTrackedChatCompletion } from '../../packages/server/src/workflow-ai-chat';

jest.mock('../../packages/server/src/workflow-inbound-terminal-child', () => ({
  ...jest.requireActual('../../packages/server/src/workflow-inbound-terminal-child'),
  completeTerminalInboundChild: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../packages/server/src/workflow-ai-chat', () => ({
  runWorkflowTrackedChatCompletion: jest.fn(),
}));

const completeTerminalInboundChildMock = completeTerminalInboundChild as jest.MockedFunction<
  typeof completeTerminalInboundChild
>;
const runWorkflowTrackedChatCompletionMock = runWorkflowTrackedChatCompletion as jest.MockedFunction<
  typeof runWorkflowTrackedChatCompletion
>;

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

type FakeRows = {
  messages: Array<Record<string, unknown>>;
  profiles: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
  folders: Array<Record<string, unknown>>;
  knowledgeChunks: Array<Record<string, unknown>>;
  knowledgeBases: Array<Record<string, unknown>>;
  cannedResponses: Array<Record<string, unknown>>;
  syncInfo: Array<Record<string, unknown>>;
};

function makeDb(input: Partial<FakeRows>): { db: Kysely<ServerDatabase>; rows: FakeRows } {
  const rows: FakeRows = {
    messages: input.messages ?? [],
    profiles: input.profiles ?? [],
    accounts: input.accounts ?? [],
    folders: input.folders ?? [],
    knowledgeChunks: input.knowledgeChunks ?? [],
    knowledgeBases: input.knowledgeBases ?? [],
    cannedResponses: input.cannedResponses ?? [],
    syncInfo: input.syncInfo ?? [],
  };
  const tableRows = (table: string): Array<Record<string, unknown>> => {
    switch (table) {
      case 'email_messages':
        return rows.messages;
      case 'email_ai_profiles':
        return rows.profiles;
      case 'email_accounts':
        return rows.accounts;
      case 'email_folders':
        return rows.folders;
      case 'workflow_knowledge_chunks':
        return rows.knowledgeChunks;
      case 'workflow_knowledge_bases':
        return rows.knowledgeBases;
      case 'email_canned_responses':
        return rows.cannedResponses;
      case 'sync_info':
        return rows.syncInfo;
      default:
        throw new Error(`unexpected table: ${table}`);
    }
  };
  const db = {
    selectFrom(table: string) {
      return new FakeSelect(tableRows(table));
    },
    updateTable(table: string) {
      return new FakeUpdate(tableRows(table));
    },
    insertInto(table: string) {
      return new FakeInsert(tableRows(table));
    },
    transaction() {
      return {
        execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db),
      };
    },
  } as unknown as Kysely<ServerDatabase>;
  return { db, rows };
}

class FakeSelect {
  private readonly wheres: Array<readonly [string, string, unknown]> = [];

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  select() {
    return this;
  }

  where(column: string | ((eb: unknown) => unknown), operator?: string, value?: unknown) {
    if (typeof column === 'function') return this;
    if (!operator) throw new Error('missing where operator');
    this.wheres.push([column, operator, value]);
    return this;
  }

  orderBy() {
    return this;
  }

  limit() {
    return this;
  }

  forUpdate() {
    return this;
  }

  async execute() {
    return this.filteredRows();
  }

  async executeTakeFirst() {
    return this.filteredRows()[0];
  }

  async executeTakeFirstOrThrow() {
    const row = await this.executeTakeFirst();
    if (!row) throw new Error('no row');
    return row;
  }

  private filteredRows() {
    return this.rows.filter((row) => this.wheres.every(([column, operator, value]) => {
      if (operator === '=') return row[column] === value;
      if (operator === 'in' && Array.isArray(value)) return value.includes(row[column]);
      if (operator === '<') return Number(row[column]) < Number(value);
      throw new Error(`unexpected operator: ${operator}`);
    }));
  }
}

class FakeUpdate {
  private readonly wheres: Array<readonly [string, string, unknown]> = [];

  private patch: Record<string, unknown> = {};

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  set(values: Record<string, unknown>) {
    this.patch = values;
    return this;
  }

  where(column: string | ((eb: unknown) => unknown), operator?: string, value?: unknown) {
    if (typeof column === 'function') return this;
    if (!operator) throw new Error('missing where operator');
    this.wheres.push([column, operator, value]);
    return this;
  }

  async execute() {
    for (const row of this.rows) {
      if (this.wheres.every(([column, op, value]) => op === '=' && row[column] === value)) {
        Object.assign(row, this.patch);
      }
    }
  }

  async executeTakeFirst() {
    await this.execute();
    return undefined;
  }
}

class FakeInsert {
  private row: Record<string, unknown> | null = null;

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  values(value: Record<string, unknown>) {
    this.row = { ...value };
    return this;
  }

  onConflict() {
    return {
      columns: () => ({
        doUpdateSet: () => ({
          returning: () => ({
            executeTakeFirst: async () => {
              this.rows.push({ ...this.row });
              return { key: this.row?.key };
            },
          }),
          execute: async () => {
            this.rows.push({ ...this.row });
          },
        }),
        doNothing: () => ({
          returning: () => ({
            executeTakeFirst: async () => {
              this.rows.push({ ...this.row });
              return { key: this.row?.key };
            },
          }),
        }),
      }),
    };
  }

  returning() {
    return this;
  }

  async execute() {
    if (this.row) this.rows.push({ ...this.row });
  }

  async executeTakeFirstOrThrow() {
    if (!this.row) throw new Error('missing insert row');
    const nextId = Math.max(0, ...this.rows.map((row) => Number(row.id ?? 0))) + 1;
    const stored = { ...this.row, id: this.row.id ?? nextId };
    this.rows.push(stored);
    return stored;
  }
}

function terminalPayload(messageId: number) {
  return {
    workspaceId: WORKSPACE_ID,
    messageId,
    context: {
      inboundWorkflowChain: { workflowIds: [26, 27], index: 0 },
    },
  };
}

function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 14,
    workspace_id: WORKSPACE_ID,
    source_sqlite_id: 140,
    account_id: 7,
    subject: 'Retoure',
    from_json: { value: [{ address: 'max@example.com' }] },
    to_json: { value: [{ address: 'support@example.com' }] },
    cc_json: null,
    snippet: 'Wie funktioniert die Retoure?',
    body_text: 'Bitte erklaere die Retoure.',
    raw_headers: 'From: Max <max@example.com>\r\nReply-To: retoure@example.com',
    has_attachments: false,
    attachments_json: null,
    is_spam: false,
    spam_status: null,
    spam_score_label: null,
    ...overrides,
  };
}

function baseProfile(now: Date) {
  return {
    id: 21,
    workspace_id: WORKSPACE_ID,
    source_sqlite_id: 21,
    label: 'OpenAI',
    provider: 'openai',
    base_url: 'https://api.openai.test/v1',
    model: 'gpt-test',
    embedding_model: null,
    legacy_keytar_account: null,
    secret_id: 'secret-21',
    is_default: true,
    sort_order: 1,
    source_row: {},
    imported_in_run_id: null,
    created_at: now,
    updated_at: now,
  };
}

function baseDeps(db: Kysely<ServerDatabase>, now: Date) {
  return {
    db,
    secrets: { async readSecret() { return Buffer.from('sk-test'); } } as any,
    now: () => now,
    applyWorkspaceSession: async () => undefined,
  };
}

describe('terminal KI node completion', () => {
  beforeEach(() => {
    completeTerminalInboundChildMock.mockClear();
    runWorkflowTrackedChatCompletionMock.mockReset();
    runWorkflowTrackedChatCompletionMock.mockResolvedValue('KI-Antwort');
  });

  test('runAgent terminal + createDraft:false schliesst die Kette ab (applied:false)', async () => {
    const now = new Date('2026-06-03T12:30:00.000Z');
    const { db } = makeDb({
      messages: [baseMessage()],
      profiles: [baseProfile(now)],
      accounts: [{ id: 7, workspace_id: WORKSPACE_ID, source_sqlite_id: 7 }],
      folders: [{ id: 70, workspace_id: WORKSPACE_ID, source_sqlite_id: 700, account_id: 7, path: 'INBOX' }],
      knowledgeChunks: [{
        id: 1,
        workspace_id: WORKSPACE_ID,
        knowledge_base_id: 5,
        title: 'Retoure',
        content: 'Retoure innerhalb von 30 Tagen moeglich.',
      }],
    });
    const port = createPostgresAiAgentPort({
      ...baseDeps(db, now),
      async chatCompletion() {
        return 'KI-Antwort';
      },
    });

    await port.runAgent({
      workspaceId: WORKSPACE_ID,
      messageId: 14,
      profileId: 21,
      knowledgeBaseId: 5,
      systemPrompt: 'Agent',
      createDraft: false,
      terminalChainPayload: terminalPayload(14),
    });

    expect(completeTerminalInboundChildMock).toHaveBeenCalledTimes(1);
    expect(completeTerminalInboundChildMock).toHaveBeenCalledWith(
      expect.anything(),
      terminalPayload(14),
      expect.objectContaining({ applied: false }),
    );
  });

  test('pickCanned terminal + pick 0 schliesst die Kette ab (applied:false)', async () => {
    const now = new Date('2026-06-03T12:40:00.000Z');
    const { db } = makeDb({
      messages: [baseMessage({ id: 60, source_sqlite_id: 600, subject: 'Paket' })],
      profiles: [baseProfile(now)],
      accounts: [{ id: 7, workspace_id: WORKSPACE_ID, source_sqlite_id: 7 }],
      folders: [{ id: 70, workspace_id: WORKSPACE_ID, source_sqlite_id: 700, account_id: 7, path: 'INBOX' }],
      cannedResponses: [
        { id: 101, workspace_id: WORKSPACE_ID, source_sqlite_id: 1010, title: 'Versand', body: 'Unterwegs.', sort_order: 0 },
      ],
    });
    const port = createPostgresAiPickCannedPort({
      ...baseDeps(db, now),
      async chatCompletion() {
        return '0';
      },
    });

    await port.pickCanned({
      workspaceId: WORKSPACE_ID,
      messageId: 60,
      profileId: 21,
      createDraft: true,
      terminalChainPayload: terminalPayload(60),
    });

    expect(completeTerminalInboundChildMock).toHaveBeenCalledTimes(1);
    expect(completeTerminalInboundChildMock).toHaveBeenCalledWith(
      expect.anything(),
      terminalPayload(60),
      expect.objectContaining({ applied: false }),
    );
  });

  test('draftReply terminal + vorhandener Dedupe-Eintrag schliesst die Kette ab (applied:true)', async () => {
    const now = new Date('2026-06-03T12:50:00.000Z');
    const { db } = makeDb({
      messages: [baseMessage()],
      profiles: [baseProfile(now)],
      accounts: [{ id: 7, workspace_id: WORKSPACE_ID, source_sqlite_id: 7 }],
      folders: [{ id: 70, workspace_id: WORKSPACE_ID, source_sqlite_id: 700, account_id: 7, path: 'INBOX' }],
      knowledgeBases: [{ id: 5, workspace_id: WORKSPACE_ID, account_id: 7, context: 'inbound' }],
      syncInfo: [{
        workspace_id: WORKSPACE_ID,
        key: 'workflow_ai_draft_reply:14',
        value: '99',
      }],
    });
    const chat = jest.fn();
    runWorkflowTrackedChatCompletionMock.mockImplementation(async () => {
      chat();
      return 'KI-Antwort';
    });
    const port = createPostgresAiDraftReplyPort(baseDeps(db, now));

    await port.draftReply({
      workspaceId: WORKSPACE_ID,
      messageId: 14,
      knowledgeBaseId: 5,
      terminalChainPayload: terminalPayload(14),
    });

    expect(chat).not.toHaveBeenCalled();
    expect(completeTerminalInboundChildMock).toHaveBeenCalledTimes(1);
    expect(completeTerminalInboundChildMock).toHaveBeenCalledWith(
      expect.anything(),
      terminalPayload(14),
      expect.objectContaining({ applied: true }),
    );
  });

  test('reviewDraft terminal + Entwurf bereits gesendet schliesst die Kette ab (applied:false)', async () => {
    const now = new Date('2026-06-03T13:00:00.000Z');
    const { db, rows } = makeDb({
      messages: [
        baseMessage(),
        {
          id: 88,
          workspace_id: WORKSPACE_ID,
          subject: 'Re: Retoure',
          body_text: 'Antwort',
          body_html: null,
          to_json: { value: [{ address: 'max@example.com' }] },
          cc_json: null,
          bcc_json: null,
          draft_attachment_paths_json: null,
          folder_kind: 'draft',
          uid: -1,
        },
      ],
      profiles: [baseProfile(now)],
    });
    runWorkflowTrackedChatCompletionMock.mockImplementation(async () => {
      const draft = rows.messages.find((row) => Number(row.id) === 88);
      if (draft) {
        draft.folder_kind = 'sent';
        draft.uid = 42;
      }
      return 'STATUS: SEND\nANSWERED: yes\nREASON: ok';
    });
    const port = createPostgresAiReviewDraftPort(baseDeps(db, now));

    await port.reviewDraft({
      workspaceId: WORKSPACE_ID,
      messageId: 14,
      draftId: 88,
      profileId: 21,
      terminalChainPayload: terminalPayload(14),
    });

    expect(completeTerminalInboundChildMock).toHaveBeenCalledTimes(1);
    expect(completeTerminalInboundChildMock).toHaveBeenCalledWith(
      expect.anything(),
      terminalPayload(14),
      expect.objectContaining({ applied: false }),
    );
  });

  test('draftReply terminal erkennt Sibling-Abort ohne Continuation', async () => {
    const now = new Date('2026-06-03T13:10:00.000Z');
    const chain = { workflowIds: [26, 27], index: 0 };
    const { db } = makeDb({
      messages: [baseMessage()],
      profiles: [baseProfile(now)],
      accounts: [{ id: 7, workspace_id: WORKSPACE_ID, source_sqlite_id: 7 }],
      folders: [{ id: 70, workspace_id: WORKSPACE_ID, source_sqlite_id: 700, account_id: 7, path: 'INBOX' }],
      knowledgeBases: [{ id: 5, workspace_id: WORKSPACE_ID, account_id: 7, context: 'inbound' }],
      syncInfo: [{
        workspace_id: WORKSPACE_ID,
        key: inboundSiblingAbortKey(14, 26, chain),
        value: 'stopFurtherWorkflows',
      }],
    });
    const chat = jest.fn();
    runWorkflowTrackedChatCompletionMock.mockImplementation(async () => {
      chat();
      return 'KI-Antwort';
    });
    const port = createPostgresAiDraftReplyPort(baseDeps(db, now));

    await port.draftReply({
      workspaceId: WORKSPACE_ID,
      messageId: 14,
      knowledgeBaseId: 5,
      terminalChainPayload: terminalPayload(14),
    });

    expect(chat).not.toHaveBeenCalled();
    expect(completeTerminalInboundChildMock).toHaveBeenCalledTimes(1);
    expect(completeTerminalInboundChildMock).toHaveBeenCalledWith(
      expect.anything(),
      terminalPayload(14),
      expect.objectContaining({ applied: false }),
    );
  });
});
