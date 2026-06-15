"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  KNOWLEDGE_CONTEXTS,
  KNOWLEDGE_CONTEXT_LABELS,
  type KnowledgeContext,
} from "@shared/knowledge-context"
import { invokeRenderer } from "@/services/transport"
import {
  assignKnowledgeBaseToAccountSlot,
  resetKnowledgeBaseAccountOverride,
} from "./account-override-mutations"
import { KnowledgeMarkdownEditor } from "./knowledge-markdown-editor"

type KbRow = {
  id: number
  name: string
  description: string | null
  account_id?: number | null
  override_key?: string | null
  knowledge_context?: string | null
}

type Props = {
  accountId: number
}

const ASSIGN_PLACEHOLDER = "__assign__"

function accountIdsMatch(
  rowAccountId: number | null | undefined,
  accountId: number,
): boolean {
  if (rowAccountId == null || rowAccountId === 0) return false
  return Number(rowAccountId) === Number(accountId)
}

function slotOverrideKey(context: KnowledgeContext): string {
  return `kb.${context}`
}

function SlotDocumentEditor({
  knowledgeBaseId,
  onSaved,
}: {
  knowledgeBaseId: number
  onSaved: () => void
}) {
  const [markdown, setMarkdown] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const r = (await invokeRenderer(
          IPCChannels.Email.GetKnowledgeBaseDocument,
          knowledgeBaseId,
        )) as { success: true; content: string } | { success: false }
        if (!cancelled) {
          setMarkdown(r.success ? r.content : "")
        }
      } catch {
        if (!cancelled) setMarkdown("")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [knowledgeBaseId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Inhalt wird geladen…
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/20 p-2">
      <KnowledgeMarkdownEditor value={markdown} onChange={setMarkdown} />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={saving}
        onClick={() => {
          setSaving(true)
          void (async () => {
            try {
              const r = (await invokeRenderer(IPCChannels.Email.SaveKnowledgeBaseDocument, {
                knowledgeBaseId,
                content: markdown,
              })) as { success: boolean; error?: string }
              if (!r.success) {
                toast.error(r.error ?? "Speichern fehlgeschlagen.")
                return
              }
              toast.success("Wissensbasis-Inhalt gespeichert.")
              onSaved()
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen.")
            } finally {
              setSaving(false)
            }
          })()
        }}
      >
        {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
        Inhalt speichern
      </Button>
    </div>
  )
}

export function AccountKnowledgeSlots({ accountId }: Props) {
  const [rows, setRows] = useState<KbRow[]>([])
  const [allKbs, setAllKbs] = useState<KbRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState<KnowledgeContext | null>(null)
  const [assigning, setAssigning] = useState<KnowledgeContext | null>(null)
  const [newNames, setNewNames] = useState<Partial<Record<KnowledgeContext, string>>>({})
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editNames, setEditNames] = useState<Record<number, string>>({})
  const [expandedDocId, setExpandedDocId] = useState<number | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [scoped, global] = await Promise.all([
        invokeRenderer(IPCChannels.Email.ListKnowledgeBases, { accountId }) as Promise<KbRow[]>,
        invokeRenderer(IPCChannels.Email.ListKnowledgeBases, { accountId: "all" }) as Promise<KbRow[]>,
      ])
      setRows(scoped)
      setAllKbs(global)
    } catch (e) {
      console.error(e)
      toast.error("Wissensbasen konnten nicht geladen werden.")
      setRows([])
      setAllKbs([])
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const slotKb = (context: KnowledgeContext): KbRow | undefined =>
    rows.find(
      (kb) =>
        kb.knowledge_context === context
        && accountIdsMatch(kb.account_id, accountId),
    )
    ?? rows.find(
      (kb) =>
        kb.override_key === slotOverrideKey(context)
        && accountIdsMatch(kb.account_id, accountId),
    )

  const globalFallback = (context: KnowledgeContext): KbRow | undefined =>
    rows.find(
      (kb) =>
        kb.knowledge_context === context
        && (kb.account_id == null || kb.account_id === 0),
    )

  const assignableKbs = useMemo(() => {
    return allKbs.filter((kb) => kb.account_id == null || kb.account_id === 0)
  }, [allKbs])

  const createSlot = async (context: KnowledgeContext) => {
    if (slotKb(context)) {
      toast.info(`${KNOWLEDGE_CONTEXT_LABELS[context]} ist für dieses Konto bereits konfiguriert.`)
      return
    }
    const name = (newNames[context] ?? KNOWLEDGE_CONTEXT_LABELS[context]).trim()
    if (!name) {
      toast.error("Bitte einen Namen für die Wissensbasis eingeben.")
      return
    }
    setCreating(context)
    try {
      const r = (await invokeRenderer(IPCChannels.Email.CreateKnowledgeBase, {
        name,
        accountId,
        knowledgeContext: context,
      })) as { success: boolean; id?: number; error?: string }
      if (r && "success" in r && r.success === false) {
        toast.error(r.error ?? "Anlegen fehlgeschlagen.")
        return
      }
      if (r?.id == null || !Number.isFinite(r.id)) {
        toast.error("Anlegen fehlgeschlagen — keine ID vom Server erhalten.")
        return
      }
      toast.success(`${name} angelegt.`)
      setExpandedDocId(r.id)
      await load()
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : "Wissensbasis konnte nicht angelegt werden.")
    } finally {
      setCreating(null)
    }
  }

  const assignExisting = async (context: KnowledgeContext, kbId: number) => {
    const source = allKbs.find((kb) => kb.id === kbId)
    if (!source) {
      toast.error("Ausgewählte Wissensbasis nicht gefunden.")
      return
    }
    if (slotKb(context)) {
      toast.info(`${KNOWLEDGE_CONTEXT_LABELS[context]} ist für dieses Konto bereits konfiguriert.`)
      return
    }
    setAssigning(context)
    try {
      const id = await assignKnowledgeBaseToAccountSlot(source, accountId, context)
      toast.success(`${KNOWLEDGE_CONTEXT_LABELS[context]} zugewiesen.`)
      setExpandedDocId(id)
      await load()
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : "Zuweisung fehlgeschlagen.")
    } finally {
      setAssigning(null)
    }
  }

  const saveKbName = async (kb: KbRow) => {
    const name = (editNames[kb.id] ?? kb.name).trim()
    if (!name) {
      toast.error("Name darf nicht leer sein.")
      return
    }
    setEditingId(kb.id)
    try {
      await invokeRenderer(IPCChannels.Email.UpdateKnowledgeBase, {
        id: kb.id,
        name,
        description: kb.description,
        accountId: kb.account_id ?? accountId,
        knowledgeContext: kb.knowledge_context,
        overrideKey: kb.override_key,
      })
      toast.success("Name aktualisiert.")
      setEditingId(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen.")
    } finally {
      setEditingId(null)
    }
  }

  const removeSlot = async (kb: KbRow) => {
    if (!window.confirm(`Wissensbasis „${kb.name}" für dieses Konto wirklich entfernen?`)) return
    setRemoving(kb.id)
    try {
      await resetKnowledgeBaseAccountOverride(kb.id)
      if (expandedDocId === kb.id) setExpandedDocId(null)
      toast.success("Wissensbasis-Zuweisung entfernt.")
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Entfernen fehlgeschlagen.")
    } finally {
      setRemoving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Lade Wissens-Kontexte…
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
      <div>
        <h4 className="text-sm font-semibold">Wissensbasis pro Kontext</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Pro Postfach können eingehende, ausgehende und allgemeine Firmeninfos getrennt hinterlegt
          werden. Inhalt direkt hier bearbeiten oder eine bestehende Wissensbasis zuweisen.
        </p>
      </div>
      <div className="space-y-3">
        {KNOWLEDGE_CONTEXTS.map((context) => {
          const assigned = slotKb(context)
          const fallback = globalFallback(context)
          const active = assigned ?? fallback
          return (
            <div
              key={context}
              className="rounded-md border bg-background/80 p-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-sm">{KNOWLEDGE_CONTEXT_LABELS[context]}</Label>
                    {assigned ? (
                      <Badge variant="outline">Konto</Badge>
                    ) : fallback ? (
                      <Badge variant="secondary">Global-Fallback</Badge>
                    ) : (
                      <Badge variant="destructive">Nicht konfiguriert</Badge>
                    )}
                  </div>
                  {assigned ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="h-8 max-w-xs text-xs"
                        value={editNames[assigned.id] ?? assigned.name}
                        onChange={(e) =>
                          setEditNames((prev) => ({ ...prev, [assigned.id]: e.target.value }))
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        disabled={editingId === assigned.id}
                        onClick={() => void saveKbName(assigned)}
                      >
                        {editingId === assigned.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Name speichern"
                        )}
                      </Button>
                    </div>
                  ) : (
                    <p className="truncate text-xs text-muted-foreground">
                      {active ? active.name : "Noch keine Wissensbasis für diesen Kontext."}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {!assigned ? (
                    <>
                      <Input
                        className="h-8 w-[160px] text-xs"
                        placeholder={`Name (${KNOWLEDGE_CONTEXT_LABELS[context]})`}
                        value={newNames[context] ?? ""}
                        onChange={(e) =>
                          setNewNames((prev) => ({ ...prev, [context]: e.target.value }))
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={creating === context || assigning === context}
                        onClick={() => void createSlot(context)}
                      >
                        {creating === context ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="mr-1 h-3.5 w-3.5" />
                        )}
                        Neu anlegen
                      </Button>
                      {assignableKbs.length > 0 ? (
                        <Select
                          value={ASSIGN_PLACEHOLDER}
                          disabled={assigning === context}
                          onValueChange={(v) => {
                            if (v === ASSIGN_PLACEHOLDER) return
                            void assignExisting(context, Number(v))
                          }}
                        >
                          <SelectTrigger className="h-8 w-[200px] text-xs">
                            <SelectValue placeholder="Bestehende zuweisen…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ASSIGN_PLACEHOLDER} disabled>
                              Bestehende zuweisen…
                            </SelectItem>
                            {assignableKbs.map((kb) => (
                              <SelectItem key={kb.id} value={String(kb.id)}>
                                {kb.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() =>
                          setExpandedDocId((id) => (id === assigned.id ? null : assigned.id))
                        }
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        {expandedDocId === assigned.id ? "Editor schließen" : "Inhalt bearbeiten"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="h-8 text-xs"
                        disabled={removing === assigned.id}
                        onClick={() => void removeSlot(assigned)}
                      >
                        {removing === assigned.id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                        )}
                        Entfernen
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {assigned && expandedDocId === assigned.id ? (
                <SlotDocumentEditor knowledgeBaseId={assigned.id} onSaved={() => void load()} />
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
