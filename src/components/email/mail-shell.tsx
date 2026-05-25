"use client"

import { useDefaultLayout } from "react-resizable-panels"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

const MAIL_PANE_IDS = ["sidebar", "message-list", "viewer"] as const
import { useMailWorkspace } from "./workspace-context"
import { MailTopbar } from "./mail-topbar"
import { MailSidebar } from "./mail-sidebar"
import { MessageList } from "./message-list"
import { MessageViewer } from "./message-viewer"
import { ComposeDialog } from "./compose-dialog"
import { useEmailAccounts } from "./hooks/use-email-accounts"
import { useEmailMessages } from "./hooks/use-email-messages"
import { useEmailCategories } from "./hooks/use-email-categories"
import { useMessageMetadata } from "./hooks/use-message-metadata"
import { useMailAuxData } from "./hooks/use-mail-aux-data"
import { useMailFolderCounts } from "./hooks/use-mail-folder-counts"

function MailShellInner() {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "email-panes",
    panelIds: [...MAIL_PANE_IDS],
  })
  const { setComposeIntent, selectedAccountId } = useMailWorkspace()
  const { accounts, teamMembers, loadingAccounts } = useEmailAccounts()
  const { categories, countForCategory, loadCategories } = useEmailCategories()
  const { reloadCounts } = useMailFolderCounts()
  const {
    messages,
    loadingMessages,
    syncing,
    openMessage,
    refreshList: refreshListBase,
    refreshCurrentMessage,
    handleSync,
  } = useEmailMessages()
  const refreshList = async () => {
    await refreshListBase()
    if (selectedAccountId != null) await reloadCounts(selectedAccountId)
  }

  // Preserve old behaviour: after a sync the category counts must refresh as well.
  const handleSyncWithCategories = () =>
    void handleSync({
      onAfterSync: async (accountId) => {
        await loadCategories(accountId)
        await reloadCounts(accountId)
      },
    })
  const { messageTags, internalNotes, messageAttachments, reloadNotes } =
    useMessageMetadata()
  const { customers, cannedList, aiPrompts } = useMailAuxData()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <MailTopbar
        onCompose={() => setComposeIntent({ mode: "new" })}
        onSync={handleSyncWithCategories}
        syncing={syncing}
        canSync={selectedAccountId != null}
        canCompose={selectedAccountId != null}
      />

      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup
          direction="horizontal"
          id="email-panes"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <ResizablePanel
            id={MAIL_PANE_IDS[0]}
            defaultSize="20%"
            minSize="14%"
            maxSize="30%"
          >
            <MailSidebar
              accounts={accounts}
              loadingAccounts={loadingAccounts}
              categories={categories}
              countForCategory={countForCategory}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel
            id={MAIL_PANE_IDS[1]}
            defaultSize="30%"
            minSize="22%"
          >
            <MessageList
              messages={messages}
              loading={loadingMessages}
              onOpen={openMessage}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id={MAIL_PANE_IDS[2]} defaultSize="50%">
            <MessageViewer
              teamMembers={teamMembers}
              customers={customers}
              messageTags={messageTags}
              internalNotes={internalNotes}
              messageAttachments={messageAttachments}
              reloadNotes={reloadNotes}
              refreshCurrentMessage={refreshCurrentMessage}
              refreshList={refreshList}
              onReply={(m) => setComposeIntent({ mode: "reply", message: m })}
              onForward={(m) => setComposeIntent({ mode: "forward", message: m })}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <ComposeDialog
        cannedList={cannedList}
        aiPrompts={aiPrompts}
        customers={customers}
        onSent={refreshList}
      />
    </div>
  )
}

/** Postfach-Inhalt (Provider und Sub-Nav liegen im E-Mail-Layout). */
export function MailShell() {
  return <MailShellInner />
}
