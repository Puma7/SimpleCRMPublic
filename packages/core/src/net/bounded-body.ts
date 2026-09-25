/** The part of a fetch Response the bounded readers use. */
export type StreamedResponse = Readonly<{ body: ReadableStream<Uint8Array> | null }>;

export class ResponseBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Antwort zu groß (max ${Math.floor(maxBytes / 1024)} KiB)`);
    this.name = 'ResponseBodyTooLargeError';
  }
}

/**
 * Reads at most `maxBytes` of a response body (as delivered by fetch, i.e.
 * after decompression) and cancels the stream beyond that, so an oversized or
 * endless body is never buffered whole.
 */
async function readBoundedBytes(
  res: StreamedResponse,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { bytes: concatChunks(chunks, total), truncated: false };
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      await reader.cancel().catch(() => undefined);
      return { bytes: concatChunks(chunks, total), truncated: true };
    }
    chunks.push(value);
    total += value.byteLength;
  }
}

/** Like `res.text()`, but cut off after `maxBytes` (for previews such as error texts). */
export async function readBoundedResponseText(res: StreamedResponse, maxBytes: number): Promise<string> {
  const { bytes } = await readBoundedBytes(res, maxBytes);
  return new TextDecoder().decode(bytes);
}

/** Like `res.json()`, but throws ResponseBodyTooLargeError instead of buffering more than `maxBytes`. */
export async function readBoundedResponseJson(res: StreamedResponse, maxBytes: number): Promise<unknown> {
  const { bytes, truncated } = await readBoundedBytes(res, maxBytes);
  if (truncated) throw new ResponseBodyTooLargeError(maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
