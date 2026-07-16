import { gunzipSync } from 'node:zlib';

import { XMLParser } from 'fast-xml-parser';
import yauzl from 'yauzl';

/**
 * Pure, dependency-light parser for DMARC **aggregate** (RUA) reports.
 *
 * Mailbox providers (Google, Microsoft, …) return one XML report per reporting
 * window to the `rua=` address in a domain's DMARC DNS record. Reports arrive as
 * normal e-mail attachments — usually `*.xml.gz`, sometimes `*.zip`, occasionally
 * plain `*.xml`. This module turns the raw attachment bytes into a structured
 * {@link ParsedDmarcReport}. It performs no I/O and no DB access, so it is fully
 * unit-testable and safe to run inside the ingest job.
 *
 * Hardening:
 * - `fast-xml-parser` never resolves external entities/DTDs → no XXE, no network.
 * - Decompression is bounded by {@link MAX_DECOMPRESSED_BYTES} (zip-bomb guard).
 * - Anything that is not a well-formed `<feedback>` DMARC document yields `null`
 *   so the caller can skip non-report attachments without crashing.
 */

/** Upper bound on the decompressed size of a single report attachment (32 MiB).
 *  Real aggregate reports are a few KiB–MiB even for very large senders; this cap
 *  exists purely to stop a malicious gzip/zip bomb from exhausting the worker. */
export const MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024;

const GZIP_MAGIC = [0x1f, 0x8b] as const;
const ZIP_MAGIC = [0x50, 0x4b] as const;

export type DmarcRecordRow = Readonly<{
  /** Sending IP the provider observed for this row. */
  sourceIp: string;
  /** Number of messages this row represents (RUA aggregates identical rows). */
  count: number;
  /** DMARC policy the provider applied: `none` | `quarantine` | `reject`. */
  disposition: string;
  /** DMARC-aligned DKIM result the provider evaluated: `pass` | `fail`. */
  dkimEval: string;
  /** DMARC-aligned SPF result the provider evaluated: `pass` | `fail`. */
  spfEval: string;
  /** RFC5322 From domain (identifiers.header_from). */
  headerFrom: string | null;
  /** RFC5321 MAIL FROM domain (identifiers.envelope_from). */
  envelopeFrom: string | null;
  /** DKIM auth_results domains (raw, per-signature). */
  dkimDomains: readonly string[];
  /** SPF auth_results domains (raw). */
  spfDomains: readonly string[];
}>;

export type ParsedDmarcReport = Readonly<{
  orgName: string;
  reportId: string;
  email: string | null;
  dateBegin: Date;
  dateEnd: Date;
  domain: string;
  policy: Readonly<{
    p: string | null;
    sp: string | null;
    pct: number | null;
    adkim: string | null;
    aspf: string | null;
  }>;
  records: readonly DmarcRecordRow[];
}>;

export type DmarcReportSummary = Readonly<{
  /** Number of `<record>` rows. */
  recordCount: number;
  /** Sum of per-row message counts. */
  messageCount: number;
  /** Messages that pass DMARC (DKIM- or SPF-aligned pass). */
  passCount: number;
  /** Messages that fail DMARC (neither DKIM nor SPF aligned-pass). */
  failCount: number;
  /** Messages the provider rejected (disposition=reject). */
  rejectCount: number;
  /** Messages the provider quarantined (disposition=quarantine). */
  quarantineCount: number;
  /** Distinct source IPs that failed DMARC — candidate spoofers / unauthorised senders. */
  unauthorizedSourceCount: number;
  /** Source IP with the highest observed message volume, or null when empty. */
  topSourceIp: string | null;
}>;

/** XXE-safe: fast-xml-parser resolves no external entities. `parseTagValue:false`
 *  keeps every leaf as a string so we coerce numbers ourselves (report_id can be a
 *  64-bit integer that would lose precision as a JS float). */
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
});

/**
 * Decompress a report attachment to its raw XML bytes.
 *
 * Detection is by magic bytes first (robust against wrong extensions), with the
 * filename as a fallback hint. `.gz` → gunzip (bounded), `.zip` → first `*.xml`
 * entry (bounded), otherwise the bytes are assumed to be plain XML.
 *
 * @throws if a gzip/zip payload exceeds {@link MAX_DECOMPRESSED_BYTES} or is corrupt.
 */
export async function decompressReportAttachment(
  filename: string,
  bytes: Buffer,
): Promise<Buffer> {
  const lowerName = (filename || '').toLowerCase();
  const looksGzip = hasMagic(bytes, GZIP_MAGIC) || lowerName.endsWith('.gz');
  const looksZip = hasMagic(bytes, ZIP_MAGIC) || lowerName.endsWith('.zip');

  if (looksGzip && !hasMagic(bytes, ZIP_MAGIC)) {
    return gunzipSync(bytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  }
  if (looksZip) {
    return await extractFirstXmlFromZip(bytes);
  }
  return bytes;
}

/**
 * Parse a single report attachment end-to-end (decompress + XML → structure).
 * Returns `null` for anything that is not a valid DMARC aggregate report — a
 * corrupt archive, non-XML content, or XML without a `<feedback>` root — so the
 * ingest job can iterate a message's attachments and quietly skip non-reports.
 */
export async function parseDmarcReportAttachment(
  filename: string,
  bytes: Buffer,
): Promise<ParsedDmarcReport | null> {
  let xml: Buffer;
  try {
    xml = await decompressReportAttachment(filename, bytes);
  } catch {
    return null;
  }
  return parseDmarcXml(xml.toString('utf8'));
}

/** Parse a decompressed RUA XML string into a {@link ParsedDmarcReport}, or `null`
 *  when it is not a recognisable DMARC aggregate report. */
export function parseDmarcXml(xml: string): ParsedDmarcReport | null {
  if (!xml || xml.indexOf('<feedback') === -1) return null;

  let doc: unknown;
  try {
    doc = xmlParser.parse(xml);
  } catch {
    return null;
  }

  const root = asRecord(doc);
  const feedback = root && asRecord(root.feedback);
  if (!feedback) return null;

  const metadata = asRecord(feedback.report_metadata);
  const published = asRecord(feedback.policy_published);
  if (!metadata || !published) return null;

  const dateRange = asRecord(metadata.date_range);
  const orgName = asText(metadata.org_name);
  const reportId = asText(metadata.report_id);
  const domain = asText(published.domain);
  if (!orgName || !reportId || !domain) return null;

  const records = asArray(feedback.record)
    .map(parseRecord)
    .filter((row): row is DmarcRecordRow => row !== null);

  return {
    orgName,
    reportId,
    email: asText(metadata.email) || null,
    dateBegin: epochToDate(dateRange?.begin),
    dateEnd: epochToDate(dateRange?.end),
    domain,
    policy: {
      p: asText(published.p) || null,
      sp: asText(published.sp) || null,
      pct: asOptionalInt(published.pct),
      adkim: asText(published.adkim) || null,
      aspf: asText(published.aspf) || null,
    },
    records,
  };
}

/** Aggregate a report's rows into the counters the workflow node exposes as
 *  `dmarc.*` variables and the stats page renders. A row "passes DMARC" when
 *  either the aligned DKIM or the aligned SPF result is `pass`. */
export function summarizeDmarcRecords(
  records: readonly DmarcRecordRow[],
): DmarcReportSummary {
  let messageCount = 0;
  let passCount = 0;
  let failCount = 0;
  let rejectCount = 0;
  let quarantineCount = 0;
  const unauthorizedSources = new Set<string>();
  const volumeByIp = new Map<string, number>();

  for (const row of records) {
    const count = row.count > 0 ? row.count : 0;
    messageCount += count;
    const dmarcPass = row.dkimEval === 'pass' || row.spfEval === 'pass';
    if (dmarcPass) passCount += count;
    else {
      failCount += count;
      if (row.sourceIp) unauthorizedSources.add(row.sourceIp);
    }
    if (row.disposition === 'reject') rejectCount += count;
    else if (row.disposition === 'quarantine') quarantineCount += count;
    if (row.sourceIp) volumeByIp.set(row.sourceIp, (volumeByIp.get(row.sourceIp) ?? 0) + count);
  }

  let topSourceIp: string | null = null;
  let topVolume = -1;
  for (const [ip, volume] of volumeByIp) {
    if (volume > topVolume) {
      topVolume = volume;
      topSourceIp = ip;
    }
  }

  return {
    recordCount: records.length,
    messageCount,
    passCount,
    failCount,
    rejectCount,
    quarantineCount,
    unauthorizedSourceCount: unauthorizedSources.size,
    topSourceIp,
  };
}

function parseRecord(raw: unknown): DmarcRecordRow | null {
  const record = asRecord(raw);
  if (!record) return null;
  const row = asRecord(record.row);
  if (!row) return null;

  const evaluated = asRecord(row.policy_evaluated);
  const identifiers = asRecord(record.identifiers);
  const authResults = asRecord(record.auth_results);

  const sourceIp = asText(row.source_ip);
  return {
    sourceIp,
    count: Math.max(0, asOptionalInt(row.count) ?? 0),
    disposition: normalizeToken(asText(evaluated?.disposition)) || 'none',
    dkimEval: normalizeResult(asText(evaluated?.dkim)),
    spfEval: normalizeResult(asText(evaluated?.spf)),
    headerFrom: identifiers ? (asText(identifiers.header_from) || null) : null,
    envelopeFrom: identifiers ? (asText(identifiers.envelope_from) || null) : null,
    dkimDomains: authDomains(authResults?.dkim),
    spfDomains: authDomains(authResults?.spf),
  };
}

function authDomains(raw: unknown): string[] {
  return asArray(raw)
    .map((entry) => asText(asRecord(entry)?.domain))
    .filter((domain): domain is string => domain.length > 0);
}

async function extractFirstXmlFromZip(bytes: Buffer): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (openErr, zip) => {
      if (openErr || !zip) {
        reject(openErr ?? new Error('zip konnte nicht geöffnet werden'));
        return;
      }
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      zip.on('error', (err) => finish(() => reject(err)));
      zip.on('end', () => finish(() => reject(new Error('keine XML-Datei im Zip'))));
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName.toLowerCase();
        if (name.endsWith('/') || !name.endsWith('.xml')) {
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > MAX_DECOMPRESSED_BYTES) {
          finish(() => reject(new Error('XML im Zip überschreitet Größenlimit')));
          return;
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            finish(() => reject(streamErr ?? new Error('Zip-Eintrag nicht lesbar')));
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          stream.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX_DECOMPRESSED_BYTES) {
              stream.destroy();
              finish(() => reject(new Error('XML im Zip überschreitet Größenlimit')));
              return;
            }
            chunks.push(chunk);
          });
          stream.on('error', (err) => finish(() => reject(err)));
          stream.on('end', () => finish(() => resolve(Buffer.concat(chunks))));
        });
      });
      zip.readEntry();
    });
  });
}

function hasMagic(bytes: Buffer, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

/** DMARC-aligned results in aggregate reports are `pass` | `fail`; treat anything
 *  that is not exactly `pass` as `fail` so partial/unknown values never count as
 *  authorised. */
function normalizeResult(value: string): string {
  return normalizeToken(value) === 'pass' ? 'pass' : 'fail';
}

function asOptionalInt(value: unknown): number | null {
  const text = asText(value);
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function epochToDate(value: unknown): Date {
  const seconds = asOptionalInt(value);
  return seconds === null ? new Date(0) : new Date(seconds * 1000);
}
