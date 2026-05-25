import { randomBytes } from 'crypto';
import keytar from 'keytar';
import type { AutomationScope } from '../../shared/automation-api';
import { AUTOMATION_SCOPES } from '../../shared/automation-api';

const SERVICE = 'SimpleCRMElectron-AutomationAPI';
const ACCOUNT = 'api-credentials';

export type StoredApiCredentials = {
  key: string;
  scopes: AutomationScope[];
  createdAt: string;
};

function parseScopes(raw: unknown): AutomationScope[] {
  if (!Array.isArray(raw)) return [...AUTOMATION_SCOPES];
  const allowed = new Set<string>(AUTOMATION_SCOPES);
  const scopes = raw.filter((s): s is AutomationScope => typeof s === 'string' && allowed.has(s));
  return scopes.length > 0 ? scopes : [...AUTOMATION_SCOPES];
}

export function generateApiKeyToken(): string {
  return `scrm_${randomBytes(32).toString('hex')}`;
}

export async function saveApiCredentials(creds: StoredApiCredentials): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(creds));
}

export async function loadApiCredentials(): Promise<StoredApiCredentials | null> {
  const raw = await keytar.getPassword(SERVICE, ACCOUNT);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredApiCredentials>;
    if (!parsed.key || typeof parsed.key !== 'string') return null;
    return {
      key: parsed.key,
      scopes: parseScopes(parsed.scopes),
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function revokeApiCredentials(): Promise<boolean> {
  return keytar.deletePassword(SERVICE, ACCOUNT);
}

export function keyPreview(token: string): string {
  if (token.length < 12) return '****';
  return `…${token.slice(-8)}`;
}
