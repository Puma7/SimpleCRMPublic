import type { ServerEvent } from "./server-events"

const CUSTOMER_REFRESH_EVENT_TYPES = new Set([
  "customer.created",
  "customer.updated",
  "customer.deleted",
])

const CALENDAR_EVENT_REFRESH_EVENT_TYPES = new Set([
  "calendar_event.created",
  "calendar_event.updated",
  "calendar_event.deleted",
])

const PRODUCT_REFRESH_EVENT_TYPES = new Set([
  "product.created",
  "product.updated",
  "product.deleted",
])

const DEAL_REFRESH_EVENT_TYPES = new Set([
  "deal.created",
  "deal.updated",
  "deal.deleted",
])

const DEAL_PRODUCT_REFRESH_EVENT_TYPES = new Set([
  "deal_product.created",
  "deal_product.updated",
  "deal_product.deleted",
])

const TASK_REFRESH_EVENT_TYPES = new Set([
  "task.created",
  "task.updated",
  "task.deleted",
])

const CUSTOM_FIELD_REFRESH_EVENT_TYPES = new Set([
  "custom_field.created",
  "custom_field.updated",
  "custom_field.deleted",
])

const CUSTOM_FIELD_VALUE_REFRESH_EVENT_TYPES = new Set([
  "custom_field_value.created",
  "custom_field_value.updated",
  "custom_field_value.deleted",
])

const SAVED_VIEW_REFRESH_EVENT_TYPES = new Set([
  "saved_view.created",
  "saved_view.updated",
  "saved_view.deleted",
])

const ACTIVITY_LOG_REFRESH_EVENT_TYPES = new Set([
  "activity_log.created",
])

const JTL_REFERENCE_REFRESH_EVENT_TYPES = new Set([
  "jtl_reference.created",
  "jtl_reference.updated",
  "jtl_reference.deleted",
])

const MAIL_MESSAGE_REFRESH_EVENT_TYPES = new Set([
  "email_message.updated",
])

const MAIL_MESSAGE_TAG_REFRESH_EVENT_TYPES = new Set([
  "email_message_tag.created",
  "email_message_tag.deleted",
])

const MAIL_CATEGORY_REFRESH_EVENT_TYPES = new Set([
  "email_category.created",
  "email_category.updated",
  "email_category.deleted",
])

const MAIL_MESSAGE_CATEGORY_REFRESH_EVENT_TYPES = new Set([
  "email_message_category.created",
  "email_message_category.deleted",
])

const MAIL_READ_RECEIPT_REFRESH_EVENT_TYPES = new Set([
  "email_read_receipt.created",
])

const MAIL_THREAD_EDGE_REFRESH_EVENT_TYPES = new Set([
  "email_thread_edge.created",
  "email_thread_edge.deleted",
])

const MAIL_THREAD_ALIAS_REFRESH_EVENT_TYPES = new Set([
  "email_thread_alias.created",
  "email_thread_alias.updated",
  "email_thread_alias.deleted",
])

const MAIL_THREAD_REFRESH_EVENT_TYPES = new Set([
  "email_thread.updated",
])

const MAIL_INTERNAL_NOTE_REFRESH_EVENT_TYPES = new Set([
  "email_internal_note.created",
  "email_internal_note.updated",
  "email_internal_note.deleted",
])

const MAIL_REMOTE_CONTENT_ALLOWLIST_REFRESH_EVENT_TYPES = new Set([
  "email_remote_content_allowlist.created",
  "email_remote_content_allowlist.updated",
  "email_remote_content_allowlist.deleted",
])

const MAIL_SPAM_LIST_ENTRY_REFRESH_EVENT_TYPES = new Set([
  "spam_list_entry.created",
  "spam_list_entry.updated",
  "spam_list_entry.deleted",
])

const MAIL_ACCOUNT_REFRESH_EVENT_TYPES = new Set([
  "email_account.created",
  "email_account.updated",
  "email_account.deleted",
])

const MAIL_ACL_REFRESH_EVENT_TYPES = new Set([
  "email_acl.changed",
])

const MAIL_TEAM_MEMBER_REFRESH_EVENT_TYPES = new Set([
  "email_team_member.created",
  "email_team_member.updated",
  "email_team_member.deleted",
])

const MAIL_ACCOUNT_SIGNATURE_REFRESH_EVENT_TYPES = new Set([
  "email_account_signature.created",
  "email_account_signature.updated",
  "email_account_signature.deleted",
])

const MAIL_CANNED_RESPONSE_REFRESH_EVENT_TYPES = new Set([
  "email_canned_response.created",
  "email_canned_response.updated",
  "email_canned_response.deleted",
])

const MAIL_AI_PROMPT_REFRESH_EVENT_TYPES = new Set([
  "ai_prompt.created",
  "ai_prompt.updated",
  "ai_prompt.deleted",
])

const MAIL_AI_PROFILE_REFRESH_EVENT_TYPES = new Set([
  "ai_profile.created",
  "ai_profile.updated",
  "ai_profile.deleted",
])

const MAIL_PGP_IDENTITY_REFRESH_EVENT_TYPES = new Set([
  "pgp_identity.created",
  "pgp_identity.updated",
  "pgp_identity.deleted",
])

const MAIL_PGP_PEER_KEY_REFRESH_EVENT_TYPES = new Set([
  "pgp_peer_key.created",
  "pgp_peer_key.updated",
  "pgp_peer_key.deleted",
])

const AUTOMATION_API_KEY_REFRESH_EVENT_TYPES = new Set([
  "automation_api_key.created",
  "automation_api_key.revoked",
])

const WORKFLOW_REFRESH_EVENT_TYPES = new Set([
  "workflow.created",
  "workflow.updated",
  "workflow.deleted",
])

const WORKFLOW_VERSION_REFRESH_EVENT_TYPES = new Set([
  "workflow_version.created",
  "workflow_version.updated",
  "workflow_version.deleted",
])

const WORKFLOW_KNOWLEDGE_BASE_REFRESH_EVENT_TYPES = new Set([
  "workflow_knowledge_base.created",
  "workflow_knowledge_base.updated",
  "workflow_knowledge_base.deleted",
])

const WORKFLOW_KNOWLEDGE_CHUNK_REFRESH_EVENT_TYPES = new Set([
  "workflow_knowledge_chunk.created",
  "workflow_knowledge_chunk.updated",
  "workflow_knowledge_chunk.deleted",
])

export function isCustomerListRefreshEvent(event: ServerEvent): boolean {
  return event.entityType === "customer" && CUSTOMER_REFRESH_EVENT_TYPES.has(event.type)
}

export function isCustomerDetailRefreshEvent(event: ServerEvent, customerId: number): boolean {
  if (!Number.isSafeInteger(customerId) || customerId <= 0) return false
  if (isCustomerListRefreshEvent(event)) return event.entityId === String(customerId)
  if (event.entityType === "deal" && DEAL_REFRESH_EVENT_TYPES.has(event.type)) {
    return readPositiveInteger(event.payload?.customerId) === customerId
  }
  if (event.entityType === "task" && TASK_REFRESH_EVENT_TYPES.has(event.type)) {
    return readPositiveInteger(event.payload?.customerId) === customerId
  }
  if (event.entityType === "custom_field" && CUSTOM_FIELD_REFRESH_EVENT_TYPES.has(event.type)) return true
  if (event.entityType !== "custom_field_value" || !CUSTOM_FIELD_VALUE_REFRESH_EVENT_TYPES.has(event.type)) return false
  return readPositiveInteger(event.payload?.customerId) === customerId
}

export function isCalendarEventRefreshEvent(event: ServerEvent): boolean {
  return event.entityType === "calendar_event" && CALENDAR_EVENT_REFRESH_EVENT_TYPES.has(event.type)
}

export function isProductListRefreshEvent(event: ServerEvent): boolean {
  return event.entityType === "product" && PRODUCT_REFRESH_EVENT_TYPES.has(event.type)
}

export function isDealListRefreshEvent(event: ServerEvent): boolean {
  if (event.entityType === "deal" && DEAL_REFRESH_EVENT_TYPES.has(event.type)) return true
  return event.entityType === "deal_product" && DEAL_PRODUCT_REFRESH_EVENT_TYPES.has(event.type)
}

export function isDealDetailRefreshEvent(event: ServerEvent, dealId: number): boolean {
  if (!Number.isSafeInteger(dealId) || dealId <= 0) return false
  if (event.entityType === "deal" && DEAL_REFRESH_EVENT_TYPES.has(event.type)) {
    return event.entityId === String(dealId)
  }
  if (event.entityType !== "deal_product" || !DEAL_PRODUCT_REFRESH_EVENT_TYPES.has(event.type)) return false
  return readPositiveInteger(event.payload?.dealId) === dealId
}

export function isTaskListRefreshEvent(event: ServerEvent): boolean {
  return event.entityType === "task" && TASK_REFRESH_EVENT_TYPES.has(event.type)
}

export function isDashboardRefreshEvent(event: ServerEvent): boolean {
  return isCustomerListRefreshEvent(event)
    || isDealListRefreshEvent(event)
    || isTaskListRefreshEvent(event)
}

export function isFollowUpSavedViewRefreshEvent(event: ServerEvent): boolean {
  return event.entityType === "saved_view" && SAVED_VIEW_REFRESH_EVENT_TYPES.has(event.type)
}

export function isFollowUpTimelineRefreshEvent(event: ServerEvent, customerId?: number | null): boolean {
  if (event.entityType !== "activity_log" || !ACTIVITY_LOG_REFRESH_EVENT_TYPES.has(event.type)) return false
  if (customerId == null) return true
  if (!Number.isSafeInteger(customerId) || customerId <= 0) return false
  return readPositiveInteger(event.payload?.customerId) === customerId
}

export function isJtlReferenceRefreshEvent(event: ServerEvent, resource?: string | null): boolean {
  if (event.entityType !== "jtl_reference" || !JTL_REFERENCE_REFRESH_EVENT_TYPES.has(event.type)) return false
  const normalizedResource = resource?.trim()
  if (!normalizedResource) return true
  return event.payload?.resource === normalizedResource
}

export function isMailListRefreshEvent(event: ServerEvent): boolean {
  if (event.entityType === "email_message") {
    return MAIL_MESSAGE_REFRESH_EVENT_TYPES.has(event.type)
  }
  if (event.entityType === "email_message_tag") {
    return MAIL_MESSAGE_TAG_REFRESH_EVENT_TYPES.has(event.type)
  }
  if (event.entityType === "email_category") {
    return MAIL_CATEGORY_REFRESH_EVENT_TYPES.has(event.type)
  }
  if (event.entityType === "email_message_category") {
    return MAIL_MESSAGE_CATEGORY_REFRESH_EVENT_TYPES.has(event.type)
  }
  if (event.entityType === "email_read_receipt") {
    return MAIL_READ_RECEIPT_REFRESH_EVENT_TYPES.has(event.type)
  }
  if (event.entityType === "email_thread_edge") {
    return MAIL_THREAD_EDGE_REFRESH_EVENT_TYPES.has(event.type)
  }
  if (event.entityType === "email_thread_alias") {
    return MAIL_THREAD_ALIAS_REFRESH_EVENT_TYPES.has(event.type)
  }
  if (event.entityType === "email_thread") {
    return MAIL_THREAD_REFRESH_EVENT_TYPES.has(event.type)
  }
  return false
}

export function isMailMetadataRefreshEvent(event: ServerEvent): boolean {
  return isMailListRefreshEvent(event)
    || (
      event.entityType === "email_internal_note"
      && MAIL_INTERNAL_NOTE_REFRESH_EVENT_TYPES.has(event.type)
    )
}

export function isMailRemoteContentPolicyRefreshEvent(event: ServerEvent): boolean {
  if (event.entityType === "email_message") {
    return MAIL_MESSAGE_REFRESH_EVENT_TYPES.has(event.type)
  }
  return event.entityType === "email_remote_content_allowlist"
    && MAIL_REMOTE_CONTENT_ALLOWLIST_REFRESH_EVENT_TYPES.has(event.type)
}

export function isMailSpamListRefreshEvent(event: ServerEvent): boolean {
  return event.entityType === "spam_list_entry" && MAIL_SPAM_LIST_ENTRY_REFRESH_EVENT_TYPES.has(event.type)
}

export function isMailTrackingRefreshEvent(event: ServerEvent, messageId?: number | null): boolean {
  if (event.type !== "email_tracking.updated" || event.entityType !== "email_message") return false
  return messageId == null || event.entityId === String(messageId)
}

export function isMailAccountDataRefreshEvent(event: ServerEvent): boolean {
  if (isMailAclRefreshEvent(event)) return true
  if (event.entityType === "email_account") {
    return MAIL_ACCOUNT_REFRESH_EVENT_TYPES.has(event.type)
  }
  if (event.entityType === "email_team_member") {
    return MAIL_TEAM_MEMBER_REFRESH_EVENT_TYPES.has(event.type)
  }
  if (event.entityType === "email_account_signature") {
    return MAIL_ACCOUNT_SIGNATURE_REFRESH_EVENT_TYPES.has(event.type)
  }
  return false
}

export function isMailAclRefreshEvent(event: ServerEvent): boolean {
  return event.entityType === "email_acl" && MAIL_ACL_REFRESH_EVENT_TYPES.has(event.type)
}

export function isMailComposeAuxDataRefreshEvent(event: ServerEvent): boolean {
  if (event.entityType === "email_canned_response") {
    return MAIL_CANNED_RESPONSE_REFRESH_EVENT_TYPES.has(event.type)
  }
  if (event.entityType === "ai_prompt") {
    return MAIL_AI_PROMPT_REFRESH_EVENT_TYPES.has(event.type)
  }
  return false
}

export function isMailAiProfileRefreshEvent(event: ServerEvent): boolean {
  return event.entityType === "ai_profile" && MAIL_AI_PROFILE_REFRESH_EVENT_TYPES.has(event.type)
}

export function isMailPgpKeyRefreshEvent(event: ServerEvent): boolean {
  if (event.entityType === "pgp_identity") {
    return MAIL_PGP_IDENTITY_REFRESH_EVENT_TYPES.has(event.type)
  }
  if (event.entityType === "pgp_peer_key") {
    return MAIL_PGP_PEER_KEY_REFRESH_EVENT_TYPES.has(event.type)
  }
  return false
}

export function isAutomationApiKeyRefreshEvent(event: ServerEvent): boolean {
  return event.entityType === "automation_api_key" && AUTOMATION_API_KEY_REFRESH_EVENT_TYPES.has(event.type)
}

export function isWorkflowListRefreshEvent(event: ServerEvent): boolean {
  return event.entityType === "workflow" && WORKFLOW_REFRESH_EVENT_TYPES.has(event.type)
}

export function isWorkflowVersionRefreshEvent(event: ServerEvent, workflowId?: number | null): boolean {
  if (event.entityType !== "workflow_version" || !WORKFLOW_VERSION_REFRESH_EVENT_TYPES.has(event.type)) return false
  if (workflowId == null) return true
  if (!Number.isSafeInteger(workflowId) || workflowId <= 0) return false
  return readPositiveInteger(event.payload?.workflowId) === workflowId
}

export function isWorkflowKnowledgeRefreshEvent(event: ServerEvent, knowledgeBaseId?: number | null): boolean {
  if (event.entityType === "workflow_knowledge_base") {
    if (!WORKFLOW_KNOWLEDGE_BASE_REFRESH_EVENT_TYPES.has(event.type)) return false
    if (knowledgeBaseId == null) return true
    if (!Number.isSafeInteger(knowledgeBaseId) || knowledgeBaseId <= 0) return false
    return event.entityId === String(knowledgeBaseId)
  }
  if (event.entityType !== "workflow_knowledge_chunk" || !WORKFLOW_KNOWLEDGE_CHUNK_REFRESH_EVENT_TYPES.has(event.type)) {
    return false
  }
  if (knowledgeBaseId == null) return true
  if (!Number.isSafeInteger(knowledgeBaseId) || knowledgeBaseId <= 0) return false
  return readPositiveInteger(event.payload?.knowledgeBaseId) === knowledgeBaseId
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return Number(value)
  return null
}
