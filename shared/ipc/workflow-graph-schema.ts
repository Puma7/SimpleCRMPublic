import { z } from 'zod';

/** Zod schema matching {@link WorkflowGraphDocument} payloads from the workflow canvas. */
export const workflowGraphDocumentSchema = z.object({
  version: z.literal(1),
  nodes: z.array(
    z
      .object({
        id: z.string(),
        type: z.enum(['trigger', 'condition', 'action', 'registry']),
        data: z.record(z.string(), z.unknown()),
        position: z
          .object({
            x: z.number(),
            y: z.number(),
          })
          .optional(),
      })
      .passthrough(),
  ),
  edges: z.array(
    z
      .object({
        id: z.string(),
        source: z.string(),
        target: z.string(),
        label: z.string().optional(),
      })
      .passthrough(),
  ),
});

export const compileWorkflowGraphPayloadSchema = z.union([
  workflowGraphDocumentSchema,
  z.object({ graphJson: z.string().min(1) }),
]);
