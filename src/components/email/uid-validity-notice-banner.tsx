"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, X } from "lucide-react"
import { IPCChannels } from "@shared/ipc/channels"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { invokeRenderer } from "@/services/transport"

type Notice = {
  id: string
  accountId: number
  folderPath: string
  oldValidity: string | null
  newValidity: string | null
  messageCount: number
  backedUpCount: number
  at: string
}

export function UidValidityNoticeBanner() {
  const [notices, setNotices] = useState<Notice[]>([])

  const load = useCallback(async () => {
    try {
      const rows = await invokeRenderer(IPCChannels.Email.ListUidValidityNotices)
      setNotices(rows ?? [])
    } catch {
      setNotices([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dismiss = async (noticeId: string) => {
    try {
      await invokeRenderer(IPCChannels.Email.DismissUidValidityNotice, { noticeId })
      setNotices((prev) => prev.filter((n) => n.id !== noticeId))
    } catch {
      /* ignore */
    }
  }

  if (notices.length === 0) return null

  return (
    <div className="shrink-0 space-y-2 border-b bg-amber-50/80 px-3 py-2 dark:bg-amber-950/30">
      {notices.map((n) => (
        <Alert
          key={n.id}
          variant="default"
          className="relative border-amber-300 bg-transparent py-2 pr-10"
        >
          <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          <AlertTitle className="text-sm">Postfach neu indiziert (Konto {n.accountId})</AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            Der IMAP-Server hat UIDVALIDITY geändert ({n.folderPath}: {n.oldValidity ?? "?"} →{" "}
            {n.newValidity ?? "?"}). {n.messageCount} Nachrichten wurden lokal entfernt und werden
            beim nächsten Sync neu geladen. Metadaten von {n.backedUpCount} Nachrichten wurden
            gesichert und bei gleicher Message-ID wiederhergestellt (Tags, Kategorien,
            Workflow-Marker).
          </AlertDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-7 w-7"
            aria-label="Hinweis schließen"
            onClick={() => void dismiss(n.id)}
          >
            <X className="h-4 w-4" />
          </Button>
        </Alert>
      ))}
    </div>
  )
}
