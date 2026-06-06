/**
 * AI token/cost/latency tracking. Every LLM call records one `ai_usage_events`
 * row so operators see what the KI support is costing (per day/model/node type).
 * Recording is best-effort and must never break the AI flow.
 */
import type { Kysely } from 'kysely';

import type { ServerDatabase } from './db';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './db/workspace-context';

export type AiTokenUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type AiUsageRecorderDeps = {
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
};

export type AiUsageEventInput = {
  workspaceId: string;
  aiProfileId: number | null;
  model: string | null;
  nodeType: string;
  messageId?: number | null;
  runId?: number | null;
  actorUserId?: string | null;
  usage: AiTokenUsage | null;
  latencyMs?: number | null;
};

/** Approximate prices in USD per 1,000,000 tokens. Estimates only (configurable
 *  budgets/prices are a later step); unknown/local models record tokens but no cost. */
type ModelPrice = { input: number; output: number };
const AI_MODEL_PRICING: ReadonlyArray<readonly [string, ModelPrice]> = [
  ['gpt-4o-mini', { input: 0.15, output: 0.6 }],
  ['gpt-4o', { input: 2.5, output: 10 }],
  ['gpt-4.1-mini', { input: 0.4, output: 1.6 }],
  ['gpt-4.1-nano', { input: 0.1, output: 0.4 }],
  ['gpt-4.1', { input: 2, output: 8 }],
  ['o4-mini', { input: 1.1, output: 4.4 }],
  ['o3-mini', { input: 1.1, output: 4.4 }],
  ['claude-3-5-haiku', { input: 0.8, output: 4 }],
  ['claude-haiku', { input: 0.8, output: 4 }],
  ['claude-3-5-sonnet', { input: 3, output: 15 }],
  ['claude-sonnet', { input: 3, output: 15 }],
  ['claude-opus', { input: 15, output: 75 }],
  ['gemini-1.5-flash', { input: 0.075, output: 0.3 }],
  ['gemini-2.0-flash', { input: 0.1, output: 0.4 }],
  ['gemini-1.5-pro', { input: 1.25, output: 5 }],
  ['gemini-2.5-pro', { input: 1.25, output: 5 }],
];

function priceForModel(model: string | null): ModelPrice | null {
  if (!model) return null;
  const normalized = model.trim().toLowerCase();
  for (const [key, price] of AI_MODEL_PRICING) {
    if (normalized.includes(key)) return price;
  }
  return null;
}

/** Estimated cost in micro-USD (USD * 1e6), or null when model/tokens are unknown. */
export function estimateAiCostMicroUsd(model: string | null, usage: AiTokenUsage | null): number | null {
  if (!usage) return null;
  const price = priceForModel(model);
  if (!price) return null;
  const prompt = usage.promptTokens ?? 0;
  const completion = usage.completionTokens ?? 0;
  if (prompt === 0 && completion === 0) return null;
  // price is USD per 1e6 tokens, so tokens * price already yields micro-USD.
  return Math.round(prompt * price.input + completion * price.output);
}

/** Extracts the OpenAI-style `usage` object from a chat/completions response body. */
export function extractChatCompletionUsage(body: string): AiTokenUsage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const usage = (parsed as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return null;
  const record = usage as Record<string, unknown>;
  const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
  const prompt = num(record.prompt_tokens);
  const completion = num(record.completion_tokens);
  const total = num(record.total_tokens)
    ?? (prompt !== null || completion !== null ? (prompt ?? 0) + (completion ?? 0) : null);
  if (prompt === null && completion === null && total === null) return null;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
}

/**
 * Records a single AI usage event. Opens its own workspace-scoped transaction and
 * swallows all errors — tracking must never break the actual AI work.
 */
export async function recordAiUsageSafe(deps: AiUsageRecorderDeps, event: AiUsageEventInput): Promise<void> {
  try {
    const now = deps.now?.() ?? new Date();
    await withWorkspaceTransaction(
      deps.db,
      { workspaceId: event.workspaceId, role: 'system' },
      async (trx) => {
        await trx
          .insertInto('ai_usage_events')
          .values({
            workspace_id: event.workspaceId,
            ai_profile_id: event.aiProfileId,
            model: event.model,
            node_type: event.nodeType,
            message_id: event.messageId ?? null,
            run_id: event.runId ?? null,
            actor_user_id: event.actorUserId ?? null,
            prompt_tokens: event.usage?.promptTokens ?? null,
            completion_tokens: event.usage?.completionTokens ?? null,
            total_tokens: event.usage?.totalTokens ?? null,
            est_cost_micro_usd: estimateAiCostMicroUsd(event.model, event.usage),
            latency_ms: event.latencyMs ?? null,
            created_at: now,
          })
          .execute();
      },
      { applySession: deps.applyWorkspaceSession },
    );
  } catch {
    /* tracking is best-effort */
  }
}
