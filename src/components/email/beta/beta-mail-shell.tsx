"use client"

import { useCallback, useEffect } from "react"
import { useDefaultLayout } from "react-resizable-panels"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Loader2, PenSquare, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useMailWorkspace } from "../workspace-context"
import { MailSidebar } from "../mail-sidebar"
import { MessageList } from "../message-list"
import { MessageViewer } from "../message-viewer"
import { MessageMetadataPanel } from "../message-metadata-panel"
import { ComposeDialog } from "../compose-dialog"
import { useEmailAccounts } from "../hooks/use-email-accounts"
import { useEmailMessages } from "../hooks/use-email-messages"
import { useEmailCategories } from "../hooks/use-email-categories"
import { useMessageMetadata } from "../hooks/use-message-metadata"
import { useMailAuxData } from "../hooks/use-mail-aux-data"
import { useMailFolderCounts } from "../hooks/use-mail-folder-counts"
import { BetaEmailSubnav } from "./beta-email-subnav"
import { ContextBar } from "@/components/theme/context-bar"

const PANE_IDS = ["sidebar", "message-list", "viewer", "metadata"] as const

export function BetaMailShell() {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "email-beta-panes",
    panelIds: [...PANE_IDS],
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ContextBar
        eyebrow="Kommunikation"
        title="Postfach"
        breadcrumbs={[{ label: "E-Mail", muted: true }, { label: "Postfach" }]}
        tabs={<BetaEmailSubnav embedded />}
        actions={
          <>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 crm-glow-button"
              onClick={() => setComposeIntent({ mode: "new" })}
              disabled={
                selectedAccountId == null ||
                (selectedAccountId !== "all" && !accounts.length) ||
                (selectedAccountId === "all" && accounts.length === 0)
              }
            >
              <PenSquare className="h-3.5 w-3.5" />
              Verfassen
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-8 w-8"
              disabled={selectedAccountId == null || syncing}
              onClick={() => void handleSyncWithCategories()}
            >
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </>
        }
      />
      <ResizablePanelGroup
        direction="horizontal"
        id="email-beta-panes"
        className="min-h-0 flex-1"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <ResizablePanel id={PANE_IDS[0]} defaultSize="18%" minSize="14%" maxSize="26%">
          <MailSidebar
            accounts={accounts}
            loadingAccounts={loadingAccounts}
            categories={categories}
            countForCategory={countForCategory}
            onCategoriesChanged={reloadCategories}
            onMoveMessageToView={moveMessageToView}
          />
        </ResizablePanel>
        <ResizableHandle className="bg-border/60" />
        <ResizablePanel id={PANE_IDS[1]} defaultSize="26%" minSize="18%">
          <MessageList
            messages={messages}
            accounts={accounts}
            loading={loadingMessages}
            onOpen={openMessage}
            onMoveMessageToView={moveMessageToView}
          />
        </ResizablePanel>
        <ResizableHandle className="bg-border/60" />
        <ResizablePanel id={PANE_IDS[2]} defaultSize="36%" minSize="22%">
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
            onReply={(m) => setComposeIntent({ mode: "reply", message: m })}
            onForward={(m) => setComposeIntent({ mode: "forward", message: m })}
            metadataPlacement="external"
          />
        </ResizablePanel>
        <ResizableHandle className="bg-border/60" />
        <ResizablePanel id={PANE_IDS[3]} defaultSize="20%" minSize="14%" maxSize="28%">
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

      <ComposeDialog accounts={accounts} cannedList={cannedList} aiPrompts={aiPrompts} onSent={refreshList} />
    </div>
  )
}
