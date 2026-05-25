export const MAIL_DRAG_TYPE = "application/x-simplecrm-mail"

export type MailDragPayload = {
  messageId: number
}

export function setMailDragData(dt: DataTransfer, messageId: number): void {
  const payload: MailDragPayload = { messageId }
  dt.setData(MAIL_DRAG_TYPE, JSON.stringify(payload))
  dt.effectAllowed = "move"
}

export function readMailDragData(dt: DataTransfer): MailDragPayload | null {
  const raw = dt.getData(MAIL_DRAG_TYPE)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as MailDragPayload
    if (typeof parsed.messageId === "number" && parsed.messageId > 0) return parsed
  } catch {
    return null
  }
  return null
}
