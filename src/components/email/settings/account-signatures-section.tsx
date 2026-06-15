"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  getRendererTransport,
  invokeRenderer,
  isMailAccountDataRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import type { AccountSignature } from "../types"

type Props = {
  /** When set, hides the account picker and edits this account only (Konten → Signatur tab). */
  embeddedAccountId?: number
}

type SignatureStatus = "saved" | "empty_fallback" | "unknown"

export function AccountSignaturesSection({ embeddedAccountId }: Props) {
  const [rows, setRows] = useState<AccountSignature[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [html, setHtml] = useState("")
  const [resolvedPreview, setResolvedPreview] = useState<string | null>(null)
  const [status, setStatus] = useState<SignatureStatus>("unknown")
  const [saving, setSaving] = useState(false)

  const effectiveId =
    embeddedAccountId != null ? String(embeddedAccountId) : selectedId

  const refreshStatus = useCallback(async (accountId: number, draftHtml: string) => {
    const trimmed = draftHtml.trim()
    if (trimmed) {
      setStatus("saved")
    }
    try {
      const r = (await invokeRenderer(IPCChannels.Email.GetComposeSignature, {
        accountId,
      })) as { html: string | null }
      setResolvedPreview(r.html?.trim() || null)
      if (!trimmed) {
        setStatus(r.html?.trim() ? "empty_fallback" : "unknown")
      }
    } catch {
      if (!trimmed) setStatus("unknown")
      setResolvedPreview(null)
    }
  }, [])

  const load = useCallback(
    async (keepAccountId?: string) => {
      const list = (await invokeRenderer(
        IPCChannels.Email.ListAccountSignatures,
      )) as AccountSignature[]
      setRows(list)
      if (list.length === 0) {
        setSelectedId("")
        setHtml("")
        setStatus("unknown")
        return
      }
      const preferred =
        embeddedAccountId != null
          ? String(embeddedAccountId)
          : keepAccountId && list.some((r) => String(r.account_id) === keepAccountId)
            ? keepAccountId
            : String(list[0]!.account_id)
      const row = list.find((r) => String(r.account_id) === preferred) ?? list[0]!
      setSelectedId(preferred)
      const sigHtml = row.signature_html ?? ""
      setHtml(sigHtml)
      await refreshStatus(row.account_id, sigHtml)
    },
    [embeddedAccountId, refreshStatus],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (getRendererTransport().kind !== "http") return
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (isMailAccountDataRefreshEvent(event)) void load(effectiveId || undefined)
      },
    })
    return () => subscription.unsubscribe()
  }, [load, effectiveId])

  const onSelectAccount = (id: string) => {
    setSelectedId(id)
    const row = rows.find((r) => String(r.account_id) === id)
    const sigHtml = row?.signature_html ?? ""
    setHtml(sigHtml)
    const accountId = parseInt(id, 10)
    if (Number.isFinite(accountId)) void refreshStatus(accountId, sigHtml)
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Legen Sie zuerst unter Konten mindestens ein Postfach an, um Signaturen pro Shop zu
        hinterlegen.
      </p>
    )
  }

  const activeRow = rows.find((r) => String(r.account_id) === effectiveId)

  const statusBadge = () => {
    if (html.trim()) {
      return <Badge variant="default">Konto-Signatur gespeichert</Badge>
    }
    if (status === "empty_fallback") {
      return <Badge variant="secondary">Leer — Team-Fallback beim Verfassen</Badge>
    }
    return <Badge variant="outline">Noch keine Konto-Signatur</Badge>
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">Signatur pro Konto</h3>
        <p className="text-sm text-muted-foreground">
          Wird beim Verfassen aus dem jeweiligen Konto eingefügt (auch bei Antworten). Fehlt eine
          Konto-Signatur, gilt die Team-Standardsignatur unter Einstellungen → Team. Platzhalter:{" "}
          <code className="text-[10px]">{"{{account.display_name}}"}</code>,{" "}
          <code className="text-[10px]">{"{{user.name}}"}</code>,{" "}
          <code className="text-[10px]">{"{{customer.name}}"}</code>,{" "}
          <code className="text-[10px]">{"{{customer.firstName}}"}</code>,{" "}
          <code className="text-[10px]">{"{{customer.email}}"}</code>
        </p>
      </div>
      {embeddedAccountId == null ? (
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
      ) : activeRow ? (
        <p className="text-sm text-muted-foreground">
          Postfach: <strong>{activeRow.email_address}</strong>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">{statusBadge()}</div>
      <div className="space-y-1.5">
        <Label className="text-xs">Signatur (HTML)</Label>
        <Textarea rows={6} value={html} onChange={(e) => setHtml(e.target.value)} />
      </div>
      {resolvedPreview ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Vorschau beim Verfassen</Label>
          <div
            className="rounded-md border bg-muted/30 px-3 py-2 text-sm [&_a]:text-primary"
            dangerouslySetInnerHTML={{ __html: resolvedPreview }}
          />
        </div>
      ) : null}
      <Button
        type="button"
        size="sm"
        disabled={saving}
        onClick={async () => {
          const accountId = parseInt(effectiveId, 10)
          if (!Number.isFinite(accountId)) return
          setSaving(true)
          try {
            await invokeRenderer(IPCChannels.Email.SaveAccountSignature, {
              accountId,
              signatureHtml: html.trim() || null,
            })
            const verify = (await invokeRenderer(IPCChannels.Email.GetComposeSignature, {
              accountId,
            })) as { html: string | null }
            toast.success("Konto-Signatur gespeichert")
            await load(effectiveId)
            if (html.trim() && !verify.html?.includes(html.trim().slice(0, 20))) {
              toast.message("Hinweis: Beim Verfassen kann die Team-Signatur greifen, wenn die Konto-Signatur leer bleibt.")
            }
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen.")
          } finally {
            setSaving(false)
          }
        }}
      >
        {saving ? "Speichern…" : "Konto-Signatur speichern"}
      </Button>
    </div>
  )
}
