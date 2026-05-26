import { getDb } from '../sqlite-service';
import { EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE } from '../database-schema';
import { getEmailAccountById } from './email-store';
import { sendSmtpForAccount } from './email-smtp';
import { evaluateOutboundWorkflows } from './email-workflow-engine';

export type ForwardCopyInput = {
  accountId: number;
  sourceMessageId: number;
  workflowId: number;
  to: string;
  subject: string;
  bodyText: string;
  originalFromLine: string;
};

export async function sendWorkflowForwardCopy(
  input: ForwardCopyInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const to = input.to.trim();
  if (!to) return { ok: false, reason: 'Empfänger fehlt' };

  const acc = getEmailAccountById(input.accountId);
  if (!acc) return { ok: false, reason: 'Konto fehlt' };

  const dest = to.toLowerCase();
  const dup = getDb()
    .prepare(
      `SELECT 1 FROM ${EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE} WHERE message_id = ? AND workflow_id = ? AND dest = ?`,
    )
    .get(input.sourceMessageId, input.workflowId, dest);
  if (dup) return { ok: true };

  const outbound = await evaluateOutboundWorkflows(
    {
      messageId: input.sourceMessageId,
      subject: input.subject,
      bodyText: input.bodyText,
      to,
    },
    { sideEffects: 'none' },
  );
  if (!outbound.allowed) {
    return { ok: false, reason: outbound.reason ?? 'Outbound-Workflow blockiert Weiterleitung' };
  }

  try {
    await sendSmtpForAccount(input.accountId, {
      from: acc.email_address,
      to,
      subject: input.subject,
      text: input.bodyText.slice(0, 500_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }

  getDb()
    .prepare(
      `INSERT OR IGNORE INTO ${EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE} (message_id, workflow_id, dest) VALUES (?, ?, ?)`,
    )
    .run(input.sourceMessageId, input.workflowId, dest);

  return { ok: true };
}
