"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { hasElectron, invokeIpc, type AccountSignature } from "../types"

export function AccountSignaturesSection() {
  const [rows, setRows] = useState<AccountSignature[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [html, setHtml] = useState("")

  const load = useCallback(async (keepAccountId?: string) => {
    if (!hasElectron()) return
    const list = await invokeIpc<AccountSignature[]>(IPCChannels.Email.ListAccountSignatures)
    setRows(list)
    if (list.length === 0) {
      setSelectedId("")
      setHtml("")
      return
    }
    const id =
      keepAccountId && list.some((r) => String(r.account_id) === keepAccountId)
        ? keepAccountId
        : String(list[0]!.account_id)
    const row = list.find((r) => String(r.account_id) === id) ?? list[0]!
    setSelectedId(id)
    setHtml(row.signature_html ?? "")
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onSelectAccount = (id: string) => {
    setSelectedId(id)
    const row = rows.find((r) => String(r.account_id) === id)
    setHtml(row?.signature_html ?? "")
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Legen Sie zuerst unter Konten mindestens ein Postfach an, um Signaturen pro Shop zu
        hinterlegen.
      </p>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          Signatur pro Konto
        </p>
        <p className="text-xs text-muted-foreground">
          Wird beim Verfassen aus dem jeweiligen Konto eingefügt. Fehlt eine Konto-Signatur, gilt
          die Team-Standardsignatur.
        </p>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Konto</Label>
        <Select value={selectedId} onValueChange={onSelectAccount}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Konto wählen" />
          </SelectTrigger>
          <SelectContent>
            {rows.map((r) => (
              <SelectItem key={r.account_id} value={String(r.account_id)}>
                {r.display_name} ({r.email_address})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Signatur (HTML)</Label>
        <Textarea rows={4} value={html} onChange={(e) => setHtml(e.target.value)} />
      </div>
      <Button
        type="button"
        size="sm"
        onClick={async () => {
          const accountId = parseInt(selectedId, 10)
          if (!Number.isFinite(accountId)) return
          await invokeIpc(IPCChannels.Email.SaveAccountSignature, {
            accountId,
            signatureHtml: html.trim() || null,
          })
          toast.success("Konto-Signatur gespeichert")
          await load(selectedId)
        }}
      >
        Konto-Signatur speichern
      </Button>
    </div>
  )
}
