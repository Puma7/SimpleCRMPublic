import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dockerRoot = join(__dirname, '..', '..', 'docker');
const GEOIP_UPDATER_IMAGE = 'ghcr.io/maxmind/geoipupdate:v7.1.1@sha256:45e15eb310528fd308c5c0abee9a8e6d580f1e2b1251e960dec2863dc7f0102f';

type ResolvedCompose = Readonly<{
  services: Record<string, Readonly<{
    environment?: Record<string, string>;
    image?: string;
    profiles?: string | readonly string[];
    volumes?: Readonly<{ source?: string; target?: string; read_only?: boolean }> | readonly Readonly<{
      source?: string;
      target?: string;
      read_only?: boolean;
    }>[];
  }>>;
}>;

describe('server Compose GeoIP profile', () => {
  test('resolves MaxMind credentials only into the optional updater service', () => {
    const accountId = 'geoip-updater-account-sentinel';
    const licenseKey = 'geoip-updater-license-sentinel';
    const tempDir = mkdtempSync(join(tmpdir(), 'simplecrm-geoip-compose-'));
    copyFileSync(join(dockerRoot, 'docker-compose.yml'), join(tempDir, 'docker-compose.yml'));
    writeFileSync(join(tempDir, '.env'), [
      'PG_PASSWORD=test-app-password',
      'PG_ADMIN_PASSWORD=test-admin-password',
      'MASTER_KEY=test-master-key',
      'ACCESS_TOKEN_SECRET=test-access-token-secret',
      'PUBLIC_BASE_URL=https://crm.example.test',
      'GEOIPUPDATE_ACCOUNT_ID=legacy-account-sentinel',
      'GEOIPUPDATE_LICENSE_KEY=legacy-license-sentinel',
    ].join('\n'));
    writeFileSync(join(tempDir, '.env.geoip'), [
      `GEOIPUPDATE_ACCOUNT_ID=${accountId}`,
      `GEOIPUPDATE_LICENSE_KEY=${licenseKey}`,
    ].join('\n'));

    try {
      const resolved = resolveCompose(tempDir);
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
        GEOIP_COUNTRY_DB_PATH: '/var/lib/simplecrm/geoip/GeoLite2-Country.mmdb',
        GEOIP_ASN_DB_PATH: '/var/lib/simplecrm/geoip/GeoLite2-ASN.mmdb',
      });
      expect(volumeList(api.volumes)).toContainEqual({
        source: 'geoip',
        target: '/var/lib/simplecrm/geoip',
        readOnly: true,
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
});

function resolveCompose(composeRoot: string): ResolvedCompose {
  const env = {
    ...process.env,
  };
  delete env.GEOIPUPDATE_ACCOUNT_ID;
  delete env.GEOIPUPDATE_LICENSE_KEY;
  delete env.GEOIP_UPDATER_ENV_FILE;
  return JSON.parse(execFileSync(
    'docker',
    ['compose', '--profile', 'geoip', '-f', 'docker-compose.yml', 'config', '--format', 'json'],
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
