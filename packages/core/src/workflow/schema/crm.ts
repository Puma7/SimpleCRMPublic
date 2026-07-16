import type { WorkflowNodeSchemaExtension } from '../node-schema';

/** Feld-/Port-/Output-Schemata der crm.*- und returns.*-Knoten. */
export const CRM_NODE_SCHEMAS: Record<string, WorkflowNodeSchemaExtension> = {
  'crm.link_customer': {
    docs: {
      longHelp:
        'Sucht in der Kunden-Datenbank nach der Absender-Adresse der Mail und verknüpft die Nachricht ' +
        'mit dem gefundenen Kunden. Danach wissen Folge-Knoten wie „Aufgabe anlegen“ oder ' +
        '„Aktivität protokollieren“, zu welchem Kunden die Mail gehört. ' +
        'Wird kein Kunde gefunden oder läuft der Workflow ohne Mail, passiert nichts (Knoten wird übersprungen).',
      prerequisites: [
        'Der Kunde muss im CRM angelegt sein und die Absender-Adresse der Mail hinterlegt haben — sonst findet die Verknüpfung nichts.',
      ],
      seeAlso: ['crm.create_task', 'crm.log_activity', 'crm.update_deal'],
    },
  },

  'crm.create_task': {
    fields: [
      {
        key: 'title',
        type: 'text',
        label: 'Titel der Aufgabe',
        help:
          'So heißt die Aufgabe in der Aufgabenliste des Kunden. Als Beschreibung wird automatisch ' +
          'der Anfang des Mail-Textes eingetragen. Platzhalter wie {{ai.class}} oder {{subject}} werden beim Ausführen ersetzt.',
        example: 'Reklamation prüfen: {{subject}}',
        placeholder: 'E-Mail bearbeiten',
        required: true,
        interpolate: true,
      },
      {
        key: 'priority',
        type: 'select',
        label: 'Priorität',
        help: 'Wie dringend die Aufgabe ist — danach lässt sich die Aufgabenliste sortieren und filtern.',
        required: true,
        options: [
          { value: 'low', label: 'Niedrig' },
          { value: 'medium', label: 'Mittel' },
          { value: 'high', label: 'Hoch' },
        ],
      },
      {
        key: 'daysUntilDue',
        type: 'number',
        label: 'Fällig in (Tagen)',
        help:
          'So viele Tage nach dem Workflow-Lauf ist die Aufgabe fällig. ' +
          '0 = noch am selben Tag, 3 = in drei Tagen.',
        example: '3',
        required: true,
        validation: { min: 0, integer: true },
      },
      {
        key: 'customerId',
        type: 'number',
        label: 'Feste Kunden-Nummer (statt verknüpftem Kunden)',
        help:
          'Nur für Sonderfälle: legt die Aufgabe immer bei genau diesem Kunden an. ' +
          'Normalerweise leer lassen — dann wird der mit der Mail verknüpfte Kunde genommen ' +
          '(vorher „Kunde verknüpfen“ ausführen).',
        example: '42',
        advanced: true,
        validation: { min: 1, integer: true },
      },
      {
        key: 'allowWithoutCustomer',
        type: 'boolean',
        label: 'Auch ohne Kunden anlegen (nur Server-Edition)',
        help:
          'Ein: die Aufgabe wird auch dann angelegt, wenn keine Kunden-Verknüpfung vorhanden ist ' +
          '(z. B. DMARC-Report-Warnungen aus einem Provider-Postfach). Aus (Standard): ohne Kunde ' +
          'wird der Knoten übersprungen. Hinweis: In der Desktop-App bleibt eine Kunden-Verknüpfung ' +
          'Pflicht — dort wird ohne Kunde weiterhin übersprungen.',
        advanced: true,
      },
    ],
    outputs: [
      {
        name: 'task.id',
        label: 'Nummer der angelegten Aufgabe',
        example: '17',
        type: 'number',
      },
    ],
    docs: {
      longHelp:
        'Legt eine Aufgabe beim Kunden der Mail an (Titel, Priorität, Fälligkeit) — z. B. „Reklamation prüfen“ ' +
        'nach einer KI-Klassifizierung. Ist kein Kunde mit der Mail verknüpft und keine feste Kunden-Nummer ' +
        'angegeben, wird der Knoten übersprungen — außer „Auch ohne Kunden anlegen“ ist aktiv, dann entsteht ' +
        'eine kundenlose Aufgabe (z. B. für DMARC-Report-Warnungen).',
      prerequisites: [
        'Die Mail muss mit einem Kunden verknüpft sein (oder „Auch ohne Kunden anlegen“ aktivieren) — ' +
        'am einfachsten vorher den Knoten „Kunde verknüpfen“ ausführen.',
      ],
      seeAlso: ['crm.link_customer', 'crm.log_activity', 'email.assign'],
    },
  },

  'crm.log_activity': {
    fields: [
      {
        key: 'activityType',
        type: 'select',
        label: 'Art der Aktivität',
        help:
          'Unter dieser Rubrik erscheint der Eintrag in der Kunden-Chronik — ' +
          'so lässt sich später nach E-Mails, Anrufen oder Notizen filtern.',
        required: true,
        options: [
          { value: 'email', label: 'E-Mail' },
          { value: 'call', label: 'Anruf' },
          { value: 'meeting', label: 'Termin/Besprechung' },
          { value: 'note', label: 'Notiz' },
        ],
      },
      {
        key: 'title',
        type: 'text',
        label: 'Titel des Eintrags',
        help:
          'Überschrift des Chronik-Eintrags; als Beschreibung wird automatisch der Betreff der Mail eingetragen. ' +
          'Platzhalter wie {{ai.class}} werden beim Ausführen ersetzt.',
        example: 'Automatisch beantwortet ({{ai.class}})',
        placeholder: 'Workflow',
        required: true,
        interpolate: true,
      },
    ],
    docs: {
      longHelp:
        'Schreibt einen Eintrag in die Chronik (Aktivitäten-Verlauf) des mit der Mail verknüpften Kunden — ' +
        'z. B. „Workflow hat automatisch geantwortet“. So bleibt nachvollziehbar, was automatisch passiert ist. ' +
        'Ist kein Kunde verknüpft, wird der Knoten übersprungen.',
      prerequisites: [
        'Die Mail muss mit einem Kunden verknüpft sein — am einfachsten vorher den Knoten „Kunde verknüpfen“ ausführen.',
      ],
      seeAlso: ['crm.link_customer', 'crm.create_task'],
    },
  },

  'crm.update_deal': {
    fields: [
      {
        key: 'dealId',
        type: 'number',
        label: 'Deal-Nummer',
        help:
          'Nummer des Deals (Verkaufschance), der geändert werden soll. ' +
          'Steht hier 0 oder nichts, wird der Knoten übersprungen — es sei denn, ein vorheriger Knoten ' +
          'hat die Variable deal.id gesetzt (die greift nur, wenn dieses Feld ganz leer ist, nicht bei 0).',
        example: '15',
        required: true,
        validation: { min: 0, integer: true },
      },
      {
        key: 'stage',
        type: 'text',
        label: 'Neue Phase (Stage)',
        help:
          'In diese Verkaufs-Phase wird der Deal verschoben — genau so schreiben, wie die Phase im CRM heißt. ' +
          'Leer = Phase unverändert lassen (dann wirkt nur der Titel unter „Erweitert“).',
        example: 'proposal',
        placeholder: 'z. B. proposal, won, lost',
      },
      {
        key: 'title',
        type: 'text',
        label: 'Neuer Titel des Deals (optional)',
        help:
          'Benennt den Deal um. Wird nur angewendet, wenn oben KEINE neue Phase gesetzt ist — ' +
          'beides gleichzeitig geht derzeit nicht. Platzhalter wie {{subject}} werden beim Ausführen ersetzt.',
        example: 'Angebot {{subject}}',
        advanced: true,
        interpolate: true,
      },
    ],
    outputs: [
      {
        name: 'deal.id',
        label: 'Nummer des geänderten Deals',
        example: '15',
        type: 'number',
      },
      {
        name: 'deal.stage',
        label: 'Gesetzte Phase',
        description: 'Nur gesetzt, wenn eine neue Phase eingetragen war.',
        example: 'proposal',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Verschiebt einen Deal (Verkaufschance) in eine andere Phase oder benennt ihn um. ' +
        'Die Deal-Nummer kommt aus dem Feld oben oder — wenn das Feld ganz leer ist — aus der Variable deal.id ' +
        'eines vorherigen Knotens. Achtung: der Wert 0 zählt als „keine Nummer“ und überspringt den Knoten, ' +
        'OHNE auf die Variable zurückzugreifen.',
      prerequisites: ['Der Deal muss im CRM existieren; die Phase genau so schreiben, wie sie dort heißt.'],
      seeAlso: ['crm.link_customer', 'crm.log_activity'],
    },
  },

  'returns.evaluate': {
    fields: [
      {
        key: 'reviewConditions',
        type: 'text',
        label: 'Zustände, die ein Mensch prüfen soll',
        help:
          'Artikel-Zustände, mit Komma getrennt (Groß-/Kleinschreibung egal). Hat EIN Artikel der Retoure ' +
          'einen dieser Zustände, geht es sofort zum Ausgang „Manuell prüfen“ — diese Regel schlägt alle anderen. ' +
          'Leer = Standard „damaged“ (beschädigt).',
        example: 'damaged,used',
        placeholder: 'damaged',
      },
      {
        key: 'exchangeReasonCodes',
        type: 'text',
        label: 'Rückgabe-Gründe für Umtausch',
        help:
          'Kürzel der Rückgabe-Gründe, mit Komma getrennt (wie unter Retouren → Gründe angelegt). ' +
          'Passt ein Artikel-Grund, geht es zum Ausgang „Umtausch“. ' +
          'Leer = Standard „size_wrong,wrong_item“ (falsche Größe, falscher Artikel).',
        example: 'size_wrong,wrong_item',
        placeholder: 'size_wrong,wrong_item',
      },
      {
        key: 'creditReasonCodes',
        type: 'text',
        label: 'Rückgabe-Gründe für Gutschrift',
        help:
          'Kürzel der Rückgabe-Gründe, mit Komma getrennt. Passt ein Artikel-Grund (und keine Umtausch-Regel), ' +
          'geht es zum Ausgang „Gutschrift“. Leer = keine Gutschrift-Regel.',
        example: 'minor_defect',
      },
      {
        key: 'defaultOutcome',
        type: 'select',
        label: 'Ausgang, wenn keine Regel passt',
        help: 'Zu diesem Ausgang geht es, wenn keiner der obigen Zustände und Gründe zutrifft.',
        options: [
          { value: 'refund', label: 'Erstattung' },
          { value: 'exchange', label: 'Umtausch' },
          { value: 'credit', label: 'Gutschrift' },
          { value: 'keep', label: 'Behalten (keine Rücksendung)' },
          { value: 'needs_review', label: 'Manuell prüfen' },
        ],
      },
      {
        key: 'returnId',
        type: 'number',
        label: 'Feste Retouren-Nummer (statt automatischer Suche)',
        help:
          'Nur für Sonderfälle: bewertet genau diese Retoure. Normalerweise leer lassen — ' +
          'dann wird die Retoure aus der Variable returns.id oder über die auslösende Mail gefunden.',
        example: '12',
        advanced: true,
        validation: { min: 1, integer: true },
      },
    ],
    ports: [
      {
        id: 'refund',
        label: 'Erstattung',
        description: 'Vorschlag: Geld zurück.',
        kind: 'branch',
        color: 'emerald',
      },
      {
        id: 'exchange',
        label: 'Umtausch',
        description: 'Ein Rückgabe-Grund aus der Umtausch-Liste hat gepasst (z. B. falsche Größe).',
        kind: 'branch',
        color: 'sky',
      },
      {
        id: 'credit',
        label: 'Gutschrift',
        description: 'Ein Rückgabe-Grund aus der Gutschrift-Liste hat gepasst.',
        kind: 'branch',
        color: 'violet',
      },
      {
        id: 'keep',
        label: 'Behalten',
        description: 'Kunde darf die Ware behalten (nur erreichbar als Standard-Ausgang).',
        kind: 'branch',
      },
      {
        id: 'needs_review',
        label: 'Manuell prüfen',
        description:
          'Mindestens ein Artikel hat einen kritischen Zustand (z. B. beschädigt) — ' +
          'ein Mensch soll entscheiden. Diese Regel geht allen anderen vor.',
        kind: 'branch',
        color: 'amber',
      },
      {
        id: 'no_return',
        label: 'Keine Retoure',
        description:
          'Zu diesem Lauf wurde keine Retoure gefunden — z. B. weil die Mail nichts mit einer Rückgabe zu tun hat. ' +
          'Der Workflow läuft hier gefahrlos weiter (nichts wurde geändert).',
        kind: 'branch',
      },
    ],
    outputs: [
      {
        name: 'returns.found',
        label: 'Retoure gefunden',
        description: 'true, wenn eine Retoure zum Lauf gehört; false am Ausgang „Keine Retoure“.',
        type: 'boolean',
      },
      { name: 'returns.id', label: 'Retouren-Nummer (intern)', example: '12', type: 'number' },
      { name: 'returns.number', label: 'Retouren-Kennung', example: 'RMA-2026-0012', type: 'string' },
      { name: 'returns.item_count', label: 'Anzahl Artikel in der Retoure', example: '2', type: 'number' },
      { name: 'returns.status', label: 'Aktueller Status der Retoure', example: 'pending', type: 'string' },
      {
        name: 'returns.suggested_outcome',
        label: 'Vorgeschlagenes Ergebnis',
        description: 'refund, exchange, credit, keep oder needs_review — gleich dem gewählten Ausgang.',
        example: 'exchange',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Nur in der Server-Edition verfügbar. Schaut sich die Artikel der Retoure an (Zustand + Rückgabe-Grund) ' +
        'und schlägt ein Ergebnis vor — der Workflow verzweigt zum passenden Ausgang. Der Knoten ÄNDERT NICHTS, ' +
        'er entscheidet nur; die eigentliche Aktion machen die Folge-Knoten (z. B. „Retoure: Umtausch“). ' +
        'Die Reihenfolge der Regeln ist fest: erst „Manuell prüfen“-Zustände, dann Umtausch-Gründe, ' +
        'dann Gutschrift-Gründe, sonst der Standard-Ausgang. Die Retoure wird über die Variable returns.id ' +
        'oder über die auslösende Mail gefunden — ohne Treffer geht es zum Ausgang „Keine Retoure“.',
      prerequisites: [
        'Nur Server-Edition — in der Desktop-App läuft der Knoten nicht.',
        'Retouren-Verwaltung mit angelegten Rückgabe-Gründen (die Kürzel hier müssen zu den dort gepflegten Grund-Kürzeln passen).',
        'Die Retoure muss mit der auslösenden Mail verknüpft sein, oder ein vorheriger Knoten setzt returns.id.',
      ],
      seeAlso: ['returns.offer_exchange', 'returns.offer_credit', 'logic.switch'],
    },
  },

  'returns.offer_exchange': {
    fields: [
      {
        key: 'status',
        type: 'select',
        label: 'Status der Retoure zusätzlich setzen (optional)',
        help:
          'Neben dem Ergebnis „Umtausch“ kann auch der Bearbeitungs-Status der Retoure umgestellt werden. ' +
          '„Nicht ändern“ = nur das Ergebnis wird gesetzt. Ein ungültiger Wert bricht den Knoten mit Fehler ab.',
        options: [
          { value: '', label: 'Nicht ändern' },
          { value: 'pending', label: 'Offen' },
          { value: 'approved', label: 'Genehmigt' },
          { value: 'received', label: 'Ware eingegangen' },
          { value: 'refunded', label: 'Erstattet' },
          { value: 'exchanged', label: 'Umgetauscht' },
          { value: 'credited', label: 'Gutgeschrieben' },
          { value: 'rejected', label: 'Abgelehnt' },
          { value: 'cancelled', label: 'Storniert' },
        ],
      },
      {
        key: 'returnId',
        type: 'number',
        label: 'Feste Retouren-Nummer (statt automatischer Suche)',
        help:
          'Nur für Sonderfälle: ändert genau diese Retoure. Normalerweise leer lassen — ' +
          'dann wird die Retoure aus der Variable returns.id oder über die auslösende Mail gefunden.',
        example: '12',
        advanced: true,
        validation: { min: 1, integer: true },
      },
    ],
    ports: [
      {
        id: 'default',
        label: 'Weiter',
        description: 'Ergebnis „Umtausch“ wurde gesetzt (oder war schon gesetzt — dann passiert nichts doppelt).',
        kind: 'success',
        color: 'emerald',
      },
      {
        id: 'no_return',
        label: 'Keine Retoure',
        description: 'Zu diesem Lauf wurde keine Retoure gefunden — es wurde nichts geändert.',
        kind: 'branch',
        color: 'amber',
      },
    ],
    outputs: [
      {
        name: 'returns.found',
        label: 'Retoure gefunden',
        type: 'boolean',
      },
      { name: 'returns.id', label: 'Retouren-Nummer (intern)', example: '12', type: 'number' },
      {
        name: 'returns.number',
        label: 'Retouren-Kennung',
        description: 'Nur gesetzt, wenn tatsächlich etwas geändert wurde.',
        example: 'RMA-2026-0012',
        type: 'string',
      },
      {
        name: 'returns.outcome',
        label: 'Gesetztes Ergebnis',
        description: 'Immer "exchange".',
        example: 'exchange',
        type: 'string',
      },
      {
        name: 'returns.status',
        label: 'Gesetzter Status',
        description: 'Nur gesetzt, wenn oben ein Status gewählt und geändert wurde.',
        example: 'approved',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Nur in der Server-Edition verfügbar. Setzt das Ergebnis der zum Lauf gehörenden Retoure auf ' +
        '„Umtausch“ (optional auch den Bearbeitungs-Status). Läuft der Workflow mehrfach, passiert nichts ' +
        'doppelt — eine bereits passende Retoure bleibt unangetastet. Geschrieben wird nur in die eigene ' +
        'Retouren-Verwaltung, NIE in die JTL-Warenwirtschaft. Typischerweise am Ausgang „Umtausch“ von ' +
        '„Retoure bewerten“ angeschlossen.',
      prerequisites: [
        'Nur Server-Edition — in der Desktop-App läuft der Knoten nicht.',
        'Die Retoure muss mit der auslösenden Mail verknüpft sein, oder ein vorheriger Knoten (z. B. „Retoure bewerten“) setzt returns.id.',
      ],
      seeAlso: ['returns.evaluate', 'returns.offer_credit'],
    },
  },

  'returns.offer_credit': {
    fields: [
      {
        key: 'status',
        type: 'select',
        label: 'Status der Retoure zusätzlich setzen (optional)',
        help:
          'Neben dem Ergebnis „Gutschrift“ kann auch der Bearbeitungs-Status der Retoure umgestellt werden. ' +
          '„Nicht ändern“ = nur das Ergebnis wird gesetzt. Ein ungültiger Wert bricht den Knoten mit Fehler ab.',
        options: [
          { value: '', label: 'Nicht ändern' },
          { value: 'pending', label: 'Offen' },
          { value: 'approved', label: 'Genehmigt' },
          { value: 'received', label: 'Ware eingegangen' },
          { value: 'refunded', label: 'Erstattet' },
          { value: 'exchanged', label: 'Umgetauscht' },
          { value: 'credited', label: 'Gutgeschrieben' },
          { value: 'rejected', label: 'Abgelehnt' },
          { value: 'cancelled', label: 'Storniert' },
        ],
      },
      {
        key: 'returnId',
        type: 'number',
        label: 'Feste Retouren-Nummer (statt automatischer Suche)',
        help:
          'Nur für Sonderfälle: ändert genau diese Retoure. Normalerweise leer lassen — ' +
          'dann wird die Retoure aus der Variable returns.id oder über die auslösende Mail gefunden.',
        example: '12',
        advanced: true,
        validation: { min: 1, integer: true },
      },
    ],
    ports: [
      {
        id: 'default',
        label: 'Weiter',
        description: 'Ergebnis „Gutschrift“ wurde gesetzt (oder war schon gesetzt — dann passiert nichts doppelt).',
        kind: 'success',
        color: 'emerald',
      },
      {
        id: 'no_return',
        label: 'Keine Retoure',
        description: 'Zu diesem Lauf wurde keine Retoure gefunden — es wurde nichts geändert.',
        kind: 'branch',
        color: 'amber',
      },
    ],
    outputs: [
      {
        name: 'returns.found',
        label: 'Retoure gefunden',
        type: 'boolean',
      },
      { name: 'returns.id', label: 'Retouren-Nummer (intern)', example: '12', type: 'number' },
      {
        name: 'returns.number',
        label: 'Retouren-Kennung',
        description: 'Nur gesetzt, wenn tatsächlich etwas geändert wurde.',
        example: 'RMA-2026-0012',
        type: 'string',
      },
      {
        name: 'returns.outcome',
        label: 'Gesetztes Ergebnis',
        description: 'Immer "credit".',
        example: 'credit',
        type: 'string',
      },
      {
        name: 'returns.status',
        label: 'Gesetzter Status',
        description: 'Nur gesetzt, wenn oben ein Status gewählt und geändert wurde.',
        example: 'credited',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Nur in der Server-Edition verfügbar. Setzt das Ergebnis der zum Lauf gehörenden Retoure auf ' +
        '„Gutschrift“ (optional auch den Bearbeitungs-Status). Läuft der Workflow mehrfach, passiert nichts ' +
        'doppelt — eine bereits passende Retoure bleibt unangetastet. Geschrieben wird nur in die eigene ' +
        'Retouren-Verwaltung, NIE in die JTL-Warenwirtschaft. Typischerweise am Ausgang „Gutschrift“ von ' +
        '„Retoure bewerten“ angeschlossen.',
      prerequisites: [
        'Nur Server-Edition — in der Desktop-App läuft der Knoten nicht.',
        'Die Retoure muss mit der auslösenden Mail verknüpft sein, oder ein vorheriger Knoten (z. B. „Retoure bewerten“) setzt returns.id.',
      ],
      seeAlso: ['returns.evaluate', 'returns.offer_exchange'],
    },
  },
};
