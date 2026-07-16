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
    description:
      'Hält Mails mit IBAN/Passwort-Muster zur Prüfung zurück (Banner im Posteingang); ' +
      'alle übrigen Mails werden freigegeben und automatisch versendet.',
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
        // "nein"-Zweig: kein sensibles Muster → Sperre lösen + autoSend. Ohne
        // diesen Knoten bliebe jede saubere Mail durch die serverseitige
        // Ausgangsprüfung dauerhaft gehalten (fail-closed).
        {
          id: 'release',
          type: 'registry',
          data: { nodeType: 'email.release_outbound', config: { autoSend: true } },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c1' },
        { id: 'e1', source: 'c1', target: 'a1', label: 'ja' },
        { id: 'e2', source: 'c1', target: 'release', label: 'nein' },
      ],
    },
  },
  {
    id: 'outbound-evidence-follow-up',
    name: 'Ausgehend: Ohne Reaktion nachfassen',
    description:
      'Versendet die Mail, wartet zwei Tage und legt nur nach SMTP-Annahme ohne Oeffnung, Linkklick oder Antwort eine Aufgabe an.',
    trigger: 'outbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
        {
          id: 'release',
          type: 'registry',
          data: { nodeType: 'email.release_outbound', config: { autoSend: true } },
        },
        {
          id: 'wait',
          type: 'registry',
          data: { nodeType: 'logic.delay', config: { delaySeconds: 172800 } },
        },
        {
          id: 'evidence',
          type: 'registry',
          data: { nodeType: 'email.read_tracking_evidence', config: {} },
        },
        {
          id: 'tracking_enabled',
          type: 'registry',
          data: { nodeType: 'logic.switch', config: { field: 'tracking.tracked', cases: 'true' } },
        },
        {
          id: 'transport_accepted',
          type: 'registry',
          data: { nodeType: 'logic.switch', config: { field: 'tracking.transport', cases: 'smtp_accepted' } },
        },
        {
          id: 'no_engagement',
          type: 'registry',
          data: { nodeType: 'logic.switch', config: { field: 'tracking.engagement', cases: 'none,automated_fetch' } },
        },
        {
          id: 'no_open',
          type: 'registry',
          data: {
            nodeType: 'logic.threshold',
            config: { variable: 'tracking.probable_open_count', operator: 'lte', value: 0 },
          },
        },
        {
          id: 'no_click',
          type: 'registry',
          data: {
            nodeType: 'logic.threshold',
            config: { variable: 'tracking.probable_click_count', operator: 'lte', value: 0 },
          },
        },
        {
          id: 'reply_state',
          type: 'registry',
          data: { nodeType: 'logic.switch', config: { field: 'tracking.replied', cases: 'false' } },
        },
        {
          id: 'task',
          type: 'registry',
          data: {
            nodeType: 'crm.create_task',
            config: {
              title: 'E-Mail telefonisch nachfassen: {{subject}}',
              priority: 'medium',
              daysUntilDue: 1,
            },
          },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'release' },
        { id: 'e1', source: 'release', target: 'wait' },
        { id: 'e2', source: 'wait', target: 'evidence' },
        { id: 'e3', source: 'evidence', target: 'tracking_enabled' },
        { id: 'e_tracking', source: 'tracking_enabled', target: 'transport_accepted', label: 'true' },
        { id: 'e_transport', source: 'transport_accepted', target: 'no_engagement', label: 'smtp_accepted' },
        { id: 'e_no_engagement', source: 'no_engagement', target: 'no_open', label: 'none' },
        { id: 'e_automated_fetch', source: 'no_engagement', target: 'no_open', label: 'automated_fetch' },
        { id: 'e4', source: 'no_open', target: 'no_click', label: 'yes' },
        { id: 'e5', source: 'no_click', target: 'reply_state', label: 'yes' },
        { id: 'e6', source: 'reply_state', target: 'task', label: 'false' },
      ],
    } as WorkflowGraphDocument,
  },
  {
    id: 'relay-dunning-follow-up',
    name: 'Relay: Mahnung ohne Reaktion nachfassen (empfohlen)',
    description:
      'Für über das SMTP-Relay versendete (getrackte) Mahnungen: Das Relay hat die Mail bereits '
      + 'verschickt, der Workflow wartet 14 Tage (2×7) und legt eine Telefon-Nachfass-Aufgabe an, '
      + 'wenn keine Öffnung, kein Linkklick und keine Antwort registriert wurde. Nur Server-Edition.',
    trigger: 'relay',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'relay' } },
        // KEIN email.release_outbound: Das Relay hat die Mail schon versendet —
        // der Graph startet direkt mit der Wartezeit. Zwei verkettete Delays,
        // weil ein einzelner Delay bei 7 Tagen (604800 s) gedeckelt ist.
        {
          id: 'wait1',
          type: 'registry',
          data: { nodeType: 'logic.delay', config: { delaySeconds: 604800 } },
        },
        {
          id: 'wait2',
          type: 'registry',
          data: { nodeType: 'logic.delay', config: { delaySeconds: 604800 } },
        },
        {
          id: 'evidence',
          type: 'registry',
          data: { nodeType: 'email.read_tracking_evidence', config: {} },
        },
        {
          id: 'tracking_enabled',
          type: 'registry',
          data: { nodeType: 'logic.switch', config: { field: 'tracking.tracked', cases: 'true' } },
        },
        {
          id: 'transport_accepted',
          type: 'registry',
          data: { nodeType: 'logic.switch', config: { field: 'tracking.transport', cases: 'smtp_accepted' } },
        },
        {
          id: 'no_engagement',
          type: 'registry',
          data: { nodeType: 'logic.switch', config: { field: 'tracking.engagement', cases: 'none,automated_fetch' } },
        },
        {
          id: 'no_open',
          type: 'registry',
          data: {
            nodeType: 'logic.threshold',
            config: { variable: 'tracking.probable_open_count', operator: 'lte', value: 0 },
          },
        },
        {
          id: 'no_click',
          type: 'registry',
          data: {
            nodeType: 'logic.threshold',
            config: { variable: 'tracking.probable_click_count', operator: 'lte', value: 0 },
          },
        },
        {
          id: 'reply_state',
          type: 'registry',
          data: { nodeType: 'logic.switch', config: { field: 'tracking.replied', cases: 'false' } },
        },
        {
          id: 'task',
          type: 'registry',
          data: {
            nodeType: 'crm.create_task',
            config: {
              title: 'Mahnung telefonisch nachfassen: {{subject}}',
              priority: 'high',
              daysUntilDue: 1,
            },
          },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'wait1' },
        { id: 'e1', source: 'wait1', target: 'wait2' },
        { id: 'e2', source: 'wait2', target: 'evidence' },
        { id: 'e3', source: 'evidence', target: 'tracking_enabled' },
        { id: 'e_tracking', source: 'tracking_enabled', target: 'transport_accepted', label: 'true' },
        { id: 'e_transport', source: 'transport_accepted', target: 'no_engagement', label: 'smtp_accepted' },
        { id: 'e_no_engagement', source: 'no_engagement', target: 'no_open', label: 'none' },
        { id: 'e_automated_fetch', source: 'no_engagement', target: 'no_open', label: 'automated_fetch' },
        { id: 'e4', source: 'no_open', target: 'no_click', label: 'yes' },
        { id: 'e5', source: 'no_click', target: 'reply_state', label: 'yes' },
        { id: 'e6', source: 'reply_state', target: 'task', label: 'false' },
      ],
    } as WorkflowGraphDocument,
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
    id: 'inbound-rechnung-inbox-forward',
    name: 'Eingehend: rechnung@-Postfach weiterleiten',
    description:
      'Leitet Mails weiter, die an rechnung@ (oder eine andere Empfänger-Adresse) eingehen, an Bank und Buchhaltung. Empfänger-Adresse und Ziele im Bedingungs- bzw. Weiterleiten-Knoten anpassen. Text-only auf Desktop; Anhänge nur Server-Edition.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'c_to',
          type: 'condition',
          data: {
            field: 'to_address',
            op: 'contains',
            value: 'rechnung@',
            caseInsensitive: true,
          },
        },
        { id: 'a_tag', type: 'action', data: { actionType: 'tag', tag: 'rechnung-postfach' } },
        {
          id: 'fwd',
          type: 'registry',
          data: {
            nodeType: 'email.forward_copy',
            config: {
              to: 'bank@example.com, buchhaltung@example.com',
            },
          },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'c_to' },
        { id: 'e1', source: 'c_to', target: 'a_tag', label: 'ja' },
        { id: 'e2', source: 'a_tag', target: 'fwd' },
      ],
    } as WorkflowGraphDocument,
  },
  {
    id: 'inbound-invoice-auto-forward',
    name: 'Eingehend: Rechnung weiterleiten (inkl. Anhänge)',
    description:
      'Erkennt Rechnungsmails (Betreff/Inhalt) und leitet sie an Bank + Buchhaltung weiter. Empfänger im Knoten anpassen. Desktop: Text-Weiterleitung; Anhänge nur Server-Edition.',
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
    name: 'Eingehend: KI antwortet mit Textbaustein (mit Gate)',
    description:
      'KI klassifiziert, das Auto-Antwort-Gate prüft (Schalter, Absender, Sicherheit, Anti-Loop), die KI wählt einen Textbaustein und der Entwurf wird versendet. Blockierte Mails bekommen den Tag ki-manuell. Voraussetzungen: Auto-Antwort-Schalter (Einstellungen → Automatisierung) AN, ein KI-Profil mit API-Schlüssel, mindestens ein Textbaustein.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        // (1) Klassifizieren + Sicherheit (0–100) setzen.
        {
          id: 'classify',
          type: 'registry',
          data: {
            nodeType: 'ai.classify',
            config: { labels: 'Frage,Bestellstatus,Reklamation,Sonstiges', contextMode: 'metadata' },
          },
        },
        // (2) Auto-Antwort-Gate: Schalter + Absender-Schutz + Anti-Loop + Mindest-Sicherheit.
        {
          id: 'gate',
          type: 'registry',
          data: {
            nodeType: 'email.auto_reply',
            config: { confidenceVar: 'ai.class_confidence', minConfidence: 80 },
          },
        },
        // (3a) approved: KI wählt einen Textbaustein und legt einen adressierten
        //      Entwurf an (setzt draft.id).
        {
          id: 'compose',
          type: 'registry',
          data: { nodeType: 'ai.pick_canned', config: { createDraft: true } },
        },
        // (4) Entwurf versenden (das Gate hat schon gefiltert).
        {
          id: 'send',
          type: 'registry',
          data: {
            nodeType: 'email.send_draft',
            config: { draftIdVariable: 'draft.id', runOutboundReview: false },
          },
        },
        // (3b) blocked: NUR bei "KI unsicher" (low_confidence) taggen — bei
        //      ausgeschaltetem Schalter o. Ä. würde sonst jede Mail markiert.
        //      Der Switch (Nicht-default-Fall) erfüllt zudem das Inbound-Gate.
        {
          id: 'blocked_reason',
          type: 'registry',
          data: {
            nodeType: 'logic.switch',
            config: { field: 'auto_reply.blocked_reason', cases: 'low_confidence' },
          },
        },
        {
          id: 'tag_manual',
          type: 'registry',
          data: { nodeType: 'email.tag', config: { tag: 'ki-manuell' } },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'classify' },
        { id: 'e1', source: 'classify', target: 'gate' },
        { id: 'e2', source: 'gate', target: 'compose', label: 'approved' },
        { id: 'e3', source: 'compose', target: 'send' },
        { id: 'e4', source: 'gate', target: 'blocked_reason', label: 'blocked' },
        { id: 'e5', source: 'blocked_reason', target: 'tag_manual', label: 'low_confidence' },
      ],
    } as WorkflowGraphDocument,
  },
  {
    id: 'inbound-ai-two-stage-reply',
    name: 'Eingehend: KI-Antwort mit Gegenprüfung (empfohlen)',
    description:
      'Zwei-Stufen-Antwort: Agent 1 entwirft mit Wissensbasis eine Antwort (Anrede + Signatur automatisch), Agent 2 liest gegen und entscheidet — nur bei „senden" geht die Mail raus, sonst wartet der Entwurf im Posteingang auf menschliche Freigabe. Voraussetzungen: Auto-Antwort-Schalter AN, KI-Profil mit API-Schlüssel; Wissensbasis empfohlen.',
    trigger: 'inbound',
    graph: {
      version: 1,
      nodes: [
        { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
        // (1) Klassifizieren — liefert die Sicherheits-Variable fürs Gate.
        {
          id: 'classify',
          type: 'registry',
          data: {
            nodeType: 'ai.classify',
            config: { labels: 'Frage,Bestellstatus,Reklamation,Sonstiges', contextMode: 'metadata' },
          },
        },
        // (2) Gate: Schalter + No-Reply-/Automaten-Schutz + Tageslimit + Sicherheit.
        {
          id: 'gate',
          type: 'registry',
          data: {
            nodeType: 'email.auto_reply',
            config: { confidenceVar: 'ai.class_confidence', minConfidence: 80 },
          },
        },
        // (3) Agent 1: Antwort entwerfen (Wissensbasis automatisch, Anrede + Signatur).
        {
          id: 'draft',
          type: 'registry',
          data: {
            nodeType: 'ai.draft_reply',
            config: {
              systemPrompt:
                'Du bist ein freundlicher Kundenservice-Mitarbeiter. Beantworte die Kundenmail vollständig, korrekt und auf Deutsch. Nutze die Wissensbasis, wenn vorhanden. Schreibe NUR den Antworttext ohne Anrede und ohne Grußformel — beide werden automatisch ergänzt.',
              knowledgeBaseId: null,
              includeCanned: true,
              greeting: 'auto',
              signature: 'account',
            },
          },
        },
        // (4) Agent 2: Gegenprüfung — im Zweifel wartet der Entwurf auf einen Menschen.
        {
          id: 'review',
          type: 'registry',
          data: {
            nodeType: 'ai.review_draft',
            config: { draftIdVariable: 'draft.id', reviewPrompt: '' },
          },
        },
        // (5a) send: Entwurf versenden.
        {
          id: 'send',
          type: 'registry',
          data: {
            nodeType: 'email.send_draft',
            config: { draftIdVariable: 'draft.id', runOutboundReview: false },
          },
        },
        // (5b) hold: sichtbar machen — Entwurf wartet im Posteingang auf Freigabe.
        {
          id: 'tag_review',
          type: 'registry',
          data: { nodeType: 'email.tag', config: { tag: 'ki-freigabe' } },
        },
        {
          id: 'task_review',
          type: 'registry',
          data: {
            nodeType: 'crm.create_task',
            config: { title: 'KI-Entwurf prüfen: {{subject}}', priority: 'medium', daysUntilDue: 1 },
          },
        },
        // (3b) blocked: NUR bei "KI unsicher" (low_confidence) taggen — bei
        //      ausgeschaltetem Schalter o. Ä. würde sonst jede Mail markiert.
        //      Der Switch (Nicht-default-Fall) erfüllt zudem das Inbound-Gate.
        {
          id: 'blocked_reason',
          type: 'registry',
          data: {
            nodeType: 'logic.switch',
            config: { field: 'auto_reply.blocked_reason', cases: 'low_confidence' },
          },
        },
        {
          id: 'tag_manual',
          type: 'registry',
          data: { nodeType: 'email.tag', config: { tag: 'ki-manuell' } },
        },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'classify' },
        { id: 'e1', source: 'classify', target: 'gate' },
        { id: 'e2', source: 'gate', target: 'draft', label: 'approved' },
        { id: 'e3', source: 'draft', target: 'review' },
        { id: 'e4', source: 'review', target: 'send', label: 'send' },
        { id: 'e5', source: 'review', target: 'tag_review', label: 'hold' },
        { id: 'e6', source: 'tag_review', target: 'task_review' },
        { id: 'e7', source: 'gate', target: 'blocked_reason', label: 'blocked' },
        { id: 'e8', source: 'blocked_reason', target: 'tag_manual', label: 'low_confidence' },
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
