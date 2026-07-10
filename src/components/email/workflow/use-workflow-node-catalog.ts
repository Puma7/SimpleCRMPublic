"use client"

import { useEffect, useMemo, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import type { WorkflowNodeCatalogEntry } from "@shared/workflow-types"
import { getRendererTransport, invokeRenderer } from "@/services/transport"

// Ein Fetch pro Sitzung, geteilt über alle Verwender (Panel, Palette,
// Canvas-Karten, Referenz-Dialog) — die Canvas rendert viele Karten.
let catalogCache: WorkflowNodeCatalogEntry[] | null = null
let catalogPromise: Promise<WorkflowNodeCatalogEntry[]> | null = null

function loadCatalogOnce(): Promise<WorkflowNodeCatalogEntry[]> {
  if (catalogCache) return Promise.resolve(catalogCache)
  if (!catalogPromise) {
    const serverClientMode = getRendererTransport().kind === "http"
    catalogPromise = invokeRenderer(IPCChannels.Email.ListWorkflowNodeCatalog)
      .then((entries) => {
        const all = entries as WorkflowNodeCatalogEntry[]
        // Server-only-Knoten (returns.*, jtl.order_context, …) laufen im
        // Desktop-Interpreter nicht — dort aus Palette/Auswahl fernhalten.
        catalogCache = serverClientMode ? all : all.filter((e) => e.runtime !== "server")
        return catalogCache
      })
      .catch(() => {
        catalogPromise = null
        return []
      })
  }
  return catalogPromise
}

/**
 * Synchroner Zugriff auf den bereits geladenen Katalog (z. B. für die
 * Kantenlabel-Logik). Vor dem ersten Laden: undefined → Aufrufer nutzen
 * ihre Fallbacks.
 */
export function getCachedWorkflowNodeCatalogEntry(
  type: string | undefined,
): WorkflowNodeCatalogEntry | undefined {
  if (!type || !catalogCache) return undefined
  return catalogCache.find((e) => e.type === type)
}

export function useWorkflowNodeCatalog() {
  const [catalog, setCatalog] = useState<WorkflowNodeCatalogEntry[]>(catalogCache ?? [])
  const [loaded, setLoaded] = useState(catalogCache !== null)

  useEffect(() => {
    if (catalogCache) return
    let active = true
    void loadCatalogOnce()
      .then((entries) => {
        if (active) setCatalog(entries)
      })
      .finally(() => {
        if (active) setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  const labelByType = useMemo(
    () => new Map(catalog.map((e) => [e.type, e.label])),
    [catalog],
  )

  const descriptionByType = useMemo(
    () => new Map(catalog.filter((e) => e.description).map((e) => [e.type, e.description ?? ""])),
    [catalog],
  )

  const registryEntries = useMemo(
    () => catalog.filter((c) => c.canvasType === "registry"),
    [catalog],
  )

  return { catalog, labelByType, descriptionByType, registryEntries, catalogLoaded: loaded }
}
