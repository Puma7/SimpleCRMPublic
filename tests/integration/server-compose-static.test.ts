import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dockerRoot = join(__dirname, '..', '..', 'docker');

describe('server Compose GeoIP profile', () => {
  test('keeps GeoIP credentials on the optional updater and mounts databases read-only in the API', () => {
    const compose = readFileSync(join(dockerRoot, 'docker-compose.yml'), 'utf8');
    const envExample = readFileSync(join(dockerRoot, '.env.example'), 'utf8');
    const updater = serviceBlock(compose, 'geoip-updater');
    const api = serviceBlock(compose, 'api');

    expect(updater).toContain('profiles: ["geoip"]');
    expect(updater).toContain('image: ghcr.io/maxmind/geoipupdate:v7.1.1@sha256:45e15eb310528fd308c5c0abee9a8e6d580f1e2b1251e960dec2863dc7f0102f');
    expect(updater).toContain('GEOIPUPDATE_ACCOUNT_ID: ${GEOIPUPDATE_ACCOUNT_ID:-}');
    expect(updater).toContain('GEOIPUPDATE_LICENSE_KEY: ${GEOIPUPDATE_LICENSE_KEY:-}');
    expect(updater).toContain('GEOIPUPDATE_EDITION_IDS: "GeoLite2-Country GeoLite2-ASN"');
    expect(updater).toContain('GEOIPUPDATE_FREQUENCY: "168"');
    expect(updater).toContain('geoip:/usr/share/GeoIP');
    expect(updater).not.toContain('GEOIP_COUNTRY_DB_PATH');
    expect(updater).not.toContain('GEOIP_ASN_DB_PATH');

    expect(api).toContain('GEOIP_COUNTRY_DB_PATH: /var/lib/simplecrm/geoip/GeoLite2-Country.mmdb');
    expect(api).toContain('GEOIP_ASN_DB_PATH: /var/lib/simplecrm/geoip/GeoLite2-ASN.mmdb');
    expect(api).toContain('geoip:/var/lib/simplecrm/geoip:ro');
    expect(api).not.toContain('GEOIPUPDATE_');
    expect(compose).toContain('\n  geoip:\n');

    expect(envExample).toContain('GEOIPUPDATE_ACCOUNT_ID=');
    expect(envExample).toContain('GEOIPUPDATE_LICENSE_KEY=');
  });
});

function serviceBlock(compose: string, serviceName: string): string {
  const service = new RegExp(`^  ${serviceName}:\\n`, 'm').exec(compose);
  if (!service?.index) throw new Error(`Missing Compose service: ${serviceName}`);
  const start = service.index;
  const afterHeader = start + serviceName.length + 4;
  const nextService = /\n {2}[a-z][\w-]*:\n/.exec(compose.slice(afterHeader));
  const end = nextService?.index === undefined ? undefined : afterHeader + nextService.index;
  return compose.slice(start, end);
}
