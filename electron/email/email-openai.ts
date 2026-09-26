import { readBoundedResponseJson, readBoundedResponseText } from '../../packages/core/src/net/bounded-body';
import {
  AI_DECISIONS_CONNECTION_TEST_QUESTION,
  AI_DECISIONS_CONNECTION_TEST_STATE,
  AI_DECISIONS_PROFILE_IN_CHAT_NODE_ERROR,
  AI_DECISIONS_TIMEOUT_MS,
  aiDecisionsEndpointUrl,
  buildAiDecisionsRequestBody,
  isAiDecisionsProvider,
  parseAiDecisionsResponse,
} from '../../packages/core/src/workflow/ai-decisions-api';
import {
  buildAiDecideChatPrompts,
  parseAiDecideChatResponse,
  type AiDecideSource,
} from '../../packages/core/src/workflow/ai-decide';
import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import { getAiProfileById, getResolvedAiRuntime } from './email-ai-profiles';
import { formatAiUserError } from './ai-error-format';

type ResolvedAiRuntime = Awaited<ReturnType<typeof getResolvedAiRuntime>>;

const KEY_BASE = 'email_ai_base_url';
const KEY_MODEL = 'email_ai_model';
const KEY_EMBED_MODEL = 'email_ai_embedding_model';
// Byte limits while reading: the base URL is configurable, so the endpoint may be foreign.
const MAX_AI_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_AI_ERROR_TEXT_BYTES = 64 * 1024;

export function getAiSettings(): { baseUrl: string; model: string; embeddingModel: string } {
  const baseUrl = (getSyncInfo(KEY_BASE) || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = getSyncInfo(KEY_MODEL) || 'gpt-4o-mini';
  const embeddingModel = getSyncInfo(KEY_EMBED_MODEL) || 'text-embedding-3-small';
  return { baseUrl, model, embeddingModel };
}

export function setAiSettings(input: { baseUrl?: string; model?: string }): void {
  if (input.baseUrl !== undefined) setSyncInfo(KEY_BASE, input.baseUrl);
  if (input.model !== undefined) setSyncInfo(KEY_MODEL, input.model);
}

function missingApiKeyMessage(runtime: ResolvedAiRuntime): string {
  return runtime.profileLabel
    ? `Kein API-Schlüssel für KI-Profil „${runtime.profileLabel}" (Einstellungen → KI-Profil).`
    : 'Kein KI-API-Schlüssel hinterlegt (Einstellungen → KI-Profil).';
}

/** Chat-Aufruf mit bereits aufgelöstem Profil (zentrale Stelle aller Chat-Bausteine). */
async function chatCompletionWithRuntime(
  runtime: ResolvedAiRuntime,
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  // Entscheidungsmodelle sprechen kein Chat-Protokoll: klare Meldung statt
  // eines unverständlichen HTTP-Fehlers der Decisions API.
  if (isAiDecisionsProvider(runtime.provider)) {
    throw new Error(AI_DECISIONS_PROFILE_IN_CHAT_NODE_ERROR);
  }
  const apiKey = runtime.apiKey;
  if (!apiKey) throw new Error(missingApiKeyMessage(runtime));
  const { baseUrl, model } = runtime;
  const url = `${baseUrl}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const t = await readBoundedResponseText(res, MAX_AI_ERROR_TEXT_BYTES);
      throw new Error(`KI-Anfrage fehlgeschlagen: ${res.status} ${t.slice(0, 200)}`);
    }
    const data = (await readBoundedResponseJson(res, MAX_AI_RESPONSE_BYTES)) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Leere KI-Antwort');
    return text;
  } catch (e) {
    throw new Error(formatAiUserError(e));
  }
}

export async function runChatCompletion(
  systemPrompt: string,
  userContent: string,
  profileId?: number | null,
): Promise<string> {
  const runtime = await getResolvedAiRuntime(profileId);
  return chatCompletionWithRuntime(runtime, systemPrompt, userContent);
}

/**
 * Ein Aufruf der OpenRouter Decisions API. Gleiche Grenzen wie der Chat-Aufruf
 * (Zeitlimit, begrenzte Antwortgröße, deutsche Fehlermeldung), Zeitlimit 30 s.
 */
async function decisionWithRuntime(
  runtime: ResolvedAiRuntime,
  input: { question: string; yesCriteria?: string | null; noCriteria?: string | null; state: unknown },
): Promise<{ probability: number; costMicroUsd: number | null }> {
  const apiKey = runtime.apiKey;
  if (!apiKey) throw new Error(missingApiKeyMessage(runtime));
  try {
    const res = await fetch(aiDecisionsEndpointUrl(runtime.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildAiDecisionsRequestBody({
        model: runtime.model,
        question: input.question,
        yesCriteria: input.yesCriteria,
        noCriteria: input.noCriteria,
        state: input.state,
      })),
      signal: AbortSignal.timeout(AI_DECISIONS_TIMEOUT_MS),
    });
    if (!res.ok) {
      const t = await readBoundedResponseText(res, MAX_AI_ERROR_TEXT_BYTES);
      throw new Error(`Decisions-Anfrage fehlgeschlagen: ${res.status} ${t.slice(0, 200)}`);
    }
    const parsed = parseAiDecisionsResponse(await readBoundedResponseJson(res, MAX_AI_RESPONSE_BYTES));
    if (!parsed.ok) throw new Error(parsed.error);
    return { probability: parsed.probability, costMicroUsd: parsed.costMicroUsd };
  } catch (e) {
    throw new Error(formatAiUserError(e, { timeoutSeconds: AI_DECISIONS_TIMEOUT_MS / 1000 }));
  }
}

export type AiDecideCallResult = {
  source: AiDecideSource;
  /** Ja-Wahrscheinlichkeit 0–100. */
  probability: number;
  modelAnswer: 'ja' | 'nein' | null;
  reason: string;
  model: string;
};

/**
 * Baustein „KI-Entscheidung“: Entscheidungsmodell (Decisions API) oder
 * Chat-Modell mit JSON-Antwort. Wirft bei Aufruf- oder Auswertungsfehlern;
 * der Fehler trägt das Modell in `aiModel` (für ai.decide.model).
 */
export async function runAiDecideCall(input: {
  profileId?: number | null;
  question: string;
  yesCriteria?: string | null;
  noCriteria?: string | null;
  contextText: string;
  state: unknown;
}): Promise<AiDecideCallResult> {
  const runtime = await getResolvedAiRuntime(input.profileId);
  try {
    if (isAiDecisionsProvider(runtime.provider)) {
      const result = await decisionWithRuntime(runtime, input);
      return { source: 'decisions', probability: result.probability, modelAnswer: null, reason: '', model: runtime.model };
    }
    const prompts = buildAiDecideChatPrompts(input);
    const out = await chatCompletionWithRuntime(runtime, prompts.system, prompts.user);
    const parsed = parseAiDecideChatResponse(out);
    if (!parsed.ok) throw new Error(parsed.error);
    return {
      source: 'chat',
      probability: parsed.probability,
      modelAnswer: parsed.answer,
      reason: parsed.reason,
      model: runtime.model,
    };
  } catch (e) {
    throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), { aiModel: runtime.model });
  }
}

export type AiProfileConnectionTestResult = {
  ok: boolean;
  message: string;
  model: string;
  latencyMs: number;
  probability?: number;
};

/**
 * „Verbindung testen“ im KI-Profil: Chat-Profil mit einer kurzen Anfrage,
 * Entscheidungsmodell mit einer noul-Frage. Die Meldung enthält nie den Key.
 */
export async function testAiProfileConnection(profileId: number): Promise<AiProfileConnectionTestResult> {
  if (!getAiProfileById(profileId)) {
    return { ok: false, message: 'KI-Profil nicht gefunden', model: '', latencyMs: 0 };
  }
  const runtime = await getResolvedAiRuntime(profileId);
  const started = Date.now();
  const redact = (message: string): string => {
    const key = runtime.apiKey?.trim();
    return key ? message.split(key).join('***') : message;
  };
  try {
    if (isAiDecisionsProvider(runtime.provider)) {
      const result = await decisionWithRuntime(runtime, {
        question: AI_DECISIONS_CONNECTION_TEST_QUESTION,
        state: AI_DECISIONS_CONNECTION_TEST_STATE,
      });
      return {
        ok: true,
        message: `Verbindung erfolgreich (Ja-Wahrscheinlichkeit ${result.probability} %)`,
        model: runtime.model,
        latencyMs: Date.now() - started,
        probability: result.probability,
      };
    }
    const text = await chatCompletionWithRuntime(runtime, 'Antworte nur mit OK.', 'Antworte nur mit OK.');
    return {
      ok: true,
      message: `Verbindung erfolgreich – Antwort: ${text.replace(/\s+/g, ' ').slice(0, 60)}`,
      model: runtime.model,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      message: redact(e instanceof Error ? e.message : String(e)),
      model: runtime.model,
      latencyMs: Date.now() - started,
    };
  }
}

export async function runEmbedding(text: string, profileId?: number | null): Promise<number[] | null> {
  const runtime = await getResolvedAiRuntime(profileId);
  // Entscheidungsmodelle haben keinen Embedding-Endpunkt.
  if (isAiDecisionsProvider(runtime.provider)) return null;
  const apiKey = runtime.apiKey;
  if (!apiKey) return null;
  const input = text.trim().slice(0, 8000);
  if (!input) return null;
  const { baseUrl, embeddingModel } = runtime;
  const url = `${baseUrl}/embeddings`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: embeddingModel, input }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;
    const data = (await readBoundedResponseJson(res, MAX_AI_RESPONSE_BYTES)) as {
      data?: { embedding?: number[] }[];
    };
    const vec = data.data?.[0]?.embedding;
    if (!vec || !Array.isArray(vec)) return null;
    return vec;
  } catch {
    return null;
  }
}
