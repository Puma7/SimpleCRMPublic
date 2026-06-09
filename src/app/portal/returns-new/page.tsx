"use client"

import { useCallback, useMemo, useState } from "react"
import { useParams } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Plus, X } from "lucide-react"
import { invokeRenderer } from "@/services/transport"

// The public portal is unauthenticated by design. It deliberately does NOT
// load the workspace's reason vocabulary (the customer doesn't pick a reason
// at the line-item level — that's an internal post-processing step in the
// portal flow). The server still accepts reasonId if a future iteration wants
// it, but the public form keeps the input surface minimal.

type DraftItem = {
  key: string
  sku: string
  productName: string
  quantity: number
}

function emptyItem(): DraftItem {
  return { key: crypto.randomUUID(), sku: "", productName: "", quantity: 1 }
}

type CreatedRecord = {
  returnNumber: string
  status: string
  outcome: string | null
  jtlOrderNumber: string | null
  createdAt: string
}

export default function PortalReturnsNewPage() {
  // useParams will throw if used outside a matching route — that's fine because
  // the route definition guarantees the param is present.
  const { token } = useParams({ from: "/portal/$token/returns/new" })
  const [orderNumber, setOrderNumber] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [customerName, setCustomerName] = useState("")
  const [notes, setNotes] = useState("")
  const [items, setItems] = useState<DraftItem[]>([emptyItem()])
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<CreatedRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = useMemo(
    () => items.some((it) => it.quantity > 0 && (it.sku.trim() || it.productName.trim())),
    [items],
  )

  const submit = useCallback(async () => {
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        token,
        jtlOrderNumber: orderNumber.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        customerName: customerName.trim() || undefined,
        notes: notes.trim() || undefined,
        items: items
          .filter((it) => it.quantity > 0 && (it.sku.trim() || it.productName.trim()))
          .map((it) => ({
            sku: it.sku.trim() || null,
            productName: it.productName.trim() || null,
            quantity: Math.max(1, Math.floor(it.quantity)),
          })),
      }
      const record = (await invokeRenderer(IPCChannels.Returns.PortalCreate, payload)) as CreatedRecord
      setCreated(record)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anlegen fehlgeschlagen")
    } finally {
      setSubmitting(false)
    }
  }, [token, orderNumber, customerEmail, customerName, notes, items])

  if (created) {
    const lookupHref = `/portal/${token}/returns/${encodeURIComponent(created.returnNumber)}`
    return (
      <div className="container mx-auto max-w-2xl px-4 py-10">
        <Card data-testid="portal-success">
          <CardHeader>
            <CardTitle>Vielen Dank — Ihre Retoure ist eingegangen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>
              Ihre Retouren-Nr. lautet{" "}
              <code className="rounded bg-muted px-2 py-1 font-mono text-base" data-testid="created-return-number">
                {created.returnNumber}
              </code>
              . Bitte notieren Sie sich die Nummer.
            </p>
            <p className="text-sm text-muted-foreground">
              Sie können den Status jederzeit hier nachsehen:
            </p>
            <a
              className="block break-all text-sm text-primary underline"
              href={lookupHref}
              data-testid="created-lookup-link"
            >
              {lookupHref}
            </a>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Retoure anmelden</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Bitte füllen Sie die Felder so vollständig wie möglich aus. Eine Bestellnummer beschleunigt
            die Bearbeitung, ist aber nicht zwingend erforderlich.
          </p>

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="portal-error">
              {error}
            </div>
          ) : null}

          <div>
            <Label htmlFor="portal-order">Bestellnummer (optional)</Label>
            <Input
              id="portal-order"
              placeholder="z. B. EXT-1001"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="portal-email">E-Mail</Label>
              <Input
                id="portal-email"
                type="email"
                placeholder="kunde@example.com"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="portal-name">Name</Label>
              <Input
                id="portal-name"
                placeholder="Max Mustermann"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Positionen</Label>
              <Button type="button" size="sm" variant="ghost" onClick={() => setItems([...items, emptyItem()])}>
                <Plus className="mr-1 h-3 w-3" /> Position
              </Button>
            </div>
            {items.map((it, idx) => (
              <div key={it.key} className="grid grid-cols-[1fr_1fr_72px_auto] gap-2">
                <Input
                  placeholder="SKU / Artikelnummer"
                  value={it.sku}
                  onChange={(e) => updateDraftItem(idx, { sku: e.target.value }, items, setItems)}
                />
                <Input
                  placeholder="Artikelname"
                  value={it.productName}
                  onChange={(e) => updateDraftItem(idx, { productName: e.target.value }, items, setItems)}
                />
                <Input
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) =>
                    updateDraftItem(idx, { quantity: Math.max(1, Number(e.target.value) || 1) }, items, setItems)
                  }
                />
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
            <Label htmlFor="portal-notes">Beschreibung / Grund</Label>
            <Textarea
              id="portal-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button onClick={() => void submit()} disabled={!canSubmit || submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Retoure absenden
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function updateDraftItem(
  index: number,
  patch: Partial<DraftItem>,
  items: DraftItem[],
  set: (next: DraftItem[]) => void,
) {
  const next = items.slice()
  next[index] = { ...next[index]!, ...patch }
  set(next)
}
