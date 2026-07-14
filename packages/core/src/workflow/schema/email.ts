import type { WorkflowNodeSchemaExtension } from '../node-schema';

/**
 * Feld-/Port-/Output-Schemata der email.*-Knoten.
 * Muster-Einträge: email.auto_reply (Ports + Outputs), email.send_draft
 * (variableRef), email.sender_filter (Mehrfach-Ports).
 */
export const EMAIL_NODE_SCHEMAS: Record<string, WorkflowNodeSchemaExtension> = {
  'email.read_tracking_evidence': {
    outputs: [
      { name: 'tracking.tracked', label: 'Tracking angelegt', type: 'boolean' },
      { name: 'tracking.transport', label: 'Versandstatus', example: 'smtp_accepted', type: 'string' },
      { name: 'tracking.delivery', label: 'Zustellstatus', example: 'external_system_reached', type: 'string' },
      { name: 'tracking.engagement', label: 'Interaktion', example: 'probable_open', type: 'string' },
      { name: 'tracking.confidence', label: 'Aussagekraft', example: 'medium', type: 'string' },
      { name: 'tracking.open_count', label: 'Anzahl Pixelabrufe', example: '1', type: 'number' },
      { name: 'tracking.click_count', label: 'Anzahl Klicks', example: '0', type: 'number' },
      { name: 'tracking.last_opened_at', label: 'Zuletzt geöffnet', type: 'string' },
      { name: 'tracking.last_clicked_at', label: 'Zuletzt geklickt', type: 'string' },
      { name: 'tracking.replied', label: 'Antwort erhalten', type: 'boolean' },
      { name: 'tracking.replied_at', label: 'Antwortzeitpunkt', type: 'string' },
    ],
    docs: {
      longHelp:
        'Liest die Evidenz zum aktuellen ausgehenden Mail-Datensatz neu aus der Datenbank. ' +
        'Der Knoten gehört nach eine Wartezeit, damit anschließende Bedingungen nicht mit dem Stand beim Versand arbeiten. ' +
        'Pixelabrufe bleiben Wahrscheinlichkeits-Signale; tracking.replied ist die stärkste Interaktion.',
      prerequisites: [
        'Server-Edition mit aktivierter E-Mail-Nachverfolgung.',
        'Der Workflow benötigt eine aktuelle ausgehende Nachricht.',
      ],
      seeAlso: ['logic.delay', 'logic.threshold', 'logic.switch', 'crm.create_task'],
    },
  },

  'email.auto_reply': {
    fields: [
      {
        key: 'confidenceVar',
        type: 'variableRef',
        label: 'Variable mit der KI-Sicherheit',
        help:
          'Aus dieser Workflow-Variable liest das Gate, wie sicher sich die KI bei ihrer Einschätzung ist. ' +
          'Der Knoten „KI-Klassifizierung“ legt seine Sicherheit unter ai.class_confidence ab.',
        example: 'ai.class_confidence',
        placeholder: 'ai.class_confidence',
        required: true,
      },
      {
        key: 'minConfidence',
        type: 'number',
        label: 'Mindest-Sicherheit der KI (0–100)',
        help:
          'Nur wenn die KI sich mindestens so sicher ist, geht es am Ausgang „Erlaubt“ weiter — sonst „Blockiert“. ' +
          '80 bedeutet: nur sehr eindeutige Mails werden automatisch beantwortet.',
        example: '80',
        required: true,
        validation: { min: 0, max: 100, integer: true },
      },
    ],
    ports: [
      {
        id: 'approved',
        label: 'Erlaubt',
        description: 'Automatische Antwort ist erlaubt (Schalter an, Absender ok, Sicherheit hoch genug).',
        kind: 'success',
        color: 'emerald',
      },
      {
        id: 'blocked',
        label: 'Blockiert',
        description:
          'Keine automatische Antwort — z. B. Schalter aus, No-Reply-Absender oder zu geringe Sicherheit. ' +
          'Hier z. B. einen Tag setzen oder eine Aufgabe anlegen, damit die Mail nicht untergeht.',
        kind: 'branch',
        color: 'amber',
      },
    ],
    outputs: [
      {
        name: 'auto_reply.decision',
        label: 'Gate-Entscheidung',
        description: '"approved" oder "blocked".',
        example: 'approved',
        type: 'string',
      },
      {
        name: 'auto_reply.blocked_reason',
        label: 'Blockier-Grund',
        description: 'Warum blockiert wurde (disabled, noreply_sender, low_confidence, …).',
        example: 'low_confidence',
        type: 'string',
      },
      {
        name: 'auto_reply.confidence',
        label: 'Gemessene Sicherheit',
        example: '85',
        type: 'number',
      },
    ],
    docs: {
      longHelp:
        'Sicherheits-Gate vor automatischen Antworten: prüft den globalen Auto-Antwort-Schalter, ' +
        'blockt No-Reply-/Automaten-Absender und verlangt eine Mindest-Sicherheit der KI-Klassifizierung. ' +
        'Der Knoten sendet selbst nichts — er entscheidet nur, ob der Zweig weiterläuft.',
      prerequisites: [
        'Auto-Antwort-Schalter in den Einstellungen aktivieren (sonst blockt das Gate jede Mail).',
        'Davor eine „KI-Klassifizierung“ ausführen, damit die Sicherheits-Variable gefüllt ist.',
      ],
      seeAlso: ['ai.classify', 'ai.pick_canned', 'email.send_draft'],
    },
  },

  'email.send_draft': {
    fields: [
      {
        key: 'draftIdVariable',
        type: 'variableRef',
        label: 'Variable mit der Entwurfs-Nummer',
        help:
          'Die Variable draft.id wird von „Antwort-Entwurf erstellen“, „KI-Agent“ und „KI: Textbaustein wählen“ gesetzt. ' +
          '„Antwortvorschlag erzeugen“ legt KEINEN Entwurf an und funktioniert hier nicht.',
        example: 'draft.id',
        placeholder: 'draft.id',
        required: true,
      },
      {
        key: 'runOutboundReview',
        type: 'boolean',
        label: 'Zusätzlich durch Ausgangs-Workflows prüfen',
        help:
          'Aus (Standard): die Antwort geht direkt raus. Ein: die Antwort durchläuft vor dem Versand ' +
          'die Ausgangs-Workflows (z. B. „KI-Ausgangsprüfung“) — wirkt nur, wenn ein Ausgangs-Workflow aktiv ist.',
      },
      {
        key: 'draftId',
        type: 'number',
        label: 'Feste Entwurfs-Nummer (statt Variable)',
        help:
          'Nur für Sonderfälle: verschickt genau diesen Entwurf und ignoriert die Variable oben. ' +
          'Normalerweise leer lassen — die Nummer kommt aus dem Workflow.',
        example: '123',
        advanced: true,
        validation: { min: 1, integer: true },
      },
    ],
    outputs: [
      {
        name: 'send_draft.draft_id',
        label: 'Versendete Entwurfs-Nummer',
        example: '123',
        type: 'number',
      },
      {
        name: 'send_draft.with_review',
        label: 'Mit Ausgangsprüfung',
        type: 'boolean',
      },
      {
        name: 'email.auto_send_scheduled',
        label: 'Versand eingeplant',
        description: 'true, sobald der Entwurf zum sofortigen Versand eingeplant wurde.',
        type: 'boolean',
      },
    ],
    docs: {
      longHelp:
        'Plant den Versand eines zuvor im Workflow angelegten Entwurfs. Bei eingehenden Mails greifen ' +
        'zusätzlich der Auto-Antwort-Schalter und der No-Reply-Schutz (gleiche Regeln wie am Gate).',
      prerequisites: [
        'Ein vorheriger Knoten muss einen Entwurf anlegen und draft.id setzen.',
        'Bei eingehenden Mails: Auto-Antwort-Schalter in den Einstellungen aktivieren.',
      ],
      seeAlso: ['email.auto_reply', 'ai.pick_canned', 'email.create_draft'],
    },
  },

  'email.sender_filter': {
    fields: [
      {
        key: 'useGlobalLists',
        type: 'boolean',
        label: 'Globale Listen aus den Einstellungen verwenden',
        help: 'Nutzt die unter Einstellungen → E-Mail gepflegte Whitelist/Blacklist zusätzlich zu den Feldern unten.',
      },
      {
        key: 'useBuiltinTrusted',
        type: 'boolean',
        label: 'Bekannte Absender vertrauen (PayPal, Amazon, …)',
        help: 'Mitgelieferte Liste bekannter seriöser Absender — spart KI-Prüfungen für offensichtlich echte Mails.',
      },
      {
        key: 'extraWhitelist',
        type: 'textarea',
        label: 'Zusätzliche vertrauenswürdige Absender',
        help: 'Eine Adresse oder Domain pro Zeile (oder kommagetrennt). Treffer gehen sofort zum Ausgang „Vertrauenswürdig“.',
        example: 'lieferant.de',
        advanced: true,
      },
      {
        key: 'extraBlacklist',
        type: 'textarea',
        label: 'Zusätzliche blockierte Absender',
        help: 'Treffer gehen sofort zum Ausgang „Blockiert“ (z. B. bekannte Spam-Domains).',
        example: 'spamversand.xyz',
        advanced: true,
      },
    ],
    ports: [
      {
        id: 'whitelist',
        label: 'Vertrauenswürdig',
        description: 'Absender steht auf einer Vertrauensliste.',
        kind: 'success',
        color: 'emerald',
      },
      {
        id: 'blacklist',
        label: 'Blockiert',
        description: 'Absender steht auf einer Sperrliste.',
        kind: 'failure',
        color: 'red',
      },
      {
        id: 'default',
        label: 'Unbekannt',
        description: 'Weder Vertrauens- noch Sperrliste — hier z. B. mit der KI-Spam-Prüfung weitermachen.',
        kind: 'branch',
      },
    ],
    outputs: [
      {
        name: 'sender.filter',
        label: 'Filter-Ergebnis',
        example: 'whitelist',
        type: 'string',
      },
    ],
    docs: {
      seeAlso: ['ai.spam_score', 'logic.threshold', 'email.mark_spam'],
    },
  },

  'email.tag': {
    fields: [
      {
        key: 'tag',
        type: 'text',
        label: 'Tag (Schlagwort)',
        help:
          'Dieses Schlagwort wird an die Mail angehängt — für Filter, Sortierung und Folge-Workflows. ' +
          'Tags werden klein geschrieben. Für mehrere Tags einfach mehrere „Tag setzen“-Knoten hintereinander. ' +
          'Platzhalter wie {{ai.class}} werden beim Ausführen ersetzt.',
        example: 'rechnung',
        placeholder: 'z. B. rechnung, support, dringend',
        required: true,
        interpolate: true,
      },
    ],
    docs: {
      longHelp:
        'Hängt der Nachricht ein Schlagwort an. Bleibt das Feld leer, wird der Knoten übersprungen. ' +
        'Tags sind rein lokal — auf dem Mail-Server ändert sich nichts.',
      seeAlso: ['email.tag_attachment_meta', 'email.set_category', 'email.set_priority'],
    },
  },

  'email.mark_seen': {
    docs: {
      longHelp:
        'Markiert die Nachricht lokal als gelesen. Bei IMAP-Konten mit aktiver „Gelesen-Status synchronisieren“-Option ' +
        'wird zusätzlich versucht, das Gelesen-Kennzeichen auf dem Mail-Server zu setzen. Klappt das gerade nicht ' +
        '(z. B. Server nicht erreichbar), holt der nächste Abgleich es automatisch nach.',
      seeAlso: ['email.archive', 'email.move_imap'],
    },
  },

  'email.archive': {
    docs: {
      longHelp:
        'Blendet die Nachricht aus dem Posteingang aus (lokales Archiv). Auf dem Mail-Server wird nichts verschoben — ' +
        'wer die Mail auch dort in einen Ordner legen will, nimmt zusätzlich „IMAP verschieben“.',
      seeAlso: ['email.move_imap', 'email.mark_seen'],
    },
  },

  'email.hold_outbound': {
    fields: [
      {
        key: 'reason',
        type: 'text',
        label: 'Grund der Sperre',
        help:
          'Wird als Hinweis-Banner an der Mail angezeigt, damit klar ist, warum sie nicht rausgeht. ' +
          'Leer = „Workflow“. Platzhalter wie {{ai.class}} werden beim Ausführen ersetzt.',
        example: 'Verdacht auf Zahlungsdaten im Text',
        placeholder: 'z. B. Manueller Versand-Stopp nach 17 Uhr',
        interpolate: true,
      },
    ],
    docs: {
      longHelp:
        'Hält eine ausgehende Mail zurück: sie bleibt liegen, bis die Sperre wieder aufgehoben wird. ' +
        'ACHTUNG: Der Workflow ENDET an diesem Knoten — Folgeknoten werden nicht mehr ausgeführt. ' +
        'Freigeben kann man die Mail manuell im Editor oder über „Versand freigeben“ in einem anderen Workflow.',
      seeAlso: ['email.release_outbound', 'ai.outbound_review'],
    },
  },

  'email.set_category': {
    fields: [
      {
        key: 'path',
        type: 'categoryPath',
        label: 'Kategorie (Pfad)',
        help:
          'Ordnet die Mail dieser Kategorie zu. Unterkategorien mit Schrägstrich trennen — ' +
          'fehlende Kategorien werden automatisch angelegt. Platzhalter wie {{ai.class}} werden beim Ausführen ersetzt.',
        example: 'Support/Beschwerden',
        placeholder: 'Support/Beschwerden',
        required: true,
        interpolate: true,
      },
    ],
    docs: {
      longHelp:
        'Sortiert die Mail in den Kategorie-Baum ein (sichtbar in der Seitenleiste). Bleibt das Feld leer, ' +
        'wird der Knoten übersprungen.',
      seeAlso: ['email.tag', 'ai.classify'],
    },
  },

  'email.forward_copy': {
    fields: [
      {
        key: 'to',
        type: 'textarea',
        label: 'Empfänger',
        help:
          'An diese Adressen geht eine Kopie der Mail. Mehrere Adressen mit Komma oder Semikolon trennen (max. 10). ' +
          'Adressen werden geprüft und Doppelte entfernt. Platzhalter wie {{customer.email}} werden beim Ausführen ersetzt.',
        example: 'buchhaltung@firma.de, chef@firma.de',
        placeholder: 'buchhaltung@firma.de, chef@firma.de',
        required: true,
        interpolate: true,
      },
      {
        key: 'includeAttachments',
        type: 'boolean',
        label: 'Original-Anhänge mitschicken',
        help:
          'Ein: die Anhänge der Original-Mail werden angehängt (insgesamt max. 25 MB, unlesbare Dateien werden übersprungen). ' +
          'Aus (Standard): nur der Text wird weitergeleitet. ' +
          'Desktop-Edition: Anhänge werden noch nicht unterstützt — dort wird nur der Text weitergeleitet (Hinweis im Verlauf).',
      },
      {
        key: 'runOutboundReview',
        type: 'boolean',
        label: 'Zusätzlich durch Ausgangs-Workflows prüfen',
        help:
          'Aus (Standard): die Weiterleitung geht direkt raus. Ein: sie durchläuft vorher die Ausgangs-Workflows — ' +
          'derzeit wird sie dabei sicherheitshalber gestoppt, sobald ein Ausgangs-Workflow aktiv ist.',
        advanced: true,
      },
    ],
    docs: {
      longHelp:
        'Schickt eine Kopie der eingegangenen Mail an feste Empfänger (z. B. Buchhaltung bei Rechnungen). ' +
        'Ein eingebauter Schleifenschutz verhindert, dass dieselbe Mail mehrfach weitergeleitet wird oder ' +
        'automatische Weiterleitungen sich gegenseitig anstoßen. Ohne Empfänger wird der Knoten übersprungen.',
      prerequisites: ['Das E-Mail-Konto der Nachricht muss versenden können (SMTP eingerichtet).'],
      seeAlso: ['email.create_draft', 'email.send_draft'],
    },
  },

  'email.tag_attachment_meta': {
    fields: [
      {
        key: 'tag',
        type: 'text',
        label: 'Tag (Schlagwort)',
        help:
          'Dieses Schlagwort bekommt die Mail NUR, wenn sie mindestens einen Anhang hat — sonst passiert nichts. ' +
          'Platzhalter wie {{ai.class}} werden beim Ausführen ersetzt.',
        example: 'attachment',
        placeholder: 'attachment',
        required: true,
        interpolate: true,
      },
    ],
    docs: {
      longHelp:
        'Kurzform für „wenn Anhang vorhanden → Tag setzen“, ohne dass man eine eigene Bedingung bauen muss.',
      seeAlso: ['email.tag'],
    },
  },

  'email.create_draft': {
    fields: [
      {
        key: 'bodyPrefix',
        type: 'textarea',
        label: 'Text am Anfang der Antwort (optional)',
        help:
          'Dieser Text steht oben im Entwurf, darunter folgt die zitierte Original-Mail. ' +
          'Platzhalter wie {{ai.reply}} oder {{customer.name}} werden beim Ausführen ersetzt.',
        example: 'Sehr geehrte Damen und Herren,',
        placeholder: 'Sehr geehrte Damen und Herren, …',
        interpolate: true,
      },
    ],
    outputs: [
      {
        name: 'draft.id',
        label: 'Entwurfs-Nummer',
        description: 'Nummer des angelegten Entwurfs — kann „Entwurf versenden“ direkt verschicken.',
        example: '123',
        type: 'number',
      },
    ],
    docs: {
      longHelp:
        'Legt einen Antwort-Entwurf auf die aktuelle Mail an (Betreff „Re: …“, Original als Zitat darunter). ' +
        'Der Entwurf wird NICHT gesendet — er landet in den Entwürfen bzw. kann per „Entwurf versenden“ ' +
        'automatisch verschickt werden.',
      seeAlso: ['email.send_draft', 'ai.pick_canned', 'ai.agent'],
    },
  },

  'email.set_priority': {
    fields: [
      {
        key: 'level',
        type: 'select',
        label: 'Priorität',
        help:
          'Setzt das Schlagwort priority:hoch, priority:normal oder priority:niedrig — ' +
          'danach lässt sich der Posteingang filtern und sortieren.',
        required: true,
        options: [
          { value: 'hoch', label: 'Hoch' },
          { value: 'normal', label: 'Normal' },
          { value: 'niedrig', label: 'Niedrig' },
        ],
      },
    ],
    outputs: [
      {
        name: 'email.priority',
        label: 'Gesetzter Prioritäts-Tag',
        example: 'priority:hoch',
        type: 'string',
      },
    ],
    docs: {
      seeAlso: ['email.tag', 'ai.classify'],
    },
  },

  'email.auth_check': {
    fields: [
      {
        key: 'protocol',
        type: 'select',
        label: 'Welche Echtheits-Prüfung auswerten?',
        help:
          'Mail-Server prüfen beim Empfang, ob eine Mail wirklich vom angeblichen Absender stammt. ' +
          'Dieser Knoten wertet das gespeicherte Ergebnis aus. Im Zweifel DMARC wählen — das ist die Gesamt-Bewertung.',
        required: true,
        options: [
          { value: 'dmarc', label: 'DMARC (Gesamt-Bewertung, empfohlen)' },
          { value: 'spf', label: 'SPF (Darf dieser Server für die Domain senden?)' },
          { value: 'dkim', label: 'DKIM (Digitale Unterschrift der Mail)' },
          { value: 'arc', label: 'ARC (Prüfkette bei Weiterleitungen)' },
        ],
      },
      {
        key: 'treatSoftfailAsFail',
        type: 'boolean',
        label: '„Wahrscheinlich gefälscht“ wie „gefälscht“ behandeln',
        help:
          'Ein (Standard): auch unsichere Ergebnisse (Softfail/Policy) gehen zum Ausgang „Nicht bestanden“ — sicherer. ' +
          'Aus: solche Mails laufen über den Ausgang „Sonstiges“.',
      },
    ],
    ports: [
      {
        id: 'pass',
        label: 'Bestanden',
        description: 'Die Echtheits-Prüfung war erfolgreich — der Absender ist sehr wahrscheinlich echt.',
        kind: 'success',
        color: 'emerald',
      },
      {
        id: 'fail',
        label: 'Nicht bestanden',
        description:
          'Die Prüfung ist fehlgeschlagen — die Mail könnte gefälscht sein. ' +
          'Hier z. B. Spam-Status setzen oder zur manuellen Prüfung markieren.',
        kind: 'failure',
        color: 'red',
      },
      {
        id: 'none',
        label: 'Keine Prüfung',
        description: 'Der Absender nutzt diese Prüfung nicht oder es liegt (noch) kein Ergebnis vor.',
        kind: 'branch',
        color: 'amber',
      },
      {
        id: 'default',
        label: 'Sonstiges',
        description: 'Alle übrigen Ergebnisse (z. B. vorübergehender Prüf-Fehler beim Empfang).',
        kind: 'branch',
      },
    ],
    outputs: [
      {
        name: 'auth.check.dmarc',
        label: 'DMARC-Ergebnis',
        description: 'Nur gesetzt, wenn oben DMARC gewählt ist.',
        example: 'pass',
        type: 'string',
      },
      {
        name: 'auth.check.spf',
        label: 'SPF-Ergebnis',
        description: 'Nur gesetzt, wenn oben SPF gewählt ist.',
        example: 'softfail',
        type: 'string',
      },
      {
        name: 'auth.check.dkim',
        label: 'DKIM-Ergebnis',
        description: 'Nur gesetzt, wenn oben DKIM gewählt ist.',
        example: 'pass',
        type: 'string',
      },
      {
        name: 'auth.check.arc',
        label: 'ARC-Ergebnis',
        description: 'Nur gesetzt, wenn oben ARC gewählt ist.',
        example: 'none',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Verzweigt danach, ob die Mail die Echtheits-Prüfung (SPF/DKIM/DMARC/ARC) bestanden hat. ' +
        'Die Ergebnisse werden beim Mail-Abruf gespeichert und hier nur ausgelesen — der Knoten prüft nicht selbst. ' +
        'Direkt nach dem allerersten Eintreffen einer Mail kann das Ergebnis noch fehlen (dann Ausgang „Keine Prüfung“).',
      prerequisites: [
        'Funktioniert nur für empfangene Mails, deren Prüf-Ergebnisse beim Abruf gespeichert wurden.',
      ],
      seeAlso: ['email.sender_filter', 'ai.spam_score', 'email.set_spam_status'],
    },
  },

  'email.set_spam_status': {
    fields: [
      {
        key: 'status',
        type: 'select',
        label: 'Neuer Spam-Status',
        help:
          '„Sauber“ = keine Werbung/kein Betrug. „Manuell prüfen“ = unsicher, ein Mensch soll draufschauen. ' +
          '„Spam“ = unerwünschte Mail.',
        required: true,
        options: [
          { value: 'clean', label: 'Sauber' },
          { value: 'review', label: 'Manuell prüfen' },
          { value: 'spam', label: 'Spam' },
        ],
      },
      {
        key: 'train',
        type: 'boolean',
        label: 'Lokalen Spam-Filter mitlernen lassen',
        help:
          'Ein: die Mail wird als Lern-Beispiel für den eingebauten Spam-Filter verwendet, ' +
          'der dadurch mit der Zeit besser wird. Aus (Standard): nur der Status wird gesetzt.',
      },
      {
        key: 'tag',
        type: 'text',
        label: 'Zusätzlicher Tag (optional)',
        help: 'Wird zusätzlich zum Status als Schlagwort gesetzt — z. B. um nachzuvollziehen, welcher Workflow entschieden hat.',
        example: 'ki-spam-verdacht',
        interpolate: true,
        advanced: true,
      },
    ],
    outputs: [
      {
        name: 'spam.status',
        label: 'Gesetzter Spam-Status',
        description: 'clean, review oder spam.',
        example: 'review',
        type: 'string',
      },
      {
        name: 'email.is_spam',
        label: 'Ist Spam',
        description: 'true nur bei Status „Spam“.',
        type: 'boolean',
      },
    ],
    docs: {
      longHelp:
        'Setzt den lokalen Spam-Status der Mail (dreistufig: sauber / manuell prüfen / spam). ' +
        'Die Mail wird dabei NICHT verschoben — dafür „Als Spam markieren“ mit IMAP-Verschiebung oder „IMAP verschieben“ nutzen.',
      seeAlso: ['email.mark_spam', 'ai.spam_score', 'email.sender_filter'],
    },
  },

  'email.mark_spam': {
    fields: [
      {
        key: 'spam',
        type: 'boolean',
        label: 'Als Spam markieren',
        help:
          'Ein (Standard): die Mail wird als Spam markiert. Aus: die Markierung wird entfernt, ' +
          'die Mail gilt wieder als sauber (z. B. um Fehlentscheidungen zurückzunehmen).',
      },
      {
        key: 'tag',
        type: 'text',
        label: 'Zusätzlicher Tag',
        help: 'Wird zusätzlich als Schlagwort gesetzt, damit man automatisch markierte Mails wiederfindet. Leer = kein Tag.',
        example: 'auto-spam',
        interpolate: true,
      },
      {
        key: 'moveImap',
        type: 'boolean',
        label: 'Auf dem Mail-Server in den Spam-Ordner verschieben',
        help:
          'Ein: die Mail wird zusätzlich auf dem IMAP-Server in den Ordner „Spam“ verschoben — ' +
          'dann sieht sie auch das Handy-Postfach als Spam. Wirkt nur beim Markieren als Spam, nicht beim Entfernen.',
      },
      {
        key: 'train',
        type: 'boolean',
        label: 'Lokalen Spam-Filter mitlernen lassen',
        help: 'Ein: die Mail wird als Lern-Beispiel für den eingebauten Spam-Filter verwendet.',
        advanced: true,
      },
    ],
    outputs: [
      {
        name: 'email.is_spam',
        label: 'Ist Spam',
        type: 'boolean',
      },
      {
        name: 'spam.status',
        label: 'Gesetzter Spam-Status',
        description: '"spam" beim Markieren, "clean" beim Entfernen der Markierung.',
        example: 'spam',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Markiert die Mail als Spam (oder hebt die Markierung auf) und kann sie zusätzlich auf dem Mail-Server ' +
        'in den Spam-Ordner verschieben. Für die feinere Dreiteilung sauber/prüfen/spam gibt es „Spam-Status setzen“.',
      prerequisites: ['Für die Server-Verschiebung: IMAP-Konto (bei anderen Kontotypen wird nur lokal markiert).'],
      seeAlso: ['email.set_spam_status', 'email.move_imap', 'ai.spam_score'],
    },
  },

  'email.assign': {
    fields: [
      {
        key: 'teamMemberId',
        type: 'teamMember',
        label: 'Team-Mitglied',
        help:
          'Diesem Team-Mitglied wird die Mail zugewiesen — sie erscheint bei ihm im Posteingangs-Filter „Mir zugewiesen“. ' +
          'Team-Mitglieder werden unter Einstellungen → Team gepflegt. Leer = bestehende Zuweisung entfernen.',
      },
    ],
    outputs: [
      {
        name: 'email.assigned_to',
        label: 'Zugewiesenes Team-Mitglied',
        description: 'Kennung des Team-Mitglieds; leer, wenn die Zuweisung entfernt wurde.',
        type: 'string',
      },
    ],
    docs: {
      prerequisites: ['Mindestens ein Team-Mitglied unter Einstellungen → Team anlegen.'],
      seeAlso: ['crm.create_task', 'email.set_priority'],
    },
  },

  'email.move_imap': {
    fields: [
      {
        key: 'folderPath',
        type: 'text',
        label: 'Zielordner auf dem Mail-Server',
        help:
          'Name des IMAP-Ordners, in den die Mail verschoben wird — genau so schreiben, wie er im Mail-Programm heißt. ' +
          'Unterordner mit Schrägstrich trennen. Platzhalter wie {{ai.class}} werden beim Ausführen ersetzt.',
        example: 'Rechnungen',
        placeholder: 'z. B. Rechnungen oder INBOX/Archiv/2026',
        required: true,
        interpolate: true,
      },
    ],
    outputs: [
      {
        name: 'imap.moved_to',
        label: 'Zielordner',
        example: 'Rechnungen',
        type: 'string',
      },
      {
        name: 'messageId',
        label: 'Nachrichten-Nummer',
        description: 'Interne Nummer der verschobenen Nachricht.',
        type: 'number',
      },
    ],
    docs: {
      longHelp:
        'Verschiebt die Mail auf dem IMAP-Server in den angegebenen Ordner — die Änderung ist also auch am Handy ' +
        'und im Webmail sichtbar. Der Zielordner muss bereits existieren; die lokale Ansicht zieht beim nächsten Abgleich nach.',
      prerequisites: [
        'IMAP-Konto (bei anderen Kontotypen nicht verfügbar).',
        'Der Zielordner muss auf dem Server bereits existieren.',
      ],
      seeAlso: ['email.archive', 'email.mark_spam', 'email.delete_server'],
    },
  },

  'email.delete_server': {
    docs: {
      longHelp:
        'Löscht die Mail endgültig auf dem IMAP-Server und markiert sie lokal als gelöscht — NICHT wiederherstellbar. ' +
        'Als Schutz muss die Server-Löschung pro E-Mail-Konto ausdrücklich erlaubt werden, sonst bricht der Knoten ' +
        'mit einem Fehler ab. Für Aufräumen ohne Datenverlust besser „IMAP verschieben“ oder „Archivieren“ verwenden.',
      prerequisites: [
        'Server-Löschung in den Konto-Einstellungen des betroffenen E-Mail-Kontos ausdrücklich aktivieren.',
        'IMAP-Konto (bei anderen Kontotypen nicht verfügbar).',
      ],
      seeAlso: ['email.move_imap', 'email.archive'],
    },
  },

  'email.release_outbound': {
    fields: [
      {
        key: 'autoSend',
        type: 'boolean',
        label: 'Nach Freigabe sofort senden',
        help:
          'Ein (Standard): der geprüfte Entwurf wird direkt zur Zustellung eingeplant. ' +
          'Aus: nur die Sperre wird gelöst — gesendet wird erst nach manuellem Klick. ' +
          'Wirkt nur in Ausgangs-Workflows; bei anderen Auslösern wird immer nur die Sperre entfernt.',
      },
    ],
    outputs: [
      {
        name: 'email.outbound_hold',
        label: 'Versand gesperrt',
        description: 'Nach diesem Knoten immer false — die Sperre ist aufgehoben.',
        type: 'boolean',
      },
      {
        name: 'email.auto_send_scheduled',
        label: 'Versand eingeplant',
        description: 'true, wenn der Entwurf zum sofortigen Versand eingeplant wurde (nur in Ausgangs-Workflows).',
        type: 'boolean',
      },
    ],
    docs: {
      longHelp:
        'Gegenstück zu „Versand sperren“: hebt die Ausgangssperre auf — typischerweise am OK-Ausgang der ' +
        'KI-Ausgangsprüfung. Die Freigabe gilt für den aktuellen Inhalt des Entwurfs: wird er danach noch bearbeitet, ' +
        'ist eine neue Prüfung nötig, bevor gesendet wird.',
      seeAlso: ['email.hold_outbound', 'ai.outbound_review', 'email.send_draft'],
    },
  },
};
