"use client"

import { useEffect, useMemo, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import type { WorkflowNodeCatalogEntry } from "@shared/workflow-types"
import { invokeRenderer } from "@/services/transport"

export function useWorkflowNodeCatalog() {
  const [catalog, setCatalog] = useState<WorkflowNodeCatalogEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void invokeRenderer(IPCChannels.Email.ListWorkflowNodeCatalog)
      .then((entries) => setCatalog(entries as WorkflowNodeCatalogEntry[]))
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
