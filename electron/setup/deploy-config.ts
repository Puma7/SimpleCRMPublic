import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

export const ELECTRON_DEPLOY_CONFIG_VERSION = 1;
export const ELECTRON_DEPLOY_CONFIG_FILE = 'config.json';

export type ElectronDeployMode = 'standalone' | 'server-client' | 'server-install';

export type ElectronDeployConfig = Readonly<{
  version: typeof ELECTRON_DEPLOY_CONFIG_VERSION;
  mode: ElectronDeployMode;
  selectedAt: string;
  server?: {
    baseUrl: string;
    lastLoginUsername?: string;
  };
  serverInstall?: {
    composeProjectName?: string;
    installDir?: string;
  };
}>;

export type ElectronDeployConfigReadResult =
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'invalid'; error: string }>
  | Readonly<{ status: 'ok'; config: ElectronDeployConfig }>;

export type ElectronDeployConfigInput = Readonly<{
  mode: ElectronDeployMode;
  server?: {
    baseUrl?: string;
    lastLoginUsername?: string;
  };
  serverInstall?: {
    composeProjectName?: string;
    installDir?: string;
  };
}>;

export type ElectronDeployConfigFilePort = Readonly<{
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}>;

export function buildElectronDeployConfigPath(userDataDir: string): string {
  return join(requiredText(userDataDir, 'userDataDir'), ELECTRON_DEPLOY_CONFIG_FILE);
}

export async function readElectronDeployConfig(
  userDataDir: string,
  filePort: ElectronDeployConfigFilePort = nodeFilePort,
): Promise<ElectronDeployConfigReadResult> {
  const path = buildElectronDeployConfigPath(userDataDir);
  try {
    const raw = await filePort.readFile(path, 'utf8');
    return { status: 'ok', config: normalizeElectronDeployConfig(JSON.parse(raw)) };
  } catch (error) {
    if (isNotFoundError(error)) return { status: 'missing' };
    return { status: 'invalid', error: formatError(error) };
  }
}

export async function writeElectronDeployConfig(
  userDataDir: string,
  input: ElectronDeployConfigInput,
  options: {
    now?: Date;
    filePort?: ElectronDeployConfigFilePort;
  } = {},
): Promise<ElectronDeployConfig> {
  const filePort = options.filePort ?? nodeFilePort;
  const path = buildElectronDeployConfigPath(userDataDir);
  const config = normalizeElectronDeployConfig({
    ...input,
    version: ELECTRON_DEPLOY_CONFIG_VERSION,
    selectedAt: (options.now ?? new Date()).toISOString(),
  });
  await filePort.mkdir(dirname(path), { recursive: true });
  await filePort.writeFile(`${path}.tmp`, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await filePort.rename(`${path}.tmp`, path);
  return config;
}

export function normalizeElectronDeployConfig(input: unknown): ElectronDeployConfig {
  if (!isRecord(input)) throw new Error('deploy config must be an object');
  const mode = normalizeMode(input.mode);
  const selectedAt = normalizeSelectedAt(input.selectedAt);
  const server = mode === 'server-client'
    ? normalizeServerConfig(input.server)
    : optionalServerConfig(input.server);
  const serverInstall = mode === 'server-install'
    ? normalizeServerInstallConfig(input.serverInstall)
    : optionalServerInstallConfig(input.serverInstall);
  return {
    version: ELECTRON_DEPLOY_CONFIG_VERSION,
    mode,
    selectedAt,
    ...(server ? { server } : {}),
    ...(serverInstall ? { serverInstall } : {}),
  };
}

export function normalizeElectronServerBaseUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('server.baseUrl must be a string');
  const raw = value.trim();
  if (!raw) throw new Error('server.baseUrl is required');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('server.baseUrl must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('server.baseUrl must use http or https');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  const normalized = parsed.toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function normalizeMode(value: unknown): ElectronDeployMode {
  if (value === 'standalone' || value === 'server-client' || value === 'server-install') {
    return value;
  }
  throw new Error('mode must be standalone, server-client, or server-install');
}

function normalizeServerConfig(value: unknown): NonNullable<ElectronDeployConfig['server']> {
  if (!isRecord(value)) throw new Error('server config is required for server-client mode');
  const lastLoginUsername = optionalText(value.lastLoginUsername, 'server.lastLoginUsername');
  return {
    baseUrl: normalizeElectronServerBaseUrl(value.baseUrl),
    ...(lastLoginUsername ? { lastLoginUsername } : {}),
  };
}

function optionalServerConfig(value: unknown): ElectronDeployConfig['server'] | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeServerConfig(value);
}

function normalizeServerInstallConfig(value: unknown): NonNullable<ElectronDeployConfig['serverInstall']> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('serverInstall config must be an object');
  const composeProjectName = optionalText(value.composeProjectName, 'serverInstall.composeProjectName');
  const installDir = optionalText(value.installDir, 'serverInstall.installDir');
  return {
    ...(composeProjectName ? { composeProjectName } : {}),
    ...(installDir ? { installDir } : {}),
  };
}

function optionalServerInstallConfig(value: unknown): ElectronDeployConfig['serverInstall'] | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeServerInstallConfig(value);
}

function normalizeSelectedAt(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('selectedAt is required');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('selectedAt must be a valid ISO date');
  return date.toISOString();
}

function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  return value.trim() || undefined;
}

function requiredText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error');
}

const nodeFilePort: ElectronDeployConfigFilePort = {
  mkdir,
  readFile,
  writeFile,
  rename,
};
