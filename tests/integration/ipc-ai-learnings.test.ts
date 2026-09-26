/**
 * @jest-environment node
 */
/**
 * TA-P5: Rechte der Learnings-IPC-Kanäle. Verwaltung nur Owner/Admin
 * (wie auf dem Server); „Learning notieren“ für jeden, der die
 * Mail lesen darf (accountAccess 'ro' über die messageId der Payload).
 */
const mockRegistrations = new Map<string, { handler: (...args: unknown[]) => unknown; options: Record<string, unknown> }>();

jest.mock('../../electron/ipc/register', () => ({
  registerIpcHandler: (channel: string, handler: (...args: unknown[]) => unknown, options?: Record<string, unknown>) => {
    mockRegistrations.set(channel, { handler, options: options ?? {} });
    return () => undefined;
  },
}));

jest.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false },
  ipcMain: { handle: jest.fn(), removeHandler: jest.fn() },
}));

const mockLearnings = {
  getAiLearningsOverview: jest.fn(() => ({ counts: { total: 0 } })),
  saveAiLearningsSettings: jest.fn(() => ({ success: true })),
  listAiLearningCandidates: jest.fn(() => []),
  deleteAiLearningCandidate: jest.fn(() => false),
  runAiLearningsDigest: jest.fn(async () => ({ status: 'queued' })),
  listAiLearningDigests: jest.fn(() => []),
  getAiLearningDigest: jest.fn(async () => null),
  acceptAiLearningDigest: jest.fn(async () => ({ success: true })),
  rejectAiLearningDigest: jest.fn(() => ({ success: true })),
  addAiLearningNote: jest.fn(() => ({ success: true })),
};
jest.mock('../../electron/email/email-ai-learnings', () => new Proxy({}, {
  get: (_target, key: string) => (...args: unknown[]) =>
    (mockLearnings as Record<string, (...a: unknown[]) => unknown>)[key]!(...args),
}));
jest.mock('../../electron/auth/current-user', () => ({
  requireAuthSession: () => ({ userId: 'u-1', role: 'admin' }),
}));
jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (id: number) => (id === 5 ? { account_id: 9 } : undefined),
  getMessageAccountIds: () => new Map(),
}));

import { IPCChannels } from '../../shared/ipc/channels';
import { getPayloadSchema } from '../../shared/ipc/schemas';
import { registerAiLearningsHandlers } from '../../electron/ipc/ai-learnings';
import { resolveEmailChannelAccountScope } from '../../electron/ipc/ipc-account-scope';

const MANAGE_CHANNELS = [
  IPCChannels.Email.GetLearningsOverview,
  IPCChannels.Email.SaveLearningsSettings,
  IPCChannels.Email.ListLearningCandidates,
  IPCChannels.Email.DeleteLearningCandidate,
  IPCChannels.Email.RunLearningsDigest,
  IPCChannels.Email.ListLearningDigests,
  IPCChannels.Email.GetLearningDigest,
  IPCChannels.Email.AcceptLearningDigest,
  IPCChannels.Email.RejectLearningDigest,
];

beforeAll(() => {
  registerAiLearningsHandlers({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } });
});

describe('Learnings-IPC (TA-P5)', () => {
  test('Verwaltung nur Owner/Admin, Notiz mit Lesezugriff', () => {
    for (const channel of MANAGE_CHANNELS) {
      expect({ channel, options: mockRegistrations.get(channel)?.options })
        .toEqual({ channel, options: expect.objectContaining({ requireRole: ['owner', 'admin'] }) });
    }
    const note = mockRegistrations.get(IPCChannels.Email.AddLearningNote)?.options;
    expect(note).toEqual(expect.objectContaining({ accountAccess: 'ro' }));
    expect(note?.requireRole).toBeUndefined();
  });

  test('Konto-Prüfung: Notiz über die Mail, Verwaltungskanäle workspace-weit', () => {
    expect(resolveEmailChannelAccountScope(IPCChannels.Email.AddLearningNote, { text: 'x', messageId: 5 }))
      .toEqual({ kind: 'accounts', accountIds: [9] });
    expect(resolveEmailChannelAccountScope(IPCChannels.Email.AddLearningNote, { text: 'x', messageId: 6 }))
      .toEqual({ kind: 'unresolved' });
    expect(resolveEmailChannelAccountScope(IPCChannels.Email.AddLearningNote, { text: 'x' })).toEqual({ kind: 'none' });
    expect(resolveEmailChannelAccountScope(IPCChannels.Email.AddLearningNote, { text: 'x', messageId: null })).toEqual({ kind: 'none' });
    for (const [channel, payload] of [
      [IPCChannels.Email.SaveLearningsSettings, { targetKnowledgeBaseId: 3, profileId: 2 }],
      [IPCChannels.Email.DeleteLearningCandidate, { id: 3 }],
      [IPCChannels.Email.RunLearningsDigest, { knowledgeBaseId: 3 }],
      [IPCChannels.Email.GetLearningDigest, { id: 3 }],
      [IPCChannels.Email.AcceptLearningDigest, { id: 3, content: 'x' }],
      [IPCChannels.Email.RejectLearningDigest, { id: 3 }],
    ] as const) {
      expect({ channel, scope: resolveEmailChannelAccountScope(channel, payload) }).toEqual({ channel, scope: { kind: 'none' } });
    }
  });

  test('Payload-Schemas lehnen Unbekanntes ab', () => {
    expect(() => getPayloadSchema(IPCChannels.Email.AddLearningNote).parse({ text: '' })).toThrow();
    expect(() => getPayloadSchema(IPCChannels.Email.AddLearningNote).parse({ text: 'x', foo: 1 })).toThrow();
    expect(() => getPayloadSchema(IPCChannels.Email.RunLearningsDigest).parse({ period: 'year' })).toThrow();
    expect(getPayloadSchema(IPCChannels.Email.RunLearningsDigest).parse(undefined)).toBeUndefined();
    expect(() => getPayloadSchema(IPCChannels.Email.AcceptLearningDigest).parse({ id: 1, content: 'x'.repeat(100_001) })).toThrow();
    expect(() => getPayloadSchema(IPCChannels.Email.SaveLearningsSettings).parse({ collectEnabled: 'ja' })).toThrow();
  });

  test('Handler reichen den angemeldeten Nutzer weiter', async () => {
    const event = {} as never;
    await mockRegistrations.get(IPCChannels.Email.RunLearningsDigest)!.handler(event, { period: 'week' });
    expect(mockLearnings.runAiLearningsDigest).toHaveBeenCalledWith({
      period: 'week', knowledgeBaseId: null, profileId: null, minCandidates: 1, trigger: 'manual', actorUserId: 'u-1',
    });
    await mockRegistrations.get(IPCChannels.Email.AcceptLearningDigest)!.handler(event, { id: 3, content: '# X', confirmOverwrite: true });
    expect(mockLearnings.acceptAiLearningDigest).toHaveBeenCalledWith({ id: 3, content: '# X', confirmOverwrite: true, actorUserId: 'u-1' });
    await mockRegistrations.get(IPCChannels.Email.RejectLearningDigest)!.handler(event, { id: 3 });
    expect(mockLearnings.rejectAiLearningDigest).toHaveBeenCalledWith({ id: 3, actorUserId: 'u-1' });
    await mockRegistrations.get(IPCChannels.Email.AddLearningNote)!.handler(event, { text: 'Sie-Form.', messageId: 5 });
    expect(mockLearnings.addAiLearningNote).toHaveBeenCalledWith({ text: 'Sie-Form.', messageId: 5, actorUserId: 'u-1' });
    await expect(mockRegistrations.get(IPCChannels.Email.DeleteLearningCandidate)!.handler(event, { id: 3 }))
      .resolves.toEqual({ success: false, error: 'Eintrag nicht gefunden' });
    await mockRegistrations.get(IPCChannels.Email.SaveLearningsSettings)!.handler(event, { collectEnabled: true });
    expect(mockLearnings.saveAiLearningsSettings).toHaveBeenCalledWith({ collectEnabled: true });
    await mockRegistrations.get(IPCChannels.Email.ListLearningCandidates)!.handler(event, undefined);
    expect(mockLearnings.listAiLearningCandidates).toHaveBeenCalledWith({});
  });
});
