import { randomUUID } from 'crypto';
import keytar from 'keytar';
import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import {
  EMAIL_AI_PROFILES_TABLE,
} from '../database-schema';
import { getDb } from '../sqlite-service';
import { getEmailAiApiKey, saveEmailAiApiKey } from './email-ai-keytar';

const KEYTAR_SERVICE = 'SimpleCRMElectron-EmailAI';
const LEGACY_MIGRATED = 'email_ai_profiles_legacy_migrated';

export type AiProviderPreset =
  | 'openai'
  | 'openrouter'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'ollama'
  | 'custom';

export type EmailAiProfileRow = {
  id: number;
  label: string;
  provider: AiProviderPreset;
  base_url: string;
  model: string;
  embedding_model: string | null;
  keytar_account: string;
  is_default: number;
  sort_order: number;
};

export const AI_PROVIDER_PRESETS: Record<
  AiProviderPreset,
  { label: string; baseUrl: string; defaultModel: string }
> = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  openrouter: {
    label: 'Open Router',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
  },
  anthropic: {
    label: 'Anthropic (OpenAI-kompatibel)',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-haiku-latest',
  },
  google: {
    label: 'Google Gemini (OpenAI-kompatibel)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  ollama: {
    label: 'Ollama (lokal)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.2',
  },
  custom: {
    label: 'OpenAI-kompatibel (frei)',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
};

function listProfilesRaw(): EmailAiProfileRow[] {
  return getDb()
    .prepare(
      `SELECT id, label, provider, base_url, model, embedding_model, keytar_account, is_default, sort_order
       FROM ${EMAIL_AI_PROFILES_TABLE}
       ORDER BY is_default DESC, sort_order ASC, label ASC`,
    )
    .all() as EmailAiProfileRow[];
}

export async function ensureDefaultAiProfiles(): Promise<void> {
  if (getSyncInfo(LEGACY_MIGRATED) === '1') {
    if (listProfilesRaw().length === 0) {
      createAiProfile({
        label: 'Standard',
        provider: 'openai',
        baseUrl: getSyncInfo('email_ai_base_url') || AI_PROVIDER_PRESETS.openai.baseUrl,
        model: getSyncInfo('email_ai_model') || AI_PROVIDER_PRESETS.openai.defaultModel,
        embeddingModel: getSyncInfo('email_ai_embedding_model') || 'text-embedding-3-small',
        isDefault: true,
      });
    }
    return;
  }

  if (listProfilesRaw().length > 0) {
    setSyncInfo(LEGACY_MIGRATED, '1');
    return;
  }

  const legacyKey = await getEmailAiApiKey();
  const baseUrl = (getSyncInfo('email_ai_base_url') || AI_PROVIDER_PRESETS.openai.baseUrl).replace(
    /\/$/,
    '',
  );
  const model = getSyncInfo('email_ai_model') || AI_PROVIDER_PRESETS.openai.defaultModel;
  const embeddingModel = getSyncInfo('email_ai_embedding_model') || 'text-embedding-3-small';

  const id = createAiProfile({
    label: 'Standard (migriert)',
    provider: 'custom',
    baseUrl,
    model,
    embeddingModel,
    isDefault: true,
  });
  if (legacyKey) {
    const row = getAiProfileById(id);
    if (row) await saveAiProfileApiKey(row.keytar_account, legacyKey);
  }
  setSyncInfo(LEGACY_MIGRATED, '1');
}

export function listAiProfiles(): EmailAiProfileRow[] {
  return listProfilesRaw();
}

export function getAiProfileById(id: number): EmailAiProfileRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, label, provider, base_url, model, embedding_model, keytar_account, is_default, sort_order
       FROM ${EMAIL_AI_PROFILES_TABLE} WHERE id = ?`,
    )
    .get(id) as EmailAiProfileRow | undefined;
}

export function getDefaultAiProfile(): EmailAiProfileRow | undefined {
  const rows = listProfilesRaw();
  return rows.find((r) => r.is_default === 1) ?? rows[0];
}

export function resolveAiProfile(profileId?: number | null): EmailAiProfileRow | undefined {
  if (profileId != null && profileId > 0) {
    return getAiProfileById(profileId);
  }
  return getDefaultAiProfile();
}

export function createAiProfile(input: {
  label: string;
  provider: AiProviderPreset;
  baseUrl: string;
  model: string;
  embeddingModel?: string | null;
  isDefault?: boolean;
  sortOrder?: number;
}): number {
  const keytarAccount = `profile-${randomUUID()}`;
  if (input.isDefault) {
    getDb().prepare(`UPDATE ${EMAIL_AI_PROFILES_TABLE} SET is_default = 0`).run();
  }
  const r = getDb()
    .prepare(
      `INSERT INTO ${EMAIL_AI_PROFILES_TABLE}
       (label, provider, base_url, model, embedding_model, keytar_account, is_default, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
    .run(
      input.label.trim(),
      input.provider,
      input.baseUrl.replace(/\/$/, ''),
      input.model.trim(),
      input.embeddingModel?.trim() || null,
      keytarAccount,
      input.isDefault ? 1 : 0,
      input.sortOrder ?? 0,
    );
  return Number(r.lastInsertRowid);
}

export function updateAiProfile(
  id: number,
  input: {
    label?: string;
    provider?: AiProviderPreset;
    baseUrl?: string;
    model?: string;
    embeddingModel?: string | null;
    isDefault?: boolean;
    sortOrder?: number;
  },
): void {
  const existing = getAiProfileById(id);
  if (!existing) throw new Error('KI-Profil nicht gefunden');
  if (input.isDefault) {
    getDb().prepare(`UPDATE ${EMAIL_AI_PROFILES_TABLE} SET is_default = 0`).run();
  }
  getDb()
    .prepare(
      `UPDATE ${EMAIL_AI_PROFILES_TABLE} SET
         label = COALESCE(?, label),
         provider = COALESCE(?, provider),
         base_url = COALESCE(?, base_url),
         model = COALESCE(?, model),
         embedding_model = COALESCE(?, embedding_model),
         is_default = COALESCE(?, is_default),
         sort_order = COALESCE(?, sort_order),
         updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(
      input.label?.trim() ?? null,
      input.provider ?? null,
      input.baseUrl?.replace(/\/$/, '') ?? null,
      input.model?.trim() ?? null,
      input.embeddingModel !== undefined ? input.embeddingModel : null,
      input.isDefault !== undefined ? (input.isDefault ? 1 : 0) : null,
      input.sortOrder ?? null,
      id,
    );
}

export function deleteAiProfile(id: number): void {
  const row = getAiProfileById(id);
  if (!row) return;
  getDb().prepare(`DELETE FROM ${EMAIL_AI_PROFILES_TABLE} WHERE id = ?`).run(id);
  void keytar.deletePassword(KEYTAR_SERVICE, row.keytar_account);
}

export async function saveAiProfileApiKey(keytarAccount: string, key: string): Promise<void> {
  await keytar.setPassword(KEYTAR_SERVICE, keytarAccount, key);
}

export async function getAiProfileApiKey(keytarAccount: string): Promise<string | null> {
  return keytar.getPassword(KEYTAR_SERVICE, keytarAccount);
}

export async function clearAiProfileApiKey(keytarAccount: string): Promise<void> {
  await keytar.deletePassword(KEYTAR_SERVICE, keytarAccount);
}

export async function getResolvedAiRuntime(profileId?: number | null): Promise<{
  baseUrl: string;
  model: string;
  embeddingModel: string;
  apiKey: string | null;
  profileId: number | null;
  profileLabel: string | null;
}> {
  await ensureDefaultAiProfiles();
  const profile = resolveAiProfile(profileId);
  if (!profile) {
    const baseUrl = (getSyncInfo('email_ai_base_url') || AI_PROVIDER_PRESETS.openai.baseUrl).replace(
      /\/$/,
      '',
    );
    return {
      baseUrl,
      model: getSyncInfo('email_ai_model') || AI_PROVIDER_PRESETS.openai.defaultModel,
      embeddingModel: getSyncInfo('email_ai_embedding_model') || 'text-embedding-3-small',
      apiKey: await getEmailAiApiKey(),
      profileId: null,
      profileLabel: null,
    };
  }
  return {
    baseUrl: profile.base_url,
    model: profile.model,
    embeddingModel: profile.embedding_model || 'text-embedding-3-small',
    apiKey: await getAiProfileApiKey(profile.keytar_account),
    profileId: profile.id,
    profileLabel: profile.label,
  };
}
