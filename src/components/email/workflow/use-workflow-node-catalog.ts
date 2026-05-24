"use client"

import { useEffect, useMemo, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import type { WorkflowNodeCatalogEntry } from "@shared/workflow-types"
import { hasElectron, invokeIpc } from "../types"

export function useWorkflowNodeCatalog() {
  const [catalog, setCatalog] = useState<WorkflowNodeCatalogEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!hasElectron()) {
      setLoaded(true)
      return
    }
    void invokeIpc<WorkflowNodeCatalogEntry[]>(IPCChannels.Email.ListWorkflowNodeCatalog)
      .then((entries) => setCatalog(entries))
      .catch(() => setCatalog([]))
      .finally(() => setLoaded(true))
  }, [])

  const labelByType = useMemo(
    () => new Map(catalog.map((e) => [e.type, e.label])),
    [catalog],
  )

  const registryEntries = useMemo(
    () => catalog.filter((c) => c.canvasType === "registry"),
    [catalog],
  )

  return { catalog, labelByType, registryEntries, catalogLoaded: loaded }
}
