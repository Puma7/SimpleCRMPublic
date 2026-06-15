import { IPCChannels } from "@shared/ipc/channels"
import type { KnowledgeContext } from "@shared/knowledge-context"
import { invokeRenderer } from "@/services/transport"
import type { AiPrompt, CannedResponse } from "../types"
import { defaultOverrideKey } from "./account-override-actions"

type KbRow = {
  id: number
  name: string
  description?: string | null
  account_id?: number | null
  override_key?: string | null
  knowledge_context?: string | null
}

type KnowledgeBaseCreateResult = {
  success?: boolean
  id?: number
  error?: string
}

function assertKnowledgeBaseCreated(
  r: KnowledgeBaseCreateResult | null | undefined,
  fallbackMessage: string,
): number {
  if (r && "success" in r && r.success === false) {
    throw new Error(r.error ?? fallbackMessage)
  }
  if (r?.id == null || !Number.isFinite(r.id) || r.id <= 0) {
    throw new Error(fallbackMessage)
  }
  return r.id
}

export async function createPromptAccountOverride(
  prompt: AiPrompt,
  accountId: number,
): Promise<number | undefined> {
  const r = (await invokeRenderer(IPCChannels.Email.SaveAiPrompt, {
    label: prompt.label,
    userTemplate: prompt.user_template,
    profileId: prompt.profile_id ?? null,
    target: prompt.target,
    accountId,
    overrideKey: defaultOverrideKey("prompt", prompt.id, prompt.override_key),
  })) as { id?: number }
  return r.id
}

export async function resetPromptAccountOverride(id: number): Promise<void> {
  await invokeRenderer(IPCChannels.Email.DeleteAiPrompt, id)
}

export async function createCannedAccountOverride(
  row: CannedResponse,
  accountId: number,
): Promise<number | undefined> {
  const r = (await invokeRenderer(IPCChannels.Email.SaveCannedResponse, {
    title: row.title,
    body: row.body,
    accountId,
    overrideKey: defaultOverrideKey("canned", row.id, row.override_key),
  })) as { id?: number }
  return r.id
}

export async function resetCannedAccountOverride(id: number): Promise<void> {
  await invokeRenderer(IPCChannels.Email.DeleteCannedResponse, id)
}

export async function createKnowledgeBaseAccountOverride(
  kb: KbRow,
  accountId: number,
  knowledgeContext?: KnowledgeContext | null,
  overrideKey?: string | null,
): Promise<number> {
  const doc = (await invokeRenderer(
    IPCChannels.Email.GetKnowledgeBaseDocument,
    kb.id,
  )) as { success: true; content: string } | { success: false }
  const ctx = knowledgeContext ?? (kb.knowledge_context as KnowledgeContext | undefined) ?? null
  const r = (await invokeRenderer(IPCChannels.Email.CreateKnowledgeBase, {
    name: kb.name,
    description: kb.description ?? null,
    accountId,
    overrideKey: overrideKey ?? defaultOverrideKey("kb", kb.id, kb.override_key),
    knowledgeContext: ctx,
  })) as KnowledgeBaseCreateResult
  const createdId = assertKnowledgeBaseCreated(r, "Wissensbasis konnte nicht angelegt werden.")
  if (doc.success) {
    await invokeRenderer(IPCChannels.Email.SaveKnowledgeBaseDocument, {
      knowledgeBaseId: createdId,
      content: doc.content,
    })
  }
  return createdId
}

export async function resetKnowledgeBaseAccountOverride(id: number): Promise<void> {
  await invokeRenderer(IPCChannels.Email.DeleteKnowledgeBase, id)
}

export async function assignKnowledgeBaseToAccountSlot(
  kb: KbRow,
  accountId: number,
  context: KnowledgeContext,
): Promise<number> {
  if (
    kb.account_id != null
    && Number(kb.account_id) === Number(accountId)
    && kb.knowledge_context === context
  ) {
    return kb.id
  }
  return createKnowledgeBaseAccountOverride(kb, accountId, context, `kb.${context}`)
}
