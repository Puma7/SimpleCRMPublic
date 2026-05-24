import type { WorkflowTemplateDto } from '../../shared/workflow-types';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';

export const WORKFLOW_TEMPLATES: WorkflowTemplateDto[] = [
  {
    id: 'inbound-invoice',
    name: 'Eingehend: Rechnung sortieren',
    description: 'Rechnungen erkennen, taggen und in Kategorie Rechnungen legen.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'c1',
          type: 'condition',
          data: { field: 'subject', op: 'contains', value: 'Rechnung', caseInsensitive: true },
        },
        { id: 'a1', type: 'action', data: { actionType: 'tag', tag: 'rechnung' } },
        { id: 'a2', type: 'action', data: { actionType: 'set_category', path: 'Rechnungen' } },
        { id: 'a3', type: 'action', data: { actionType: 'link_customer' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
        { id: 'e2', source: 'a1', target: 'a2' },
        { id: 'e3', source: 'a2', target: 'a3' },
      ],
    },
  },
  {
    id: 'outbound-sensitive',
    name: 'Ausgehend: Sensible Daten',
    description: 'Blockiert IBAN/Passwort-Muster vor dem Versand.',
    trigger: 'outbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        {
          id: 'c1',
          type: 'condition',
          data: { field: 'combined_text', op: 'regex', value: 'IBAN|Passwort|Kontostand', caseInsensitive: true },
        },
        {
          id: 'a1',
          type: 'action',
          data: { actionType: 'hold_outbound', reason: 'Sensible Inhalte erkannt' },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
      ],
    },
  },
  {
    id: 'inbound-attachments',
    name: 'Eingehend: Anhänge markieren',
    description: 'Taggt Nachrichten mit PDF-Anhang.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'c1',
          type: 'condition',
          data: { field: 'has_attachments', op: 'is_true', value: '' },
        },
        {
          id: 'c2',
          type: 'condition',
          data: { field: 'attachment_names', op: 'contains', value: '.pdf', caseInsensitive: true },
        },
        { id: 'a1', type: 'action', data: { actionType: 'tag_attachment_meta', tag: 'pdf' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'c2', label: 'ja' },
        { id: 'e2', source: 'c2', target: 'a1', label: 'ja' },
      ],
    },
  },
  {
    id: 'agent-retoure',
    name: 'KI-Agent: Retouren-Entwurf',
    description: 'Agent mit Wissensbasis erstellt Antwort-Entwurf (manuell senden).',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'c1',
          type: 'condition',
          data: { field: 'combined_text', op: 'contains', value: 'retoure', caseInsensitive: true },
        },
        {
          id: 'a1',
          type: 'registry',
          data: {
            nodeType: 'ai.agent',
            config: {
              systemPrompt: 'Beantworte Retouren-Anfragen freundlich mit Link zur Retourenseite.',
              knowledgeBaseId: null,
              createDraft: true,
            },
          },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
      ],
    } as WorkflowGraphDocument,
  },
  {
    id: 'crm-task-from-mail',
    name: 'CRM: Aufgabe aus E-Mail',
    description: 'Legt Follow-up-Aufgabe an wenn Kunde verknüpft.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'a1', type: 'action', data: { actionType: 'link_customer' } },
        {
          id: 'a2',
          type: 'registry',
          data: {
            nodeType: 'crm.create_task',
            config: { title: 'E-Mail nachverfolgen', priority: 'medium', daysUntilDue: 2 },
          },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'a1' },
        { id: 'e1', source: 'a1', target: 'a2' },
      ],
    } as WorkflowGraphDocument,
  },
];

export function getWorkflowTemplate(id: string): WorkflowTemplateDto | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
