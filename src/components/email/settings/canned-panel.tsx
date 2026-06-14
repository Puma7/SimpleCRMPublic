"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  getRendererTransport,
  invokeRenderer,
  isMailComposeAuxDataRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import type { CannedResponse } from "../types"
import {
  AccountScopeToolbar,
  ScopeBadge,
  listPayloadForScope,
  mutationScopeFields,
  mutationScopeFieldsForRow,
  type AccountScopeValue,
} from "./account-scope-toolbar"
import { AccountOverrideActions } from "./account-override-actions"
import {
  createCannedAccountOverride,
  resetCannedAccountOverride,
} from "./account-override-mutations"

export function CannedPanel() {
  const [items, setItems] = useState<CannedResponse[]>([])
  const [scope, setScope] = useState<AccountScopeValue>("all")

  const load = useCallback(async () => {
    setItems(await invokeRenderer(
      IPCChannels.Email.ListCannedResponses,
      listPayloadForScope(scope),
    ) as CannedResponse[])
  }, [scope])

  const save = useCallback(async (id: number, row: CannedResponse) => {
    const title = (document.getElementById(`ct-${id}`) as HTMLInputElement | null)?.value ?? ""
    const body = (document.getElementById(`cb-${id}`) as HTMLTextAreaElement | null)?.value ?? ""
    try {
      await invokeRenderer(IPCChannels.Email.SaveCannedResponse, {
        id,
        title,
        body,
        ...mutationScopeFieldsForRow(scope, row, row.override_key),
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Textbaustein konnte nicht gespeichert werden.")
    }
  }, [scope])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (getRendererTransport().kind !== "http") return
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (isMailComposeAuxDataRefreshEvent(event)) void load()
      },
    })
    return () => subscription.unsubscribe()
  }, [load])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Textbausteine</h3>
        <p className="text-sm text-muted-foreground">
          Vorlagen für wiederkehrende Antworten. Platzhalter: {"{{customer.name}}"}, {"{{customer.firstName}}"}, {"{{customer.email}}"}.
        </p>
      </div>

      <AccountScopeToolbar value={scope} onChange={setScope} />

      <div className="space-y-3">
        {items.map((c) => (
          <div key={c.id} className="space-y-2 rounded border p-3">
            <div className="flex items-center gap-2">
              <ScopeBadge row={c} />
              {c.override_key ? (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {c.override_key}
                </Badge>
              ) : null}
            </div>
            <Input
              defaultValue={c.title}
              id={`ct-${c.id}`}
              onBlur={() => void save(c.id, c)}
            />
            <Textarea
              defaultValue={c.body}
              id={`cb-${c.id}`}
              className="min-h-[80px] font-mono text-sm"
              onBlur={() => void save(c.id, c)}
            />
            <AccountOverrideActions
              row={c}
              scope={scope}
              onCreateOverride={async (row, accountId) => {
                await createCannedAccountOverride(c, accountId)
                toast.success("Konto-Override angelegt.")
                await load()
              }}
              onResetOverride={async (row) => {
                await resetCannedAccountOverride(row.id)
                toast.success("Auf globalen Eintrag zurückgesetzt.")
                await load()
              }}
            />
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await invokeRenderer(IPCChannels.Email.SaveCannedResponse, {
              title: "Neuer Textbaustein",
              body: "Hallo {{customer.firstName}},\n\n",
              ...mutationScopeFields(scope),
            })
            await load()
            toast.success("Textbaustein angelegt.")
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Anlegen fehlgeschlagen.")
          }
        }}
      >
        <Plus className="mr-1 h-4 w-4" />
        Neuer Textbaustein
      </Button>
    </div>
  )
}
