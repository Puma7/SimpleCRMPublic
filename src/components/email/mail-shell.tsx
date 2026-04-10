"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Mail } from "lucide-react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { MailWorkspaceProvider, useMailWorkspace } from "./workspace-context"
import { MailTopbar } from "./mail-topbar"
import { MailSidebar } from "./mail-sidebar"
import { MessageList } from "./message-list"
import { MessageViewer } from "./message-viewer"
import { ComposeDialog } from "./compose-dialog"
import { SettingsDialog } from "./settings-dialog"
import { useEmailAccounts } from "./hooks/use-email-accounts"
import { useEmailMessages } from "./hooks/use-email-messages"
import { useEmailCategories } from "./hooks/use-email-categories"
import { useMessageMetadata } from "./hooks/use-message-metadata"
import { useMailAuxData } from "./hooks/use-mail-aux-data"
import { hasElectron } from "./types"

function MailShellInner() {
  const { setComposeIntent, selectedAccountId } = useMailWorkspace()
  const { accounts, teamMembers, loadingAccounts } = useEmailAccounts()
  const { categories, countForCategory } = useEmailCategories()
  const {
    messages,
    loadingMessages,
    syncing,
    openMessage,
    refreshList,
    refreshCurrentMessage,
    handleSync,
  } = useEmailMessages()
  const { messageTags, internalNotes, messageAttachments, reloadNotes } =
    useMessageMetadata()
  const { customers, cannedList, aiPrompts } = useMailAuxData()

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden bg-background">
      <MailTopbar
        onCompose={() => setComposeIntent({ mode: "new" })}
        onSync={() => void handleSync()}
        syncing={syncing}
        canSync={selectedAccountId != null}
        canCompose={selectedAccountId != null}
      />

      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal" autoSaveId="email-panes">
          <ResizablePanel defaultSize={18} minSize={14} maxSize={26}>
            <MailSidebar
              accounts={accounts}
              loadingAccounts={loadingAccounts}
              categories={categories}
              countForCategory={countForCategory}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={30} minSize={22}>
            <MessageList
              messages={messages}
              loading={loadingMessages}
              onOpen={openMessage}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={52}>
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
      <SettingsDialog />
    </div>
  )
}

export function MailShell() {
  if (!hasElectron()) {
    return (
      <div className="container max-w-2xl py-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              E-Mail
            </CardTitle>
            <CardDescription>
              Das E-Mail-Modul ist nur in der Desktop-App (Electron) verfügbar. Bitte starten Sie SimpleCRM mit{" "}
              <code className="rounded bg-muted px-1">npm run electron:dev</code>.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    )
  }

  return (
    <MailWorkspaceProvider>
      <MailShellInner />
    </MailWorkspaceProvider>
  )
}
