"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { plainTextToReplyHtml } from "@shared/compose-body"
import { CalendarPlus, FileBox, Loader2, Sparkles, Tag } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { hasElectron, invokeIpc, type EmailMessage } from "./types"

type SuggestionState = {
  status: "none" | "pending" | "ready" | "failed" | "skipped"
  text: string | null
  error: string | null
}

type Props = {
  message: EmailMessage
  onDraftReply?: (opts?: { initialReplyHtml?: string }) => void
  onTagAdvertising?: () => void
}

const POLL_MS = 2500

export function MessageAiSuggestions({ message, onDraftReply, onTagAdvertising }: Props) {
  const [suggestion, setSuggestion] = useState<SuggestionState>({
    status: "none",
    text: null,
    error: null,
  })
  const [generating, setGenerating] = useState(false)

  const loadSuggestion = useCallback(async () => {
    if (!hasElectron()) return
    try {
      const row = await invokeIpc<SuggestionState & { updatedAt: string | null }>(
        IPCChannels.Email.GetReplySuggestion,
        message.id,
      )
      setSuggestion({
        status: row.status,
        text: row.text,
        error: row.error,
      })
    } catch {
      setSuggestion({ status: "none", text: null, error: null })
    }
  }, [message.id])

  useEffect(() => {
    if (!hasElectron()) return
    void invokeIpc(IPCChannels.Email.EnsureReplySuggestion, {
      messageId: message.id,
      trigger: "open",
    })
    void loadSuggestion()
  }, [message.id, loadSuggestion])

  useEffect(() => {
    if (suggestion.status !== "pending") return
    const t = setInterval(() => {
      void loadSuggestion()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [suggestion.status, loadSuggestion])

  const openReplyWithText = (plain: string) => {
    const initialReplyHtml = plainTextToReplyHtml(plain)
    onDraftReply?.({ initialReplyHtml })
  }

  const handleDraftReply = () => {
    if (suggestion.status === "ready" && suggestion.text?.trim()) {
      openReplyWithText(suggestion.text)
      return
    }
    if (!hasElectron()) {
      onDraftReply?.()
      return
    }
    setGenerating(true)
    void (async () => {
      try {
        const r = await invokeIpc<{
          success: boolean
          text?: string
          error?: string
        }>(IPCChannels.Email.GenerateReplyDraft, {
          messageId: message.id,
          customerId: message.customer_id ?? null,
        })
        if (r.success && r.text?.trim()) {
          openReplyWithText(r.text)
          await loadSuggestion()
        } else {
          toast.error(r.error ?? "KI-Antwort konnte nicht erzeugt werden.")
          onDraftReply?.()
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "KI-Fehler")
        onDraftReply?.()
      } finally {
        setGenerating(false)
      }
    })()
  }

  const preview =
    suggestion.text?.trim().replace(/\s+/g, " ").slice(0, 120) ?? null

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Vorschläge
      </p>
      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 shrink-0 gap-1.5 px-2.5 text-xs crm-glow-button"
          disabled={generating}
          onClick={handleDraftReply}
        >
          {generating || suggestion.status === "pending" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Antwort entwerfen
        </Button>
        {suggestion.status === "ready" && preview ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 max-w-[min(100%,240px)] shrink-0 truncate px-2.5 text-xs"
            title={suggestion.text ?? undefined}
            onClick={() => openReplyWithText(suggestion.text!)}
          >
            Vorschlag übernehmen
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
          disabled
          title="Demnächst verfügbar"
        >
          <FileBox className="h-3.5 w-3.5" />
          Deal anlegen
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
          disabled
          title="Demnächst verfügbar"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          Termin vorschlagen
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
          onClick={onTagAdvertising}
        >
          <Tag className="h-3.5 w-3.5" />
          Als Werbung taggen
        </Button>
      </div>
      {suggestion.status === "pending" ? (
        <p className="text-[10px] text-muted-foreground">KI erstellt Antwortvorschlag…</p>
      ) : null}
      {suggestion.status === "ready" && preview ? (
        <p className="text-[11px] leading-snug text-muted-foreground" title={suggestion.text ?? undefined}>
          <span className="font-medium text-foreground/80">Vorschlag: </span>
          {preview}
          {(suggestion.text?.length ?? 0) > 120 ? "…" : ""}
        </p>
      ) : null}
      {suggestion.status === "failed" && suggestion.error ? (
        <p className="text-[10px] text-destructive">{suggestion.error}</p>
      ) : null}
      {message.ticket_code ? (
        <p className="font-label-mono text-[10px] text-muted-foreground">
          Kontext: {message.ticket_code}
        </p>
      ) : null}
    </div>
  )
}
