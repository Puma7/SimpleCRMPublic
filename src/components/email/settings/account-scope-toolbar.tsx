"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { invokeRenderer } from "@/services/transport"
import type { EmailAccount } from "../types"
import { isGlobalAccountOverride, type ScopedAccountOverrideRow } from "@shared/mail-account-overrides"
export type AccountScopeValue = "all" | number

/** UI rows may omit account_id until loaded from IPC/HTTP. */
export type ScopedOverrideRowInput = {
  account_id?: number | null
  override_key?: string | null
}

type Props = {
  value: AccountScopeValue
  onChange: (scope: AccountScopeValue) => void
  /** Shown above the account filter. */
  description?: string
}

export function AccountScopeToolbar({ value, onChange, description }: Props) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])

  const loadAccounts = useCallback(async () => {
    try {
      const list = (await invokeRenderer(IPCChannels.Email.ListAccounts)) as EmailAccount[]
      setAccounts(list)
    } catch {
      setAccounts([])
    }
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div>
        <Label className="text-xs font-semibold uppercase text-muted-foreground">
          Gültigkeitsbereich
        </Label>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Global = für alle Konten sichtbar. Konto = nur für dieses Postfach (ersetzt globale
            Einträge mit gleichem Override-Key).
          </p>
        )}
      </div>
      <Select
        value={value === "all" ? "all" : String(value)}
        onValueChange={(v) => onChange(v === "all" ? "all" : Number(v))}
      >
        <SelectTrigger className="h-9 max-w-md">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Global (alle Konten)</SelectItem>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>
              {a.display_name || a.email_address} ({a.email_address})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function ScopeBadge({ row }: { row: ScopedOverrideRowInput }) {
  if (isGlobalAccountOverride(row as ScopedAccountOverrideRow)) {
    return <Badge variant="secondary">Global</Badge>
  }
  return <Badge variant="outline">Konto</Badge>
}

export function listPayloadForScope(scope: AccountScopeValue): { accountId: AccountScopeValue } {
  return { accountId: scope }
}

export function mutationScopeFields(
  scope: AccountScopeValue,
  overrideKey?: string | null,
): { accountId: number | null; overrideKey: string | null } {
  return {
    accountId: scope === "all" ? null : scope,
    overrideKey: overrideKey ?? null,
  }
}

/** Preserve global rows when the toolbar is in account scope (resolved inherited entry). */
export function mutationScopeFieldsForRow(
  scope: AccountScopeValue,
  row: ScopedOverrideRowInput,
  overrideKey?: string | null,
): { accountId: number | null; overrideKey: string | null } {
  if (isGlobalAccountOverride(row as ScopedAccountOverrideRow)) {
    return { accountId: null, overrideKey: overrideKey ?? row.override_key ?? null }
  }
  const accountId = row.account_id ?? (scope === "all" ? null : scope)
  return { accountId, overrideKey: overrideKey ?? row.override_key ?? null }
}
