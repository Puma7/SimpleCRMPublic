export const MAIL_DRAG_TYPE = "application/x-simplecrm-mail"

export type MailDragPayload = {
  /** Primary dragged message (kept for backwards compatibility). */
  messageId: number
  /** All dragged messages (>= 1). When a selection is dragged this holds the
   *  whole selection; otherwise just [messageId]. */
  messageIds: number[]
}

export function setMailDragData(dt: DataTransfer, messageIds: number | number[]): void {
  const ids = (Array.isArray(messageIds) ? messageIds : [messageIds]).filter(
    (id) => typeof id === "number" && id > 0,
  )
  const primary = ids[0]
  if (primary === undefined) return
  const payload: MailDragPayload = { messageId: primary, messageIds: ids }
  dt.setData(MAIL_DRAG_TYPE, JSON.stringify(payload))
  dt.effectAllowed = "copyMove"
}

export function readMailDragData(dt: DataTransfer): MailDragPayload | null {
  const raw = dt.getData(MAIL_DRAG_TYPE)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<MailDragPayload>
    const primary =
      typeof parsed.messageId === "number" && parsed.messageId > 0 ? parsed.messageId : null
    const list = Array.isArray(parsed.messageIds)
      ? parsed.messageIds.filter((id): id is number => typeof id === "number" && id > 0)
      : []
    const messageIds = list.length > 0 ? list : primary !== null ? [primary] : []
    if (messageIds.length === 0) return null
    return { messageId: messageIds[0]!, messageIds }
  } catch {
    return null
  }
}
