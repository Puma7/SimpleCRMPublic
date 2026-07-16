"use client"

import { useCallback, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { parseExternalMailLink } from "@shared/email-external-url"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { openExternalUrlInBrowser } from "./external-link-open"
import { hasLocalIpc, invokeIpc } from "./types"

export function useExternalLinkConfirm() {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)

  const requestOpen = useCallback((href: string) => {
    const parsed = parseExternalMailLink(href)
    if (!parsed.ok) {
      toast.error("Dieser Link kann aus Sicherheitsgründen nicht geöffnet werden.")
      return
    }
    setPendingUrl(parsed.url)
  }, [])

  const handleBodyLinkClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const anchor = (event.target as HTMLElement).closest("a[href]")
      if (!anchor) return
      const href = anchor.getAttribute("href")
      if (!href) return
      event.preventDefault()
      event.stopPropagation()
      requestOpen(href)
    },
    [requestOpen],
  )

  const confirmOpen = useCallback(async () => {
    if (!pendingUrl) return
    try {
      if (hasLocalIpc()) {
        await invokeIpc<{ success: boolean }>(IPCChannels.Update.OpenExternalUrl, {
          url: pendingUrl,
        })
      } else {
        openExternalUrlInBrowser(pendingUrl)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Link konnte nicht geöffnet werden.")
    } finally {
      setPendingUrl(null)
    }
  }, [pendingUrl])

  const dialog = (
    <AlertDialog
      open={pendingUrl != null}
      onOpenChange={(open) => {
        if (!open) setPendingUrl(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Link im Browser öffnen?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left">
              <p>
                Die folgende Adresse soll in Ihrem Standard-Browser geöffnet werden. Prüfen Sie die
                URL, bevor Sie fortfahren.
              </p>
              <p className="break-all rounded-md border bg-muted/50 px-2 py-2 font-mono text-xs text-foreground">
                {pendingUrl}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Abbrechen</AlertDialogCancel>
          <AlertDialogAction type="button" onClick={() => void confirmOpen()}>
            Im Browser öffnen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { handleBodyLinkClick, requestOpen, dialog }
}
