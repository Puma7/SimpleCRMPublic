import { cp } from 'fs/promises';
import { spawn } from 'child_process';

export type StandaloneToServerAttachmentSync =
  | Readonly<{ mode: 'skip' }>
  | Readonly<{ mode: 'local-copy'; sourceDir: string; targetDir: string }>
  | Readonly<{ mode: 'rsync'; sourceDir: string; target: string; rsyncCommand?: string }>;

export type StandaloneToServerMigrationInput = Readonly<{
  sourceDatabaseUrl: string;
  targetDatabaseUrl: string;
  dumpPath: string;
  pgDumpCommand?: string;
  pgRestoreCommand?: string;
  attachments?: StandaloneToServerAttachmentSync;
}>;

export type StandaloneToServerMigrationPlan = Readonly<{
  sourceDatabaseUrl: string;
  targetDatabaseUrl: string;
  dumpPath: string;
  steps: readonly StandaloneToServerMigrationStep[];
}>;

export type StandaloneToServerMigrationStep =
  | Readonly<{
    type: 'pg_dump';
    command: string;
    args: readonly string[];
    redactedArgs: readonly string[];
  }>
  | Readonly<{
    type: 'pg_restore';
    command: string;
    args: readonly string[];
    redactedArgs: readonly string[];
  }>
  | Readonly<{
    type: 'copy_attachments';
    sourceDir: string;
    targetDir: string;
  }>
  | Readonly<{
    type: 'rsync_attachments';
    command: string;
    args: readonly string[];
  }>;

export type StandaloneToServerMigrationExecutor = Readonly<{
  runCommand(command: string, args: readonly string[]): Promise<void>;
  copyDirectory(sourceDir: string, targetDir: string): Promise<void>;
}>;

export type StandaloneToServerMigrationResult = Readonly<{
  status: 'succeeded';
  executedSteps: readonly StandaloneToServerMigrationStep['type'][];
}>;

export function buildStandaloneToServerMigrationPlan(
  input: StandaloneToServerMigrationInput,
): StandaloneToServerMigrationPlan {
  const sourceDatabaseUrl = requiredText(input.sourceDatabaseUrl, 'sourceDatabaseUrl');
  const targetDatabaseUrl = requiredText(input.targetDatabaseUrl, 'targetDatabaseUrl');
  const dumpPath = requiredText(input.dumpPath, 'dumpPath');
  const pgDumpCommand = input.pgDumpCommand?.trim() || 'pg_dump';
  const pgRestoreCommand = input.pgRestoreCommand?.trim() || 'pg_restore';
  const steps: StandaloneToServerMigrationStep[] = [
    {
      type: 'pg_dump',
      command: pgDumpCommand,
      args: ['-Fc', '--file', dumpPath, sourceDatabaseUrl],
      redactedArgs: ['-Fc', '--file', dumpPath, '<source-database-url>'],
    },
    {
      type: 'pg_restore',
      command: pgRestoreCommand,
      args: ['--clean', '--if-exists', '--no-owner', '--dbname', targetDatabaseUrl, dumpPath],
      redactedArgs: ['--clean', '--if-exists', '--no-owner', '--dbname', '<target-database-url>', dumpPath],
    },
  ];

  const attachments = input.attachments ?? { mode: 'skip' };
  if (attachments.mode === 'local-copy') {
    steps.push({
      type: 'copy_attachments',
      sourceDir: requiredText(attachments.sourceDir, 'attachments.sourceDir'),
      targetDir: requiredText(attachments.targetDir, 'attachments.targetDir'),
    });
  } else if (attachments.mode === 'rsync') {
    const sourceDir = requiredText(attachments.sourceDir, 'attachments.sourceDir').replace(/[\\/]+$/, '');
    steps.push({
      type: 'rsync_attachments',
      command: attachments.rsyncCommand?.trim() || 'rsync',
      args: ['-a', '--delete', `${sourceDir}/`, requiredText(attachments.target, 'attachments.target')],
    });
  }

  return {
    sourceDatabaseUrl,
    targetDatabaseUrl,
    dumpPath,
    steps,
  };
}

export async function runStandaloneToServerMigration(
  plan: StandaloneToServerMigrationPlan,
  executor: StandaloneToServerMigrationExecutor = createNodeStandaloneToServerMigrationExecutor(),
): Promise<StandaloneToServerMigrationResult> {
  const executedSteps: StandaloneToServerMigrationStep['type'][] = [];
  for (const step of plan.steps) {
    if (step.type === 'copy_attachments') {
      await executor.copyDirectory(step.sourceDir, step.targetDir);
    } else if (step.type === 'rsync_attachments') {
      await executor.runCommand(step.command, step.args);
    } else {
      await executor.runCommand(step.command, step.args);
    }
    executedSteps.push(step.type);
  }
  return {
    status: 'succeeded',
    executedSteps,
  };
}

export function createNodeStandaloneToServerMigrationExecutor(): StandaloneToServerMigrationExecutor {
  return {
    async runCommand(command, args) {
      await runSpawnedCommand(command, args);
    },
    async copyDirectory(sourceDir, targetDir) {
      await cp(sourceDir, targetDir, { recursive: true, force: true });
    },
  };
}

function runSpawnedCommand(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`}`));
    });
  });
}

function requiredText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}
