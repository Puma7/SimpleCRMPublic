export type SqlitePrimaryKey = string | number;

export type SqliteMigrationTableCategory =
  | 'crm'
  | 'jtl'
  | 'mail'
  | 'workflow'
  | 'auth'
  | 'automation'
  | 'security';

export type SqliteMigrationTable = Readonly<{
  name: string;
  category: SqliteMigrationTableCategory;
  primaryKey: string;
  required: boolean;
  dependsOn?: readonly string[];
  targetName?: string;
  workspaceScoped?: boolean;
  notes?: string;
}>;

export type SqliteMigrationPlan = Readonly<{
  id: string;
  description: string;
  tables: readonly SqliteMigrationTable[];
}>;

export type SqliteMigrationRow = Readonly<Record<string, unknown>>;

export type SqliteMigrationReadRowsInput = Readonly<{
  tableName: string;
  primaryKey: string;
  afterPrimaryKey: string | null;
  limit: number;
}>;

export type SqliteMigrationSourcePort = Readonly<{
  tableExists(tableName: string): Promise<boolean>;
  countRows(tableName: string): Promise<number>;
  readRows(input: SqliteMigrationReadRowsInput): Promise<readonly SqliteMigrationRow[]>;
}>;

export type SqliteImportRunStatus = 'running' | 'succeeded' | 'failed' | 'dry_run';
export type SqliteImportTableStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'dry_run';

export type BeginSqliteImportRunInput = Readonly<{
  workspaceId: string;
  planId: string;
  sourceFingerprint: string;
  dryRun: boolean;
  startedAt: Date;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type BeginSqliteImportRunResult = Readonly<{
  runId: string;
}>;

export type SqliteImportTableCheckpoint = Readonly<{
  runId: string;
  tableName: string;
  status: SqliteImportTableStatus;
  sourceRowCount: number;
  copiedRowCount: number;
  lastSourcePrimaryKey: string | null;
  error?: string | null;
}>;

export type BeginSqliteImportTableInput = Readonly<{
  runId: string;
  table: SqliteMigrationTable;
  sourceRowCount: number;
  status: Extract<SqliteImportTableStatus, 'running' | 'dry_run'>;
}>;

export type UpsertSqliteMigrationRowsInput = Readonly<{
  runId: string;
  workspaceId: string;
  table: SqliteMigrationTable;
  rows: readonly SqliteMigrationRow[];
}>;

export type ValidateSqliteImportTableInput = Readonly<{
  runId: string;
  workspaceId: string;
  table: SqliteMigrationTable;
  sourceRowCount: number;
  sourceTableHash: string;
}>;

export type ValidateSqliteImportTableResult = Readonly<{
  ok: boolean;
  stagedRowCount: number;
  sourceRowCount: number;
  sourceTableHash: string;
  stagedTableHash: string;
  error?: string;
}>;

export type UpdateSqliteImportTableCheckpointInput = Readonly<{
  runId: string;
  tableName: string;
  sourceRowCount: number;
  copiedRowCount: number;
  lastSourcePrimaryKey: string | null;
  status: SqliteImportTableStatus;
  error?: string | null;
}>;

export type CompleteSqliteImportRunInput = Readonly<{
  runId: string;
  status: Extract<SqliteImportRunStatus, 'succeeded' | 'dry_run'>;
  finishedAt: Date;
}>;

export type FailSqliteImportRunInput = Readonly<{
  runId: string;
  error: string;
  finishedAt: Date;
}>;

export type SqliteMigrationTargetPort = Readonly<{
  beginRun(input: BeginSqliteImportRunInput): Promise<BeginSqliteImportRunResult>;
  getTableCheckpoint(runId: string, tableName: string): Promise<SqliteImportTableCheckpoint | null>;
  beginTable(input: BeginSqliteImportTableInput): Promise<void>;
  upsertRows(input: UpsertSqliteMigrationRowsInput): Promise<void>;
  validateStagedTable?(input: ValidateSqliteImportTableInput): Promise<ValidateSqliteImportTableResult>;
  updateTableCheckpoint(input: UpdateSqliteImportTableCheckpointInput): Promise<void>;
  skipTable(input: UpdateSqliteImportTableCheckpointInput): Promise<void>;
  completeRun(input: CompleteSqliteImportRunInput): Promise<void>;
  failRun(input: FailSqliteImportRunInput): Promise<void>;
}>;

export type SqliteMigrationReporter = Readonly<{
  onRunStarted?(event: Readonly<{ runId: string; planId: string; dryRun: boolean }>): void;
  onTableStarted?(event: Readonly<{ runId: string; tableName: string; sourceRowCount: number }>): void;
  onTableSkipped?(event: Readonly<{ runId: string; tableName: string; reason: string }>): void;
  onBatchCopied?(event: Readonly<{
    runId: string;
    tableName: string;
    copiedRowCount: number;
    lastSourcePrimaryKey: string | null;
  }>): void;
  onRunCompleted?(event: Readonly<{ runId: string; status: SqliteImportRunStatus }>): void;
  onRunFailed?(event: Readonly<{ runId: string; error: string }>): void;
}>;

export type RunSqliteToPostgresMigrationInput = Readonly<{
  source: SqliteMigrationSourcePort;
  target: SqliteMigrationTargetPort;
  plan?: SqliteMigrationPlan;
  workspaceId: string;
  sourceFingerprint: string;
  dryRun?: boolean;
  batchSize?: number;
  reporter?: SqliteMigrationReporter;
  now?: () => Date;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type SqliteMigrationTableResult = Readonly<{
  tableName: string;
  status: SqliteImportTableStatus;
  sourceRowCount: number;
  copiedRowCount: number;
  lastSourcePrimaryKey: string | null;
  sourceTableHash?: string;
  stagedTableHash?: string;
}>;

export type SqliteMigrationRunResult = Readonly<{
  runId: string;
  status: SqliteImportRunStatus;
  tables: readonly SqliteMigrationTableResult[];
}>;
