"use client"

import { type ReactNode, useState } from "react"
import { Archive, Clock, FileEdit, FolderCog, Inbox, Send, ShieldAlert, Tag, Trash2 } from "lucide-react"
import { MAX_EMAIL_CATEGORY_DEPTH } from "@shared/email-constants"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { CategoryRow, EmailAccount, MailView } from "./types"
import { useMailFolderCounts, type MailFolderCounts } from "./hooks/use-mail-folder-counts"
import { useMailWorkspace } from "./workspace-context"
import { CategoryManageDialog } from "./category-manage-dialog"
import { readMailDragData } from "./mail-drag"
import { Button } from "@/components/ui/button"

type Props = {
  accounts: EmailAccount[]
  loadingAccounts: boolean
  categories: CategoryRow[]
  countForCategory: (id: number) => number
  onCategoriesChanged: () => void | Promise<void>
  onMoveMessageToView: (messageId: number, view: MailView) => Promise<boolean>
}

const DROPPABLE_VIEWS: MailView[] = ["inbox", "archived", "spam", "trash"]

const FOLDERS: {
  id: MailView
  label: string
  icon: typeof Inbox
  countKey: keyof MailFolderCounts
  unreadKey?: keyof MailFolderCounts
}[] = [
  { id: "inbox", label: "Posteingang", icon: Inbox, countKey: "inbox", unreadKey: "inboxUnread" },
  { id: "snoozed", label: "Zurückgestellt", icon: Clock, countKey: "snoozed" },
  { id: "sent", label: "Gesendet", icon: Send, countKey: "sent" },
  { id: "drafts", label: "Entwürfe", icon: FileEdit, countKey: "drafts" },
  { id: "archived", label: "Archiv", icon: Archive, countKey: "archived" },
  { id: "spam", label: "Spam", icon: ShieldAlert, countKey: "spam" },
  { id: "trash", label: "Papierkorb", icon: Trash2, countKey: "trash" },
]

export function MailSidebar({
  accounts,
  loadingAccounts,
  categories,
  countForCategory,
  onCategoriesChanged,
  onMoveMessageToView,
}: Props) {
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [dropTarget, setDropTarget] = useState<MailView | null>(null)
  const {
    selectedAccountId,
    setSelectedAccountId,
    mailView,
    setMailView,
    categoryFilterId,
    setCategoryFilterId,
    setSearchQuery,
  } = useMailWorkspace()
  const { counts } = useMailFolderCounts()

  const renderCategories = (): ReactNode => {
    const roots = categories
      .filter((c) => c.parent_id == null)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    const childrenOf = (pid: number) =>
      categories
        .filter((c) => c.parent_id === pid)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

    const render = (nodes: CategoryRow[], depth: number): ReactNode[] =>
      depth > MAX_EMAIL_CATEGORY_DEPTH
        ? []
        : nodes.flatMap((n) => [
            <button
              key={n.id}
              type="button"
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-muted",
                categoryFilterId === n.id && "bg-muted font-medium",
              )}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => {
                setCategoryFilterId(n.id)
                setMailView("inbox")
                setSearchQuery("")
              }}
            >
              <span className="flex items-center gap-2 truncate">
                <Tag className="h-3 w-3 shrink-0 text-muted-foreground" />
                {n.name}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {countForCategory(n.id)}
              </span>
            </button>,
            ...render(childrenOf(n.id), depth + 1),
          ])
    return render(roots, 0)
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-r bg-muted/20">
      <div className="shrink-0 space-y-1 border-b p-3">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Konto
        </label>
        <Select
          value={
            selectedAccountId === "all"
              ? "all"
              : selectedAccountId != null
                ? String(selectedAccountId)
                : ""
          }
          onValueChange={(v) => {
            if (!v) setSelectedAccountId(null)
            else if (v === "all") setSelectedAccountId("all")
            else setSelectedAccountId(parseInt(v, 10))
          }}
          disabled={loadingAccounts || accounts.length === 0}
        >
          <SelectTrigger className="h-9">
            <SelectValue
              placeholder={
                loadingAccounts
                  ? "Lädt…"
                  : accounts.length === 0
                    ? "Kein Konto"
                    : "Konto wählen"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {accounts.length > 1 ? (
              <SelectItem value="all">Alle Konten</SelectItem>
            ) : null}
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-2">
          {FOLDERS.map(({ id, label, icon: Icon, countKey, unreadKey }) => {
            const total = countKey ? counts[countKey] : 0
            const unread = unreadKey ? counts[unreadKey] : 0
            const badge = unread > 0 ? unread : total > 0 ? total : null
            const canDrop = DROPPABLE_VIEWS.includes(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMailView(id)
                  setCategoryFilterId(null)
                  setSearchQuery("")
                }}
                onDragOver={
                  canDrop
                    ? (e) => {
                        if (!readMailDragData(e.dataTransfer)) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = "move"
                        setDropTarget(id)
                      }
                    : undefined
                }
                onDragLeave={canDrop ? () => setDropTarget((t) => (t === id ? null : t)) : undefined}
                onDrop={
                  canDrop
                    ? (e) => {
                        e.preventDefault()
                        setDropTarget(null)
                        const payload = readMailDragData(e.dataTransfer)
                        if (!payload) return
                        void onMoveMessageToView(payload.messageId, id)
                      }
                    : undefined
                }
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                  mailView === id && categoryFilterId === null && "bg-muted font-medium",
                  dropTarget === id && "ring-2 ring-primary ring-offset-1",
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {badge != null ? (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                      unread > 0
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        <Separator className="my-1" />

        <div className="space-y-0.5 p-2">
          <div className="flex items-center justify-between gap-1 px-2 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Kategorien
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              aria-label="Kategorien verwalten"
              onClick={() => setCategoryDialogOpen(true)}
            >
              <FolderCog className="h-3.5 w-3.5" />
            </Button>
          </div>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-muted",
              categoryFilterId === null && mailView === "inbox" && "bg-muted",
            )}
            onClick={() => {
              setCategoryFilterId(null)
              setMailView("inbox")
            }}
          >
            <Tag className="h-3 w-3 text-muted-foreground" />
            Alle
          </button>
          {renderCategories()}
        </div>
      </ScrollArea>

      <CategoryManageDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        categories={categories}
        onChanged={onCategoriesChanged}
      />
    </aside>
  )
}
