/**
 * Zentrale Quelle für Workflow-Variablen: Basis-Kontext (immer verfügbar)
 * plus graph-sensitive Vorschläge aus den `outputs`-Deklarationen der
 * vorgelagerten Knoten (Rückwärts-Suche über die Kanten).
 *
 * Genutzt vom Variablen-Picker im Eigenschaften-Panel und vom
 * Referenz-Dialog (statt einer handgepflegten Liste).
 */

import type { WorkflowNodeCatalogEntry } from './workflow-types';

export type WorkflowVariableInfo = {
  name: string;
  label: string;
  description?: string;
  example?: string;
  type: 'string' | 'number' | 'boolean';
  /** Woher kommt die Variable? 'context' = immer da; sonst Label des Quell-Knotens. */
  source: string;
  /** Node-ID des Quell-Knotens (nur bei Upstream-Vorschlägen). */
  sourceNodeId?: string;
};

/** Immer verfügbare Kontext-Variablen (aus electron/workflow/context.ts). */
export const BASE_CONTEXT_VARIABLES: WorkflowVariableInfo[] = [
  { name: 'subject', label: 'Betreff', example: 'Frage zu Bestellung 1234', type: 'string', source: 'context' },
  { name: 'body_text', label: 'Mail-Text', type: 'string', source: 'context' },
  { name: 'snippet', label: 'Text-Vorschau', type: 'string', source: 'context' },
  { name: 'from_address', label: 'Absender-Adresse(n)', example: 'kunde@firma.de', type: 'string', source: 'context' },
  { name: 'to_address', label: 'Empfänger-Adresse(n)', type: 'string', source: 'context' },
  { name: 'cc_address', label: 'CC-Adresse(n)', type: 'string', source: 'context' },
  { name: 'combined_text', label: 'Gesamter Mail-Kontext (Betreff + Text + Adressen)', type: 'string', source: 'context' },
  { name: 'text', label: 'Kurzform für combined_text (in {{text}})', type: 'string', source: 'context' },
  { name: 'has_attachments', label: 'Hat Anhänge?', example: 'true', type: 'string', source: 'context' },
  { name: 'attachment_names', label: 'Anhang-Dateinamen (kommagetrennt)', example: 'rechnung.pdf', type: 'string', source: 'context' },
  { name: 'attachment_types', label: 'Anhang-Typen', example: 'application/pdf', type: 'string', source: 'context' },
  { name: 'customer.id', label: 'Kunden-Nummer (falls verknüpft)', type: 'number', source: 'context' },
  { name: 'customer.name', label: 'Kunden-Name (falls verknüpft)', example: 'Meier GmbH', type: 'string', source: 'context' },
  { name: 'customer.email', label: 'Kunden-E-Mail (falls verknüpft)', type: 'string', source: 'context' },
  { name: 'auth.spf', label: 'SPF-Prüfergebnis (nach Sync)', example: 'pass', type: 'string', source: 'context' },
  { name: 'auth.dkim', label: 'DKIM-Prüfergebnis', example: 'pass', type: 'string', source: 'context' },
  { name: 'auth.dmarc', label: 'DMARC-Prüfergebnis', example: 'fail', type: 'string', source: 'context' },
  { name: 'auth.arc', label: 'ARC-Prüfergebnis', type: 'string', source: 'context' },
  { name: 'spam.score', label: 'Lokaler Spam-Score (falls berechnet)', example: '75', type: 'number', source: 'context' },
  { name: 'spam.status', label: 'Spam-Status', example: 'review', type: 'string', source: 'context' },
  { name: 'outbound.attachment_count', label: 'Anzahl Anhänge (beim Versand)', example: '1', type: 'number', source: 'context' },
  { name: 'loop.item', label: 'Aktuelles Element (nur innerhalb einer Schleife)', type: 'string', source: 'context' },
  { name: 'loop.index', label: 'Aktuelle Position in der Schleife (0-basiert)', type: 'number', source: 'context' },
];

/** Minimale Graph-Sicht, damit dieses Modul UI-agnostisch bleibt. */
export type VariableGraphNode = {
  id: string;
  /** Registry-Knotentyp (z. B. 'ai.classify'); null für Trigger/Bedingung/Legacy. */
  nodeType: string | null;
  config?: Record<string, unknown>;
};

export type VariableGraphEdge = { source: string; target: string };

/**
 * Variablen, die Knoten VOR `nodeId` laut Katalog-`outputs` setzen.
 * Rückwärts-BFS über die Kanten; `dynamicFromField` löst den tatsächlichen
 * Namen aus der Knoten-Config auf (z. B. logic.set_variable.name).
 */
export function collectUpstreamVariables(
  nodes: readonly VariableGraphNode[],
  edges: readonly VariableGraphEdge[],
  nodeId: string,
  catalogByType: ReadonlyMap<string, WorkflowNodeCatalogEntry>,
): WorkflowVariableInfo[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    const list = incoming.get(e.target);
    if (list) list.push(e.source);
    else incoming.set(e.target, [e.source]);
  }

  const visited = new Set<string>([nodeId]);
  const queue = [...(incoming.get(nodeId) ?? [])];
  const result: WorkflowVariableInfo[] = [];
  const seenNames = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...(incoming.get(id) ?? []));

    const node = nodeById.get(id);
    if (!node?.nodeType) continue;
    const entry = catalogByType.get(node.nodeType);
    if (!entry?.outputs) continue;

    for (const out of entry.outputs) {
      let name = out.name;
      if (out.dynamicFromField) {
        const raw = node.config?.[out.dynamicFromField];
        const dynamic = typeof raw === 'string' ? raw.trim() : '';
        if (dynamic) name = dynamic;
      }
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      result.push({
        name,
        label: out.label,
        ...(out.description === undefined ? {} : { description: out.description }),
        ...(out.example === undefined ? {} : { example: out.example }),
        type: out.type,
        source: entry.label,
        sourceNodeId: id,
      });
    }
  }

  return result;
}

/** Basis + Upstream, Upstream zuerst (relevanter für den konkreten Knoten). */
export function collectAvailableVariables(
  nodes: readonly VariableGraphNode[],
  edges: readonly VariableGraphEdge[],
  nodeId: string,
  catalogByType: ReadonlyMap<string, WorkflowNodeCatalogEntry>,
): WorkflowVariableInfo[] {
  const upstream = collectUpstreamVariables(nodes, edges, nodeId, catalogByType);
  const upstreamNames = new Set(upstream.map((v) => v.name));
  return [...upstream, ...BASE_CONTEXT_VARIABLES.filter((v) => !upstreamNames.has(v.name))];
}
