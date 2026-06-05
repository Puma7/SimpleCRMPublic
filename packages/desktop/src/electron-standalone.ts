import {
  STANDALONE_POSTGRES_DATABASE,
  STANDALONE_POSTGRES_HOST,
  STANDALONE_POSTGRES_USER,
  StandalonePostgresManager,
  type EmbeddedPostgresEngineFactory,
  type StandalonePostgresConfig,
  type StandalonePostgresLogger,
  type StandaloneSecretStore,
} from './embedded-postgres';

export const STANDALONE_KEYTAR_SERVICE = 'SimpleCRMElectron-StandalonePostgres';
export const SIMPLECRM_DESKTOP_MODE_ENV = 'SIMPLECRM_DESKTOP_MODE';
export const SIMPLECRM_STANDALONE_PG_HOST_ENV = 'SIMPLECRM_STANDALONE_PG_HOST';
export const SIMPLECRM_STANDALONE_PG_PORT_ENV = 'SIMPLECRM_STANDALONE_PG_PORT';
export const SIMPLECRM_STANDALONE_PG_DATABASE_ENV = 'SIMPLECRM_STANDALONE_PG_DATABASE';
export const SIMPLECRM_STANDALONE_PG_USER_ENV = 'SIMPLECRM_STANDALONE_PG_USER';

export type ElectronDesktopDeployMode = 'standalone' | 'server-client';

export type ElectronAppPathPort = Readonly<{
  getPath(name: 'userData'): string;
}>;

export type KeytarSecretPort = Readonly<{
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword?(service: string, account: string): Promise<boolean>;
}>;

export type StandaloneKeytarSecretStore = StandaloneSecretStore & Readonly<{
  deleteSecret(name: string): Promise<boolean>;
}>;

export type ElectronStandalonePostgresOptions = Omit<
  StandalonePostgresConfig,
  'database' | 'host' | 'port' | 'secretStore' | 'user' | 'userDataDir'
> & Readonly<{
  app: ElectronAppPathPort;
  keytar?: KeytarSecretPort;
  secretStore?: StandaloneSecretStore;
  env?: Record<string, string | undefined>;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
}>;

export function resolveDesktopDeployMode(
  env: Record<string, string | undefined> = process.env,
): ElectronDesktopDeployMode {
  const raw = env[SIMPLECRM_DESKTOP_MODE_ENV]?.trim().toLowerCase();
  if (!raw || raw === 'standalone') return 'standalone';
  if (raw === 'server-client' || raw === 'thin-client') return 'server-client';
  throw new Error(`${SIMPLECRM_DESKTOP_MODE_ENV} must be standalone or server-client`);
}

export function createKeytarStandaloneSecretStore(
  keytar: KeytarSecretPort,
  service = STANDALONE_KEYTAR_SERVICE,
): StandaloneKeytarSecretStore {
  const normalizedService = requiredText(service, 'keytar service');
  return {
    async readSecret(name) {
      return keytar.getPassword(normalizedService, standaloneSecretAccountName(name));
    },
    async writeSecret(name, value) {
      if (!value) throw new Error('secret value must not be empty');
      await keytar.setPassword(normalizedService, standaloneSecretAccountName(name), value);
    },
    async deleteSecret(name) {
      return keytar.deletePassword?.(normalizedService, standaloneSecretAccountName(name)) ?? false;
    },
  };
}

export function standaloneSecretAccountName(name: string): string {
  return `standalone:${requiredText(name, 'secret name')}`;
}

export function buildElectronStandalonePostgresConfig(
  options: ElectronStandalonePostgresOptions,
): StandalonePostgresConfig | null {
  const env = options.env ?? process.env;
  const mode = resolveDesktopDeployMode(env);
  if (mode === 'server-client') return null;
  const secretStore = options.secretStore ?? createKeytarStandaloneSecretStore(requiredKeytar(options.keytar));
  return {
    userDataDir: options.app.getPath('userData'),
    host: options.host ?? envText(env, SIMPLECRM_STANDALONE_PG_HOST_ENV) ?? STANDALONE_POSTGRES_HOST,
    port: options.port ?? optionalEnvPort(env, SIMPLECRM_STANDALONE_PG_PORT_ENV),
    database: options.database ?? envText(env, SIMPLECRM_STANDALONE_PG_DATABASE_ENV) ?? STANDALONE_POSTGRES_DATABASE,
    user: options.user ?? envText(env, SIMPLECRM_STANDALONE_PG_USER_ENV) ?? STANDALONE_POSTGRES_USER,
    password: options.password,
    startupTimeoutMs: options.startupTimeoutMs,
    shutdownTimeoutMs: options.shutdownTimeoutMs,
    logger: options.logger,
    engineFactory: options.engineFactory,
    allocatePort: options.allocatePort,
    secretStore,
  };
}

export function createElectronStandalonePostgresManager(
  options: ElectronStandalonePostgresOptions,
): StandalonePostgresManager | null {
  const config = buildElectronStandalonePostgresConfig(options);
  return config ? new StandalonePostgresManager(config) : null;
}

function requiredKeytar(keytar: KeytarSecretPort | undefined): KeytarSecretPort {
  if (!keytar) throw new Error('keytar module is required for standalone PostgreSQL secret storage');
  return keytar;
}

function envText(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function optionalEnvPort(env: Record<string, string | undefined>, name: string): number | undefined {
  const raw = envText(env, name);
  if (!raw) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

function requiredText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

export type ElectronStandalonePostgresRuntimeOptions = Readonly<{
  logger?: StandalonePostgresLogger;
  engineFactory?: EmbeddedPostgresEngineFactory;
}>;
