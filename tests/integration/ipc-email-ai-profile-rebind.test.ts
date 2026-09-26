/**
 * @jest-environment node
 */
/**
 * Desktop-Paritaet zu F-A4-02: Der gespeicherte API-Key eines KI-Profils darf
 * nie an einen neuen Host gehen. Laeuft ueber den echten registerIpcHandler
 * (Session, Schema) und eine In-Memory-Datenbank; ersetzt sind nur Electron
 * und der Schluesselbund.
 */
const mockHandlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

jest.mock('electron', () => ({
  app: {
    getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-ai-profile-rebind`,
    getName: () => 'simplecrm-test',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      mockHandlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      mockHandlers.delete(channel);
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
}));

jest.mock('../../electron/auth/auth-store', () => ({
  ...jest.requireActual('../../electron/auth/auth-store'),
  canUseSyntheticBootstrapAuthSession: () => false,
}));

import Database from 'better-sqlite3';
import keytar from 'keytar';
import { IPCChannels } from '../../shared/ipc/channels';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';
import {
  createAiProfile,
  getAiProfileById,
  getAiProfileApiKey,
  saveAiProfileApiKey,
} from '../../electron/email/email-ai-profiles';
import { clearAllSessions, createSession, type SessionRole } from '../../electron/auth/session-store';
import { registerEmailHandlers } from '../../electron/ipc/email';

const quietLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const keychain = new Map<string, string>();
let nextSenderId = 300;

function eventFor(role: SessionRole) {
  const id = nextSenderId++;
  createSession(id, { id: `user-${role}`, username: role, displayName: role, role, workspaceId: 'w' });
  return { sender: { id } };
}

function invoke(channel: string, event: unknown, payload?: unknown): Promise<any> {
  const handler = mockHandlers.get(channel);
  if (!handler) throw new Error(`kein Handler fuer ${channel}`);
  return payload === undefined ? handler(event) : handler(event, payload);
}

describe('KI-Profil: gespeicherter Key bleibt beim Host (C-A16)', () => {
  let db: Database.Database;
  let dispose: () => void;
  let profileId: number;

  function savePayload(overrides: Record<string, unknown>) {
    return {
      id: profileId,
      label: 'Firmen-Key',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      embeddingModel: null,
      isDefault: true,
      ...overrides,
    };
  }

  async function storedKey(): Promise<string | null> {
    return getAiProfileApiKey(getAiProfileById(profileId)!.keytar_account);
  }

  beforeEach(async () => {
    keychain.clear();
    jest.mocked(keytar.getPassword).mockImplementation(
      (async (service: string, account: string) => keychain.get(`${service}/${account}`) ?? null) as any,
    );
    jest.mocked(keytar.setPassword).mockImplementation(
      (async (service: string, account: string, password: string) => {
        keychain.set(`${service}/${account}`, password);
      }) as any,
    );
    jest.mocked(keytar.setPassword).mockClear();

    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    profileId = createAiProfile({
      label: 'Firmen-Key',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      isDefault: true,
    });
    await saveAiProfileApiKey(getAiProfileById(profileId)!.keytar_account, 'sk-firma');
    jest.mocked(keytar.setPassword).mockClear();
    clearAllSessions();
    dispose = registerEmailHandlers({ logger: quietLogger, isDevelopment: false });
  });

  afterEach(() => {
    dispose();
    closeDatabase();
  });

  // C-A16: SaveAiProfile stellte ein Profil mit gespeichertem Key ohne neuen Key auf einen fremden Host um; der naechste KI-Aufruf schickte den Firmen-Key dorthin.
  test.each([
    ['neuer Origin', { baseUrl: 'https://collector.example/v1' }],
    ['neuer Anbieter', { provider: 'openrouter' }],
    ['leerer Key', { baseUrl: 'https://collector.example/v1', apiKey: '   ' }],
  ])('%s ohne neuen API-Key wird abgelehnt, Profil und Key bleiben', async (_name, overrides) => {
    for (const role of ['agent', 'admin'] as const) {
      await expect(invoke(IPCChannels.Email.SaveAiProfile, eventFor(role), savePayload(overrides)))
        .resolves.toEqual({
          success: false,
          error: expect.stringContaining('Zugangsdaten bei Serverwechsel neu eingeben'),
        });
    }

    expect(getAiProfileById(profileId)).toMatchObject({
      provider: 'openai',
      base_url: 'https://api.openai.com/v1',
    });
    expect(await storedKey()).toBe('sk-firma');
    expect(keytar.setPassword).not.toHaveBeenCalled();
  });

  test('mit neuem API-Key darf der Host wechseln', async () => {
    await expect(invoke(IPCChannels.Email.SaveAiProfile, eventFor('agent'), savePayload({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'or-neu',
    }))).resolves.toEqual({ success: true, id: profileId });

    expect(getAiProfileById(profileId)).toMatchObject({
      provider: 'openrouter',
      base_url: 'https://openrouter.ai/api/v1',
    });
    expect(await storedKey()).toBe('or-neu');
  });

  test('gleicher Origin und uebrige Felder brauchen keinen neuen Key', async () => {
    await expect(invoke(IPCChannels.Email.SaveAiProfile, eventFor('agent'), savePayload({
      label: 'Umbenannt',
      baseUrl: 'https://API.openai.com:443/v2/',
      model: 'gpt-4o',
    }))).resolves.toEqual({ success: true, id: profileId });

    expect(getAiProfileById(profileId)).toMatchObject({
      label: 'Umbenannt',
      base_url: 'https://API.openai.com:443/v2',
      model: 'gpt-4o',
    });
    expect(await storedKey()).toBe('sk-firma');
  });

  test('ein Profil ohne gespeicherten Key darf den Host ohne Key wechseln', async () => {
    keychain.clear();

    await expect(invoke(IPCChannels.Email.SaveAiProfile, eventFor('agent'), savePayload({
      baseUrl: 'http://127.0.0.1:11434/v1',
      provider: 'ollama',
    }))).resolves.toEqual({ success: true, id: profileId });

    expect(getAiProfileById(profileId)).toMatchObject({ provider: 'ollama', base_url: 'http://127.0.0.1:11434/v1' });
  });

  // C-A16: Das KI-Panel erkennt den Hostwechsel nur, wenn die Desktop-Liste Base-URL und hasApiKey liefert wie der Server-Client.
  test('ListAiProfiles liefert Base-URL, Standard-Flag und hasApiKey fuer das KI-Panel', async () => {
    const rows = await invoke(IPCChannels.Email.ListAiProfiles, eventFor('agent'));

    expect(rows).toEqual([
      expect.objectContaining({
        id: profileId,
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        base_url: 'https://api.openai.com/v1',
        isDefault: true,
        hasApiKey: true,
      }),
    ]);
  });
});
