import { z } from 'zod';

/** Inbox „Erledigung“ filter (Posteingang Zero). */
export const messageDoneFilterSchema = z.enum(['all', 'open', 'done']);

export type MessageDoneFilter = z.infer<typeof messageDoneFilterSchema>;

export const DEFAULT_MESSAGE_DONE_FILTER: MessageDoneFilter = 'open';

type MailViewForDone = 'inbox' | 'sent' | 'archived' | 'drafts' | 'spam_review' | 'spam' | 'trash' | 'snoozed' | 'all';

/** SQL fragment for list/search queries (table alias `m`). */
export function doneFilterSql(
  filter: MessageDoneFilter | undefined,
  view: MailViewForDone,
): string {
  if (view !== 'inbox' || !filter || filter === 'all') return '';
  if (filter === 'open') return ' AND COALESCE(m.done_local, 0) = 0';
  return ' AND COALESCE(m.done_local, 0) = 1';
}
