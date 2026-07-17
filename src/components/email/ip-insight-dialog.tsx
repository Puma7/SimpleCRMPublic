"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Network, RefreshCw } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { invokeRenderer } from "@/services/transport"
import { IPCChannels } from "@shared/ipc/channels"

type IpInsight = {
  ipAddress: string
  ipFamily: "ipv4" | "ipv6"
  scope: "public" | "private" | "loopback" | "reserved" | "unknown"
  countryCode: string | null
  continentCode: string | null
  asn: number | null
  networkName: string | null
  networkCidr: string | null
  databaseBuildAt: string | null
}

export function IpInsightDialog(props: {
  open: boolean
  onOpenChange(open: boolean): void
  messageId: number
  eventId: number | string
}) {
  const [insight, setInsight] = useState<IpInsight | null>(null)
  const [error, setError] = useState<IpInsightError | null>(null)
  const [loading, setLoading] = useState(false)
  const [retryGeneration, setRetryGeneration] = useState(0)
  const requestSequence = useRef(0)
  // IPC requests cannot be cancelled. Keep the request local to this dialog and reuse it
  // during StrictMode's effect replay while sequences safely ignore stale completions.
  const inFlightRequest = useRef<{ key: string; promise: Promise<IpInsight> } | null>(null)

  useEffect(() => {
    if (!props.open) {
      requestSequence.current += 1
      setInsight(null)
      setError(null)
      setLoading(false)
      return
    }
    const requestId = ++requestSequence.current
    const key = `${props.messageId}:${String(props.eventId)}:${retryGeneration}`
    setInsight(null)
    setError(null)
    setLoading(true)
    let request = inFlightRequest.current
    if (!request || request.key !== key) {
      const promise = Promise.resolve(invokeRenderer(IPCChannels.Email.GetMessageTrackingIpInsight, {
        messageId: props.messageId,
        eventId: props.eventId,
      })) as Promise<IpInsight>
      request = { key, promise }
      inFlightRequest.current = request
      void promise.then(
        () => { if (inFlightRequest.current?.promise === promise) inFlightRequest.current = null },
        () => { if (inFlightRequest.current?.promise === promise) inFlightRequest.current = null },
      )
    }
    void request.promise.then((result) => {
      if (requestId !== requestSequence.current) return
      setInsight(result)
    }).catch((caught: unknown) => {
      if (requestId !== requestSequence.current) return
      setError(ipInsightErrorMessage(caught))
    }).finally(() => {
      if (requestId === requestSequence.current) setLoading(false)
    })
    return () => {
      requestSequence.current += 1
    }
  }, [props.eventId, props.messageId, props.open, retryGeneration])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Network className="h-4 w-4" /> IP-Insight</DialogTitle>
          <DialogDescription>
            Ungefährer Standort der abrufenden Infrastruktur; kein Nachweis des Empfängerstandorts
          </DialogDescription>
        </DialogHeader>
        {loading ? <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…</div> : null}
        {error ? <div className="space-y-3">
          <p role="alert" aria-live="assertive" className="text-sm text-muted-foreground">{error.message}</p>
          {error.hint ? <p className="text-xs text-muted-foreground">{error.hint}</p> : null}
          <Button type="button" size="sm" variant="outline" onClick={() => setRetryGeneration((current) => current + 1)}>
            <RefreshCw className="mr-2 h-4 w-4" /> Erneut versuchen
          </Button>
        </div> : null}
        {insight ? <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <InsightRow label="IP-Adresse" value={insight.ipAddress} />
          <InsightRow label="Land" value={countryName(insight.countryCode)} />
          <InsightRow label="Kontinent" value={insight.continentCode} />
          <InsightRow label="ASN" value={insight.asn == null ? null : `AS${insight.asn}`} />
          <InsightRow label="Netzwerk" value={insight.networkName} />
          <InsightRow label="CIDR" value={insight.networkCidr} />
          <InsightRow label="IP-Familie" value={insight.ipFamily} />
          <InsightRow label="Geltungsbereich" value={scopeLabel(insight.scope)} />
          <InsightRow label="Datenbankstand" value={formatTimestamp(insight.databaseBuildAt)} />
        </dl> : null}
      </DialogContent>
    </Dialog>
  )
}

function InsightRow(props: { label: string; value: string | null }) {
  return <><dt className="text-muted-foreground">{props.label}</dt><dd className="break-all font-mono text-xs">{props.value ?? "—"}</dd></>
}

function countryName(countryCode: string | null): string | null {
  if (!countryCode) return null
  try {
    return new Intl.DisplayNames(["de"], { type: "region" }).of(countryCode) ?? countryCode
  } catch {
    return countryCode
  }
}

function scopeLabel(scope: IpInsight["scope"]): string {
  return ({ public: "Öffentlich", private: "Privat", loopback: "Loopback", reserved: "Reserviert", unknown: "Unbekannt" })[scope]
}

function formatTimestamp(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("de-DE") : null
}

type IpInsightError = { message: string; hint?: string }

// Duck-type on status/code rather than `instanceof` so the mapping survives
// chunk duplication, error re-wrapping, or a proxy that only forwards the
// JSON body — the class identity is not guaranteed across the IPC transport.
function ipInsightErrorMessage(error: unknown): IpInsightError {
  const status = (error as { status?: number } | null)?.status
  const code = (error as { code?: string } | null)?.code
  if (code === "ip_insight_raw_data_unavailable" || status === 410) {
    return { message: "Rohdaten für diesen IP-Insight sind nicht mehr verfügbar." }
  }
  if (
    code === "ip_insights_unavailable"
    || code === "email_tracking_unavailable"
    || status === 503
  ) {
    return {
      message: "Lokale IP-Insight-Datenbank ist nicht verfügbar.",
      hint: "Für IP-Insights müssen die GeoLite2-Datenbanken (Country + ASN) auf dem Server eingerichtet sein — siehe Serverdokumentation (GeoIP).",
    }
  }
  return { message: "IP-Insight konnte nicht geladen werden." }
}
