/** Minimal message fields for workflow picker filtering. */
export type MessageWorkflowContext = {
  uid: number
  folder_kind?: string | null
}

export type WorkflowPickItem = {
  id: number
  name: string
  trigger: string
  enabled: number
  priority?: number
}

/** Local compose draft (negative uid or draft folder). */
export function isLocalComposeDraft(message: MessageWorkflowContext): boolean {
  return message.uid < 0 || message.folder_kind === 'draft'
}

/**
 * Whether a workflow can be started manually for this message from the inbox UI.
 * CRM/schedule/webhook triggers are excluded (no message context).
 */
export function workflowApplicableToMessage(
  workflow: WorkflowPickItem,
  message: MessageWorkflowContext,
): boolean {
  if (workflow.enabled !== 1) return false
  const trigger = workflow.trigger || 'inbound'
  const draft = isLocalComposeDraft(message)

  switch (trigger) {
    case 'inbound':
      return !draft
    case 'outbound':
    case 'draft_created':
      return draft
    case 'manual':
      return true
    default:
      return false
  }
}

export function filterWorkflowsForMessage<T extends WorkflowPickItem>(
  workflows: T[],
  message: MessageWorkflowContext,
): T[] {
  return workflows
    .filter((w) => workflowApplicableToMessage(w, message))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
}
