"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useDefaultLayout } from "react-resizable-panels"
import { toast } from "sonner"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { useMailWorkspace } from "./workspace-context"
import { MailTopbar } from "./mail-topbar"
import { MailSidebar } from "./mail-sidebar"
import { MessageList } from "./message-list"
import { MessageViewer } from "./message-viewer"
import { MessageMetadataPanel } from "./message-metadata-panel"
import { ComposeDialog } from "./compose-dialog"
import { useEmailAccounts } from "./hooks/use-email-accounts"
import { useEmailMessages } from "./hooks/use-email-messages"
import { useEmailCategories } from "./hooks/use-email-categories"
import { useMessageMetadata } from "./hooks/use-message-metadata"
import { useMailAuxData } from "./hooks/use-mail-aux-data"
import { UidValidityNoticeBanner } from "./uid-validity-notice-banner"
import { ImapAuthNoticeBanner } from "./imap-auth-notice-banner"
import { useConversationLocks } from "./use-conversation-locks"
import type { ConversationLockReason, EmailMessage, MailView } from "./types"
import {
  getRendererTransport,
  isMailAccountDataRefreshEvent,
  isMailComposeAuxDataRefreshEvent,
  isMailListRefreshEvent,
  isMailMetadataRefreshEvent,
  isMailRemoteContentPolicyRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"

const MAIL_PANE_IDS = ["sidebar", "message-list", "viewer", "metadata"] as const
type MailEventRefreshRequest = {
  accounts: boolean
  composeAux: boolean
  list: boolean
  metadata: boolean
  remotePolicy: boolean
}

/** Minimum gap between actual IMAP polls when the refresh button is clicked. */
const IMAP_SYNC_MIN_GAP_MS = 15_000

function MailShellInner() {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "email-panes",
    panelIds: [...MAIL_PANE_IDS],
  })
  const {
    setComposeIntent,
    selectedAccountId,
    selectedMessage,
    setMetadataPanelOpen,
    bumpAccountsRevision,
    bumpMailMetricsRevision,
  } = useMailWorkspace()

  useEffect(() => {
    setMetadataPanelOpen(true)
  }, [setMetadataPanelOpen])

  const invalidateMailMetrics = useCallback(() => {
    bumpMailMetricsRevision()
  }, [bumpMailMetricsRevision])

  const { accounts, teamMembers, loadingAccounts } = useEmailAccounts()
  const { categories, countForCategory } = useEmailCategories()
  const {
    messages,
    loadingMessages,
    syncing,
    openMessage,
    refreshList: refreshListBase,
    refreshCurrentMessage,
    handleSync,
    moveMessageToView: moveMessageToViewBase,
    assignMessageCategory: assignMessageCategoryBase,
    snoozeMessageUntilTomorrow: snoozeMessageUntilTomorrowBase,
    advanceSelectionAfterMessageRemoved: advanceSelectionAfterMessageRemovedBase,
    loadMore,
    hasMore,
    loadingMore,
  } = useEmailMessages()
  const { acquireConversationLock } = useConversationLocks(messages)

  const advanceSelectionAfterMessageRemoved = useCallback(
    async (removedId: number) => {
      await advanceSelectionAfterMessageRemovedBase(removedId)
      invalidateMailMetrics()
    },
    [advanceSelectionAfterMessageRemovedBase, invalidateMailMetrics],
  )

  const refreshList = useCallback(
    async (opts?: {
      preserveSelection?: boolean
      selectMessageId?: number | null
      advanceFromRemovedId?: number
    }) => {
      await refreshListBase(opts)
      invalidateMailMetrics()
    },
    [refreshListBase, invalidateMailMetrics],
  )

  const handleListChanged = useCallback(
    async (opts?: {
      advanceFromMessageId?: number
      selectMessageId?: number | null
    }) => {
      if (opts?.selectMessageId !== undefined) {
        await refreshList({ selectMessageId: opts.selectMessageId })
      } else if (opts?.advanceFromMessageId != null) {
        await advanceSelectionAfterMessageRemoved(opts.advanceFromMessageId)
      } else {
        await refreshList()
      }
    },
    [refreshList, advanceSelectionAfterMessageRemoved],
  )

  const moveMessageToView = useCallback(
    async (messageId: number, view: MailView) => {
      const ok = await moveMessageToViewBase(messageId, view)
      if (ok) invalidateMailMetrics()
      return ok
    },
    [moveMessageToViewBase, invalidateMailMetrics],
  )

  const assignMessageCategory = useCallback(
    async (messageId: number, categoryId: number) => {
      const ok = await assignMessageCategoryBase(messageId, categoryId)
      if (ok) invalidateMailMetrics()
      return ok
    },
    [assignMessageCategoryBase, invalidateMailMetrics],
  )

  const snoozeMessageUntilTomorrow = useCallback(
    async (messageId: number) => {
      const ok = await snoozeMessageUntilTomorrowBase(messageId)
      if (ok) invalidateMailMetrics()
      return ok
    },
    [snoozeMessageUntilTomorrowBase, invalidateMailMetrics],
  )

  // Refresh always reloads the list view from the DB (cheap, can be clicked
  // often). The actual IMAP poll is throttled to at most once per 15s here (the
  // server throttles too), so frequent clicks update the view without hammering
  // the mail server.
  const lastImapSyncRef = useRef(0)
  const handleSyncWithCategories = useCallback(() => {
    void (async () => {
      const now = Date.now()
      if (now - lastImapSyncRef.current >= IMAP_SYNC_MIN_GAP_MS) {
        lastImapSyncRef.current = now
        await handleSync({ onAfterSync: () => refreshList({ preserveSelection: true }) })
      } else {
        await refreshList({ preserveSelection: true })
      }
      invalidateMailMetrics()
    })()
  }, [handleSync, refreshList, invalidateMailMetrics])

  const { messageTags, internalNotes, messageAttachments, reloadNotes, reloadTags } =
    useMessageMetadata()
  const { cannedList, aiPrompts, reloadCanned, reloadPrompts } = useMailAuxData()
  const serverClientMode = getRendererTransport().kind === "http"
  const mailEventRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mailEventRefreshRequestRef = useRef<MailEventRefreshRequest>({
    accounts: false,
    composeAux: false,
    list: false,
    metadata: false,
    remotePolicy: false,
  })
  const [remoteContentPolicyRefreshKey, setRemoteContentPolicyRefreshKey] = useState(0)
  const mailEventHandlersRef = useRef({
    refreshList,
    refreshCurrentMessage,
    reloadNotes,
    reloadTags,
    reloadCanned,
    reloadPrompts,
    bumpAccountsRevision,
    invalidateMailMetrics,
  })

  useEffect(() => {
    mailEventHandlersRef.current = {
      refreshList,
      refreshCurrentMessage,
      reloadNotes,
      reloadTags,
      reloadCanned,
      reloadPrompts,
      bumpAccountsRevision,
      invalidateMailMetrics,
    }
  }, [
    refreshList,
    refreshCurrentMessage,
    reloadNotes,
    reloadTags,
    reloadCanned,
    reloadPrompts,
    bumpAccountsRevision,
    invalidateMailMetrics,
  ])

  useEffect(() => {
    if (!serverClientMode) return

    const scheduleRefresh = (request: Partial<MailEventRefreshRequest>) => {
      mailEventRefreshRequestRef.current = {
        accounts: mailEventRefreshRequestRef.current.accounts || request.accounts === true,
        composeAux: mailEventRefreshRequestRef.current.composeAux || request.composeAux === true,
        list: mailEventRefreshRequestRef.current.list || request.list === true,
        metadata: mailEventRefreshRequestRef.current.metadata || request.metadata === true,
        remotePolicy: mailEventRefreshRequestRef.current.remotePolicy || request.remotePolicy === true,
      }
      if (mailEventRefreshTimerRef.current !== null) {
        clearTimeout(mailEventRefreshTimerRef.current)
      }
      mailEventRefreshTimerRef.current = setTimeout(() => {
        mailEventRefreshTimerRef.current = null
        const refreshRequest = mailEventRefreshRequestRef.current
        mailEventRefreshRequestRef.current = {
          accounts: false,
          composeAux: false,
          list: false,
          metadata: false,
          remotePolicy: false,
        }
        const handlers = mailEventHandlersRef.current

        if (refreshRequest.accounts) {
          handlers.bumpAccountsRevision()
        }
        if (refreshRequest.composeAux) {
          void handlers.reloadCanned()
          void handlers.reloadPrompts()
        }
        if (refreshRequest.list) {
          void handlers.refreshList({ preserveSelection: true })
        }
        if (refreshRequest.metadata) {
          void handlers.refreshCurrentMessage()
          void handlers.reloadNotes()
          void handlers.reloadTags()
        }
        if (refreshRequest.remotePolicy) {
          setRemoteContentPolicyRefreshKey((value) => value + 1)
        }
      }, 250)
    }

    const subscription = subscribeServerEvents({
      onEvent(event) {
        const refreshListFromEvent = isMailListRefreshEvent(event)
        const refreshMetadataFromEvent = isMailMetadataRefreshEvent(event)
        const refreshAccountsFromEvent = isMailAccountDataRefreshEvent(event)
        const refreshComposeAuxFromEvent = isMailComposeAuxDataRefreshEvent(event)
        const refreshRemotePolicyFromEvent = isMailRemoteContentPolicyRefreshEvent(event)
        if (
          !refreshListFromEvent
          && !refreshMetadataFromEvent
          && !refreshAccountsFromEvent
          && !refreshComposeAuxFromEvent
          && !refreshRemotePolicyFromEvent
        ) {
          return
        }
        scheduleRefresh({
          accounts: refreshAccountsFromEvent,
          composeAux: refreshComposeAuxFromEvent,
          list: refreshListFromEvent,
          metadata: refreshMetadataFromEvent,
          remotePolicy: refreshRemotePolicyFromEvent,
        })
      },
    })

    return () => {
      if (mailEventRefreshTimerRef.current !== null) {
        clearTimeout(mailEventRefreshTimerRef.current)
        mailEventRefreshTimerRef.current = null
      }
      mailEventRefreshRequestRef.current = {
        accounts: false,
        composeAux: false,
        list: false,
        metadata: false,
        remotePolicy: false,
      }
      subscription.unsubscribe()
    }
  }, [serverClientMode])

  const startLockedCompose = useCallback(async (
    mode: "reply" | "reply-all" | "forward",
    message: EmailMessage,
    initialReplyHtml?: string,
  ) => {
    const reason: ConversationLockReason = mode === "forward" ? "forward" : "reply"
    const lock = await acquireConversationLock(message.id, reason)
    if (!lock.ok) {
      toast.warning(lock.message)
      return
    }
    if (mode === "forward") {
      setComposeIntent({ mode, message })
    } else {
      setComposeIntent({ mode, message, initialReplyHtml })
    }
  }, [acquireConversationLock, setComposeIntent])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <UidValidityNoticeBanner />
      <ImapAuthNoticeBanner />
      <MailTopbar
        onCompose={() => setComposeIntent({ mode: "new" })}
        onSync={handleSyncWithCategories}
        syncing={syncing}
        canSync={selectedAccountId != null}
        canCompose={
          selectedAccountId != null &&
          (selectedAccountId !== "all" || accounts.length > 0)
        }
      />

      <ResizablePanelGroup
        direction="horizontal"
        id="email-panes"
        className="min-h-0 flex-1"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <ResizablePanel id={MAIL_PANE_IDS[0]} defaultSize="18%" minSize="14%" maxSize="28%">
          <MailSidebar
            accounts={accounts}
            loadingAccounts={loadingAccounts}
            categories={categories}
            countForCategory={countForCategory}
            onCategoriesChanged={invalidateMailMetrics}
            onMoveMessageToView={moveMessageToView}
            onAssignMessageCategory={assignMessageCategory}
            onSnoozeMessage={snoozeMessageUntilTomorrow}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id={MAIL_PANE_IDS[1]} defaultSize="26%" minSize="18%">
          <MessageList
            messages={messages}
            accounts={accounts}
            loading={loadingMessages}
            onOpen={openMessage}
            onMoveMessageToView={moveMessageToView}
            onListChanged={handleListChanged}
            loadMore={loadMore}
            hasMore={hasMore}
            loadingMore={loadingMore}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          id={MAIL_PANE_IDS[2]}
          defaultSize="42%"
          minSize="28%"
          className="min-w-0"
        >
          <MessageViewer
            teamMembers={teamMembers}
            categories={categories}
            messageTags={messageTags}
            internalNotes={internalNotes}
            messageAttachments={messageAttachments}
            reloadNotes={reloadNotes}
            reloadTags={reloadTags}
            refreshCurrentMessage={refreshCurrentMessage}
            refreshList={refreshList}
            advanceSelectionAfterMessageRemoved={advanceSelectionAfterMessageRemoved}
            onReply={(m, initialReplyHtml) => void startLockedCompose("reply", m, initialReplyHtml)}
            onReplyAll={(m, initialReplyHtml) => void startLockedCompose("reply-all", m, initialReplyHtml)}
            onForward={(m) => void startLockedCompose("forward", m)}
            metadataPlacement="external"
            remoteContentPolicyRefreshKey={remoteContentPolicyRefreshKey}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          id={MAIL_PANE_IDS[3]}
          defaultSize="18%"
          minSize="12%"
          maxSize="32%"
          className="min-w-0"
        >
          {selectedMessage ? (
            <MessageMetadataPanel
              fillWidth
              teamMembers={teamMembers}
              categories={categories}
              messageTags={messageTags}
              internalNotes={internalNotes}
              reloadNotes={reloadNotes}
              reloadTags={reloadTags}
              refreshCurrentMessage={refreshCurrentMessage}
            />
          ) : (
            <div className="flex h-full w-full min-w-0 flex-col items-center justify-center border-l bg-muted/10 p-4 text-center text-xs text-muted-foreground">
              Details zur Nachricht
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      <ComposeDialog
        accounts={accounts}
        cannedList={cannedList}
        aiPrompts={aiPrompts}
        onSent={refreshList}
      />
    </div>
  )
}

/** Postfach-Inhalt (Provider und Sub-Nav liegen im E-Mail-Layout). */
export function MailShell() {
  return <MailShellInner />
}
