"use client"

import { type ReactNode } from "react"
import { Archive, FileEdit, Inbox, Send, Tag } from "lucide-react"
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
import { useMailWorkspace } from "./workspace-context"

type Props = {
  accounts: EmailAccount[]
  loadingAccounts: boolean
  categories: CategoryRow[]
  countForCategory: (id: number) => number
}

const FOLDERS: { id: MailView; label: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Posteingang", icon: Inbox },
  { id: "sent", label: "Gesendet", icon: Send },
  { id: "drafts", label: "Entwürfe", icon: FileEdit },
  { id: "archived", label: "Archiv", icon: Archive },
]

export function MailSidebar({
  accounts,
  loadingAccounts,
  categories,
  countForCategory,
}: Props) {
  const {
    selectedAccountId,
    setSelectedAccountId,
    mailView,
    setMailView,
    categoryFilterId,
    setCategoryFilterId,
    setSearchQuery,
  } = useMailWorkspace()

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
          value={selectedAccountId != null ? String(selectedAccountId) : ""}
          onValueChange={(v) => setSelectedAccountId(v ? parseInt(v, 10) : null)}
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
          {FOLDERS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMailView(id)
                setCategoryFilterId(null)
                setSearchQuery("")
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                mailView === id && categoryFilterId === null && "bg-muted font-medium",
              )}
            >
              <Icon className="h-4 w-4 text-muted-foreground" />
              {label}
            </button>
          ))}
        </div>

        <Separator className="my-1" />

        <div className="space-y-0.5 p-2">
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Kategorien
          </p>
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
    </aside>
  )
}
