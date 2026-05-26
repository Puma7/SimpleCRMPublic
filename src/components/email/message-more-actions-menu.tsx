"use client"

import { useState } from "react"
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
import { hasElectron, invokeIpc, type EmailMessage } from "./types"

const ADVERTISING_TAG = "Werbung"

function defaultDealName(message: EmailMessage): string {
  const subject = message.subject?.trim()
  if (subject) return subject.slice(0, 120)
  const mail = correspondentEmailForMessage(message)
  return mail ? `Anfrage ${mail}` : "Neuer Deal aus E-Mail"
}

function defaultTaskTitle(message: EmailMessage): string {
  const subject = message.subject?.trim()
  if (subject) return `Termin: ${subject.slice(0, 80)}`
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
  const [dealOpen, setDealOpen] = useState(false)
  const [dealName, setDealName] = useState(() => defaultDealName(message))
  const [savingDeal, setSavingDeal] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const hasCustomer = message.customer_id != null && message.customer_id > 0
  const hasAdvertisingTag = messageTags.some(
    (t) => t.toLowerCase() === ADVERTISING_TAG.toLowerCase(),
  )

  const tagAdvertising = async () => {
    if (!hasElectron() || hasAdvertisingTag) return
    setBusy("tag")
    try {
      await invokeIpc(IPCChannels.Email.AddMessageTag, {
        messageId: message.id,
        tag: ADVERTISING_TAG,
      })
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
    setDealName(defaultDealName(message))
    setDealOpen(true)
  }

  const createDeal = async () => {
    if (!hasElectron() || !hasCustomer || !dealName.trim()) return
    setSavingDeal(true)
    try {
      const r = await invokeIpc<{ success: boolean; id?: number; error?: string }>(
        IPCChannels.Deals.Create,
        {
          name: dealName.trim(),
          customer_id: message.customer_id,
          value: 0,
          value_calculation_method: "static",
          stage: "Interessent",
        },
      )
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
    if (!hasElectron()) return
    setBusy("termin")
    try {
      if (hasCustomer) {
        const r = await invokeIpc<{ success: boolean; id?: number; error?: string }>(
          IPCChannels.Tasks.Create,
          {
            customer_id: message.customer_id,
            title: defaultTaskTitle(message),
            description: `Aus E-Mail #${message.id}${message.subject ? `: ${message.subject}` : ""}`,
            due_date: dueDateInDays(3),
            priority: "Medium",
            completed: false,
          },
        )
        if (r.success) {
          toast.success("Aufgabe für Termin angelegt (Fällig in 3 Tagen).")
          void navigate({ to: "/tasks" })
        } else {
          toast.error(r.error ?? "Aufgabe konnte nicht angelegt werden.")
        }
        return
      }

      const date =
        message.date_received?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
      toast.info("Kunde verknüpfen für CRM-Aufgabe — Kalender wird geöffnet.")
      void navigate({ to: "/calendar", search: { date } })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Termin-Aktion fehlgeschlagen.")
    } finally {
      setBusy(null)
    }
  }

  if (!hasElectron()) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs"
            disabled={busy != null}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
            Weitere
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            disabled={hasAdvertisingTag || busy != null}
            onClick={() => void tagAdvertising()}
          >
            <Tag className="mr-2 h-4 w-4" />
            {hasAdvertisingTag ? "Bereits als Werbung getaggt" : "Als Werbung taggen"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={busy != null} onClick={openDealDialog}>
            <FileBox className="mr-2 h-4 w-4" />
            Deal anlegen
            {!hasCustomer ? (
              <span className="ml-auto text-[10px] text-muted-foreground">Kunde nötig</span>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy != null} onClick={() => void suggestAppointment()}>
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
