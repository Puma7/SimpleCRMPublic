export type SimpleCrmDeployMode = 'standalone' | 'headless' | 'server';

export type CoreLogger = {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
};

export type PathProvider = {
  userDataDir(): string;
  attachmentsDir(): string;
  tempDir(): string;
};

export type DialogPort = {
  confirm(message: string, detail?: string): Promise<boolean>;
  chooseFile(options: { title: string; extensions?: string[] }): Promise<string | null>;
};

export type SecretPort = {
  readSecret(name: string): Promise<string | null>;
  writeSecret(name: string, value: string): Promise<void>;
  deleteSecret(name: string): Promise<void>;
};

export type CorePlatformPorts = {
  paths: PathProvider;
  dialog: DialogPort;
  secrets: SecretPort;
  logger: CoreLogger;
};

export const CORE_FORBIDDEN_RUNTIME_IMPORTS = ['electron', 'keytar'] as const;
