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
  if (recipients.length === 0) return { ok: false, reason: 'Empfänger fehlt' };

  const acc = getEmailAccountById(input.accountId);
  if (!acc) return { ok: false, reason: 'Konto fehlt' };

  const dest = [...recipients].sort().join(',');
  const dup = getDb()
    .prepare(
      `SELECT 1 FROM ${EMAIL_WORKFLOW_FORWARD_DEDUP_TABLE} WHERE message_id = ? AND workflow_id = ? AND dest = ?`,
    )
    .get(input.sourceMessageId, input.workflowId, dest);
  if (dup) return { ok: true };

  // Workflow forwards bypass outbound review (server edition parity): they are
  // initiated by inbound automation, not human compose. Auto-Submitted + dedup
  // guard loops; sensitive-content rules would block typical invoice forwards.

  try {
    await sendSmtpForAccount(input.accountId, {
      from: acc.email_address,
      to: recipients.join(', '),
      subject: input.subject,
      text: input.bodyText.slice(0, 500_000),
      headers: { 'Auto-Submitted': 'auto-forwarded' },
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
