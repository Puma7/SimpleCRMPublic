import { getSyncInfo, setSyncInfo } from '../sqlite-service';
import { getEmailAiApiKey } from './email-ai-keytar';

const KEY_BASE = 'email_ai_base_url';
const KEY_MODEL = 'email_ai_model';

export function getAiSettings(): { baseUrl: string; model: string } {
  const baseUrl = (getSyncInfo(KEY_BASE) || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = getSyncInfo(KEY_MODEL) || 'gpt-4o-mini';
  return { baseUrl, model };
}

export function setAiSettings(input: { baseUrl?: string; model?: string }): void {
  if (input.baseUrl !== undefined) setSyncInfo(KEY_BASE, input.baseUrl);
  if (input.model !== undefined) setSyncInfo(KEY_MODEL, input.model);
}

export async function runChatCompletion(systemPrompt: string, userContent: string): Promise<string> {
  const apiKey = await getEmailAiApiKey();
  if (!apiKey) {
    throw new Error('Kein KI-API-Schlüssel hinterlegt (Einstellungen).');
  }
  const { baseUrl, model } = getAiSettings();
  const url = `${baseUrl}/chat/completions`;
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
}
