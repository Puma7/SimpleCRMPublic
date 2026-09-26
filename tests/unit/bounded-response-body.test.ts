/**
 * @jest-environment node
 */
import {
  readBoundedResponseJson,
  readBoundedResponseText,
  ResponseBodyTooLargeError,
} from '../../packages/core/src/net/bounded-body';

function chunkedResponse(chunks: string[]): { response: Response; stats: { cancelled: boolean } } {
  const encoded = chunks.map((c) => new TextEncoder().encode(c));
  const stats = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const next = encoded.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
      cancel() {
        stats.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(stream), stats };
}

// C-A23: shared reader behind the desktop AI/Rspamd clients' byte limits.
describe('bounded response body readers', () => {
  test('return normal bodies unchanged', async () => {
    await expect(readBoundedResponseText(new Response('hällo'), 1024)).resolves.toBe('hällo');
    await expect(readBoundedResponseJson(new Response('{"a":[1,2]}'), 1024)).resolves.toEqual({ a: [1, 2] });
    await expect(readBoundedResponseText(new Response(null, { status: 204 }), 1024)).resolves.toBe('');
  });

  test('a body of exactly the limit is complete, one byte more is cut and cancelled', async () => {
    const exact = chunkedResponse(['abcd', 'efgh']);
    await expect(readBoundedResponseJson(chunkedResponse(['"abc', 'def"']).response, 8)).resolves.toBe('abcdef');
    await expect(readBoundedResponseText(exact.response, 8)).resolves.toBe('abcdefgh');
    expect(exact.stats.cancelled).toBe(false);

    const over = chunkedResponse(['abcd', 'efgh', 'i', 'never-read']);
    await expect(readBoundedResponseText(over.response, 8)).resolves.toBe('abcdefgh');
    expect(over.stats.cancelled).toBe(true);
  });

  test('JSON over the limit is rejected instead of parsed', async () => {
    const { response, stats } = chunkedResponse(['{"a":"', 'x'.repeat(64), '"}']);
    await expect(readBoundedResponseJson(response, 16)).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
    expect(stats.cancelled).toBe(true);
  });
});
