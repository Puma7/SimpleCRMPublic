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
  MapPin,
  MousePointerClick,
  Network,
  RefreshCw,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { isServerClientMode } from "@/lib/runtime-mode"
import {
  invokeRenderer,
  isMailTrackingRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import { IPCChannels } from "@shared/ipc/channels"
import { IpInsightDialog } from "./ip-insight-dialog"

type EvidenceConfidence = "none" | "low" | "medium" | "high" | "verified"
type EvidenceEvent = {
  id: number | string
  type: string
  source: string
  confidence: EvidenceConfidence
  automated: boolean
  occurredAt: string
  metadata: Record<string, unknown>
  classification?: {
    version: number
    actorClass: "system" | "probable_human" | "mail_proxy" | "privacy_proxy" | "security_scanner" | "automated_unknown" | "unknown"
    confidence: EvidenceConfidence
    reasons: string[]
  } | null
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
    pixelFetchCount?: number
    automatedPixelFetchCount?: number
    unknownPixelFetchCount?: number
    probableHumanPixelFetchCount?: number
    probableHumanOpenSessionCount?: number
    firstPixelFetchedAt?: string | null
    lastPixelFetchedAt?: string | null
    firstProbableHumanOpenAt?: string | null
    lastProbableHumanOpenAt?: string | null
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
  const [ipInsightEvent, setIpInsightEvent] = useState<EvidenceEvent | null>(null)
  const requestSequence = useRef(0)
  const actionSequence = useRef(0)
  const actionInFlight = useRef<{ id: number; messageId: number } | null>(null)
  const mounted = useRef(false)
  const activeMessageId = useRef(props.messageId)

  const resetEphemeralState = useCallback((preservePendingAction = false) => {
    if (!preservePendingAction || !actionInFlight.current) {
      actionSequence.current += 1
      actionInFlight.current = null
      setBusy(false)
    }
    setDeleteConfirmOpen(false)
    setIpInsightEvent(null)
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestSequence.current += 1
      actionSequence.current += 1
      actionInFlight.current = null
    }
  }, [])

  const load = useCallback(async (sensitive = false) => {
    const requestId = ++requestSequence.current
    const messageId = props.messageId
    const canCommit = () => mounted.current
      && activeMessageId.current === messageId
      && requestId === requestSequence.current
    if (authLoading || !hasUser || !isServerClientMode() || props.folderKind !== "sent") {
      if (canCommit()) setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await invokeRenderer(IPCChannels.Email.GetMessageTracking, {
        messageId,
        ...(sensitive ? { includeSensitive: true } : {}),
      }) as EvidenceTimeline
      if (!canCommit()) return
      setTimeline(result)
      setAvailable(true)
    } catch {
      if (!canCommit()) return
      setTimeline(null)
      setAvailable(false)
    } finally {
      if (canCommit()) setLoading(false)
    }
  }, [authLoading, hasUser, props.folderKind, props.messageId])

  useEffect(() => {
    activeMessageId.current = props.messageId
    requestSequence.current += 1
    resetEphemeralState()
    setTimeline(null)
    setAvailable(true)
    setIncludeSensitive(false)
    setOpen(false)
    void load(false)
    return () => {
      requestSequence.current += 1
    }
  }, [load, props.messageId, resetEphemeralState])

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

  const pixelFetchCount = timeline?.summary.pixelFetchCount ?? timeline?.summary.openCount ?? 0
  const automatedPixelFetchCount = timeline?.summary.automatedPixelFetchCount ?? 0
  const probableHumanPixelFetchCount = timeline?.summary.probableHumanPixelFetchCount ?? 0
  const probableHumanOpenSessionCount = timeline?.summary.probableHumanOpenSessionCount ?? 0
  const hasV2Metrics = hasV2EvidenceMetrics(timeline?.summary)
  const engagement = displayedEngagement(timeline?.summary, timeline?.events ?? [])
  const unknownPixelFetchCount = timeline?.summary.unknownPixelFetchCount
    ?? (!hasV2Metrics && engagement === "unknown_fetch" ? pixelFetchCount : 0)
  const sensitiveSwitchId = `message-evidence-sensitive-${props.messageId}`
  const sensitiveSwitchLabelId = `${sensitiveSwitchId}-label`

  const startAction = async (
    channel: string,
    successMessage: string,
    failureMessage: string,
    afterSuccess?: () => void,
  ) => {
    if (busy || actionInFlight.current) return
    const messageId = props.messageId
    const actionId = ++actionSequence.current
    actionInFlight.current = { id: actionId, messageId }
    const canCommit = () => mounted.current
      && activeMessageId.current === messageId
      && actionId === actionSequence.current
    setBusy(true)
    try {
      await invokeRenderer(channel, messageId)
      if (!canCommit()) return
      toast.success(successMessage)
      await load(includeSensitive)
      if (!canCommit()) return
      afterSuccess?.()
    } catch (error) {
      if (canCommit()) toast.error(error instanceof Error ? error.message : failureMessage)
    } finally {
      if (actionInFlight.current?.id === actionId) actionInFlight.current = null
      if (canCommit()) setBusy(false)
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
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
          <EvidenceStatusRow kind="engagement" value={engagement} />
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Für diese Nachricht wurden keine Tracking-Signale angelegt.</p>
      )}

      <Dialog open={open} onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetEphemeralState(true)
      }}>
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
                  <EvidenceStatusRow kind="engagement" value={engagement} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
                  <Metric label="Pixelabrufe" value={pixelFetchCount} />
                  <Metric label="Automatisierte Abrufe" value={automatedPixelFetchCount} />
                  <Metric label="Ursache unklar" value={unknownPixelFetchCount} />
                  <Metric label="Wahrscheinlich menschlich" value={probableHumanPixelFetchCount} />
                  <Metric label="Öffnungssitzungen" value={probableHumanOpenSessionCount} />
                  <Metric label="Klicks" value={timeline.summary.clickCount} />
                  <Metric label="Erster Pixelabruf" value={formatTimestamp(timeline.summary.firstPixelFetchedAt ?? timeline.summary.firstOpenedAt)} />
                  <Metric label="Antwort" value={formatTimestamp(timeline.summary.repliedAt)} />
                </div>
                {pixelFetchCount === 0 ? <p className="text-xs text-muted-foreground">Kein messbares Öffnungssignal. Bilder können blockiert oder aus einem Cache geladen worden sein.</p> : null}

                {isAdmin ? (
                  <div className="flex items-center justify-between gap-3 border-y py-3">
                    <div>
                      <p id={sensitiveSwitchLabelId} className="text-xs font-medium">Sensible Rohdaten</p>
                      <p className="text-[11px] text-muted-foreground">Entschlüsselte IP-Adresse und User-Agent, sofern erfasst und noch aufbewahrt.</p>
                    </div>
                    <Switch
                      id={sensitiveSwitchId}
                      aria-labelledby={sensitiveSwitchLabelId}
                      checked={includeSensitive}
                      onCheckedChange={(checked) => {
                        if (!checked) resetEphemeralState()
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
                          <p className="text-sm font-medium">{eventLabel(event)}</p>
                          <time className="text-[11px] text-muted-foreground">{formatTimestamp(event.occurredAt)}</time>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {eventContextLabel(event)}
                        </p>
                        <EvidenceMetadata event={event} infrastructure={isInfrastructureEvent(event)} />
                        {isAdmin && includeSensitive && rawIpAddress(event.metadata) ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="mt-1 h-7 gap-1 px-2 font-mono text-xs"
                                aria-label={`IP-Insight für ${rawIpAddress(event.metadata)}`}
                                onClick={() => setIpInsightEvent(event)}
                              ><Network className="h-3.5 w-3.5" /><MapPin className="h-3.5 w-3.5" />{rawIpAddress(event.metadata)}</Button>
                            </TooltipTrigger>
                            <TooltipContent>IP-Insight für diese Infrastruktur öffnen</TooltipContent>
                          </Tooltip>
                        ) : null}
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
                onClick={() => void startAction(IPCChannels.Email.ReclassifyMessageTracking, "Tracking-Evidenz neu bewertet.", "Neubewertung fehlgeschlagen.")}
              ><RefreshCw className="mr-2 h-4 w-4" /> Neu bewerten</Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void startAction(IPCChannels.Email.RevokeMessageTracking, "Tracking-Token widerrufen.", "Widerruf fehlgeschlagen.")}
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
                await startAction(
                  IPCChannels.Email.DeleteMessageTracking,
                  "Tracking-Daten gelöscht.",
                  "Löschen fehlgeschlagen.",
                  () => {
                    setDeleteConfirmOpen(false)
                    setOpen(false)
                    resetEphemeralState()
                  },
                )
              }}
            >
              Endgültig löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {ipInsightEvent ? <IpInsightDialog
        open
        onOpenChange={(open) => { if (!open) setIpInsightEvent(null) }}
        messageId={props.messageId}
        eventId={ipInsightEvent.id}
      /> : null}
    </div>
    </TooltipProvider>
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
  if (value === "probable_open") return { category: "Interaktion", label: "Menschlicher Abruf wahrscheinlich", icon: Eye, color: "text-sky-600" }
  if (value === "automated_fetch") return { category: "Interaktion", label: "Automatischer Abruf", icon: Bot, color: "text-amber-600" }
  if (value === "unknown_fetch") return { category: "Interaktion", label: "Pixelabruf, Ursache unklar", icon: CircleDashed, color: "text-muted-foreground" }
  return { category: "Interaktion", label: "Kein Signal", icon: CircleDashed, color: "text-muted-foreground" }
}

function Metric(props: { label: string; value: string | number }) {
  return <div><p className="text-[10px] uppercase text-muted-foreground">{props.label}</p><p className="font-medium">{props.value}</p></div>
}

function EvidenceMetadata({ event, infrastructure }: { event: EvidenceEvent; infrastructure: boolean }) {
  const rows = readableMetadata(event.metadata, infrastructure, event.classification?.reasons)
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

function readableMetadata(metadata: Record<string, unknown>, infrastructure: boolean, canonicalReasons?: string[]): Array<[string, string]> {
  const labels: Record<string, string> = {
    ipFamily: "IP-Familie", operatingSystem: "Betriebssystem", client: "Client",
    device: "Gerät", status: "DSN-Status", action: "DSN-Aktion", disposition: "MDN",
    acceptedRecipientCount: "Angenommen", rejectedRecipientCount: "Abgelehnt", smtpCode: "SMTP-Code",
  }
  const rows: Array<[string, string]> = []
  const reasons = canonicalReasons ?? (Array.isArray(metadata.classificationReasons) ? metadata.classificationReasons : [])
  if (reasons.length > 0) rows.push(["Klassifizierung", reasons.map(classificationReasonLabel).join(", ")])
  const infrastructureDetails = [metadata.client, metadata.operatingSystem, metadata.device]
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map(String)
  if (infrastructure && infrastructureDetails.length > 0) rows.push(["Abrufende Infrastruktur", infrastructureDetails.join(" · ")])
  for (const [key, value] of Object.entries(metadata)) {
    if (infrastructure && ["client", "operatingSystem", "device"].includes(key)) continue
    if (key === "classificationReasons") continue
    if (key === "raw" && value && typeof value === "object" && !Array.isArray(value)) {
      rows.push(["Rohdaten", "Für IP-Insight verfügbar"])
    } else if (key === "rawUnavailable" && value === true) {
      rows.push(["Rohdaten", "Nicht entschlüsselbar"])
    } else if (labels[key] && (typeof value === "string" || typeof value === "number")) {
      rows.push([labels[key], String(value)])
    }
  }
  return rows.slice(0, 12)
}

function classificationReasonLabel(value: unknown): string {
  const labels: Record<string, string> = {
    known_security_or_mail_proxy: "Mail-Proxy/Scanner",
    known_proxy_user_agent: "Bekannter Mail-Proxy-User-Agent",
    known_scanner_user_agent: "Bekannter Sicherheits-Scanner-User-Agent",
    known_proxy_header: "Bekannter Mail-Proxy-Header",
    prefetch_header: "Prefetch",
    known_provider_network: "Bekanntes Infrastruktur-Netzwerk",
    immediate_infrastructure_fetch: "Sofortiger Infrastrukturabruf",
    immediate_unattributed_fetch: "Sofortiger Abruf ohne Zuordnung",
    missing_client_identity: "Fehlende Client-Kennung",
    unattributed_infrastructure_network: "Nicht zugeordnetes Infrastruktur-Netzwerk",
    system_generated_evidence: "Systemseitig erzeugte Evidenz",
    raw_request_data_unavailable: "Rohdaten der Anfrage nicht verfügbar",
    classification_unavailable: "Klassifizierung nicht verfügbar",
    mail_privacy_proxy_header: "Datenschutz-Proxy",
    immediate_mail_proxy_pattern: "sofortiger Proxy-Abruf",
  }
  const key = String(value)
  if (labels[key]) return labels[key]
  const safeKey = key.replace(/[^a-z0-9_:-]/gi, "_").slice(0, 80) || "unbekannt"
  return `Unbekannter Klassifizierungsgrund (${safeKey})`
}

function eventLabel(event: EvidenceEvent): string {
  if (isInteractionFetch(event)) {
    const actor = interactionActor(event)
    const fetch = event.type.startsWith("click") ? "Linkabruf" : "Pixelabruf"
    if (actor === "probable_human") return `Wahrscheinlicher menschlicher ${fetch.toLowerCase()}`
    if (actor === "mail_proxy") return `${fetch} durch Mail-Proxy`
    if (actor === "privacy_proxy") return `${fetch} durch Datenschutz-Proxy`
    if (actor === "security_scanner") return `${fetch} durch Sicherheits-Scanner`
    if (actor === "automated_unknown") return `Automatischer ${fetch.toLowerCase()}`
    return `${fetch}, Ursache unklar`
  }
  const labels: Record<string, string> = {
    queued: "Versand eingeplant", sending: "Versand gestartet", smtp_accepted: "SMTP-Annahme",
    smtp_failed: "SMTP-Fehler", delayed: "Zustellung verzögert", bounced: "Rückläufer",
    dsn_delivered: "Zustellung bestätigt", mdn_displayed: "Lesebestätigung erhalten",
    open_automated: "Automatischer Pixelabruf", open_probable: "Wahrscheinliches Öffnen",
    click_automated: "Automatischer Linkabruf", click: "Link angeklickt", replied: "Antwort erhalten",
    revoked: "Tracking widerrufen", expired: "Tracking abgelaufen",
  }
  return labels[event.type] ?? event.type
}

function eventContextLabel(event: EvidenceEvent): string {
  const actor = isInteractionFetch(event) ? interactionActor(event) : event.classification?.actorClass
  if (actor === "probable_human") return "Menschlicher Abruf wahrscheinlich; keine Gewissheit über eine persönliche Kenntnisnahme"
  if (actor === "mail_proxy") return "Abrufende Infrastruktur: Mail-Proxy"
  if (actor === "privacy_proxy") return "Abrufende Infrastruktur: Datenschutz-Proxy"
  if (actor === "security_scanner") return "Abrufende Infrastruktur: Sicherheits-Scanner"
  if (actor === "automated_unknown") return "Abrufende Infrastruktur: automatischer Abruf"
  if (actor === "unknown") return event.type.startsWith("click") ? "Linkabruf, Ursache unklar" : "Pixelabruf, Ursache unklar"
  return confidenceLabel(event.confidence)
}

function isInfrastructureEvent(event: EvidenceEvent): boolean {
  return isInteractionFetch(event) && interactionActor(event) !== "probable_human"
}

function rawIpAddress(metadata: Record<string, unknown>): string | null {
  const raw = metadata.raw
  const ip = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).ip : null
  return typeof ip === "string" && ip.length > 0 ? ip : null
}

function isInteractionFetch(event: EvidenceEvent): boolean {
  return event.type.startsWith("open_") || event.type === "click" || event.type === "click_automated"
}

function interactionActor(event: EvidenceEvent): NonNullable<EvidenceEvent["classification"]>["actorClass"] {
  const actor = event.classification?.actorClass
  return actor && actor !== "system" ? actor : "unknown"
}

function hasV2EvidenceMetrics(summary: EvidenceTimeline["summary"] | undefined): boolean {
  if (!summary) return false
  return [
    summary.pixelFetchCount,
    summary.automatedPixelFetchCount,
    summary.unknownPixelFetchCount,
    summary.probableHumanPixelFetchCount,
    summary.probableHumanOpenSessionCount,
  ].some((value) => value !== undefined)
}

function displayedEngagement(summary: EvidenceTimeline["summary"] | undefined, events: EvidenceEvent[]): string {
  if (!summary) return "none"
  if (summary.engagement === "human_reply" || summary.engagement === "link_interaction") return summary.engagement
  if (summary.engagement === "probable_open" && events.some((event) => event.type === "mdn_displayed")) return "probable_open"
  const hasProbableHumanEvidence = (summary.probableHumanPixelFetchCount ?? 0) > 0
    || (summary.probableHumanOpenSessionCount ?? 0) > 0
    || events.some((event) => event.type.startsWith("open_") && event.classification?.actorClass === "probable_human")
  if (!hasV2EvidenceMetrics(summary)) {
    return summary.engagement === "probable_open" && !hasProbableHumanEvidence
      ? "unknown_fetch"
      : summary.engagement
  }
  if (hasProbableHumanEvidence) return "probable_open"
  if ((summary.automatedPixelFetchCount ?? 0) > 0) return "automated_fetch"
  if ((summary.unknownPixelFetchCount ?? 0) > 0 || (summary.pixelFetchCount ?? 0) > 0) return "unknown_fetch"
  return summary.engagement === "probable_open" ? "none" : summary.engagement
}

function confidenceLabel(value: EvidenceConfidence): string {
  return ({ none: "Keine Aussage", low: "Niedrige Aussagekraft", medium: "Mittlere Aussagekraft", high: "Hohe Aussagekraft", verified: "Bestätigtes Signal" })[value]
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString("de-DE") : "—"
}
