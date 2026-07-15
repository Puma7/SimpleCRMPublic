import {
  createEmailTrackingIpIntelligence,
  type EmailTrackingIpIntelligenceReader,
} from '../../packages/server/src/email-tracking-ip-intelligence';

type ReaderFixture = Readonly<{
  buildEpoch: number;
  country?: Readonly<Record<string, unknown>>;
  asn?: Readonly<Record<string, unknown>>;
}>;

describe('email tracking IP intelligence', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');

  test('classifies public IPv4 and IPv6 without leaking unavailable GeoIP data', async () => {
    const intelligence = createEmailTrackingIpIntelligence({ now: () => now });

    await expect(intelligence.lookup('8.8.8.8')).resolves.toEqual({
      ipAddress: '8.8.8.8',
      ipFamily: 'ipv4',
      scope: 'public',
      countryCode: null,
      continentCode: null,
      asn: null,
      networkName: null,
      networkCidr: null,
      databaseBuildAt: null,
    });
    await expect(intelligence.lookup('2606:4700:4700::1111')).resolves.toMatchObject({
      ipFamily: 'ipv6',
      scope: 'public',
      countryCode: null,
      asn: null,
    });
  });

  test('reports a synchronous fail-open status before the first lookup', () => {
    const intelligence = createEmailTrackingIpIntelligence({
      countryDatabasePath: 'country.mmdb',
      readerLoader: readerLoader({
        'country.mmdb': { buildEpoch: Math.floor(now.getTime() / 1_000) },
      }),
      stat: statLoader({ 'country.mmdb': 1 }),
      now: () => now,
    });

    expect(intelligence.status()).toEqual({
      state: 'missing',
      countryDatabaseBuildAt: null,
      asnDatabaseBuildAt: null,
    });
  });

  test('classifies unknown, private, loopback, and reserved addresses locally', async () => {
    const intelligence = createEmailTrackingIpIntelligence({ now: () => now });

    await expect(intelligence.lookup('not-an-ip')).resolves.toMatchObject({
      ipFamily: 'ipv4',
      scope: 'unknown',
    });
    await expect(intelligence.lookup('10.0.0.7')).resolves.toMatchObject({ scope: 'private' });
    await expect(intelligence.lookup('::1')).resolves.toMatchObject({
      ipFamily: 'ipv6',
      scope: 'loopback',
    });
    await expect(intelligence.lookup('fe90::7')).resolves.toMatchObject({ scope: 'reserved' });
    await expect(intelligence.lookup('192.0.2.17')).resolves.toMatchObject({ scope: 'reserved' });
  });

  test('returns local country and ASN insight from configured read-only databases', async () => {
    const loader = readerLoader({
      'country.mmdb': {
        buildEpoch: Math.floor(now.getTime() / 1_000),
        country: {
          country: { isoCode: 'DE' },
          continent: { code: 'EU' },
          network: '8.8.8.0/24',
        },
      },
      'asn.mmdb': {
        buildEpoch: Math.floor(now.getTime() / 1_000),
        asn: {
          autonomousSystemNumber: 15169,
          autonomousSystemOrganization: 'Google LLC',
          network: '8.8.8.0/24',
        },
      },
    });
    const intelligence = createEmailTrackingIpIntelligence({
      countryDatabasePath: 'country.mmdb',
      asnDatabasePath: 'asn.mmdb',
      readerLoader: loader,
      stat: statLoader({ 'country.mmdb': 1, 'asn.mmdb': 1 }),
      now: () => now,
    });

    await expect(intelligence.lookup('8.8.8.8')).resolves.toEqual({
      ipAddress: '8.8.8.8',
      ipFamily: 'ipv4',
      scope: 'public',
      countryCode: 'DE',
      continentCode: 'EU',
      asn: 15169,
      networkName: 'Google LLC',
      networkCidr: '8.8.8.0/24',
      databaseBuildAt: now.toISOString(),
    });
    expect(intelligence.status()).toEqual({
      state: 'ready',
      countryDatabaseBuildAt: now.toISOString(),
      asnDatabaseBuildAt: now.toISOString(),
    });
  });

  test('degrades to local classification when a configured database file is missing', async () => {
    const loader = jest.fn<Promise<EmailTrackingIpIntelligenceReader>, [string]>();
    const intelligence = createEmailTrackingIpIntelligence({
      countryDatabasePath: 'missing.mmdb',
      readerLoader: loader,
      stat: statLoader({ 'missing.mmdb': null }),
      now: () => now,
    });

    expect(intelligence.status()).toEqual({
      state: 'missing',
      countryDatabaseBuildAt: null,
      asnDatabaseBuildAt: null,
    });
    await expect(intelligence.lookup('8.8.8.8')).resolves.toMatchObject({
      scope: 'public',
      countryCode: null,
      asn: null,
    });
    expect(loader).not.toHaveBeenCalled();
  });

  test('degrades to local classification when a database cannot be opened', async () => {
    const loader = jest.fn(async (): Promise<EmailTrackingIpIntelligenceReader> => {
      throw new Error('corrupt MMDB');
    });
    const intelligence = createEmailTrackingIpIntelligence({
      countryDatabasePath: 'broken.mmdb',
      readerLoader: loader,
      stat: statLoader({ 'broken.mmdb': 1 }),
      now: () => now,
    });

    await expect(intelligence.lookup('8.8.8.8')).resolves.toMatchObject({
      countryCode: null,
      asn: null,
    });
    await intelligence.lookup('8.8.8.8');
    expect(intelligence.status()).toMatchObject({ state: 'invalid' });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('does not use an outdated database even when its reader is valid', async () => {
    const loader = jest.fn(readerLoader({
      'old.mmdb': {
        buildEpoch: Math.floor(new Date('2026-06-01T12:00:00.000Z').getTime() / 1_000),
        country: { country: { isoCode: 'DE' } },
      },
    }));
    const intelligence = createEmailTrackingIpIntelligence({
      countryDatabasePath: 'old.mmdb',
      readerLoader: loader,
      stat: statLoader({ 'old.mmdb': 1 }),
      now: () => now,
      maxDatabaseAgeMs: 14 * 24 * 60 * 60 * 1_000,
    });

    await intelligence.lookup('8.8.8.8');
    expect(intelligence.status()).toMatchObject({
      state: 'stale',
      countryDatabaseBuildAt: '2026-06-01T12:00:00.000Z',
    });
    await expect(intelligence.lookup('8.8.8.8')).resolves.toMatchObject({
      countryCode: null,
      asn: null,
    });
    await intelligence.lookup('8.8.8.8');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('atomically replaces both readers after database mtime changes', async () => {
    const versions = { country: 1, asn: 1 };
    const loader = jest.fn(async (path: string): Promise<EmailTrackingIpIntelligenceReader> => {
      const version = path === 'country.mmdb' ? versions.country : versions.asn;
      return fixtureReader({
        buildEpoch: Math.floor(now.getTime() / 1_000),
        ...(path === 'country.mmdb'
          ? { country: { country: { isoCode: version === 1 ? 'DE' : 'FR' } } }
          : { asn: { autonomousSystemNumber: version === 1 ? 64501 : 64502 } }),
      });
    });
    const mtimes = { 'country.mmdb': 1, 'asn.mmdb': 1 };
    const intelligence = createEmailTrackingIpIntelligence({
      countryDatabasePath: 'country.mmdb',
      asnDatabasePath: 'asn.mmdb',
      readerLoader: loader,
      stat: statLoader(mtimes),
      now: () => now,
    });

    await expect(intelligence.lookup('8.8.8.8')).resolves.toMatchObject({
      countryCode: 'DE',
      asn: 64501,
    });
    versions.country = 2;
    versions.asn = 2;
    mtimes['country.mmdb'] = 2;
    mtimes['asn.mmdb'] = 2;

    await expect(intelligence.lookup('8.8.8.8')).resolves.toMatchObject({
      countryCode: 'FR',
      asn: 64502,
    });
    expect(loader).toHaveBeenCalledTimes(4);
  });
});

function readerLoader(fixtures: Readonly<Record<string, ReaderFixture>>) {
  return async (path: string): Promise<EmailTrackingIpIntelligenceReader> => {
    const fixture = fixtures[path];
    if (!fixture) throw new Error('missing fixture');
    return fixtureReader(fixture);
  };
}

function fixtureReader(fixture: ReaderFixture): EmailTrackingIpIntelligenceReader {
  return {
    metadata: { buildEpoch: fixture.buildEpoch },
    country: () => fixture.country,
    asn: () => fixture.asn,
  };
}

function statLoader(mtimes: Record<string, number | null>) {
  return async (path: string): Promise<{ mtimeMs: number } | null> => {
    const mtimeMs = mtimes[path];
    return mtimeMs === null || mtimeMs === undefined ? null : { mtimeMs };
  };
}
