/**
 * Provider adapters for the chat call. OpenAI-compatible (incl. local LM Studio /
 * Ollama via base_url) plus native Anthropic and Google Gemini. Each adapter
 * builds the right request and normalises the response to a single
 * { content, usage } shape so token/cost tracking (P0-1) works for every model.
 */
import type { AiTokenUsage } from './ai-usage';

export type AiProviderKind = 'openai' | 'anthropic' | 'gemini';

export type AiChatRequest = {
  provider: string | null;
  baseUrl: string;
  model: string;
  apiKey: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens?: number;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
};

export type AiChatResult = { content: string; usage: AiTokenUsage | null };

export function normalizeAiProvider(provider: string | null | undefined): AiProviderKind {
  const value = String(provider ?? '').trim().toLowerCase();
  if (value === 'anthropic' || value === 'claude') return 'anthropic';
  if (value === 'gemini' || value === 'google') return 'gemini';
  return 'openai';
}

/**
 * Resolves which wire protocol to use, given both the configured provider id
 * and the base URL. The shipped presets for "anthropic" and "google" are
 * OpenAI-COMPATIBLE endpoints (https://api.anthropic.com/v1 and
 * https://generativelanguage.googleapis.com/v1beta/openai), so they must go
 * through the OpenAI chat-completions adapter, NOT the native one — otherwise
 * buildProviderRequest would append native paths and produce broken URLs like
 * `…/v1/v1/messages` or `…/v1beta/openai/v1beta/models/…`.
 *
 * The native adapters are only selected when the base URL is the bare native
 * host (no OpenAI-compat suffix): anthropic native = host without a trailing
 * `/v1`; gemini native = host without an `/openai` segment.
 */
export function resolveProviderKind(
  provider: string | null | undefined,
  baseUrl: string | null | undefined,
): AiProviderKind {
  const kind = normalizeAiProvider(provider);
  if (kind === 'openai') return 'openai';
  const url = trimTrailingSlash(String(baseUrl ?? '')).toLowerCase();
  if (kind === 'anthropic') {
    // OpenAI-compatible Anthropic endpoint ends in `/v1`; native is the bare
    // host (the adapter appends `/v1/messages`).
    return /\/v1$/.test(url) ? 'openai' : 'anthropic';
  }
  // gemini: OpenAI-compatible endpoint contains `/openai`; native does not
  // (the adapter appends `/v1beta/models/…`).
  return url.includes('/openai') ? 'openai' : 'gemini';
}

type ProviderRequest = { url: string; headers: Record<string, string>; body: unknown };

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function buildProviderRequest(provider: AiProviderKind, req: AiChatRequest): ProviderRequest {
  const baseUrl = trimTrailingSlash(req.baseUrl);
  const maxTokens = req.maxTokens ?? 2048;
  if (provider === 'anthropic') {
    return {
      url: `${baseUrl}/v1/messages`,
      headers: {
        'x-api-key': req.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: {
        model: req.model,
        max_tokens: maxTokens,
        temperature: req.temperature,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: 'user', content: req.user }],
      },
    };
  }
  if (provider === 'gemini') {
    // Use the x-goog-api-key header instead of the ?key=… query parameter so
    // the key never appears in URLs (which are logged by proxies, captured in
    // crash stacks, and not redacted by our log-store secret filter).
    return {
      url: `${baseUrl}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': req.apiKey,
      },
      body: {
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: { temperature: req.temperature, maxOutputTokens: maxTokens },
      },
    };
  }
  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      model: req.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      temperature: req.temperature,
    },
  };
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function combineTotal(prompt: number | null, completion: number | null, total: number | null): number | null {
  if (total !== null) return total;
  if (prompt !== null || completion !== null) return (prompt ?? 0) + (completion ?? 0);
  return null;
}

export function parseProviderResponse(provider: AiProviderKind, body: string): AiChatResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { content: body, usage: null };
  }
  if (!parsed || typeof parsed !== 'object') return { content: body, usage: null };
  const record = parsed as Record<string, unknown>;

  if (provider === 'anthropic') {
    const blocks = Array.isArray(record.content) ? record.content : [];
    const content = blocks
      .map((block) => (block && typeof block === 'object' ? String((block as { text?: unknown }).text ?? '') : ''))
      .join('')
      .trim();
    const usageRaw = (record.usage ?? {}) as Record<string, unknown>;
    const prompt = asNumber(usageRaw.input_tokens);
    const completion = asNumber(usageRaw.output_tokens);
    return { content: content || body, usage: usageFrom(prompt, completion) };
  }

  if (provider === 'gemini') {
    const candidates = Array.isArray(record.candidates) ? record.candidates : [];
    const first = candidates[0] as { content?: { parts?: unknown } } | undefined;
    const parts = Array.isArray(first?.content?.parts) ? (first!.content!.parts as unknown[]) : [];
    const content = parts
      .map((part) => (part && typeof part === 'object' ? String((part as { text?: unknown }).text ?? '') : ''))
      .join('')
      .trim();
    const meta = (record.usageMetadata ?? {}) as Record<string, unknown>;
    const prompt = asNumber(meta.promptTokenCount);
    const completion = asNumber(meta.candidatesTokenCount);
    const total = asNumber(meta.totalTokenCount);
    return { content: content || body, usage: usageFrom(prompt, completion, total) };
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = typeof firstChoice?.message?.content === 'string' ? firstChoice.message.content : body;
  const usageRaw = (record.usage ?? {}) as Record<string, unknown>;
  const prompt = asNumber(usageRaw.prompt_tokens);
  const completion = asNumber(usageRaw.completion_tokens);
  const total = asNumber(usageRaw.total_tokens);
  return { content, usage: usageFrom(prompt, completion, total) };
}

function usageFrom(prompt: number | null, completion: number | null, total: number | null = null): AiTokenUsage | null {
  const combined = combineTotal(prompt, completion, total);
  if (prompt === null && completion === null && combined === null) return null;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: combined };
}

/** Calls the configured provider and returns normalised content + usage. */
export async function callAiChat(req: AiChatRequest): Promise<AiChatResult> {
  const provider = resolveProviderKind(req.provider, req.baseUrl);
  const spec = buildProviderRequest(provider, req);
  const response = await req.fetchImpl(spec.url, {
    method: 'POST',
    headers: spec.headers,
    body: JSON.stringify(spec.body),
    signal: req.signal,
  });
  const body = await response.text();
  if (!response.ok) {
    const detail = body.trim().slice(0, 500);
    throw new Error(`KI API HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return parseProviderResponse(provider, body);
}
