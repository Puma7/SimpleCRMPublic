"use client"

import { CalendarPlus, FileBox, Sparkles, Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { EmailMessage } from "./types"

type Props = {
  message: EmailMessage
  onDraftReply?: () => void
  onTagAdvertising?: () => void
}

export function MessageAiSuggestions({ message, onDraftReply, onTagAdvertising }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Vorschläge
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 gap-1.5 text-xs crm-glow-button"
          onClick={onDraftReply}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Antwort entwerfen
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled>
          <FileBox className="h-3.5 w-3.5" />
          Deal anlegen
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled>
          <CalendarPlus className="h-3.5 w-3.5" />
          Termin vorschlagen
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={onTagAdvertising}
        >
          <Tag className="h-3.5 w-3.5" />
          Als Werbung taggen
        </Button>
      </div>
      {message.ticket_code ? (
        <p className="font-label-mono text-[10px] text-muted-foreground">
          Kontext: {message.ticket_code}
        </p>
      ) : null}
    </div>
  )
}
