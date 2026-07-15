import { stat as fileStat } from 'node:fs/promises';
import { isIP } from 'node:net';

type MaxMindGeoIpModule = typeof import('@maxmind/geoip2-node', { with: { 'resolution-mode': 'import' } });

const importMaxMindGeoIp = new Function(
  'return import("@maxmind/geoip2-node")',
) as () => Promise<MaxMindGeoIpModule>;

export type EmailTrackingIpInsight = Readonly<{
  ipAddress: string;
  ipFamily: 'ipv4' | 'ipv6';
  scope: 'public' | 'private' | 'loopback' | 'reserved' | 'unknown';
  countryCode: string | null;
  continentCode: string | null;
  asn: number | null;
  networkName: string | null;
  networkCidr: string | null;
  databaseBuildAt: string | null;
}>;

export interface EmailTrackingIpIntelligencePort {
  lookup(ip: string): Promise<EmailTrackingIpInsight>;
  status(): Readonly<{
    state: 'ready' | 'missing' | 'stale' | 'invalid';
    countryDatabaseBuildAt: string | null;
    asnDatabaseBuildAt: string | null;
  }>;
}

export type EmailTrackingIpIntelligenceReader = Readonly<{
  metadata: Readonly<{ buildEpoch?: number }>;
  country?(ip: string): unknown;
  asn?(ip: string): unknown;
}>;

type DatabaseFileStat = Readonly<{ mtimeMs: number }>;
type ReaderLoader = (path: string) => Promise<EmailTrackingIpIntelligenceReader>;
type StatLoader = (path: string) => Promise<DatabaseFileStat | null>;
type IntelligenceState = 'ready' | 'missing' | 'stale' | 'invalid';

export type EmailTrackingIpIntelligenceOptions = Readonly<{
  countryDatabasePath?: string;
  asnDatabasePath?: string;
  readerLoader?: ReaderLoader;
  stat?: StatLoader;
  now?: () => Date;
  maxDatabaseAgeMs?: number;
}>;

type ReaderSnapshot = Readonly<{
  state: IntelligenceState;
  countryDatabaseBuildAt: string | null;
  asnDatabaseBuildAt: string | null;
  countryReader: EmailTrackingIpIntelligenceReader | null;
  asnReader: EmailTrackingIpIntelligenceReader | null;
  countryMtimeMs: number | null;
  asnMtimeMs: number | null;
}>;

const DEFAULT_MAX_DATABASE_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

export function createEmailTrackingIpIntelligence(
  options: EmailTrackingIpIntelligenceOptions = {},
): EmailTrackingIpIntelligencePort {
  const countryDatabasePath = optionalPath(options.countryDatabasePath);
  const asnDatabasePath = optionalPath(options.asnDatabasePath);
  const readerLoader = options.readerLoader ?? openMaxMindReader;
  const stat = options.stat ?? statDatabaseFile;
  const now = options.now ?? (() => new Date());
  const maxDatabaseAgeMs = options.maxDatabaseAgeMs ?? DEFAULT_MAX_DATABASE_AGE_MS;
  let snapshot: ReaderSnapshot = unavailableSnapshot('missing');
  let refreshing: Promise<ReaderSnapshot> | undefined;

  async function currentSnapshot(): Promise<ReaderSnapshot> {
    if (refreshing) return refreshing;
    const refresh = loadSnapshot({
      countryDatabasePath,
      asnDatabasePath,
      readerLoader,
      stat,
      now,
      maxDatabaseAgeMs,
      current: snapshot,
    });
    refreshing = refresh;
    try {
      snapshot = await refresh;
      return snapshot;
    } finally {
      if (refreshing === refresh) refreshing = undefined;
    }
  }

  return {
    async lookup(ip: string): Promise<EmailTrackingIpInsight> {
      const local = classifyIpAddress(ip);
      if (local.scope !== 'public') return emptyInsight(local);

      const current = await currentSnapshot();
      if (current.state !== 'ready') return emptyInsight(local);

      const country = lookupRecord(current.countryReader?.country, local.ipAddress);
      const asn = lookupRecord(current.asnReader?.asn, local.ipAddress);
      return {
        ...local,
        countryCode: nestedString(country, 'country', 'isoCode'),
        continentCode: nestedString(country, 'continent', 'code'),
        asn: nestedNumber(asn, 'autonomousSystemNumber'),
        networkName: nestedString(asn, 'autonomousSystemOrganization'),
        networkCidr: nestedString(asn, 'network')
          ?? nestedString(country, 'traits', 'network')
          ?? nestedString(country, 'network'),
        databaseBuildAt: oldestBuildAt(
          current.countryDatabaseBuildAt,
          current.asnDatabaseBuildAt,
        ),
      };
    },

    status() {
      return {
        state: snapshot.state,
        countryDatabaseBuildAt: snapshot.countryDatabaseBuildAt,
        asnDatabaseBuildAt: snapshot.asnDatabaseBuildAt,
      };
    },
  };
}

async function loadSnapshot(input: Readonly<{
  countryDatabasePath: string | undefined;
  asnDatabasePath: string | undefined;
  readerLoader: ReaderLoader;
  stat: StatLoader;
  now: () => Date;
  maxDatabaseAgeMs: number;
  current: ReaderSnapshot;
}>): Promise<ReaderSnapshot> {
  if (!input.countryDatabasePath && !input.asnDatabasePath) return unavailableSnapshot('missing');

  let countryStat: DatabaseFileStat | null = null;
  let asnStat: DatabaseFileStat | null = null;
  try {
    [countryStat, asnStat] = await Promise.all([
      input.countryDatabasePath ? input.stat(input.countryDatabasePath) : Promise.resolve(null),
      input.asnDatabasePath ? input.stat(input.asnDatabasePath) : Promise.resolve(null),
    ]);
  } catch {
    return unavailableSnapshot('invalid');
  }
  if ((input.countryDatabasePath && !countryStat) || (input.asnDatabasePath && !asnStat)) {
    return unavailableSnapshot('missing');
  }
  if (
    input.current.state !== 'missing'
    && input.current.countryMtimeMs === (countryStat?.mtimeMs ?? null)
    && input.current.asnMtimeMs === (asnStat?.mtimeMs ?? null)
  ) return input.current;

  try {
    const [countryReader, asnReader] = await Promise.all([
      input.countryDatabasePath ? input.readerLoader(input.countryDatabasePath) : Promise.resolve(null),
      input.asnDatabasePath ? input.readerLoader(input.asnDatabasePath) : Promise.resolve(null),
    ]);
    const countryDatabaseBuildAt = buildAt(countryReader);
    const asnDatabaseBuildAt = buildAt(asnReader);
    if ((countryReader && !countryDatabaseBuildAt) || (asnReader && !asnDatabaseBuildAt)) {
      return unavailableSnapshot('invalid', countryStat, asnStat);
    }
    const state = isStale({
      countryDatabaseBuildAt,
      asnDatabaseBuildAt,
      now: input.now(),
      maxDatabaseAgeMs: input.maxDatabaseAgeMs,
    }) ? 'stale' : 'ready';
    return {
      state,
      countryDatabaseBuildAt,
      asnDatabaseBuildAt,
      countryReader,
      asnReader,
      countryMtimeMs: countryStat?.mtimeMs ?? null,
      asnMtimeMs: asnStat?.mtimeMs ?? null,
    };
  } catch {
    return unavailableSnapshot('invalid', countryStat, asnStat);
  }
}

function unavailableSnapshot(
  state: Exclude<IntelligenceState, 'ready'>,
  countryStat: DatabaseFileStat | null = null,
  asnStat: DatabaseFileStat | null = null,
): ReaderSnapshot {
  return {
    state,
    countryDatabaseBuildAt: null,
    asnDatabaseBuildAt: null,
    countryReader: null,
    asnReader: null,
    countryMtimeMs: countryStat?.mtimeMs ?? null,
    asnMtimeMs: asnStat?.mtimeMs ?? null,
  };
}

async function openMaxMindReader(path: string): Promise<EmailTrackingIpIntelligenceReader> {
  const maxmind = await importMaxMindGeoIp();
  const reader = await maxmind.Reader.open(path);
  return {
    metadata: { buildEpoch: maxMindBuildEpoch(reader) },
    country: (ip) => reader.country(ip),
    asn: (ip) => reader.asn(ip),
  };
}

function maxMindBuildEpoch(reader: unknown): number | undefined {
  // geoip2-node wraps the MMDB reader without exposing its build timestamp.
  const value = nestedValue(nestedValue(nestedValue(reader, 'mmdbReader'), 'metadata'), 'buildEpoch');
  return value instanceof Date ? Math.floor(value.getTime() / 1_000) : undefined;
}

async function statDatabaseFile(path: string): Promise<DatabaseFileStat | null> {
  try {
    const result = await fileStat(path);
    return { mtimeMs: result.mtimeMs };
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}

function buildAt(reader: EmailTrackingIpIntelligenceReader | null): string | null {
  const buildEpoch = reader?.metadata.buildEpoch;
  if (buildEpoch === undefined || !Number.isFinite(buildEpoch) || buildEpoch < 0) return null;
  const date = new Date(buildEpoch * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isStale(input: Readonly<{
  countryDatabaseBuildAt: string | null;
  asnDatabaseBuildAt: string | null;
  now: Date;
  maxDatabaseAgeMs: number;
}>): boolean {
  if (!Number.isFinite(input.maxDatabaseAgeMs) || input.maxDatabaseAgeMs < 0) return true;
  return [input.countryDatabaseBuildAt, input.asnDatabaseBuildAt]
    .filter((value): value is string => value !== null)
    .some((value) => input.now.getTime() - new Date(value).getTime() > input.maxDatabaseAgeMs);
}

function classifyIpAddress(ip: string): Pick<EmailTrackingIpInsight, 'ipAddress' | 'ipFamily' | 'scope'> {
  const ipAddress = ip.trim();
  const family = isIP(ipAddress);
  if (family === 0) return { ipAddress, ipFamily: 'ipv4', scope: 'unknown' };
  return {
    ipAddress,
    ipFamily: family === 6 ? 'ipv6' : 'ipv4',
    scope: family === 6 ? ipv6Scope(ipAddress) : ipv4Scope(ipAddress),
  };
}

function ipv4Scope(ip: string): EmailTrackingIpInsight['scope'] {
  const [first, second, third] = ip.split('.').map(Number);
  if (first === 127) return 'loopback';
  if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) {
    return 'private';
  }
  if (
    first === 0
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 192 && (second === 0 || second === 2))
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0 && third === 113)
    || first >= 224
  ) return 'reserved';
  return 'public';
}

function ipv6Scope(ip: string): EmailTrackingIpInsight['scope'] {
  const normalized = ip.toLowerCase();
  const mappedIpv4 = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/.exec(normalized)?.[1];
  if (mappedIpv4 && isIP(mappedIpv4) === 4) return ipv4Scope(mappedIpv4);
  if (normalized === '::1') return 'loopback';
  if (/^(?:fc|fd)/.test(normalized)) return 'private';
  if (
    normalized === '::'
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff')
    || normalized.startsWith('2001:db8:')
  ) return 'reserved';
  return 'public';
}

function emptyInsight(local: Pick<EmailTrackingIpInsight, 'ipAddress' | 'ipFamily' | 'scope'>): EmailTrackingIpInsight {
  return {
    ...local,
    countryCode: null,
    continentCode: null,
    asn: null,
    networkName: null,
    networkCidr: null,
    databaseBuildAt: null,
  };
}

function lookupRecord(reader: ((ip: string) => unknown) | undefined, ip: string): unknown {
  try {
    return reader?.(ip);
  } catch {
    return undefined;
  }
}

function nestedString(value: unknown, ...path: string[]): string | null {
  const result = path.reduce<unknown>((current, key) => (
    typeof current === 'object' && current !== null && key in current
      ? (current as Record<string, unknown>)[key]
      : undefined
  ), value);
  return typeof result === 'string' && result.trim() ? result : null;
}

function nestedNumber(value: unknown, key: string): number | null {
  const result = nestedValue(value, key);
  return typeof result === 'number' && Number.isInteger(result) && result >= 0 ? result : null;
}

function nestedValue(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function oldestBuildAt(...values: Array<string | null>): string | null {
  const builds = values.filter((value): value is string => value !== null);
  return builds.length ? builds.sort()[0]! : null;
}

function optionalPath(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}
