"use client"

import { Copy, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  isAccountSpecificOverride,
  isGlobalAccountOverride,
  type ScopedAccountOverrideRow,
} from "@shared/mail-account-overrides"
import type { AccountScopeValue } from "./account-scope-toolbar"

type Row = Pick<ScopedAccountOverrideRow, "id" | "account_id" | "override_key">

type Props = {
  row: Row
  scope: AccountScopeValue
  onCreateOverride: (row: Row, accountId: number) => Promise<void>
  onResetOverride: (row: Row) => Promise<void>
};

export function AccountOverrideActions({
  row,
  scope,
  onCreateOverride,
  onResetOverride,
}: Props) {
  if (scope === "all") return null

  const accountId = scope
  const showCreate = isGlobalAccountOverride(row as ScopedAccountOverrideRow)
  const showReset =
    isAccountSpecificOverride(row as ScopedAccountOverrideRow)
    && row.account_id === accountId

  if (!showCreate && !showReset) return null

  return (
    <div className="flex flex-wrap gap-2">
      {showCreate ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={() => {
            void onCreateOverride(row, accountId).catch((e) => {
              toast.error(e instanceof Error ? e.message : "Override konnte nicht angelegt werden.")
            })
          }}
        >
          <Copy className="h-3 w-3" />
          Als Konto-Override anlegen
        </Button>
      ) : null}
      {showReset ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs text-muted-foreground"
          onClick={() => {
            if (!window.confirm("Konto-Override löschen und globalen Eintrag wieder verwenden?")) return
            void onResetOverride(row).catch((e) => {
              toast.error(e instanceof Error ? e.message : "Zurücksetzen fehlgeschlagen.")
            })
          }}
        >
          <RotateCcw className="h-3 w-3" />
          Auf Global zurücksetzen
        </Button>
      ) : null}
    </div>
  )
}

export function defaultOverrideKey(prefix: string, rowId: number, existing: string | null | undefined): string {
  const trimmed = existing?.trim()
  if (trimmed) return trimmed
  return `id:${rowId}`
}
