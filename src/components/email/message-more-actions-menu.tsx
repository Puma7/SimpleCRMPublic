"use client"

import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import { correspondentEmailForMessage } from "@shared/email-correspondent"
import { toast } from "sonner"
import { CalendarPlus, ChevronDown, FileBox, MoreHorizontal, Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { invokeRenderer } from "@/services/transport"
import { type EmailMessage } from "./types"

const ADVERTISING_TAG = "Werbung"

function safeMailText(value: string | null | undefined, maxLen: number): string {
  return (value ?? "").replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, maxLen)
}

function defaultDealName(message: EmailMessage): string {
  const subject = safeMailText(message.subject, 120)
  if (subject) return subject
  const mail = correspondentEmailForMessage(message)
  return mail ? `Anfrage ${mail}` : "Neuer Deal aus E-Mail"
}

function defaultTaskTitle(message: EmailMessage): string {
  const subject = safeMailText(message.subject, 80)
  if (subject) return `Termin: ${subject}`
  const mail = correspondentEmailForMessage(message)
  return mail ? `Termin mit ${mail}` : "Termin vereinbaren"
}

function dueDateInDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

type Props = {
  message: EmailMessage
  messageTags: string[]
  onTagsChanged?: () => void | Promise<void>
}

export function MessageMoreActionsMenu({ message, messageTags, onTagsChanged }: Props) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dealOpen, setDealOpen] = useState(false)
  const [dealName, setDealName] = useState(() => defaultDealName(message))
  const [dealContext, setDealContext] = useState<{ messageId: number; customerId: number } | null>(
    null,
  )
  const [savingDeal, setSavingDeal] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    setMenuOpen(false)
    setDealOpen(false)
    setDealContext(null)
    setDealName(defaultDealName(message))
    setBusy(null)
    setSavingDeal(false)
  }, [message.id])

  const actionBusy = busy != null || savingDeal
  const hasCustomer = message.customer_id != null && message.customer_id > 0
  const hasAdvertisingTag = messageTags.some(
    (t) => t.toLowerCase() === ADVERTISING_TAG.toLowerCase(),
  )

  const tagAdvertising = async () => {
    if (hasAdvertisingTag) return
    const messageId = message.id
    setMenuOpen(false)
    setBusy("tag")
    try {
      await invokeRenderer(IPCChannels.Email.AddMessageTag, {
        messageId,
        tag: ADVERTISING_TAG,
      })
      if (messageId !== message.id) return
      toast.success("Als Werbung getaggt.")
      await onTagsChanged?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Tag konnte nicht gesetzt werden.")
    } finally {
      setBusy(null)
    }
  }

  const openDealDialog = () => {
    if (!hasCustomer) {
      toast.info("Bitte zuerst einen Kunden im Detailpanel rechts verknüpfen.")
      return
    }
    setMenuOpen(false)
    setDealContext({ messageId: message.id, customerId: message.customer_id! })
    setDealName(defaultDealName(message))
    setDealOpen(true)
  }

  const createDeal = async () => {
    if (!dealName.trim()) return
    if (!dealContext || dealContext.messageId !== message.id) {
      toast.error("Mail gewechselt — bitte „Deal anlegen“ erneut öffnen.")
      return
    }
    setSavingDeal(true)
    try {
      const r = await invokeRenderer(
        IPCChannels.Deals.Create,
        {
          name: dealName.trim(),
          customer_id: dealContext.customerId,
          value: 0,
          value_calculation_method: "static",
          stage: "Interessent",
        },
      ) as { success: boolean; id?: number; error?: string }
      if (dealContext.messageId !== message.id) return
      if (r.success && r.id) {
        toast.success("Deal angelegt.")
        setDealOpen(false)
        void navigate({ to: "/deals/$dealId", params: { dealId: String(r.id) } })
      } else {
        toast.error(r.error ?? "Deal konnte nicht angelegt werden.")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler beim Anlegen des Deals.")
    } finally {
      setSavingDeal(false)
    }
  }

  const suggestAppointment = async () => {
    const appointmentContext = {
      messageId: message.id,
      customerId:
        message.customer_id != null && message.customer_id > 0 ? message.customer_id : null,
      taskTitle: defaultTaskTitle(message),
      subjectLine: safeMailText(message.subject, 200),
    }
    setMenuOpen(false)
    setBusy("termin")
    try {
      if (appointmentContext.customerId != null) {
        const r = await invokeRenderer(
          IPCChannels.Tasks.Create,
          {
            customer_id: appointmentContext.customerId,
            title: appointmentContext.taskTitle,
            description: `Aus E-Mail #${appointmentContext.messageId}${
              appointmentContext.subjectLine ? `: ${appointmentContext.subjectLine}` : ""
            }`,
            due_date: dueDateInDays(3),
            priority: "Medium",
            completed: false,
          },
        ) as { success: boolean; id?: number; error?: string }
        if (appointmentContext.messageId !== message.id) return
        if (r.success) {
          toast.success("Aufgabe für Termin angelegt (Fällig in 3 Tagen).")
          void navigate({ to: "/tasks" })
        } else {
          toast.error(r.error ?? "Aufgabe konnte nicht angelegt werden.")
        }
        return
      }

      const start = new Date()
      start.setDate(start.getDate() + 3)
      start.setHours(14, 0, 0, 0)
      const end = new Date(start)
      end.setHours(15, 0, 0, 0)
      const cal = await invokeRenderer(IPCChannels.Calendar.AddCalendarEvent, {
        title: appointmentContext.taskTitle,
        description: `Aus E-Mail #${appointmentContext.messageId} (ohne Kundenverknüpfung)`,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        all_day: false,
        color_code: "#3174ad",
        event_type: "email",
        recurrence_rule: null,
      }) as {
        success?: boolean
        id?: number
        lastInsertRowid?: number | bigint
        error?: string
      }
      if (appointmentContext.messageId !== message.id) return
      if (cal.success === false) {
        toast.error(cal.error ?? "Kalendertermin konnte nicht angelegt werden.")
        return
      }
      const eventId = Number(cal.lastInsertRowid ?? cal.id ?? 0)
      if (eventId > 0) {
        toast.success("Kalendertermin angelegt (in 3 Tagen, 14–15 Uhr).")
        void navigate({ to: "/calendar", search: { date: start.toISOString().slice(0, 10) } })
      } else {
        toast.error(cal.error ?? "Kalendertermin konnte nicht angelegt werden.")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Termin-Aktion fehlgeschlagen.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs"
            disabled={actionBusy}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
            Weitere
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            disabled={hasAdvertisingTag || actionBusy}
            onClick={() => void tagAdvertising()}
          >
            <Tag className="mr-2 h-4 w-4" />
            {hasAdvertisingTag ? "Bereits als Werbung getaggt" : "Als Werbung taggen"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={actionBusy} onClick={openDealDialog}>
            <FileBox className="mr-2 h-4 w-4" />
            Deal anlegen
            {!hasCustomer ? (
              <span className="ml-auto text-[10px] text-muted-foreground">Kunde nötig</span>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={actionBusy} onClick={() => void suggestAppointment()}>
            <CalendarPlus className="mr-2 h-4 w-4" />
            Termin vorschlagen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dealOpen} onOpenChange={setDealOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deal anlegen</DialogTitle>
            <DialogDescription>
              Neuer Deal für den verknüpften Kunden (Phase: Interessent).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="deal-name-from-mail">Bezeichnung</Label>
            <Input
              id="deal-name-from-mail"
              value={dealName}
              onChange={(e) => setDealName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createDeal()
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDealOpen(false)}>
              Abbrechen
            </Button>
            <Button
              type="button"
              disabled={savingDeal || !dealName.trim()}
              onClick={() => void createDeal()}
            >
              {savingDeal ? "Speichern…" : "Deal anlegen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
