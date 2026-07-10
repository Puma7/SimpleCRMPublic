import type { WorkflowNodeSchemaExtension } from '../node-schema';

/**
 * Feld-/Port-/Output-Schemata der Integrations-Knoten (sync.*, http.*,
 * mssql.*, jtl.*). Stil und Tiefe wie in schema/email.ts und schema/ai.ts.
 */
export const INTEGRATION_NODE_SCHEMAS: Record<string, WorkflowNodeSchemaExtension> = {
  'sync.run': {
    fields: [
      {
        key: 'accountId',
        type: 'account',
        label: 'E-Mail-Konto',
        help:
          'Dieses Konto wird abgerufen (neue Mails vom Mail-Server holen). ' +
          '0 = ALLE eingerichteten Konten nacheinander abrufen. ' +
          'Leer = das Konto der Nachricht, die den Workflow ausgelöst hat.',
        example: '0',
      },
    ],
    outputs: [
      {
        name: 'sync.fetched',
        label: 'Abgerufene Mails',
        description: 'Anzahl der neu geholten Nachrichten (bei „alle Konten“: Summe über alle Konten).',
        example: '3',
        type: 'number',
      },
      {
        name: 'sync.failed_accounts',
        label: 'Fehlgeschlagene Konten',
        description: 'Nur bei Konto 0 (alle Konten) gesetzt: bei wie vielen Konten der Abruf fehlschlug.',
        example: '0',
        type: 'number',
      },
      {
        name: 'sync.queued',
        label: 'Abruf eingeplant',
        description: 'Nur Server-Edition: true, sobald der Abruf als Hintergrund-Auftrag eingeplant wurde.',
        type: 'boolean',
      },
      {
        name: 'sync.job_id',
        label: 'Auftrags-Nummer',
        description: 'Nur Server-Edition: interne Nummer des eingeplanten Abruf-Auftrags.',
        type: 'number',
      },
      {
        name: 'sync.account_id',
        label: 'Abgerufenes Konto',
        description: 'Nur Server-Edition: Nummer des Kontos, für das der Abruf eingeplant wurde.',
        type: 'number',
      },
    ],
    docs: {
      longHelp:
        'Stößt den E-Mail-Abruf (IMAP oder POP3) an — praktisch zusammen mit dem Zeitplan-Auslöser, ' +
        'um Postfächer regelmäßig zu aktualisieren. Mit Konto 0 werden alle Konten abgerufen; ' +
        'schlägt dabei ein einzelnes Konto fehl, laufen die übrigen trotzdem durch. ' +
        'In der Server-Edition wird der Abruf als Hintergrund-Auftrag eingeplant; das Konto kommt dort ' +
        'immer aus der auslösenden Nachricht — das Konto-Feld (und damit auch „alle Konten“) wird ignoriert.',
      prerequisites: ['Mindestens ein eingerichtetes E-Mail-Konto (IMAP oder POP3).'],
      seeAlso: ['email.move_imap', 'email.mark_seen'],
    },
  },

  'http.request': {
    fields: [
      {
        key: 'method',
        type: 'select',
        label: 'Art der Anfrage (HTTP-Methode)',
        help:
          '„Abrufen (GET)“ holt nur Daten von der Adresse. „Senden (POST)“ schickt zusätzlich den Inhalt ' +
          'aus dem Feld unten mit — z. B. um einen Webhook oder eine eigene Schnittstelle zu füttern. ' +
          'Andere Methoden sind aus Sicherheitsgründen nicht erlaubt.',
        required: true,
        options: [
          { value: 'GET', label: 'Abrufen (GET)' },
          { value: 'POST', label: 'Senden (POST)' },
        ],
      },
      {
        key: 'url',
        type: 'text',
        label: 'Adresse (URL)',
        help:
          'Die Web-Adresse, die aufgerufen wird — nur http/https. Der Host muss auf der HTTP-Allowlist stehen ' +
          '(Einstellungen → Automatisierung), lokale und interne Adressen sind grundsätzlich blockiert. ' +
          'Platzhalter wie {{subject}} oder {{ai.class}} werden beim Ausführen ersetzt. Leer = Knoten wird übersprungen.',
        example: 'https://api.meinefirma.de/hook',
        placeholder: 'https://api.meinefirma.de/hook',
        required: true,
        interpolate: true,
      },
      {
        key: 'body',
        type: 'textarea',
        label: 'Mitgeschickter Inhalt (Body)',
        help:
          'Wird nur bei „Senden (POST)“ mitgeschickt, üblicherweise als JSON — die Anfrage wird als ' +
          'Content-Type application/json gekennzeichnet. Platzhalter wie {{subject}} werden beim Ausführen ersetzt; ' +
          'Achtung: Anführungszeichen im ersetzten Text selbst prüfen, damit das JSON gültig bleibt.',
        example: '{ "betreff": "{{subject}}", "kategorie": "{{ai.class}}" }',
        showIf: { field: 'method', equals: 'POST' },
        interpolate: true,
      },
      {
        key: 'timeoutMs',
        type: 'number',
        label: 'Zeitlimit in Millisekunden',
        help:
          'So lange wird auf die Antwort gewartet, dann bricht die Anfrage ab (1000–60000). ' +
          'Leer = 30000 (30 Sekunden). Wird nur in der Server-Edition ausgewertet — ' +
          'die Desktop-App nutzt immer 30 Sekunden.',
        example: '10000',
        advanced: true,
        validation: { min: 1000, max: 60000, integer: true },
      },
    ],
    outputs: [
      {
        name: 'http.status',
        label: 'Antwort-Code (HTTP-Status)',
        description: '200–299 = Erfolg; 404 = nicht gefunden; 500 = Fehler beim Empfänger.',
        example: '200',
        type: 'number',
      },
      {
        name: 'http.body',
        label: 'Antwort-Inhalt',
        description: 'Der Text, den die Gegenstelle zurückgeschickt hat (auf 8000 Zeichen gekürzt).',
        example: '{"ok":true}',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Ruft eine Web-Adresse auf — z. B. um einen Webhook (Slack, Zapier, eigene Software) zu benachrichtigen ' +
        'oder Daten von einer eigenen Schnittstelle zu holen. Die Antwort steht danach in den Variablen ' +
        'http.status und http.body. Antwortet die Gegenstelle mit einem Fehler-Code (nicht 2xx), gilt der Knoten ' +
        'als fehlgeschlagen und der Workflow bricht ab. Aus Sicherheitsgründen sind nur Adressen erlaubt, ' +
        'deren Host auf der HTTP-Allowlist steht — eine leere Allowlist blockiert JEDE Anfrage.',
      prerequisites: [
        'Der Ziel-Host muss auf der HTTP-Allowlist stehen (Einstellungen → Automatisierung → „HTTP-Allowlist (Hosts)“) — bei leerer Liste wird jede Anfrage blockiert.',
        'Nur öffentliche http(s)-Adressen — lokale/interne Adressen (localhost, Firmennetz-IPs) sind immer blockiert.',
      ],
      seeAlso: ['mssql.query', 'logic.set_variable'],
    },
  },

  'mssql.query': {
    fields: [
      {
        key: 'sql',
        type: 'textarea',
        label: 'SQL-Abfrage (nur lesend, SELECT)',
        help:
          'Diese Abfrage wird gegen die eingerichtete MSSQL-Datenbank (z. B. JTL-Wawi) ausgeführt. ' +
          'Nur lesende SELECT-Abfragen sind erlaubt — Schreibbefehle (INSERT, UPDATE, DELETE, …) werden abgelehnt. ' +
          'Platzhalter wie {{email}} werden hier bewusst NICHT ersetzt (Schutz vor eingeschleustem SQL) — ' +
          'für Abfragen mit Absender-Adresse oder Bestellnummer den Knoten „JTL Bestell-Kontext“ verwenden. ' +
          'Max. 8000 Zeichen; leer = Knoten wird übersprungen.',
        example: 'SELECT TOP 10 cFirma, cMail FROM tFirma',
        required: true,
        validation: { maxLength: 8000 },
      },
    ],
    outputs: [
      {
        name: 'mssql.rows',
        label: 'Ergebnis-Zeilen (JSON)',
        description: 'Alle gefundenen Zeilen als JSON-Text (auf 8000 Zeichen gekürzt).',
        example: '[{"cFirma":"Muster GmbH"}]',
        type: 'string',
      },
      {
        name: 'mssql.row_count',
        label: 'Anzahl Zeilen',
        example: '10',
        type: 'number',
      },
    ],
    docs: {
      longHelp:
        'Liest Daten direkt aus der angebundenen MSSQL-Datenbank (typischerweise die JTL-Wawi-Datenbank). ' +
        'Der Knoten ist strikt lesend: Abfragen, die Daten ändern würden, werden vor der Ausführung abgelehnt. ' +
        'Das Ergebnis landet als JSON-Text in mssql.rows — auswerten lässt es sich z. B. mit einem Code-Knoten ' +
        'oder per Platzhalter in einer KI-Anweisung.',
      prerequisites: [
        'Eine funktionierende MSSQL-Verbindung (Einstellungen → MSSQL-Server & JTL: Server, Datenbank, Zugangsdaten).',
      ],
      seeAlso: ['jtl.order_context', 'jtl.lookup', 'code.javascript'],
    },
  },

  'jtl.lookup': {
    fields: [
      {
        key: 'entity',
        type: 'select',
        label: 'Welche Stammdaten abrufen?',
        help:
          'Diese Liste wird aus der JTL-Wawi gelesen und als JSON-Text in der Variable jtl.data abgelegt — ' +
          'z. B. um sie einer KI-Anweisung per {{jtl.data}} mitzugeben.',
        required: true,
        options: [
          { value: 'firmen', label: 'Firmen', description: 'Die in JTL angelegten Firmen/Mandanten.' },
          { value: 'warenlager', label: 'Warenlager', description: 'Alle Lager aus der Wawi.' },
          { value: 'zahlungsarten', label: 'Zahlungsarten', description: 'Z. B. PayPal, Vorkasse, Rechnung.' },
          { value: 'versandarten', label: 'Versandarten', description: 'Z. B. DHL, DPD, Abholung.' },
        ],
      },
      {
        key: 'search',
        type: 'text',
        label: 'Nur Einträge mit diesem Namen',
        help:
          'Filtert die Liste auf Einträge, deren Name diesen Text enthält (Groß-/Kleinschreibung egal). ' +
          'Wird nur in der Server-Edition ausgewertet; die Desktop-App liefert immer die komplette Liste.',
        example: 'DHL',
        advanced: true,
      },
      {
        key: 'limit',
        type: 'number',
        label: 'Höchstens so viele Einträge',
        help: 'Begrenzung der Trefferzahl (1–50, leer = 20). Wird nur in der Server-Edition ausgewertet.',
        example: '20',
        advanced: true,
        validation: { min: 1, max: 50, integer: true },
      },
      {
        key: 'sourceSqliteId',
        type: 'number',
        label: 'Genau ein Eintrag (interne Nummer)',
        help:
          'Nur für Sonderfälle: liefert ausschließlich den Eintrag mit dieser internen Nummer. ' +
          'Wird nur in der Server-Edition ausgewertet.',
        advanced: true,
        validation: { integer: true },
      },
    ],
    outputs: [
      {
        name: 'jtl.data',
        label: 'Stammdaten (JSON)',
        description: 'Die gefundenen Einträge als JSON-Text (auf 8000 Zeichen gekürzt).',
        example: '[{"name":"DHL Paket"}]',
        type: 'string',
      },
      {
        name: 'jtl.entity',
        label: 'Abgerufene Stammdaten-Art',
        description: 'Nur Server-Edition: firmen, warenlager, zahlungsarten oder versandarten.',
        example: 'versandarten',
        type: 'string',
      },
      {
        name: 'jtl.row_count',
        label: 'Anzahl Einträge',
        description: 'Nur Server-Edition gesetzt.',
        example: '4',
        type: 'number',
      },
    ],
    docs: {
      longHelp:
        'Holt einfache JTL-Stammdaten-Listen (Firmen, Warenlager, Zahlungsarten, Versandarten) in die ' +
        'Variable jtl.data. Die Desktop-App liest dafür direkt aus der JTL-Datenbank (MSSQL); ' +
        'die Server-Edition liest aus den zuvor synchronisierten Stammdaten-Kopien. ' +
        'Für Bestell-Daten zu einer konkreten Kundenmail ist „JTL Bestell-Kontext“ der richtige Knoten.',
      prerequisites: [
        'Desktop-App: eine funktionierende MSSQL-Verbindung zur JTL-Datenbank (Einstellungen → MSSQL-Server & JTL).',
        'Server-Edition: die JTL-Stammdaten müssen bereits in den Workspace synchronisiert worden sein.',
      ],
      seeAlso: ['jtl.order_context', 'mssql.query'],
    },
  },

  'jtl.order_context': {
    customWidget: 'jtlOrderContext',
    fields: [
      {
        key: 'query',
        type: 'textarea',
        label: 'SQL-Abfrage (nur lesend, SELECT)',
        help:
          'Lesende Abfrage gegen die JTL-Datenbank. Die beiden Spezial-Platzhalter {{email}} (Absender-Adresse ' +
          'der auslösenden Mail) und {{orderNo}} (Bestellnummer aus der Variable jtl.order_no) werden vom Knoten ' +
          'selbst geprüft und sicher in das SQL eingesetzt — andere {{Platzhalter}} funktionieren hier NICHT. ' +
          'Die Spalten der ersten Ergebnis-Zeile landen als jtl.*-Variablen im Workflow.',
        example: "SELECT TOP 1 cStatus, cTrackingId FROM tBestellung WHERE cEmail = {{email}} ORDER BY dErstellt DESC",
        required: true,
      },
      {
        key: 'mapping',
        type: 'textarea',
        label: 'Spalten umbenennen (optional)',
        help:
          'Legt fest, unter welchem Variablennamen eine Spalte abgelegt wird — Format „Spalte:Variablenname“, ' +
          'mehrere Paare mit Komma trennen. Ohne Eintrag heißt die Variable jtl.<spaltenname> (klein geschrieben).',
        example: 'cStatus:jtl.status, cTrackingId:jtl.tracking',
        placeholder: 'cStatus:jtl.status, dErstellt:jtl.bestelldatum',
      },
      {
        key: 'orderNo',
        type: 'text',
        label: 'Feste Bestellnummer (statt Variable)',
        help:
          'Nur für Sonderfälle/Tests: wird für {{orderNo}} verwendet, wenn die Variable jtl.order_no leer ist. ' +
          'Normalerweise leer lassen — die Bestellnummer kommt aus dem Workflow (z. B. per KI oder Code-Knoten ermittelt).',
        example: 'AU-2026-1234',
        advanced: true,
      },
    ],
    ports: [
      {
        id: 'default',
        label: 'Gefunden',
        description: 'Die Abfrage hat mindestens eine Zeile geliefert — die jtl.*-Variablen sind gefüllt.',
        kind: 'success',
        color: 'emerald',
      },
      {
        id: 'no_match',
        label: 'Nichts gefunden',
        description:
          'Keine passende Bestellung — oder für {{email}}/{{orderNo}} lag kein gültiger Wert vor. ' +
          'Hier z. B. eine Aufgabe zur manuellen Prüfung anlegen.',
        kind: 'branch',
        color: 'amber',
      },
    ],
    outputs: [
      {
        name: 'jtl.context_found',
        label: 'Bestellung gefunden',
        description:
          'true, wenn Daten gefunden wurden. Die Spalten der ersten Zeile stehen zusätzlich als ' +
          'jtl.<spaltenname>-Variablen bereit (bzw. unter den Namen aus dem Umbenennungs-Feld).',
        type: 'boolean',
      },
    ],
    docs: {
      longHelp:
        'Holt zu einer Kundenmail den passenden Bestell-Kontext aus der JTL-Wawi (z. B. Status, Sendungsnummer) ' +
        'und stellt ihn als jtl.*-Variablen bereit — damit KI-Knoten dahinter fundiert antworten können. ' +
        'Die Absender-Adresse ({{email}}) und die Bestellnummer ({{orderNo}}) werden streng geprüft und ' +
        'SQL-sicher eingesetzt; die Abfrage selbst bleibt strikt lesend. Welche Tabellen und Spalten passen, ' +
        'hängt von der eigenen JTL-Installation ab — das SQL wird pro Installation eingerichtet. ' +
        'Dieser Knoten läuft nur in der Server-Edition; die Desktop-App überspringt ihn.',
      prerequisites: [
        'Server-Edition mit eingerichteter MSSQL-Verbindung zur JTL-Datenbank.',
        'Für {{orderNo}}: ein vorheriger Knoten muss die Variable jtl.order_no setzen (oder die feste Bestellnummer unter „Erweitert“ eintragen).',
      ],
      seeAlso: ['jtl.prepare_action', 'mssql.query', 'ai.agent'],
    },
  },

  'jtl.prepare_action': {
    fields: [
      {
        key: 'kind',
        type: 'select',
        label: 'Welche Aktion vorschlagen?',
        help:
          'Der Knoten bereitet diesen Vorschlag nur VOR — ausgeführt wird in JTL nichts. ' +
          'Der Vorschlag (Art + Daten aus den jtl.*-Variablen) landet in den Variablen jtl.action.*.',
        required: true,
        options: [
          { value: 'resend_invoice', label: 'Rechnung erneut senden' },
          { value: 'create_return', label: 'Retoure anlegen' },
          { value: 'send_tracking', label: 'Sendungsverfolgung mitteilen' },
          { value: 'refund_status', label: 'Erstattungs-Status mitteilen' },
          { value: 'custom', label: 'Eigene Aktion (frei definiert)' },
        ],
      },
      {
        key: 'requireApproval',
        type: 'boolean',
        label: 'Vorher von einem Menschen freigeben lassen',
        help:
          'Ein (Standard, empfohlen): der Vorschlag geht zum Ausgang „Freigabe nötig“ — dort z. B. eine ' +
          'Aufgabe anlegen, damit jemand draufschaut. Aus: der Vorschlag geht direkt zum Ausgang „Freigegeben“.',
      },
      {
        key: 'note',
        type: 'textarea',
        label: 'Notiz zum Vorschlag (optional)',
        help:
          'Freier Hinweis für die Person oder den Folge-Schritt, der den Vorschlag bearbeitet (max. 500 Zeichen). ' +
          'Platzhalter wie {{ai.class}} oder {{subject}} werden beim Ausführen ersetzt.',
        example: 'Kunde bittet um erneuten Rechnungsversand, siehe Mail vom {{date}}.',
        interpolate: true,
        validation: { maxLength: 500 },
        advanced: true,
      },
      {
        key: 'orderNo',
        type: 'text',
        label: 'Feste Bestellnummer (statt Variable)',
        help:
          'Nur für Sonderfälle: wird in den Vorschlag übernommen, wenn die Variable jtl.order_no leer ist. ' +
          'Normalerweise leer lassen — die Bestellnummer kommt aus „JTL Bestell-Kontext“ davor.',
        example: 'AU-2026-1234',
        advanced: true,
      },
    ],
    ports: [
      {
        id: 'needs_review',
        label: 'Freigabe nötig',
        description: 'Der Vorschlag wartet auf menschliche Freigabe — hier z. B. eine Aufgabe anlegen.',
        kind: 'branch',
        color: 'amber',
      },
      {
        id: 'approved',
        label: 'Freigegeben',
        description: 'Freigabe-Schalter ist aus: der Vorschlag gilt ohne menschliche Prüfung als freigegeben.',
        kind: 'success',
        color: 'emerald',
      },
    ],
    outputs: [
      {
        name: 'jtl.action.kind',
        label: 'Art der Aktion',
        example: 'send_tracking',
        type: 'string',
      },
      {
        name: 'jtl.action.payload',
        label: 'Aktions-Daten (JSON)',
        description:
          'Art, Absender-Adresse, Bestellnummer, Sendungsnummer (aus jtl.tracking bzw. jtl.tracking_number) und Notiz als JSON-Text.',
        example: '{"kind":"send_tracking","email":"kunde@web.de","orderNo":"AU-1234","tracking":"00340...","note":null}',
        type: 'string',
      },
      {
        name: 'jtl.action.prepared',
        label: 'Vorschlag erstellt',
        type: 'boolean',
      },
    ],
    docs: {
      longHelp:
        'Baut aus dem zuvor geladenen Bestell-Kontext einen kontrollierten Aktions-Vorschlag ' +
        '(z. B. „Sendungsverfolgung mitteilen“) — ausgeführt wird in JTL NICHTS, der Knoten sammelt nur ' +
        'die Daten in den Variablen jtl.action.* und verzweigt nach Freigabe-Bedarf. Das tatsächliche ' +
        'Ausführen ist ein bewusst getrennter, späterer Schritt mit Freigabe und Absicherungen. ' +
        'Dieser Knoten läuft nur in der Server-Edition; die Desktop-App überspringt ihn.',
      prerequisites: [
        'Server-Edition.',
        'Davor „JTL Bestell-Kontext“ ausführen, damit Bestellnummer und Sendungsnummer (jtl.*-Variablen) gefüllt sind.',
      ],
      seeAlso: ['jtl.order_context', 'crm.create_task'],
    },
  },
};
