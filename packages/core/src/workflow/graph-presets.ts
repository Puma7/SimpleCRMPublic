import type { WorkflowGraphDocument } from './graph-types';
import type { WorkflowTriggerKind } from './trigger-utils';

export function graphHasRunnableNodes(doc: WorkflowGraphDocument | null): boolean {
  if (!doc) return false;
  return doc.nodes.some((n) => n.type !== 'trigger');
}

/** Leerer modularer Start: nur Trigger, Nutzer baut den Flow aus Einzelknoten. */
export function buildBlankWorkflowGraph(trigger: WorkflowTriggerKind): WorkflowGraphDocument {
  return {
    version: 1,
    nodes: [{ id: 'trigger-1', type: 'trigger', data: { kind: trigger } }],
    edges: [],
  };
}

/** Default eingehend — gleiche Logik wie früher, aber als Graph-Knoten (kein fixes Regelprogramm). */
export function buildDefaultInboundGraph(): WorkflowGraphDocument {
  return {
    version: 1,
    nodes: [
      { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
      {
        id: 'c_amz',
        type: 'condition',
        data: {
          field: 'combined_text',
          op: 'contains',
          value: 'amazon',
          caseInsensitive: true,
        },
      },
      { id: 'a_amz_tag', type: 'action', data: { actionType: 'tag', tag: 'Amazon' } },
      { id: 'a_amz_arc', type: 'action', data: { actionType: 'archive' } },
      {
        id: 'c_nl',
        type: 'condition',
        data: {
          field: 'combined_text',
          op: 'contains',
          value: 'newsletter',
          caseInsensitive: true,
        },
      },
      { id: 'a_nl_tag', type: 'action', data: { actionType: 'tag', tag: 'Newsletter' } },
      { id: 'a_nl_seen', type: 'action', data: { actionType: 'mark_seen' } },
    ],
    edges: [
      { id: 'e0', source: 't1', target: 'c_amz' },
      { id: 'e1', source: 'c_amz', target: 'a_amz_tag', label: 'ja' },
      { id: 'e2', source: 'a_amz_tag', target: 'a_amz_arc' },
      { id: 'e3', source: 't1', target: 'c_nl' },
      { id: 'e4', source: 'c_nl', target: 'a_nl_tag', label: 'ja' },
      { id: 'e5', source: 'a_nl_tag', target: 'a_nl_seen' },
    ],
  };
}

/** Default ausgehend — sensible Daten per Knoten, nicht per JSON-Regelblock. */
export function buildDefaultOutboundGraph(): WorkflowGraphDocument {
  return {
    version: 1,
    nodes: [
      { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
      {
        id: 'c1',
        type: 'condition',
        data: {
          field: 'combined_text',
          op: 'regex',
          value: '\\bIBAN\\b|\\bDE\\d{20}\\b|Kontostand|Passwort\\s*[:\\s]',
          caseInsensitive: true,
        },
      },
      {
        id: 'hold1',
        type: 'action',
        data: {
          actionType: 'hold_outbound',
          reason:
            'Mögliche sensible Daten erkannt (z. B. IBAN, Kontostand, Passwort). Bitte prüfen und ggf. Formulierung anpassen.',
        },
      },
      { id: 'stop1', type: 'action', data: { actionType: 'stop' } },
    ],
    edges: [
      { id: 'e0', source: 't1', target: 'c1' },
      { id: 'e1', source: 'c1', target: 'hold1', label: 'ja' },
      { id: 'e2', source: 'hold1', target: 'stop1' },
    ],
  };
}
