import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

export const DESKTOP_DEPLOY_CONFIG_VERSION = 1;
export const DESKTOP_DEPLOY_CONFIG_FILE = 'config.json';

export type DesktopSetupMode = 'standalone' | 'server-client' | 'server-install';

export type DesktopDeployConfig = Readonly<{
  version: typeof DESKTOP_DEPLOY_CONFIG_VERSION;
  mode: DesktopSetupMode;
  selectedAt: string;
  server?: DesktopServerConnectionConfig;
  serverInstall?: DesktopServerInstallConfig;
}>;

export type DesktopServerConnectionConfig = Readonly<{
  baseUrl: string;
  lastLoginUsername?: string;
}>;

export type DesktopServerInstallConfig = Readonly<{
  composeProjectName?: string;
  installDir?: string;
}>;

export type DesktopDeployConfigReadResult =
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'invalid'; error: string }>
  | Readonly<{ status: 'ok'; config: DesktopDeployConfig }>;

export type DesktopDeployConfigFilePort = Readonly<{
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}>;

export function buildDesktopDeployConfigPath(userDataDir: string): string {
  return join(requiredText(userDataDir, 'userDataDir'), DESKTOP_DEPLOY_CONFIG_FILE);
}

export async function readDesktopDeployConfig(
  userDataDir: string,
  filePort: DesktopDeployConfigFilePort = nodeFilePort,
): Promise<DesktopDeployConfigReadResult> {
  const path = buildDesktopDeployConfigPath(userDataDir);
  try {
    const raw = await filePort.readFile(path, 'utf8');
    return { status: 'ok', config: normalizeDesktopDeployConfig(JSON.parse(raw)) };
  } catch (error) {
    if (isNotFoundError(error)) return { status: 'missing' };
    return { status: 'invalid', error: formatError(error) };
  }
}

export async function writeDesktopDeployConfig(
  userDataDir: string,
  input: unknown,
  filePort: DesktopDeployConfigFilePort = nodeFilePort,
): Promise<DesktopDeployConfig> {
  const path = buildDesktopDeployConfigPath(userDataDir);
  const config = normalizeDesktopDeployConfig(input);
  const tmpPath = `${path}.tmp`;
  await filePort.mkdir(dirname(path), { recursive: true });
  await filePort.writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await filePort.rename(tmpPath, path);
  return config;
}

export function shouldShowSetupWizard(result: DesktopDeployConfigReadResult): boolean {
  return result.status !== 'ok';
}

export function normalizeDesktopDeployConfig(input: unknown): DesktopDeployConfig {
  if (!isRecord(input)) throw new Error('desktop deploy config must be an object');
  const mode = normalizeSetupMode(input.mode);
  const selectedAt = normalizeIsoDate(input.selectedAt, 'selectedAt');
  const server = mode === 'server-client'
    ? normalizeServerConnectionConfig(input.server)
    : optionalServerConnectionConfig(input.server);
  const serverInstall = mode === 'server-install'
    ? normalizeServerInstallConfig(input.serverInstall)
    : optionalServerInstallConfig(input.serverInstall);
  return {
    version: DESKTOP_DEPLOY_CONFIG_VERSION,
    mode,
    selectedAt,
    ...(server ? { server } : {}),
    ...(serverInstall ? { serverInstall } : {}),
  };
}

export function buildDesktopDeployConfig(input: {
  mode: DesktopSetupMode;
  server?: { baseUrl: string; lastLoginUsername?: string | null };
  serverInstall?: { composeProjectName?: string | null; installDir?: string | null };
  now?: Date;
}): DesktopDeployConfig {
  return normalizeDesktopDeployConfig({
    version: DESKTOP_DEPLOY_CONFIG_VERSION,
    mode: input.mode,
    selectedAt: (input.now ?? new Date()).toISOString(),
    server: input.server,
    serverInstall: input.serverInstall,
  });
}

export function normalizeServerBaseUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('server.baseUrl must be a string');
  const trimmed = value.trim();
  if (!trimmed) throw new Error('server.baseUrl is required');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
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

function normalizeSetupMode(value: unknown): DesktopSetupMode {
  if (value !== 'standalone' && value !== 'server-client' && value !== 'server-install') {
    throw new Error('mode must be standalone, server-client, or server-install');
  }
  return value;
}

function normalizeServerConnectionConfig(value: unknown): DesktopServerConnectionConfig {
  if (!isRecord(value)) throw new Error('server config is required for server-client mode');
  const baseUrl = normalizeServerBaseUrl(value.baseUrl);
  const lastLoginUsername = optionalText(value.lastLoginUsername, 'server.lastLoginUsername');
  return {
    baseUrl,
    ...(lastLoginUsername ? { lastLoginUsername } : {}),
  };
}

function optionalServerConnectionConfig(value: unknown): DesktopServerConnectionConfig | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeServerConnectionConfig(value);
}

function normalizeServerInstallConfig(value: unknown): DesktopServerInstallConfig {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('serverInstall config must be an object');
  const composeProjectName = optionalText(value.composeProjectName, 'serverInstall.composeProjectName');
  const installDir = optionalText(value.installDir, 'serverInstall.installDir');
  return {
    ...(composeProjectName ? { composeProjectName } : {}),
    ...(installDir ? { installDir } : {}),
  };
}

function optionalServerInstallConfig(value: unknown): DesktopServerInstallConfig | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeServerInstallConfig(value);
}

function normalizeIsoDate(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a valid ISO date`);
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

const nodeFilePort: DesktopDeployConfigFilePort = {
  mkdir,
  readFile,
  writeFile,
  rename,
};
