const sync: Record<string, string> = {};
jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (k: string) => sync[k] ?? '',
  setSyncInfo: (k: string, v: string) => {
    sync[k] = v;
  },
}));
jest.mock('../../electron/email/email-ai-profiles', () => ({
  getResolvedAiRuntime: jest.fn(),
  getAiProfileById: jest.fn(),
}));

import { getAiProfileById, getResolvedAiRuntime } from '../../electron/email/email-ai-profiles';
import {
  getAiSettings,
  runAiDecideCall,
  runChatCompletion,
  runEmbedding,
  setAiSettings,
  testAiProfileConnection,
} from '../../electron/email/email-openai';

const runtimeMock = getResolvedAiRuntime as jest.Mock;
const profileByIdMock = getAiProfileById as jest.Mock;

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

  describe('OpenRouter Decisions API und KI-Entscheidung', () => {
    const decisionsRuntime = {
      apiKey: 'or-secret-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'typesafe/jev-1.13',
      embeddingModel: '',
      profileLabel: 'Jev',
      provider: 'openrouter_decisions',
    };

    test('Chat-Aufruf mit Entscheidungsmodell-Profil meldet den Baustein klar', async () => {
      runtimeMock.mockResolvedValueOnce(decisionsRuntime);
      await expect(runChatCompletion('s', 'u', 5)).rejects.toThrow(
        'Dieses KI-Profil nutzt die OpenRouter Decisions API und funktioniert nur im Baustein „KI-Entscheidung“.',
      );
      expect(fetchMock).not.toHaveBeenCalled();
      runtimeMock.mockResolvedValueOnce(decisionsRuntime);
      expect(await runEmbedding('text', 5)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('Entscheidungsmodell: POST …/alpha/decisions mit noul-Frage, Bearer und Zeitlimit', async () => {
      runtimeMock.mockResolvedValue(decisionsRuntime);
      fetchMock.mockResolvedValueOnce(jsonResponse({
        answers: { decision: { type: 'noul', noul: 0.12 } },
        usage: { input_tokens: 50, output_tokens: 1, cost: 0.0001 },
      }));
      const result = await runAiDecideCall({
        profileId: 5,
        question: 'Ist das Spam?',
        yesCriteria: 'Werbung',
        noCriteria: '',
        contextText: 'E-Mail',
        state: { email: { subject: 'Hallo' } },
      });
      expect(result).toEqual({ source: 'decisions', probability: 12, modelAnswer: null, reason: '', model: 'typesafe/jev-1.13' });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer or-secret-key', 'Content-Type': 'application/json' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(init.body)).toEqual({
        model: 'typesafe/jev-1.13',
        state: { email: { subject: 'Hallo' } },
        questions: {
          decision: { type: 'noul', instructions: 'Ist das Spam?', criteria: { true: 'Werbung', false: 'Nein' } },
        },
      });
    });

    test('Entscheidungsmodell: Fehlerfälle werfen mit Modell (für ai.decide.model)', async () => {
      runtimeMock.mockResolvedValue(decisionsRuntime);
      fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
      await expect(runAiDecideCall({ question: 'q', contextText: '', state: {} })).rejects.toMatchObject({
        message: 'Decisions-Anfrage fehlgeschlagen: 429 rate limited',
        aiModel: 'typesafe/jev-1.13',
      });
      fetchMock.mockResolvedValueOnce(jsonResponse({ answers: { decision: { noul: 'n/a' } } }));
      await expect(runAiDecideCall({ question: 'q', contextText: '', state: {} })).rejects.toThrow(
        /keine verwertbare Ja-Wahrscheinlichkeit/,
      );
      const { response, stats } = trackedResponse(`{"answers":{"decision":{"noul":0.5}},"x":"${'x'.repeat(8 * KIB * KIB)}"}`, 200);
      fetchMock.mockResolvedValueOnce(response);
      await expect(runAiDecideCall({ question: 'q', contextText: '', state: {} })).rejects.toThrow(/zu groß/);
      expect(stats.pulled).toBeLessThanOrEqual(4 * KIB * KIB + CHUNK);
      runtimeMock.mockResolvedValueOnce({ ...decisionsRuntime, apiKey: '' });
      await expect(runAiDecideCall({ question: 'q', contextText: '', state: {} })).rejects.toThrow(/API-Schlüssel/);
    });

    test('Entscheidungsmodell: Zeitüberschreitung nennt 30 Sekunden', async () => {
      runtimeMock.mockResolvedValue(decisionsRuntime);
      fetchMock.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
      await expect(runAiDecideCall({ question: 'q', contextText: '', state: {} })).rejects.toThrow(/30 Sekunden/);
    });

    test('Chat-Modell: JSON-Antwort wird ausgewertet, Prompt fordert das Format', async () => {
      runtimeMock.mockResolvedValue({ ...decisionsRuntime, provider: 'openai', baseUrl: 'https://api.example/v1', model: 'gpt-test' });
      fetchMock.mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: '```json\n{"antwort":"ja","wahrscheinlichkeit_ja":88,"begruendung":"Werbung"}\n```' } }],
      }));
      const result = await runAiDecideCall({ question: 'Spam?', contextText: 'Betreff: Gewinn', state: {} });
      expect(result).toEqual({ source: 'chat', probability: 88, modelAnswer: 'ja', reason: 'Werbung', model: 'gpt-test' });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://api.example/v1/chat/completions');
      const body = JSON.parse(init.body);
      expect(body.messages[0].content).toContain('"wahrscheinlichkeit_ja"');
      expect(body.messages[1].content).toContain('Betreff: Gewinn');

      fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Keine Ahnung.' } }] }));
      await expect(runAiDecideCall({ question: 'Spam?', contextText: '', state: {} })).rejects.toMatchObject({ aiModel: 'gpt-test' });
    });

    test('Verbindung testen: Entscheidungsmodell mit Testfrage, Chat mit „Antworte nur mit OK.“', async () => {
      profileByIdMock.mockReturnValue({ id: 5 });
      runtimeMock.mockResolvedValueOnce(decisionsRuntime);
      fetchMock.mockResolvedValueOnce(jsonResponse({ answers: { decision: { noul: 0.97 } } }));
      const decisionsResult = await testAiProfileConnection(5);
      expect(decisionsResult).toMatchObject({
        ok: true,
        model: 'typesafe/jev-1.13',
        probability: 97,
        message: 'Verbindung erfolgreich (Ja-Wahrscheinlichkeit 97 %)',
      });
      expect(decisionsResult.latencyMs).toBeGreaterThanOrEqual(0);
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
        state: 'connection test',
        questions: { decision: { type: 'noul', instructions: 'Is this a connection test?' } },
      });

      runtimeMock.mockResolvedValueOnce({ ...decisionsRuntime, provider: 'openai', baseUrl: 'https://api.example/v1', model: 'gpt-test' });
      fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'OK' } }] }));
      const chatResult = await testAiProfileConnection(5);
      expect(chatResult).toMatchObject({ ok: true, model: 'gpt-test', message: 'Verbindung erfolgreich – Antwort: OK' });
      expect(chatResult.probability).toBeUndefined();
      const chatBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
      expect(chatBody.messages[0].content).toBe('Antworte nur mit OK.');
    });

    test('Verbindung testen: Fehler ohne Secret, unbekanntes Profil', async () => {
      profileByIdMock.mockReturnValue({ id: 5 });
      runtimeMock.mockResolvedValueOnce(decisionsRuntime);
      fetchMock.mockResolvedValueOnce(new Response('invalid key or-secret-key', { status: 401 }));
      const failed = await testAiProfileConnection(5);
      expect(failed.ok).toBe(false);
      expect(failed.message).toContain('401');
      expect(failed.message).not.toContain('or-secret-key');

      profileByIdMock.mockReturnValue(undefined);
      expect(await testAiProfileConnection(99)).toEqual({ ok: false, message: 'KI-Profil nicht gefunden', model: '', latencyMs: 0 });
    });
  });
});
