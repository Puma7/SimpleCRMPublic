import { extractTicketFromSubject } from '@simplecrm/core';

import type { WorkspaceTransaction } from './db/workspace-context';

function normalizeTicketPrefix(prefix: string): string {
  const normalized = String(prefix ?? 'SCR')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return normalized || 'SCR';
}

export async function listWorkspaceTicketPrefixes(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<Set<string>> {
  const rows = await trx
    .selectFrom('email_account_mail_settings')
    .select('ticket_prefix')
    .where('workspace_id', '=', workspaceId)
    .execute();
  const prefixes = new Set<string>(['SCR']);
  for (const row of rows) {
    const normalized = normalizeTicketPrefix(row.ticket_prefix);
    prefixes.add(normalized);
  }
  return prefixes;
}

export function extractWorkspaceTicketFromSubject(
  subject: string | null,
  allowedPrefixes: ReadonlySet<string>,
): string | null {
  return extractTicketFromSubject(subject, { allowedPrefixes });
}
