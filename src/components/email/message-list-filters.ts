import type { EmailMessage } from "./types"
import type { MessageListFilter } from "./workspace-context"

export function applyMessageListFilter(
  messages: EmailMessage[],
  filter: MessageListFilter,
): EmailMessage[] {
  switch (filter) {
    case "unread":
      return messages.filter((m) => !m.seen_local && m.uid >= 0)
    case "attachment":
      return messages.filter((m) => !!m.has_attachments)
    case "customer":
      return messages.filter((m) => m.customer_id != null && m.customer_id > 0)
    case "workflow":
      return messages.filter((m) => !!m.outbound_hold || !!m.ticket_code)
    default:
      return messages
  }
}
