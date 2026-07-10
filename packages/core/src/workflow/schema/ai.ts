import type { WorkflowNodeSchemaExtension } from '../node-schema';

/**
 * Feld-/Port-/Output-Schemata der ai.*-Knoten.
 * Muster-Einträge: ai.classify (aiProfile + select), ai.pick_canned.
 */
export const AI_NODE_SCHEMAS: Record<string, WorkflowNodeSchemaExtension> = {
  'ai.review': {
    fields: [
      {
        key: 'promptId',
        type: 'promptId',
        label: 'KI-Prompt (Prüfauftrag)',
        help:
          'Der Prompt beschreibt, WAS geprüft werden soll (z. B. „Enthält die Mail Beleidigungen?“). ' +
          'Prompts werden unter Einstellungen → E-Mail → KI angelegt. ' +
          'Leer/0 = der erste vorhandene Prompt wird verwendet.',
      },
      {
        key: 'blockKeyword',
        type: 'text',
        label: 'Blockwort',
        help:
          'Enthält die KI-Antwort dieses Wort (Groß-/Kleinschreibung egal), gilt die Prüfung als „nicht bestanden“: ' +
          'Bei ausgehenden Mails wird der Versand angehalten, bei eingehenden bekommt die Mail den Tag ki-review-block. ' +
          'Leer = Standardwort BLOCK.',
        example: 'BLOCK',
      },
      {
        key: 'profileId',
        type: 'aiProfile',
        label: 'KI-Profil (Anbieter & Modell)',
        help:
          'Welches KI-Modell prüfen soll. Leer = das im gewählten Prompt hinterlegte Profil, ' +
          'sonst das Standard-Profil aus den Einstellungen.',
      },
    ],
    docs: {
      longHelp:
        'Freie KI-Prüfung mit eigenem Prompt: Die KI liest den Mail-Text und antwortet mit OK oder dem Blockwort. ' +
        'Bei ausgehenden Mails wird der Entwurf bei einem Treffer angehalten (Versand-Stopp mit Begründung), ' +
        'bei eingehenden wird nur der Tag ki-review-block gesetzt und der Workflow läuft normal weiter — ' +
        'der Knoten verzweigt NICHT in einen eigenen Ausgang. ' +
        'Schlägt der KI-Aufruf fehl, wird sicherheitshalber blockiert (ausgehend: Versand-Stopp).',
      prerequisites: [
        'Mindestens ein KI-Prompt (Einstellungen → E-Mail → KI) — sonst bricht der Knoten mit „Prompt nicht gefunden“ ab.',
        'Ein KI-Profil mit API-Schlüssel.',
      ],
      seeAlso: ['ai.outbound_review', 'email.hold_outbound'],
    },
  },

  'ai.outbound_review': {
    fields: [
      {
        key: 'promptId',
        type: 'promptId',
        label: 'KI-Prompt (optional)',
        help:
          'Eigener Prüfauftrag statt der eingebauten Standard-Prüfung. ' +
          'Leer/0 = Standard: professioneller Ton, korrekte Anrede, Rechtschreibung, ' +
          'versprochene-aber-fehlende Anhänge, keine Antwort auf Phishing/Betrugs-Mails.',
      },
      {
        key: 'checkReplyContext',
        type: 'boolean',
        label: 'Ursprüngliche Mail mitprüfen',
        help:
          'Ist die ausgehende Mail eine Antwort, bekommt die KI auch die Original-Nachricht zu sehen ' +
          '(Absender, Betreff, Textauszug, Spam-Markierung). So erkennt sie z. B. Antworten auf Betrugs-Mails.',
      },
      {
        key: 'profileId',
        type: 'aiProfile',
        label: 'KI-Profil (Anbieter & Modell)',
        help:
          'Welches KI-Modell prüfen soll. Leer = das im gewählten Prompt hinterlegte Profil, ' +
          'sonst das Standard-Profil aus den Einstellungen.',
      },
    ],
    docs: {
      longHelp:
        'Qualitätskontrolle vor dem Versand: prüft ausgehende Mails auf Ton, Anrede, Rechtschreibung, ' +
        'fehlende Anhänge und Antworten auf Betrugs-Mails. Bei Beanstandung wird der Entwurf angehalten — ' +
        'er erscheint im Postfach mit gelbem Hinweis und der deutschen Begründung der KI. ' +
        'Schlägt der KI-Aufruf fehl, wird sicherheitshalber ebenfalls angehalten (fail-closed). ' +
        'Der Knoten wirkt nur in Ausgangs-Workflows; bei eingehenden Mails wird er übersprungen.',
      prerequisites: [
        'Ein KI-Profil mit API-Schlüssel.',
        'Der Workflow muss als Ausgangs-Workflow laufen (Auslöser: ausgehende E-Mail).',
      ],
      seeAlso: ['ai.review', 'email.send_draft', 'email.hold_outbound'],
    },
  },

  'ai.transform_text': {
    fields: [
      {
        key: 'promptId',
        type: 'promptId',
        label: 'KI-Prompt (Bearbeitungs-Auftrag)',
        help:
          'Der Prompt sagt der KI, was sie mit dem Mail-Text machen soll — z. B. zusammenfassen, ' +
          'übersetzen oder höflich umformulieren. Prompts werden unter Einstellungen → E-Mail → KI angelegt. ' +
          'Leer/0 = der erste vorhandene Prompt wird verwendet.',
      },
      {
        key: 'targetVariable',
        type: 'variableName',
        label: 'Ergebnis speichern als Variable',
        help:
          'Unter diesem Namen legt der Knoten den bearbeiteten Text ab. Folge-Knoten können ihn ' +
          'dann als {{Name}} einsetzen — z. B. in „Antwort-Entwurf erstellen“ oder „Aufgabe anlegen“.',
        example: 'ai.text',
        placeholder: 'ai.text',
      },
      {
        key: 'profileId',
        type: 'aiProfile',
        label: 'KI-Profil (Anbieter & Modell)',
        help:
          'Welches KI-Modell den Text bearbeiten soll. Leer = das im gewählten Prompt hinterlegte Profil, ' +
          'sonst das Standard-Profil aus den Einstellungen.',
      },
    ],
    outputs: [
      {
        name: 'ai.text',
        label: 'Bearbeiteter Text',
        description: 'Die Antwort der KI — der Variablenname kommt aus dem Feld „Ergebnis speichern als Variable“.',
        example: 'Kurzfassung: Kunde fragt nach dem Lieferstatus …',
        type: 'string',
        dynamicFromField: 'targetVariable',
      },
    ],
    docs: {
      longHelp:
        'Schickt den Mail-Text mit deinem Prompt an die KI und legt das Ergebnis als Workflow-Variable ab. ' +
        'Der Knoten verändert die Mail selbst nicht — er erzeugt nur Text für nachfolgende Knoten ' +
        '(Zusammenfassung, Übersetzung, Stichpunkte, …).',
      prerequisites: [
        'Mindestens ein KI-Prompt (Einstellungen → E-Mail → KI) — sonst bricht der Knoten mit „Prompt nicht gefunden“ ab.',
        'Ein KI-Profil mit API-Schlüssel.',
      ],
      seeAlso: ['logic.set_variable', 'email.create_draft', 'ai.agent'],
    },
  },

  'ai.spam_score': {
    fields: [
      {
        key: 'contextMode',
        type: 'select',
        label: 'Was darf die KI von der Mail sehen?',
        help:
          '„Nur Kopfdaten“ schickt Betreff, Absender und Anhangs-Namen an die KI (datensparsam, DSGVO-freundlich). ' +
          '„Kompletten Text“ schickt auch den Mail-Inhalt — genauer, aber der Volltext geht an den KI-Anbieter.',
        options: [
          { value: 'metadata', label: 'Nur Kopfdaten (empfohlen)' },
          { value: 'full', label: 'Kompletten Text senden' },
        ],
      },
      {
        key: 'profileId',
        type: 'aiProfile',
        label: 'KI-Profil (Anbieter & Modell)',
        help:
          'Welches KI-Modell die Spam-Wahrscheinlichkeit schätzen soll. Leer = Standard-Profil aus den Einstellungen.',
      },
      {
        key: 'customPrompt',
        type: 'textarea',
        label: 'Eigener Prüf-Text (optional)',
        help:
          'Ersetzt die eingebaute Aufbereitung der Kopfdaten durch deinen eigenen Text an die KI. ' +
          'Platzhalter wie {{subject}} oder {{from_address}} werden vorher gefüllt. ' +
          'Die KI muss trotzdem nur mit einer Zahl 1–100 antworten. Leer = Standard verwenden.',
        example: 'Bewerte diese Mail von {{from_address}} mit Betreff „{{subject}}“. Newsletter zählen bei uns NICHT als Spam.',
        // Kein interpolate-Flag: der Knoten interpoliert selbst mit dem ggf.
        // metadaten-reduzierten Kontext (der zentrale Pre-Pass würde
        // {{body_text}} auch im "Nur Kopfdaten"-Modus füllen — Datenschutz).
        advanced: true,
      },
    ],
    outputs: [
      {
        name: 'ai.spam_score',
        label: 'Spam-Wahrscheinlichkeit (1–100)',
        description:
          '1 = sicher kein Spam, 100 = sehr wahrscheinlich Spam. ' +
          'Danach typischerweise mit „Schwellwert“ verzweigen (z. B. ab 70 als Spam behandeln).',
        example: '85',
        type: 'number',
      },
      {
        name: 'ai.spam_context',
        label: 'Verwendeter Kontext',
        description: '"metadata" (nur Kopfdaten) oder "full" (kompletter Text).',
        example: 'metadata',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Die KI schätzt, wie wahrscheinlich die Mail Spam ist, und legt die Zahl in ai.spam_score ab. ' +
        'Der Knoten markiert selbst nichts als Spam — dafür danach „Schwellwert“ und „Als Spam markieren“ verwenden. ' +
        'Tipp: davor den Absender-Filter setzen, damit bekannte Absender gar nicht erst geprüft werden.',
      prerequisites: ['Ein KI-Profil mit API-Schlüssel (Einstellungen → E-Mail → KI).'],
      seeAlso: ['logic.threshold', 'email.sender_filter', 'email.mark_spam'],
    },
  },

  'ai.draft_reply': {
    fields: [
      {
        key: 'systemPrompt',
        type: 'textarea',
        label: 'Auftrag an die KI (System-Prompt)',
        // Bewusst NICHT required: der Knoten läuft auch mit leerem Feld —
        // dann mit generischem Standard-Auftrag. Ein Pflicht-Flag würde beim
        // Speichern fälschlich „wird übersprungen" warnen.
        help:
          'Beschreibt, WIE die KI antworten soll: Rolle, Tonfall, was erlaubt ist und was nicht. ' +
          'Anrede und Grußformel/Signatur werden automatisch ergänzt — die KI soll nur den Antworttext schreiben. ' +
          'Leer = generischer Standard-Auftrag („Beantworte die Kundenmail freundlich auf Deutsch“) — für den Echtbetrieb bitte einen eigenen Auftrag formulieren.',
        example:
          'Du bist der Kundenservice von Muster GmbH. Antworte freundlich und knapp. Bei Retouren immer auf das Retourenportal verweisen.',
        interpolate: true,
      },
      {
        key: 'knowledgeBaseId',
        type: 'knowledgeBase',
        label: 'Wissensbasis',
        help:
          'Aus dieser Wissensbasis bekommt die KI passende Auszüge zur Kundenmail (FAQ, Richtlinien, Produktinfos). ' +
          '„Automatisch" nimmt die für eingehende Mails hinterlegten Wissensbasen.',
      },
      {
        key: 'profileId',
        type: 'aiProfile',
        label: 'KI-Profil (Anbieter & Modell)',
        help: 'Welches KI-Modell den Entwurf schreibt. Leer = Standard-Profil aus den Einstellungen.',
      },
      {
        key: 'includeCanned',
        type: 'boolean',
        label: 'Textbausteine als Formulierungshilfe mitgeben',
        help:
          'Gibt der KI bis zu 5 Textbausteine als Vorlage mit — sie übernimmt bewährte Formulierungen, ' +
          'statt frei zu erfinden.',
      },
      {
        key: 'greeting',
        type: 'select',
        label: 'Anrede',
        help: 'Automatisch: „Sehr geehrte/r …" bzw. „Guten Tag …" aus Kundendaten oder Absender-Namen.',
        options: [
          { value: 'auto', label: 'Automatisch ergänzen (empfohlen)' },
          { value: 'none', label: 'Keine Anrede einfügen' },
        ],
      },
      {
        key: 'signature',
        type: 'select',
        label: 'Grußformel / Signatur',
        help: 'Hängt die Signatur des E-Mail-Kontos an (Einstellungen → E-Mail → Signaturen).',
        options: [
          { value: 'account', label: 'Konto-Signatur anhängen (empfohlen)' },
          { value: 'none', label: 'Keine Signatur' },
        ],
      },
    ],
    outputs: [
      {
        name: 'draft.id',
        label: 'Entwurfs-Nummer',
        description: 'Der fertig adressierte Antwort-Entwurf — z. B. für „KI-Gegenprüfung" und „Entwurf versenden".',
        example: '123',
        type: 'number',
      },
      { name: 'ai.draft.text', label: 'Entwurfstext (mit Anrede/Signatur)', type: 'string' },
      { name: 'ai.draft.subject', label: 'Betreff des Entwurfs', example: 'Re: Frage zu Bestellung 1234', type: 'string' },
      { name: 'ai.draft.sources', label: 'Verwendete Wissensbasis-Quellen', type: 'string' },
    ],
    docs: {
      longHelp:
        'Agent 1 der Zwei-Stufen-KI-Antwort: schreibt mit deinem Auftrag (System-Prompt) und der Wissensbasis ' +
        'eine vollständige Antwort, ergänzt Anrede und Konto-Signatur und legt einen korrekt adressierten ' +
        'Antwort-Entwurf mit Thread-Bezug an. Der Entwurf wird als automatische Antwort markiert (RFC 3834). ' +
        'Versendet wird hier noch nichts — danach „KI-Gegenprüfung (Entwurf)" und „Entwurf versenden" anschließen.',
      prerequisites: [
        'Ein KI-Profil mit API-Schlüssel (Einstellungen → E-Mail → KI).',
        'Empfohlen: eine Wissensbasis mit FAQ/Richtlinien, damit die Antworten fachlich stimmen.',
      ],
      seeAlso: ['ai.review_draft', 'email.send_draft', 'email.auto_reply', 'ai.pick_canned'],
    },
  },

  'ai.review_draft': {
    fields: [
      {
        key: 'draftIdVariable',
        type: 'variableRef',
        label: 'Variable mit der Entwurfs-Nummer',
        help: 'Standard draft.id — wird von „KI-Antwort entwerfen", „KI: Textbaustein wählen" oder „Antwort-Entwurf erstellen" gesetzt.',
        example: 'draft.id',
        placeholder: 'draft.id',
        required: true,
      },
      {
        key: 'reviewPrompt',
        type: 'textarea',
        label: 'Zusätzliche Prüf-Kriterien (optional)',
        help:
          'Eigene Regeln für die Gegenprüfung — z. B. „Keine Rabatte über 10 % zusagen" oder ' +
          '„Bei Widerruf immer an einen Menschen". Die Grundprüfung (Frage beantwortet? Ton ok? nichts erfunden?) läuft immer.',
        example: 'Preiszusagen und Liefertermine dürfen nie automatisch rausgehen.',
        interpolate: true,
      },
      {
        key: 'profileId',
        type: 'aiProfile',
        label: 'KI-Profil (Anbieter & Modell)',
        help:
          'Welches Modell gegenliest. Tipp: hier ein anderes (gern stärkeres) Modell wählen als beim Entwerfen — ' +
          'vier Augen sehen mehr als zwei.',
      },
    ],
    ports: [
      {
        id: 'send',
        label: 'Senden',
        description: 'Die Gegenlese-KI hält den Entwurf für versandfertig — hier „Entwurf versenden" anschließen.',
        kind: 'success',
        color: 'emerald',
        synonyms: ['senden'],
      },
      {
        id: 'hold',
        label: 'Prüfen',
        description:
          'Der Entwurf bleibt liegen und wartet im Posteingang auf menschliche Freigabe („Wartet auf Freigabe"-Banner). ' +
          'Hier z. B. einen Tag setzen oder eine Aufgabe anlegen.',
        kind: 'branch',
        color: 'amber',
        synonyms: ['halten', 'prüfen'],
      },
    ],
    outputs: [
      {
        name: 'ai.review.verdict',
        label: 'Prüf-Ergebnis',
        description: '"send" oder "hold".',
        example: 'hold',
        type: 'string',
      },
      {
        name: 'ai.review.answered',
        label: 'Kundenfrage beantwortet?',
        type: 'boolean',
      },
      {
        name: 'ai.review.reason',
        label: 'Begründung der Prüf-KI',
        example: 'Liefertermin-Zusage ohne Beleg — bitte manuell prüfen.',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Agent 2 der Zwei-Stufen-KI-Antwort: liest den Entwurf gegen die ursprüngliche Kundenmail gegen ' +
        '(Frage vollständig beantwortet? Ton professionell? nichts erfunden?) und entscheidet. ' +
        '„Senden" führt zum Versand-Zweig; „Prüfen" markiert den Entwurf neutral als „Wartet auf Freigabe" — ' +
        'ein Mensch entscheidet dann im Posteingang per Klick („Jetzt senden" / „Als Entwurf behalten"). ' +
        'Fail-safe: bei unklarer KI-Antwort oder KI-Fehler geht es IMMER auf „Prüfen", nie auf „Senden".',
      prerequisites: [
        'Ein vorheriger Knoten muss einen Entwurf anlegen (draft.id) — z. B. „KI-Antwort entwerfen".',
        'Ein KI-Profil mit API-Schlüssel.',
      ],
      seeAlso: ['ai.draft_reply', 'email.send_draft', 'email.auto_reply'],
    },
  },

  'ai.classify': {
    fields: [
      {
        key: 'labels',
        type: 'text',
        label: 'Mögliche Kategorien (mit Komma getrennt)',
        help:
          'Die KI ordnet jede Mail GENAU EINER dieser Kategorien zu. Einfach die Namen mit Komma auflisten — ' +
          'die Kategorie landet in der Variable ai.class, die Sicherheit (0–100) in ai.class_confidence.',
        example: 'Frage, Bestellstatus, Reklamation, Sonstiges',
        required: true,
      },
      {
        key: 'contextMode',
        type: 'select',
        label: 'Was darf die KI von der Mail sehen?',
        help:
          '„Nur Kopfdaten“ schickt Betreff, Absender und Anhangs-Namen an die KI (datensparsam, DSGVO-freundlich). ' +
          '„Kompletten Text“ schickt auch den Mail-Inhalt — genauer, aber der Volltext geht an den KI-Anbieter.',
        options: [
          { value: 'metadata', label: 'Nur Kopfdaten (empfohlen)' },
          { value: 'full', label: 'Kompletten Text senden' },
        ],
      },
      {
        key: 'profileId',
        type: 'aiProfile',
        label: 'KI-Profil (Anbieter & Modell)',
        help:
          'Welches KI-Modell klassifizieren soll. Leer = Standard-Profil aus den Einstellungen. ' +
          'Profile werden unter Einstellungen → E-Mail → KI verwaltet.',
        advanced: true,
      },
    ],
    outputs: [
      {
        name: 'ai.class',
        label: 'Erkannte Kategorie',
        description: 'Eine der oben angegebenen Kategorien.',
        example: 'Reklamation',
        type: 'string',
      },
      {
        name: 'ai.class_confidence',
        label: 'Sicherheit der KI (0–100)',
        description:
          'Selbsteinschätzung des Modells, wie sicher es sich bei der Kategorie ist. ' +
          'Kann vom Auto-Antwort-Gate oder „Schwellwert“ ausgewertet werden.',
        example: '85',
        type: 'number',
      },
    ],
    docs: {
      longHelp:
        'Sortiert die Mail per KI in genau eine der angegebenen Kategorien und vergibt zusätzlich den Tag ki:<Kategorie>. ' +
        'Danach verzweigt man typischerweise mit dem Knoten „Schalter“ nach ai.class.',
      prerequisites: ['Ein KI-Profil mit API-Schlüssel (Einstellungen → E-Mail → KI).'],
      seeAlso: ['logic.switch', 'email.auto_reply'],
    },
  },

  'ai.agent': {
    fields: [
      {
        key: 'systemPrompt',
        type: 'textarea',
        label: 'Anweisung an die KI (System-Prompt)',
        // Bewusst NICHT required: der Knoten läuft auch mit leerem Feld
        // weiter (dann ohne Rollen-Anweisung). Ein Pflicht-Flag würde beim
        // Speichern fälschlich „wird übersprungen" warnen.
        help:
          'Beschreibt Rolle und Verhalten des Agenten — z. B. wie er antworten soll, in welchem Ton, ' +
          'was er auf keinen Fall zusagen darf. Platzhalter wie {{customer.name}} oder {{subject}} werden gefüllt. ' +
          'Die Mail und die gefundenen Wissensbasis-Auszüge bekommt die KI automatisch dazu. ' +
          'Leer = KI läuft ohne Rollen-Anweisung — für den Echtbetrieb bitte ausfüllen.',
        example: 'Du bist der Support-Assistent der Firma Muster GmbH. Antworte freundlich, kurz und per Sie. Nutze die Wissensbasis.',
        interpolate: true,
      },
      {
        key: 'knowledgeBaseId',
        type: 'knowledgeBase',
        label: 'Wissensbasis',
        help:
          'Aus dieser Wissensbasis bekommt die KI die 5 passendsten Textauszüge zur Mail. ' +
          'Leer = automatische Auswahl: die dem Postfach/der Richtung zugeordneten Wissensbasen werden durchsucht.',
      },
      {
        key: 'profileId',
        type: 'aiProfile',
        label: 'KI-Profil (Anbieter & Modell)',
        help: 'Welches KI-Modell antworten soll. Leer = Standard-Profil aus den Einstellungen.',
      },
      {
        key: 'createDraft',
        type: 'boolean',
        label: 'Antwort-Entwurf direkt anlegen',
        help:
          'Legt die KI-Antwort als Antwort-Entwurf („Re: …“) an und setzt die Variable draft.id — ' +
          'die kann „Entwurf versenden“ direkt verschicken. Achtung: der Entwurf hat noch KEINEN Empfänger eingetragen.',
      },
    ],
    outputs: [
      {
        name: 'ai.agent.response',
        label: 'Antwort der KI',
        description: 'Der komplette Text, den der Agent erzeugt hat.',
        type: 'string',
      },
      {
        name: 'ai.agent.source_count',
        label: 'Anzahl genutzter Wissens-Auszüge',
        example: '3',
        type: 'number',
      },
      {
        name: 'ai.agent.sources',
        label: 'Titel der Wissens-Auszüge',
        description: 'Kommagetrennte Titel der Fundstellen aus der Wissensbasis.',
        example: 'Rückgabebedingungen, Versandkosten',
        type: 'string',
      },
      {
        name: 'draft.id',
        label: 'Entwurfs-Nummer',
        description: 'Nur gesetzt, wenn „Entwurf direkt anlegen“ aktiv ist und der Workflow auf einer Mail läuft.',
        example: '123',
        type: 'number',
      },
    ],
    docs: {
      longHelp:
        'Frei konfigurierbarer KI-Assistent: liest die Mail, sucht passende Auszüge in der Wissensbasis ' +
        'und erzeugt daraus eine Antwort nach deiner Anweisung. Optional legt er die Antwort gleich als ' +
        'Entwurf an (draft.id) — versendet wird aber erst durch einen „Entwurf versenden“-Knoten dahinter.',
      prerequisites: [
        'Ein KI-Profil mit API-Schlüssel (Einstellungen → E-Mail → KI).',
        'Für fundierte Antworten: eine gefüllte Wissensbasis (Einstellungen → E-Mail → Wissensbasis) — ohne sie antwortet die KI nur aus der Mail heraus.',
      ],
      seeAlso: ['email.send_draft', 'ai.pick_canned', 'ai.transform_text'],
    },
  },

  'ai.reply_suggestion': {
    fields: [
      {
        key: 'promptId',
        type: 'promptId',
        label: 'KI-Prompt (optional)',
        help:
          'Eigener Prompt für den Antwortvorschlag. Leer/0 = der Standard-Prompt aus ' +
          'Einstellungen → E-Mail → KI → Antwortvorschläge.',
      },
      {
        key: 'skipIfReady',
        type: 'boolean',
        label: 'Überspringen, wenn schon ein Vorschlag existiert',
        help:
          'An (empfohlen): Hat die Mail bereits einen fertigen Vorschlag, wird keine neue (kostenpflichtige) ' +
          'KI-Anfrage gestellt. Aus: Es wird immer ein frischer Vorschlag erzeugt.',
      },
    ],
    outputs: [
      {
        name: 'reply_suggestion.status',
        label: 'Status des Vorschlags',
        description: '"ready" wenn ein Vorschlag vorliegt, "failed" wenn die Erzeugung fehlschlug.',
        example: 'ready',
        type: 'string',
      },
      {
        name: 'reply_suggestion.text',
        label: 'Vorschlags-Text',
        description: 'Der erzeugte Antwortvorschlag (nur bei Status "ready").',
        type: 'string',
      },
      {
        name: 'reply_suggestion.error',
        label: 'Fehlermeldung',
        description: 'Nur gesetzt, wenn die Erzeugung fehlschlug.',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Erzeugt einen KI-Antwortvorschlag, der im Lesebereich der Mail zum Übernehmen angeboten wird — ' +
        'unabhängig davon, ob automatische Vorschläge global aktiviert sind (praktisch nach einer ' +
        'Kategorie-Sortierung im Workflow). Der Knoten legt KEINEN Entwurf an und setzt kein draft.id — ' +
        'zum automatischen Versenden „KI: Textbaustein wählen“, „KI-Agent“ oder „Antwort-Entwurf erstellen“ nutzen. ' +
        'Läuft nur bei eingehenden Mails; für No-Reply-/Automaten-Absender wird er übersprungen.',
      prerequisites: [
        'Ein KI-Profil mit API-Schlüssel (Einstellungen → E-Mail → KI).',
      ],
      seeAlso: ['ai.pick_canned', 'ai.agent', 'email.create_draft'],
    },
  },

  'ai.agent_tool': {
    fields: [
      {
        key: 'tool',
        type: 'select',
        label: 'Werkzeug',
        help:
          'Welche Aktion ausgeführt wird. Das Ergebnis landet immer in der Variable tool.result. ' +
          'Ein unbekannter Werkzeug-Name gibt einfach den Anfang des Mail-Textes zurück (Echo, zum Testen).',
        options: [
          {
            value: 'search_knowledge',
            label: 'Wissensbasis durchsuchen',
            description: 'Sucht die 3 passendsten Textauszüge zur aktuellen Mail.',
          },
          {
            value: 'get_canned',
            label: 'Textbaustein-Titel abrufen',
            description: 'Listet die Titel der ersten 5 Textbausteine auf.',
          },
        ],
      },
      {
        key: 'knowledgeBaseId',
        type: 'knowledgeBase',
        label: 'Wissensbasis',
        help:
          'Nur für „Wissensbasis durchsuchen“: In dieser Wissensbasis wird gesucht. ' +
          'Leer = der Knoten wird übersprungen (keine automatische Auswahl).',
        showIf: { field: 'tool', equals: 'search_knowledge' },
      },
    ],
    outputs: [
      {
        name: 'tool.result',
        label: 'Werkzeug-Ergebnis',
        description:
          'Gefundene Wissens-Auszüge (max. 4000 Zeichen), Textbaustein-Titel oder der Mail-Anfang (Echo).',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Hilfs-Baustein ohne eigenen KI-Aufruf: holt Material (Wissens-Auszüge oder Textbaustein-Titel) ' +
        'in die Variable tool.result, damit nachfolgende KI-Knoten es per {{tool.result}} verwenden können. ' +
        'Für die meisten Fälle ist der Knoten „KI-Agent“ die einfachere Wahl — er sucht selbst in der Wissensbasis.',
      prerequisites: [
        'Für „Wissensbasis durchsuchen“: eine Wissensbasis muss ausgewählt sein — sonst wird der Knoten übersprungen.',
        'Für „Textbaustein-Titel abrufen“: mindestens ein Textbaustein (Einstellungen → E-Mail → Textbausteine).',
      ],
      seeAlso: ['ai.agent', 'ai.pick_canned'],
    },
  },

  'ai.pick_canned': {
    fields: [
      {
        key: 'profileId',
        type: 'aiProfile',
        label: 'KI-Profil (Anbieter & Modell)',
        help: 'Welches KI-Modell den passenden Textbaustein auswählt. Leer = Standard-Profil.',
      },
      {
        key: 'createDraft',
        type: 'boolean',
        label: 'Antwort-Entwurf direkt anlegen',
        help:
          'Legt eine fertig adressierte Antwort mit dem gewählten Textbaustein an und setzt die Variable draft.id — ' +
          'die kann „Entwurf versenden“ direkt verschicken. Platzhalter wie {{customer.name}} im Baustein werden gefüllt.',
      },
    ],
    outputs: [
      {
        name: 'ai.canned.pick',
        label: 'Gewählter Baustein (Nummer)',
        description: '0 = kein Baustein passte.',
        example: '2',
        type: 'number',
      },
      { name: 'ai.canned.id', label: 'Baustein-ID', type: 'number' },
      { name: 'ai.canned.title', label: 'Baustein-Titel', example: 'Retourenlabel', type: 'string' },
      { name: 'ai.canned.text', label: 'Fertiger Antworttext', type: 'string' },
      {
        name: 'draft.id',
        label: 'Entwurfs-Nummer',
        description: 'Nur gesetzt, wenn „Entwurf direkt anlegen“ aktiv ist und ein Baustein passte.',
        example: '123',
        type: 'number',
      },
    ],
    docs: {
      longHelp:
        'Die KI liest die Kundenmail, wählt den am besten passenden Textbaustein aus deiner Sammlung ' +
        'und legt daraus (optional) einen adressierten Antwort-Entwurf an. Passt kein Baustein, wählt sie 0 — ' +
        'dann wird kein Entwurf angelegt und draft.id bleibt leer.',
      prerequisites: [
        'Mindestens ein Textbaustein (Einstellungen → E-Mail → Textbausteine) — sonst bricht der Knoten mit einem Fehler ab.',
        'Ein KI-Profil mit API-Schlüssel.',
      ],
      seeAlso: ['email.send_draft', 'email.auto_reply', 'ai.agent'],
    },
  },
};
