import { createSqliteMock } from './helpers/sqlite-mock';
import keytar from 'keytar';

const syncStore = new Map<string, string>();
const { db, stmt } = createSqliteMock();
let profiles: Array<{
  id: number;
  label: string;
  provider: string;
  base_url: string;
  model: string;
  embedding_model: string | null;
  keytar_account: string;
  is_default: number;
  sort_order: number;
}> = [];

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  getSyncInfo: (key: string) => syncStore.get(key) ?? null,
  setSyncInfo: (key: string, value: string) => syncStore.set(key, value),
}));
jest.mock('../../electron/email/email-ai-keytar', () => ({
  getEmailAiApiKey: jest.fn(async () => syncStore.get('legacy_key') ?? null),
  saveEmailAiApiKey: jest.fn(async (k: string) => syncStore.set('legacy_key', k)),
}));

import { getEmailAiApiKey } from '../../electron/email/email-ai-keytar';
import {
  clearAiProfileApiKey,
  createAiProfile,
  deleteAiProfile,
  ensureDefaultAiProfiles,
  getAiProfileApiKey,
  getAiProfileById,
  getDefaultAiProfile,
  getResolvedAiRuntime,
  hasAnyAiProfileWithKey,
  listAiProfiles,
  profileHasApiKey,
  resolveAiProfile,
  resolvePromptProfileId,
  saveAiProfileApiKey,
  updateAiProfile,
} from '../../electron/email/email-ai-profiles';

describe('email-ai-profiles', () => {
  let lastSql = '';

  beforeEach(() => {
    jest.clearAllMocks();
    syncStore.clear();
    profiles = [];
    lastSql = '';
    db.prepare.mockImplementation((sql: string) => {
      lastSql = sql;
      return stmt;
    });
    stmt.all.mockImplementation(() => [...profiles]);
    stmt.get.mockImplementation((...args: unknown[]) => profiles.find((p) => p.id === args[0]));
    stmt.run.mockImplementation((...args: unknown[]) => {
      if (lastSql.includes('INSERT INTO')) {
        const id = profiles.length + 1;
        profiles.push({
          id,
          label: String(args[0]),
          provider: String(args[1]),
          base_url: String(args[2]),
          model: String(args[3]),
          embedding_model: (args[4] as string | null) ?? null,
          keytar_account: String(args[5]),
          is_default: Number(args[6]),
          sort_order: Number(args[7] ?? 0),
        });
        return { changes: 1, lastInsertRowid: id };
      }
      if (lastSql.includes('UPDATE') && lastSql.includes('label = COALESCE')) {
        const id = args[args.length - 1] as number;
        const row = profiles.find((p) => p.id === id);
        if (row && args[0] != null) row.label = String(args[0]);
        if (row && args[1] != null) row.provider = String(args[1]);
        if (row && args[2] != null) row.base_url = String(args[2]);
        if (row && args[3] != null) row.model = String(args[3]);
        if (row && args[5] != null) row.is_default = Number(args[5]);
      }
      if (lastSql.includes('DELETE FROM')) {
        const id = args[0] as number;
        profiles = profiles.filter((p) => p.id !== id);
      }
      return { changes: 1, lastInsertRowid: profiles.length };
    });
    (keytar.getPassword as jest.Mock).mockResolvedValue(null);
    (keytar.setPassword as jest.Mock).mockImplementation(async (_svc: string, acct: string, val: string) => {
      (keytar.getPassword as jest.Mock).mockImplementation(async (_s: string, a: string) =>
        a === acct ? val : null,
      );
    });
  });

  test('ensureDefaultAiProfiles migrates legacy key once', async () => {
    syncStore.set('email_ai_base_url', 'https://api.example.com/');
    syncStore.set('email_ai_model', 'gpt-test');
    syncStore.set('legacy_key', 'secret');
    (getEmailAiApiKey as jest.Mock).mockResolvedValue('secret');
    (keytar.getPassword as jest.Mock).mockResolvedValue('secret');
    await ensureDefaultAiProfiles();
    expect(syncStore.get('email_ai_profiles_legacy_migrated')).toBe('1');
    expect(profiles.length).toBe(1);
    expect(profiles[0]?.label).toContain('migriert');
  });

  test('ensureDefaultAiProfiles seeds default when migrated but empty', async () => {
    syncStore.set('email_ai_profiles_legacy_migrated', '1');
    await ensureDefaultAiProfiles();
    expect(profiles.length).toBe(1);
    expect(profiles[0]?.label).toBe('Standard');
  });

  test('ensureDefaultAiProfiles marks migrated when profiles exist', async () => {
    profiles.push({
      id: 1,
      label: 'Existing',
      provider: 'openai',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-4',
      embedding_model: null,
      keytar_account: 'profile-1',
      is_default: 1,
      sort_order: 0,
    });
    await ensureDefaultAiProfiles();
    expect(syncStore.get('email_ai_profiles_legacy_migrated')).toBe('1');
  });

  test('create update delete profile', () => {
    const id = createAiProfile({
      label: ' OpenAI ',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1/',
      model: 'gpt-4',
      isDefault: true,
    });
    expect(id).toBe(1);
    updateAiProfile(id, { label: 'Updated', provider: 'custom', baseUrl: 'http://x/', model: 'm', isDefault: true });
    expect(() => updateAiProfile(99, { label: 'X' })).toThrow(/nicht gefunden/);
    deleteAiProfile(id);
    profiles.length = 0;
    deleteAiProfile(1);
  });

  test('resolve helpers and list', () => {
    profiles.push(
      {
        id: 1,
        label: 'Default',
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-4',
        embedding_model: 'emb',
        keytar_account: 'k1',
        is_default: 1,
        sort_order: 0,
      },
      {
        id: 2,
        label: 'Alt',
        provider: 'custom',
        base_url: 'http://local',
        model: 'local-model',
        embedding_model: null,
        keytar_account: 'k2',
        is_default: 0,
        sort_order: 1,
      },
    );
    expect(getDefaultAiProfile()?.id).toBe(1);
    expect(resolveAiProfile(2)?.label).toBe('Alt');
    expect(resolveAiProfile(99)?.id).toBe(1);
    expect(resolvePromptProfileId({ profile_id: 2 })).toBe(2);
    expect(resolvePromptProfileId({ profile_id: 99 })).toBe(1);
    expect(listAiProfiles()).toHaveLength(2);
    expect(getAiProfileById(1)?.model).toBe('gpt-4');
  });

  test('profile key helpers and hasAnyAiProfileWithKey', async () => {
    profiles.push({
      id: 1,
      label: 'P',
      provider: 'openai',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-4',
      embedding_model: null,
      keytar_account: 'k1',
      is_default: 1,
      sort_order: 0,
    });
    await saveAiProfileApiKey('k1', 'abc');
    (keytar.getPassword as jest.Mock).mockResolvedValue('abc');
    expect(await getAiProfileApiKey('k1')).toBe('abc');
    expect(await profileHasApiKey(1)).toBe(true);
    expect(await profileHasApiKey(99)).toBe(false);
    expect(await hasAnyAiProfileWithKey()).toBe(true);
    await clearAiProfileApiKey('k1');
    expect(keytar.deletePassword).toHaveBeenCalled();
  });

  test('getResolvedAiRuntime resolves profile runtime', async () => {
    syncStore.set('email_ai_profiles_legacy_migrated', '1');
    profiles.push({
      id: 3,
      label: 'Runtime',
      provider: 'openai',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      embedding_model: 'emb-model',
      keytar_account: 'k3',
      is_default: 1,
      sort_order: 0,
    });
    (keytar.getPassword as jest.Mock).mockResolvedValue('profile-key');
    const resolved = await getResolvedAiRuntime(3);
    expect(resolved.profileId).toBe(3);
    expect(resolved.apiKey).toBe('profile-key');
    expect(resolved.embeddingModel).toBe('emb-model');
  });
});
