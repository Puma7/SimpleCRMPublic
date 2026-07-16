"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"
import { IPCChannels } from "@shared/ipc/channels"
import type { DmarcStatsSnapshot } from "@shared/dmarc-stats"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { isServerClientMode } from "@/lib/runtime-mode"
import { invokeRenderer } from "@/services/transport"
import { toast } from "sonner"
import { Loader2, ShieldAlert, ShieldCheck, ShieldX, Inbox } from "lucide-react"

// pass = "good", fail = "critical" from the validated status palette. Red↔green
// is CVD-ambiguous (deutan ΔE ≈ 4), so identity is NEVER carried by colour
// alone here: every chart ships a legend + tooltip series names, the bars use a
// fixed pass-then-fail stacking order, and the raw numbers appear in the tables
// below. Status hues are fixed (not themed) and clear 3:1 on both surfaces.
const PASS_COLOR = "#0ca30c"
const FAIL_COLOR = "#d03b3b"

const WINDOW_OPTIONS = [
  { value: 7, label: "7 Tage" },
  { value: 30, label: "30 Tage" },
  { value: 90, label: "90 Tage" },
] as const

const timeSeriesConfig = {
  pass: { label: "DMARC bestanden", color: PASS_COLOR },
  fail: { label: "DMARC gescheitert", color: FAIL_COLOR },
} satisfies ChartConfig

const sourceConfig = {
  passMessages: { label: "Bestanden", color: PASS_COLOR },
  failMessages: { label: "Gescheitert", color: FAIL_COLOR },
} satisfies ChartConfig

function formatInt(value: number): string {
  return value.toLocaleString("de-DE")
}

function formatDay(iso: string): string {
  // iso is already YYYY-MM-DD (UTC day bucket from the server).
  const parts = iso.split("-")
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.` : iso
}

function formatTimestamp(iso: string): string {
  if (!iso) return "–"
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("de-DE")
}

export default function EmailDmarcPage() {
  const serverMode = isServerClientMode()
  const [windowDays, setWindowDays] = useState<number>(30)
  const [data, setData] = useState<DmarcStatsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!serverMode) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const r = (await invokeRenderer(IPCChannels.Email.ListDmarcStats, { windowDays })) as {
        success: boolean
        data?: DmarcStatsSnapshot
      }
      if (r.success && r.data) setData(r.data)
      else toast.error("DMARC-Auswertung konnte nicht geladen werden.")
    } catch {
      toast.error("DMARC-Auswertung konnte nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [serverMode, windowDays])

  useEffect(() => {
    void load()
  }, [load])

  const failRate = useMemo(() => {
    if (!data || data.totals.messages === 0) return 0
    return (data.totals.failMessages / data.totals.messages) * 100
  }, [data])

  const hasData = Boolean(data && data.totals.reports > 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <ShieldAlert className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold tracking-tight">DMARC-Auswertung</h1>
      </header>

      <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
        {!serverMode ? (
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Nur Server-Edition</AlertTitle>
            <AlertDescription>
              Die DMARC-Aggregat-Auswertung läuft auf dem SimpleCRM-Server und ist in der
              Desktop-App nicht verfügbar.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Zeitraum</CardTitle>
                <CardDescription>
                  Aggregierte DMARC-Reports (RUA), die per E-Mail eingegangen sind. Buckets nach
                  Report-Startdatum (UTC).
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dmarc-window">Fenster</Label>
                  <select
                    id="dmarc-window"
                    className="flex h-10 min-w-[160px] rounded-md border border-input bg-background px-3 text-sm"
                    value={String(windowDays)}
                    onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
                  >
                    {WINDOW_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Aktualisieren
                </Button>
              </CardContent>
            </Card>

            {loading && !data ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !hasData ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                  <Inbox className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Noch keine DMARC-Reports im gewählten Zeitraum. Sobald ein synchronisiertes
                    Postfach RUA-Reports empfängt und der Workflow sie auswertet, erscheinen hier
                    Zeitreihen und auffällige Quellen.
                  </p>
                </CardContent>
              </Card>
            ) : data ? (
              <DmarcContent data={data} failRate={failRate} />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function DmarcContent({ data, failRate }: { data: DmarcStatsSnapshot; failRate: number }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
          label="Reports"
          value={formatInt(data.totals.reports)}
          hint={`${formatInt(data.totals.domains)} Domain(s)`}
        />
        <KpiCard
          icon={<Inbox className="h-4 w-4 text-muted-foreground" />}
          label="Nachrichten"
          value={formatInt(data.totals.messages)}
          hint={`${formatInt(data.totals.passMessages)} bestanden`}
        />
        <KpiCard
          icon={<ShieldX className="h-4 w-4 text-muted-foreground" />}
          label="Fehlerquote"
          value={`${failRate.toFixed(1)} %`}
          hint={`${formatInt(data.totals.failMessages)} gescheitert`}
        />
        <KpiCard
          icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}
          label="Nicht-autorisierte Quellen"
          value={formatInt(data.totals.unauthorizedSources)}
          hint={`${formatInt(data.totals.rejectMessages)} abgewiesen · ${formatInt(
            data.totals.quarantineMessages,
          )} Quarantäne`}
          emphasise={data.totals.unauthorizedSources > 0}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bestanden vs. gescheitert über die Zeit</CardTitle>
          <CardDescription>
            Nachrichten pro Tag, die DMARC bestehen (DKIM- oder SPF-Ausrichtung) bzw. scheitern.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.timeSeries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Keine Datenpunkte im Zeitraum.
            </p>
          ) : (
            <ChartContainer config={timeSeriesConfig} className="aspect-auto h-[280px] w-full">
              <LineChart data={data.timeSeries} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDay}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                />
                <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <ChartTooltip
                  content={<ChartTooltipContent labelFormatter={(v) => formatDay(String(v))} />}
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Line
                  type="monotone"
                  dataKey="pass"
                  name="pass"
                  stroke="var(--color-pass)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="fail"
                  name="fail"
                  stroke="var(--color-fail)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top-Quell-IPs</CardTitle>
          <CardDescription>
            Absender-IPs nach Nachrichtenvolumen, aufgeteilt in bestanden/gescheitert. Rote Anteile
            sind Kandidaten für Spoofing oder nicht autorisierte Sender.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.topSourceIps.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Keine Quell-IPs im Zeitraum.</p>
          ) : (
            <ChartContainer
              config={sourceConfig}
              className="aspect-auto w-full"
              style={{ height: `${Math.max(160, data.topSourceIps.length * 32 + 48)}px` }}
            >
              <BarChart
                data={data.topSourceIps}
                layout="vertical"
                margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
              >
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="sourceIp"
                  tickLine={false}
                  axisLine={false}
                  width={120}
                  tick={{ fontSize: 11 }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="passMessages" name="passMessages" stackId="msgs" fill="var(--color-passMessages)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="failMessages" name="failMessages" stackId="msgs" fill="var(--color-failMessages)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nicht-autorisierte Quellen</CardTitle>
          <CardDescription>
            Quell-IPs, die DMARC vollständig scheitern (weder DKIM- noch SPF-Ausrichtung) — nach
            Volumen. Auch die Tabellenansicht der obigen Diagramme.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.unauthorizedSources.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              Keine nicht-autorisierten Quellen im Zeitraum — alle gemeldeten Nachrichten waren
              ausgerichtet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3">Quell-IP</th>
                    <th className="py-2 pr-3">Header-From</th>
                    <th className="py-2 pr-3">Domain</th>
                    <th className="py-2 pr-3">Melder</th>
                    <th className="py-2 pr-3 text-right">Nachrichten</th>
                    <th className="py-2">Zuletzt</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unauthorizedSources.map((row, i) => (
                    <tr key={`${row.sourceIp}-${row.domain}-${i}`} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-mono">{row.sourceIp}</td>
                      <td className="py-2 pr-3">{row.headerFrom ?? "–"}</td>
                      <td className="py-2 pr-3">{row.domain}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{row.orgName}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatInt(row.messages)}</td>
                      <td className="py-2 text-muted-foreground">{formatTimestamp(row.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  emphasise = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  emphasise?: boolean
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold" style={emphasise ? { color: FAIL_COLOR } : undefined}>
          {value}
        </div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}
