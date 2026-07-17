"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Check, Loader2, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  getRendererTransport,
  invokeRenderer,
  isMailComposeAuxDataRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import type { CannedResponse } from "../types"
import {
  AccountScopeToolbar,
  ScopeBadge,
  listPayloadForScope,
  mutationScopeFields,
  mutationScopeFieldsForRow,
  type AccountScopeValue,
} from "./account-scope-toolbar"
import { AccountOverrideActions } from "./account-override-actions"
import {
  createCannedAccountOverride,
  resetCannedAccountOverride,
} from "./account-override-mutations"

type Draft = { title: string; body: string }
type SaveState = "idle" | "saving" | "saved"

const AUTOSAVE_DEBOUNCE_MS = 800

export function CannedPanel() {
  const [items, setItems] = useState<CannedResponse[]>([])
  const [scope, setScope] = useState<AccountScopeValue>("all")
  const [search, setSearch] = useState("")
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [saveState, setSaveState] = useState<Record<number, SaveState>>({})
  const [loadError, setLoadError] = useState<string | null>(null)

  // Refs so the debounced/unmount flush always sees the latest values.
  const itemsRef = useRef<CannedResponse[]>(items)
  itemsRef.current = items
  const draftsRef = useRef<Record<number, Draft>>(drafts)
  draftsRef.current = drafts
  const scopeRef = useRef<AccountScopeValue>(scope)
  scopeRef.current = scope
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const load = useCallback(async () => {
    try {
      const rows = (await invokeRenderer(
        IPCChannels.Email.ListCannedResponses,
        listPayloadForScope(scope),
      )) as CannedResponse[]
      setLoadError(null)
      setItems(rows)
      // Seed controlled drafts, preserving any that the user is mid-editing.
      setDrafts((current) => {
        const next: Record<number, Draft> = {}
        for (const row of rows) {
          next[row.id] = current[row.id] ?? { title: row.title, body: row.body }
        }
        return next
      })
    } catch (e) {
      // Surface the failure instead of silently showing the "no entries" state.
      setLoadError(e instanceof Error ? e.message : "Textbausteine konnten nicht geladen werden.")
    }
  }, [scope])

  const persist = useCallback(async (id: number) => {
    const row = itemsRef.current.find((r) => r.id === id)
    const draft = draftsRef.current[id]
    if (!row || !draft) return
    setSaveState((s) => ({ ...s, [id]: "saving" }))
    try {
      await invokeRenderer(IPCChannels.Email.SaveCannedResponse, {
        id,
        title: draft.title,
        body: draft.body,
        ...mutationScopeFieldsForRow(scopeRef.current, row, row.override_key),
      })
      setSaveState((s) => ({ ...s, [id]: "saved" }))
    } catch (e) {
      setSaveState((s) => ({ ...s, [id]: "idle" }))
      toast.error(e instanceof Error ? e.message : "Textbaustein konnte nicht gespeichert werden.")
    }
  }, [])

  const scheduleSave = useCallback((id: number) => {
    const timers = timersRef.current
    const existing = timers.get(id)
    if (existing) clearTimeout(existing)
    setSaveState((s) => ({ ...s, [id]: "saving" }))
    timers.set(id, setTimeout(() => {
      timers.delete(id)
      void persist(id)
    }, AUTOSAVE_DEBOUNCE_MS))
  }, [persist])

  const flush = useCallback((id: number) => {
    const timers = timersRef.current
    const existing = timers.get(id)
    if (!existing) return
    clearTimeout(existing)
    timers.delete(id)
    void persist(id)
  }, [persist])

  const onEdit = useCallback((id: number, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }))
    scheduleSave(id)
  }, [scheduleSave])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (getRendererTransport().kind !== "http") return
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (isMailComposeAuxDataRefreshEvent(event)) void load()
      },
    })
    return () => subscription.unsubscribe()
  }, [load])

  // Flush any pending autosaves when the panel unmounts.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const [id, timer] of timers) {
        clearTimeout(timer)
        void persist(id)
      }
      timers.clear()
    }
  }, [persist])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = needle
      ? items.filter((c) => {
        const draft = drafts[c.id]
        const title = (draft?.title ?? c.title).toLowerCase()
        const body = (draft?.body ?? c.body).toLowerCase()
        return title.includes(needle) || body.includes(needle)
      })
      : items
    return [...filtered].sort((a, b) => {
      const at = (drafts[a.id]?.title ?? a.title)
      const bt = (drafts[b.id]?.title ?? b.title)
      return at.localeCompare(bt, "de", { sensitivity: "base" })
    })
  }, [items, drafts, search])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Textbausteine</h3>
        <p className="text-sm text-muted-foreground">
          Vorlagen für wiederkehrende Antworten. Änderungen werden automatisch gespeichert. Platzhalter:{" "}
          <code className="text-[10px]">{"{{customer.name}}"}</code>,{" "}
          <code className="text-[10px]">{"{{customer.firstName}}"}</code>,{" "}
          <code className="text-[10px]">{"{{customer.email}}"}</code>,{" "}
          <code className="text-[10px]">{"{{account.display_name}}"}</code>,{" "}
          <code className="text-[10px]">{"{{user.publicName}}"}</code>
        </p>
      </div>

      <AccountScopeToolbar value={scope} onChange={setScope} />

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Textbausteine durchsuchen…"
          className="h-9 pl-8"
        />
      </div>

      {loadError ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-destructive">{loadError}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Erneut versuchen
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        {!loadError && visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {search.trim() ? "Keine Treffer." : "Noch keine Textbausteine angelegt."}
          </p>
        ) : null}
        {visible.map((c) => {
          const draft = drafts[c.id] ?? { title: c.title, body: c.body }
          const state = saveState[c.id] ?? "idle"
          return (
            <div key={c.id} className="space-y-2 rounded border p-3">
              <div className="flex items-center gap-2">
                <ScopeBadge row={c} />
                {c.override_key ? (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {c.override_key}
                  </Badge>
                ) : null}
                <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                  {state === "saving" ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> Speichern…
                    </>
                  ) : state === "saved" ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> Gespeichert
                    </>
                  ) : null}
                </span>
              </div>
              <Input
                value={draft.title}
                onChange={(e) => onEdit(c.id, { title: e.target.value })}
                onBlur={() => flush(c.id)}
              />
              <Textarea
                value={draft.body}
                onChange={(e) => onEdit(c.id, { body: e.target.value })}
                onBlur={() => flush(c.id)}
                className="min-h-[80px] font-mono text-sm"
              />
              <AccountOverrideActions
                row={c}
                scope={scope}
                onCreateOverride={async (row, accountId) => {
                  await createCannedAccountOverride(c, accountId)
                  toast.success("Konto-Override angelegt.")
                  await load()
                }}
                onResetOverride={async (row) => {
                  await resetCannedAccountOverride(row.id)
                  toast.success("Auf globalen Eintrag zurückgesetzt.")
                  await load()
                }}
              />
            </div>
          )
        })}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await invokeRenderer(IPCChannels.Email.SaveCannedResponse, {
              title: "Neuer Textbaustein",
              body: "Hallo {{customer.firstName}},\n\n",
              ...mutationScopeFields(scope),
            })
            await load()
            toast.success("Textbaustein angelegt.")
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Anlegen fehlgeschlagen.")
          }
        }}
      >
        <Plus className="mr-1 h-4 w-4" />
        Neuer Textbaustein
      </Button>
    </div>
  )
}
