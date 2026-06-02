"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { hasElectron, invokeIpc } from "@/components/email/types"

type Warning = {
  messageId: number
  subject: string | null
  aliasThreadId: string
  canonicalThreadId: string
  confidence: string
}

export function ThreadToolsPanel() {
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [aliasId, setAliasId] = useState("")
  const [canonId, setCanonId] = useState("")
  const [mergeAccountId, setMergeAccountId] = useState("")
  const [splitMsgId, setSplitMsgId] = useState("")

  const reload = useCallback(async () => {
    if (!hasElectron()) return
    const w = await invokeIpc(IPCChannels.Email.ListThreadAliasWarnings, undefined)
    if (Array.isArray(w)) setWarnings(w as Warning[])
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Thread-Werkzeuge (Support)</h2>
        <p className="text-sm text-muted-foreground">
          Manuelles Zusammenführen oder Trennen von Konversationen. Cross-Account-Hinweise unten.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Threads zusammenführen</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label>Alias Thread-ID</Label>
            <Input value={aliasId} onChange={(e) => setAliasId(e.target.value)} />
          </div>
          <div>
            <Label>Kanonische Thread-ID</Label>
            <Input value={canonId} onChange={(e) => setCanonId(e.target.value)} />
          </div>
          <div>
            <Label>Konto-ID</Label>
            <Input value={mergeAccountId} onChange={(e) => setMergeAccountId(e.target.value)} />
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={async () => {
            const accountId = parseInt(mergeAccountId, 10)
            if (!Number.isFinite(accountId)) {
              toast.error("Konto-ID erforderlich")
              return
            }
            const r = await invokeIpc(IPCChannels.Email.MergeThreads, {
              aliasThreadId: aliasId.trim(),
              canonicalThreadId: canonId.trim(),
              accountId,
            })
            if (r && typeof r === "object" && "success" in r && (r as { success: boolean }).success) {
              toast.success("Zusammengeführt")
              void reload()
            } else {
              toast.error("Merge fehlgeschlagen")
            }
          }}
        >
          Merge
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">Nachricht abtrennen</h3>
        <Label>Nachrichten-ID</Label>
        <Input value={splitMsgId} onChange={(e) => setSplitMsgId(e.target.value)} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            const id = parseInt(splitMsgId, 10)
            if (!Number.isFinite(id)) return
            const r = await invokeIpc(IPCChannels.Email.SplitMessageThread, { messageId: id })
            if (r && typeof r === "object" && "success" in r && (r as { success: boolean }).success) {
              toast.success("Abgetrennt")
            }
          }}
        >
          Split
        </Button>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Mögliche Cross-Account-Threads</h3>
        {warnings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Hinweise.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {warnings.map((w) => (
              <li key={`${w.messageId}-${w.aliasThreadId}`} className="rounded border p-2">
                Msg #{w.messageId}: {w.subject ?? "(ohne Betreff)"} — confidence {w.confidence}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
