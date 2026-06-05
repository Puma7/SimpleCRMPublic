import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');

const readRepoFile = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

describe('server edition AP-12 operator docs', () => {
  const docs = [
    'docs/SETUP_LOCAL.md',
    'docs/SETUP_SERVER.md',
    'docs/MIGRATION_STANDALONE_TO_SERVER.md',
    'docs/BACKUP_AND_RESTORE.md',
    'docs/THREAT_MODEL.md',
  ];

  test('publishes all required AP-12 documents in the documentation index', () => {
    const index = readRepoFile('docs/INDEX.md');

    for (const doc of docs) {
      expect(existsSync(join(repoRoot, doc))).toBe(true);
      expect(index).toContain(`[${doc.replace('docs/', '')}](${doc.replace('docs/', '')})`);
    }
  });

  test('documents local, server, migration, backup, restore, and threat-model flows', () => {
    expect(readRepoFile('docs/SETUP_LOCAL.md')).toEqual(expect.stringContaining('npm run test:server-edition'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('docker compose up -d --build'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('sh ./simplecrm up'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('sh ./simplecrm ps'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('sh ./simplecrm logs api caddy'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('npm run doctor:server'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('JSON access logs in the `caddy_logs` volume'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('docker compose --profile minio up -d minio'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('docker compose --profile monitor up -d monitor'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('docker compose --profile pgadmin up -d pgadmin'));
    expect(readRepoFile('docs/SETUP_SERVER.md')).toEqual(expect.stringContaining('127.0.0.1'));

    const migration = readRepoFile('docs/MIGRATION_STANDALONE_TO_SERVER.md');
    expect(migration).toEqual(expect.stringContaining('npm run migrate:standalone-to-server'));
    expect(migration).toEqual(expect.stringContaining('pg_restore --clean --if-exists --no-owner'));

    const backup = readRepoFile('docs/BACKUP_AND_RESTORE.md');
    expect(backup).toEqual(expect.stringContaining('sh ./simplecrm backup'));
    expect(backup).toEqual(expect.stringContaining('sh ./simplecrm backup-scheduler'));
    expect(backup).toEqual(expect.stringContaining('sh ./simplecrm doctor'));
    expect(backup).toEqual(expect.stringContaining('sh ./simplecrm restore'));
    expect(backup).toEqual(expect.stringContaining('sh ./simplecrm restore-drill'));
    expect(backup).toEqual(expect.stringContaining('docker compose --profile backup run --rm backup'));
    expect(backup).toEqual(expect.stringContaining('docker compose --profile restore-drill run --rm restore-drill'));
    expect(backup).toEqual(expect.stringContaining('7 daily + 4 weekly + 12 monthly'));
    expect(backup).toEqual(expect.stringContaining('BACKUP_RETENTION_DAILY'));
    expect(backup).toEqual(expect.stringContaining('BACKUP_RETENTION_WEEKLY'));
    expect(backup).toEqual(expect.stringContaining('BACKUP_RETENTION_MONTHLY'));

    const threatModel = readRepoFile('docs/THREAT_MODEL.md');
    expect(threatModel).toEqual(expect.stringContaining('Invalid `Authorization` headers must not fall back'));
    expect(threatModel).toEqual(expect.stringContaining('forced PostgreSQL RLS'));
  });

  test('documents the required Docker environment contract', () => {
    const envExample = readRepoFile('docker/.env.example');
    const gitignore = readRepoFile('.gitignore');

    expect(envExample).toEqual(expect.stringContaining("require('crypto').randomBytes(32).toString('base64')"));
    expect(envExample).toEqual(expect.stringContaining('PG_PASSWORD='));
    expect(envExample).toEqual(expect.stringContaining('MASTER_KEY='));
    expect(envExample).toEqual(expect.stringContaining('ACCESS_TOKEN_SECRET='));
    expect(envExample).toEqual(expect.stringContaining('PUBLIC_BASE_URL='));
    expect(envExample).toEqual(expect.stringContaining('BACKUP_RETENTION_DAILY=7'));
    expect(envExample).toEqual(expect.stringContaining('BACKUP_RETENTION_WEEKLY=4'));
    expect(envExample).toEqual(expect.stringContaining('BACKUP_RETENTION_MONTHLY=12'));
    expect(envExample).toEqual(expect.stringContaining('MINIO_ROOT_PASSWORD=CHANGE_ME_minio_root_password'));
    expect(envExample).toEqual(expect.stringContaining('UPTIME_KUMA_BIND=127.0.0.1'));
    expect(envExample).toEqual(expect.stringContaining('PGADMIN_DEFAULT_PASSWORD=CHANGE_ME_pgadmin_password'));
    expect(envExample).toEqual(expect.stringContaining('MASTER_KEY must decode to exactly 32 bytes'));
    expect(envExample).toEqual(expect.stringContaining('ACCESS_TOKEN_SECRET must decode to at least 32 bytes'));
    expect(gitignore).toEqual(expect.stringContaining('!docker/.env.example'));
  });

  test('keeps AP-12 server documentation files trackable despite the markdown ignore rule', () => {
    const gitignore = readRepoFile('.gitignore');

    for (const doc of docs) {
      expect(gitignore).toEqual(expect.stringContaining(`!${doc}`));
    }
  });

  test('documents generation-based Docker backup retention', () => {
    const compose = readRepoFile('docker/docker-compose.yml');
    const backup = readRepoFile('docker/backup.sh');
    const retention = readRepoFile('docker/backup-retention.sh');

    expect(compose).toEqual(expect.stringContaining('./backup-retention.sh:/app/backup-retention.sh:ro'));
    expect(compose).toEqual(expect.stringContaining('BACKUP_RETENTION_DAILY: ${BACKUP_RETENTION_DAILY:-7}'));
    expect(compose).toEqual(expect.stringContaining('BACKUP_RETENTION_WEEKLY: ${BACKUP_RETENTION_WEEKLY:-4}'));
    expect(compose).toEqual(expect.stringContaining('BACKUP_RETENTION_MONTHLY: ${BACKUP_RETENTION_MONTHLY:-12}'));
    expect(backup).toEqual(expect.stringContaining('. "$SCRIPT_DIR/backup-retention.sh"'));
    expect(backup).toEqual(expect.stringContaining('prune_backup_retention "$BACKUP_DIR"'));
    expect(retention).toEqual(expect.stringContaining('select_retained_backup_stamps'));
    expect(retention).toEqual(expect.stringContaining('daily_count < daily'));
    expect(retention).toEqual(expect.stringContaining('weekly_count < weekly'));
    expect(retention).toEqual(expect.stringContaining('monthly_count < monthly'));
  });

  test('documents optional Docker profiles without adding them to the standard stack', () => {
    const compose = readRepoFile('docker/docker-compose.yml');
    const setupServer = readRepoFile('docs/SETUP_SERVER.md');

    expect(compose).toEqual(expect.stringContaining('profiles: ["minio"]'));
    expect(compose).toEqual(expect.stringContaining('profiles: ["monitor"]'));
    expect(compose).toEqual(expect.stringContaining('profiles: ["pgadmin"]'));
    expect(compose).toEqual(expect.stringContaining('"${MINIO_API_BIND:-127.0.0.1}:${MINIO_API_PORT:-9000}:9000"'));
    expect(compose).toEqual(expect.stringContaining('"${UPTIME_KUMA_BIND:-127.0.0.1}:${UPTIME_KUMA_PORT:-3001}:3001"'));
    expect(compose).toEqual(expect.stringContaining('"${PGADMIN_BIND:-127.0.0.1}:${PGADMIN_PORT:-5050}:80"'));
    expect(setupServer).toEqual(expect.stringContaining('The standard stack intentionally starts only Caddy, API, migrations, and PostgreSQL'));
    expect(setupServer).toEqual(expect.stringContaining('Never expose this publicly'));
  });
});
