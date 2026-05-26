"use client"

import { useCallback, useEffect } from "react"
import { useDefaultLayout } from "react-resizable-panels"
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
import { useMailFolderCounts } from "./hooks/use-mail-folder-counts"

const MAIL_PANE_IDS = ["sidebar", "message-list", "viewer", "metadata"] as const

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
  } = useMailWorkspace()

  useEffect(() => {
    setMetadataPanelOpen(true)
  }, [setMetadataPanelOpen])

  const { accounts, teamMembers, loadingAccounts } = useEmailAccounts()
  const { categories, countForCategory, loadCategories } = useEmailCategories()
  const reloadCategories = useCallback(async () => {
    if (selectedAccountId != null) await loadCategories(selectedAccountId)
  }, [selectedAccountId, loadCategories])
  const { reloadCounts } = useMailFolderCounts()
  const {
    messages,
    loadingMessages,
    syncing,
    openMessage,
    refreshList: refreshListBase,
    refreshCurrentMessage,
    handleSync,
    moveMessageToView,
  } = useEmailMessages()
  const refreshList = async (opts?: { preserveSelection?: boolean }) => {
    await refreshListBase(opts)
    if (selectedAccountId != null) await reloadCounts(selectedAccountId)
  }
  const handleSyncWithCategories = () =>
    void handleSync({
      onAfterSync: async (accountId) => {
        await loadCategories(accountId)
        await reloadCounts(accountId)
      },
    })
  const { messageTags, internalNotes, messageAttachments, reloadNotes, reloadTags } =
    useMessageMetadata()
  const { cannedList, aiPrompts } = useMailAuxData()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
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
            onCategoriesChanged={reloadCategories}
            onMoveMessageToView={moveMessageToView}
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
            onListChanged={refreshList}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id={MAIL_PANE_IDS[2]} defaultSize="36%" minSize="22%">
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
            onReply={(m, initialReplyHtml) =>
              setComposeIntent({ mode: "reply", message: m, initialReplyHtml })
            }
            onReplyAll={(m, initialReplyHtml) =>
              setComposeIntent({ mode: "reply-all", message: m, initialReplyHtml })
            }
            onForward={(m) => setComposeIntent({ mode: "forward", message: m })}
            metadataPlacement="external"
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id={MAIL_PANE_IDS[3]} defaultSize="20%" minSize="14%" maxSize="28%">
          {selectedMessage ? (
            <MessageMetadataPanel
              teamMembers={teamMembers}
              categories={categories}
              messageTags={messageTags}
              internalNotes={internalNotes}
              reloadNotes={reloadNotes}
              reloadTags={reloadTags}
              refreshCurrentMessage={refreshCurrentMessage}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
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
