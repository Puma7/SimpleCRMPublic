/**
 * email:ai-transform-text setzt Compose-Text und Kundendaten in die Prompt-Vorlage ein.
 */
const mockHandlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), removeHandler: jest.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
  app: { getPath: () => '/tmp', isPackaged: false },
}));

jest.mock('../../electron/ipc/register', () => ({
  registerIpcHandler: (channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
    mockHandlers.set(channel, handler);
    return () => undefined;
  },
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  listAiPrompts: jest.fn(() => [
    {
      id: 5,
      user_template: 'Formuliere freundlicher fuer {{customer.firstName}}:\n{{text}}\nGruss an {{customer.name}}',
    },
  ]),
}));

jest.mock('../../electron/email/email-ai-customer-context-store', () => ({
  getEmailAiCustomerTemplateContext: jest.fn(() => ({ name: 'Muster GmbH', firstName: 'Erika', email: 'erika@example.com' })),
}));

jest.mock('../../electron/email/email-ai-profiles', () => ({
  getDefaultAiProfile: jest.fn(() => null),
  resolvePromptProfileId: jest.fn(() => null),
}));

jest.mock('../../electron/email/email-openai', () => ({
  getAiSettings: jest.fn(),
  setAiSettings: jest.fn(),
  runChatCompletion: jest.fn(async () => 'umformuliert'),
}));

import { IPCChannels } from '../../shared/ipc/channels';
import { runChatCompletion } from '../../electron/email/email-openai';
import { registerEmailHandlers } from '../../electron/ipc/email';

const quietLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

beforeAll(() => {
  registerEmailHandlers({ logger: quietLogger, isDevelopment: false });
});

beforeEach(() => {
  jest.mocked(runChatCompletion).mockClear();
});

async function transform(text: string, customerId: number | null = 9): Promise<string> {
  const handler = mockHandlers.get(IPCChannels.Email.AiTransformText);
  if (!handler) throw new Error('kein Handler fuer email:ai-transform-text');
  await expect(handler({}, { promptId: 5, text, customerId })).resolves.toEqual({ success: true, text: 'umformuliert' });
  return String(jest.mocked(runChatCompletion).mock.calls[0]![1]);
}

describe('email:ai-transform-text Vorlage', () => {
  // N-ipc-01: {{text}} wurde per String-replace eingesetzt ($-Muster im Text wirkten als Ersatzmuster)
  // und ein zweiter Durchlauf loeste {{customer.*}} auch innerhalb des eingesetzten Textes auf.
  test('setzt den Compose-Text woertlich und in einem Durchlauf ein', async () => {
    const text = "Preis $& statt $' und $1, {{customer.email}} bitte nicht aufloesen";
    const user = await transform(text);

    expect(user).toBe(`Formuliere freundlicher fuer Erika:\n${text}\nGruss an Muster GmbH`);
  });

  test('ohne Kunde bleiben die customer-Platzhalter der Vorlage stehen', async () => {
    const user = await transform('Hallo', null);

    expect(user).toBe('Formuliere freundlicher fuer {{customer.firstName}}:\nHallo\nGruss an {{customer.name}}');
  });
});
