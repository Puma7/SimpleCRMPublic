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
  const octets = ip.split('.').map(Number) as [number, number, number, number];
  const [first, second] = octets;
  if (first === 127) return 'loopback';
  if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) {
    return 'private';
  }
  if (
    first === 0
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || isIpv4InCidr(octets, [192, 0, 0, 0], 24)
    || isIpv4InCidr(octets, [192, 0, 2, 0], 24)
    || isIpv4InCidr(octets, [198, 18, 0, 0], 15)
    || isIpv4InCidr(octets, [198, 51, 100, 0], 24)
    || isIpv4InCidr(octets, [203, 0, 113, 0], 24)
    || first >= 224
  ) return 'reserved';
  return 'public';
}

function isIpv4InCidr(
  address: readonly [number, number, number, number],
  network: readonly [number, number, number, number],
  prefixLength: number,
): boolean {
  const wholeOctets = Math.floor(prefixLength / 8);
  const remainingBits = prefixLength % 8;
  for (let index = 0; index < wholeOctets; index += 1) {
    if (address[index] !== network[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (address[wholeOctets]! & mask) === (network[wholeOctets]! & mask);
}

function ipv6Scope(ip: string): EmailTrackingIpInsight['scope'] {
  const normalized = ip.toLowerCase();
  const mappedIpv4 = mappedIpv4Address(normalized);
  if (mappedIpv4) return ipv4Scope(mappedIpv4);
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

function mappedIpv4Address(ip: string): string | null {
  const hextets = normalizeIpv6Hextets(ip);
  if (!hextets || hextets.slice(0, 5).some((value) => value !== 0) || hextets[5] !== 0xffff) {
    return null;
  }
  const high = hextets[6]!;
  const low = hextets[7]!;
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

function normalizeIpv6Hextets(ip: string): readonly number[] | null {
  if (isIP(ip) !== 6) return null;
  const dottedTail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  const normalized = dottedTail
    ? replaceIpv4Tail(dottedTail[1]!, dottedTail[2]!)
    : ip;
  if (!normalized) return null;

  const compressed = normalized.split('::');
  if (compressed.length > 2) return null;
  const left = splitIpv6Hextets(compressed[0]!);
  const right = splitIpv6Hextets(compressed[1] ?? '');
  if (!left || !right) return null;
  if (compressed.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  return missing > 0 ? [...left, ...Array<number>(missing).fill(0), ...right] : null;
}

function replaceIpv4Tail(prefix: string, dotted: string): string | null {
  if (isIP(dotted) !== 4) return null;
  const octets = dotted.split('.').map(Number);
  const high = (octets[0]! << 8) | octets[1]!;
  const low = (octets[2]! << 8) | octets[3]!;
  return `${prefix}${high.toString(16)}:${low.toString(16)}`;
}

function splitIpv6Hextets(value: string): number[] | null {
  if (!value) return [];
  const parts = value.split(':');
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
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
