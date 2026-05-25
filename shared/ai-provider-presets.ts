/** Shared OpenAI-compatible provider defaults (renderer + Electron main). */
export type AiProviderPresetId =
  | 'openai'
  | 'openrouter'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'ollama'
  | 'custom';

export type AiProviderPresetConfig = {
  label: string;
  baseUrl: string;
  defaultModel: string;
  /** Optional; used for Wissensbasis / semantic search when set on the profile. */
  defaultEmbeddingModel?: string;
};

export const AI_PROVIDER_PRESETS: Record<AiProviderPresetId, AiProviderPresetConfig> = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    defaultEmbeddingModel: 'text-embedding-3-small',
  },
  openrouter: {
    label: 'Open Router',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    defaultEmbeddingModel: 'openai/text-embedding-3-small',
  },
  anthropic: {
    label: 'Anthropic (OpenAI-kompatibel)',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-haiku-latest',
  },
  google: {
    label: 'Google Gemini (OpenAI-kompatibel)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  ollama: {
    label: 'Ollama (lokal)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.2',
  },
  custom: {
    label: 'OpenAI-kompatibel (frei)',
    baseUrl: '',
    defaultModel: '',
    defaultEmbeddingModel: '',
  },
};

export const AI_PROVIDER_PRESET_IDS = Object.keys(AI_PROVIDER_PRESETS) as AiProviderPresetId[];
