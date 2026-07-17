"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { BarChart3, Loader2, Plus, Search, Settings, X } from "lucide-react"
import { invokeRenderer } from "@/services/transport"
import { useAuth } from "@/components/auth/auth-context"

// Status + outcome enums mirror the server's column CHECK constraints.
const STATUSES = [
  "pending",
  "approved",
  "received",
  "refunded",
  "exchanged",
  "credited",
  "rejected",
  "cancelled",
] as const
type Status = (typeof STATUSES)[number]

const OUTCOMES = ["refund", "exchange", "credit", "keep"] as const
type Outcome = (typeof OUTCOMES)[number]

const CONDITIONS = ["new", "opened", "used", "damaged"] as const
type Condition = (typeof CONDITIONS)[number]

const STATUS_LABEL: Record<Status, string> = {
  pending: "Offen",
  approved: "Genehmigt",
  received: "Eingegangen",
  refunded: "Erstattet",
  exchanged: "Umgetauscht",
  credited: "Gutgeschrieben",
  rejected: "Abgelehnt",
  cancelled: "Storniert",
}

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  approved: "default",
  received: "default",
  refunded: "outline",
  exchanged: "outline",
  credited: "outline",
  rejected: "destructive",
  cancelled: "destructive",
}

type ReturnItem = {
  id: number
  returnId: number
  productId: number | null
  reasonId: number | null
  sku: string | null
  productName: string | null
  quantity: number
  condition: Condition | null
  notes: string | null
}

type ReturnRecord = {
  id: number
  returnNumber: string
  customerId: number | null
  emailMessageId: number | null
  jtlOrderNumber: string | null
  jtlKauftrag: number | null
  status: Status
  outcome: Outcome | null
  customerEmail: string | null
  customerName: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  items: ReturnItem[]
}

type ReasonRecord = { id: number; code: string; label: string; isActive: boolean; sortOrder: number }

type ListResult = { items: ReturnRecord[]; totalCount: number }

type AnalyticsResult = {
  totalCount: number
  byStatus: Array<{ status: Status; count: number }>
  byOutcome: Array<{ outcome: Outcome | null; count: number }>
  topReasons: Array<{ reasonId: number | null; code: string | null; label: string | null; count: number }>
  generatedAt: string
}

const ANALYTICS_WINDOWS: Array<{ label: string; value: number | "all" }> = [
  { label: "30 Tage", value: 30 },
  { label: "90 Tage", value: 90 },
  { label: "1 Jahr", value: 365 },
  { label: "Alle", value: "all" },
]

type JtlLookupResult = {
  configured: boolean
  order: {
    kAuftrag: number
    orderNumber: string
    kKunde: number | null
    dateCreated: string | null
    items: Array<{
      kAuftragPosition: number
      kArtikel: number | null
      sku: string | null
      name: string | null
      quantity: number
      unitPriceNet: number | null
    }>
  } | null
  lookupError?: string
}

export default function ReturnsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "owner" || user?.role === "admin"
  const [list, setList] = useState<ListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all")
  const [search, setSearch] = useState("")
  const [reasons, setReasons] = useState<ReasonRecord[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [detailRecord, setDetailRecord] = useState<ReturnRecord | null>(null)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [portalOpen, setPortalOpen] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const payload: Record<string, unknown> = { limit: 100 }
      if (statusFilter !== "all") payload.status = statusFilter
      if (search.trim()) payload.search = search.trim()
      const result = (await invokeRenderer(
        IPCChannels.Returns.List,
        payload,
      )) as ListResult
      setList(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Laden fehlgeschlagen")
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search])

  const loadReasons = useCallback(async () => {
    try {
      const result = (await invokeRenderer(IPCChannels.Returns.ListReasons)) as ReasonRecord[]
      setReasons(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retourengründe konnten nicht geladen werden")
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    void loadReasons()
  }, [loadReasons])

  return (
    <div className="container mx-auto space-y-6 px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Retouren</h1>
          <p className="text-sm text-muted-foreground">
            Verwalte Retouren intern. Status, Outcome (Erstattung / Umtausch / Gutschrift) und
            Positionen werden hier gepflegt.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Button
              variant={portalOpen ? "secondary" : "outline"}
              onClick={() => setPortalOpen((v) => !v)}
            >
              <Settings className="mr-2 h-4 w-4" /> Portal
            </Button>
          ) : null}
          <Button
            variant={analyticsOpen ? "secondary" : "outline"}
            onClick={() => setAnalyticsOpen((v) => !v)}
          >
            <BarChart3 className="mr-2 h-4 w-4" /> Auswertung
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Neue Retoure
          </Button>
        </div>
      </div>

      {isAdmin && portalOpen ? <PortalSettingsPanel /> : null}
      {analyticsOpen ? <ReturnsAnalyticsPanel reasons={reasons} /> : null}

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Filter</CardTitle>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Label htmlFor="returns-search" className="text-xs">
                Suche (Retouren-Nr., Bestellnr., E-Mail, Name)
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="returns-search"
                  className="pl-8"
                  placeholder="Suchen..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="w-[200px]">
              <Label htmlFor="returns-status" className="text-xs">
                Status
              </Label>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as "all" | Status)}
              >
                <SelectTrigger id="returns-status">
                  <SelectValue placeholder="Alle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => void loadList()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Aktualisieren
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Liste{list ? ` (${list.totalCount})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !list ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> lädt...
            </div>
          ) : !list || list.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Noch keine Retouren {statusFilter !== "all" || search.trim() ? "für diesen Filter" : "vorhanden"}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="returns-table">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left">Retouren-Nr.</th>
                    <th className="px-2 py-2 text-left">Bestellnr.</th>
                    <th className="px-2 py-2 text-left">Kunde</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Outcome</th>
                    <th className="px-2 py-2 text-right">Positionen</th>
                    <th className="px-2 py-2 text-left">Angelegt</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer border-b hover:bg-muted/50"
                      onClick={() => setDetailRecord(r)}
                      data-testid={`return-row-${r.id}`}
                    >
                      <td className="px-2 py-2 font-mono">{r.returnNumber}</td>
                      <td className="px-2 py-2">{r.jtlOrderNumber ?? "—"}</td>
                      <td className="px-2 py-2">
                        {r.customerName || r.customerEmail || "—"}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      </td>
                      <td className="px-2 py-2">{r.outcome ?? "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.items.length}</td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateReturnDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        reasons={reasons}
        onCreated={() => {
          setCreateOpen(false)
          void loadList()
        }}
      />

      <ReturnDetailDialog
        record={detailRecord}
        reasons={reasons}
        onOpenChange={(o) => {
          if (!o) setDetailRecord(null)
        }}
        onUpdated={(updated) => {
          setDetailRecord(updated)
          void loadList()
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Portal-Settings panel — token rotation + enable/disable + URL preview
// ---------------------------------------------------------------------------

type PortalSettings = {
  enabled: boolean
  token: string | null
  hasToken: boolean
  updatedAt: string | null
}

function publicPortalUrl(token: string): string {
  if (typeof window === "undefined") return ""
  return `${window.location.origin}/portal/${token}/returns/new`
}

function PortalSettingsPanel() {
  const [settings, setSettings] = useState<PortalSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = (await invokeRenderer(IPCChannels.Returns.GetPortalSettings)) as PortalSettings
      setSettings(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Portal-Einstellungen laden fehlgeschlagen")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const rotate = useCallback(async () => {
    setBusy(true)
    try {
      const result = (await invokeRenderer(
        IPCChannels.Returns.RotatePortalToken,
        { enable: true },
      )) as PortalSettings
      setSettings(result)
      toast.success("Neuer Portal-Token erzeugt. Bitte URL kopieren — wird nicht erneut angezeigt.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Token-Rotation fehlgeschlagen")
    } finally {
      setBusy(false)
    }
  }, [])

  const setEnabled = useCallback(async (enabled: boolean) => {
    setBusy(true)
    try {
      const result = (await invokeRenderer(
        IPCChannels.Returns.SetPortalEnabled,
        { enabled },
      )) as PortalSettings
      setSettings(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status setzen fehlgeschlagen")
    } finally {
      setBusy(false)
    }
  }, [])

  const revoke = useCallback(async () => {
    if (!window.confirm("Portal-Token wirklich löschen? Alle bisher veröffentlichten URLs werden ungültig.")) return
    setBusy(true)
    try {
      const result = (await invokeRenderer(IPCChannels.Returns.RevokePortalToken)) as PortalSettings
      setSettings(result)
      toast.success("Portal-Token gelöscht.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Löschen fehlgeschlagen")
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <Card data-testid="portal-settings">
      <CardHeader>
        <CardTitle className="text-base">Kundenportal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !settings ? (
          <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> lädt...</div>
        ) : !settings ? null : !settings.hasToken ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Noch kein Portal-Token. Beim Erzeugen erhältst du eine öffentliche URL, über die Kunden
              ohne Login Retouren anlegen und den Status nachsehen können.
            </p>
            <Button onClick={() => void rotate()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Portal aktivieren
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant={settings.enabled ? "default" : "secondary"}>
                  {settings.enabled ? "aktiv" : "deaktiviert"}
                </Badge>
                {settings.updatedAt ? (
                  <span className="text-xs text-muted-foreground">
                    zuletzt geändert {new Date(settings.updatedAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void setEnabled(!settings.enabled)}
                  disabled={busy}
                >
                  {settings.enabled ? "Deaktivieren" : "Aktivieren"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void rotate()} disabled={busy}>
                  Token rotieren
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void revoke()} disabled={busy}>
                  Löschen
                </Button>
              </div>
            </div>
            {settings.token ? (
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Öffentliche Portal-URL — kopiere sie jetzt, sie wird nicht erneut angezeigt:
                </p>
                <code className="block break-all text-xs" data-testid="portal-url">{publicPortalUrl(settings.token)}</code>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Token ist gesetzt, wird aber zur Sicherheit nicht erneut angezeigt. Bei Verlust einfach
                rotieren — alte URLs werden dadurch ungültig.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Analytics panel — Retourengründe + Status/Outcome-Verteilung
// ---------------------------------------------------------------------------

function ReturnsAnalyticsPanel({ reasons }: { reasons: ReasonRecord[] }) {
  const [window, setWindow] = useState<number | "all">(90)
  const [data, setData] = useState<AnalyticsResult | null>(null)
  const [loading, setLoading] = useState(false)

  const reasonLabelByCode = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of reasons) map.set(r.code, r.label)
    return map
  }, [reasons])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const payload: Record<string, unknown> = {}
      if (window !== "all") payload.sinceDays = window
      const result = (await invokeRenderer(IPCChannels.Returns.Analytics, payload)) as AnalyticsResult
      setData(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auswertung fehlgeschlagen")
    } finally {
      setLoading(false)
    }
  }, [window])

  useEffect(() => {
    void load()
  }, [load])

  const maxReasonCount = data ? Math.max(1, ...data.topReasons.map((r) => r.count)) : 1

  const reasonDisplay = (r: AnalyticsResult["topReasons"][number]) => {
    if (r.reasonId === null) return "Ohne Grund"
    if (r.label) return r.label
    if (r.code) return reasonLabelByCode.get(r.code) ?? r.code
    return `#${r.reasonId} (gelöscht)`
  }

  return (
    <Card data-testid="returns-analytics">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Auswertung</CardTitle>
          <div className="flex items-center gap-1">
            {ANALYTICS_WINDOWS.map((w) => (
              <Button
                key={String(w.value)}
                size="sm"
                variant={window === w.value ? "secondary" : "ghost"}
                onClick={() => setWindow(w.value)}
              >
                {w.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> lädt...
          </div>
        ) : !data ? null : (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Retouren gesamt</p>
                <p className="text-2xl font-bold tabular-nums" data-testid="analytics-total">
                  {data.totalCount}
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Nach Status</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.byStatus.length === 0 ? (
                    <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    data.byStatus.map((s) => (
                      <Badge key={s.status} variant={STATUS_VARIANT[s.status]}>
                        {STATUS_LABEL[s.status]}: {s.count}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Nach Outcome</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.byOutcome.length === 0 ? (
                    <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    data.byOutcome.map((o) => (
                      <Badge key={o.outcome ?? "none"} variant="outline">
                        {(o.outcome ?? "offen")}: {o.count}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Top Retourengründe (nach Positionen)
              </p>
              {data.topReasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch keine Positionen erfasst.</p>
              ) : (
                <ul className="space-y-1.5" data-testid="analytics-reasons">
                  {data.topReasons.slice(0, 8).map((r) => (
                    <li key={r.reasonId ?? "none"} className="space-y-0.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate">{reasonDisplay(r)}</span>
                        <span className="ml-2 tabular-nums text-muted-foreground">{r.count}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                        <div
                          className="h-full rounded bg-primary"
                          style={{ width: `${Math.round((r.count / maxReasonCount) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Create dialog — Bestellnummer optional mit JTL-Lookup, sonst Freitext
// ---------------------------------------------------------------------------

type DraftItem = {
  key: string
  sku: string
  productName: string
  quantity: number
  reasonId: number | "none"
  condition: Condition | "none"
}

function emptyItem(): DraftItem {
  return {
    key: crypto.randomUUID(),
    sku: "",
    productName: "",
    quantity: 1,
    reasonId: "none",
    condition: "none",
  }
}

function CreateReturnDialog({
  open,
  onOpenChange,
  reasons,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  reasons: ReasonRecord[]
  onCreated: () => void
}) {
  const [orderNumber, setOrderNumber] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [customerName, setCustomerName] = useState("")
  const [notes, setNotes] = useState("")
  const [items, setItems] = useState<DraftItem[]>([emptyItem()])
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupHint, setLookupHint] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [jtlKauftrag, setJtlKauftrag] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      setOrderNumber("")
      setCustomerEmail("")
      setCustomerName("")
      setNotes("")
      setItems([emptyItem()])
      setLookupHint(null)
      setJtlKauftrag(null)
    }
  }, [open])

  const tryJtlLookup = useCallback(async () => {
    const trimmed = orderNumber.trim()
    if (!trimmed) {
      setLookupHint("Bitte zuerst eine Bestellnummer eingeben.")
      return
    }
    setLookupBusy(true)
    setLookupHint(null)
    try {
      const result = (await invokeRenderer(
        IPCChannels.Returns.LookupJtlOrder,
        trimmed,
      )) as JtlLookupResult
      if (!result.configured) {
        setLookupHint("JTL nicht konfiguriert — bitte Positionen manuell eintragen.")
        return
      }
      if (result.lookupError) {
        setLookupHint(`JTL-Abfrage fehlgeschlagen: ${result.lookupError} — bitte manuell eintragen.`)
        return
      }
      if (!result.order) {
        setLookupHint(`Bestellung ${trimmed} in JTL nicht gefunden — bitte manuell eintragen.`)
        return
      }
      setJtlKauftrag(result.order.kAuftrag)
      setItems(result.order.items.length === 0
        ? [emptyItem()]
        : result.order.items.map((it) => ({
            key: crypto.randomUUID(),
            sku: it.sku ?? "",
            productName: it.name ?? "",
            quantity: Math.max(1, Math.floor(it.quantity || 1)),
            reasonId: "none",
            condition: "none",
          })))
      setLookupHint(`${result.order.items.length} Position(en) aus JTL übernommen.`)
    } catch (err) {
      setLookupHint(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLookupBusy(false)
    }
  }, [orderNumber])

  const canSubmit = useMemo(
    () => items.some((it) => it.quantity > 0 && (it.sku.trim() || it.productName.trim())),
    [items],
  )

  const submit = useCallback(async () => {
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        items: items
          .filter((it) => it.quantity > 0)
          .map((it) => ({
            sku: it.sku.trim() || null,
            productName: it.productName.trim() || null,
            quantity: Math.floor(it.quantity),
            reasonId: it.reasonId === "none" ? null : it.reasonId,
            condition: it.condition === "none" ? null : it.condition,
          })),
      }
      if (orderNumber.trim()) payload.jtlOrderNumber = orderNumber.trim()
      if (jtlKauftrag !== null) payload.jtlKauftrag = jtlKauftrag
      if (customerEmail.trim()) payload.customerEmail = customerEmail.trim()
      if (customerName.trim()) payload.customerName = customerName.trim()
      if (notes.trim()) payload.notes = notes.trim()
      const record = (await invokeRenderer(
        IPCChannels.Returns.Create,
        payload,
      )) as ReturnRecord
      toast.success(`Retoure ${record.returnNumber} angelegt.`)
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Anlegen fehlgeschlagen")
    } finally {
      setSubmitting(false)
    }
  }, [items, orderNumber, customerEmail, customerName, notes, jtlKauftrag, onCreated])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Neue Retoure anlegen</DialogTitle>
          <DialogDescription>
            Optional Bestellnummer eingeben und aus JTL übernehmen — sonst direkt manuell ausfüllen.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div>
              <Label htmlFor="create-order-number" className="text-xs">
                JTL-Bestellnummer (optional)
              </Label>
              <Input
                id="create-order-number"
                placeholder="z. B. EXT-1001"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void tryJtlLookup()}
              disabled={lookupBusy}
            >
              {lookupBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Aus JTL übernehmen
            </Button>
          </div>
          {lookupHint ? (
            <p className="text-xs text-muted-foreground" data-testid="lookup-hint">
              {lookupHint}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="create-customer-email" className="text-xs">
                Kunden-E-Mail
              </Label>
              <Input
                id="create-customer-email"
                placeholder="kunde@example.com"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="create-customer-name" className="text-xs">
                Kundenname
              </Label>
              <Input
                id="create-customer-name"
                placeholder="Max Mustermann"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Positionen</Label>
              <Button type="button" size="sm" variant="ghost" onClick={() => setItems([...items, emptyItem()])}>
                <Plus className="mr-1 h-3 w-3" /> Position
              </Button>
            </div>
            {items.map((it, idx) => (
              <div key={it.key} className="grid grid-cols-[1fr_1fr_72px_1fr_1fr_auto] gap-2">
                <Input
                  placeholder="SKU"
                  value={it.sku}
                  onChange={(e) => updateItem(idx, { sku: e.target.value }, items, setItems)}
                />
                <Input
                  placeholder="Artikelname"
                  value={it.productName}
                  onChange={(e) => updateItem(idx, { productName: e.target.value }, items, setItems)}
                />
                <Input
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) =>
                    updateItem(idx, { quantity: Math.max(1, Number(e.target.value) || 1) }, items, setItems)
                  }
                />
                <Select
                  value={String(it.reasonId)}
                  onValueChange={(v) =>
                    updateItem(idx, { reasonId: v === "none" ? "none" : Number(v) }, items, setItems)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Grund" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {reasons.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={it.condition}
                  onValueChange={(v) => updateItem(idx, { condition: v as Condition | "none" }, items, setItems)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Zustand" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {CONDITIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setItems(items.filter((_, i) => i !== idx))}
                  disabled={items.length === 1}
                  aria-label="Position entfernen"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div>
            <Label htmlFor="create-notes" className="text-xs">
              Notizen
            </Label>
            <Textarea
              id="create-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit || submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function updateItem(
  index: number,
  patch: Partial<DraftItem>,
  items: DraftItem[],
  set: (next: DraftItem[]) => void,
) {
  const next = items.slice()
  next[index] = { ...next[index]!, ...patch }
  set(next)
}

// ---------------------------------------------------------------------------
// Detail dialog with status / outcome / notes editor
// ---------------------------------------------------------------------------

function ReturnDetailDialog({
  record,
  reasons,
  onOpenChange,
  onUpdated,
}: {
  record: ReturnRecord | null
  reasons: ReasonRecord[]
  onOpenChange: (open: boolean) => void
  onUpdated: (updated: ReturnRecord) => void
}) {
  const [status, setStatus] = useState<Status>("pending")
  const [outcome, setOutcome] = useState<Outcome | "none">("none")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (record) {
      setStatus(record.status)
      setOutcome(record.outcome ?? "none")
      setNotes(record.notes ?? "")
    }
  }, [record])

  const reasonLabel = useCallback(
    (id: number | null) => (id == null ? "—" : reasons.find((r) => r.id === id)?.label ?? `#${id}`),
    [reasons],
  )

  const save = useCallback(async () => {
    if (!record) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { id: record.id }
      if (status !== record.status) payload.status = status
      const nextOutcome = outcome === "none" ? null : outcome
      if (nextOutcome !== record.outcome) payload.outcome = nextOutcome
      if (notes !== (record.notes ?? "")) payload.notes = notes.trim() || null
      if (Object.keys(payload).length === 1) {
        toast.info("Keine Änderungen.")
        setSaving(false)
        return
      }
      const updated = (await invokeRenderer(IPCChannels.Returns.Update, payload)) as ReturnRecord
      toast.success("Retoure aktualisiert.")
      onUpdated(updated)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen")
    } finally {
      setSaving(false)
    }
  }, [record, status, outcome, notes, onUpdated])

  if (!record) return null
  return (
    <Dialog open={record != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{record.returnNumber}</DialogTitle>
          <DialogDescription>
            Angelegt {new Date(record.createdAt).toLocaleString()} ·{" "}
            {record.jtlOrderNumber ? `Bestellung ${record.jtlOrderNumber}` : "ohne Bestellnummer"} ·{" "}
            {record.customerName || record.customerEmail || "ohne Kunden"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Outcome</Label>
            <Select value={outcome} onValueChange={(v) => setOutcome(v as Outcome | "none")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Badge variant={STATUS_VARIANT[record.status]}>aktuell: {STATUS_LABEL[record.status]}</Badge>
          </div>
        </div>

        <div>
          <Label className="text-xs">Notizen</Label>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Positionen ({record.items.length})</Label>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-2 py-1 text-left">SKU</th>
                  <th className="px-2 py-1 text-left">Artikel</th>
                  <th className="px-2 py-1 text-right">Menge</th>
                  <th className="px-2 py-1 text-left">Zustand</th>
                  <th className="px-2 py-1 text-left">Grund</th>
                </tr>
              </thead>
              <tbody>
                {record.items.map((it) => (
                  <tr key={it.id} className="border-b">
                    <td className="px-2 py-1 font-mono text-xs">{it.sku ?? "—"}</td>
                    <td className="px-2 py-1">{it.productName ?? "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{it.quantity}</td>
                    <td className="px-2 py-1">{it.condition ?? "—"}</td>
                    <td className="px-2 py-1">{reasonLabel(it.reasonId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
