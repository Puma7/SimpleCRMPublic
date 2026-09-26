import { z } from 'zod';
import { IPCChannels, type InvokeChannel } from './channels';

/** TA-P5: Payload-Schemas der Learnings-Kanäle (Ergebnisse bleiben frei). */
type SchemaEntry = { payload: z.ZodTypeAny; result: z.ZodTypeAny };

const positiveInt = z.number().int().positive();
const optionalId = positiveInt.nullable().optional();
const period = z.enum(['since_last', 'day', 'week', 'month']);
const kind = z.enum(['draft_edit', 'human_reply', 'note']);

export function applyAiLearningsIpcSchemas(map: Map<InvokeChannel, SchemaEntry>): void {
  const set = (channel: InvokeChannel, entry: SchemaEntry) => map.set(channel, entry);
  set(IPCChannels.Email.GetLearningsOverview, { payload: z.undefined(), result: z.any() });
  set(IPCChannels.Email.SaveLearningsSettings, {
    payload: z.object({
      collectEnabled: z.boolean().optional(),
      targetKnowledgeBaseId: optionalId,
      profileId: optionalId,
    }).strict(),
    result: z.any(),
  });
  set(IPCChannels.Email.ListLearningCandidates, {
    payload: z.object({ kind: kind.optional(), limit: z.number().int().min(1).max(200).optional() }).strict().optional(),
    result: z.any(),
  });
  set(IPCChannels.Email.DeleteLearningCandidate, { payload: z.object({ id: positiveInt }).strict(), result: z.any() });
  set(IPCChannels.Email.RunLearningsDigest, {
    payload: z.object({
      period: period.optional(),
      knowledgeBaseId: optionalId,
      profileId: optionalId,
      minCandidates: z.number().int().min(1).max(200).optional(),
    }).strict().optional(),
    result: z.any(),
  });
  set(IPCChannels.Email.ListLearningDigests, {
    payload: z.object({ limit: z.number().int().min(1).max(50).optional() }).strict().optional(),
    result: z.any(),
  });
  set(IPCChannels.Email.GetLearningDigest, { payload: z.object({ id: positiveInt }).strict(), result: z.any() });
  set(IPCChannels.Email.AcceptLearningDigest, {
    payload: z.object({
      id: positiveInt,
      content: z.string().max(100_000),
      confirmOverwrite: z.boolean().optional(),
    }).strict(),
    result: z.any(),
  });
  set(IPCChannels.Email.RejectLearningDigest, { payload: z.object({ id: positiveInt }).strict(), result: z.any() });
  set(IPCChannels.Email.AddLearningNote, {
    payload: z.object({
      text: z.string().min(1).max(4000),
      messageId: positiveInt.nullable().optional(),
    }).strict(),
    result: z.any(),
  });
}
