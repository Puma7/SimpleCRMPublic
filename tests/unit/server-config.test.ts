import {
  parseEmailTrackingIpIntelligenceConfig,
  parseServerEditionConfig,
} from '../../packages/server/src/config';

describe('server IP intelligence configuration', () => {
  test('keeps local GeoLite2 databases opt-in and trims configured paths', () => {
    expect(parseEmailTrackingIpIntelligenceConfig({})).toEqual({
      countryDatabasePath: undefined,
      asnDatabasePath: undefined,
    });
    expect(parseEmailTrackingIpIntelligenceConfig({
      GEOIP_COUNTRY_DB_PATH: '  /var/lib/GeoLite2-Country.mmdb  ',
      GEOIP_ASN_DB_PATH: ' /var/lib/GeoLite2-ASN.mmdb ',
    })).toEqual({
      countryDatabasePath: '/var/lib/GeoLite2-Country.mmdb',
      asnDatabasePath: '/var/lib/GeoLite2-ASN.mmdb',
    });
  });

  test('includes optional local GeoLite2 paths in the parsed server configuration', () => {
    expect(parseServerEditionConfig({
      DATABASE_URL: 'postgres://simplecrm@postgres/simplecrm',
      SIMPLECRM_MASTER_KEY: 'base64-master-key',
      ACCESS_TOKEN_SECRET: Buffer.alloc(32, 1).toString('base64'),
      PUBLIC_BASE_URL: 'https://crm.example.com',
      GEOIP_COUNTRY_DB_PATH: '/var/lib/GeoLite2-Country.mmdb',
    }).emailTrackingIpIntelligence).toEqual({
      countryDatabasePath: '/var/lib/GeoLite2-Country.mmdb',
      asnDatabasePath: undefined,
    });
  });
});
