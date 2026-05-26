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
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '  Hallo  ' } }] }),
    });
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
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' });
    await expect(runChatCompletion('s', 'u')).rejects.toThrow(/fehlgeschlagen/);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [] }) });
    await expect(runChatCompletion('s', 'u')).rejects.toThrow(/Leere/);
  });

  test('runEmbedding returns vector or null', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
    });
    expect(await runEmbedding('text')).toEqual([0.1, 0.2]);
    runtimeMock.mockResolvedValueOnce({ apiKey: '', baseUrl: 'x', model: 'm', embeddingModel: 'e' });
    expect(await runEmbedding('t')).toBeNull();
    expect(await runEmbedding('  ')).toBeNull();
    fetchMock.mockResolvedValueOnce({ ok: false });
    expect(await runEmbedding('hello')).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('net'));
    expect(await runEmbedding('hello')).toBeNull();
  });
});
