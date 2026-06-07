import type { WorkflowGraphDocument } from './graph-types';
import type { WorkflowTriggerKind } from './trigger-utils';

export type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTriggerKind;
  graph: WorkflowGraphDocument;
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
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
      'Prüft Ton, Inhalt, Anhänge und Betrugs-Antworten vor Versand. BLOCK hält den Entwurf zurück (Banner im Posteingang); OK gibt den Entwurf frei und sendet ihn automatisch über den scheduled-send-Worker.',
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
        // OK-Pfad: Sperre lösen + autoSend = der scheduled-send-Worker greift
        // sofort und schickt den Entwurf raus. reviewOutbound.review erkennt den
        // Approval-Marker und lässt den nächsten Sende-Aufruf durch, statt eine
        // erneute Prüfung einzureihen.
        {
          id: 'release',
          type: 'registry',
          data: { nodeType: 'email.release_outbound', config: { autoSend: true } },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'r1' },
        { id: 'e1', source: 'r1', target: 'release' },
      ],
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
    id: 'inbound-spam-local-engine',
    name: 'Eingehend: Lokale Spam-Engine',
    description:
      'Nutzt den internen spam.score: hoher Score -> Spam, mittlerer Score -> Spam pruefen, darunter bleibt die Mail im Posteingang.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'spam_high',
          type: 'registry',
          data: {
            nodeType: 'logic.threshold',
            config: { variable: 'spam.score', operator: 'gte', value: 75 },
          },
        },
        {
          id: 'set_spam',
          type: 'registry',
          data: {
            nodeType: 'email.set_spam_status',
            config: { status: 'spam', tag: 'auto-spam' },
          },
        },
        {
          id: 'spam_review',
          type: 'registry',
          data: {
            nodeType: 'logic.threshold',
            config: { variable: 'spam.score', operator: 'gte', value: 45 },
          },
        },
        {
          id: 'set_review',
          type: 'registry',
          data: {
            nodeType: 'email.set_spam_status',
            config: { status: 'review', tag: 'spam-review' },
          },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'spam_high' },
        { id: 'e_spam', source: 'spam_high', target: 'set_spam', label: 'yes' },
        { id: 'e_review_check', source: 'spam_high', target: 'spam_review', label: 'no' },
        { id: 'e_review', source: 'spam_review', target: 'set_review', label: 'yes' },
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
  {
    id: 'inbound-invoice-auto-forward',
    name: 'Eingehend: Rechnung weiterleiten (inkl. Anhänge)',
    description:
      'Erkennt Rechnungsmails und leitet sie automatisch an Bank + Buchhaltung weiter — inklusive Anhänge. Empfängeradressen im Knoten anpassen. Achtung: läuft im Servermodus nur, wenn keine Outbound-Workflows aktiv sind.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'c1',
          type: 'condition',
          data: { field: 'combined_text', op: 'regex', value: 'rechnung|invoice|beleg', caseInsensitive: true },
        },
        { id: 'a1', type: 'action', data: { actionType: 'tag', tag: 'rechnung' } },
        {
          id: 'fwd',
          type: 'registry',
          data: {
            nodeType: 'email.forward_copy',
            config: {
              to: 'bank@example.com, buchhaltung@example.com',
              includeAttachments: true,
              runOnEveryInbound: true,
            },
          },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
        { id: 'e2', source: 'a1', target: 'fwd' },
      ],
    } as WorkflowGraphDocument,
  },
  {
    id: 'inbound-ai-auto-reply',
    name: 'Eingehend: KI antwortet vollautomatisch (mit Gate)',
    description:
      'Vollautomatischer Antwort-Loop: KI klassifiziert, Auto-Antwort-Gate prüft Schalter + Confidence + No-Reply-Schutz, KI wählt einen passenden Textbaustein und legt einen adressierten Entwurf an (draft.id), der direkt versendet wird. Für KI-prüft-KI am send-Knoten runOutboundReview=true setzen.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        // (1) Klassifizieren + Confidence setzen.
        {
          id: 'classify',
          type: 'registry',
          data: {
            nodeType: 'ai.classify',
            config: { labels: 'Frage,Bestellstatus,Reklamation,Sonstiges', contextMode: 'metadata' },
          },
        },
        // (2) Auto-Antwort-Gate: nur bei hoher Confidence + kein no-reply-Absender + Schalter aktiv.
        {
          id: 'gate',
          type: 'registry',
          data: {
            nodeType: 'email.auto_reply',
            config: { confidenceVar: 'ai.class_confidence', minConfidence: 80 },
          },
        },
        // (3) KI wählt einen Textbaustein und LEGT EINEN ENTWURF AN — setzt
        //     draft.id als Variable (ai.reply_suggestion macht das NICHT,
        //     daher hier pick_canned).
        {
          id: 'compose',
          type: 'registry',
          data: { nodeType: 'ai.pick_canned', config: { createDraft: true } },
        },
        // (4) Entwurf vollautomatisch versenden — Default ohne erneute Prüfung
        //     (das Gate hat schon gefiltert).
        {
          id: 'send',
          type: 'registry',
          data: {
            nodeType: 'email.send_draft',
            config: { draftIdVariable: 'draft.id', runOutboundReview: false },
          },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'classify' },
        { id: 'e1', source: 'classify', target: 'gate' },
        // Gate hat zwei Ports: 'approved' und 'blocked'. Wir verzweigen nur auf approved.
        { id: 'e2', source: 'gate', target: 'compose', label: 'approved' },
        { id: 'e3', source: 'compose', target: 'send' },
      ],
    } as WorkflowGraphDocument,
  },
  ...ecommerceSupportTemplates(),
];

/**
 * Prefab E-Commerce support routing templates (P1-7). Each detects one of the
 * common customer-service intents via a keyword regex and tags + categorises the
 * mail, so a JTL shop team can activate the standard cases in minutes. Uses only
 * config-free, server-supported nodes (condition + tag + set_category); AI/auto-
 * reply can be layered on top afterwards.
 */
function ecommerceSupportTemplates(): WorkflowTemplate[] {
  const cases: ReadonlyArray<{
    id: string;
    name: string;
    keywords: string;
    tag: string;
    category: string;
  }> = [
    {
      id: 'ecom-where-is-order',
      name: 'E-Commerce: Wo ist meine Bestellung?',
      keywords: 'wo ist|sendung|tracking|versand|paket|lieferstatus|noch nicht angekommen',
      tag: 'versandstatus',
      category: 'Support/Versand',
    },
    {
      id: 'ecom-return',
      name: 'E-Commerce: Retoure / Rücksendung',
      keywords: 'retoure|rücksendung|ruecksendung|zurückschicken|zurueckschicken|widerruf|return',
      tag: 'retoure',
      category: 'Support/Retoure',
    },
    {
      id: 'ecom-defect',
      name: 'E-Commerce: Defekt / Reklamation',
      keywords: 'defekt|kaputt|beschädigt|beschaedigt|reklamation|funktioniert nicht|mangel',
      tag: 'reklamation',
      category: 'Support/Reklamation',
    },
    {
      id: 'ecom-invoice-copy',
      name: 'E-Commerce: Rechnungskopie',
      keywords: 'rechnung|rechnungskopie|beleg|invoice|quittung',
      tag: 'rechnung',
      category: 'Support/Rechnung',
    },
    {
      id: 'ecom-delivery-delay',
      name: 'E-Commerce: Lieferverzug',
      keywords: 'wann kommt|lieferzeit|verspätung|verspaetung|lieferverzug|wie lange dauert',
      tag: 'lieferverzug',
      category: 'Support/Versand',
    },
    {
      id: 'ecom-size-exchange',
      name: 'E-Commerce: Umtausch / Größe',
      keywords: 'umtausch|umtauschen|falsche größe|falsche groesse|andere größe|tausch',
      tag: 'umtausch',
      category: 'Support/Umtausch',
    },
    {
      id: 'ecom-refund',
      name: 'E-Commerce: Rückzahlung',
      keywords: 'rückzahlung|rueckzahlung|erstattung|geld zurück|refund|noch kein geld',
      tag: 'rueckzahlung',
      category: 'Support/Rückzahlung',
    },
    {
      id: 'ecom-availability',
      name: 'E-Commerce: Wieder verfügbar?',
      keywords: 'wieder verfügbar|wieder verfuegbar|ausverkauft|nachbestellung|lieferbar|auf lager',
      tag: 'verfuegbarkeit',
      category: 'Support/Produktfrage',
    },
  ];

  return cases.map(({ id, name, keywords, tag, category }) => ({
    id,
    name,
    description: `Erkennt „${tag}"-Anfragen per Stichwort, taggt sie und legt sie in „${category}".`,
    trigger: 'inbound' as const,
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'c1',
          type: 'condition',
          data: { field: 'combined_text', op: 'regex', value: keywords, caseInsensitive: true },
        },
        { id: 'a1', type: 'action', data: { actionType: 'tag', tag } },
        { id: 'a2', type: 'action', data: { actionType: 'set_category', path: category } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
        { id: 'e2', source: 'a1', target: 'a2' },
      ],
    } as WorkflowGraphDocument,
  }));
}

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
