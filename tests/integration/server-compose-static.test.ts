import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dockerRoot = join(__dirname, '..', '..', 'docker');
const GEOIP_UPDATER_IMAGE = 'ghcr.io/maxmind/geoipupdate:v7.1.1@sha256:45e15eb310528fd308c5c0abee9a8e6d580f1e2b1251e960dec2863dc7f0102f';
const RUNTIME_SENTINELS = {
  ACCESS_TOKEN_KEY_ID: 'access-token-key-id-sentinel',
  VERSION: 'version-sentinel',
  AI_DAILY_SOFT_LIMIT_MICRO_USD: '1100000',
  AI_DAILY_HARD_LIMIT_MICRO_USD: '2200000',
  HOST: '127.0.0.9',
  NODE_ENV: 'runtime-node-env-sentinel',
  CI: 'runtime-ci-sentinel',
  BACKUP_DIR: '/runtime-backup-dir-sentinel',
  RESTORE_DRILL_DATABASE_URL: 'postgres://restore-drill-sentinel/drill',
  RESTORE_DRILL_MAINTENANCE_DATABASE_URL: 'postgres://restore-drill-sentinel/postgres',
} as const;

type ResolvedCompose = Readonly<{
  services: Record<string, Readonly<{
    environment?: Record<string, string>;
    image?: string;
    cap_drop?: readonly string[];
    security_opt?: readonly string[];
    profiles?: string | readonly string[];
    networks?: Record<string, { ipv4_address?: string }>;
    ports?: readonly unknown[];
    volumes?: Readonly<{ source?: string; target?: string; read_only?: boolean }> | readonly Readonly<{
      source?: string;
      target?: string;
      read_only?: boolean;
    }>[];
  }>>;
  networks?: Record<string, { ipam?: { config?: readonly { subnet?: string; ip_range?: string }[] } }>;
}>;

describe('server Compose GeoIP profile', () => {
  test.each([
    [{}, '172.31.255.2', '172.31.255.0/29', '172.31.255.4/30', '172.31.255.2'],
    [{ CADDY_PROXY_IP: '10.254.254.2', PROXY_SUBNET: '10.254.254.0/29', PROXY_DYNAMIC_RANGE: '10.254.254.4/30' }, '10.254.254.2', '10.254.254.0/29', '10.254.254.4/30', '10.254.254.2'],
    [{ TRUST_PROXY: '192.0.2.10' }, '172.31.255.2', '172.31.255.0/29', '172.31.255.4/30', '192.0.2.10'],
    [{ TRUST_PROXY: 'false' }, '172.31.255.2', '172.31.255.0/29', '172.31.255.4/30', 'false'],
  ] as const)('pins bundled proxy trust and supports explicit configuration %j', (proxyEnvironment, ip, subnet, ipRange, trust) => {
    const tempDir = createComposeFixture({ proxyEnvironment });
    try {
      const resolved = resolveCompose(tempDir);
      expect(resolved.services.caddy.networks).toEqual({ proxy: { ipv4_address: ip } });
      expect(Object.keys(resolved.services.api.networks ?? {}).sort()).toEqual(['default', 'proxy']);
      expect(resolved.services.api.environment?.TRUST_PROXY).toBe(trust);
      expect(resolved.services.api.ports ?? []).toHaveLength(0);
      expect(resolved.networks?.proxy.ipam?.config).toEqual([{ subnet, ip_range: ipRange }]);
      expect(resolved.services.postgres.networks).not.toHaveProperty('proxy');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('resolves MaxMind credentials only into the optional updater service', () => {
    const accountId = 'geoip-updater-account-sentinel';
    const licenseKey = 'geoip-updater-license-sentinel';
    const tempDir = createComposeFixture({
      broadGeoIpCredentials: true,
      updaterCredentials: { accountId, licenseKey },
    });

    try {
      const resolved = resolveCompose(tempDir, ['geoip', 'backup', 'backup-scheduler', 'restore-drill']);
      const updater = resolved.services['geoip-updater'];
      expect(updater).toMatchObject({
        image: GEOIP_UPDATER_IMAGE,
        profiles: expect.arrayContaining(['geoip']),
        environment: {
          GEOIPUPDATE_ACCOUNT_ID: accountId,
          GEOIPUPDATE_LICENSE_KEY: licenseKey,
          GEOIPUPDATE_EDITION_IDS: 'GeoLite2-Country GeoLite2-ASN',
          GEOIPUPDATE_FREQUENCY: '168',
        },
      });
      expect(volumeList(updater?.volumes)).toContainEqual({
        source: 'geoip',
        target: '/usr/share/GeoIP',
        readOnly: false,
      });

      for (const [serviceName, service] of Object.entries(resolved.services)) {
        if (serviceName === 'geoip-updater') continue;
        expect(service.environment?.GEOIPUPDATE_ACCOUNT_ID).toBeUndefined();
        expect(service.environment?.GEOIPUPDATE_LICENSE_KEY).toBeUndefined();
      }

      const api = resolved.services.api;
      expect(api.environment).toMatchObject({
        ACCESS_TOKEN_KEY_ID: RUNTIME_SENTINELS.ACCESS_TOKEN_KEY_ID,
        VERSION: RUNTIME_SENTINELS.VERSION,
        AI_DAILY_SOFT_LIMIT_MICRO_USD: RUNTIME_SENTINELS.AI_DAILY_SOFT_LIMIT_MICRO_USD,
        AI_DAILY_HARD_LIMIT_MICRO_USD: RUNTIME_SENTINELS.AI_DAILY_HARD_LIMIT_MICRO_USD,
        HOST: RUNTIME_SENTINELS.HOST,
        NODE_ENV: RUNTIME_SENTINELS.NODE_ENV,
        CI: RUNTIME_SENTINELS.CI,
        BACKUP_DIR: RUNTIME_SENTINELS.BACKUP_DIR,
        GEOIP_COUNTRY_DB_PATH: '/var/lib/simplecrm/geoip/GeoLite2-Country.mmdb',
        GEOIP_ASN_DB_PATH: '/var/lib/simplecrm/geoip/GeoLite2-ASN.mmdb',
      });
      expect(volumeList(api.volumes)).toContainEqual({
        source: 'geoip',
        target: '/var/lib/simplecrm/geoip',
        readOnly: true,
      });
      expect(resolved.services.backup.environment).toMatchObject({
        BACKUP_DIR: RUNTIME_SENTINELS.BACKUP_DIR,
      });
      expect(resolved.services['backup-scheduler'].environment).toMatchObject({
        BACKUP_DIR: RUNTIME_SENTINELS.BACKUP_DIR,
      });
      expect(resolved.services['restore-drill'].environment).toMatchObject({
        RESTORE_DRILL_DATABASE_URL: RUNTIME_SENTINELS.RESTORE_DRILL_DATABASE_URL,
        RESTORE_DRILL_MAINTENANCE_DATABASE_URL: RUNTIME_SENTINELS.RESTORE_DRILL_MAINTENANCE_DATABASE_URL,
      });

      const broadEnvironment = parseDotenv(join(dockerRoot, '.env.example'));
      const updaterEnvironment = parseDotenv(join(dockerRoot, '.env.geoip.example'));
      expect(broadEnvironment.GEOIPUPDATE_ACCOUNT_ID).toBeUndefined();
      expect(broadEnvironment.GEOIPUPDATE_LICENSE_KEY).toBeUndefined();
      expect(updaterEnvironment).toMatchObject({
        GEOIPUPDATE_ACCOUNT_ID: '',
        GEOIPUPDATE_LICENSE_KEY: '',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('resolves the default stack without GeoIP credentials or the GeoIP profile', () => {
    const tempDir = createComposeFixture();
    try {
      const resolved = resolveCompose(tempDir);
      expect(resolved.services.api.environment).toMatchObject({
        GEOIP_COUNTRY_DB_PATH: '/var/lib/simplecrm/geoip/GeoLite2-Country.mmdb',
        GEOIP_ASN_DB_PATH: '/var/lib/simplecrm/geoip/GeoLite2-ASN.mmdb',
      });
      for (const service of Object.values(resolved.services)) {
        expect(service.environment?.GEOIPUPDATE_ACCOUNT_ID).toBeUndefined();
        expect(service.environment?.GEOIPUPDATE_LICENSE_KEY).toBeUndefined();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('server Compose backup volume', () => {
  // F-A12-08: Ein abweichender BACKUP_DIR liess backup/backup-scheduler neben das fest unter /backups eingehaengte Volume schreiben; die Backups verschwanden mit dem Container.
  test('backup writers always write into the backups volume, whatever BACKUP_DIR says', () => {
    const tempDir = createComposeFixture();
    try {
      const resolved = resolveCompose(tempDir, ['backup', 'backup-scheduler', 'restore', 'doctor', 'restore-drill']);
      for (const serviceName of ['backup', 'backup-scheduler']) {
        const service = resolved.services[serviceName];
        expect(service.environment?.BACKUP_DIR).toBe(RUNTIME_SENTINELS.BACKUP_DIR);
        expect(volumeList(service.volumes)).toContainEqual({
          source: 'backups',
          target: service.environment?.BACKUP_DIR,
          readOnly: false,
        });
      }
      // Die Leser suchen fest unter /backups im selben Volume.
      for (const serviceName of ['restore', 'doctor', 'restore-drill']) {
        expect(volumeList(resolved.services[serviceName].volumes)).toContainEqual({
          source: 'backups',
          target: '/backups',
          readOnly: true,
        });
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('server Compose API least privilege', () => {
  // F-A12-07: Der API-Container (auch migrate) lief als root mit vollem Capability-Set, pgadmin zog ungepinnt :latest.
  test('runs the API image as the unprivileged node user without capabilities', () => {
    const dockerfile = readFileSync(join(dockerRoot, 'api.Dockerfile'), 'utf8');
    const finalStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
    expect(finalStage).toMatch(/^USER node$/m);
    // Leere Named Volumes uebernehmen Besitzer und Rechte aus dem Image.
    expect(finalStage).toMatch(
      /mkdir -p \/app\/data\/attachments \/app\/data\/audit-archive \/app\/data\/logs[\s\S]*chown -R node:node \/app\/data/,
    );
    expect(finalStage.indexOf('chown -R node:node /app/data')).toBeLessThan(finalStage.indexOf('USER node'));

    const tempDir = createComposeFixture();
    try {
      const resolved = resolveCompose(tempDir);
      for (const serviceName of ['api', 'migrate']) {
        const service = resolved.services[serviceName];
        expect(service.security_opt).toEqual(expect.arrayContaining(['no-new-privileges:true']));
        expect(service.cap_drop).toEqual(['ALL']);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('pins third-party images to a release line instead of latest', () => {
    const tempDir = createComposeFixture();
    try {
      const resolved = resolveCompose(tempDir, [
        'geoip', 'backup', 'backup-scheduler', 'restore', 'doctor', 'restore-drill', 'monitor', 'pgadmin',
      ]);
      expect(resolved.services.pgadmin.image).toBe('dpage/pgadmin4:9');
      for (const [serviceName, service] of Object.entries(resolved.services)) {
        const image = service.image ?? '';
        if (image.startsWith('simplecrm/')) continue;
        const tag = /^[^:@]+:([^:@]+)(@sha256:[0-9a-f]{64})?$/.exec(image)?.[1];
        expect({ serviceName, tag }).toEqual({ serviceName, tag: expect.stringMatching(/^(?!latest$)\S+$/) });
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // E40 (minio-Profil): minio/minio wird auf Docker Hub nicht mehr veroeffentlicht, das Profil liess sich nicht mehr ziehen.
  test('ships no MinIO profile; S3-compatible storage stays external', () => {
    const compose = readFileSync(join(dockerRoot, 'docker-compose.yml'), 'utf8');
    const envExample = readFileSync(join(dockerRoot, '.env.example'), 'utf8');

    expect(compose).not.toMatch(/minio/i);
    expect(envExample).not.toMatch(/MINIO_/);
  });
});

function createComposeFixture(options: Readonly<{
  broadGeoIpCredentials?: boolean;
  updaterCredentials?: Readonly<{ accountId: string; licenseKey: string }>;
  proxyEnvironment?: Readonly<Record<string, string>>;
}> = {}): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'simplecrm-geoip-compose-'));
  copyFileSync(join(dockerRoot, 'docker-compose.yml'), join(tempDir, 'docker-compose.yml'));
  const environment = {
    PG_PASSWORD: 'test-app-password',
    PG_ADMIN_PASSWORD: 'test-admin-password',
    MASTER_KEY: 'test-master-key',
    ACCESS_TOKEN_SECRET: 'test-access-token-secret',
    PUBLIC_BASE_URL: 'https://crm.example.test',
    ...RUNTIME_SENTINELS,
    ...options.proxyEnvironment,
    ...(options.broadGeoIpCredentials ? {
      GEOIPUPDATE_ACCOUNT_ID: 'legacy-account-sentinel',
      GEOIPUPDATE_LICENSE_KEY: 'legacy-license-sentinel',
    } : {}),
  };
  writeFileSync(join(tempDir, '.env'), Object.entries(environment)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n'));
  if (options.updaterCredentials) {
    writeFileSync(join(tempDir, '.env.geoip'), [
      `GEOIPUPDATE_ACCOUNT_ID=${options.updaterCredentials.accountId}`,
      `GEOIPUPDATE_LICENSE_KEY=${options.updaterCredentials.licenseKey}`,
    ].join('\n'));
  }
  return tempDir;
}

function resolveCompose(composeRoot: string, profiles: readonly string[] = []): ResolvedCompose {
  const env = {
    ...process.env,
  };
  delete env.GEOIPUPDATE_ACCOUNT_ID;
  delete env.GEOIPUPDATE_LICENSE_KEY;
  delete env.GEOIP_UPDATER_ENV_FILE;
  delete env.TRUST_PROXY;
  delete env.CADDY_PROXY_IP;
  delete env.PROXY_SUBNET;
  delete env.PROXY_DYNAMIC_RANGE;
  for (const variable of Object.keys(RUNTIME_SENTINELS)) delete env[variable];
  return JSON.parse(execFileSync(
    'docker',
    ['compose', ...profiles.flatMap((profile) => ['--profile', profile]), '-f', 'docker-compose.yml', 'config', '--format', 'json'],
    { cwd: composeRoot, encoding: 'utf8', env },
  )) as ResolvedCompose;
}

function volumeList(volumes: ResolvedCompose['services'][string]['volumes']) {
  const list = volumes === undefined ? [] : Array.isArray(volumes) ? volumes : [volumes];
  return list.map((volume) => ({
    source: volume.source,
    target: volume.target,
    readOnly: volume.read_only === true,
  }));
}

function parseDotenv(path: string): Record<string, string> {
  expect(existsSync(path)).toBe(true);
  return Object.fromEntries(readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => [match[1], match[2]]));
}
