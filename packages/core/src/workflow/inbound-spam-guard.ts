/** Shared inbound spam/review detection for workflow short-circuit (Desktop + Server). */

export type InboundSpamCheckMessage = Readonly<{
  is_spam?: boolean | number | null;
  spam_status?: string | null;
  spam_score_label?: string | null;
}>;

export function messageIsSpamOrReviewForInboundWorkflow(message: InboundSpamCheckMessage): boolean {
  const status = String(message.spam_status ?? '').toLowerCase();
  const label = String(message.spam_score_label ?? '').toLowerCase();
  return (
    message.is_spam === true
    || message.is_spam === 1
    || status === 'spam'
    || status === 'review'
    || label === 'spam'
    || label === 'review'
  );
}
