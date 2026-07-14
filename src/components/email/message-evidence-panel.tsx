"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Bot,
  Check,
  CheckCheck,
  CircleDashed,
  Eye,
  Loader2,
  MailWarning,
  MousePointerClick,
  Reply,
  ShieldOff,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { useAuth } from "@/components/auth/auth-context"
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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { isServerClientMode } from "@/lib/runtime-mode"
import {
  invokeRenderer,
  isMailTrackingRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import { IPCChannels } from "@shared/ipc/channels"

type EvidenceConfidence = "none" | "low" | "medium" | "high" | "verified"
type EvidenceEvent = {
  id: number
  type: string
  source: string
  confidence: EvidenceConfidence
  automated: boolean
  occurredAt: string
  metadata: Record<string, unknown>
}
type EvidenceTimeline = {
  messageId: number
  tracked: boolean
  warning: string | null
  summary: {
    transport: string
    delivery: string
    engagement: string
    confidence: EvidenceConfidence
    openCount: number
    clickCount: number
    firstOpenedAt: string | null
    lastOpenedAt: string | null
    firstClickedAt: string | null
    lastClickedAt: string | null
    repliedAt: string | null
  }
  events: EvidenceEvent[]
  eventsTruncated: boolean
}

export function MessageEvidencePanel(props: { messageId: number; folderKind?: string | null }) {
  const { user, loading: authLoading } = useAuth()
  const hasUser = Boolean(user)
  const isAdmin = user?.role === "owner" || user?.role === "admin"
  const [timeline, setTimeline] = useState<EvidenceTimeline | null>(null)
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [includeSensitive, setIncludeSensitive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const requestSequence = useRef(0)

  const load = useCallback(async (sensitive = false) => {
    const requestId = ++requestSequence.current
    if (authLoading || !hasUser || !isServerClientMode() || props.folderKind !== "sent") {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await invokeRenderer(IPCChannels.Email.GetMessageTracking, {
        messageId: props.messageId,
        ...(sensitive ? { includeSensitive: true } : {}),
      }) as EvidenceTimeline
      if (requestId !== requestSequence.current) return
      setTimeline(result)
      setAvailable(true)
    } catch {
      if (requestId !== requestSequence.current) return
      setTimeline(null)
      setAvailable(false)
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [authLoading, hasUser, props.folderKind, props.messageId])

  useEffect(() => {
    setTimeline(null)
    setAvailable(true)
    setIncludeSensitive(false)
    void load(false)
    return () => {
      requestSequence.current += 1
    }
  }, [load])

  useEffect(() => {
    if (authLoading || !hasUser || !isServerClientMode() || props.folderKind !== "sent") return
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (isMailTrackingRefreshEvent(event, props.messageId)) {
          void load(includeSensitive && isAdmin)
        }
      },
    })
    return () => subscription.unsubscribe()
  }, [authLoading, hasUser, includeSensitive, isAdmin, load, props.folderKind, props.messageId])

  if (authLoading || !isServerClientMode() || props.folderKind !== "sent" || !available) return null

  return (
    <div className="space-y-2 border-b pb-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Versandstatus</p>
        <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setOpen(true)}>
          Verlauf
        </Button>
      </div>
      {loading && !timeline ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Wird geladen…
        </div>
      ) : timeline?.tracked ? (
        <div className="space-y-1 text-[11px]">
          <EvidenceStatusRow kind="transport" value={timeline.summary.transport} />
          <EvidenceStatusRow kind="delivery" value={timeline.summary.delivery} />
          <EvidenceStatusRow kind="engagement" value={timeline.summary.engagement} />
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Für diese Nachricht wurden keine Tracking-Signale angelegt.</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>E-Mail-Evidenz</DialogTitle>
            <DialogDescription>
              Zeitlich geordnete Versand-, Zustell- und Interaktionssignale. Signale sind keine Garantie für eine persönliche Kenntnisnahme.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {timeline?.warning ? (
              <div className="flex gap-2 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <MailWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{timeline.warning}</span>
              </div>
            ) : null}

            {timeline?.tracked ? (
              <>
                <div className="grid gap-3 border-b pb-4 sm:grid-cols-3">
                  <EvidenceStatusRow kind="transport" value={timeline.summary.transport} />
                  <EvidenceStatusRow kind="delivery" value={timeline.summary.delivery} />
                  <EvidenceStatusRow kind="engagement" value={timeline.summary.engagement} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <Metric label="Pixelabrufe" value={timeline.summary.openCount} />
                  <Metric label="Klicks" value={timeline.summary.clickCount} />
                  <Metric label="Erstes Öffnen" value={formatTimestamp(timeline.summary.firstOpenedAt)} />
                  <Metric label="Antwort" value={formatTimestamp(timeline.summary.repliedAt)} />
                </div>

                {isAdmin ? (
                  <div className="flex items-center justify-between gap-3 border-y py-3">
                    <div>
                      <p className="text-xs font-medium">Sensible Rohdaten</p>
                      <p className="text-[11px] text-muted-foreground">Entschlüsselte IP-Adresse und User-Agent, sofern erfasst und noch aufbewahrt.</p>
                    </div>
                    <Switch
                      checked={includeSensitive}
                      onCheckedChange={(checked) => {
                        setIncludeSensitive(checked)
                        void load(checked)
                      }}
                    />
                  </div>
                ) : null}

                <ol className="space-y-0">
                  {timeline.events.map((event, index) => (
                    <li key={event.id} className="grid grid-cols-[24px_1fr] gap-2">
                      <div className="flex flex-col items-center">
                        <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
                        {index < timeline.events.length - 1 ? <span className="min-h-8 w-px flex-1 bg-border" /> : null}
                      </div>
                      <div className="pb-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm font-medium">{eventLabel(event.type)}</p>
                          <time className="text-[11px] text-muted-foreground">{formatTimestamp(event.occurredAt)}</time>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {confidenceLabel(event.confidence)}{event.automated ? " · automatischer Abruf wahrscheinlich" : ""}
                        </p>
                        <EvidenceMetadata metadata={event.metadata} />
                      </div>
                    </li>
                  ))}
                </ol>
                {timeline.eventsTruncated ? (
                  <p className="border-t pt-3 text-xs text-muted-foreground">
                    Angezeigt werden die neuesten 1.000 Ereignisse; die Statuswerte berücksichtigen den vollständigen Aufbewahrungszeitraum.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Für diese Nachricht ist keine Evidenz vorhanden.
              </p>
            )}
          </div>

          {isAdmin && timeline?.tracked ? (
            <DialogFooter className="border-t pt-3 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await invokeRenderer(IPCChannels.Email.RevokeMessageTracking, props.messageId)
                    toast.success("Tracking-Token widerrufen.")
                    await load(includeSensitive)
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Widerruf fehlgeschlagen.")
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <ShieldOff className="mr-2 h-4 w-4" /> Token widerrufen
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Tracking-Daten löschen
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tracking-Daten endgültig löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Evidenz, Ereignisse und noch gültigen Tracking-Token dieser E-Mail werden dauerhaft entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (event) => {
                event.preventDefault()
                setBusy(true)
                try {
                  await invokeRenderer(IPCChannels.Email.DeleteMessageTracking, props.messageId)
                  toast.success("Tracking-Daten gelöscht.")
                  setDeleteConfirmOpen(false)
                  setOpen(false)
                  await load(false)
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Löschen fehlgeschlagen.")
                } finally {
                  setBusy(false)
                }
              }}
            >
              Endgültig löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EvidenceStatusRow(props: { kind: "transport" | "delivery" | "engagement"; value: string }) {
  const status = evidenceStatus(props.kind, props.value)
  const Icon = status.icon
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className={`h-4 w-4 shrink-0 ${status.color}`} />
      <div className="min-w-0">
        <p className="text-[10px] uppercase text-muted-foreground">{status.category}</p>
        <p className="truncate text-xs font-medium">{status.label}</p>
      </div>
    </div>
  )
}

function evidenceStatus(kind: "transport" | "delivery" | "engagement", value: string) {
  if (kind === "transport") {
    if (value === "bounced" || value === "failed") return { category: "Versand", label: value === "bounced" ? "Zurückgewiesen" : "Fehlgeschlagen", icon: MailWarning, color: "text-destructive" }
    if (value === "delayed") return { category: "Versand", label: "Verzögert", icon: CircleDashed, color: "text-amber-600" }
    if (value === "smtp_accepted") return { category: "Versand", label: "Vom Mailserver angenommen", icon: Check, color: "text-emerald-600" }
    if (value === "queued" || value === "sending") return { category: "Versand", label: value === "queued" ? "Eingeplant" : "Wird gesendet", icon: CircleDashed, color: "text-muted-foreground" }
    return { category: "Versand", label: "Unbekannt", icon: CircleDashed, color: "text-muted-foreground" }
  }
  if (kind === "delivery") {
    if (value === "dsn_delivered") return { category: "Zustellung", label: "Vom Ziel bestätigt", icon: CheckCheck, color: "text-emerald-600" }
    if (value === "external_system_reached") return { category: "Zustellung", label: "Externes System erreicht", icon: CheckCheck, color: "text-sky-600" }
    return { category: "Zustellung", label: "Nicht bestätigt", icon: CircleDashed, color: "text-muted-foreground" }
  }
  if (value === "human_reply") return { category: "Interaktion", label: "Antwort erhalten", icon: Reply, color: "text-emerald-600" }
  if (value === "link_interaction") return { category: "Interaktion", label: "Link angeklickt", icon: MousePointerClick, color: "text-sky-600" }
  if (value === "probable_open") return { category: "Interaktion", label: "Wahrscheinlich geöffnet", icon: Eye, color: "text-sky-600" }
  if (value === "automated_fetch") return { category: "Interaktion", label: "Automatischer Abruf", icon: Bot, color: "text-amber-600" }
  return { category: "Interaktion", label: "Kein Signal", icon: CircleDashed, color: "text-muted-foreground" }
}

function Metric(props: { label: string; value: string | number }) {
  return <div><p className="text-[10px] uppercase text-muted-foreground">{props.label}</p><p className="font-medium">{props.value}</p></div>
}

function EvidenceMetadata({ metadata }: { metadata: Record<string, unknown> }) {
  const rows = readableMetadata(metadata)
  if (rows.length === 0) return null
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
      {rows.map(([label, value]) => (
        <div key={`${label}:${value}`} className="contents">
          <dt className="text-muted-foreground">{label}</dt><dd className="break-all font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function readableMetadata(metadata: Record<string, unknown>): Array<[string, string]> {
  const labels: Record<string, string> = {
    ipFamily: "IP-Familie", operatingSystem: "Betriebssystem", client: "Client",
    device: "Gerät", status: "DSN-Status", action: "DSN-Aktion", disposition: "MDN",
    acceptedRecipientCount: "Angenommen", rejectedRecipientCount: "Abgelehnt", smtpCode: "SMTP-Code",
  }
  const rows: Array<[string, string]> = []
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "classificationReasons" && Array.isArray(value) && value.length > 0) {
      rows.push(["Klassifizierung", value.map(classificationReasonLabel).join(", ")])
    } else if (key === "raw" && value && typeof value === "object" && !Array.isArray(value)) {
      const raw = value as Record<string, unknown>
      if (typeof raw.ip === "string" && raw.ip) rows.push(["IP-Adresse", raw.ip])
      if (typeof raw.userAgent === "string" && raw.userAgent) rows.push(["User-Agent", raw.userAgent])
    } else if (labels[key] && (typeof value === "string" || typeof value === "number")) {
      rows.push([labels[key], String(value)])
    }
  }
  return rows.slice(0, 12)
}

function classificationReasonLabel(value: unknown): string {
  const labels: Record<string, string> = {
    known_security_or_mail_proxy: "Mail-Proxy/Scanner",
    prefetch_header: "Prefetch",
    mail_privacy_proxy_header: "Datenschutz-Proxy",
    immediate_mail_proxy_pattern: "sofortiger Proxy-Abruf",
  }
  const key = String(value)
  return labels[key] ?? key
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    queued: "Versand eingeplant", sending: "Versand gestartet", smtp_accepted: "SMTP-Annahme",
    smtp_failed: "SMTP-Fehler", delayed: "Zustellung verzögert", bounced: "Rückläufer",
    dsn_delivered: "Zustellung bestätigt", mdn_displayed: "Lesebestätigung erhalten",
    open_automated: "Automatischer Pixelabruf", open_probable: "Wahrscheinliches Öffnen",
    click_automated: "Automatischer Linkabruf", click: "Link angeklickt", replied: "Antwort erhalten",
    revoked: "Tracking widerrufen", expired: "Tracking abgelaufen",
  }
  return labels[type] ?? type
}

function confidenceLabel(value: EvidenceConfidence): string {
  return ({ none: "Keine Aussage", low: "Niedrige Aussagekraft", medium: "Mittlere Aussagekraft", high: "Hohe Aussagekraft", verified: "Bestätigtes Signal" })[value]
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString("de-DE") : "—"
}
