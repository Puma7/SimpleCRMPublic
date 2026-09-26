/**
 * OpenRouter Decisions API (Entscheidungsmodelle wie Jev oder Span-01).
 *
 * Reine Hilfen für beide Editionen: Anfrage bauen und Antwort robust auswerten.
 * Den eigentlichen HTTP-Aufruf machen die Editionen selbst (Server über den
 * SSRF-geschützten guardedAiPost, Desktop über fetch mit begrenzter Antwort).
 *
 * Anfrage:  POST <baseUrl ohne /v1>/alpha/decisions
 *           { model, state, questions: { decision: { type: "noul", instructions, criteria: { true, false } } } }
 * Antwort:  { answers: { decision: { type: "noul", noul: 0.96 } }, usage: { input_tokens, output_tokens, cost } }
 *
 * Das genaue Antwortformat aller Modelle war nicht verfügbar; die Auswertung
 * akzeptiert deshalb neben `noul` auch `probability`, `p_present` und `yes`
 * (jeweils 0–1 oder 0–100).
 */

/** Profil-Typ (provider) eines Entscheidungsmodell-Profils. */
export const AI_DECISIONS_PROVIDER_ID = 'openrouter_decisions';
export const AI_DECISIONS_DEFAULT_BASE_URL = 'https://openrouter.ai/api';
export const AI_DECISIONS_DEFAULT_MODEL = 'typesafe/jev-1.13';
/** Zeitlimit eines Decisions-Aufrufs (beide Editionen). */
export const AI_DECISIONS_TIMEOUT_MS = 30_000;

/** Fehlermeldung, wenn ein Chat-Baustein ein Entscheidungsmodell-Profil nutzen soll. */
export const AI_DECISIONS_PROFILE_IN_CHAT_NODE_ERROR =
  'Dieses KI-Profil nutzt die OpenRouter Decisions API und funktioniert nur im Baustein „KI-Entscheidung“.';

/** Frage und Zustand für „Verbindung testen“ bei Entscheidungsmodell-Profilen. */
export const AI_DECISIONS_CONNECTION_TEST_QUESTION = 'Is this a connection test?';
export const AI_DECISIONS_CONNECTION_TEST_STATE = 'connection test';

export function isAiDecisionsProvider(provider: string | null | undefined): boolean {
  return String(provider ?? '').trim().toLowerCase() === AI_DECISIONS_PROVIDER_ID;
}

/**
 * Endpunkt der Decisions API. Die Profil-Base-URL darf mit oder ohne `/v1`
 * eingetragen sein (die OpenRouter-Chat-Vorlage nutzt `/api/v1`); die
 * Decisions API liegt unter `/api/alpha/decisions`.
 */
export function aiDecisionsEndpointUrl(baseUrl: string): string {
  const trimmed = String(baseUrl ?? '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  return `${trimmed}/alpha/decisions`;
}

export type AiDecisionsRequestInput = {
  model: string;
  question: string;
  yesCriteria?: string | null;
  noCriteria?: string | null;
  state: unknown;
};

export function buildAiDecisionsRequestBody(input: AiDecisionsRequestInput): Record<string, unknown> {
  const yes = String(input.yesCriteria ?? '').trim();
  const no = String(input.noCriteria ?? '').trim();
  return {
    model: input.model,
    state: input.state,
    questions: {
      decision: {
        type: 'noul',
        instructions: input.question,
        criteria: {
          true: yes || 'Ja',
          false: no || 'Nein',
        },
      },
    },
  };
}

export type AiDecisionsUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type AiDecisionsParsedResponse =
  | {
    ok: true;
    /** Ja-Wahrscheinlichkeit 0–100, ganzzahlig. */
    probability: number;
    /** Vom Anbieter gemeldete Kosten in Mikro-USD (USD × 1e6), sonst null. */
    costMicroUsd: number | null;
    usage: AiDecisionsUsage | null;
  }
  | { ok: false; error: string; costMicroUsd: number | null; usage: AiDecisionsUsage | null };

const NO_PROBABILITY_ERROR = 'Antwort der Decisions API enthielt keine verwertbare Ja-Wahrscheinlichkeit';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Anteil 0–1 → Prozent. Die Decisions API liefert Anteile; ein Wert über 1
 * (etwa eine Antwort in Prozent) ist nicht eindeutig lesbar — 1 hieße dann
 * 100 % oder 1 % — und gilt daher als unbrauchbar (Ausgang „KI-Fehler“).
 */
export function decisionsProbabilityToPercent(value: unknown): number | null {
  const n = finiteNumber(value);
  if (n === null || n < 0 || n > 1) return null;
  return Math.round(n * 100);
}

const PROBABILITY_KEYS = ['noul', 'probability', 'p_present', 'yes'] as const;

function probabilityFrom(value: unknown, depth = 0): number | null {
  const direct = decisionsProbabilityToPercent(value);
  if (direct !== null) return direct;
  const obj = record(value);
  if (!obj || depth > 2) return null;
  for (const key of PROBABILITY_KEYS) {
    if (!(key in obj)) continue;
    const found = probabilityFrom(obj[key], depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function usageFrom(body: Record<string, unknown>): { usage: AiDecisionsUsage | null; costMicroUsd: number | null } {
  const raw = record(body.usage);
  if (!raw) return { usage: null, costMicroUsd: null };
  const int = (value: unknown): number | null => {
    const n = finiteNumber(value);
    return n === null || n < 0 ? null : Math.trunc(n);
  };
  const prompt = int(raw.input_tokens) ?? int(raw.prompt_tokens);
  const completion = int(raw.output_tokens) ?? int(raw.completion_tokens);
  const total = int(raw.total_tokens)
    ?? (prompt !== null || completion !== null ? (prompt ?? 0) + (completion ?? 0) : null);
  const cost = finiteNumber(raw.cost);
  return {
    usage: prompt === null && completion === null && total === null
      ? null
      : { promptTokens: prompt, completionTokens: completion, totalTokens: total },
    costMicroUsd: cost === null || cost < 0 ? null : Math.round(cost * 1_000_000),
  };
}

/**
 * Wertet die Antwort der Decisions API aus. Akzeptiert den JSON-Text oder das
 * bereits geparste Objekt. Kein verwertbarer Wert ⇒ `ok: false` (der Knoten
 * nimmt dann den Ausgang „KI-Fehler“).
 */
export function parseAiDecisionsResponse(body: unknown): AiDecisionsParsedResponse {
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      return { ok: false, error: 'Antwort der Decisions API ist kein gültiges JSON', costMicroUsd: null, usage: null };
    }
  }
  const obj = record(parsed);
  if (!obj) return { ok: false, error: NO_PROBABILITY_ERROR, costMicroUsd: null, usage: null };
  const { usage, costMicroUsd } = usageFrom(obj);

  const answers = record(obj.answers);
  let probability: number | null = null;
  if (answers) {
    probability = probabilityFrom(answers.decision);
    if (probability === null) {
      // Einzige Frage unter anderem Schlüssel.
      const values = Object.values(answers);
      if (values.length === 1) probability = probabilityFrom(values[0]);
    }
  }
  if (probability === null) {
    for (const key of PROBABILITY_KEYS) {
      if (!(key in obj)) continue;
      probability = probabilityFrom(obj[key]);
      if (probability !== null) break;
    }
  }
  if (probability === null) {
    return { ok: false, error: NO_PROBABILITY_ERROR, costMicroUsd, usage };
  }
  return { ok: true, probability, costMicroUsd, usage };
}
