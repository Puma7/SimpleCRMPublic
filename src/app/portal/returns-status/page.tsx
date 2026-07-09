"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import { invokeRenderer } from "@/services/transport"

type PortalItem = {
  sku: string | null
  productName: string | null
  quantity: number
  condition: string | null
  reasonCode: string | null
  reasonLabel: string | null
}

type PortalRecord = {
  returnNumber: string
  status: string
  outcome: string | null
  jtlOrderNumber: string | null
  createdAt: string
  updatedAt: string
  items: PortalItem[]
}

// Mirrors the German labels used in the internal page; kept in sync manually
// because the public bundle should not import the editor-only constants.
const STATUS_LABEL: Record<string, string> = {
  pending: "in Bearbeitung",
  approved: "genehmigt",
  received: "eingegangen",
  refunded: "erstattet",
  exchanged: "umgetauscht",
  credited: "gutgeschrieben",
  rejected: "abgelehnt",
  cancelled: "storniert",
}

const OUTCOME_LABEL: Record<string, string> = {
  refund: "Erstattung",
  exchange: "Umtausch",
  credit: "Gutschrift",
  keep: "behalten",
}

export default function PortalReturnsStatusPage() {
  const { token, returnNumber } = useParams({ from: "/portal/$token/returns/$returnNumber" })
  const [record, setRecord] = useState<PortalRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = (await invokeRenderer(
        IPCChannels.Returns.PortalLookup,
        { token, returnNumber },
      )) as PortalRecord
      setRecord(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.includes("not_found") ? "Retoure nicht gefunden." : msg)
    } finally {
      setLoading(false)
    }
  }, [token, returnNumber])

  useEffect(() => { void load() }, [load])

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="font-mono">{returnNumber}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> lädt...</div>
          ) : error ? (
            <p className="text-sm text-destructive" data-testid="portal-status-error">{error}</p>
          ) : !record ? (
            <p className="text-sm text-muted-foreground">Keine Daten verfügbar.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2" data-testid="portal-status-badges">
                <Badge>{STATUS_LABEL[record.status] ?? record.status}</Badge>
                {record.outcome ? (
                  <Badge variant="outline">{OUTCOME_LABEL[record.outcome] ?? record.outcome}</Badge>
                ) : null}
                {record.jtlOrderNumber ? (
                  <span className="text-sm text-muted-foreground">
                    Bestellung {record.jtlOrderNumber}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Angelegt {new Date(record.createdAt).toLocaleString()} ·
                {" "}zuletzt aktualisiert {new Date(record.updatedAt).toLocaleString()}
              </p>
              {record.items.length === 0 ? null : (
                <div>
                  <h3 className="mb-2 text-sm font-medium">Positionen</h3>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="px-2 py-1 text-left">SKU</th>
                        <th className="px-2 py-1 text-left">Artikel</th>
                        <th className="px-2 py-1 text-right">Menge</th>
                        <th className="px-2 py-1 text-left">Grund</th>
                      </tr>
                    </thead>
                    <tbody>
                      {record.items.map((it, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="px-2 py-1 font-mono text-xs">{it.sku ?? "—"}</td>
                          <td className="px-2 py-1">{it.productName ?? "—"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{it.quantity}</td>
                          <td className="px-2 py-1">{it.reasonLabel ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
