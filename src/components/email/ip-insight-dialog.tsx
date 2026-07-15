"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Network } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RendererTransportError, invokeRenderer } from "@/services/transport"
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
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const requestSequence = useRef(0)

  useEffect(() => {
    if (!props.open) return
    const requestId = ++requestSequence.current
    setInsight(null)
    setError(null)
    setLoading(true)
    void invokeRenderer(IPCChannels.Email.GetMessageTrackingIpInsight, {
      messageId: props.messageId,
      eventId: props.eventId,
    }).then((result) => {
      if (requestId !== requestSequence.current) return
      setInsight(result as IpInsight)
    }).catch((caught: unknown) => {
      if (requestId !== requestSequence.current) return
      setError(ipInsightErrorMessage(caught))
    }).finally(() => {
      if (requestId === requestSequence.current) setLoading(false)
    })
    return () => {
      requestSequence.current += 1
    }
  }, [props.eventId, props.messageId, props.open])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Network className="h-4 w-4" /> IP-Insight</DialogTitle>
          <DialogDescription>
            Ungefährer Standort der abrufenden Infrastruktur; kein Nachweis des Empfängerstandorts
          </DialogDescription>
        </DialogHeader>
        {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…</div> : null}
        {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
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

function ipInsightErrorMessage(error: unknown): string {
  if (error instanceof RendererTransportError) {
    if (error.status === 410) return "Rohdaten für diesen IP-Insight sind nicht mehr verfügbar."
    if (error.status === 503) return "Lokale IP-Insight-Datenbank ist nicht verfügbar."
  }
  return "IP-Insight konnte nicht geladen werden."
}
