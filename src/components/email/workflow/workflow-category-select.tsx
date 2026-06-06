"use client"

import { useEffect, useMemo, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import type { CategoryRow } from "../types"
import { invokeRenderer } from "@/services/transport"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const CUSTOM_VALUE = "__custom_path__"

type Props = {
  path: string
  categorySourceSqliteId?: number
  onChange: (next: { path: string; categorySourceSqliteId?: number }) => void
}

function buildFullPath(byId: Map<number, CategoryRow>, category: CategoryRow): string {
  const parts: string[] = []
  const seen = new Set<number>()
  let current: CategoryRow | undefined = category
  // Bounded by the cycle guard; categories are at most a few levels deep.
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    parts.unshift(current.name)
    current = current.parent_id == null ? undefined : byId.get(current.parent_id)
  }
  return parts.join("/")
}

/**
 * Category picker for the "Kategorie setzen" workflow node. Lists existing
 * categories (full path) and stores a stable `source_sqlite_id` reference so the
 * workflow survives renames; falls back to a free-text path for power users and
 * for the local (non-server) edition where no stable id is exposed.
 */
export function WorkflowCategorySelect({ path, categorySourceSqliteId, onChange }: Props) {
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [custom, setCustom] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const rows = (await invokeRenderer(IPCChannels.Email.ListCategories)) as CategoryRow[]
        if (active) setCategories(Array.isArray(rows) ? rows : [])
      } catch {
        if (active) setCategories([])
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const options = useMemo(
    () =>
      categories
        .map((c) => ({ id: c.id, sourceSqliteId: c.source_sqlite_id, fullPath: buildFullPath(byId, c) }))
        .sort((a, b) => a.fullPath.localeCompare(b.fullPath)),
    [categories, byId],
  )

  const matched = useMemo(() => {
    if (categorySourceSqliteId != null) {
      const bySource = options.find((o) => o.sourceSqliteId === categorySourceSqliteId)
      if (bySource) return bySource
    }
    if (path) return options.find((o) => o.fullPath === path)
    return undefined
  }, [options, categorySourceSqliteId, path])

  // Drop into custom mode when a configured path matches no existing category
  // (e.g. a hand-typed path or a deleted category) so it stays visible/editable.
  const effectiveCustom = custom || (!matched && path !== "")
  const selectValue = effectiveCustom ? CUSTOM_VALUE : matched ? String(matched.id) : ""

  const onSelect = (value: string) => {
    if (value === CUSTOM_VALUE) {
      setCustom(true)
      onChange({ path, categorySourceSqliteId: undefined })
      return
    }
    setCustom(false)
    const option = options.find((o) => String(o.id) === value)
    if (option) onChange({ path: option.fullPath, categorySourceSqliteId: option.sourceSqliteId })
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Kategorie</Label>
      <Select value={selectValue} onValueChange={onSelect}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={categories.length ? "Kategorie wählen…" : "Keine Kategorien gefunden"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={String(o.id)}>
              {o.fullPath}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_VALUE}>Eigener Pfad…</SelectItem>
        </SelectContent>
      </Select>
      {effectiveCustom ? (
        <Input
          value={path}
          onChange={(e) => onChange({ path: e.target.value, categorySourceSqliteId: undefined })}
          placeholder="Rechnungen/Unbezahlt"
        />
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {categorySourceSqliteId != null
            ? "Verweist auf die interne Kategorie-ID – übersteht Umbenennen."
            : "Wähle eine Kategorie aus der Liste."}
        </p>
      )}
    </div>
  )
}
