export type WorkflowNodeCategory =
  | 'trigger'
  | 'logic'
  | 'email'
  | 'crm'
  | 'ai'
  | 'integration'
  | 'code';

export type WorkflowNodeCanvasType = 'trigger' | 'condition' | 'action' | 'registry';

export type WorkflowNodeCatalogEntry = {
  type: string;
  label: string;
  category: WorkflowNodeCategory;
  description?: string;
  canvasType: WorkflowNodeCanvasType;
  defaultConfig?: Record<string, unknown>;
};

const BUILTIN_WORKFLOW_NODE_CATALOG_ENTRIES: WorkflowNodeCatalogEntry[] = [
  {
    type: 'email.tag',
    label: 'Tag setzen',
    category: 'email',
    canvasType: 'action',
    description: 'Hängt der Nachricht einen Tag an (für Filter, Folge-Workflows oder Sortierung). Mehrere Tags = mehrere Knoten.',
    defaultConfig: { tag: '' },
  },
  {
    type: 'email.mark_seen',
    label: 'Als gelesen markieren',
    category: 'email',
    canvasType: 'action',
    description: 'Setzt die Nachricht lokal auf gelesen und versucht zusätzlich, das IMAP-\\Seen-Flag zu setzen.',
  },
  {
    type: 'email.archive',
    label: 'Archivieren',
    category: 'email',
    canvasType: 'action',
    description: 'Versteckt die Nachricht aus dem Posteingang (lokales Archiv-Flag). IMAP-Verschiebung erfolgt nicht.',
  },
  {
    type: 'email.hold_outbound',
    label: 'Versand sperren',
    category: 'email',
    canvasType: 'action',
    description: 'Setzt outbound_hold=true mit Grund (Banner in Liste + Editor). Beendet den Workflow am „blocked"-Port — Folgeknoten werden nicht ausgeführt. Freigabe nur über einen separaten Workflow (email.release_outbound) oder manuell.',
    defaultConfig: { reason: '' },
  },
  {
    type: 'email.set_category',
    label: 'Kategorie setzen',
    category: 'email',
    canvasType: 'action',
    description: 'Ordnet die Nachricht einer Kategorie zu (Pfad wie "Support/Beschwerden"). Legt fehlende Knoten an.',
    defaultConfig: { path: '' },
  },
  {
    type: 'email.forward_copy',
    label: 'Weiterleiten (Empfänger, optional Anhänge)',
    category: 'email',
    canvasType: 'action',
    description:
      'Leitet die Mail an einen oder mehrere Empfänger weiter (komma-/semikolongetrennt, max. 10). includeAttachments=true hängt die Original-Anhänge an (Limit 25 MB). runOutboundReview=false (Standard) sendet direkt; =true erzwingt die Ausgangsprüfung (derzeit fail-closed bei aktiven Outbound-Workflows). Anti-Loop: Auto-Submitted-Header + Dedup-Tabelle.',
    defaultConfig: { to: '', includeAttachments: false, runOutboundReview: false },
  },
  {
    type: 'email.tag_attachment_meta',
    label: 'Tag bei Anhang',
    category: 'email',
    canvasType: 'action',
    description: 'Setzt den Tag nur, wenn die Nachricht mindestens einen Anhang hat.',
    defaultConfig: { tag: 'attachment' },
  },
  {
    type: 'email.create_draft',
    label: 'Antwort-Entwurf erstellen',
    category: 'email',
    canvasType: 'registry',
    description: 'Legt einen Antwort-Entwurf auf die aktuelle Nachricht an (optional mit Body-Präfix oder Vorlage).',
    defaultConfig: { bodyPrefix: '' },
  },
  {
    type: 'email.set_priority',
    label: 'Priorität setzen',
    category: 'email',
    canvasType: 'registry',
    description: 'Setzt Tags priority:hoch, priority:normal oder priority:niedrig für Sortierung/Filter.',
    defaultConfig: { level: 'normal' },
  },
  {
    type: 'email.auth_check',
    label: 'Auth-Prüfung (SPF/DKIM/DMARC/ARC)',
    category: 'email',
    canvasType: 'registry',
    description:
      'Verzweigt nach gespeicherten mailauth-Ergebnissen (nach Sync). Kanten: pass | fail | none | default.',
    defaultConfig: { protocol: 'dmarc', treatSoftfailAsFail: true },
  },
  {
    type: 'email.sender_filter',
    label: 'Absender-Filter',
    category: 'email',
    canvasType: 'registry',
    description:
      'Whitelist/Blacklist und bekannte Absender (PayPal, Amazon, ...) vor KI-Spam-Prüfung. Kanten: whitelist | blacklist | default.',
    defaultConfig: {
      useGlobalLists: true,
      useBuiltinTrusted: true,
      extraWhitelist: '',
      extraBlacklist: '',
    },
  },
  {
    type: 'email.set_spam_status',
    label: 'Spam-Status setzen',
    category: 'email',
    canvasType: 'registry',
    description: 'Setzt den lokalen Spam-Status: clean, review oder spam.',
    defaultConfig: { status: 'review', train: false, tag: '' },
  },
  {
    type: 'email.mark_spam',
    label: 'Als Spam markieren',
    category: 'email',
    canvasType: 'registry',
    description: 'Markiert die Nachricht als Spam (lokal + optional IMAP-Verschiebung in den Spam-Ordner).',
    defaultConfig: { spam: true, tag: 'auto-spam', moveImap: false },
  },
  {
    type: 'email.assign',
    label: 'Mitarbeiter zuweisen',
    category: 'email',
    canvasType: 'registry',
    description: 'Weist die Nachricht einem Team-Mitglied zu (taucht in dessen Posteingang-Filter "Mir zugewiesen" auf).',
    defaultConfig: { teamMemberId: '' },
  },
  {
    type: 'email.move_imap',
    label: 'IMAP verschieben',
    category: 'email',
    canvasType: 'registry',
    description: 'Verschiebt die Nachricht auf dem IMAP-Server in den angegebenen Ordner (z.B. "Rechnungen"). Lokale Sync folgt.',
    defaultConfig: { folderPath: 'Spam' },
  },
  {
    type: 'email.delete_server',
    label: 'Auf Server löschen',
    category: 'email',
    canvasType: 'registry',
    description: 'Löscht die Nachricht auf dem IMAP-Server und markiert sie lokal als gelöscht. Nicht wiederherstellbar.',
    defaultConfig: {},
  },
  {
    type: 'crm.link_customer',
    label: 'Kunde verknüpfen',
    category: 'crm',
    canvasType: 'action',
    description: 'Verknüpft die Nachricht mit einem Kunden anhand der Absender-E-Mail (matchet ihn in der CRM-Datenbank).',
  },
  {
    type: 'crm.create_task',
    label: 'Aufgabe anlegen',
    category: 'crm',
    canvasType: 'registry',
    description: 'Legt eine CRM-Aufgabe an, die an die Mail/den Kunden gehängt wird. Fälligkeit in Tagen, Priorität wählbar.',
    defaultConfig: { title: 'E-Mail bearbeiten', priority: 'medium', daysUntilDue: 3 },
  },
  {
    type: 'crm.log_activity',
    label: 'Aktivität protokollieren',
    category: 'crm',
    canvasType: 'registry',
    description: 'Hängt einen Aktivitätseintrag an den verknüpften Kunden/Deal — für Audit-Trail und Timeline.',
    defaultConfig: { activityType: 'email', title: 'Workflow' },
  },
  {
    type: 'crm.update_deal',
    label: 'Deal aktualisieren',
    category: 'crm',
    canvasType: 'registry',
    description: 'Aktualisiert Deal-Stage oder Felder anhand der Deal-ID (oder dem verknüpften Kunden).',
    defaultConfig: { dealId: 0, stage: '' },
  },
  {
    type: 'ai.review',
    label: 'KI-Prüfung',
    category: 'ai',
    canvasType: 'action',
    description: 'Generische KI-Prüfung mit Prompt; wenn die Antwort das Blockwort enthält, geht es auf "blocked".',
    defaultConfig: { promptId: 0, blockKeyword: 'BLOCK' },
  },
  {
    type: 'ai.outbound_review',
    label: 'KI-Ausgangsprüfung',
    category: 'ai',
    canvasType: 'registry',
    description:
      'Prüft ausgehende E-Mails (Ton, Rechtschreibung, Anhang, Betrugs-Antworten) vor dem Versand.',
    defaultConfig: { promptId: 0, checkReplyContext: true },
  },
  {
    type: 'ai.transform_text',
    label: 'KI-Text transformieren',
    category: 'ai',
    canvasType: 'registry',
    description: 'Schickt den E-Mail-Text an die KI und legt das Ergebnis als Variable ab (z.B. Zusammenfassung, Übersetzung).',
    defaultConfig: { promptId: 0, targetVariable: 'ai.text' },
  },
  {
    type: 'ai.spam_score',
    label: 'KI-Spam-Wahrscheinlichkeit',
    category: 'ai',
    canvasType: 'registry',
    description:
      'Bewertet Spam 1-100 (nur Metadaten, kein E-Mail-Volltext). Antwort der KI muss eine Zahl sein.',
    defaultConfig: {
      contextMode: 'metadata',
      thresholdHint: 70,
    },
  },
  {
    type: 'ai.classify',
    label: 'KI-Klassifizierung',
    category: 'ai',
    canvasType: 'registry',
    description: 'Sortiert die Mail in genau eine der angegebenen Klassen (kommagetrennt). Setzt ai.class und ai.class_confidence.',
    defaultConfig: { labels: 'Rechnung,Support,Spam', contextMode: 'metadata' },
  },
  {
    type: 'ai.agent',
    label: 'KI-Agent',
    category: 'ai',
    canvasType: 'registry',
    description: 'Generischer KI-Agent mit System-Prompt und Wissensbasis. Kann optional direkt einen Antwort-Entwurf anlegen.',
    defaultConfig: {
      systemPrompt: 'Du bist ein CRM-Assistent. Nutze die Wissensbasis. Antworte kurz.',
      knowledgeBaseId: null,
      profileId: null,
      createDraft: true,
    },
  },
  {
    type: 'ai.reply_suggestion',
    label: 'Antwortvorschlag erzeugen',
    category: 'ai',
    canvasType: 'registry',
    description:
      'Erzeugt einen KI-Antwortvorschlag für die aktuelle Nachricht. Unabhängig von den globalen Einstellungen unter KI -> Antwortvorschläge (z. B. nach Kategorie-Sortierung im Workflow).',
    defaultConfig: { promptId: 0, skipIfReady: true },
  },
  {
    type: 'ai.agent_tool',
    label: 'KI-Agent-Tool',
    category: 'ai',
    canvasType: 'registry',
    description: 'Werkzeug-Aufruf für KI-Agenten: search_knowledge, get_canned oder eigener Tool-Name (Echo).',
    defaultConfig: { tool: 'search_knowledge', knowledgeBaseId: null },
  },
  {
    type: 'logic.stop',
    label: 'Stopp',
    category: 'logic',
    canvasType: 'action',
    description: 'Beendet die Workflow-Ausführung an dieser Stelle sauber (kein Fehler).',
  },
  {
    type: 'logic.set_variable',
    label: 'Variable setzen',
    category: 'logic',
    canvasType: 'registry',
    description: 'Legt eine Workflow-Variable an (steht in Folge-Knoten als {{name}} bereit).',
    defaultConfig: { name: 'var', value: '' },
  },
  {
    type: 'logic.delay',
    label: 'Verzögerung',
    category: 'logic',
    canvasType: 'registry',
    description: 'Pausiert den Workflow für die angegebene Zeit (z.B. "5 Minuten warten, dann Folgeaktion"). Persistent über Restarts.',
    defaultConfig: { delaySeconds: 60 },
  },
  {
    type: 'logic.merge',
    label: 'Zusammenführen',
    category: 'logic',
    canvasType: 'registry',
    description: 'Sammelt mehrere parallele Zweige wieder zu einem (alle Eingangskanten landen am gleichen Punkt).',
    defaultConfig: {},
  },
  {
    type: 'logic.threshold',
    label: 'Schwellwert',
    category: 'logic',
    canvasType: 'registry',
    description: 'Vergleicht eine Workflow-Variable (z. B. ai.spam_score) mit einem Grenzwert.',
    defaultConfig: { variable: 'ai.spam_score', operator: 'gte', value: 70 },
  },
  {
    type: 'logic.switch',
    label: 'Schalter',
    category: 'logic',
    canvasType: 'registry',
    description: 'Verzweigt anhand einer Variable in beliebig viele Cases (sonst: default-Kante).',
    defaultConfig: { field: 'ai.class', cases: 'A,B,C' },
  },
  {
    type: 'logic.loop',
    label: 'Schleife',
    category: 'logic',
    canvasType: 'registry',
    description: 'Iteriert über eine Liste (Variable oder Komma-Liste). maxItems schützt vor Endlos-Läufen.',
    defaultConfig: { sourceVariable: 'attachment_names', items: '', maxItems: 50 },
  },
  {
    type: 'code.javascript',
    label: 'JavaScript',
    category: 'code',
    canvasType: 'registry',
    description:
      'Keine echte Sandbox: nur vertrauenswürdigen Code ausführen. Node-vm kann Prozesszugriff ermöglichen.',
    defaultConfig: {
      code: '// Setze result = { myVar: "wert" }\nresult = { ok: true };',
    },
  },
  {
    type: 'code.python',
    label: 'Python (Subprozess)',
    category: 'code',
    canvasType: 'registry',
    description:
      'Führt python3 mit eingeschränkter Umgebung aus. Voller OS-Zugriff des App-Benutzers - nur eigenen Code verwenden.',
    defaultConfig: { code: 'print("ok")' },
  },
  {
    type: 'plugin.custom',
    label: 'Plugin-Knoten',
    category: 'code',
    canvasType: 'registry',
    description: 'Ruft einen registrierten Plugin-Handler auf. Im Servermodus nicht verfügbar.',
    defaultConfig: { pluginId: '', handler: '' },
  },
  {
    type: 'sync.run',
    label: 'E-Mail-Konto syncen',
    category: 'integration',
    canvasType: 'registry',
    description: 'Stößt einen IMAP-Sync für ein Konto an (oder alle, wenn accountId=0). Per Schedule-Trigger nutzbar.',
    defaultConfig: {},
  },
  {
    type: 'http.request',
    label: 'HTTP-Anfrage',
    category: 'integration',
    canvasType: 'registry',
    description: 'Schickt eine HTTP-Anfrage (Webhook, eigene API). Antwort steht als Variable http.* bereit.',
    defaultConfig: { method: 'GET', url: '', body: '' },
  },
  {
    type: 'mssql.query',
    label: 'MSSQL (Read-only)',
    category: 'integration',
    canvasType: 'registry',
    description: 'Führt eine read-only MSSQL-Abfrage gegen die konfigurierte Datenbank aus. Nur SELECT erlaubt.',
    defaultConfig: { sql: 'SELECT TOP 10 1 AS ok' },
  },
  {
    type: 'jtl.lookup',
    label: 'JTL Stammdaten',
    category: 'integration',
    canvasType: 'registry',
    description: 'Liest JTL-Stammdaten via MSSQL: firmen, warenlager, zahlungsarten oder versandarten.',
    defaultConfig: { entity: 'firmen' },
  },
  {
    type: 'jtl.order_context',
    label: 'JTL Bestell-Kontext',
    category: 'integration',
    canvasType: 'registry',
    description:
      'Read-only-Query (MSSQL) mit {{email}}/{{orderNo}}; mappt die erste Zeile auf jtl.*-Variablen für KI-Nodes.',
    defaultConfig: { query: 'SELECT TOP 1 cStatus FROM tBestellung WHERE cEmail = {{email}}', mapping: '' },
  },
  {
    type: 'jtl.prepare_action',
    label: 'JTL Aktion vorbereiten',
    category: 'integration',
    canvasType: 'registry',
    description:
      'Baut einen Aktions-Vorschlag (resend_invoice/create_return/send_tracking/refund_status/custom) — führt nichts aus.',
    defaultConfig: { kind: 'send_tracking', requireApproval: true },
  },
  {
    type: 'ai.pick_canned',
    label: 'KI: Textbaustein wählen',
    category: 'ai',
    canvasType: 'registry',
    description: 'Die KI wählt den passenden Textbaustein, füllt Platzhalter und legt einen Entwurf an.',
    defaultConfig: { createDraft: true },
  },
  {
    type: 'email.auto_reply',
    label: 'Auto-Antwort (Gate)',
    category: 'email',
    canvasType: 'registry',
    description:
      'Entscheidet, ob automatisch geantwortet werden darf (Schalter + Confidence + Anti-Loop). Sendet selbst nichts.',
    defaultConfig: { confidenceVar: 'ai.class_confidence', minConfidence: 70 },
  },
  {
    type: 'email.release_outbound',
    label: 'Versand freigeben',
    category: 'email',
    canvasType: 'registry',
    description:
      'Gegenstück zu „Versand sperren": hebt die Sperre auf (OK-Pfad der Ausgangsprüfung). Mit autoSend=true wird sofort gesendet.',
    defaultConfig: { autoSend: true },
  },
  {
    type: 'workflow.subflow',
    label: 'Subflow ausführen',
    category: 'logic',
    canvasType: 'registry',
    description: 'Ruft einen anderen Workflow als Subflow auf (Wiederverwendbarkeit). Die Workflow-ID stammt aus der Workflow-Liste.',
    defaultConfig: { workflowId: 0 },
  },
];

export function cloneWorkflowNodeCatalogEntry(
  entry: WorkflowNodeCatalogEntry,
): WorkflowNodeCatalogEntry {
  return {
    type: entry.type,
    label: entry.label,
    category: entry.category,
    ...(entry.description === undefined ? {} : { description: entry.description }),
    canvasType: entry.canvasType,
    ...(entry.defaultConfig === undefined ? {} : { defaultConfig: { ...entry.defaultConfig } }),
  };
}

export function sortWorkflowNodeCatalog(
  entries: readonly WorkflowNodeCatalogEntry[],
): WorkflowNodeCatalogEntry[] {
  return entries.map(cloneWorkflowNodeCatalogEntry).sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

export const BUILTIN_WORKFLOW_NODE_CATALOG: readonly WorkflowNodeCatalogEntry[] = sortWorkflowNodeCatalog(
  BUILTIN_WORKFLOW_NODE_CATALOG_ENTRIES,
);

export function listBuiltinWorkflowNodeCatalog(): WorkflowNodeCatalogEntry[] {
  return BUILTIN_WORKFLOW_NODE_CATALOG.map(cloneWorkflowNodeCatalogEntry);
}
