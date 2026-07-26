/** Shared inbound-priority-chain fields carried across deferred workflow continuations. */

export type InboundWorkflowChainContext = Readonly<{
  workflowIds: readonly number[];
  index: number;
}>;

export type InboundChainContinuationFields = Readonly<{
  inboundWorkflowChain?: InboundWorkflowChainContext;
  skipIfMessageSpamOrReview?: boolean;
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
  return {
    ...(chain ? { inboundWorkflowChain: chain } : {}),
    ...(value.skipIfMessageSpamOrReview === true ? { skipIfMessageSpamOrReview: true } : {}),
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
    ...(continuation.skipIfMessageSpamOrReview === true
      ? { skipIfMessageSpamOrReview: true }
      : {}),
  };
}
