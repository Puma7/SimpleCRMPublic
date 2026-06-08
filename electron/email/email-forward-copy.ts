import { getDb } from '../sqlite-service';
import { EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE } from '../database-schema';
import { getEmailAccountById } from './email-store';
import { sendSmtpForAccount } from './email-smtp';

export type ForwardCopyInput = {
  accountId: number;
  sourceMessageId: number;
  workflowId: number;
  to: string;
  subject: string;
  bodyText: string;
  originalFromLine: string;
};

const MAX_FORWARD_RECIPIENTS = 10;

/** Parse comma/semicolon-separated forward targets (aligned with server edition). */
export function normalizeForwardCopyRecipients(raw: string): string[] {
  const parts = raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts.slice(0, MAX_FORWARD_RECIPIENTS)) {
    const m = part.match(/<([^>]+)>/) ?? part.match(/^([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/);
    const addr = (m ? m[1]! : part).trim().toLowerCase();
    if (addr && !out.includes(addr)) out.push(addr);
  }
  return out;
}

export async function sendWorkflowForwardCopy(
  input: ForwardCopyInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const recipients = normalizeForwardCopyRecipients(input.to);
  if (recipients.length === 0) {
    console.warn('[email] forward_copy skipped: no recipients', { messageId: input.sourceMessageId, workflowId: input.workflowId });
    return { ok: false, reason: 'Empfänger fehlt' };
  }

  const acc = getEmailAccountById(input.accountId);
  if (!acc) {
    console.warn('[email] forward_copy skipped: account missing', { accountId: input.accountId, messageId: input.sourceMessageId });
    return { ok: false, reason: 'Konto fehlt' };
  }

  const dest = [...recipients].sort().join(',');
  const dup = getDb()
    .prepare(
      `SELECT 1 FROM ${EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE} WHERE message_id = ? AND workflow_id = ? AND dest = ?`,
    )
    .get(input.sourceMessageId, input.workflowId, dest);
  if (dup) return { ok: true };

  // Claim dedup before SMTP so concurrent workers cannot double-send on failure.
  const claim = getDb()
    .prepare(
      `INSERT OR IGNORE INTO ${EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE} (message_id, workflow_id, dest) VALUES (?, ?, ?)`,
    )
    .run(input.sourceMessageId, input.workflowId, dest);
  if (claim.changes === 0) return { ok: true };

  // Workflow forwards bypass outbound review — see packages/server workflow-forward-copy.ts

  try {
    await sendSmtpForAccount(input.accountId, {
      from: acc.email_address,
      to: recipients.join(', '),
      subject: input.subject,
      text: input.bodyText.slice(0, 500_000),
      headers: { 'Auto-Submitted': 'auto-forwarded' },
    });
  } catch (e) {
    getDb()
      .prepare(
        `DELETE FROM ${EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE} WHERE message_id = ? AND workflow_id = ? AND dest = ?`,
      )
      .run(input.sourceMessageId, input.workflowId, dest);
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[email] forward_copy failed', {
      accountId: input.accountId,
      messageId: input.sourceMessageId,
      workflowId: input.workflowId,
      to: recipients.join(', '),
      error: msg,
    });
    return { ok: false, reason: msg };
  }

  return { ok: true };
}
