"use client"

import { useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { invokeRenderer } from "@/services/transport"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatFrom, type EmailMessage } from "../types"
import { logError } from "../log"

/** Die neuesten Mails zur Auswahl (Plan 047). */
export const WORKFLOW_TEST_MESSAGE_LIMIT = 20

const MANUAL_ID = "__manual__"

type PickerMessage = Pick<EmailMessage, "id" | "subject" | "from_json" | "date_received">

/** Ausgang und Entwurf testen mit Entwürfen, alles andere mit dem Posteingang. */
export function workflowTestMessageView(trigger: string): "inbox" | "drafts" {
  return trigger === "outbound" || trigger === "draft_created" ? "drafts" : "inbox"
}

function formatDate(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })
}

export function workflowTestMessageLabel(message: PickerMessage): string {
  return [
    message.subject?.trim() || "(ohne Betreff)",
    formatFrom(message.from_json),
    formatDate(message.date_received),
  ].filter(Boolean).join(" · ")
}

type Props = {
  /** Auslöser des Workflows: bestimmt, ob Posteingang oder Entwürfe gezeigt werden. */
  trigger: string
  /** Gewählte Nachrichten-ID als Text ("" = keine). */
  value: string
  onChange: (messageId: string) => void
  disabled?: boolean
}

/**
 * Auswahl der Mail für „Testlauf“ und „Jetzt ausführen“: die 20 neuesten Mails
 * des passenden Ordners (Betreff · Absender · Datum) oder, als Rückfall, eine
 * eingetippte Nachrichten-ID.
 */
export function WorkflowTestMessagePicker({ trigger, value, onChange, disabled }: Props) {
  const view = workflowTestMessageView(trigger)
  const [messages, setMessages] = useState<PickerMessage[]>([])
  const [manual, setManual] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await invokeRenderer(IPCChannels.Email.ListMessagesByView, {
          accountId: "all",
          view,
          limit: WORKFLOW_TEST_MESSAGE_LIMIT,
        }) as PickerMessage[]
        if (!cancelled) setMessages(Array.isArray(rows) ? rows : [])
      } catch (e) {
        logError("workflow-test-message-picker: list", e)
        if (!cancelled) setMessages([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [view])

  const listed = messages.some((m) => String(m.id) === value)
  const showManual = manual || (value !== "" && !listed)
  const selectValue = showManual ? MANUAL_ID : value

  return (
    <div className="flex items-end gap-2">
      <div className="w-[260px] space-y-1">
        <Label
          htmlFor="workflow-test-message"
          className="text-[10px] uppercase tracking-wide text-muted-foreground"
        >
          Test-Mail
        </Label>
        <select
          id="workflow-test-message"
          className="h-8 w-full truncate rounded-md border border-input bg-background px-2 text-xs"
          value={selectValue}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value
            if (next === MANUAL_ID) {
              setManual(true)
              onChange("")
              return
            }
            setManual(false)
            onChange(next)
          }}
        >
          <option value="">
            {messages.length > 0
              ? "Mail auswählen …"
              : view === "drafts" ? "Keine Entwürfe gefunden" : "Keine Mails gefunden"}
          </option>
          {messages.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {workflowTestMessageLabel(m)}
            </option>
          ))}
          <option value={MANUAL_ID}>Andere (Nachrichten-ID) …</option>
        </select>
      </div>
      {showManual ? (
        <div className="w-[120px] space-y-1">
          <Label
            htmlFor="workflow-test-message-id"
            className="text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            Nachrichten-ID
          </Label>
          <Input
            id="workflow-test-message-id"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 font-mono text-xs"
            placeholder="aus Details-Panel"
            inputMode="numeric"
          />
        </div>
      ) : null}
    </div>
  )
}
