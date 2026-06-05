import { randomBytes } from 'crypto';
import { createServer } from 'net';
import { join } from 'path';

export const STANDALONE_POSTGRES_PASSWORD_SECRET = 'simplecrm:standalone-postgres-password';
export const STANDALONE_MASTER_KEY_SECRET = 'simplecrm:standalone-master-key';
export const STANDALONE_POSTGRES_DATABASE = 'simplecrm';
export const STANDALONE_POSTGRES_USER = 'simplecrm';
export const STANDALONE_POSTGRES_HOST = '127.0.0.1';
export const STANDALONE_POSTGRES_MAJOR = 18;

export type StandalonePostgresLayout = Readonly<{
  userDataDir: string;
  binaryDir: string;
  dataDir: string;
}>;

export type StandaloneSecretStore = Readonly<{
  readSecret(name: string): Promise<string | null>;
  writeSecret(name: string, value: string): Promise<void>;
}>;

export type StandalonePostgresLogger = Readonly<{
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}>;

export type EmbeddedPostgresClient = Readonly<{
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}>;

export type EmbeddedPostgresEngine = Readonly<{
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  kill?(): Promise<void>;
  createDatabase?(database: string): Promise<void>;
  getPgClient?(): EmbeddedPostgresClient;
}>;

export type EmbeddedPostgresEngineFactory = (input: EmbeddedPostgresEngineInput) => EmbeddedPostgresEngine;

export type EmbeddedPostgresEngineInput = Readonly<{
  layout: StandalonePostgresLayout;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  logger?: StandalonePostgresLogger;
}>;

export type StandalonePostgresConfig = Readonly<{
  userDataDir: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  secretStore?: StandaloneSecretStore;
  logger?: StandalonePostgresLogger;
  engineFactory?: EmbeddedPostgresEngineFactory;
  allocatePort?: (host: string) => Promise<number>;
}>;

export type StartedStandalonePostgres = Readonly<{
  mode: 'standalone';
  postgresMajor: typeof STANDALONE_POSTGRES_MAJOR;
  host: string;
  port: number;
  database: string;
  user: string;
  connectionString: string;
  layout: StandalonePostgresLayout;
}>;

export class StandalonePostgresManager {
  private readonly config: RequiredStandalonePostgresConfig;
  private engine: EmbeddedPostgresEngine | null = null;
  private started: StartedStandalonePostgres | null = null;

  constructor(config: StandalonePostgresConfig) {
    this.config = normalizeStandalonePostgresConfig(config);
  }

  async start(): Promise<StartedStandalonePostgres> {
    if (this.started) return this.started;

    const layout = buildStandalonePostgresLayout(this.config.userDataDir);
    const port = this.config.port ?? await this.config.allocatePort(this.config.host);
    const password = this.config.password
      ?? await ensureStandaloneSecret(this.config.secretStore, STANDALONE_POSTGRES_PASSWORD_SECRET, 'password');
    await ensureStandaloneSecret(this.config.secretStore, STANDALONE_MASTER_KEY_SECRET, 'master-key');

    const engine = this.config.engineFactory({
      layout,
      host: this.config.host,
      port,
      database: this.config.database,
      user: this.config.user,
      password,
      logger: this.config.logger,
    });
    this.engine = engine;

    await withTimeout(engine.initialise(), this.config.startupTimeoutMs, 'embedded PostgreSQL initialise timed out');
    await withTimeout(engine.start(), this.config.startupTimeoutMs, 'embedded PostgreSQL start timed out');
    await engine.createDatabase?.(this.config.database);
    await waitForEmbeddedPostgresHealth(engine, this.config.startupTimeoutMs);

    this.started = {
      mode: 'standalone',
      postgresMajor: STANDALONE_POSTGRES_MAJOR,
      host: this.config.host,
      port,
      database: this.config.database,
      user: this.config.user,
      connectionString: buildStandalonePostgresConnectionString({
        host: this.config.host,
        port,
        database: this.config.database,
        user: this.config.user,
        password,
      }),
      layout,
    };
    this.config.logger?.info?.('embedded PostgreSQL started', {
      port,
      dataDir: layout.dataDir,
    });
    return this.started;
  }

  async stop(): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    try {
      await withTimeout(engine.stop(), this.config.shutdownTimeoutMs, 'embedded PostgreSQL stop timed out');
    } catch (error) {
      if (!engine.kill) throw error;
      this.config.logger?.warn?.('embedded PostgreSQL stop timed out; using kill fallback');
      await engine.kill();
    } finally {
      this.engine = null;
      this.started = null;
    }
  }
}

export function buildStandalonePostgresLayout(userDataDir: string): StandalonePostgresLayout {
  const root = requiredPath(userDataDir, 'userDataDir');
  return {
    userDataDir: root,
    binaryDir: join(root, 'postgres-bin'),
    dataDir: join(root, 'postgres-data'),
  };
}

export function buildStandalonePostgresConnectionString(input: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): string {
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error('port must be an integer between 1 and 65535');
  }
  return `postgres://${encodeURIComponent(input.user)}:${encodeURIComponent(input.password)}@${input.host}:${input.port}/${encodeURIComponent(input.database)}`;
}

export async function ensureStandaloneSecret(
  store: StandaloneSecretStore,
  name: string,
  kind: 'password' | 'master-key',
): Promise<string> {
  const existing = await store.readSecret(name);
  if (existing?.trim()) return existing;
  const generated = kind === 'master-key'
    ? randomBytes(32).toString('base64')
    : randomBytes(24).toString('base64url');
  await store.writeSecret(name, generated);
  return generated;
}

export async function findAvailableLocalPort(host = STANDALONE_POSTGRES_HOST): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('could not allocate a TCP port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

export function createEmbeddedPostgresEngineFactory(
  loadModule: () => unknown = () => require('embedded-postgres'),
): EmbeddedPostgresEngineFactory {
  return (input) => {
    const moduleValue = loadModule() as EmbeddedPostgresModule;
    const EmbeddedPostgres = typeof moduleValue === 'function'
      ? moduleValue
      : moduleValue.default ?? moduleValue.EmbeddedPostgres;
    if (typeof EmbeddedPostgres !== 'function') {
      throw new Error('embedded-postgres module did not export a constructor');
    }
    return new EmbeddedPostgres({
      databaseDir: input.layout.dataDir,
      port: input.port,
      user: input.user,
      password: input.password,
      authMethod: 'scram-sha-256',
      persistent: true,
      onLog: (message: string) => input.logger?.debug?.(message),
      onError: (message: unknown) => input.logger?.error?.('embedded PostgreSQL error', { message }),
    });
  };
}

async function waitForEmbeddedPostgresHealth(engine: EmbeddedPostgresEngine, timeoutMs: number): Promise<void> {
  if (!engine.getPgClient) return;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() <= deadline) {
    const client = engine.getPgClient();
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // Ignore cleanup errors while probing startup readiness.
      }
      await sleep(100);
    }
  }
  throw new Error(`embedded PostgreSQL health check timed out: ${formatError(lastError)}`);
}

function normalizeStandalonePostgresConfig(config: StandalonePostgresConfig): RequiredStandalonePostgresConfig {
  return {
    userDataDir: requiredPath(config.userDataDir, 'userDataDir'),
    host: config.host?.trim() || STANDALONE_POSTGRES_HOST,
    port: config.port,
    database: config.database?.trim() || STANDALONE_POSTGRES_DATABASE,
    user: config.user?.trim() || STANDALONE_POSTGRES_USER,
    password: config.password,
    startupTimeoutMs: boundedTimeout(config.startupTimeoutMs, 10_000, 'startupTimeoutMs'),
    shutdownTimeoutMs: boundedTimeout(config.shutdownTimeoutMs, 5_000, 'shutdownTimeoutMs'),
    secretStore: config.secretStore ?? inMemoryStandaloneSecretStore(),
    logger: config.logger,
    engineFactory: config.engineFactory ?? createEmbeddedPostgresEngineFactory(),
    allocatePort: config.allocatePort ?? findAvailableLocalPort,
  };
}

function boundedTimeout(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 100 || value > 120_000) {
    throw new Error(`${name} must be an integer between 100 and 120000`);
  }
  return value;
}

function requiredPath(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function inMemoryStandaloneSecretStore(): StandaloneSecretStore {
  const values = new Map<string, string>();
  return {
    async readSecret(name) {
      return values.get(name) ?? null;
    },
    async writeSecret(name, value) {
      values.set(name, value);
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error');
}

type RequiredStandalonePostgresConfig = Readonly<{
  userDataDir: string;
  host: string;
  port?: number;
  database: string;
  user: string;
  password?: string;
  startupTimeoutMs: number;
  shutdownTimeoutMs: number;
  secretStore: StandaloneSecretStore;
  logger?: StandalonePostgresLogger;
  engineFactory: EmbeddedPostgresEngineFactory;
  allocatePort: (host: string) => Promise<number>;
}>;

type EmbeddedPostgresModule =
  | EmbeddedPostgresConstructor
  | { default?: EmbeddedPostgresConstructor; EmbeddedPostgres?: EmbeddedPostgresConstructor };

type EmbeddedPostgresConstructor = new(options: {
  databaseDir: string;
  port: number;
  user: string;
  password: string;
  authMethod: 'scram-sha-256';
  persistent: boolean;
  onLog?: (message: string) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresEngine;
