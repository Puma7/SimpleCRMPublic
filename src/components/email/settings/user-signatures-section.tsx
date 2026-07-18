"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { SignatureQuillEditor } from "../signature-quill-editor"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { invokeRenderer } from "@/services/transport"
import type { AccountSignature, EmailAccount } from "../types"
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html"

type UserSignatureList = {
  user: { displayName: string; publicName: string | null }
  signatures: Array<{ accountId: number; signatureHtml: string; updatedAt: string | null }>
}

type Props = {
  /** When set, hides the account picker and edits this account only. */
  embeddedAccountId?: number
}

// Self-service: every user maintains their own signature per account. These
// take precedence over the shared account signature when composing.
export function UserSignaturesSection({ embeddedAccountId }: Props = {}) {
  const [accounts, setAccounts] = useState<AccountSignature[]>([])
  const [ownByAccount, setOwnByAccount] = useState<Map<number, string>>(new Map())
  const [selectedId, setSelectedId] = useState<string>("")
  const [html, setHtml] = useState("")
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const effectiveId = embeddedAccountId != null ? String(embeddedAccountId) : selectedId

  const load = useCallback(async (keepAccountId?: string) => {
    try {
      const [accountList, userList] = await Promise.all([
        invokeRenderer(IPCChannels.Email.ListAccounts) as Promise<EmailAccount[]>,
        invokeRenderer(IPCChannels.Email.ListUserSignatures) as Promise<UserSignatureList>,
      ])
      setLoadError(null)
      // Use the real account list, not ListAccountSignatures (which only returns
      // accounts that already have a *shared* signature row) — otherwise a user
      // cannot create their first personal signature on an account without one.
      setAccounts(accountList.map((a) => ({
        account_id: a.id,
        display_name: a.display_name,
        email_address: a.email_address,
        signature_html: null,
      })))
      const own = new Map<number, string>()
      for (const sig of userList.signatures) own.set(sig.accountId, sig.signatureHtml)
      setOwnByAccount(own)
      if (accountList.length === 0) {
        setSelectedId("")
        setHtml("")
        return
      }
      const preferred =
        embeddedAccountId != null
          ? String(embeddedAccountId)
          : keepAccountId && accountList.some((r) => String(r.id) === keepAccountId)
            ? keepAccountId
            : String(accountList[0]!.id)
      setSelectedId(preferred)
      setHtml(sanitizeEmailHtml(own.get(Number(preferred)) ?? ""))
    } catch (e) {
      // Surface the failure instead of silently showing the "empty" state.
      setLoadError(e instanceof Error ? e.message : "Signaturen konnten nicht geladen werden.")
    }
  }, [embeddedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  if (loadError) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-destructive">{loadError}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          Erneut versuchen
        </Button>
      </div>
    )
  }

  const onSelectAccount = (id: string) => {
    setSelectedId(id)
    setHtml(sanitizeEmailHtml(ownByAccount.get(Number(id)) ?? ""))
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Legen Sie zuerst unter Konten mindestens ein Postfach an, um eine persönliche Signatur zu
        hinterlegen.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">Meine Signatur je Konto</h3>
        <p className="text-sm text-muted-foreground">
          Ihre persönliche Signatur hat beim Verfassen Vorrang vor der gemeinsamen Konto-Signatur.
          Bleibt sie leer, gilt weiterhin die Konto- bzw. Team-Signatur. Platzhalter:{" "}
          <code className="text-[10px]">{"{{user.publicName}}"}</code>,{" "}
          <code className="text-[10px]">{"{{account.display_name}}"}</code>,{" "}
          <code className="text-[10px]">{"{{customer.name}}"}</code>
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
              {accounts.map((r) => (
                <SelectItem key={r.account_id} value={String(r.account_id)}>
                  {r.display_name} ({r.email_address})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {html.trim() ? (
          <Badge variant="default">Persönliche Signatur gespeichert</Badge>
        ) : (
          <Badge variant="outline">Keine persönliche Signatur — Konto-Signatur greift</Badge>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Signatur</Label>
        <SignatureQuillEditor value={html} onChange={setHtml} />
      </div>
      <Button
        type="button"
        size="sm"
        disabled={saving}
        onClick={async () => {
          const accountId = parseInt(effectiveId, 10)
          if (!Number.isFinite(accountId)) return
          const safeHtml = sanitizeEmailHtml(html).trim()
          setSaving(true)
          try {
            await invokeRenderer(IPCChannels.Email.SaveUserSignature, {
              accountId,
              signatureHtml: safeHtml || null,
            })
            toast.success(safeHtml ? "Persönliche Signatur gespeichert" : "Persönliche Signatur entfernt")
            await load(effectiveId)
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen.")
          } finally {
            setSaving(false)
          }
        }}
      >
        {saving ? "Speichern…" : "Persönliche Signatur speichern"}
      </Button>
    </div>
  )
}
