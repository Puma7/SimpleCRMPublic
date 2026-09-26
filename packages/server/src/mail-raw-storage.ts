/**
 * Storage of the raw RFC 822 original of a message (email_messages).
 *
 * New rows keep the original brotli-compressed in `raw_rfc822_z` (bytea)
 * instead of base64 text in `raw_rfc822_b64`: no base64 overhead (+33 %) and
 * the text parts compress well. `raw_rfc822_sha256` and `raw_rfc822_size`
 * describe the ORIGINAL bytes; every write proves the round trip before it is
 * stored and every read checks the hash, so a damaged original is reported,
 * never passed on silently.
 *
 * Search never reads the original (it uses subject, body_text, addresses and
 * attachment text with their own indexes), so compression does not change
 * search results or speed. Readers: raw source / .eml download, the mailauth
 * and Rspamd checks, Rspamd learning.
 *
 * Legacy rows (base64 text only) stay readable; mail-raw-compression-backfill
 * converts them in the background.
 */
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { brotliCompress, brotliDecompress, constants as zlibConstants } from 'node:zlib';

import {
  packPartsContainer,
  rawPartsDir,
  readVerifiedPart,
  reassembleParts,
  unpackPartsContainer,
  type StrippedPart,
} from './mail-raw-parts';

const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

export const STORED_RAW_CODEC_BROTLI = 'br';
/** Attachment parts that exist as files are taken out (mail-raw-parts.ts). */
export const STORED_RAW_CODEC_PARTS = 'br-parts';

/** Returns the verified bytes of a taken-out part (size and sha256 checked). */
export type RawPartReader = (sha256: string, size: number) => Promise<Buffer>;

export type LoadStoredRawOptions = Readonly<{ readPart?: RawPartReader }>;

/** Part reader of a workspace, or undefined without an attachments root. */
export function rawPartReaderFor(attachmentsRoot: string | undefined, workspaceId: string): RawPartReader | undefined {
  if (!attachmentsRoot) return undefined;
  const dir = rawPartsDir(attachmentsRoot, workspaceId);
  if (!dir) return undefined;
  return (sha256, size) => readVerifiedPart(dir, sha256, size);
}

/** Quality 5: about gzip -9 ratio at gzip -6 speed; decompression is fast at any level. */
const BROTLI_QUALITY = 5;

export const storedRawColumns = [
  'raw_rfc822_b64',
  'raw_rfc822_z',
  'raw_rfc822_codec',
  'raw_rfc822_sha256',
  'raw_rfc822_size',
  'raw_rfc822_part_sha256s',
] as const;

export type StoredRawColumns = {
  raw_rfc822_b64?: string | null;
  raw_rfc822_z?: Buffer | Uint8Array | null;
  raw_rfc822_codec?: string | null;
  raw_rfc822_sha256?: string | null;
  raw_rfc822_size?: number | string | bigint | null;
  raw_rfc822_part_sha256s?: readonly string[] | null;
};

export type EncodedStoredRaw = {
  raw_rfc822_b64: null;
  raw_rfc822_z: Buffer;
  raw_rfc822_codec: typeof STORED_RAW_CODEC_BROTLI;
  raw_rfc822_sha256: string;
  raw_rfc822_size: number;
  raw_rfc822_part_sha256s: null;
};

/** The stored original does not match its recorded hash or size, or cannot be decoded. */
export class StoredRawIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoredRawIntegrityError';
  }
}

export function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compresses an original for storage and proves the round trip: the stored
 * value decompresses to exactly the input, or this throws and nothing is stored.
 */
export async function encodeRawForStorage(source: Buffer | Uint8Array): Promise<EncodedStoredRaw> {
  const original = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const compressed = await brotliCompressAsync(original, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: original.length,
    },
  });
  const sha256 = sha256Hex(original);
  const roundTrip = await brotliDecompressAsync(compressed);
  if (roundTrip.length !== original.length || sha256Hex(roundTrip) !== sha256) {
    throw new StoredRawIntegrityError('compressed original does not round-trip');
  }
  return {
    raw_rfc822_b64: null,
    raw_rfc822_z: compressed,
    raw_rfc822_codec: STORED_RAW_CODEC_BROTLI,
    raw_rfc822_sha256: sha256,
    raw_rfc822_size: original.length,
    raw_rfc822_part_sha256s: null,
  };
}

export function hasStoredRaw(row: StoredRawColumns): boolean {
  return Boolean(row.raw_rfc822_z && row.raw_rfc822_z.length > 0) || Boolean(row.raw_rfc822_b64?.trim());
}

export type EncodedStoredRawParts = {
  raw_rfc822_b64: null;
  raw_rfc822_z: Buffer;
  raw_rfc822_codec: typeof STORED_RAW_CODEC_PARTS;
  raw_rfc822_sha256: string;
  raw_rfc822_size: number;
  raw_rfc822_part_sha256s: string[];
};

/**
 * Stores an original without the given parts and proves that reading it back
 * through `readPart` yields exactly the original; otherwise this throws and
 * nothing is stored.
 */
export async function encodeRawWithPartsForStorage(
  original: Buffer,
  stripped: { skeleton: Buffer; parts: readonly StrippedPart[] },
  readPart: RawPartReader,
): Promise<EncodedStoredRawParts> {
  const container = packPartsContainer(stripped.skeleton, stripped.parts);
  const compressed = await brotliCompressAsync(container, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: container.length,
    },
  });
  const encoded: EncodedStoredRawParts = {
    raw_rfc822_b64: null,
    raw_rfc822_z: compressed,
    raw_rfc822_codec: STORED_RAW_CODEC_PARTS,
    raw_rfc822_sha256: sha256Hex(original),
    raw_rfc822_size: original.length,
    raw_rfc822_part_sha256s: [...new Set(stripped.parts.map((part) => part.sha256))],
  };
  const roundTrip = await loadStoredRaw(encoded, { readPart });
  if (!roundTrip || !roundTrip.equals(original)) {
    throw new StoredRawIntegrityError('original without parts does not round-trip');
  }
  return encoded;
}

/**
 * The original bytes of a stored message, or null when none is stored.
 * Throws StoredRawIntegrityError when the stored value is damaged or a
 * taken-out part is missing.
 */
export async function loadStoredRaw(
  row: StoredRawColumns,
  options: LoadStoredRawOptions = {},
): Promise<Buffer | null> {
  if (row.raw_rfc822_z && row.raw_rfc822_z.length > 0) {
    const codec = row.raw_rfc822_codec;
    if (codec !== STORED_RAW_CODEC_BROTLI && codec !== STORED_RAW_CODEC_PARTS) {
      throw new StoredRawIntegrityError(`unknown raw_rfc822_codec ${String(codec)}`);
    }
    let original: Buffer;
    try {
      original = await brotliDecompressAsync(Buffer.from(row.raw_rfc822_z));
    } catch (error) {
      throw new StoredRawIntegrityError(`stored original cannot be decompressed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (codec === STORED_RAW_CODEC_PARTS) {
      if (!options.readPart) {
        throw new StoredRawIntegrityError('stored original needs its attachment parts, but no attachments root is configured');
      }
      try {
        const { skeleton, parts } = unpackPartsContainer(original);
        original = await reassembleParts(skeleton, parts, options.readPart);
      } catch (error) {
        throw new StoredRawIntegrityError(`stored original cannot be reassembled: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const expectedSize = row.raw_rfc822_size === null || row.raw_rfc822_size === undefined
      ? null
      : Number(row.raw_rfc822_size);
    if (expectedSize !== null && original.length !== expectedSize) {
      throw new StoredRawIntegrityError(`stored original has ${original.length} bytes, expected ${expectedSize}`);
    }
    if (!row.raw_rfc822_sha256 || sha256Hex(original) !== row.raw_rfc822_sha256) {
      throw new StoredRawIntegrityError('stored original does not match its sha256');
    }
    return original;
  }
  const encoded = row.raw_rfc822_b64?.trim();
  if (!encoded) return null;
  return Buffer.from(encoded, 'base64');
}

/**
 * For checks that judge the message itself (mailauth, rspamd): the original,
 * null when none was ever stored, or 'damaged' when one is stored but cannot be
 * read back. A damaged original must not be replaced by a message rebuilt from
 * headers and text: its verdict would be stored as if it were the real one.
 */
export async function loadStoredRawForCheck(
  row: StoredRawColumns,
  context: string,
  options: LoadStoredRawOptions = {},
): Promise<Buffer | null | 'damaged'> {
  try {
    return await loadStoredRaw(row, options);
  } catch (error) {
    console.error(`[mail] ${context} skipped, stored original unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return 'damaged';
  }
}

/** Like loadStoredRaw, but a damaged original is logged and treated as missing (display only). */
export async function loadStoredRawOrNull(
  row: StoredRawColumns,
  context: string,
  options: LoadStoredRawOptions = {},
): Promise<Buffer | null> {
  try {
    return await loadStoredRaw(row, options);
  } catch (error) {
    console.error(`[mail] ${context}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
