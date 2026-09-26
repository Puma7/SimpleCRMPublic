import type { WorkflowGraphDocument } from './graph-types';
import type { WorkflowTemplate } from './templates';

/**
 * Vorlagenpaket „Teilautomatisierung“ (TA-P6, docs/MAIL_TEILAUTOMATISIERUNG.md
 * Abschnitte 2 und 4.3). Vier Vorlagen, die zusammen den Ablauf bilden:
 * Spam-Entscheidung (Priorität 5) → „Mensch oder KI?“ mit KI-Antwort und
 * Gegenprüfung (Priorität 50) → KI-Entscheidung im Ausgang (Priorität 50) →
 * wöchentliche Learnings-Auswertung per Zeitplan.
 *
 * Alle Knoten laufen in beiden Editionen. Jede Kante an einem Knoten mit
 * mehreren Ausgängen ist beschriftet; nicht verdrahtete Ausgänge von
 * ai.decide beenden den Lauf bewusst (kein Rückfall auf eine unbeschriftete
 * Kante). Die KI-Antwort geht immer durch die Ausgangs-Workflows
 * (runOutboundReview: true).
 */
export const PARTIAL_AUTOMATION_TEMPLATE_IDS = {
  spamDecision: 'inbound-spam-decision',
  humanOrAiReply: 'inbound-human-or-ai-reply',
  outboundDecision: 'outbound-decision-before-send',
  learningsWeekly: 'learnings-weekly-digest',
} as const;

/** Frage, Kriterien und Einstellungen der Spam-Entscheidung (Vorlage a). */
const SPAM_DECISION_CONFIG = {
  question: 'Ist diese E-Mail Spam, Phishing oder unerwünschte Werbung?',
  yesCriteria:
    'Ja, wenn mindestens eines zutrifft: Massen- oder Werbemail ohne erkennbaren Bezug zu uns; ' +
    'Gewinnspiel, Lockangebot oder Kettenbrief; Phishing (Aufforderung, Zugangsdaten oder Zahlungsdaten ' +
    'einzugeben oder verdächtige Links oder Anhänge zu öffnen); gefälschte Rechnung, Mahnung, ' +
    'Paket- oder Kontobenachrichtigung; Betrugsmasche (Vorschuss, Erpressung, angebliche Kontosperrung); ' +
    'unverlangte SEO-, Backlink-, Kredit- oder Kaltakquise-Angebote.',
  noCriteria:
    'Nein bei Anfragen, Bestellungen, Reklamationen oder Rückfragen von Kunden, Interessenten, ' +
    'Lieferanten oder Partnern — auch wenn sie kurz, unhöflich oder fehlerhaft geschrieben sind; ' +
    'bei Antworten auf unsere eigenen Mails; bei Rechnungen, Auftrags- und Versandbestätigungen ' +
    'bekannter Geschäftspartner; bei bewusst abonnierten Newslettern und Meldungen von Diensten, die wir nutzen.',
  contextMode: 'full',
  threshold: 80,
  profileId: null,
} as const;

/** Frage und Kriterien „Muss ein Mensch diese Anfrage bearbeiten?“ (Vorlage b). */
const HUMAN_DECISION_CONFIG = {
  question: 'Muss ein Mensch diese Anfrage bearbeiten?',
  yesCriteria:
    'Ja, wenn mindestens eines zutrifft: Beschwerde oder Reklamation mit spürbarem Ärger oder Enttäuschung; ' +
    'rechtliches Thema (Anwalt, Widerruf, Gewährleistung, Datenschutz, Abmahnung); Preisverhandlung, ' +
    'Rabattwunsch oder individuelles Angebot; Kündigung; Zahlungsproblem, Mahnung oder Erstattungswunsch; ' +
    'sensible Daten (z. B. Gesundheit, Bankverbindung, Ausweis); mehrere Anliegen in einer Mail; ' +
    'unklare oder mehrdeutige Anfrage; alles, was sich nicht mit allgemeinen Informationen aus unserer ' +
    'Wissensbasis (FAQ, Versand, Lieferzeiten, Produkte, Öffnungszeiten) beantworten lässt.',
  noCriteria:
    'Nein, wenn es eine einfache Standardfrage ist, die sich mit der Wissensbasis sicher und vollständig ' +
    'beantworten lässt, z. B. Öffnungszeiten, Versand und Versandkosten, Lieferzeiten, Produktinformationen ' +
    'oder eine Rückfrage zum Stand einer Bestellung — und keiner der Ja-Gründe zutrifft.',
  contextMode: 'full',
  threshold: 80,
  profileId: null,
} as const;

/** Frage und Kriterien „versandfähig?“ im Ausgang (Vorlage c). */
const OUTBOUND_DECISION_CONFIG = {
  question: 'Ist diese E-Mail in dieser Form an den Kunden versandfähig?',
  yesCriteria:
    'Ja nur, wenn alles zutrifft: höflicher, sachlicher Ton; korrekte Anrede; die Frage des Kunden wird ' +
    'beantwortet; keine internen Informationen (interne Notizen, Kollegennamen, Einkaufspreise, Systemtexte ' +
    'oder Platzhalter); keine unbelegten Zusagen zu Preisen, Rabatten, Terminen, Lieferdaten oder ' +
    'Erstattungen; keine sensiblen Daten Dritter; angekündigte Anhänge sind vorhanden.',
  noCriteria:
    'Nein, sobald einer der Ja-Punkte nicht erfüllt ist, der Text unvollständig oder widersprüchlich wirkt ' +
    'oder die Mail an den falschen Empfänger zu gehen scheint.',
  contextMode: 'full',
  threshold: 80,
  profileId: null,
} as const;

/** Wie die Zwei-Stufen-Vorlage „KI-Antwort mit Gegenprüfung (empfohlen)“. */
const DRAFT_REPLY_SYSTEM_PROMPT =
  'Du bist ein freundlicher Kundenservice-Mitarbeiter. Beantworte die Kundenmail vollständig, korrekt und auf Deutsch. Nutze die Wissensbasis, wenn vorhanden. Schreibe NUR den Antworttext ohne Anrede und ohne Grußformel — beide werden automatisch ergänzt.';

function registry(id: string, nodeType: string, config: Record<string, unknown>) {
  return { id, type: 'registry' as const, data: { nodeType, config } };
}

export function partialAutomationWorkflowTemplates(): WorkflowTemplate[] {
  return [
    {
      id: PARTIAL_AUTOMATION_TEMPLATE_IDS.spamDecision,
      name: 'Eingehend: Spam-Entscheidung (Entscheidungsmodell)',
      description:
        'Teilautomatisierung, Schritt 1: Die KI-Entscheidung fragt „Ist diese E-Mail Spam, Phishing oder ' +
        'unerwünschte Werbung?“ (kompletter Text, Mindest-Sicherheit 80 %). Ja → als Spam markieren, in den ' +
        'Spam-Ordner verschieben, nachfolgende Workflows stoppen. Unsicher → „Spam prüfen“, ebenfalls Stopp. ' +
        'Nein → nichts passiert, die nächsten Workflows laufen weiter. KI-Fehler → Tag ki-fehler, die Mail ' +
        'bleibt im Posteingang. Priorität 5 (wird beim Laden eingetragen).',
      trigger: 'inbound',
      priority: 5,
      graph: {
        version: 1,
        nodes: [
          { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
          registry('decide', 'ai.decide', { ...SPAM_DECISION_CONFIG }),
          // Ja: lokal Spam + auf dem IMAP-Server in „Spam“ verschieben, Kette stoppen.
          // „Stopp nach Spam“ dahinter hält die Kette auch dann an, wenn jemand
          // „Weitere Inbound-Workflows stoppen“ im Baustein ausschaltet (Muster
          // wie „Eingehend: KI-Spam-Pipeline (DSGVO)“).
          registry('spam', 'email.mark_spam', {
            spam: true,
            tag: 'ki-spam',
            moveImap: true,
            train: false,
            stopFurtherWorkflows: true,
          }),
          registry('stop_spam', 'logic.stop_after_spam', {}),
          // Unsicher: „Spam prüfen“ — ein Mensch schaut es sich an, Kette stoppt.
          registry('review', 'email.set_spam_status', {
            status: 'review',
            tag: 'spam-pruefen',
            train: false,
            stopFurtherWorkflows: true,
          }),
          registry('stop_review', 'logic.stop_after_spam', {}),
          // KI-Fehler: nur markieren, die Mail bleibt normal im Posteingang.
          registry('tag_error', 'email.tag', { tag: 'ki-fehler' }),
        ],
        // „nein“ bleibt bewusst unverdrahtet: der Lauf endet dort ohne Kettenstopp.
        edges: [
          { id: 'e0', source: 't1', target: 'decide' },
          { id: 'e_ja', source: 'decide', target: 'spam', label: 'ja' },
          { id: 'e_spam_stop', source: 'spam', target: 'stop_spam' },
          { id: 'e_unsicher', source: 'decide', target: 'review', label: 'unsicher' },
          { id: 'e_review_stop', source: 'review', target: 'stop_review' },
          { id: 'e_error', source: 'decide', target: 'tag_error', label: 'error' },
        ],
      } as WorkflowGraphDocument,
    },
    {
      id: PARTIAL_AUTOMATION_TEMPLATE_IDS.humanOrAiReply,
      name: 'Eingehend: Mensch oder KI? → KI-Antwort mit Gegenprüfung',
      description:
        'Teilautomatisierung, Schritt 2: Die KI-Entscheidung fragt „Muss ein Mensch diese Anfrage bearbeiten?“. ' +
        'Ja, Unsicher oder KI-Fehler → Tag manuell, die Mail bleibt im Posteingang. Nein → Sicherheits-Gate ' +
        '(Schalter, Absender, Tageslimit, Sicherheit ab 80 %) → KI-Antwort mit Wissensbasis und Learnings → ' +
        'Gegenprüfung → Versand durch die Ausgangs-Workflows; im Zweifel wartet der Entwurf auf Freigabe. ' +
        'Priorität 50 (nach der Spam-Entscheidung, wird beim Laden eingetragen).',
      trigger: 'inbound',
      priority: 50,
      graph: {
        version: 1,
        nodes: [
          { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
          // Schutz: als Spam oder „Spam prüfen“ markierte Mails nie beantworten
          // (auch wenn die Spam-Vorlage davor mit Fehler endete).
          registry('stop_spam', 'logic.stop_after_spam', {}),
          registry('decide', 'ai.decide', { ...HUMAN_DECISION_CONFIG }),
          // Ja / Unsicher / KI-Fehler: Mensch übernimmt.
          registry('tag_manual', 'email.tag', { tag: 'manuell' }),
          // Nein: Gate mit der Sicherheit der Entscheidung (bei „nein“ = 100 − Ja-Wahrscheinlichkeit).
          registry('gate', 'email.auto_reply', { confidenceVar: 'ai.decide.confidence', minConfidence: 80 }),
          // Agent 1 — Einstellungen wie „KI-Antwort mit Gegenprüfung (empfohlen)“;
          // Wissensbasis automatisch, damit auch die Learnings mitgelesen werden.
          registry('draft', 'ai.draft_reply', {
            systemPrompt: DRAFT_REPLY_SYSTEM_PROMPT,
            knowledgeBaseId: null,
            includeCanned: true,
            greeting: 'auto',
            signature: 'account',
          }),
          // Agent 2 — Gegenprüfung; im Zweifel „prüfen“.
          registry('review', 'ai.review_draft', { draftIdVariable: 'draft.id', reviewPrompt: '' }),
          // Senden: immer zusätzlich durch die Ausgangs-Workflows.
          registry('send', 'email.send_draft', { draftIdVariable: 'draft.id', runOutboundReview: true }),
          // Prüfen: Entwurf wartet im Posteingang auf Freigabe — sichtbar machen.
          registry('tag_review', 'email.tag', { tag: 'ki-freigabe' }),
          registry('task_review', 'crm.create_task', {
            title: 'KI-Entwurf prüfen: {{subject}}',
            priority: 'medium',
            daysUntilDue: 1,
          }),
          // Gate blockiert (Schalter aus, Automat/No-Reply, Tageslimit, zu unsicher).
          registry('tag_blocked', 'email.tag', { tag: 'ki-manuell' }),
        ],
        edges: [
          { id: 'e0', source: 't1', target: 'stop_spam' },
          { id: 'e1', source: 'stop_spam', target: 'decide' },
          { id: 'e_ja', source: 'decide', target: 'tag_manual', label: 'ja' },
          { id: 'e_unsicher', source: 'decide', target: 'tag_manual', label: 'unsicher' },
          { id: 'e_error', source: 'decide', target: 'tag_manual', label: 'error' },
          { id: 'e_nein', source: 'decide', target: 'gate', label: 'nein' },
          { id: 'e_approved', source: 'gate', target: 'draft', label: 'approved' },
          { id: 'e_blocked', source: 'gate', target: 'tag_blocked', label: 'blocked' },
          { id: 'e_draft', source: 'draft', target: 'review' },
          { id: 'e_send', source: 'review', target: 'send', label: 'send' },
          { id: 'e_hold', source: 'review', target: 'tag_review', label: 'hold' },
          { id: 'e_task', source: 'tag_review', target: 'task_review' },
        ],
      } as WorkflowGraphDocument,
    },
    {
      id: PARTIAL_AUTOMATION_TEMPLATE_IDS.outboundDecision,
      name: 'Ausgehend: KI-Entscheidung vor dem Versand',
      description:
        'Teilautomatisierung, Ausgang: Die KI-Entscheidung prüft jede ausgehende Mail — „Ist diese E-Mail in ' +
        'dieser Form an den Kunden versandfähig?“. Ja → Versand freigeben. Nein, Unsicher oder KI-Fehler → der ' +
        'Versand bleibt angehalten, der Entwurf kommt mit dem Hinweis „Versand blockiert“ zurück, zusätzlich ' +
        'Tag ausgang-blockiert. Priorität 50 (wird beim Laden eingetragen).',
      trigger: 'outbound',
      priority: 50,
      graph: {
        version: 1,
        nodes: [
          { id: 't1', type: 'trigger', data: { kind: 'outbound' } },
          registry('decide', 'ai.decide', { ...OUTBOUND_DECISION_CONFIG }),
          // Wie „Ausgehend: KI-Qualitätsprüfung“: Freigabe mit autoSend versendet in beiden Editionen.
          registry('release', 'email.release_outbound', { autoSend: true }),
          // Nein / Unsicher / KI-Fehler halten den Versand ohnehin an (Knoten-Semantik);
          // der Tag macht die angehaltenen Entwürfe zusätzlich filterbar.
          registry('tag_blocked', 'email.tag', { tag: 'ausgang-blockiert' }),
        ],
        edges: [
          { id: 'e0', source: 't1', target: 'decide' },
          { id: 'e_ja', source: 'decide', target: 'release', label: 'ja' },
          { id: 'e_nein', source: 'decide', target: 'tag_blocked', label: 'nein' },
          { id: 'e_unsicher', source: 'decide', target: 'tag_blocked', label: 'unsicher' },
          { id: 'e_error', source: 'decide', target: 'tag_blocked', label: 'error' },
        ],
      } as WorkflowGraphDocument,
    },
    {
      id: PARTIAL_AUTOMATION_TEMPLATE_IDS.learningsWeekly,
      name: 'Learnings wöchentlich auswerten',
      description:
        'Teilautomatisierung, Learnings: Wertet jeden Montag um 06:00 die gesammelten Learnings der letzten ' +
        'Woche aus (ab 3 Einträgen) und legt einen Vorschlag unter Einstellungen → Learnings an — die ' +
        'Wissensbasis ändert sich erst nach Ihrer Freigabe. Täglich oder monatlich: Cron-Ausdruck ändern ' +
        '(z. B. 0 6 * * * oder 0 6 1 * *) und im Baustein den Zeitraum anpassen. Server: nach dem Laden einmal ' +
        'speichern, damit der Zeitplan scharf geschaltet ist.',
      trigger: 'schedule',
      cronExpr: '0 6 * * 1',
      graph: {
        version: 1,
        nodes: [
          { id: 't1', type: 'trigger', data: { kind: 'schedule' } },
          registry('digest', 'ai.learnings_digest', {
            knowledgeBaseId: null,
            period: 'week',
            minCandidates: 3,
            profileId: null,
          }),
        ],
        edges: [{ id: 'e0', source: 't1', target: 'digest' }],
      } as WorkflowGraphDocument,
    },
  ];
}
