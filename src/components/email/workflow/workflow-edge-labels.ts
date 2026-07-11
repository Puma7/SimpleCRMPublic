import type { WorkflowNodePortSchema } from "@shared/workflow-node-schema"
import { getCachedWorkflowNodeCatalogEntry } from "./use-workflow-node-catalog"

type EdgeSourceNode = {
  type?: string
  data?: unknown
}

// Fallback, solange der Katalog (IPC) noch nicht geladen ist oder der Fetch
// fehlschlug: der Canvas rendert diese Handles (sonst würden bestehende
// Kanten mit benannten sourceHandles detachen) — und die Label-Helfer unten
// MÜSSEN dieselben Ports kennen, sonst bekommt eine neue Kante aus einem
// Fallback-Handle kein Label und der Zweig läuft nie (pickEdge matcht Labels).
export const FALLBACK_PORTS: Record<string, WorkflowNodePortSchema[]> = {
  "email.sender_filter": [
    { id: "whitelist", label: "Vertrauenswürdig", kind: "branch" },
    { id: "blacklist", label: "Blockiert", kind: "branch" },
    { id: "default", label: "Unbekannt", kind: "branch" },
  ],
  "logic.threshold": [
    { id: "yes", label: "Ja", kind: "branch" },
    { id: "no", label: "Nein", kind: "branch" },
  ],
  "email.auto_reply": [
    { id: "approved", label: "Erlaubt", kind: "branch" },
    { id: "blocked", label: "Blockiert", kind: "branch" },
  ],
  "email.auth_check": [
    { id: "pass", label: "Bestanden", kind: "branch" },
    { id: "fail", label: "Nicht bestanden", kind: "branch" },
    { id: "none", label: "Keine Prüfung", kind: "branch" },
    { id: "default", label: "Sonstiges", kind: "branch" },
  ],
  "ai.review_draft": [
    { id: "send", label: "Senden", kind: "branch" },
    { id: "hold", label: "Prüfen", kind: "branch" },
  ],
}

/** Deklarierte Schema-Ports, sonst die Canvas-Fallback-Ports (vor Katalog-Fetch). */
function portsForSource(nt: string | undefined): WorkflowNodePortSchema[] | undefined {
  const fromCatalog = getCachedWorkflowNodeCatalogEntry(nt)?.ports
  if (fromCatalog?.length) return fromCatalog
  const fallback = nt ? FALLBACK_PORTS[nt] : undefined
  return fallback?.length ? fallback : undefined
}

type EdgeLike = {
  source: string
  label?: unknown
}

export type WorkflowEdgeLabelOptions = {
  restricted: boolean
  labels: string[]
}

export function parseSwitchCases(raw: unknown): string[] {
  const seen = new Set<string>()
  const cases = String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return cases.filter((item) => {
    if (seen.has(item)) return false
    seen.add(item)
    return true
  })
}

export function stringifySwitchCases(cases: readonly string[]): string {
  return parseSwitchCases(cases.join(",")).join(",")
}

export function switchCaseHandles(config: Record<string, unknown> | undefined): string[] {
  const cases = parseSwitchCases(config?.cases ?? "A,B,C")
  return [...cases, "default"]
}

function registryTypeOf(source: EdgeSourceNode | null | undefined): string | undefined {
  if (source?.type !== "registry") return undefined
  const data = source.data as { nodeType?: string; registryType?: string } | undefined
  return data?.nodeType ?? data?.registryType
}

export function edgeLabelOptionsForSource(
  source: EdgeSourceNode | null | undefined,
): WorkflowEdgeLabelOptions {
  if (source?.type === "condition") {
    return { restricted: true, labels: ["ja", "nein"] }
  }
  const nt = registryTypeOf(source)
  if (nt === "logic.switch") {
    // Dynamische Cases — kommen aus der Config, nicht aus dem Schema.
    const config = (source?.data as { config?: Record<string, unknown> } | undefined)?.config
    return { restricted: true, labels: switchCaseHandles(config) }
  }
  // Deklarierte Schema-Ports haben Vorrang (Quelle der Wahrheit inkl.
  // Synonyme); vor dem ersten Katalog-Fetch decken die FALLBACK_PORTS
  // exakt die Handles ab, die der Canvas als Fallback rendert.
  const ports = portsForSource(nt)
  if (ports?.length) {
    return { restricted: true, labels: ports.map((p) => p.id) }
  }
  if (nt === "logic.loop") {
    return { restricted: true, labels: ["each", "done"] }
  }
  if (nt === "email.sender_filter") {
    return { restricted: true, labels: ["whitelist", "blacklist", "default"] }
  }
  if (nt === "returns.evaluate") {
    // Must cover every port the server can emit: the four outcomes
    // (incl. "keep" via defaultOutcome) plus needs_review and no_return.
    return {
      restricted: true,
      labels: ["refund", "exchange", "credit", "keep", "needs_review", "no_return"],
    }
  }
  if (nt === "logic.threshold") {
    return { restricted: true, labels: ["yes", "no"] }
  }
  return { restricted: false, labels: [] }
}

export function normalizeEdgeLabelForSource(
  source: EdgeSourceNode | null | undefined,
  label: unknown,
): string {
  const raw = String(label ?? "").trim()
  if (!raw) return ""
  if (source?.type === "condition") {
    const l = raw.toLowerCase()
    if (["nein", "no", "false"].includes(l)) return "nein"
    if (["ja", "yes", "true"].includes(l)) return "ja"
    return l
  }
  const nt = registryTypeOf(source)
  const l = raw.toLowerCase()
  if (nt === "logic.switch") return l
  // Schema-Ports zuerst (Quelle der Wahrheit inkl. Synonyme); vor dem
  // Katalog-Fetch die Canvas-Fallback-Ports.
  const ports = portsForSource(nt)
  if (ports?.length) {
    // Synonyme (de/en) und Labels auf die Port-ID normalisieren.
    for (const port of ports) {
      if (port.id.toLowerCase() === l) return port.id
      if (port.label.toLowerCase() === l) return port.id
      if ((port.synonyms ?? []).some((s) => s.toLowerCase() === l)) return port.id
    }
    return l
  }
  if (nt === "logic.loop") {
    if (["done", "fertig", "end"].includes(l)) return "done"
    if (["each", "je", "loop"].includes(l)) return "each"
    return l
  }
  if (nt === "logic.threshold") {
    if (["no", "nein", "false"].includes(l)) return "no"
    if (["yes", "ja", "true"].includes(l)) return "yes"
    return l
  }
  if (nt === "email.sender_filter" || nt === "returns.evaluate") return l
  return raw
}

export function isEdgeLabelValidForSource(
  source: EdgeSourceNode | null | undefined,
  label: unknown,
): boolean {
  const options = edgeLabelOptionsForSource(source)
  if (!options.restricted) return true
  const normalized = normalizeEdgeLabelForSource(source, label)
  return options.labels.includes(normalized)
}

export function edgeSourceHandleFromLabel(
  label: unknown,
  source: EdgeSourceNode | null | undefined,
): string | undefined {
  const normalized = normalizeEdgeLabelForSource(source, label)
  if (!normalized) return undefined
  if (source?.type === "condition") {
    if (normalized === "nein") return "no"
    if (normalized === "ja") return "yes"
  }
  const nt = registryTypeOf(source)
  // Schema-Ports zuerst — vor dem Katalog-Fetch die Canvas-Fallback-Ports.
  const ports = portsForSource(nt)
  if (nt !== "logic.switch" && ports?.length) {
    return ports.some((p) => p.id === normalized) ? normalized : undefined
  }
  if (nt === "logic.loop") {
    if (normalized === "done") return "done"
    if (normalized === "each") return "each"
  }
  if (nt === "logic.threshold") {
    if (normalized === "no") return "no"
    if (normalized === "yes") return "yes"
  }
  if (nt === "email.sender_filter") return normalized
  if (nt === "logic.switch" || nt === "returns.evaluate") {
    return isEdgeLabelValidForSource(source, normalized) ? normalized : undefined
  }
  return undefined
}

export function defaultLabelForConnection(
  source: EdgeSourceNode | null | undefined,
  sourceHandle: string | null | undefined,
  edges: readonly EdgeLike[],
  sourceId: string | null | undefined,
): string | undefined {
  if (source?.type === "condition") {
    if (sourceHandle === "no") return "nein"
    if (sourceHandle === "yes") return "ja"
    const existing = edges.filter((e) => e.source === sourceId)
    return existing.length === 0 ? "ja" : "nein"
  }
  const options = edgeLabelOptionsForSource(source)
  if (options.restricted && sourceHandle) {
    const normalized = normalizeEdgeLabelForSource(source, sourceHandle)
    if (options.labels.includes(normalized)) return normalized
  }
  if (registryTypeOf(source) === "logic.threshold") {
    return sourceHandle === "no" ? "no" : "yes"
  }
  return undefined
}
