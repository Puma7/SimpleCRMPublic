"use client"

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { AlertTriangle, X } from "lucide-react"
import { IPCChannels } from "@shared/ipc/channels"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { emailSettingsSearch } from "@/lib/email-settings-search"
import { invokeRenderer } from "@/services/transport"

type Notice = {
  accountId: number
  message: string
  at: string
}

export function ImapAuthNoticeBanner() {
  const navigate = useNavigate()
  const [notices, setNotices] = useState<Notice[]>([])

  const load = useCallback(async () => {
    try {
      const rows = await invokeRenderer(IPCChannels.Email.ListImapAuthNotices)
      setNotices(rows ?? [])
    } catch {
      setNotices([])
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 60_000)
    return () => clearInterval(t)
  }, [load])

  const dismiss = async (accountId: number) => {
    try {
      await invokeRenderer(IPCChannels.Email.DismissImapAuthNotice, { accountId })
      setNotices((prev) => prev.filter((n) => n.accountId !== accountId))
    } catch {
      /* ignore */
    }
  }

  if (notices.length === 0) return null

  return (
    <div className="shrink-0 space-y-2 border-b bg-destructive/5 px-3 py-2">
      {notices.map((n) => (
        <Alert
          key={n.accountId}
          variant="destructive"
          className="relative border-destructive/40 bg-transparent py-2 pr-10"
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="text-sm">
            E-Mail-Konto {n.accountId}: Anmeldung fehlgeschlagen
          </AlertTitle>
          <AlertDescription className="text-xs">
            {n.message}
            <span className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() =>
                  void navigate({
                    to: "/email/settings",
                    search: emailSettingsSearch({ tab: "accounts" }),
                  })
                }
              >
                E-Mail-Einstellungen öffnen
              </Button>
            </span>
          </AlertDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-7 w-7"
            aria-label="Hinweis schließen"
            onClick={() => void dismiss(n.accountId)}
          >
            <X className="h-4 w-4" />
          </Button>
        </Alert>
      ))}
    </div>
  )
}
