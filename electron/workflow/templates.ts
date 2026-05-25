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
    id: 'outbound-quality-check',
    name: 'Ausgehend: KI-Qualitätsprüfung',
    description:
      'Prüft Ton, Inhalt, Anhänge und Betrugs-Antworten vor Versand. Blockierte Entwürfe erscheinen im Posteingang mit Hinweis.',
    trigger: 'outbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        {
          id: 'r1',
          type: 'registry',
          data: {
            nodeType: 'ai.outbound_review',
            config: { promptId: 0, checkReplyContext: true },
          },
        },
      ],
      edges: [{ id: 'e0', source: 't1', target: 'r1' }],
    } as WorkflowGraphDocument,
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
    id: 'inbound-spam-ai',
    name: 'Eingehend: KI-Spam-Pipeline (DSGVO)',
    description:
      'Absender-Filter (Whitelist/Blacklist/PayPal/Amazon) → KI-Spam-Score nur Metadaten → Schwellwert → Spam markieren.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'sf1',
          type: 'registry',
          data: { nodeType: 'email.sender_filter', config: { useGlobalLists: true, useBuiltinTrusted: true } },
        },
        {
          id: 'tag_trusted',
          type: 'registry',
          data: { nodeType: 'email.tag', config: { tag: 'pre-filter-trusted' } },
        },
        {
          id: 'spam_bl',
          type: 'registry',
          data: { nodeType: 'email.mark_spam', config: { spam: true, tag: 'blacklist', moveImap: false } },
        },
        {
          id: 'ai_score',
          type: 'registry',
          data: { nodeType: 'ai.spam_score', config: { contextMode: 'metadata' } },
        },
        {
          id: 'th1',
          type: 'registry',
          data: {
            nodeType: 'logic.threshold',
            config: { variable: 'ai.spam_score', operator: 'gte', value: 70, useGlobalThreshold: true },
          },
        },
        {
          id: 'spam_ai',
          type: 'registry',
          data: { nodeType: 'email.mark_spam', config: { spam: true, tag: 'ki-spam', moveImap: false } },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'sf1' },
        { id: 'e_wl', source: 'sf1', target: 'tag_trusted', label: 'whitelist' },
        { id: 'e_bl', source: 'sf1', target: 'spam_bl', label: 'blacklist' },
        { id: 'e_def', source: 'sf1', target: 'ai_score', label: 'default' },
        { id: 'e_ai', source: 'ai_score', target: 'th1' },
        { id: 'e_yes', source: 'th1', target: 'spam_ai', label: 'yes' },
      ],
    } as WorkflowGraphDocument,
  },
  {
    id: 'inbound-invoice-forward',
    name: 'Eingehend: Rechnung weiterleiten',
    description: 'Rechnung erkennen (Betreff/PDF) → Kategorie → Kopie an Buchhaltung.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'c1',
          type: 'condition',
          data: {
            field: 'subject',
            op: 'contains',
            value: 'Rechnung',
            caseInsensitive: true,
          },
        },
        {
          id: 'c2',
          type: 'condition',
          data: {
            field: 'attachment_names',
            op: 'contains',
            value: '.pdf',
            caseInsensitive: true,
          },
        },
        { id: 'a1', type: 'action', data: { actionType: 'tag', tag: 'rechnung' } },
        { id: 'a2', type: 'action', data: { actionType: 'set_category', path: 'Rechnungen' } },
        {
          id: 'fwd',
          type: 'registry',
          data: {
            nodeType: 'email.forward_copy',
            config: { to: 'buchhaltung@example.com' },
          },
        },
        {
          id: 'cls',
          type: 'registry',
          data: {
            nodeType: 'ai.classify',
            config: { labels: 'Rechnung,Support,Vertrieb,Spam', contextMode: 'metadata' },
          },
        },
        {
          id: 'sw1',
          type: 'registry',
          data: { nodeType: 'logic.switch', config: { field: 'ai.class', cases: 'rechnung,support,vertrieb' } },
        },
        {
          id: 'cat_r',
          type: 'action',
          data: { actionType: 'set_category', path: 'Buchhaltung/Rechnungen' },
        },
        {
          id: 'cat_s',
          type: 'action',
          data: { actionType: 'set_category', path: 'Support' },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'c2', label: 'ja' },
        { id: 'e2', source: 'c2', target: 'a1', label: 'ja' },
        { id: 'e3', source: 'a1', target: 'a2' },
        { id: 'e4', source: 'a2', target: 'fwd' },
        { id: 'e5', source: 't1', target: 'cls' },
        { id: 'e6', source: 'cls', target: 'sw1' },
        { id: 'e7', source: 'sw1', target: 'cat_r', label: 'rechnung' },
        { id: 'e8', source: 'sw1', target: 'cat_s', label: 'support' },
      ],
    } as WorkflowGraphDocument,
  },
  {
    id: 'inbound-routing-ki',
    name: 'Eingehend: Themen & Mitarbeiter (KI)',
    description: 'KI-Klassifizierung (Metadaten) → Schalter → Kategorie / Zuweisung.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'cls',
          type: 'registry',
          data: {
            nodeType: 'ai.classify',
            config: { labels: 'Rechnung,Support,Vertrieb,Spam', contextMode: 'metadata' },
          },
        },
        {
          id: 'sw1',
          type: 'registry',
          data: { nodeType: 'logic.switch', config: { field: 'ai.class', cases: 'rechnung,support,vertrieb' } },
        },
        { id: 'cat_r', type: 'action', data: { actionType: 'set_category', path: 'Buchhaltung/Rechnungen' } },
        { id: 'cat_s', type: 'action', data: { actionType: 'set_category', path: 'Support' } },
        {
          id: 'asg',
          type: 'registry',
          data: { nodeType: 'email.assign', config: { teamMemberId: '' } },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'cls' },
        { id: 'e1', source: 'cls', target: 'sw1' },
        { id: 'e2', source: 'sw1', target: 'cat_r', label: 'rechnung' },
        { id: 'e3', source: 'sw1', target: 'cat_s', label: 'support' },
        { id: 'e4', source: 'sw1', target: 'asg', label: 'vertrieb' },
      ],
    } as WorkflowGraphDocument,
  },
  {
    id: 'schedule-inbox-sync',
    name: 'Zeitplan: Postfach sync + Log',
    description:
      'Cron-Workflow: optional IMAP/POP3-Sync des geplanten Kontos, danach Graph-Lauf (z. B. sync.run).',
    trigger: 'schedule',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'schedule' } },
        {
          id: 'sync1',
          type: 'registry',
          data: { nodeType: 'sync.run', config: { scope: 'email_inbox' } },
        },
      ],
      edges: [{ id: 'e0', source: 't1', target: 'sync1' }],
    } as WorkflowGraphDocument,
  },
  {
    id: 'manual-ping-log',
    name: 'Manuell: System-Check',
    description: 'Manueller Trigger für Wartungs- oder Test-Flows (HTTP, Variablen, CRM).',
    trigger: 'manual',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'manual' } },
        {
          id: 'v1',
          type: 'registry',
          data: {
            nodeType: 'logic.set_variable',
            config: { name: 'manual.ran_at', value: '{{schedule.sync_log}}' },
          },
        },
      ],
      edges: [{ id: 'e0', source: 't1', target: 'v1' }],
    } as WorkflowGraphDocument,
  },
  {
    id: 'crm-deal-won-task',
    name: 'CRM: Aufgabe bei Deal gewonnen',
    description: 'Legt Follow-up-Aufgabe an wenn Deal-Phase auf gewonnen wechselt.',
    trigger: 'crm.deal_stage_changed',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'crm.deal_stage_changed' } },
        {
          id: 'c1',
          type: 'condition',
          data: { field: 'combined_text', op: 'contains', value: 'gewonnen', caseInsensitive: true },
        },
        {
          id: 'task1',
          type: 'registry',
          data: {
            nodeType: 'crm.create_task',
            config: { title: 'Deal abschließen', priority: 'high', daysUntilDue: 1 },
          },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'task1', label: 'ja' },
      ],
    } as WorkflowGraphDocument,
  },
  {
    id: 'inbound-newsletter-archive',
    name: 'Eingehend: Newsletter archivieren',
    description: 'Erkennt Newsletter im Betreff und archiviert automatisch.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'c1',
          type: 'condition',
          data: {
            field: 'subject',
            op: 'contains',
            value: 'newsletter',
            caseInsensitive: true,
          },
        },
        { id: 'a1', type: 'action', data: { actionType: 'tag', tag: 'newsletter' } },
        { id: 'a2', type: 'action', data: { actionType: 'archive' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
        { id: 'e2', source: 'a1', target: 'a2' },
      ],
    },
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
