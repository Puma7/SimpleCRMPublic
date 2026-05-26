import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import { getResolvedAiRuntime } from './email-ai-profiles';
import { formatAiUserError } from './ai-error-format';

const KEY_BASE = 'email_ai_base_url';
const KEY_MODEL = 'email_ai_model';
const KEY_EMBED_MODEL = 'email_ai_embedding_model';

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

export async function runChatCompletion(
  systemPrompt: string,
  userContent: string,
  profileId?: number | null,
): Promise<string> {
  const runtime = await getResolvedAiRuntime(profileId);
  const apiKey = runtime.apiKey;
  if (!apiKey) {
    const hint = runtime.profileLabel
      ? `Kein API-Schlüssel für KI-Profil „${runtime.profileLabel}" (Einstellungen → KI-Profil).`
      : 'Kein KI-API-Schlüssel hinterlegt (Einstellungen → KI-Profil).';
    throw new Error(hint);
  }
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
      const t = await res.text();
      throw new Error(`KI-Anfrage fehlgeschlagen: ${res.status} ${t.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Leere KI-Antwort');
    return text;
  } catch (e) {
    throw new Error(formatAiUserError(e));
  }
}

export async function runEmbedding(text: string, profileId?: number | null): Promise<number[] | null> {
  const runtime = await getResolvedAiRuntime(profileId);
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
    const data = (await res.json()) as { data?: { embedding?: number[] }[] };
    const vec = data.data?.[0]?.embedding;
    if (!vec || !Array.isArray(vec)) return null;
    return vec;
  } catch {
    return null;
  }
}
