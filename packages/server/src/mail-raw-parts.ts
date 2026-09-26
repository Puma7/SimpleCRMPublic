/**
 * Attachment parts taken out of a stored original (codec 'br-parts').
 *
 * The raw original carries every attachment a second time, base64 encoded
 * (about 1.33x its size), next to the decoded file under the attachments
 * root. For a part that exists as a file, the stored original keeps only a
 * reference; reading puts the exact bytes back.
 *
 * No MIME interpretation is needed for that: a part body is a run of base64
 * lines. A run is only taken out when the canonical re-encoding of its
 * decoded bytes (same line length, same line ending) reproduces the run byte
 * for byte, and the caller proves the whole original round-trips before it
 * stores anything. Anything else simply stays in the stored original.
 *
 * Part objects live at <root>/<workspaceId>/raw-parts/<aa>/<sha256>, hard
 * links of the attachment files (no extra space). Removing an attachment file
 * leaves the part object, so the original stays complete. Only when no stored
 * original names a part any more (its messages were deleted) does
 * mail-raw-part-gc set it aside and, days later, remove it; readers still find
 * a set-aside part (readVerifiedPart).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type Base64Run = {
  /** Byte offsets of the run in the original; end is exclusive and includes the final line ending. */
  start: number;
  end: number;
  lineLength: number;
  eol: 'crlf' | 'lf';
  finalEol: boolean;
};

export type StrippedPart = {
  /** Offset in the skeleton where the encoded part is inserted again. */
  at: number;
  sha256: string;
  size: number;
  lineLength: number;
  eol: 'crlf' | 'lf';
  finalEol: boolean;
  encodedLength: number;
};

const MAGIC = Buffer.from('SCRP', 'latin1');
const CONTAINER_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BASE64_BYTE = new Uint8Array(256);
for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/') {
  BASE64_BYTE[char.charCodeAt(0)] = 1;
}
const EQUALS = 0x3d;
const LF = 0x0a;
const CR = 0x0d;

/** Is [from, to) one base64 line? `padded` = it ends in '=' padding. */
function base64LineInfo(raw: Buffer, from: number, to: number): { valid: boolean; padded: boolean } {
  if (to <= from) return { valid: false, padded: false };
  let i = from;
  while (i < to && BASE64_BYTE[raw[i]!] === 1) i += 1;
  const padStart = i;
  while (i < to && raw[i] === EQUALS && i - padStart < 2) i += 1;
  if (i !== to) return { valid: false, padded: false };
  if (padStart === from) return { valid: false, padded: false };
  return { valid: true, padded: i > padStart };
}

/**
 * Runs of base64 lines: all lines but the last have the same length, the last
 * is not longer, '=' padding only at the very end, one line ending style.
 */
export function findBase64Runs(raw: Buffer, minRunBytes = 1024): Base64Run[] {
  const runs: Base64Run[] = [];
  type Open = { start: number; end: number; lineLength: number; eol: 'crlf' | 'lf' | null; closed: boolean };
  let current: Open | null = null;

  const finish = () => {
    if (current && current.eol && current.end - current.start >= minRunBytes) {
      const finalEol = raw[current.end - 1] === LF;
      runs.push({ start: current.start, end: current.end, lineLength: current.lineLength, eol: current.eol, finalEol });
    } else if (current && !current.eol && current.end - current.start >= minRunBytes) {
      // A single line without any line ending (end of the original).
      runs.push({ start: current.start, end: current.end, lineLength: current.lineLength, eol: 'crlf', finalEol: false });
    }
    current = null;
  };

  let pos = 0;
  while (pos < raw.length) {
    const newline = raw.indexOf(LF, pos);
    const hasNewline = newline !== -1;
    let contentEnd = hasNewline ? newline : raw.length;
    let eol: 'crlf' | 'lf' | null = null;
    if (hasNewline) {
      if (contentEnd > pos && raw[contentEnd - 1] === CR) {
        contentEnd -= 1;
        eol = 'crlf';
      } else {
        eol = 'lf';
      }
    }
    const next = hasNewline ? newline + 1 : raw.length;
    const length = contentEnd - pos;
    const info = base64LineInfo(raw, pos, contentEnd);

    if (info.valid) {
      const open = current as Open | null;
      const extends_ = open !== null
        && !open.closed
        && open.eol !== null
        // The very last line of the original may lack its line ending.
        && (open.eol === eol || eol === null)
        && length <= open.lineLength;
      if (extends_ && open) {
        open.end = next;
        if (length < open.lineLength || info.padded || !hasNewline) open.closed = true;
      } else {
        finish();
        current = {
          start: pos,
          end: next,
          lineLength: length,
          eol,
          closed: info.padded || !hasNewline,
        };
      }
    } else {
      finish();
    }
    pos = next;
  }
  finish();
  return runs;
}

/** The base64 text of a run without line endings. */
function runContent(raw: Buffer, run: Base64Run): string {
  const text = raw.subarray(run.start, run.end).toString('latin1');
  return run.eol === 'crlf' ? text.replace(/\r\n/g, '') : text.replace(/\n/g, '');
}

/** Encodes part bytes exactly as the run was laid out. */
export function encodeRunLayout(
  data: Buffer,
  layout: Pick<StrippedPart, 'lineLength' | 'eol' | 'finalEol'>,
): Buffer {
  const b64 = data.toString('base64');
  const eol = layout.eol === 'crlf' ? '\r\n' : '\n';
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += layout.lineLength) lines.push(b64.slice(i, i + layout.lineLength));
  return Buffer.from(lines.join(eol) + (layout.finalEol ? eol : ''), 'latin1');
}

/**
 * Decodes a run when its decoded bytes re-encode to exactly the same bytes,
 * else null (non-canonical base64 stays in the stored original).
 */
export function decodeRunExactly(raw: Buffer, run: Base64Run): Buffer | null {
  const content = runContent(raw, run);
  if (content.length === 0 || content.length % 4 !== 0) return null;
  const data = Buffer.from(content, 'base64');
  if (data.toString('base64') !== content) return null;
  const reencoded = encodeRunLayout(data, run);
  if (!reencoded.equals(raw.subarray(run.start, run.end))) return null;
  return data;
}

export function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Takes the given runs out of the original: the skeleton keeps everything
 * else, `parts` says where each part goes back in.
 */
export function stripRuns(
  raw: Buffer,
  runs: ReadonlyArray<{ run: Base64Run; sha256: string; size: number }>,
): { skeleton: Buffer; parts: StrippedPart[] } {
  const ordered = [...runs].sort((a, b) => a.run.start - b.run.start);
  const pieces: Buffer[] = [];
  const parts: StrippedPart[] = [];
  let cursor = 0;
  let skeletonLength = 0;
  for (const { run, sha256, size } of ordered) {
    if (run.start < cursor) throw new Error('overlapping base64 runs');
    const keep = raw.subarray(cursor, run.start);
    pieces.push(keep);
    skeletonLength += keep.length;
    parts.push({
      at: skeletonLength,
      sha256,
      size,
      lineLength: run.lineLength,
      eol: run.eol,
      finalEol: run.finalEol,
      encodedLength: run.end - run.start,
    });
    cursor = run.end;
  }
  pieces.push(raw.subarray(cursor));
  return { skeleton: Buffer.concat(pieces), parts };
}

/** Uncompressed container: magic, version, JSON length, JSON part list, skeleton. */
export function packPartsContainer(skeleton: Buffer, parts: readonly StrippedPart[]): Buffer {
  const json = Buffer.from(JSON.stringify({ parts }), 'utf8');
  const header = Buffer.alloc(MAGIC.length + 1 + 4);
  MAGIC.copy(header, 0);
  header.writeUInt8(CONTAINER_VERSION, MAGIC.length);
  header.writeUInt32BE(json.length, MAGIC.length + 1);
  return Buffer.concat([header, json, skeleton]);
}

export function unpackPartsContainer(container: Buffer): { skeleton: Buffer; parts: StrippedPart[] } {
  const headerLength = MAGIC.length + 1 + 4;
  if (container.length < headerLength || !container.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('not a raw parts container');
  }
  const version = container.readUInt8(MAGIC.length);
  if (version !== CONTAINER_VERSION) throw new Error(`unsupported raw parts container version ${version}`);
  const jsonLength = container.readUInt32BE(MAGIC.length + 1);
  const jsonEnd = headerLength + jsonLength;
  if (jsonEnd > container.length) throw new Error('truncated raw parts container');
  const parsed = JSON.parse(container.subarray(headerLength, jsonEnd).toString('utf8')) as { parts?: unknown };
  if (!Array.isArray(parsed.parts)) throw new Error('raw parts container without part list');
  const parts = parsed.parts.map((part) => validatePart(part));
  return { skeleton: container.subarray(jsonEnd), parts };
}

function validatePart(value: unknown): StrippedPart {
  const part = value as Partial<StrippedPart>;
  const okInt = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0;
  if (
    !okInt(part.at) || !okInt(part.size) || !okInt(part.encodedLength)
    || !okInt(part.lineLength) || (part.lineLength ?? 0) < 1
    || typeof part.sha256 !== 'string' || !SHA256_PATTERN.test(part.sha256)
    || (part.eol !== 'crlf' && part.eol !== 'lf') || typeof part.finalEol !== 'boolean'
  ) {
    throw new Error('invalid part in raw parts container');
  }
  return part as StrippedPart;
}

/** Puts the parts back; readPart must return the verified part bytes. */
export async function reassembleParts(
  skeleton: Buffer,
  parts: readonly StrippedPart[],
  readPart: (sha256: string, size: number) => Promise<Buffer>,
): Promise<Buffer> {
  const pieces: Buffer[] = [];
  let cursor = 0;
  for (const part of parts) {
    if (part.at < cursor || part.at > skeleton.length) throw new Error('raw parts out of order');
    pieces.push(skeleton.subarray(cursor, part.at));
    const encoded = encodeRunLayout(await readPart(part.sha256, part.size), part);
    if (encoded.length !== part.encodedLength) {
      throw new Error(`re-encoded part ${part.sha256} has ${encoded.length} bytes, expected ${part.encodedLength}`);
    }
    pieces.push(encoded);
    cursor = part.at;
  }
  pieces.push(skeleton.subarray(cursor));
  return Buffer.concat(pieces);
}

/** Directory of a workspace's part objects, or null for an unsafe workspace id. */
export function rawPartsDir(attachmentsRoot: string, workspaceId: string): string | null {
  if (!UUID_PATTERN.test(workspaceId)) return null;
  return path.join(path.resolve(attachmentsRoot), workspaceId, 'raw-parts');
}

export function rawPartPath(partsDir: string, sha256: string): string {
  if (!SHA256_PATTERN.test(sha256)) throw new Error('invalid part sha256');
  return path.join(partsDir, sha256.slice(0, 2), sha256);
}

/** Where mail-raw-part-gc keeps parts no original names, before removing them. */
export function setAsidePartsDir(partsDir: string): string {
  return path.join(partsDir, '.unreferenced');
}

/** Name of a set-aside part: `<sha256>.<ms since epoch when it was set aside>`. */
export function setAsidePartPath(partsDir: string, sha256: string, setAsideAt: number): string {
  if (!SHA256_PATTERN.test(sha256)) throw new Error('invalid part sha256');
  return path.join(setAsidePartsDir(partsDir), sha256.slice(0, 2), `${sha256}.${Math.floor(setAsideAt)}`);
}

export function parseSetAsidePartName(name: string): { sha256: string; setAsideAt: number } | null {
  const match = /^([0-9a-f]{64})\.(\d{1,16})$/.exec(name);
  return match ? { sha256: match[1]!, setAsideAt: Number(match[2]) } : null;
}

/** Set-aside copies of one part, newest first. */
export async function findSetAsideParts(partsDir: string, sha256: string): Promise<string[]> {
  if (!SHA256_PATTERN.test(sha256)) return [];
  const dir = path.join(setAsidePartsDir(partsDir), sha256.slice(0, 2));
  const names = await readdir(dir).catch(() => [] as string[]);
  return names
    .map((name) => ({ name, parsed: parseSetAsidePartName(name) }))
    .filter((entry) => entry.parsed?.sha256 === sha256)
    .sort((a, b) => b.parsed!.setAsideAt - a.parsed!.setAsideAt)
    .map((entry) => path.join(dir, entry.name));
}

function verifiedPart(data: Buffer, sha256: string, size: number): Buffer {
  if (data.length !== size || sha256Hex(data) !== sha256) {
    throw new Error(`raw part ${sha256} is damaged`);
  }
  return data;
}

/**
 * Reads a part object and checks size and sha256. A part the GC has set aside
 * (a message named it again right after the check) is still found there.
 */
export async function readVerifiedPart(partsDir: string, sha256: string, size: number): Promise<Buffer> {
  try {
    return verifiedPart(await readFile(rawPartPath(partsDir, sha256)), sha256, size);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    for (const candidate of await findSetAsideParts(partsDir, sha256)) {
      const data = await readFile(candidate).catch(() => null);
      if (data && data.length === size && sha256Hex(data) === sha256) return data;
    }
    throw error;
  }
}

export async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Makes sure a part object exists as a hard link of `sourceFile`, whose
 * content must have the given sha256 and size. Returns false when that is not
 * possible without a copy (a copy would not save any space).
 */
export async function ensurePartObject(
  partsDir: string,
  sha256: string,
  size: number,
  sourceFile: string,
): Promise<boolean> {
  const target = rawPartPath(partsDir, sha256);
  const existing = await stat(target).catch(() => null);
  if (existing) return existing.isFile() && existing.size === size;
  const source = await stat(sourceFile).catch(() => null);
  if (!source || !source.isFile() || source.size !== size) return false;
  if (await fileSha256(sourceFile) !== sha256) return false;
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await link(sourceFile, target);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      const now = await stat(target).catch(() => null);
      return Boolean(now?.isFile() && now.size === size);
    }
    return false;
  }
}
