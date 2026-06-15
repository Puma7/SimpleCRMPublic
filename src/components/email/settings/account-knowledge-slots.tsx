"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { assignKnowledgeBaseToAccountSlot } from "./account-override-mutations"

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

export function AccountKnowledgeSlots({ accountId }: Props) {
  const [rows, setRows] = useState<KbRow[]>([])
  const [allKbs, setAllKbs] = useState<KbRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState<KnowledgeContext | null>(null)
  const [assigning, setAssigning] = useState<KnowledgeContext | null>(null)

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
    setCreating(context)
    try {
      const r = (await invokeRenderer(IPCChannels.Email.CreateKnowledgeBase, {
        name: KNOWLEDGE_CONTEXT_LABELS[context],
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
      toast.success(`${KNOWLEDGE_CONTEXT_LABELS[context]} angelegt.`)
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
      await assignKnowledgeBaseToAccountSlot(source, accountId, context)
      toast.success(`${KNOWLEDGE_CONTEXT_LABELS[context]} zugewiesen.`)
      await load()
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : "Zuweisung fehlgeschlagen.")
    } finally {
      setAssigning(null)
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
          werden. Workflow-KI lädt automatisch <strong>Allgemein</strong> plus den passenden Kontext.
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
              className="flex flex-col gap-2 rounded-md border bg-background/80 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
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
                <p className="truncate text-xs text-muted-foreground">
                  {active ? active.name : "Noch keine Wissensbasis für diesen Kontext."}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {!assigned ? (
                  <>
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
                              {kb.knowledge_context
                                ? ` (${KNOWLEDGE_CONTEXT_LABELS[kb.knowledge_context as KnowledgeContext] ?? kb.knowledge_context})`
                                : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </>
                ) : (
                  <Select value={String(assigned.id)} disabled>
                    <SelectTrigger className="h-8 w-[180px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={String(assigned.id)}>{assigned.name}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Inhalt bearbeiten unter <strong>Einstellungen → Wissensbasis</strong> (Filter nach Konto).
      </p>
    </div>
  )
}
