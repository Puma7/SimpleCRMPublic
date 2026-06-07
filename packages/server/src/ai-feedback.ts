/**
 * P2-9 feedback learning: measures how much a human changed an AI-generated draft
 * before sending and records it (privacy-friendly: lengths + a change ratio, not
 * the texts themselves). The aggregate tells operators how often/strongly the KI
 * suggestions need editing per node type. Recording is best-effort.
 */
import type { Kysely } from 'kysely';

import type { ServerDatabase } from './db';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './db/workspace-context';

export type AiFeedbackRecorderDeps = {
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
};

export type AiReplyFeedbackInput = {
  workspaceId: string;
  messageId: number | null;
  nodeType: string;
  suggestion: string;
  sent: string;
};

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

/**
 * Word-level Jaccard distance (0 = identical word sets, 1 = nothing in common).
 * A cheap, stable proxy for "how much did the human change the suggestion".
 */
export function computeTextChangeRatio(suggestion: string, sent: string): number {
  const a = wordSet(suggestion);
  const b = wordSet(sent);
  if (a.size === 0 && b.size === 0) return 0;
  if (a.size === 0 || b.size === 0) return 1;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return Math.round((1 - intersection / union) * 1000) / 1000;
}

/** Records one feedback row (suggestion vs sent). Best-effort; never throws. */
export async function recordAiReplyFeedbackSafe(deps: AiFeedbackRecorderDeps, input: AiReplyFeedbackInput): Promise<void> {
  try {
    const suggestion = input.suggestion ?? '';
    const sent = input.sent ?? '';
    if (!suggestion.trim()) return;
    const now = deps.now?.() ?? new Date();
    const changedRatio = computeTextChangeRatio(suggestion, sent);
    await withWorkspaceTransaction(
      deps.db,
      { workspaceId: input.workspaceId, role: 'system' },
      async (trx) => {
        await trx
          .insertInto('ai_reply_feedback')
          .values({
            workspace_id: input.workspaceId,
            message_id: input.messageId ?? null,
            node_type: input.nodeType,
            suggestion_len: suggestion.length,
            sent_len: sent.length,
            changed_ratio: changedRatio,
            created_at: now,
          })
          .execute();
      },
      { applySession: deps.applyWorkspaceSession },
    );
  } catch {
    /* feedback is best-effort */
  }
}
