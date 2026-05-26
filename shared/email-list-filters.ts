import { z } from 'zod';

/** Server-side message list filters (also used in IPC schemas). */
export const messageListFilterSchema = z.enum([
  'all',
  'unread',
  'attachment',
  'customer',
  'workflow',
]);

export type MessageListFilter = z.infer<typeof messageListFilterSchema>;
