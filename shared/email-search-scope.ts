import { z } from 'zod';

/**
 * Suchbereich der Mail-Suche: `view` = nur aktuelle Ansicht (Standard),
 * `broad` = über alle Ordner hinweg, optional inkl. Spam / Papierkorb.
 */
export const messageSearchScopeSchema = z.union([
  z.object({ mode: z.literal('view') }),
  z.object({
    mode: z.literal('broad'),
    includeSpam: z.boolean().optional(),
    includeTrash: z.boolean().optional(),
  }),
]);

export type MessageSearchScope = z.infer<typeof messageSearchScopeSchema>;
