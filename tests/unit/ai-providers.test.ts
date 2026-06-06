import { callAiChat, normalizeAiProvider, parseProviderResponse } from '../../packages/server/src';

type CapturedRequest = { url: string; init: RequestInit };

function fakeFetch(body: unknown, captured: CapturedRequest[], status = 200): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    captured.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return typeof body === 'string' ? body : JSON.stringify(body);
      },
    };
  }) as unknown as typeof fetch;
}

const baseReq = {
  baseUrl: 'https://api.example.com',
  model: 'test-model',
  apiKey: 'sk-secret',
  system: 'Sys',
  user: 'Hallo',
  temperature: 0.2,
  signal: new AbortController().signal,
};

describe('normalizeAiProvider', () => {
  test('maps known aliases, defaults to openai', () => {
    expect(normalizeAiProvider('anthropic')).toBe('anthropic');
    expect(normalizeAiProvider('claude')).toBe('anthropic');
    expect(normalizeAiProvider('gemini')).toBe('gemini');
    expect(normalizeAiProvider('google')).toBe('gemini');
    expect(normalizeAiProvider('openai_compatible')).toBe('openai');
    expect(normalizeAiProvider('')).toBe('openai');
    expect(normalizeAiProvider(null)).toBe('openai');
  });
});

describe('callAiChat — openai-compatible', () => {
  test('posts to /chat/completions with bearer auth and parses content + usage', async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = fakeFetch(
      { choices: [{ message: { content: 'Antwort' } }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } },
      captured,
    );
    const result = await callAiChat({ ...baseReq, provider: 'openai_compatible', fetchImpl });
    expect(captured[0].url).toBe('https://api.example.com/chat/completions');
    expect((captured[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret');
    expect(result).toEqual({ content: 'Antwort', usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 } });
  });
});

describe('callAiChat — anthropic', () => {
  test('posts to /v1/messages with x-api-key and normalises usage', async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = fakeFetch(
      { content: [{ type: 'text', text: 'Claude-Antwort' }], usage: { input_tokens: 20, output_tokens: 7 } },
      captured,
    );
    const result = await callAiChat({ ...baseReq, provider: 'anthropic', fetchImpl });
    expect(captured[0].url).toBe('https://api.example.com/v1/messages');
    const headers = captured[0].init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const sentBody = JSON.parse(captured[0].init.body as string);
    expect(sentBody.system).toBe('Sys');
    expect(sentBody.messages).toEqual([{ role: 'user', content: 'Hallo' }]);
    expect(result).toEqual({ content: 'Claude-Antwort', usage: { promptTokens: 20, completionTokens: 7, totalTokens: 27 } });
  });
});

describe('callAiChat — gemini', () => {
  test('posts to generateContent with key query and normalises usageMetadata', async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = fakeFetch(
      {
        candidates: [{ content: { parts: [{ text: 'Gemini' }, { text: '-Antwort' }] } }],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 9, totalTokenCount: 39 },
      },
      captured,
    );
    const result = await callAiChat({ ...baseReq, provider: 'gemini', fetchImpl });
    expect(captured[0].url).toBe('https://api.example.com/v1beta/models/test-model:generateContent?key=sk-secret');
    const sentBody = JSON.parse(captured[0].init.body as string);
    expect(sentBody.systemInstruction).toEqual({ parts: [{ text: 'Sys' }] });
    expect(sentBody.contents).toEqual([{ role: 'user', parts: [{ text: 'Hallo' }] }]);
    expect(result).toEqual({ content: 'Gemini-Antwort', usage: { promptTokens: 30, completionTokens: 9, totalTokens: 39 } });
  });
});

describe('callAiChat — errors', () => {
  test('throws a KI API HTTP error on non-2xx', async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = fakeFetch('rate limited', captured, 429);
    await expect(callAiChat({ ...baseReq, provider: 'openai', fetchImpl })).rejects.toThrow('KI API HTTP 429');
  });

  test('parseProviderResponse tolerates malformed bodies', () => {
    expect(parseProviderResponse('openai', 'not json')).toEqual({ content: 'not json', usage: null });
  });
});
