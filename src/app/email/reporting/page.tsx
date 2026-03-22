"use client"

import { useCallback, useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { ArrowLeft, BarChart3, Loader2 } from "lucide-react"

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
  workflowRuns24h: { workflow_id: number; count: number; errors: number }[]
}

export default function EmailReportingPage() {
  const [filter, setFilter] = useState<number | "all">("all")
  const [data, setData] = useState<Snapshot | null>(null)
  const [accountList, setAccountList] = useState<AccountRow[]>([])
  const [loading, setLoading] = useState(true)

  const hasElectron =
    typeof window !== "undefined" &&
    window.electronAPI &&
    typeof (window.electronAPI as { invoke?: unknown }).invoke === "function"

  const load = useCallback(async () => {
    if (!hasElectron) return
    setLoading(true)
    try {
      const r = (await (window.electronAPI as { invoke: (c: string, id: number | null) => Promise<{ success: boolean; data?: Snapshot }> }).invoke(
        IPCChannels.Email.EmailReporting,
        filter === "all" ? null : filter,
      )) as { success: boolean; data?: Snapshot }
      if (r.success && r.data) setData(r.data)
      else toast.error("Reporting konnte nicht geladen werden.")
    } catch {
      toast.error("Reporting konnte nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [hasElectron, filter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!hasElectron) return
    void (async () => {
      try {
        const acc = (await (window.electronAPI as { invoke: (c: string) => Promise<AccountRow[]> }).invoke(
          IPCChannels.Email.ListAccounts,
        )) as AccountRow[]
        setAccountList(acc)
      } catch {
        setAccountList([])
      }
    })()
  }, [hasElectron])

  if (!hasElectron) {
    return (
      <div className="container py-10">
        <p>Nur Desktop.</p>
      </div>
    )
  }

  return (
    <div className="container max-w-4xl space-y-6 py-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/email">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Posteingang
        </Link>
      </Button>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BarChart3 className="h-7 w-7" />
          E-Mail-Reporting
        </h1>
      </div>

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
                <CardTitle className="text-sm font-medium text-muted-foreground">Ungelesen (IMAP/POP)</CardTitle>
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
                <CardTitle className="text-sm font-medium text-muted-foreground">Mit Anhängen (Flag)</CardTitle>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workflow-Läufe (24h)</CardTitle>
              <CardDescription>Top-Workflows nach Anzahl Läufen; Spalte „Fehler“ = Status error.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.workflowRuns24h.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Läufe in den letzten 24 Stunden.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-2">Workflow-ID</th>
                      <th className="py-2 pr-2">Läufe</th>
                      <th className="py-2">Fehler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.workflowRuns24h.map((w) => (
                      <tr key={w.workflow_id} className="border-b border-border/60">
                        <td className="py-2 pr-2 font-mono">{w.workflow_id}</td>
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
  )
}
