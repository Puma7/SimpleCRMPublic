/** Shared inbound-priority-chain fields carried across deferred workflow continuations. */

export type InboundWorkflowChainContext = Readonly<{
  workflowIds: readonly number[];
  index: number;
}>;

export type InboundChainContinuationFields = Readonly<{
  inboundWorkflowChain?: InboundWorkflowChainContext;
  skipIfMessageSpamOrReview?: boolean;
  /**
   * Lauf, der diesen Trigger-Fan-out gestartet hat.
   *
   * Ohne Kette ist der Schluessel der Join-Barriere nur Nachricht + Workflow.
   * Zwei ueberlappende Backfill-/Reapply-Laeufe teilten sich dann denselben
   * Zaehler: ein Kind aus Lauf B koennte die Barriere von Lauf A auf null
   * setzen, den Applied-Marker schreiben und Folgearbeit freigeben, waehrend
   * Zweige beider Laeufe noch laufen. Continuations tragen keine eigene runId
   * (jede erzeugt einen neuen Lauf), deshalb reist die des Ursprungslaufs hier
   * mit — und zwar durch JEDE Fortsetzung, sonst rechnen Eltern und Kinder mit
   * verschiedenen Schluesseln.
   */
  inboundFanOutRunId?: number;
}>;

export function parseInboundWorkflowChain(value: unknown): InboundWorkflowChainContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const workflowIds = Array.isArray(raw.workflowIds)
    ? raw.workflowIds
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0)
    : [];
  const index = Number(raw.index ?? 0);
  if (workflowIds.length === 0 || !Number.isInteger(index) || index < 0 || index >= workflowIds.length) {
    return null;
  }
  return { workflowIds, index };
}

/** Extract chain fields from a job/continuation payload for re-stamping into resume context. */
export function inboundChainFieldsFromRecord(value: Record<string, unknown> | null | undefined): InboundChainContinuationFields {
  if (!value) return {};
  const chain = parseInboundWorkflowChain(value.inboundWorkflowChain);
  const fanOutRunId = Number(value.inboundFanOutRunId);
  return {
    ...(chain ? { inboundWorkflowChain: chain } : {}),
    ...(value.skipIfMessageSpamOrReview === true ? { skipIfMessageSpamOrReview: true } : {}),
    ...(Number.isInteger(fanOutRunId) && fanOutRunId > 0 ? { inboundFanOutRunId: fanOutRunId } : {}),
  };
}

/** Spread into workflow.execute `context` so maybeEnqueueNextInboundWorkflow still sees the chain. */
export function resumeContextInboundChainFields(
  continuation: InboundChainContinuationFields | null | undefined,
): Record<string, unknown> {
  if (!continuation) return {};
  return {
    ...(continuation.inboundWorkflowChain
      ? { inboundWorkflowChain: continuation.inboundWorkflowChain }
      : {}),
    // Anders als skipIfMessageSpamOrReview MUSS der Fan-out-Lauf jede
    // Fortsetzung ueberleben: er ist der Schluessel der Join-Barriere.
    ...(continuation.inboundFanOutRunId
      ? { inboundFanOutRunId: continuation.inboundFanOutRunId }
      : {}),
    // Do not re-stamp skipIfMessageSpamOrReview onto resumed workflow.execute —
    // it is a one-shot initial post-process guard only.
  };
}
