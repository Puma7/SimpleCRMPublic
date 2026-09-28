"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { BarChart3, Loader2 } from "lucide-react"
import { invokeRenderer } from "@/services/transport"
import { automatedShare, type AutomationCockpitSnapshot } from "../../../../packages/core/src/email/automation-cockpit"

type AccountRow = { id: number; display_name: string; email_address: string; protocol?: string }

type Snapshot = {
  accounts: { id: number; display_name: string; email_address: string; protocol: string }[]
  totals: {
    messages: number
    unread: number
    archived: number
    withCustomer: number
    withAssignment: number
    withAttachments: number
  }
  perAccount: { accountId: number; messages: number; unread: number; archived: number }[]
  workflowRuns24h: { workflow_id: number; workflow_name?: string | null; count: number; errors: number }[]
  /** Plan 049: Automatik-Cockpit (fehlt bei älteren Servern). */
  automation?: AutomationCockpitSnapshot
}

/** Wie in Einstellungen → Diagnose. */
function formatUsd(microUsd: number): string {
  const usd = microUsd / 1_000_000
  if (usd === 0) return "$0.00"
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function formatWeekStart(isoDay: string): string {
  const [year, month, day] = isoDay.split("-")
  return year && month && day ? `${day}.${month}.${year}` : isoDay
}

function formatShare(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)} %`
}

function workflowLabel(id: number, name: string | null | undefined): string {
  return name?.trim() || `Workflow #${id}`
}

function AutomationCard({ automation }: { automation: AutomationCockpitSnapshot }) {
  return (
    <Card data-testid="automation-cockpit">
      <CardHeader>
        <CardTitle className="text-base">Automatisierung</CardTitle>
        <CardDescription>
          Wer hat gesendet (je Woche), was wartet, wie hat die KI-Entscheidung geantwortet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">Wartet auf Freigabe</p>
            <p className="text-2xl font-semibold">{automation.pendingApproval}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Versand blockiert</p>
            <p className="text-2xl font-semibold">{automation.outboundBlocked}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">KI-Kosten (30 Tage)</p>
            {automation.aiCost30d ? (
              <p className="text-2xl font-semibold">
                {formatUsd(automation.aiCost30d.costMicroUsd)}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {automation.aiCost30d.events} Aufrufe
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nur in der Server-Edition, mit Vollzugriff und ohne Kontofilter verfügbar.
              </p>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-2">Woche ab</th>
                <th className="py-2 pr-2">Mensch</th>
                <th className="py-2 pr-2">KI automatisch</th>
                <th className="py-2 pr-2">KI freigegeben</th>
                <th className="py-2 pr-2">Automatik</th>
                <th className="py-2 pr-2">Relay</th>
                <th className="py-2">Anteil automatisch</th>
              </tr>
            </thead>
            <tbody>
              {automation.sentByKindWeekly.map((week) => (
                <tr key={week.weekStart} className="border-b border-border/60">
                  <td className="py-2 pr-2">{formatWeekStart(week.weekStart)}</td>
                  <td className="py-2 pr-2">{week.human}</td>
                  <td className="py-2 pr-2">{week.aiAuto}</td>
                  <td className="py-2 pr-2">{week.aiApproved}</td>
                  <td className="py-2 pr-2">{week.workflow}</td>
                  <td className="py-2 pr-2">{week.relay}</td>
                  <td className="py-2">{formatShare(automatedShare(week))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium">KI-Entscheidungen (30 Tage)</p>
          {automation.aiDecideByWorkflow30d.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine KI-Entscheidungen in den letzten 30 Tagen.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-2">Workflow</th>
                  <th className="py-2 pr-2">Ja</th>
                  <th className="py-2 pr-2">Nein</th>
                  <th className="py-2 pr-2">Unsicher</th>
                  <th className="py-2 pr-2">KI-Fehler</th>
                  <th className="py-2">Summe</th>
                </tr>
              </thead>
              <tbody>
                {automation.aiDecideByWorkflow30d.map((row) => (
                  <tr key={row.workflowId} className="border-b border-border/60">
                    <td className="py-2 pr-2">{workflowLabel(row.workflowId, row.workflowName)}</td>
                    <td className="py-2 pr-2">{row.ja}</td>
                    <td className="py-2 pr-2">{row.nein}</td>
                    <td className="py-2 pr-2">{row.unsicher}</td>
                    <td className="py-2 pr-2">{row.error}</td>
                    <td className="py-2">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function EmailReportingPage() {
  const [filter, setFilter] = useState<number | "all">("all")
  const [data, setData] = useState<Snapshot | null>(null)
  const [accountList, setAccountList] = useState<AccountRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await invokeRenderer(
        IPCChannels.Email.EmailReporting,
        filter === "all" ? null : filter,
      ) as { success: boolean; data?: Snapshot }
      if (r.success && r.data) setData(r.data)
      else toast.error("Reporting konnte nicht geladen werden.")
    } catch {
      toast.error("Reporting konnte nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void (async () => {
      try {
        const acc = await invokeRenderer(IPCChannels.Email.ListAccounts) as AccountRow[]
        setAccountList(acc)
      } catch {
        setAccountList([])
      }
    })()
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold tracking-tight">Auswertung</h1>
      </header>

      <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filter</CardTitle>
            <CardDescription>Gesamtzahlen optional auf ein Konto eingrenzen.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>Konto</Label>
              <select
                className="flex h-10 min-w-[200px] rounded-md border border-input bg-background px-3 text-sm"
                value={filter === "all" ? "" : String(filter)}
                onChange={(e) => setFilter(e.target.value ? parseInt(e.target.value, 10) : "all")}
              >
                <option value="">Alle Konten</option>
                {accountList.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.display_name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Aktualisieren
            </Button>
          </CardContent>
        </Card>

        {loading && !data ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Nachrichten</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{data.totals.messages}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Ungelesen (IMAP/POP)
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{data.totals.unread}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Archiviert</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{data.totals.archived}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Mit Kunde</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{data.totals.withCustomer}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Zugewiesen</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{data.totals.withAssignment}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Mit Anhängen (Flag)
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{data.totals.withAttachments}</CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pro Konto</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-2">Konto-ID</th>
                      <th className="py-2 pr-2">Nachrichten</th>
                      <th className="py-2 pr-2">Ungelesen</th>
                      <th className="py-2">Archiv</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perAccount.map((r) => (
                      <tr key={r.accountId} className="border-b border-border/60">
                        <td className="py-2 pr-2 font-mono">{r.accountId}</td>
                        <td className="py-2 pr-2">{r.messages}</td>
                        <td className="py-2 pr-2">{r.unread}</td>
                        <td className="py-2">{r.archived}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {data.automation ? <AutomationCard automation={data.automation} /> : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Workflow-Läufe (24h)</CardTitle>
                <CardDescription>
                  Top-Workflows nach Anzahl Läufen; Spalte „Fehler“ = Status error.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.workflowRuns24h.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Läufe in den letzten 24 Stunden.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-2">Workflow</th>
                        <th className="py-2 pr-2">Läufe</th>
                        <th className="py-2">Fehler</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.workflowRuns24h.map((w) => (
                        <tr key={w.workflow_id} className="border-b border-border/60">
                          <td className="py-2 pr-2">{workflowLabel(w.workflow_id, w.workflow_name)}</td>
                          <td className="py-2 pr-2">{w.count}</td>
                          <td className="py-2">{w.errors}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  )
}
