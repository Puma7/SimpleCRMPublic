"use client"

import { useEffect, useMemo, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import type { WorkflowNodeCatalogEntry } from "@shared/workflow-types"
import { getRendererTransport, invokeRenderer } from "@/services/transport"

export function useWorkflowNodeCatalog() {
  const [catalog, setCatalog] = useState<WorkflowNodeCatalogEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const serverClientMode = getRendererTransport().kind === "http"
    void invokeRenderer(IPCChannels.Email.ListWorkflowNodeCatalog)
      .then((entries) => {
        const all = entries as WorkflowNodeCatalogEntry[]
        // Server-only-Knoten (returns.*, jtl.order_context, …) laufen im
        // Desktop-Interpreter nicht — dort aus Palette/Auswahl fernhalten.
        setCatalog(serverClientMode ? all : all.filter((e) => e.runtime !== "server"))
      })
      .catch(() => setCatalog([]))
      .finally(() => setLoaded(true))
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
