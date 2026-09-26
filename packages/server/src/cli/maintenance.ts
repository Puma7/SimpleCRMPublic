/**
 * `simplecrm maintenance`: storage checks and verified space savings
 * (maintenance/storage-maintenance.ts). Runs in the api image with its
 * DATABASE_URL and attachments volume:
 *
 *   node packages/server/dist/cli/maintenance.js [--check-only] [--deep]
 *
 * Exit code 1 when a check found a problem. Nothing is ever deleted.
 */
import { createPostgresDatabase } from '../db/postgres';
import {
  formatStorageMaintenanceReport,
  runStorageMaintenance,
} from '../maintenance/storage-maintenance';

export type MaintenanceCliOptions = Readonly<{ checkOnly: boolean; deep: boolean; help: boolean }>;

export function parseMaintenanceCliArgs(argv: readonly string[]): MaintenanceCliOptions {
  let checkOnly = false;
  let deep = false;
  let help = false;
  for (const arg of argv) {
    if (arg === '--check-only') checkOnly = true;
    else if (arg === '--deep') deep = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else throw new Error(`unknown maintenance flag: ${arg}`);
  }
  return { checkOnly, deep, help };
}

const USAGE = `usage: maintenance [--check-only] [--deep]
  Checks attachment files and stored mail originals against the database and
  runs the verified space savings (compress originals, take attachment copies
  out of originals, link identical attachments). Nothing is deleted.
  --check-only  only check
  --deep        read every attachment and every original completely
`;

export async function runMaintenanceCli(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let options: MaintenanceCliOptions;
  try {
    options = parseMaintenanceCliArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is required\n');
    return 2;
  }
  const db = await createPostgresDatabase({ databaseUrl, maxConnections: 2 });
  try {
    const report = await runStorageMaintenance({
      db,
      attachmentsRoot: env.ATTACHMENTS_DIR?.trim() || '/app/data/attachments',
      checkOnly: options.checkOnly,
      deep: options.deep,
    });
    process.stdout.write(formatStorageMaintenanceReport(report));
    return report.ok ? 0 : 1;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  runMaintenanceCli(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`maintenance failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
