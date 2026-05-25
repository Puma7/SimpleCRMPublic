import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import {
  AUTOMATION_DEFAULT_PORT,
  type AutomationApiSettings,
  type AutomationScope,
} from '../../shared/automation-api';
import { loadApiCredentials, keyPreview } from './automation-keytar';

const KEY_ENABLED = 'automation_api_enabled';
const KEY_PORT = 'automation_api_port';
const KEY_BIND_LAN = 'automation_api_bind_lan';

function parsePort(raw: string | null): number {
  const n = parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n < 1024 || n > 65535) return AUTOMATION_DEFAULT_PORT;
  return n;
}

function truthy(raw: string | null): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function isAutomationApiEnabled(): boolean {
  return truthy(getSyncInfo(KEY_ENABLED));
}

export function getAutomationBindHost(): string {
  return truthy(getSyncInfo(KEY_BIND_LAN)) ? '0.0.0.0' : '127.0.0.1';
}

export function getAutomationPort(): number {
  return parsePort(getSyncInfo(KEY_PORT));
}

export async function getAutomationApiSettings(): Promise<AutomationApiSettings> {
  const creds = await loadApiCredentials();
  return {
    enabled: isAutomationApiEnabled(),
    port: getAutomationPort(),
    bindLan: truthy(getSyncInfo(KEY_BIND_LAN)),
    hasApiKey: Boolean(creds?.key),
    keyPreview: creds?.key ? keyPreview(creds.key) : null,
    scopes: creds?.scopes ?? [],
  };
}

export function setAutomationApiSettings(input: {
  enabled?: boolean;
  port?: number;
  bindLan?: boolean;
}): void {
  if (input.enabled !== undefined) {
    setSyncInfo(KEY_ENABLED, input.enabled ? 'true' : 'false');
  }
  if (input.port !== undefined) {
    const p = Math.min(65535, Math.max(1024, Math.floor(input.port)));
    setSyncInfo(KEY_PORT, String(p));
  }
  if (input.bindLan !== undefined) {
    setSyncInfo(KEY_BIND_LAN, input.bindLan ? 'true' : 'false');
  }
}

export function parseScopesInput(scopes: AutomationScope[] | undefined): AutomationScope[] {
  if (!scopes?.length) return ['read', 'write', 'email', 'workflows'];
  const allowed = new Set<string>(['read', 'write', 'email', 'workflows']);
  return scopes.filter((s) => allowed.has(s));
}
