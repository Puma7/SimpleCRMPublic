import { existsSync, readFileSync, readdirSync } from 'fs';
import http from 'http';
import { join } from 'path';

import type { Kysely } from 'kysely';

import {
  createFastifyServer,
  createAccessToken,
  createSmokeServer,
  createInMemoryServerEventBus,
  CI_SMOKE_ACCESS_TOKEN_SECRET,
  CI_SMOKE_MASTER_KEY,
  startServer,
  type AccessTokenSigner,
  type ActivityLogRecord,
  type AiProfileRecord,
  type AiPromptRecord,
  type AutomationApiKeyRecord,
  type AuthUserRecord,
  type CalendarEventRecord,
  type ConversationLockRecord,
  type CustomerCustomFieldRecord,
  type CustomerCustomFieldValueRecord,
  type CustomerRecord,
  type DealRecord,
  type EmailAccountRecord,
  type EmailAccountSignatureRecord,
  type EmailAttachmentRecord,
  type EmailCannedResponseRecord,
  type EmailCategoryRecord,
  type EmailFolderRecord,
  type EmailInternalNoteRecord,
  type EmailMessageCategoryRecord,
  type EmailMessageRecord,
  type EmailMessageTagRecord,
  type EmailReadReceiptRecord,
  type EmailRemoteContentAllowlistRecord,
  type EmailTeamMemberRecord,
  type EmailThreadAliasRecord,
  type EmailThreadEdgeRecord,
  type EmailThreadRecord,
  type EmailTrackingApiPort,
  type JtlReferenceRecord,
  type PgpIdentityRecord,
  type PgpPeerKeyRecord,
  type ProductRecord,
  type SavedViewRecord,
  type ServerEvent,
  type ServerApiPorts,
  type ServerDatabase,
  type SpamDecisionRecord,
  type SpamFeatureStatRecord,
  type SpamLearningEventRecord,
  type SpamListEntryRecord,
  type TaskRecord,
  type WorkflowDelayedJobRecord,
  type WorkflowForwardDedupRecord,
  type WorkflowKnowledgeBaseRecord,
  type WorkflowKnowledgeChunkRecord,
  type WorkflowMessageAppliedRecord,
  type WorkflowRecord,
  type WorkflowRunRecord,
  type WorkflowRunStepRecord,
  type WorkflowVersionRecord,
} from '../../packages/server/src';

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  });
}

describe('server edition repository boundaries', () => {
  function expectNoElectronRuntimeImports(root: string): void {
    const files = collectFiles(root).filter((file) => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/from ['"]electron['"]/);
      expect(source).not.toMatch(/require\(['"]electron['"]\)/);
      expect(source).not.toMatch(/from ['"]keytar['"]/);
      expect(source).not.toMatch(/require\(['"]keytar['"]\)/);
    }
  }

  test('packages/core does not import Electron-only runtime modules', () => {
    expectNoElectronRuntimeImports(join(__dirname, '..', '..', 'packages', 'core', 'src'));
  });

  test('packages/server does not import Electron-only runtime modules', () => {
    expectNoElectronRuntimeImports(join(__dirname, '..', '..', 'packages', 'server', 'src'));
  });

  test('CI installs the pinned pnpm release through the stable setup action', () => {
    const ci = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');

    expect(ci).toContain('uses: pnpm/action-setup@v5');
    expect(ci).not.toContain('uses: pnpm/action-setup@v6');
  });

  test('pnpm permits the embedded PostgreSQL build used by Linux CI', () => {
    const workspace = readFileSync(join(__dirname, '..', '..', 'pnpm-workspace.yaml'), 'utf8');

    expect(workspace).toContain('  "@embedded-postgres/linux-x64": true');
  });

  test.each(['api.Dockerfile', 'web.Dockerfile'])(
    '%s keeps pnpm lifecycle settings consistent after install',
    (dockerfileName) => {
      const dockerfile = readFileSync(join(__dirname, '..', '..', 'docker', dockerfileName), 'utf8');
      const configIndex = dockerfile.indexOf('ENV PNPM_CONFIG_NODE_LINKER=hoisted');
      const installIndex = dockerfile.indexOf('RUN pnpm install');

      expect(configIndex).toBeGreaterThan(-1);
      expect(dockerfile).toContain('PNPM_CONFIG_IGNORE_SCRIPTS=true');
      expect(configIndex).toBeLessThan(installIndex);
    },
  );

  test('generated MSSQL service JavaScript stays out of the source tree', () => {
    const repositoryRoot = join(__dirname, '..', '..');
    const gitignore = readFileSync(join(repositoryRoot, '.gitignore'), 'utf8');

    expect(existsSync(join(repositoryRoot, 'electron', 'mssql-service.js'))).toBe(false);
    expect(existsSync(join(repositoryRoot, 'electron', 'main.js'))).toBe(true);
    expect(gitignore).toContain('/electron/mssql-service.js');
  });

  test('docker compose foundation uses PostgreSQL 18', () => {
    const compose = readFileSync(join(__dirname, '..', '..', 'docker', 'docker-compose.yml'), 'utf8');
    const ci = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(compose).toContain('postgres:18-alpine');
    expect(compose).toContain('postgres_data:/var/lib/postgresql');
    // Caddy now builds the web image (static SPA + reverse proxy) from web.Dockerfile.
    expect(compose).toContain('dockerfile: docker/web.Dockerfile');
    expect(compose).toContain('image: simplecrm/web:${VERSION:-dev}');
    expect(compose).toContain('"${CADDY_HTTP_PORT:-80}:80"');
    expect(compose).toContain('"${CADDY_HTTPS_PORT:-443}:443"');
    expect(compose).toContain('PUBLIC_DOMAIN: ${PUBLIC_DOMAIN:-localhost}');
    expect(compose).toContain('start_period: 60s');
    expect(compose).toContain('simplecrm/api');
    expect(compose).toContain('required: false');
    expect(compose).toContain('command: ["node", "packages/server/dist/cli/migrate.js"]');
    expect(compose).toContain('DATABASE_URL: postgres://simplecrm_app:${PG_PASSWORD}@postgres:5432/simplecrm');
    expect(compose).toContain('POSTGRES_USER: simplecrm_admin');
    expect(compose).toContain('POSTGRES_PASSWORD: ${PG_ADMIN_PASSWORD}');
    expect(compose).toContain('PG_APP_USER: simplecrm_app');
    expect(compose).toContain('PG_APP_PASSWORD: ${PG_PASSWORD}');
    expect(compose).toContain('./postgres-init:/docker-entrypoint-initdb.d:ro');
    expect(compose).toContain('pg_isready -U simplecrm_app -d simplecrm');
    expect(compose).toContain('ACCESS_TOKEN_SECRET: ${ACCESS_TOKEN_SECRET}');
    expect(compose).toContain('CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-}');
    expect(compose).toContain('AUTH_INVITE_FROM: ${AUTH_INVITE_FROM:-}');
    expect(compose).toContain('AUTH_INVITE_SMTP_HOST: ${AUTH_INVITE_SMTP_HOST:-}');
    expect(compose).toContain('AUTH_INVITE_SMTP_PORT: ${AUTH_INVITE_SMTP_PORT:-587}');
    expect(compose).toContain('AUTH_INVITE_SMTP_TLS: ${AUTH_INVITE_SMTP_TLS:-true}');
    expect(compose).toContain('AUTH_INVITE_SMTP_USER: ${AUTH_INVITE_SMTP_USER:-}');
    expect(compose).toContain('AUTH_INVITE_SMTP_PASSWORD: ${AUTH_INVITE_SMTP_PASSWORD:-}');
    expect(compose).toContain('AUTH_INVITE_SMTP_TIMEOUT_MS: ${AUTH_INVITE_SMTP_TIMEOUT_MS:-90000}');
    expect(compose).toContain('ATTACHMENTS_DIR: ${ATTACHMENTS_DIR:-/app/data/attachments}');
    expect(compose).toContain('AUDIT_ARCHIVE_DIR: ${AUDIT_ARCHIVE_DIR:-/app/data/audit-archive}');
    expect(compose).toContain('JOB_WORKER_ENABLED: ${JOB_WORKER_ENABLED:-false}');
    expect(compose).toContain('JOB_WORKER_AI_CONCURRENCY: ${JOB_WORKER_AI_CONCURRENCY:-5}');
    expect(compose).toContain('JOB_WEBHOOK_ALLOWLIST: ${JOB_WEBHOOK_ALLOWLIST:-}');
    expect(compose).toContain('command: ["sh", "/app/backup.sh"]');
    expect(compose).toContain('./backup.sh:/app/backup.sh:ro');
    expect(compose).toContain('profiles: ["backup-scheduler"]');
    expect(compose).toContain('command: ["sh", "/app/backup-scheduler.sh"]');
    expect(compose).toContain('BACKUP_INTERVAL_SECONDS: ${BACKUP_INTERVAL_SECONDS:-86400}');
    expect(compose).toContain('BACKUP_RUN_ON_START: ${BACKUP_RUN_ON_START:-true}');
    expect(compose).toContain('BACKUP_RETENTION_DAILY: ${BACKUP_RETENTION_DAILY:-7}');
    expect(compose).toContain('BACKUP_RETENTION_WEEKLY: ${BACKUP_RETENTION_WEEKLY:-4}');
    expect(compose).toContain('BACKUP_RETENTION_MONTHLY: ${BACKUP_RETENTION_MONTHLY:-12}');
    expect(compose).toContain('./backup-retention.sh:/app/backup-retention.sh:ro');
    expect(compose).toContain('DATABASE_URL: postgres://simplecrm_admin:${PG_ADMIN_PASSWORD}@postgres:5432/simplecrm');
    expect(compose).toContain('PG_RESTORE_ROLE: simplecrm_app');
    expect(compose).toContain('audit_archives:/app/data/audit-archive');
    expect(compose).toContain('SERVER_LOG_FILE: ${SERVER_LOG_FILE:-/app/data/logs/server-log.jsonl}');
    expect(compose).toContain('server_logs:/app/data/logs');
    expect(compose).toContain('caddy_logs:/var/log');
    expect(compose).toContain('audit_archives:/data/audit-archive:ro');
    expect(compose).toContain('profiles: ["restore"]');
    expect(compose).toContain('./restore.sh:/app/restore.sh:ro');
    expect(compose).toContain('RESTORE_DUMP_PATH');
    expect(compose).toContain('RESTORE_AUDIT_ARCHIVE_PATH');
    expect(compose).toContain('profiles: ["doctor"]');
    expect(compose).toContain('command: ["sh", "/app/doctor.sh"]');
    expect(compose).toContain('DOCTOR_REQUIRE_BACKUP: ${DOCTOR_REQUIRE_BACKUP:-false}');
    expect(compose).toContain('profiles: ["restore-drill"]');
    expect(compose).toContain('./restore-drill.sh:/app/restore-drill.sh:ro');
    expect(compose).toContain('RESTORE_DRILL_DUMP_PATH');
    expect(compose).toContain('RESTORE_DRILL_AUDIT_ARCHIVE_PATH');
    expect(compose).toContain('image: minio/minio:latest');
    expect(compose).toContain('profiles: ["minio"]');
    expect(compose).toContain('command: ["server", "/data", "--console-address", ":9001"]');
    expect(compose).toContain('"${MINIO_API_BIND:-127.0.0.1}:${MINIO_API_PORT:-9000}:9000"');
    expect(compose).toContain('"${MINIO_CONSOLE_BIND:-127.0.0.1}:${MINIO_CONSOLE_PORT:-9001}:9001"');
    expect(compose).toContain('image: louislam/uptime-kuma:1');
    expect(compose).toContain('profiles: ["monitor"]');
    expect(compose).toContain('"${UPTIME_KUMA_BIND:-127.0.0.1}:${UPTIME_KUMA_PORT:-3001}:3001"');
    expect(compose).toContain('image: dpage/pgadmin4:latest');
    expect(compose).toContain('profiles: ["pgadmin"]');
    expect(compose).toContain('"${PGADMIN_BIND:-127.0.0.1}:${PGADMIN_PORT:-5050}:80"');
    expect(compose).toContain('PGADMIN_CONFIG_ENHANCED_COOKIE_PROTECTION: "True"');
    expect(compose).toContain('audit-archive-$$stamp.tar');
    expect(compose).toContain('attachments:/data/attachments:ro');
    expect(compose).toContain('backups:');
    expect(compose).toContain('caddy_logs:');
    expect(compose).toContain('server_logs:');
    expect(compose).toContain('minio_data:');
    expect(compose).toContain('uptime_kuma_data:');
    expect(compose).toContain('pgadmin_data:');
    expect(ci).toContain('PUBLIC_DOMAIN: localhost');
    expect(ci).toContain('CADDY_HTTPS_PORT: "8443"');
    expect(ci).toContain('PG_ADMIN_PASSWORD: ci-smoke-admin-password');
    expect(ci).toContain('Generate smoke secrets');
    expect(ci).toContain("openssl rand -base64 32");
    expect(ci).not.toContain('MASTER_KEY: MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=');
    expect(ci).not.toContain('ACCESS_TOKEN_SECRET: YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNERUY=');
    expect(ci).toContain('up -d --build postgres migrate api caddy');
    expect(ci).toContain('https://localhost:${CADDY_HTTPS_PORT}/health');
    expect(ci).toContain('--profile backup run --rm backup');
    expect(ci).toContain('--profile doctor run --rm doctor');
    expect(ci).toContain('--profile restore-drill run --rm restore-drill');
  });

  test('docker maintenance scripts cover backup, restore, and doctor checks', () => {
    const dockerRoot = join(__dirname, '..', '..', 'docker');
    const backup = readFileSync(join(dockerRoot, 'backup.sh'), 'utf8');
    const backupRetention = readFileSync(join(dockerRoot, 'backup-retention.sh'), 'utf8');
    const backupScheduler = readFileSync(join(dockerRoot, 'backup-scheduler.sh'), 'utf8');
    const simplecrm = readFileSync(join(dockerRoot, 'simplecrm'), 'utf8');
    const restore = readFileSync(join(dockerRoot, 'restore.sh'), 'utf8');
    const restoreCompose = readFileSync(join(dockerRoot, 'restore-compose.sh'), 'utf8');
    const restoreDrill = readFileSync(join(dockerRoot, 'restore-drill.sh'), 'utf8');
    const postgresInit = readFileSync(join(dockerRoot, 'postgres-init', '001-create-app-role.sh'), 'utf8');
    const doctor = readFileSync(join(dockerRoot, 'doctor.sh'), 'utf8');
    const caddyfile = readFileSync(join(dockerRoot, 'Caddyfile'), 'utf8');
    const webDockerfile = readFileSync(join(dockerRoot, 'web.Dockerfile'), 'utf8');
    const envExample = readFileSync(join(dockerRoot, '.env.example'), 'utf8');

    expect(backup).toContain('pg_dump -Fc "$DATABASE_URL"');
    expect(backup).toContain('CHECKSUM_MANIFEST="backup-$STAMP.sha256"');
    expect(backup).toContain('sha256sum "$DB_DUMP" > "$CHECKSUM_MANIFEST"');
    expect(backup).toContain('sha256sum "$ATTACHMENTS_ARCHIVE" >> "$CHECKSUM_MANIFEST"');
    expect(backup).toContain('sha256sum "$AUDIT_ARCHIVE" >> "$CHECKSUM_MANIFEST"');
    expect(backup).toContain('audit-archive-$STAMP.tar');
    expect(backup).toContain('. "$SCRIPT_DIR/backup-retention.sh"');
    expect(backup).toContain('prune_backup_retention "$BACKUP_DIR"');
    expect(backupRetention).toContain('BACKUP_RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-7}"');
    expect(backupRetention).toContain('BACKUP_RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY:-4}"');
    expect(backupRetention).toContain('BACKUP_RETENTION_MONTHLY="${BACKUP_RETENTION_MONTHLY:-12}"');
    expect(backupRetention).toContain('select_retained_backup_stamps()');
    expect(backupRetention).toContain('daily_count < daily');
    expect(backupRetention).toContain('weekly_count < weekly');
    expect(backupRetention).toContain('monthly_count < monthly');
    expect(backupRetention).toContain('remove_orphan_backup_file');
    expect(backupScheduler).toContain('BACKUP_INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"');
    expect(backupScheduler).toContain('BACKUP_RUN_ON_START="${BACKUP_RUN_ON_START:-true}"');
    expect(backupScheduler).toContain('sh /app/backup.sh');
    expect(backupScheduler).toContain('sleep "$BACKUP_INTERVAL_SECONDS"');
    expect(simplecrm).toContain('usage: simplecrm <command> [args]');
    expect(simplecrm).toContain('compose up -d --build');
    expect(simplecrm).toContain('compose --profile backup run --rm backup');
    expect(simplecrm).toContain('compose --profile backup-scheduler up -d backup-scheduler');
    expect(simplecrm).toContain('compose --profile doctor run --rm doctor');
    expect(simplecrm).toContain('sh "$SCRIPT_DIR/restore-compose.sh" "$@"');
    expect(simplecrm).toContain('compose --profile restore-drill run --rm restore-drill');
    expect(restore).toContain('verify_backup_file "$DUMP_PATH" "$CHECKSUM_MANIFEST"');
    expect(restore).toContain('verify_backup_file "$AUDIT_ARCHIVE" "$CHECKSUM_MANIFEST"');
    expect(restore).toContain('checksum mismatch for $file_name');
    expect(restore).toContain('PG_RESTORE_ROLE="${PG_RESTORE_ROLE:-}"');
    expect(restore).toContain('pg_restore --role="$PG_RESTORE_ROLE" --clean --if-exists --no-owner');
    expect(restore).toContain('validate_tar_archive "$ATTACHMENTS_ARCHIVE"');
    expect(restore).toContain('validate_tar_archive "$AUDIT_ARCHIVE"');
    expect(restore).toContain('if ($1 !~ /^[-d]/)');
    expect(restore.indexOf('validate_tar_archive "$ATTACHMENTS_ARCHIVE"')).toBeLessThan(
      restore.indexOf('pg_restore --clean --if-exists --no-owner'),
    );
    expect(restore).toContain('unsafe tar entry');
    expect(restore).toContain('tar -C "$ATTACHMENTS_DIR" --no-same-owner --no-same-permissions -xf "$ATTACHMENTS_ARCHIVE"');
    expect(restore).toContain('tar -C "$AUDIT_ARCHIVE_DIR" --no-same-owner --no-same-permissions -xf "$AUDIT_ARCHIVE"');
    expect(restoreCompose).toContain('compose stop caddy api');
    expect(restoreCompose).toContain('compose --profile restore run --rm restore');
    expect(restoreCompose).toContain('compose run --rm migrate');
    expect(restoreCompose).toContain('compose up -d api caddy');
    expect(restoreCompose).toContain('wait_for_api_health');
    expect(restoreCompose).toContain('RESTORE_CADDY_HEALTH_URL');
    expect(restoreDrill).toContain('verify_backup_file "$DUMP_PATH" "$CHECKSUM_MANIFEST"');
    expect(restoreDrill).toContain('verify_backup_file "$AUDIT_ARCHIVE" "$CHECKSUM_MANIFEST"');
    expect(restoreDrill).toContain('tar -tf "$AUDIT_ARCHIVE"');
    expect(restoreDrill).toContain('CREATE DATABASE \\"$DRILL_DB_SQL\\" OWNER \\"$PG_APP_USER_SQL\\"');
    expect(restoreDrill).toContain('pg_restore --role="$PG_RESTORE_ROLE" --no-owner --dbname "$DRILL_DATABASE_URL" "$DUMP_PATH"');
    expect(restoreDrill).toContain('DROP DATABASE IF EXISTS');
    expect(restoreDrill).toContain('SELECT count(*) FROM workspaces');
    expect(postgresInit).toContain('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE');
    expect(postgresInit).toContain('ALTER DATABASE %I OWNER TO %I');
    expect(postgresInit).toContain('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    expect(doctor).toContain('pg_isready -d "$DATABASE_URL"');
    expect(doctor).toContain("select 'applied_migrations=' || count(*) from simplecrm_schema_migrations");
    expect(doctor).toContain("select 'latest_migration=' || coalesce(max(id), 'none') from simplecrm_schema_migrations");
    expect(doctor).toContain('from job_queue');
    expect(doctor).toContain('queue_lag_seconds=');
    expect(doctor).toContain("from conversation_locks where last_heartbeat_at < now() - interval '2 minutes'");
    expect(doctor).toContain('DOCTOR_REQUIRE_BACKUP="${DOCTOR_REQUIRE_BACKUP:-false}"');
    expect(doctor).toContain('latest_dump="$(ls -1t "$BACKUP_DIR"/db-*.dump');
    expect(doctor).toContain('sha256sum -c "$manifest"');
    expect(doctor).toContain('backup_checksum=ok');
    expect(caddyfile).toContain('{$PUBLIC_DOMAIN:localhost}');
    expect(caddyfile).toContain('reverse_proxy api:3000');
    expect(caddyfile).toContain('header_up -x-simplecrm-user-id');
    expect(caddyfile).toContain('header_up -x-simplecrm-workspace-id');
    expect(caddyfile).toContain('header_up -x-simplecrm-role');
    expect(caddyfile).toContain('Content-Security-Policy');
    expect(caddyfile).toContain("frame-ancestors 'none'");
    expect(caddyfile).toContain("connect-src 'self' https://challenges.cloudflare.com");
    expect(caddyfile).toContain('X-Content-Type-Options nosniff');
    expect(caddyfile).toContain('encode gzip zstd');
    expect(caddyfile).toContain('output file /var/log/access.log');
    expect(caddyfile).toContain('format json');
    // Static SPA serving with client-side routing fallback, backend paths proxied.
    expect(caddyfile).toContain('root * /srv/dist');
    expect(caddyfile).toContain('try_files {path} /index.html');
    expect(caddyfile).toContain('file_server');
    expect(caddyfile).toContain('path /api/* /t/* /health /health/* /openapi.json');
    // web.Dockerfile builds the web-only bundle and bakes it into a caddy image.
    expect(webDockerfile).toContain('FROM caddy:2');
    expect(webDockerfile).toContain('SIMPLECRM_WEB_ONLY=1 npx vite build');
    expect(webDockerfile).toContain('COPY --from=build /app/dist /srv/dist');
    expect(envExample).toContain('PUBLIC_DOMAIN=localhost');
    expect(envExample).toContain('CADDY_HTTP_PORT=80');
    expect(envExample).toContain('CADDY_HTTPS_PORT=443');
    expect(envExample).toContain('CORS_ALLOWED_ORIGINS=');
    expect(envExample).toContain('PG_ADMIN_PASSWORD=CHANGE_ME_postgres_admin_password');
    expect(envExample).toContain('PG_PASSWORD=CHANGE_ME_postgres_app_password');
    expect(envExample).toContain('BACKUP_RETENTION_DAILY=7');
    expect(envExample).toContain('BACKUP_RETENTION_WEEKLY=4');
    expect(envExample).toContain('BACKUP_RETENTION_MONTHLY=12');
    expect(envExample).toContain('BACKUP_INTERVAL_SECONDS=86400');
    expect(envExample).toContain('BACKUP_RUN_ON_START=true');
    expect(envExample).toContain('RESTORE_DUMP_PATH=');
    expect(envExample).toContain('RESTORE_CADDY_HEALTH_URL=');
    expect(envExample).toContain('DOCTOR_REQUIRE_BACKUP=false');
    expect(envExample).toContain('AUTH_INVITE_FROM=');
    expect(envExample).toContain('AUTH_INVITE_SMTP_HOST=');
    expect(envExample).toContain('AUTH_INVITE_SMTP_PORT=587');
    expect(envExample).toContain('AUTH_INVITE_SMTP_TLS=true');
    expect(envExample).toContain('AUTH_INVITE_SMTP_USER=');
    expect(envExample).toContain('AUTH_INVITE_SMTP_PASSWORD=');
    expect(envExample).toContain('AUTH_INVITE_SMTP_TIMEOUT_MS=90000');
    expect(envExample).toContain('ATTACHMENTS_DIR=/app/data/attachments');
    expect(envExample).toContain('AUDIT_ARCHIVE_DIR=/app/data/audit-archive');
    expect(envExample).toContain('RESTORE_DRILL_DB_NAME=');
    expect(envExample).toContain('RESTORE_DRILL_AUDIT_ARCHIVE_PATH=');
    expect(envExample).toContain('MINIO_ROOT_PASSWORD=CHANGE_ME_minio_root_password');
    expect(envExample).toContain('MINIO_API_BIND=127.0.0.1');
    expect(envExample).toContain('MINIO_CONSOLE_PORT=9001');
    expect(envExample).toContain('UPTIME_KUMA_BIND=127.0.0.1');
    expect(envExample).toContain('UPTIME_KUMA_PORT=3001');
    expect(envExample).toContain('PGADMIN_DEFAULT_PASSWORD=CHANGE_ME_pgadmin_password');
    expect(envExample).toContain('PGADMIN_BIND=127.0.0.1');
    expect(envExample).toContain('PGADMIN_PORT=5050');
    expect(envExample).toContain('JOB_WORKER_ENABLED=false');
    expect(envExample).toContain('JOB_WORKER_MIGRATE_ON_START=false');
    expect(envExample).toContain('JOB_WEBHOOK_ALLOWLIST=');
  });

  test('api Docker image keeps runtime node dependencies for server CLI commands', () => {
    const dockerfile = readFileSync(join(__dirname, '..', '..', 'docker', 'api.Dockerfile'), 'utf8');
    expect(dockerfile).toContain('pnpm install --frozen-lockfile --node-linker=hoisted --ignore-scripts');
    // --ignore-scripts is load-bearing: without it prune re-runs the desktop-only
    // postinstall (electron install), which fails in the prod image. Regression guard.
    expect(dockerfile).toContain('pnpm prune --prod --ignore-scripts');
    expect(dockerfile).toContain('COPY --from=build /app/node_modules ./node_modules');
    expect(dockerfile).toContain('CMD ["node", "packages/server/dist/server.js"]');
  });

  test('server package declares Fastify 5 and Pino as direct server dependencies', () => {
    const packageJson = JSON.parse(readFileSync(join(__dirname, '..', '..', 'packages', 'server', 'package.json'), 'utf8'));
    expect(packageJson.dependencies.fastify).toMatch(/^\^5\./);
    expect(packageJson.dependencies['@fastify/websocket']).toMatch(/^\^11\./);
    expect(packageJson.dependencies['graphile-worker']).toMatch(/^\^0\.17\./);
    expect(packageJson.dependencies.kysely).toBeDefined();
    expect(packageJson.dependencies['libsodium-wrappers-sumo']).toBeDefined();
    expect(packageJson.dependencies.pino).toMatch(/^\^10\./);
  });

  test('server TypeScript build references core so clean builds are ordered', () => {
    const tsconfig = JSON.parse(readFileSync(join(__dirname, '..', '..', 'packages', 'server', 'tsconfig.json'), 'utf8'));

    expect(tsconfig.references).toContainEqual({ path: '../core' });
  });

  test('Electron commands select the Electron native ABI and restore Node afterwards', () => {
    const packageJson = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts.postinstall).toContain('native-runtime-manager.mjs initialize');
    for (const script of ['electron:dev', 'electron:dev:main', 'electron:build', 'electron:publish', 'electron:start', 'electron:dev:debug', 'electron:test:devtools', 'test:e2e']) {
      expect(scripts[script]).toBe(`node scripts/run-with-electron-native.mjs ${script}:runtime`);
      expect(scripts[`${script}:runtime`]).toBeTruthy();
    }
  });

  test('production update drains old Graphile workers before the new API starts', () => {
    const updateScript = readFileSync(join(__dirname, '..', '..', 'docker', 'update.sh'), 'utf8');
    const stopIndex = updateScript.indexOf('compose stop api');
    const startIndex = updateScript.indexOf('compose up -d api caddy');

    expect(stopIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeGreaterThan(stopIndex);
  });

  test('root scripts expose server migration, doctor, and live RLS checks', () => {
    const packageJson = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    expect(packageJson.scripts['test:server-edition']).toContain('server-edition-foundation.test.ts');
    expect(packageJson.scripts['doctor:server']).toBe('node packages/server/dist/cli/doctor.js');
    expect(packageJson.scripts['migrate:standalone-to-server'])
      .toBe('node packages/desktop/dist/cli/migrate-to-server.js');
    expect(packageJson.scripts['migrate:sqlite']).toBe('node packages/server/dist/cli/migrate-from-sqlite.js');
    expect(packageJson.scripts['migrate:server']).toBe('node packages/server/dist/cli/migrate.js');
    expect(packageJson.scripts['test:server-rls']).toBe('node packages/server/dist/cli/rls-check.js');
  });

  test('fastify adapter routes health, auth, and lock APIs with signed bearer principals', async () => {
    const signer: AccessTokenSigner = {
      keyId: 'test',
      secret: Buffer.alloc(32, 9),
    };
    const accessToken = createAccessToken({
      signer,
      issuedAt: new Date(),
      expiresInSeconds: 60,
      principal: {
        userId: 'user-a',
        workspaceId: 'workspace-a',
        role: 'user',
      },
    });
    const customerListCalls: unknown[] = [];
    const productListCalls: unknown[] = [];
    const dealListCalls: unknown[] = [];
    const taskListCalls: unknown[] = [];
    const activityLogCalls: unknown[] = [];
    const activityLogGetCalls: unknown[] = [];
    const calendarEventCalls: unknown[] = [];
    const customFieldCalls: unknown[] = [];
    const customFieldValueCalls: unknown[] = [];
    const savedViewCalls: unknown[] = [];
    const jtlFirmenCalls: unknown[] = [];
    const jtlWarenlagerCalls: unknown[] = [];
    const jtlZahlungsartenCalls: unknown[] = [];
    const jtlVersandartenCalls: unknown[] = [];
    const emailAccountListCalls: unknown[] = [];
    const emailAccountSignatureListCalls: unknown[] = [];
    const emailComposeAttachmentUploadCalls: unknown[] = [];
    const emailAttachmentContentCalls: unknown[] = [];
    const emailAttachmentListCalls: unknown[] = [];
    const emailCannedResponseListCalls: unknown[] = [];
    const emailCategoryListCalls: unknown[] = [];
    const emailFolderListCalls: unknown[] = [];
    const emailInternalNoteListCalls: unknown[] = [];
    const emailMessageCategoryListCalls: unknown[] = [];
    const emailMessageListCalls: unknown[] = [];
    const emailMessageGetCalls: unknown[] = [];
    const emailMessageTagListCalls: unknown[] = [];
    const emailMessageTagDeleteCalls: unknown[] = [];
    const emailReadReceiptListCalls: unknown[] = [];
    const emailRemoteContentAllowlistCalls: unknown[] = [];
    const emailTeamMemberListCalls: unknown[] = [];
    const emailThreadAliasListCalls: unknown[] = [];
    const emailThreadEdgeListCalls: unknown[] = [];
    const emailThreadListCalls: unknown[] = [];
    const aiProfileListCalls: unknown[] = [];
    const aiPromptListCalls: unknown[] = [];
    const automationApiKeyListCalls: unknown[] = [];
    const pgpIdentityListCalls: unknown[] = [];
    const pgpPeerKeyListCalls: unknown[] = [];
    const spamListEntryCalls: unknown[] = [];
    const spamLearningEventCalls: unknown[] = [];
    const spamDecisionCalls: unknown[] = [];
    const spamFeatureStatCalls: unknown[] = [];
    const workflowListCalls: unknown[] = [];
    const workflowDelayedJobCalls: unknown[] = [];
    const workflowForwardDedupCalls: unknown[] = [];
    const workflowKnowledgeBaseCalls: unknown[] = [];
    const workflowKnowledgeChunkCalls: unknown[] = [];
    const workflowMessageAppliedCalls: unknown[] = [];
    const workflowRunCalls: unknown[] = [];
    const workflowRunStepCalls: unknown[] = [];
    const workflowVersionCalls: unknown[] = [];
    const app = createFastifyServer({
      ports: {
        ...makeServerApiPorts(),
        aiProfiles: {
          async list(input) {
            aiProfileListCalls.push(input);
            return { items: [makeAiProfileRecord(21)], nextCursor: null };
          },
          async get() {
            return makeAiProfileRecord(21);
          },
        },
        aiPrompts: {
          async list(input) {
            aiPromptListCalls.push(input);
            return { items: [makeAiPromptRecord(22)], nextCursor: null };
          },
          async get() {
            return makeAiPromptRecord(22);
          },
        },
        automationApiKeys: {
          async list(input) {
            automationApiKeyListCalls.push(input);
            return {
              items: [makeAutomationApiKeyRecord('55555555-5555-4555-8555-555555555555')],
              nextCursor: null,
            };
          },
          async get() {
            return makeAutomationApiKeyRecord('55555555-5555-4555-8555-555555555555');
          },
        },
        customers: {
          async list(input) {
            customerListCalls.push(input);
            return {
              items: [makeCustomerRecord(7)],
              nextCursor: null,
            };
          },
          async get() {
            return makeCustomerRecord(7);
          },
        },
        products: {
          async list(input) {
            productListCalls.push(input);
            return { items: [makeProductRecord(8)], nextCursor: null };
          },
          async get() {
            return makeProductRecord(8);
          },
        },
        deals: {
          async list(input) {
            dealListCalls.push(input);
            return { items: [makeDealRecord(9)], nextCursor: 9 };
          },
          async get() {
            return makeDealRecord(9);
          },
        },
        tasks: {
          async list(input) {
            taskListCalls.push(input);
            return { items: [makeTaskRecord(10)], nextCursor: null };
          },
          async get() {
            return makeTaskRecord(10);
          },
        },
        activityLog: {
          async list(input) {
            activityLogCalls.push(input);
            return { items: [makeActivityLogRecord(80, input.includeMetadata)], nextCursor: null };
          },
          async get(input) {
            activityLogGetCalls.push(input);
            return makeActivityLogRecord(80, input.includeMetadata);
          },
        },
        calendarEvents: {
          async list(input) {
            calendarEventCalls.push(input);
            return { items: [makeCalendarEventRecord(30)], nextCursor: null };
          },
          async get() {
            return makeCalendarEventRecord(30);
          },
        },
        customerCustomFields: {
          async list(input) {
            customFieldCalls.push(input);
            return { items: [makeCustomerCustomFieldRecord(61)], nextCursor: null };
          },
          async get() {
            return makeCustomerCustomFieldRecord(61);
          },
        },
        customerCustomFieldValues: {
          async list(input) {
            customFieldValueCalls.push(input);
            return { items: [makeCustomerCustomFieldValueRecord(62)], nextCursor: null };
          },
          async get() {
            return makeCustomerCustomFieldValueRecord(62);
          },
        },
        savedViews: {
          async list(input) {
            savedViewCalls.push(input);
            return { items: [makeSavedViewRecord(70)], nextCursor: null };
          },
          async get() {
            return makeSavedViewRecord(70);
          },
        },
        jtlFirmen: {
          async list(input) {
            jtlFirmenCalls.push(input);
            return { items: [makeJtlReferenceRecord(100)], nextCursor: null };
          },
          async get() {
            return makeJtlReferenceRecord(100);
          },
        },
        jtlWarenlager: {
          async list(input) {
            jtlWarenlagerCalls.push(input);
            return { items: [makeJtlReferenceRecord(101)], nextCursor: null };
          },
          async get() {
            return makeJtlReferenceRecord(101);
          },
        },
        jtlZahlungsarten: {
          async list(input) {
            jtlZahlungsartenCalls.push(input);
            return { items: [makeJtlReferenceRecord(102)], nextCursor: null };
          },
          async get() {
            return makeJtlReferenceRecord(102);
          },
        },
        jtlVersandarten: {
          async list(input) {
            jtlVersandartenCalls.push(input);
            return { items: [makeJtlReferenceRecord(103)], nextCursor: null };
          },
          async get() {
            return makeJtlReferenceRecord(103);
          },
        },
        emailAccounts: {
          async list(input) {
            emailAccountListCalls.push(input);
            return { items: [makeEmailAccountRecord(1)] };
          },
          async get() {
            return makeEmailAccountRecord(1);
          },
        },
        emailAttachments: {
          async listForMessage(input) {
            emailAttachmentListCalls.push(input);
            return { items: [makeEmailAttachmentRecord(31)] };
          },
          async get() {
            return makeEmailAttachmentRecord(31);
          },
        },
        emailAttachmentContent: {
          async get(input) {
            emailAttachmentContentCalls.push(input);
            return {
              ok: true,
              record: {
                id: 31,
                filename: 'attachment-31.pdf',
                contentType: 'application/pdf',
                sizeBytes: 16,
                contentSha256: 'sha256-31',
                content: Buffer.from('attachment bytes'),
              },
            };
          },
        },
        emailComposeAttachments: {
          async upload(input) {
            emailComposeAttachmentUploadCalls.push(input);
            return {
              ok: true,
              path: 'workspace-a/compose-drafts/44/abc-invoice.pdf',
              filename: 'invoice.pdf',
              sizeBytes: 12,
            };
          },
        },
        emailMessages: {
          async list(input) {
            emailMessageListCalls.push(input);
            return { items: [makeEmailMessageRecord(11)], nextCursor: null };
          },
          async get(input) {
            emailMessageGetCalls.push(input);
            return makeEmailMessageRecord(11, input.includeBody);
          },
        },
        emailAccountSignatures: {
          async list(input) {
            emailAccountSignatureListCalls.push(input);
            return { items: [makeEmailAccountSignatureRecord(71)], nextCursor: null };
          },
          async get() {
            return makeEmailAccountSignatureRecord(71);
          },
        },
        emailCannedResponses: {
          async list(input) {
            emailCannedResponseListCalls.push(input);
            return { items: [makeEmailCannedResponseRecord(70)], nextCursor: null };
          },
          async get() {
            return makeEmailCannedResponseRecord(70);
          },
        },
        emailCategories: {
          async list(input) {
            emailCategoryListCalls.push(input);
            return { items: [makeEmailCategoryRecord(61)], nextCursor: null };
          },
          async get() {
            return makeEmailCategoryRecord(61);
          },
        },
        emailFolders: {
          async list(input) {
            emailFolderListCalls.push(input);
            return { items: [makeEmailFolderRecord(2)], nextCursor: null };
          },
          async get() {
            return makeEmailFolderRecord(2);
          },
        },
        emailInternalNotes: {
          async list(input) {
            emailInternalNoteListCalls.push(input);
            return { items: [makeEmailInternalNoteRecord(63)], nextCursor: null };
          },
          async get() {
            return makeEmailInternalNoteRecord(63);
          },
        },
        emailMessageCategories: {
          async list(input) {
            emailMessageCategoryListCalls.push(input);
            return { items: [makeEmailMessageCategoryRecord(62)], nextCursor: null };
          },
          async get() {
            return makeEmailMessageCategoryRecord(62);
          },
        },
        emailMessageTags: {
          async list(input) {
            emailMessageTagListCalls.push(input);
            return { items: [makeEmailMessageTagRecord(60)], nextCursor: null };
          },
          async get() {
            return makeEmailMessageTagRecord(60);
          },
          async delete(input) {
            emailMessageTagDeleteCalls.push(input);
            return makeEmailMessageTagRecord(60);
          },
        },
        emailReadReceipts: {
          async list(input) {
            emailReadReceiptListCalls.push(input);
            return { items: [makeEmailReadReceiptRecord(73)], nextCursor: null };
          },
          async get() {
            return makeEmailReadReceiptRecord(73);
          },
        },
        emailRemoteContentAllowlist: {
          async list(input) {
            emailRemoteContentAllowlistCalls.push(input);
            return { items: [makeEmailRemoteContentAllowlistRecord(72)], nextCursor: null };
          },
          async get() {
            return makeEmailRemoteContentAllowlistRecord(72);
          },
        },
        emailTeamMembers: {
          async list(input) {
            emailTeamMemberListCalls.push(input);
            return { items: [makeEmailTeamMemberRecord('agent-1')], nextCursor: null };
          },
          async get() {
            return makeEmailTeamMemberRecord('agent-1');
          },
        },
        emailThreadAliases: {
          async list(input) {
            emailThreadAliasListCalls.push(input);
            return { items: [makeEmailThreadAliasRecord(75)], nextCursor: null };
          },
          async get() {
            return makeEmailThreadAliasRecord(75);
          },
        },
        emailThreadEdges: {
          async list(input) {
            emailThreadEdgeListCalls.push(input);
            return { items: [makeEmailThreadEdgeRecord(74)], nextCursor: null };
          },
          async get() {
            return makeEmailThreadEdgeRecord(74);
          },
        },
        emailThreads: {
          async list(input) {
            emailThreadListCalls.push(input);
            return { items: [makeEmailThreadRecord('thread-1')], nextCursor: null };
          },
          async get() {
            return makeEmailThreadRecord('thread-1');
          },
        },
        pgpIdentities: {
          async list(input) {
            pgpIdentityListCalls.push(input);
            return { items: [makePgpIdentityRecord(41)], nextCursor: null };
          },
          async get() {
            return makePgpIdentityRecord(41);
          },
        },
        pgpPeerKeys: {
          async list(input) {
            pgpPeerKeyListCalls.push(input);
            return { items: [makePgpPeerKeyRecord(42)], nextCursor: null };
          },
          async get() {
            return makePgpPeerKeyRecord(42);
          },
        },
        spamListEntries: {
          async list(input) {
            spamListEntryCalls.push(input);
            return { items: [makeSpamListEntryRecord(51)], nextCursor: null };
          },
          async get() {
            return makeSpamListEntryRecord(51);
          },
        },
        spamLearningEvents: {
          async list(input) {
            spamLearningEventCalls.push(input);
            return { items: [makeSpamLearningEventRecord(52)], nextCursor: null };
          },
          async get() {
            return makeSpamLearningEventRecord(52);
          },
        },
        spamDecisions: {
          async list(input) {
            spamDecisionCalls.push(input);
            return { items: [makeSpamDecisionRecord(53)], nextCursor: null };
          },
          async get() {
            return makeSpamDecisionRecord(53);
          },
        },
        spamFeatureStats: {
          async list(input) {
            spamFeatureStatCalls.push(input);
            return { items: [makeSpamFeatureStatRecord('sender:example.com')], nextCursor: null };
          },
          async get() {
            return makeSpamFeatureStatRecord('sender:example.com');
          },
        },
        workflows: {
          async list(input) {
            workflowListCalls.push(input);
            return { items: [makeWorkflowRecord(23)], nextCursor: null };
          },
          async get() {
            return makeWorkflowRecord(23);
          },
        },
        workflowDelayedJobs: {
          async list(input) {
            workflowDelayedJobCalls.push(input);
            return { items: [makeWorkflowDelayedJobRecord(87, input.includeContext)], nextCursor: null };
          },
          async get(input) {
            return makeWorkflowDelayedJobRecord(87, input.includeContext);
          },
        },
        workflowForwardDedup: {
          async list(input) {
            workflowForwardDedupCalls.push(input);
            return { items: [makeWorkflowForwardDedupRecord(85)], nextCursor: null };
          },
          async get() {
            return makeWorkflowForwardDedupRecord(85);
          },
        },
        workflowKnowledgeBases: {
          async list(input) {
            workflowKnowledgeBaseCalls.push(input);
            return { items: [makeWorkflowKnowledgeBaseRecord(90)], nextCursor: null };
          },
          async get() {
            return makeWorkflowKnowledgeBaseRecord(90);
          },
        },
        workflowKnowledgeChunks: {
          async list(input) {
            workflowKnowledgeChunkCalls.push(input);
            return { items: [makeWorkflowKnowledgeChunkRecord(91, input.includeContent)], nextCursor: null };
          },
          async get(input) {
            return makeWorkflowKnowledgeChunkRecord(91, input.includeContent);
          },
        },
        workflowMessageApplied: {
          async list(input) {
            workflowMessageAppliedCalls.push(input);
            return { items: [makeWorkflowMessageAppliedRecord(84)], nextCursor: null };
          },
          async get() {
            return makeWorkflowMessageAppliedRecord(84);
          },
        },
        workflowRuns: {
          async list(input) {
            workflowRunCalls.push(input);
            return { items: [makeWorkflowRunRecord(80, input.includeLog)], nextCursor: null };
          },
          async get(input) {
            return makeWorkflowRunRecord(80, input.includeLog);
          },
        },
        workflowRunSteps: {
          async list(input) {
            workflowRunStepCalls.push(input);
            return { items: [makeWorkflowRunStepRecord(81, input.includeDetail)], nextCursor: null };
          },
          async get(input) {
            return makeWorkflowRunStepRecord(81, input.includeDetail);
          },
        },
        workflowVersions: {
          async list(input) {
            workflowVersionCalls.push(input);
            return { items: [makeWorkflowVersionRecord(82)], nextCursor: null };
          },
          async get() {
            return makeWorkflowVersionRecord(82);
          },
        },
      },
      accessTokenSigner: signer,
    });

    try {
      await app.ready();

      const openapi = await app.inject({
        method: 'GET',
        url: '/api/v1/openapi.json',
      });
      expect(openapi.statusCode).toBe(200);
      const spec = JSON.parse(openapi.body);
      expect(spec.paths['/deals/{id}/stage']).toBeDefined();
      expect(spec.paths['/tasks/{id}/toggle']).toBeDefined();
      expect(spec.paths['/calendar-events']).toBeDefined();
      expect(spec.paths['/email/messages/{id}/actions']).toBeDefined();
      expect(spec.paths['/email/messages/{id}/move']).toBeDefined();
      expect(spec.paths['/pgp/identities']).toBeDefined();
      expect(spec.paths['/spam/list-entries']).toBeDefined();

      const health = await app.inject({
        method: 'GET',
        url: '/api/v1/health?probe=true',
      });
      expect(health.statusCode).toBe(200);
      expect(JSON.parse(health.body).data.api).toBe('simplecrm-server');

      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'owner@example.com',
          password: 'correct',
        },
      });
      expect(login.statusCode).toBe(200);
      expect(JSON.parse(login.body).data.tokens.accessToken).toBe('access-token');

      const lock = await app.inject({
        method: 'POST',
        url: '/api/v1/locks/42',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: { reason: 'reply' },
      });
      expect(lock.statusCode).toBe(201);
      expect(JSON.parse(lock.body).data.lock.userId).toBe('user-a');

      const customers = await app.inject({
        method: 'GET',
        url: '/api/v1/customers?limit=10&cursor=3&search=Alice',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(customers.statusCode).toBe(200);
      expect(JSON.parse(customers.body).data.items[0].id).toBe(7);
      expect(customerListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 10,
        cursor: 3,
        search: 'Alice',
      }]);

      const products = await app.inject({
        method: 'GET',
        url: '/api/v1/products?limit=5&search=Widget',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(products.statusCode).toBe(200);
      expect(JSON.parse(products.body).data.items[0].id).toBe(8);
      expect(productListCalls).toEqual([{ workspaceId: 'workspace-a', limit: 5, search: 'Widget' }]);

      const deals = await app.inject({
        method: 'GET',
        url: '/api/v1/deals?stage=Won&customerId=7&cursor=2',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(deals.statusCode).toBe(200);
      expect(JSON.parse(deals.body).data.nextCursor).toBe(9);
      expect(dealListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        cursor: 2,
        stage: 'Won',
        customerId: 7,
      }]);

      const tasks = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks?completed=false&customerId=7&search=Call',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(tasks.statusCode).toBe(200);
      expect(JSON.parse(tasks.body).data.items[0].id).toBe(10);
      expect(taskListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        search: 'Call',
        customerId: 7,
        completed: false,
        viewer: { userId: 'user-a', role: 'user' },
      }]);

      const calendarEvents = await app.inject({
        method: 'GET',
        url: '/api/v1/calendar-events?eventType=call&taskId=10&startFrom=2026-06-01',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(calendarEvents.statusCode).toBe(200);
      expect(JSON.parse(calendarEvents.body).data.items[0].title).toBe('Demo event 30');
      expect(calendarEventCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        eventType: 'call',
        taskId: 10,
        startFrom: '2026-06-01T00:00:00.000Z',
      }]);

      const customFields = await app.inject({
        method: 'GET',
        url: '/api/v1/customer-custom-fields?type=text&active=true&search=VAT',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(customFields.statusCode).toBe(200);
      expect(JSON.parse(customFields.body).data.items[0].label).toBe('VAT ID');
      expect(customFieldCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        search: 'VAT',
        type: 'text',
        active: true,
      }]);

      const customFieldValues = await app.inject({
        method: 'GET',
        url: '/api/v1/customer-custom-field-values?customerId=7&fieldId=61',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(customFieldValues.statusCode).toBe(200);
      expect(JSON.parse(customFieldValues.body).data.items[0].value).toBe('DE123456789');
      expect(customFieldValueCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        customerId: 7,
        fieldId: 61,
      }]);

      const activityLog = await app.inject({
        method: 'GET',
        url: '/api/v1/activity-log?activityType=email&customerId=7',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(activityLog.statusCode).toBe(200);
      expect(JSON.parse(activityLog.body).data.items[0].metadata).toBeUndefined();
      expect(activityLogCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        activityType: 'email',
        customerId: 7,
        includeMetadata: false,
      }]);

      const activityLogEntry = await app.inject({
        method: 'GET',
        url: '/api/v1/activity-log/80?includeMetadata=true',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(activityLogEntry.statusCode).toBe(200);
      expect(JSON.parse(activityLogEntry.body).data.metadata).toEqual({ imported: true });
      expect(activityLogGetCalls).toEqual([{ workspaceId: 'workspace-a', id: 80, includeMetadata: true }]);

      const savedViews = await app.inject({
        method: 'GET',
        url: '/api/v1/saved-views?search=Open',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(savedViews.statusCode).toBe(200);
      expect(JSON.parse(savedViews.body).data.items[0].filters).toEqual({ status: 'Open' });
      expect(savedViewCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50, search: 'Open' }]);

      const jtlFirmen = await app.inject({
        method: 'GET',
        url: '/api/v1/jtl/firmen?search=Main',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(jtlFirmen.statusCode).toBe(200);
      expect(JSON.parse(jtlFirmen.body).data.items[0].sourceSqliteId).toBe(100);
      expect(jtlFirmenCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50, search: 'Main' }]);

      const jtlWarenlager = await app.inject({
        method: 'GET',
        url: '/api/v1/jtl/warenlager',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      const jtlZahlungsarten = await app.inject({
        method: 'GET',
        url: '/api/v1/jtl/zahlungsarten',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      const jtlVersandarten = await app.inject({
        method: 'GET',
        url: '/api/v1/jtl/versandarten',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(jtlWarenlager.statusCode).toBe(200);
      expect(jtlZahlungsarten.statusCode).toBe(200);
      expect(jtlVersandarten.statusCode).toBe(200);
      expect(jtlWarenlagerCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50 }]);
      expect(jtlZahlungsartenCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50 }]);
      expect(jtlVersandartenCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50 }]);

      const emailAccounts = await app.inject({
        method: 'GET',
        url: '/api/v1/email/accounts',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailAccounts.statusCode).toBe(200);
      expect(JSON.parse(emailAccounts.body).data.items[0].emailAddress).toBe('mail1@example.com');
      expect(emailAccountListCalls).toEqual([{ workspaceId: 'workspace-a' }]);

      const emailMessages = await app.inject({
        method: 'GET',
        url: '/api/v1/email/messages?accountId=1&folderKind=inbox&seen=false&done=false&spam=false&search=Hello',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailMessages.statusCode).toBe(200);
      expect(JSON.parse(emailMessages.body).data.items[0].id).toBe(11);
      expect(JSON.parse(emailMessages.body).data.items[0].bodyText).toBeUndefined();
      expect(emailMessageListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        accountId: 1,
        folderKind: 'inbox',
        seen: false,
        done: false,
        spam: false,
        search: 'Hello',
      }]);

      const emailMessagesBulkLimit = await app.inject({
        method: 'GET',
        url: '/api/v1/email/messages?limit=500&view=archived',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailMessagesBulkLimit.statusCode).toBe(200);
      expect(emailMessageListCalls[1]).toEqual({
        workspaceId: 'workspace-a',
        limit: 500,
        view: 'archived',
      });

      const emailMessage = await app.inject({
        method: 'GET',
        url: '/api/v1/email/messages/11?includeBody=true',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailMessage.statusCode).toBe(200);
      expect(JSON.parse(emailMessage.body).data.bodyText).toBe('Body text 11');
      expect(emailMessageGetCalls).toEqual([{ workspaceId: 'workspace-a', id: 11, includeBody: true }]);

      const emailAttachments = await app.inject({
        method: 'GET',
        url: '/api/v1/email/messages/11/attachments',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailAttachments.statusCode).toBe(200);
      expect(JSON.parse(emailAttachments.body).data.items[0].filename).toBe('attachment-31.pdf');
      expect(emailAttachmentListCalls).toEqual([{ workspaceId: 'workspace-a', messageId: 11 }]);

      const emailAttachmentContent = await app.inject({
        method: 'GET',
        url: '/api/v1/email/attachments/31/content',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailAttachmentContent.statusCode).toBe(200);
      expect(emailAttachmentContent.headers['content-type']).toBe('application/pdf');
      expect(emailAttachmentContent.headers['x-content-type-options']).toBe('nosniff');
      expect(emailAttachmentContent.headers['content-disposition']).toContain('attachment-31.pdf');
      expect(emailAttachmentContent.body).toBe('attachment bytes');
      expect(emailAttachmentContentCalls).toEqual([{ workspaceId: 'workspace-a', id: 31 }]);

      const composeAttachmentUpload = await app.inject({
        method: 'POST',
        url: '/api/v1/email/messages/44/compose-attachments',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          filename: 'invoice.pdf',
          contentBase64: Buffer.from('invoice data').toString('base64'),
          contentType: 'application/pdf',
        },
      });
      expect(composeAttachmentUpload.statusCode).toBe(200);
      expect(JSON.parse(composeAttachmentUpload.body).data).toEqual({
        success: true,
        path: 'workspace-a/compose-drafts/44/abc-invoice.pdf',
        filename: 'invoice.pdf',
        sizeBytes: 12,
      });
      expect(emailComposeAttachmentUploadCalls).toEqual([{
        workspaceId: 'workspace-a',
        draftMessageId: 44,
        filename: 'invoice.pdf',
        contentBase64: Buffer.from('invoice data').toString('base64'),
        contentType: 'application/pdf',
      }]);

      const emailFolders = await app.inject({
        method: 'GET',
        url: '/api/v1/email/folders?accountId=1&search=INBOX',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailFolders.statusCode).toBe(200);
      expect(JSON.parse(emailFolders.body).data.items[0].path).toBe('INBOX');
      expect(emailFolderListCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50, accountId: 1, search: 'INBOX' }]);

      const emailTeamMembers = await app.inject({
        method: 'GET',
        url: '/api/v1/email/team-members?role=agent&search=Agent',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailTeamMembers.statusCode).toBe(200);
      expect(JSON.parse(emailTeamMembers.body).data.items[0].id).toBe('agent-1');
      expect(emailTeamMemberListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        search: 'Agent',
        role: 'agent',
      }]);

      const emailThreads = await app.inject({
        method: 'GET',
        url: '/api/v1/email/threads?hasUnread=true&hasAttachments=true&search=customer',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailThreads.statusCode).toBe(200);
      expect(JSON.parse(emailThreads.body).data.items[0].ticketCode).toBe('T-2026-1');
      expect(emailThreadListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        search: 'customer',
        hasUnread: true,
        hasAttachments: true,
      }]);

      const emailTags = await app.inject({
        method: 'GET',
        url: '/api/v1/email/messages/11/tags',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailTags.statusCode).toBe(200);
      expect(JSON.parse(emailTags.body).data.items[0].tag).toBe('priority');
      expect(emailMessageTagListCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50, messageId: 11 }]);

      const deletedEmailTag = await app.inject({
        method: 'DELETE',
        url: '/api/v1/email/messages/11/tags?tag=priority',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(deletedEmailTag.statusCode).toBe(200);
      expect(JSON.parse(deletedEmailTag.body).data.deleted).toBe(true);
      expect(emailMessageTagListCalls.at(-1)).toEqual({
        workspaceId: 'workspace-a',
        limit: 1,
        messageId: 11,
        tag: 'priority',
      });
      expect(emailMessageTagDeleteCalls).toEqual([{
        workspaceId: 'workspace-a',
        actorUserId: 'user-a',
        id: 60,
      }]);

      const emailCategories = await app.inject({
        method: 'GET',
        url: '/api/v1/email/categories?search=Support',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailCategories.statusCode).toBe(200);
      expect(JSON.parse(emailCategories.body).data.items[0].name).toBe('Support');
      expect(emailCategoryListCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50, search: 'Support' }]);

      const emailMessageCategories = await app.inject({
        method: 'GET',
        url: '/api/v1/email/messages/11/categories',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailMessageCategories.statusCode).toBe(200);
      expect(JSON.parse(emailMessageCategories.body).data.items[0].categoryId).toBe(61);
      expect(emailMessageCategoryListCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50, messageId: 11 }]);

      const emailInternalNotes = await app.inject({
        method: 'GET',
        url: '/api/v1/email/messages/11/internal-notes',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailInternalNotes.statusCode).toBe(200);
      expect(JSON.parse(emailInternalNotes.body).data.items[0].body).toBe('Internal follow-up note');
      expect(emailInternalNoteListCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50, messageId: 11 }]);

      const emailCannedResponses = await app.inject({
        method: 'GET',
        url: '/api/v1/email/canned-responses?search=Shipping',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailCannedResponses.statusCode).toBe(200);
      expect(JSON.parse(emailCannedResponses.body).data.items[0].title).toBe('Shipping update');
      expect(emailCannedResponseListCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50, search: 'Shipping' }]);

      const emailAccountSignatures = await app.inject({
        method: 'GET',
        url: '/api/v1/email/account-signatures?accountId=1',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailAccountSignatures.statusCode).toBe(200);
      expect(JSON.parse(emailAccountSignatures.body).data.items[0].signatureHtml).toBe('<p>Mailbox signature</p>');
      expect(emailAccountSignatureListCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50, accountId: 1 }]);

      const emailRemoteContentAllowlist = await app.inject({
        method: 'GET',
        url: '/api/v1/email/remote-content-allowlist?scope=domain&search=example',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailRemoteContentAllowlist.statusCode).toBe(200);
      expect(JSON.parse(emailRemoteContentAllowlist.body).data.items[0].value).toBe('example.com');
      expect(emailRemoteContentAllowlistCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        scope: 'domain',
        search: 'example',
      }]);

      const emailReadReceipts = await app.inject({
        method: 'GET',
        url: '/api/v1/email/read-receipts?messageId=11&direction=outbound',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailReadReceipts.statusCode).toBe(200);
      expect(JSON.parse(emailReadReceipts.body).data.items[0].recipient).toBe('customer@example.com');
      expect(emailReadReceiptListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        messageId: 11,
        direction: 'outbound',
      }]);

      const emailThreadEdges = await app.inject({
        method: 'GET',
        url: '/api/v1/email/thread-edges?parentMessageId=10&childMessageId=11',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailThreadEdges.statusCode).toBe(200);
      expect(JSON.parse(emailThreadEdges.body).data.items[0].childMessageId).toBe(11);
      expect(emailThreadEdgeListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        parentMessageId: 10,
        childMessageId: 11,
      }]);

      const emailThreadAliases = await app.inject({
        method: 'GET',
        url: '/api/v1/email/thread-aliases?aliasThreadId=thread-alias&canonicalThreadId=thread-canonical',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(emailThreadAliases.statusCode).toBe(200);
      expect(JSON.parse(emailThreadAliases.body).data.items[0].canonicalThreadId).toBe('thread-canonical');
      expect(emailThreadAliasListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        aliasThreadId: 'thread-alias',
        canonicalThreadId: 'thread-canonical',
      }]);

      const aiProfiles = await app.inject({
        method: 'GET',
        url: '/api/v1/ai/profiles?search=OpenAI',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(aiProfiles.statusCode).toBe(200);
      expect(JSON.parse(aiProfiles.body).data.items[0].apiKeyConfigured).toBe(true);
      expect(aiProfileListCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50, search: 'OpenAI' }]);

      const aiPrompts = await app.inject({
        method: 'GET',
        url: '/api/v1/ai/prompts?target=reply&profileId=21',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(aiPrompts.statusCode).toBe(200);
      expect(JSON.parse(aiPrompts.body).data.items[0].label).toBe('AI prompt 22');
      expect(aiPromptListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        target: 'reply',
        profileId: 21,
      }]);

      const automationApiKeys = await app.inject({
        method: 'GET',
        url: '/api/v1/automation/api-keys?revoked=false&search=Import',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(automationApiKeys.statusCode).toBe(200);
      expect(JSON.parse(automationApiKeys.body).data.items[0].secretConfigured).toBe(true);
      expect(automationApiKeyListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        revoked: false,
        search: 'Import',
      }]);

      const workflows = await app.inject({
        method: 'GET',
        url: '/api/v1/workflows?triggerName=mail.received&enabled=true',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(workflows.statusCode).toBe(200);
      expect(JSON.parse(workflows.body).data.items[0].name).toBe('Workflow 23');
      expect(workflowListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        triggerName: 'mail.received',
        enabled: true,
      }]);

      const workflowVersions = await app.inject({
        method: 'GET',
        url: '/api/v1/workflows/23/versions?search=Version',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(workflowVersions.statusCode).toBe(200);
      expect(JSON.parse(workflowVersions.body).data.items[0].label).toBe('Version 82');
      expect(workflowVersionCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        search: 'Version',
        workflowId: 23,
      }]);

      const workflowRuns = await app.inject({
        method: 'GET',
        url: '/api/v1/workflows/23/runs?messageId=11&status=succeeded',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(workflowRuns.statusCode).toBe(200);
      expect(JSON.parse(workflowRuns.body).data.items[0].log).toBeUndefined();
      expect(workflowRunCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        workflowId: 23,
        messageId: 11,
        status: 'succeeded',
        includeLog: false,
      }]);

      const workflowRun = await app.inject({
        method: 'GET',
        url: '/api/v1/workflow-runs/80?includeLog=true',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(workflowRun.statusCode).toBe(200);
      expect(JSON.parse(workflowRun.body).data.log).toEqual({ entries: ['run-log-entry'] });

      const workflowRunSteps = await app.inject({
        method: 'GET',
        url: '/api/v1/workflow-runs/80/steps?nodeType=ai.reply',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(workflowRunSteps.statusCode).toBe(200);
      expect(JSON.parse(workflowRunSteps.body).data.items[0].detail).toBeUndefined();
      expect(workflowRunStepCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        runId: 80,
        nodeType: 'ai.reply',
        includeDetail: false,
      }]);

      const workflowMessageApplied = await app.inject({
        method: 'GET',
        url: '/api/v1/workflow-message-applied?messageId=11&workflowId=23',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(workflowMessageApplied.statusCode).toBe(200);
      expect(JSON.parse(workflowMessageApplied.body).data.items[0].workflowId).toBe(23);
      expect(workflowMessageAppliedCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        messageId: 11,
        workflowId: 23,
      }]);

      const workflowForwardDedup = await app.inject({
        method: 'GET',
        url: '/api/v1/workflow-forward-dedup?dest=ops@example.com',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(workflowForwardDedup.statusCode).toBe(200);
      expect(JSON.parse(workflowForwardDedup.body).data.items[0].dest).toBe('ops@example.com');
      expect(workflowForwardDedupCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        dest: 'ops@example.com',
      }]);

      const workflowKnowledgeBases = await app.inject({
        method: 'GET',
        url: '/api/v1/workflow-knowledge-bases?search=Returns',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(workflowKnowledgeBases.statusCode).toBe(200);
      expect(JSON.parse(workflowKnowledgeBases.body).data.items[0].name).toBe('Returns policy');
      expect(workflowKnowledgeBaseCalls).toEqual([{ workspaceId: 'workspace-a', limit: 50, search: 'Returns' }]);

      const workflowKnowledgeChunks = await app.inject({
        method: 'GET',
        url: '/api/v1/workflow-knowledge-chunks?knowledgeBaseId=90&includeContent=true',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(workflowKnowledgeChunks.statusCode).toBe(200);
      expect(JSON.parse(workflowKnowledgeChunks.body).data.items[0].content).toContain('30 days');
      expect(workflowKnowledgeChunkCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        knowledgeBaseId: 90,
        includeContent: true,
      }]);

      const workflowDelayedJobs = await app.inject({
        method: 'GET',
        url: '/api/v1/workflow-delayed-jobs?workflowId=23&status=pending',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(workflowDelayedJobs.statusCode).toBe(200);
      expect(JSON.parse(workflowDelayedJobs.body).data.items[0].context).toBeUndefined();
      expect(workflowDelayedJobCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        workflowId: 23,
        status: 'pending',
        includeContext: false,
      }]);

      const pgpIdentities = await app.inject({
        method: 'GET',
        url: '/api/v1/pgp/identities?email=identity@example.com',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(pgpIdentities.statusCode).toBe(200);
      expect(JSON.parse(pgpIdentities.body).data.items[0].privateKeyConfigured).toBe(true);
      expect(pgpIdentityListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        email: 'identity@example.com',
      }]);

      const pgpPeerKeys = await app.inject({
        method: 'GET',
        url: '/api/v1/pgp/peer-keys?trustLevel=verified',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(pgpPeerKeys.statusCode).toBe(200);
      expect(JSON.parse(pgpPeerKeys.body).data.items[0].email).toBe('peer@example.com');
      expect(pgpPeerKeyListCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        trustLevel: 'verified',
      }]);

      const spamListEntries = await app.inject({
        method: 'GET',
        url: '/api/v1/spam/list-entries?listType=block&patternType=domain&accountId=1&search=example',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(spamListEntries.statusCode).toBe(200);
      expect(JSON.parse(spamListEntries.body).data.items[0].pattern).toBe('example.com');
      expect(spamListEntryCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        listType: 'block',
        patternType: 'domain',
        accountId: 1,
        search: 'example',
      }]);

      const spamLearningEvents = await app.inject({
        method: 'GET',
        url: '/api/v1/spam/learning-events?label=spam&accountId=1&messageId=11',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(spamLearningEvents.statusCode).toBe(200);
      expect(JSON.parse(spamLearningEvents.body).data.items[0].featureKeys).toEqual(['sender:example.com']);
      expect(spamLearningEventCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        label: 'spam',
        accountId: 1,
        messageId: 11,
      }]);

      const spamDecisions = await app.inject({
        method: 'GET',
        url: '/api/v1/spam/decisions?status=review&accountId=1&messageId=11',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(spamDecisions.statusCode).toBe(200);
      expect(JSON.parse(spamDecisions.body).data.items[0].status).toBe('review');
      expect(spamDecisionCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        status: 'review',
        accountId: 1,
        messageId: 11,
      }]);

      const spamFeatureStats = await app.inject({
        method: 'GET',
        url: '/api/v1/spam/feature-stats?search=sender',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });
      expect(spamFeatureStats.statusCode).toBe(200);
      expect(JSON.parse(spamFeatureStats.body).data.items[0].featureKey).toBe('sender:example.com');
      expect(spamFeatureStatCalls).toEqual([{
        workspaceId: 'workspace-a',
        limit: 50,
        search: 'sender',
      }]);

      const invalidBearerDoesNotUseHeaderFallback = await app.inject({
        method: 'POST',
        url: '/api/v1/locks/43',
        headers: {
          authorization: 'Bearer invalid',
          'x-simplecrm-user-id': 'user-a',
          'x-simplecrm-workspace-id': 'workspace-a',
          'x-simplecrm-role': 'user',
        },
        payload: { reason: 'reply' },
      });
      expect(invalidBearerDoesNotUseHeaderFallback.statusCode).toBe(401);

      const missingBearerDoesNotUseHeaderFallback = await app.inject({
        method: 'POST',
        url: '/api/v1/locks/44',
        headers: {
          'x-simplecrm-user-id': 'user-a',
          'x-simplecrm-workspace-id': 'workspace-a',
          'x-simplecrm-role': 'user',
        },
        payload: { reason: 'reply' },
      });
      expect(missingBearerDoesNotUseHeaderFallback.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  test('fastify adapter handles CORS preflights for configured server-client origins', async () => {
    const app = createFastifyServer({
      ports: makeServerApiPorts(),
      corsAllowedOrigins: ['https://client.example.com', 'null'],
    });

    try {
      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/customers',
        headers: {
          origin: 'https://client.example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'Authorization, Content-Type',
        },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('https://client.example.com');
      expect(preflight.headers['access-control-allow-methods']).toContain('POST');
      expect(preflight.headers['access-control-allow-headers']).toContain('Authorization');
      expect(preflight.headers['access-control-max-age']).toBe('600');
      expect(preflight.headers.vary).toBe('Origin');

      const actual = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://client.example.com' },
      });
      expect(actual.statusCode).toBe(200);
      expect(actual.headers['access-control-allow-origin']).toBe('https://client.example.com');

      const opaqueDesktopOrigin = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: { origin: 'null' },
      });
      expect(opaqueDesktopOrigin.statusCode).toBe(204);
      expect(opaqueDesktopOrigin.headers['access-control-allow-origin']).toBe('null');

      const denied = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: { origin: 'https://evil.example.com' },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
      expect((denied.json() as any).error.code).toBe('cors_origin_not_allowed');
    } finally {
      await app.close();
    }
  });

  test('fastify adapter allows public tracking resources from cross-origin mail clients', async () => {
    const emailTracking: EmailTrackingApiPort = {
      async getPolicy() { throw new Error('unused'); },
      async setPolicy() { throw new Error('unused'); },
      async getTimeline() { return null; },
      async recordPublicOpen() {},
      async resolvePublicClick() { return null; },
      async revokeMessage() { return false; },
      async eraseMessage() { return false; },
    };
    const app = createFastifyServer({
      ports: { ...makeServerApiPorts(), emailTracking },
      corsAllowedOrigins: [],
    });

    try {
      const token = 'A'.repeat(43);
      const response = await app.inject({
        method: 'GET',
        url: `/t/o/${token}.gif`,
        headers: { origin: 'null' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/gif');
    } finally {
      await app.close();
    }
  });

  test('fastify adapter resolves scoped automation bearer keys only for incoming workflow webhooks', async () => {
    const signer: AccessTokenSigner = {
      keyId: 'test',
      secret: Buffer.alloc(32, 19),
    };
    const verifyCalls: unknown[] = [];
    const syncGetCalls: unknown[] = [];
    const queueCalls: unknown[] = [];
    const app = createFastifyServer({
      ports: {
        ...makeServerApiPorts(),
        automationApiKeys: {
          async list() {
            return { items: [], nextCursor: null };
          },
          async get() {
            return null;
          },
          async verify(input) {
            verifyCalls.push(input);
            return input.key === 'scrm_webhook_key'
              ? {
                userId: 'user-a',
                workspaceId: 'workspace-a',
                role: 'user',
                automationApiKeyId: '55555555-5555-4555-8555-555555555555',
                automationScopes: ['workflows'],
              }
              : null;
          },
        },
        syncInfo: {
          async getMany(input) {
            syncGetCalls.push(input);
            return [];
          },
          async getByPrefix() {
            return [];
          },
          async setMany(input) {
            return Object.entries(input.values).map(([key, value]) => ({
              key,
              value,
              updatedAt: '2026-06-04T12:00:00.000Z',
            }));
          },
          async deleteMany() {
            return 0;
          },
        },
        workflows: {
          async list() {
            return {
              items: [{
                ...makeWorkflowRecord(91),
                triggerName: 'webhook.incoming',
                enabled: true,
              }],
              nextCursor: null,
            };
          },
          async get() {
            return null;
          },
        },
        jobQueue: {
          async enqueue(input) {
            queueCalls.push(input);
          },
        },
      },
      accessTokenSigner: signer,
    });

    try {
      await app.ready();
      const webhook = await app.inject({
        method: 'POST',
        url: '/api/v1/workflows/webhook/incoming',
        headers: { authorization: 'Bearer scrm_webhook_key' },
        payload: { body: { source: 'fastify' } },
      });
      expect(webhook.statusCode).toBe(202);
      expect(JSON.parse(webhook.body).data).toEqual({ success: true, queued: true, fired: 1 });
      expect(verifyCalls).toEqual([{ key: 'scrm_webhook_key', requiredScope: 'workflows' }]);
      expect(syncGetCalls).toEqual([{
        workspaceId: 'workspace-a',
        keys: [expect.stringMatching(/^webhook_dedup:/)],
      }]);
      expect(queueCalls).toHaveLength(1);

      const webhookAlias = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/incoming',
        headers: { authorization: 'Bearer scrm_webhook_key' },
        payload: { body: { source: 'fastify-alias' } },
      });
      expect(webhookAlias.statusCode).toBe(202);
      expect(JSON.parse(webhookAlias.body).data).toEqual({ success: true, queued: true, fired: 1 });
      expect(verifyCalls).toEqual([
        { key: 'scrm_webhook_key', requiredScope: 'workflows' },
        { key: 'scrm_webhook_key', requiredScope: 'workflows' },
      ]);
      expect(syncGetCalls).toHaveLength(2);
      expect(queueCalls).toHaveLength(2);

      const lock = await app.inject({
        method: 'POST',
        url: '/api/v1/locks/45',
        headers: { authorization: 'Bearer scrm_webhook_key' },
        payload: { reason: 'reply' },
      });
      expect(lock.statusCode).toBe(401);
      expect(verifyCalls).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  test('fastify event websocket authenticates clients and filters lock events by workspace', async () => {
    const signer: AccessTokenSigner = {
      keyId: 'test',
      secret: Buffer.alloc(32, 10),
    };
    const userAToken = createAccessToken({
      signer,
      issuedAt: new Date(),
      expiresInSeconds: 60,
      principal: {
        userId: 'user-a',
        workspaceId: 'workspace-a',
        role: 'user',
      },
    });
    const userBToken = createAccessToken({
      signer,
      issuedAt: new Date(),
      expiresInSeconds: 60,
      principal: {
        userId: 'user-b',
        workspaceId: 'workspace-b',
        role: 'user',
      },
    });
    const events = createInMemoryServerEventBus();
    const app = createFastifyServer({
      ports: { ...makeServerApiPorts(), events },
      accessTokenSigner: signer,
    });
    let userA: Awaited<ReturnType<typeof app.injectWS>> | null = null;
    let userB: Awaited<ReturnType<typeof app.injectWS>> | null = null;

    try {
      await app.ready();
      const userAMessages: ServerEvent[] = [];
      userA = await app.injectWS('/api/v1/events', {
        headers: { authorization: `Bearer ${userAToken}` },
      });
      userB = await app.injectWS('/api/v1/events', {
        headers: { authorization: `Bearer ${userBToken}` },
      });
      userA.on('message', (data) => {
        userAMessages.push(JSON.parse(data.toString()));
      });
      const userBMessage = onceWebSocketMessage(userB);

      await events.publish(makeServerEvent({ workspaceId: 'workspace-b', entityId: '41' }));
      expect((await userBMessage).entityId).toBe('41');
      expect(userAMessages).toEqual([]);

      const userAMessage = onceWebSocketMessage(userA);
      await events.publish(makeServerEvent({ workspaceId: 'workspace-a', entityId: '42' }));
      expect((await userAMessage).entityId).toBe('42');
    } finally {
      await closeWebSocket(userA);
      await closeWebSocket(userB);
      await app.close();
    }
  });

  test('fastify event websocket replays missed workspace events after reconnect cursor', async () => {
    const signer: AccessTokenSigner = {
      keyId: 'test',
      secret: Buffer.alloc(32, 12),
    };
    const userAToken = createAccessToken({
      signer,
      issuedAt: new Date(),
      expiresInSeconds: 60,
      principal: {
        userId: 'user-a',
        workspaceId: 'workspace-a',
        role: 'user',
      },
    });
    const events = createInMemoryServerEventBus();
    await events.publish(makeServerEvent({ workspaceId: 'workspace-a', entityId: '40' }));
    await events.publish(makeServerEvent({ workspaceId: 'workspace-b', entityId: '41' }));
    await events.publish(makeServerEvent({ workspaceId: 'workspace-a', entityId: '42' }));

    const app = createFastifyServer({
      ports: { ...makeServerApiPorts(), events },
      accessTokenSigner: signer,
    });
    let socket: Awaited<ReturnType<typeof app.injectWS>> | null = null;

    try {
      await app.ready();
      socket = await app.injectWS('/api/v1/events?since=1', {
        headers: { authorization: `Bearer ${userAToken}` },
      });
      const replayed = await onceWebSocketMessage(socket);

      expect(replayed.entityId).toBe('42');
      expect(replayed.workspaceId).toBe('workspace-a');
      expect(replayed.sequence).toBe(3);
    } finally {
      await closeWebSocket(socket);
      await app.close();
    }
  });

  test('startServer creates DB-backed ports and manages graphile worker lifecycle', async () => {
    const accessTokenSigner: AccessTokenSigner = {
      keyId: 'test',
      secret: Buffer.alloc(32, 11),
    };
    const destroyed = jest.fn(async () => undefined);
    const fakeDb = { destroy: destroyed } as unknown as Kysely<ServerDatabase>;
    const createDatabase = jest.fn(async () => fakeDb);
    const closedNotifications = jest.fn(async () => undefined);
    const createEventNotifications = jest.fn(async () => ({
      async notify() {
        return undefined;
      },
      subscribe() {
        return {
          unsubscribe() {
            return undefined;
          },
        };
      },
      close: closedNotifications,
    }));
    const migrated = jest.fn(async () => undefined);
    const released = jest.fn(async () => undefined);
    const stopped = jest.fn(async () => undefined);
    const createGraphileQueue = jest.fn(async () => ({
      enqueue: jest.fn(async () => undefined),
      migrate: migrated,
      release: released,
    }));
    const createJobWorker = jest.fn(async () => ({
      stop: stopped,
      promise: Promise.resolve(),
    }));

    const app = await startServer({
      host: '127.0.0.1',
      port: 0,
      logger: false,
      databaseUrl: 'postgres://simplecrm@postgres/simplecrm',
      accessTokenSigner,
      createDatabase,
      createEventNotifications,
      jobWorker: {
        enabled: true,
        mailAccountCount: 4,
        aiConcurrency: 3,
        migrateOnStart: true,
      },
      jobHandlers: {
        'lock.cleanup': async () => undefined,
      },
      createGraphileQueue,
      createJobWorker,
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }

    expect(createDatabase).toHaveBeenCalledWith({ databaseUrl: 'postgres://simplecrm@postgres/simplecrm' });
    expect(createEventNotifications).toHaveBeenCalledWith({ databaseUrl: 'postgres://simplecrm@postgres/simplecrm' });
    expect(createGraphileQueue).toHaveBeenCalledTimes(2);
    expect(createGraphileQueue).toHaveBeenNthCalledWith(1, {
      connectionString: 'postgres://simplecrm@postgres/simplecrm',
      migrateOnStart: true,
    });
    expect(createGraphileQueue).toHaveBeenNthCalledWith(2, { connectionString: 'postgres://simplecrm@postgres/simplecrm' });
    expect(migrated).toHaveBeenCalledTimes(1);
    expect(released).toHaveBeenCalledTimes(2);
    expect(createJobWorker).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: 'postgres://simplecrm@postgres/simplecrm',
      concurrency: {
        mailAccountCount: 4,
        aiConcurrency: 3,
      },
    }));
    expect(createJobWorker.mock.calls[0]?.[0].handlers['audit.retention']).toBeDefined();
    expect(createJobWorker.mock.calls[0]?.[0].handlers['webhook.fire']).toBeDefined();
    expect(createJobWorker.mock.calls[0]?.[0].handlers['mail.sync.imap']).toBeDefined();
    expect(createJobWorker.mock.calls[0]?.[0].handlers['mail.sync.pop3']).toBeDefined();
    expect(createJobWorker.mock.calls[0]?.[0].handlers['mail.send.scheduled']).toBeDefined();
    expect(createJobWorker.mock.calls[0]?.[0].handlers['ai.reply_suggestion']).toBeDefined();
    expect(createJobWorker.mock.calls[0]?.[0].handlers['workflow.execute']).toBeDefined();
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(closedNotifications).toHaveBeenCalledTimes(1);
    expect(destroyed).toHaveBeenCalledTimes(1);
  });

  test('startServer fails closed for incomplete production configuration', async () => {
    await expect(startServer({
      host: '127.0.0.1',
      port: 0,
      logger: false,
      databaseUrl: 'postgres://simplecrm@postgres/simplecrm',
      env: {
        NODE_ENV: 'production',
        SIMPLECRM_MASTER_KEY: CI_SMOKE_MASTER_KEY,
        ACCESS_TOKEN_SECRET: CI_SMOKE_ACCESS_TOKEN_SECRET,
        PUBLIC_BASE_URL: 'https://crm.example.com',
      },
    })).rejects.toThrow('known weak CI smoke-test value');

    await expect(startServer({
      host: '127.0.0.1',
      port: 0,
      logger: false,
      databaseUrl: 'postgres://simplecrm@postgres/simplecrm',
      env: {
        DATABASE_URL: 'postgres://simplecrm@postgres/simplecrm',
      },
    })).rejects.toThrow('ACCESS_TOKEN_SECRET');

    await expect(startServer({
      host: '127.0.0.1',
      port: 0,
      logger: false,
      jobWorker: { enabled: true },
      accessTokenSigner: {
        keyId: 'test',
        secret: Buffer.alloc(32, 12),
      },
      env: {},
    })).rejects.toThrow('DATABASE_URL');
  });

  test('smoke server serves health through the shared server API', async () => {
    const server = createSmokeServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }

    try {
      const body = await new Promise<{ status: number; json: any }>((resolve, reject) => {
        http.get(`http://127.0.0.1:${address.port}/api/v1/health`, (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            raw += chunk;
          });
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(raw) });
          });
        }).on('error', reject);
      });
      expect(body.status).toBe(200);
      expect(body.json.data.api).toBe('simplecrm-server');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

function makeServerApiPorts(): ServerApiPorts {
  const user: AuthUserRecord = {
    id: 'user-a',
    workspaceId: 'workspace-a',
    email: 'owner@example.com',
    displayName: 'Owner',
    role: 'owner',
    passwordHash: 'hash',
  };

  let lock: ConversationLockRecord | null = null;

  return {
    auth: {
      async findUserByEmail(email) {
        return email === user.email ? user : null;
      },
      async verifyPassword(password) {
        return password === 'correct';
      },
      async recordFailedLogin() {
        return 1;
      },
      async recordSuccessfulLogin() {
        return undefined;
      },
      async issueTokenPair() {
        return {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresInSeconds: 900,
        };
      },
      async rotateRefreshToken() {
        return null;
      },
      async revokeRefreshToken() {
        return false;
      },
    },
    locks: {
      async list(input) {
        return lock && input.messageIds.includes(lock.messageId) && lock.workspaceId === input.workspaceId
          ? [lock]
          : [];
      },
      async acquire(input) {
        if (lock) return { ok: false, existing: lock };
        lock = makeLock(input.messageId, input.userId, input.workspaceId, input.reason, 0);
        return { ok: true, lock };
      },
      async get(input) {
        return lock?.messageId === input.messageId && lock.workspaceId === input.workspaceId ? lock : null;
      },
      async heartbeat() {
        return lock;
      },
      async release() {
        const released = lock;
        lock = null;
        return released;
      },
      async forceTakeover(input) {
        lock = makeLock(input.messageId, input.newUserId, input.workspaceId, input.reason, 1);
        return lock;
      },
    },
  };
}

function makeLock(
  messageId: number,
  userId: string,
  workspaceId: string,
  reason: ConversationLockRecord['reason'],
  takeoverCount: number,
): ConversationLockRecord {
  return {
    messageId,
    userId,
    workspaceId,
    acquiredAt: '2026-06-02T12:00:00.000Z',
    lastHeartbeatAt: '2026-06-02T12:00:00.000Z',
    reason,
    takeoverCount,
  };
}

function makeCustomerRecord(id: number): CustomerRecord {
  return {
    id,
    sourceSqliteId: id,
    customerNumber: `C-${id}`,
    name: `Customer ${id}`,
    firstName: null,
    company: `Company ${id}`,
    email: `customer${id}@example.com`,
    phone: null,
    mobile: null,
    city: 'Berlin',
    country: 'DE',
    status: 'Active',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeProductRecord(id: number): ProductRecord {
  return {
    id,
    sourceSqliteId: id,
    jtlKartikel: 1000 + id,
    name: `Product ${id}`,
    sku: `SKU-${id}`,
    description: null,
    price: `${id}.00`,
    isActive: true,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeDealRecord(id: number): DealRecord {
  return {
    id,
    sourceSqliteId: id,
    customerSourceSqliteId: 7,
    customerId: 7,
    name: `Deal ${id}`,
    value: `${id}00.00`,
    valueCalculationMethod: 'static',
    stage: 'Won',
    notes: null,
    createdDate: '2026-06-01T12:00:00.000Z',
    expectedCloseDate: null,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeTaskRecord(id: number): TaskRecord {
  return {
    id,
    sourceSqliteId: id,
    customerSourceSqliteId: 7,
    customerId: 7,
    title: `Task ${id}`,
    description: null,
    dueDate: null,
    priority: 'Medium',
    completed: false,
    snoozedUntil: null,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeCalendarEventRecord(id: number): CalendarEventRecord {
  return {
    id,
    sourceSqliteId: id,
    title: `Demo event ${id}`,
    description: 'Customer call',
    startDate: '2026-06-03T09:00:00.000Z',
    endDate: '2026-06-03T09:30:00.000Z',
    allDay: false,
    colorCode: '#336699',
    eventType: 'call',
    recurrenceRule: null,
    taskSourceSqliteId: 10,
    taskId: 10,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeCustomerCustomFieldRecord(id: number): CustomerCustomFieldRecord {
  return {
    id,
    sourceSqliteId: id,
    name: `vat_id_${id}`,
    label: 'VAT ID',
    type: 'text',
    required: false,
    options: null,
    defaultValue: null,
    placeholder: 'DE...',
    description: null,
    displayOrder: id,
    active: true,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeCustomerCustomFieldValueRecord(id: number): CustomerCustomFieldValueRecord {
  return {
    id,
    sourceSqliteId: id,
    customerSourceSqliteId: 7,
    fieldSourceSqliteId: 61,
    customerId: 7,
    fieldId: 61,
    value: 'DE123456789',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeActivityLogRecord(id: number, includeMetadata = false): ActivityLogRecord {
  return {
    id,
    sourceSqliteId: id,
    customerSourceSqliteId: 7,
    dealSourceSqliteId: 9,
    taskSourceSqliteId: 10,
    customerId: 7,
    dealId: 9,
    taskId: 10,
    activityType: 'email',
    title: `Activity ${id}`,
    description: 'Imported email activity',
    ...(includeMetadata ? { metadata: { imported: true } } : {}),
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeSavedViewRecord(id: number): SavedViewRecord {
  return {
    id,
    sourceSqliteId: id,
    name: `Open view ${id}`,
    filters: { status: 'Open' },
    displayOrder: id,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeJtlReferenceRecord(sourceSqliteId: number): JtlReferenceRecord {
  return {
    sourceSqliteId,
    name: `JTL Reference ${sourceSqliteId}`,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeAiProfileRecord(id: number): AiProfileRecord {
  return {
    id,
    sourceSqliteId: id,
    label: `AI profile ${id}`,
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1',
    embeddingModel: 'text-embedding-3-small',
    isDefault: id === 21,
    sortOrder: id,
    apiKeyConfigured: true,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeAiPromptRecord(id: number): AiPromptRecord {
  return {
    id,
    sourceSqliteId: id,
    label: `AI prompt ${id}`,
    userTemplate: `Prompt template ${id}`,
    target: 'reply',
    profileSourceSqliteId: 21,
    profileId: 21,
    sortOrder: id,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeAutomationApiKeyRecord(id: string): AutomationApiKeyRecord {
  return {
    id,
    label: 'Import webhook',
    scopes: ['webhook:fire', 'mail:read'],
    lastUsedAt: null,
    revokedAt: null,
    createdByUserId: 'user-a',
    secretConfigured: true,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeWorkflowRecord(id: number): WorkflowRecord {
  return {
    id,
    sourceSqliteId: id,
    name: `Workflow ${id}`,
    triggerName: 'mail.received',
    enabled: true,
    priority: 100,
    definition: { nodes: [{ id: 'start', type: 'trigger' }] },
    graph: { edges: [] },
    cronExpr: null,
    scheduleAccountSourceSqliteId: null,
    scheduleAccountId: null,
    executionMode: 'graph',
    engineVersion: 1,
    legacyCreatedByUserId: 'legacy-user',
    createdByUserId: null,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeWorkflowVersionRecord(id: number): WorkflowVersionRecord {
  return {
    id,
    sourceSqliteId: id,
    workflowSourceSqliteId: 23,
    workflowId: 23,
    label: `Version ${id}`,
    graph: { nodes: [{ id: 'start' }] },
    definition: { trigger: 'mail.received' },
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeWorkflowRunRecord(id: number, includeLog = false): WorkflowRunRecord {
  return {
    id,
    sourceSqliteId: id,
    workflowSourceSqliteId: 23,
    messageSourceSqliteId: 11,
    workflowId: 23,
    messageId: 11,
    direction: 'inbound',
    status: 'succeeded',
    ...(includeLog ? { log: { entries: ['run-log-entry'] } } : {}),
    startedAt: '2026-06-02T12:00:00.000Z',
    finishedAt: '2026-06-02T12:00:02.000Z',
    updatedAt: '2026-06-02T12:00:02.000Z',
  };
}

function makeWorkflowRunStepRecord(id: number, includeDetail = false): WorkflowRunStepRecord {
  return {
    id,
    sourceSqliteId: id,
    runSourceSqliteId: 80,
    runId: 80,
    nodeId: 'reply',
    nodeType: 'ai.reply',
    status: 'succeeded',
    port: 'out',
    durationMs: 123,
    message: 'Generated reply',
    ...(includeDetail ? { detail: { tokens: 42 } } : {}),
    createdAt: '2026-06-02T12:00:01.000Z',
    updatedAt: '2026-06-02T12:00:02.000Z',
  };
}

function makeWorkflowMessageAppliedRecord(id: number): WorkflowMessageAppliedRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    workflowSourceSqliteId: 23,
    messageId: 11,
    workflowId: 23,
    appliedAt: '2026-06-02T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeWorkflowForwardDedupRecord(id: number): WorkflowForwardDedupRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    workflowSourceSqliteId: 23,
    messageId: 11,
    workflowId: 23,
    dest: 'ops@example.com',
    createdAt: '2026-06-02T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeWorkflowKnowledgeBaseRecord(id: number): WorkflowKnowledgeBaseRecord {
  return {
    id,
    sourceSqliteId: id,
    name: 'Returns policy',
    description: 'Support knowledge base',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeWorkflowKnowledgeChunkRecord(id: number, includeContent = false): WorkflowKnowledgeChunkRecord {
  return {
    id,
    sourceSqliteId: id,
    knowledgeBaseSourceSqliteId: 90,
    knowledgeBaseId: 90,
    title: 'Return window',
    ...(includeContent ? { content: 'Customers can return items within 30 days.' } : {}),
    sourcePath: 'returns.md',
    embeddingConfigured: true,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeWorkflowDelayedJobRecord(id: number, includeContext = false): WorkflowDelayedJobRecord {
  return {
    id,
    sourceSqliteId: id,
    workflowSourceSqliteId: 23,
    messageSourceSqliteId: 11,
    workflowId: 23,
    messageId: 11,
    resumeNodeId: 'wait-1',
    executeAt: '2026-06-03T12:00:00.000Z',
    ...(includeContext ? { context: { retry: true } } : {}),
    status: 'pending',
    createdAt: '2026-06-02T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makePgpIdentityRecord(id: number): PgpIdentityRecord {
  return {
    id,
    sourceSqliteId: id,
    userId: 'user-a',
    legacyUserId: 'legacy-user',
    email: 'identity@example.com',
    fingerprint: `PGP-FINGERPRINT-${id}`,
    publicKeyArmor: `-----BEGIN PGP PUBLIC KEY BLOCK-----\nidentity-${id}\n-----END PGP PUBLIC KEY BLOCK-----`,
    hasPrivateKey: true,
    privateKeyConfigured: true,
    expiresAt: '2027-06-02T12:00:00.000Z',
    isPrimary: true,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makePgpPeerKeyRecord(id: number): PgpPeerKeyRecord {
  return {
    id,
    sourceSqliteId: id,
    email: 'peer@example.com',
    fingerprint: `PGP-PEER-FINGERPRINT-${id}`,
    publicKeyArmor: `-----BEGIN PGP PUBLIC KEY BLOCK-----\npeer-${id}\n-----END PGP PUBLIC KEY BLOCK-----`,
    source: 'import',
    verifiedAt: '2026-06-01T12:00:00.000Z',
    verifiedByUserId: 'user-a',
    legacyVerifiedByUserId: 'legacy-verifier',
    trustLevel: 'verified',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeSpamListEntryRecord(id: number): SpamListEntryRecord {
  return {
    id,
    sourceSqliteId: id,
    listType: 'block',
    patternType: 'domain',
    pattern: 'example.com',
    accountSourceSqliteId: 1,
    accountId: 1,
    note: 'Imported block rule',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeSpamLearningEventRecord(id: number): SpamLearningEventRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    accountSourceSqliteId: 1,
    messageId: 11,
    accountId: 1,
    label: 'spam',
    source: 'user',
    featureKeys: ['sender:example.com'],
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeSpamDecisionRecord(id: number): SpamDecisionRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    accountSourceSqliteId: 1,
    messageId: 11,
    accountId: 1,
    score: 73,
    status: 'review',
    source: 'bayes',
    breakdown: { sender: 42 },
    modelVersion: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeSpamFeatureStatRecord(featureKey: string): SpamFeatureStatRecord {
  return {
    featureKey,
    spamCount: 5,
    hamCount: 2,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailAccountRecord(id: number): EmailAccountRecord {
  return {
    id,
    sourceSqliteId: id,
    displayName: `Mailbox ${id}`,
    emailAddress: `mail${id}@example.com`,
    protocol: 'imap',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapTls: true,
    imapUsername: `mail${id}@example.com`,
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpTls: true,
    smtpUsername: `mail${id}@example.com`,
    smtpUseImapAuth: false,
    pop3Host: null,
    pop3Port: null,
    pop3Tls: false,
    oauthProvider: null,
    sentFolderPath: 'Sent',
    syncSpamFolderPath: 'Spam',
    syncArchiveFolderPath: 'Archive',
    imapSyncSent: true,
    imapSyncArchive: true,
    imapSyncSpam: false,
    imapSyncSeenOnOpen: true,
    vacationEnabled: false,
    vacationSubject: null,
    vacationBodyText: null,
    requestReadReceipt: false,
    defaultRemoteContentPolicy: 'ask',
    respondToReadReceipts: 'ask',
    imapPasswordConfigured: true,
    smtpPasswordConfigured: true,
    oauthRefreshConfigured: false,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailMessageRecord(id: number, includeBody = false): EmailMessageRecord {
  return {
    id,
    sourceSqliteId: id,
    accountId: 1,
    folderId: 2,
    uid: 1000 + id,
    messageId: `<message-${id}@example.com>`,
    subject: `Message ${id}`,
    from: [{ address: 'sender@example.com', name: 'Sender' }],
    to: [{ address: 'mail1@example.com', name: 'Mailbox' }],
    cc: [],
    dateReceived: '2026-06-02T12:00:00.000Z',
    snippet: `Snippet ${id}`,
    seenLocal: false,
    doneLocal: false,
    archived: false,
    softDeleted: false,
    folderKind: 'inbox',
    threadId: `thread-${id}`,
    imapThreadId: `imap-thread-${id}`,
    ticketCode: `T-${id}`,
    customerId: 7,
    hasAttachments: false,
    assignedTo: null,
    assignedToUserId: null,
    isSpam: false,
    spamStatus: 'unknown',
    pgpStatus: null,
    remoteContentPolicy: 'ask',
    readReceiptRequested: false,
    snoozedUntil: null,
    ...(includeBody ? {
      bodyText: `Body text ${id}`,
      bodyHtml: `<p>Body html ${id}</p>`,
    } : {}),
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailAttachmentRecord(id: number): EmailAttachmentRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    messageId: 11,
    filename: `attachment-${id}.pdf`,
    contentType: 'application/pdf',
    sizeBytes: id * 100,
    contentSha256: `sha256-${id}`,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailFolderRecord(id: number): EmailFolderRecord {
  return {
    id,
    sourceSqliteId: id,
    accountSourceSqliteId: 1,
    accountId: 1,
    path: id === 2 ? 'INBOX' : `Folder ${id}`,
    delimiter: '/',
    uidValidity: 12345,
    uidValidityText: '12345',
    lastUid: 998,
    lastSyncedAt: '2026-06-02T11:00:00.000Z',
    pop3Uidl: null,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailTeamMemberRecord(id: string): EmailTeamMemberRecord {
  return {
    id,
    displayName: `Agent ${id}`,
    role: 'agent',
    signatureHtml: '<p>Agent signature</p>',
    sortOrder: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailThreadRecord(id: string): EmailThreadRecord {
  return {
    id,
    ticketCode: 'T-2026-1',
    rootMessageSourceSqliteId: 11,
    rootMessageId: 11,
    lastMessageAt: '2026-06-02T12:00:00.000Z',
    messageCount: 3,
    hasUnread: true,
    hasAttachments: true,
    subjectNormalized: 'customer question',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailMessageTagRecord(id: number): EmailMessageTagRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    messageId: 11,
    tag: 'priority',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailCategoryRecord(id: number): EmailCategoryRecord {
  return {
    id,
    sourceSqliteId: id,
    parentSourceSqliteId: null,
    parentId: null,
    name: 'Support',
    sortOrder: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailMessageCategoryRecord(id: number): EmailMessageCategoryRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    categorySourceSqliteId: 61,
    messageId: 11,
    categoryId: 61,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailInternalNoteRecord(id: number): EmailInternalNoteRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    messageId: 11,
    body: 'Internal follow-up note',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailCannedResponseRecord(id: number): EmailCannedResponseRecord {
  return {
    id,
    sourceSqliteId: id,
    title: 'Shipping update',
    body: 'Your order is on the way.',
    sortOrder: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailAccountSignatureRecord(sourceSqliteId: number): EmailAccountSignatureRecord {
  return {
    sourceSqliteId,
    accountSourceSqliteId: 1,
    accountId: 1,
    signatureHtml: '<p>Mailbox signature</p>',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailRemoteContentAllowlistRecord(id: number): EmailRemoteContentAllowlistRecord {
  return {
    id,
    sourceSqliteId: id,
    scope: 'domain',
    value: 'example.com',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailReadReceiptRecord(id: number): EmailReadReceiptRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    messageId: 11,
    direction: 'outbound',
    recipient: 'customer@example.com',
    at: '2026-06-02T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailThreadEdgeRecord(id: number): EmailThreadEdgeRecord {
  return {
    id,
    sourceSqliteId: id,
    parentMessageSourceSqliteId: 10,
    childMessageSourceSqliteId: 11,
    parentMessageId: 10,
    childMessageId: 11,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeEmailThreadAliasRecord(id: number): EmailThreadAliasRecord {
  return {
    id,
    sourceSqliteId: id,
    aliasThreadId: 'thread-alias',
    canonicalThreadId: 'thread-canonical',
    confidence: 'high',
    source: 'import',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

function makeServerEvent(input: {
  workspaceId: string;
  entityId: string;
}): ServerEvent {
  return {
    type: 'conversation_lock.acquired',
    workspaceId: input.workspaceId,
    entityType: 'email_message',
    entityId: input.entityId,
    actorUserId: 'user-a',
    occurredAt: '2026-06-03T00:00:00.000Z',
    payload: {
      messageId: Number(input.entityId),
    },
  };
}

function onceWebSocketMessage(socket: {
  once(event: 'message', listener: (data: { toString(): string }) => void): void;
}): Promise<ServerEvent> {
  return new Promise((resolve) => {
    socket.once('message', (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

function closeWebSocket(socket: {
  readyState: number;
  close(): void;
  terminate?: () => void;
  once(event: 'close', listener: () => void): void;
} | null): Promise<void> {
  if (!socket || socket.readyState === 3) return Promise.resolve();
  if (socket.terminate) {
    socket.terminate();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    socket.once('close', resolve);
    socket.close();
  });
}
