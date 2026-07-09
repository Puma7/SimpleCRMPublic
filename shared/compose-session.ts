/** Intent input for session/draft keys (accepts full ComposeIntent minus closed). */
export type ComposeSessionIntentInput = {
  mode: string
  messageId?: number
}

export type ComposeSessionSnapshot = {
  initKey: string
  draftId: number
  replyToId: number | null
  keepReplyOpenInInbox?: boolean
  pgpEncrypt?: boolean
  pgpSign?: boolean
}

/** Stable key for session resume (no bootstrap generation — survives remount). */
export function buildComposeSessionKey(
  intent: ComposeSessionIntentInput,
  accountId: number,
): string {
  return `${intent.mode}:${accountId}:${intent.mode === "draft" ? intent.messageId : ""}`
}

export function buildComposeDraftInitKey(
  intent: ComposeSessionIntentInput,
  accountId: number,
  bootstrapGen: number,
): string {
  return `${buildComposeSessionKey(intent, accountId)}:g${bootstrapGen}`
}

export function buildComposeSessionSnapshot(
  intent: ComposeSessionIntentInput,
  accountId: number,
  sessionDraftId: number,
  sessionReplyToId: number | null,
  flags: {
    keepReplyOpenInInbox: boolean
    pgpEncrypt: boolean
    pgpSign: boolean
  },
): ComposeSessionSnapshot {
  return {
    initKey: buildComposeSessionKey(intent, accountId),
    draftId: sessionDraftId,
    replyToId: sessionReplyToId,
    keepReplyOpenInInbox: flags.keepReplyOpenInInbox,
    pgpEncrypt: flags.pgpEncrypt,
    pgpSign: flags.pgpSign,
  }
}
