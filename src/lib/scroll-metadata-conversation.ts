export const METADATA_CONVERSATION_SECTION_ID = "email-metadata-conversation"

const HIGHLIGHT_CLASS = "metadata-conversation-highlight"

/** Scroll the details panel to the correspondent history block. */
export function scrollToMetadataConversationSection(): boolean {
  const el = document.getElementById(METADATA_CONVERSATION_SECTION_ID)
  if (!el) return false

  el.scrollIntoView({ behavior: "smooth", block: "nearest" })

  el.classList.remove(HIGHLIGHT_CLASS)
  void el.offsetWidth
  el.classList.add(HIGHLIGHT_CLASS)
  window.setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 2200)

  return true
}
