"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import { plainTextToReplyHtml } from "@shared/compose-body"
import { Loader2, MessageSquarePlus, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { emailSettingsSearch } from "@/lib/email-settings-search"
import { invokeRenderer } from "@/services/transport"
import type { EmailMessage } from "./types"
import { MessageMoreActionsMenu } from "./message-more-actions-menu"

type SuggestionState = {
  status: "none" | "pending" | "ready" | "failed" | "skipped"
  text: string | null
  error: string | null
}

type Props = {
  message: EmailMessage
  messageTags?: string[]
  onDraftReply?: (opts?: { initialReplyHtml?: string }) => void
  onTagsChanged?: () => void | Promise<void>
}

const POLL_MS = 2500

function isMissingApiKeySkip(error: string | null): boolean {
  if (!error) return false
  const lower = error.toLowerCase()
  return lower.includes("api-schlüssel") || lower.includes("api key") || lower.includes("apikey")
}

export function MessageAiSuggestions({
  message,
  messageTags = [],
  onDraftReply,
  onTagsChanged,
}: Props) {
  const navigate = useNavigate()
  const activeMessageIdRef = useRef(message.id)
  const [suggestion, setSuggestion] = useState<SuggestionState>({
    status: "none",
    text: null,
    error: null,
  })
  const [generating, setGenerating] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [userContext, setUserContext] = useState("")
  const [contextGenerating, setContextGenerating] = useState(false)

  useEffect(() => {
    activeMessageIdRef.current = message.id
    setSuggestion({ status: "none", text: null, error: null })
    setGenerating(false)
    setContextOpen(false)
    setUserContext("")
  }, [message.id])

  const loadSuggestion = useCallback(async () => {
    const requestId = message.id
    try {
      const row = await invokeRenderer(
        IPCChannels.Email.GetReplySuggestion,
        requestId,
      ) as SuggestionState & { updatedAt: string | null }
      if (activeMessageIdRef.current !== requestId) return
      setSuggestion({
        status: row.status,
        text: row.text,
        error: row.error,
      })
    } catch {
      if (activeMessageIdRef.current !== requestId) return
      setSuggestion({ status: "none", text: null, error: null })
    }
  }, [message.id])

  useEffect(() => {
    void invokeRenderer(IPCChannels.Email.EnsureReplySuggestion, {
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

  const generateDraft = async (opts?: { userContext?: string }) => {
    const requestId = message.id
    const r = await invokeRenderer(IPCChannels.Email.GenerateReplyDraft, {
      messageId: requestId,
      customerId: message.customer_id ?? null,
      ...(opts?.userContext?.trim() ? { userContext: opts.userContext.trim() } : {}),
      ...(opts?.userContext?.trim() ? { persistSuggestion: false } : {}),
    }) as {
      success: boolean
      text?: string
      error?: string
    }
    if (activeMessageIdRef.current !== requestId) return
    if (r.success && r.text?.trim()) {
      openReplyWithText(r.text)
    } else {
      toast.error(r.error ?? "KI-Antwort konnte nicht erzeugt werden.")
      onDraftReply?.()
    }
  }

  const handleDraftReply = () => {
    if (suggestion.status === "ready" && suggestion.text?.trim()) {
      openReplyWithText(suggestion.text)
      return
    }
    const requestId = message.id
    setGenerating(true)
    void (async () => {
      try {
        await generateDraft()
      } catch (e) {
        if (activeMessageIdRef.current !== requestId) return
        toast.error(e instanceof Error ? e.message : "KI-Fehler")
        onDraftReply?.()
      } finally {
        if (activeMessageIdRef.current === requestId) setGenerating(false)
      }
    })()
  }

  const handleDraftWithContext = () => {
    const requestId = message.id
    setContextGenerating(true)
    void (async () => {
      try {
        await generateDraft({ userContext })
        setContextOpen(false)
      } catch (e) {
        if (activeMessageIdRef.current !== requestId) return
        toast.error(e instanceof Error ? e.message : "KI-Fehler")
        onDraftReply?.()
      } finally {
        if (activeMessageIdRef.current === requestId) setContextGenerating(false)
      }
    })()
  }

  const preview =
    suggestion.text?.trim().replace(/\s+/g, " ").slice(0, 120) ?? null

  const showApiKeyHint =
    suggestion.status === "skipped" && isMissingApiKeySkip(suggestion.error)

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Vorschläge
      </p>
      {showApiKeyHint ? (
        <Alert className="py-2">
          <AlertDescription className="text-xs">
            KI-Antwortvorschläge sind aktiviert, aber es ist kein API-Schlüssel hinterlegt.{" "}
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-xs"
              onClick={() =>
                void navigate({
                  to: "/email/settings",
                  search: emailSettingsSearch({ tab: "ai" }),
                })
              }
            >
              E-Mail-Einstellungen öffnen
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 shrink-0 gap-1.5 px-2.5 text-xs crm-glow-button"
          disabled={generating || contextGenerating}
          onClick={handleDraftReply}
        >
          {generating || suggestion.status === "pending" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Antwort entwerfen
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
          disabled={generating || contextGenerating}
          onClick={() => setContextOpen(true)}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Mit Kontext…
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
        <MessageMoreActionsMenu
          message={message}
          messageTags={messageTags}
          onTagsChanged={onTagsChanged}
        />
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

      <Dialog open={contextOpen} onOpenChange={setContextOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Antwort entwerfen mit Kontext</DialogTitle>
            <DialogDescription>
              Beschreiben Sie, was die KI berücksichtigen soll (z. B. ob eine Stornierung noch
              möglich ist). Die Originalnachricht wird automatisch mitgegeben.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={userContext}
            onChange={(e) => setUserContext(e.target.value)}
            placeholder="Zusätzlicher Kontext für die KI…"
            className="min-h-[120px] text-sm"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={contextGenerating}
              onClick={() => setContextOpen(false)}
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              disabled={contextGenerating || !userContext.trim()}
              onClick={() => void handleDraftWithContext()}
            >
              {contextGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Entwurf erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
