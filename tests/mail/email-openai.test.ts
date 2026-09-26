const sync: Record<string, string> = {};
jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (k: string) => sync[k] ?? '',
  setSyncInfo: (k: string, v: string) => {
    sync[k] = v;
  },
}));
jest.mock('../../electron/email/email-ai-profiles', () => ({
  getResolvedAiRuntime: jest.fn(),
}));

import { getResolvedAiRuntime } from '../../electron/email/email-ai-profiles';
import { getAiSettings, runChatCompletion, runEmbedding, setAiSettings } from '../../electron/email/email-openai';

const runtimeMock = getResolvedAiRuntime as jest.Mock;

const KIB = 1024;
const CHUNK = 64 * KIB;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

/** Streams `body` in 64 KiB pulls and records how much the client read. */
function trackedResponse(body: string, status: number) {
  const bytes = new TextEncoder().encode(body);
  const stats = { pulled: 0, cancelled: false };
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        const chunk = bytes.subarray(offset, offset + CHUNK);
        offset += chunk.length;
        stats.pulled += chunk.length;
        controller.enqueue(chunk);
      },
      cancel() {
        stats.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(stream, { status }), stats };
}

describe('email-openai', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(sync).forEach((k) => delete sync[k]);
    global.fetch = fetchMock as typeof fetch;
    runtimeMock.mockResolvedValue({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example/v1',
      model: 'gpt-test',
      embeddingModel: 'embed-test',
      profileLabel: 'Default',
    });
  });

  test('getAiSettings defaults and setAiSettings', () => {
    expect(getAiSettings().baseUrl).toBe('https://api.openai.com/v1');
    setAiSettings({ baseUrl: 'https://custom/v1/', model: 'gpt-4' });
    expect(getAiSettings()).toEqual({
      baseUrl: 'https://custom/v1',
      model: 'gpt-4',
      embeddingModel: 'text-embedding-3-small',
    });
  });

  test('runChatCompletion returns assistant text', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ choices: [{ message: { content: '  Hallo  ' } }] }),
    );
    const text = await runChatCompletion('sys', 'user');
    expect(text).toBe('Hallo');
  });

  test('runChatCompletion throws without api key', async () => {
    runtimeMock.mockResolvedValueOnce({ apiKey: '', baseUrl: 'https://x', model: 'm', embeddingModel: 'e' });
    await expect(runChatCompletion('s', 'u')).rejects.toThrow(/API-Schlüssel/);
    runtimeMock.mockResolvedValueOnce({
      apiKey: '',
      baseUrl: 'https://x',
      model: 'm',
      embeddingModel: 'e',
      profileLabel: 'Profil A',
    });
    await expect(runChatCompletion('s', 'u', 1)).rejects.toThrow(/Profil A/);
  });

  test('runChatCompletion handles http and empty response errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('err', { status: 500 }));
    await expect(runChatCompletion('s', 'u')).rejects.toThrow(/fehlgeschlagen/);
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [] }));
    await expect(runChatCompletion('s', 'u')).rejects.toThrow(/Leere/);
  });

  test('runEmbedding returns vector or null', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ data: [{ embedding: [0.1, 0.2] }] }));
    expect(await runEmbedding('text')).toEqual([0.1, 0.2]);
    runtimeMock.mockResolvedValueOnce({ apiKey: '', baseUrl: 'x', model: 'm', embeddingModel: 'e' });
    expect(await runEmbedding('t')).toBeNull();
    expect(await runEmbedding('  ')).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    expect(await runEmbedding('hello')).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('net'));
    expect(await runEmbedding('hello')).toBeNull();
  });

  // C-A23: success and error bodies of the AI endpoint were buffered without a byte limit.
  test('runChatCompletion stops reading an oversized answer at 4 MiB', async () => {
    const huge = `{"choices":[{"message":{"content":"${'x'.repeat(8 * KIB * KIB)}"}}]}`;
    const { response, stats } = trackedResponse(huge, 200);
    fetchMock.mockResolvedValueOnce(response);

    await expect(runChatCompletion('s', 'u')).rejects.toThrow(/zu groß/);
    expect(stats.cancelled).toBe(true);
    expect(stats.pulled).toBeLessThanOrEqual(4 * KIB * KIB + CHUNK);
  });

  test('runChatCompletion reads at most 64 KiB of an error body', async () => {
    const { response, stats } = trackedResponse('e'.repeat(KIB * KIB), 500);
    fetchMock.mockResolvedValueOnce(response);

    await expect(runChatCompletion('s', 'u')).rejects.toThrow(`KI-Anfrage fehlgeschlagen: 500 ${'e'.repeat(200)}`);
    expect(stats.cancelled).toBe(true);
    expect(stats.pulled).toBeLessThanOrEqual(64 * KIB + CHUNK);
  });

  test('runEmbedding returns null for an oversized answer without reading it all', async () => {
    const vector = new Array(1_000_000).fill('0.123456789').join(',');
    const { response, stats } = trackedResponse(`{"data":[{"embedding":[${vector}]}]}`, 200);
    fetchMock.mockResolvedValueOnce(response);

    expect(await runEmbedding('hello')).toBeNull();
    expect(stats.cancelled).toBe(true);
    expect(stats.pulled).toBeLessThanOrEqual(4 * KIB * KIB + CHUNK);
  });
});
