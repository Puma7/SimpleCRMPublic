import type { WorkflowNodeSchemaExtension } from '../node-schema';

/**
 * Feld-/Port-/Output-Schemata der logic.*- und workflow.*-Knoten
 * (Ablaufsteuerung: Stopp, Variablen, Verzögerung, Verzweigung, Schleife, Subflow).
 */
export const LOGIC_NODE_SCHEMAS: Record<string, WorkflowNodeSchemaExtension> = {
  'logic.stop': {
    docs: {
      longHelp:
        'Beendet den Workflow an dieser Stelle sauber — ohne Fehler und ohne dass etwas blockiert wird. ' +
        'Praktisch als klar sichtbares Ende eines Zweigs, z. B. „Spam erkannt → markieren → Stopp“. ' +
        'Knoten hinter dem Stopp werden nie ausgeführt. Der Knoten braucht keine Einstellungen.',
      seeAlso: ['logic.merge', 'email.hold_outbound'],
    },
  },

  'logic.set_variable': {
    fields: [
      {
        key: 'name',
        type: 'variableName',
        label: 'Name der Variable',
        help:
          'Unter diesem Namen wird der Wert abgelegt. Folge-Knoten können ihn dann als {{Name}} einsetzen — ' +
          'z. B. in „Tag setzen“ oder „Antwort-Entwurf erstellen“. Existiert die Variable schon, wird sie überschrieben.',
        example: 'kunde.status',
        placeholder: 'z. B. kunde.status',
        required: true,
      },
      {
        key: 'value',
        type: 'text',
        label: 'Wert',
        help:
          'Dieser Wert wird in der Variable gespeichert (als Text). Platzhalter wie {{ai.class}} oder ' +
          '{{subject}} werden beim Ausführen ersetzt — so lassen sich auch Werte anderer Knoten kopieren oder kombinieren.',
        example: 'VIP-Kunde: {{customer.name}}',
        interpolate: true,
      },
    ],
    outputs: [
      {
        name: 'var',
        label: 'Gesetzte Variable',
        description: 'Der gespeicherte Wert — der Variablenname kommt aus dem Feld „Name der Variable“.',
        type: 'string',
        dynamicFromField: 'name',
      },
    ],
    docs: {
      longHelp:
        'Legt eine eigene Workflow-Variable an (oder überschreibt sie). Variablen leben nur während ' +
        'eines Workflow-Laufs und stehen allen nachfolgenden Knoten als {{Name}} zur Verfügung — ' +
        'z. B. um ein Zwischenergebnis zu merken oder Texte für spätere Knoten vorzubereiten.',
      seeAlso: ['logic.switch', 'logic.threshold', 'ai.transform_text'],
    },
  },

  'logic.delay': {
    fields: [
      {
        key: 'delaySeconds',
        type: 'duration',
        label: 'Wartezeit (Sekunden)',
        help:
          'So lange pausiert der Workflow, bevor es mit dem nächsten Knoten weitergeht. ' +
          'Mindestens 1 Sekunde, höchstens 7 Tage. Die Pause übersteht auch einen Neustart des Programms.',
        example: '300',
        placeholder: '60',
        required: true,
        validation: { min: 1, max: 604800, integer: true },
      },
      {
        key: 'resumeNodeId',
        type: 'text',
        label: 'Fortsetzungs-Knoten (Knoten-ID, optional)',
        help:
          'Nur für Sonderfälle: Nach der Pause geht es bei genau diesem Knoten weiter statt beim ' +
          'nächsten Knoten hinter der Verzögerung. Normalerweise leer lassen — der Folgeknoten wird ' +
          'automatisch über die Kante hinter der Verzögerung gefunden.',
        advanced: true,
      },
      {
        key: 'minutes',
        type: 'number',
        label: 'Wartezeit (Minuten, veraltet)',
        help:
          'Alter Einstellungs-Name aus früheren Versionen. Wird nur noch gelesen, wenn ' +
          '„Wartezeit (Sekunden)“ gar nicht gesetzt ist — neue Workflows nutzen immer das Sekunden-Feld.',
        advanced: true,
        validation: { min: 1, integer: true },
      },
    ],
    docs: {
      longHelp:
        'Pausiert den Workflow für die angegebene Zeit — z. B. „5 Minuten warten, dann prüfen, ob der ' +
        'Kunde schon geantwortet hat“. Technisch endet der Lauf am Verzögerungs-Knoten und wird zum ' +
        'geplanten Zeitpunkt beim Folgeknoten fortgesetzt; alle bis dahin gesetzten Variablen bleiben erhalten. ' +
        'Die Pause übersteht Neustarts. WICHTIG: Hinter der Verzögerung muss eine Kante zu einem ' +
        'Folgeknoten führen — sonst bricht der Knoten mit einem Fehler ab, weil er nicht weiß, wo es weitergeht.',
      seeAlso: ['logic.stop', 'crm.create_task'],
    },
  },

  'logic.merge': {
    docs: {
      longHelp:
        'Sammelt mehrere Zweige wieder an einem Punkt: Alle eingehenden Kanten münden hier, danach geht es ' +
        'mit EINEM gemeinsamen Strang weiter. Der Knoten tut selbst nichts und hat keine Einstellungen — ' +
        'er hält den Workflow nur übersichtlich, wenn z. B. „Ja“- und „Nein“-Zweig am Ende dieselben ' +
        'Aufräum-Schritte ausführen sollen. Es wird immer nur der Zweig fortgesetzt, der gerade hier ankommt — ' +
        'der Knoten wartet NICHT, bis alle Zweige eingetroffen sind.',
      seeAlso: ['logic.switch', 'logic.threshold', 'logic.stop'],
    },
  },

  'logic.threshold': {
    fields: [
      {
        key: 'variable',
        type: 'variableRef',
        label: 'Variable mit dem Zahlenwert',
        help:
          'Diese Workflow-Variable wird mit dem Grenzwert verglichen. Sie muss eine Zahl enthalten — ' +
          'z. B. ai.spam_score aus der KI-Spam-Prüfung oder ai.class_confidence aus der KI-Klassifizierung. ' +
          'Ist der Wert keine Zahl, bricht der Knoten mit einem Fehler ab.',
        example: 'ai.spam_score',
        placeholder: 'ai.spam_score',
        required: true,
      },
      {
        key: 'operator',
        type: 'select',
        label: 'Vergleich',
        help:
          '„Mindestens“ nimmt den Ja-Ausgang, wenn der Wert gleich oder größer als der Grenzwert ist — ' +
          'typisch für Spam („ab 70 als Spam behandeln“). „Höchstens“ für den umgekehrten Fall.',
        required: true,
        options: [
          { value: 'gte', label: 'Mindestens (Wert ≥ Grenzwert)' },
          { value: 'lte', label: 'Höchstens (Wert ≤ Grenzwert)' },
        ],
      },
      {
        key: 'value',
        type: 'number',
        label: 'Grenzwert',
        help:
          'Mit dieser Zahl wird verglichen. Für Spam-Wahrscheinlichkeit und KI-Sicherheit sind Werte ' +
          'zwischen 0 und 100 üblich. Wird ignoriert, wenn unten der globale Spam-Schwellwert aktiv ist.',
        example: '70',
        required: true,
      },
      {
        key: 'useGlobalThreshold',
        type: 'boolean',
        label: 'Globalen Spam-Schwellwert aus den Einstellungen verwenden',
        help:
          'Ein: statt des Grenzwerts oben gilt der zentrale Spam-Schwellwert aus Einstellungen → E-Mail. ' +
          'Praktisch, wenn mehrere Workflows denselben Wert nutzen sollen — eine Änderung in den ' +
          'Einstellungen wirkt dann überall.',
      },
    ],
    ports: [
      {
        id: 'yes',
        label: 'Ja',
        description: 'Der Vergleich trifft zu (z. B. Spam-Wert liegt über dem Grenzwert).',
        kind: 'branch',
        color: 'emerald',
        synonyms: ['ja', 'true', 'success'],
      },
      {
        id: 'no',
        label: 'Nein',
        description: 'Der Vergleich trifft nicht zu.',
        kind: 'branch',
        color: 'amber',
        synonyms: ['nein', 'false'],
      },
    ],
    outputs: [
      {
        name: 'threshold.matched',
        label: 'Vergleich zugetroffen',
        description: 'true, wenn es am Ja-Ausgang weiterging.',
        type: 'boolean',
      },
    ],
    docs: {
      longHelp:
        'Vergleicht eine Zahlen-Variable mit einem Grenzwert und verzweigt in „Ja“ oder „Nein“ — ' +
        'das Standard-Werkzeug nach der KI-Spam-Prüfung („ab 70 → als Spam markieren“) oder nach der ' +
        'KI-Klassifizierung („nur bei hoher Sicherheit automatisch antworten“).',
      prerequisites: [
        'Ein vorheriger Knoten muss die Zahlen-Variable füllen (z. B. „KI-Spam-Prüfung“ für ai.spam_score).',
      ],
      seeAlso: ['ai.spam_score', 'email.mark_spam', 'logic.switch'],
    },
  },

  'logic.switch': {
    customWidget: 'switchCases',
    fields: [
      {
        key: 'field',
        type: 'variableRef',
        label: 'Variable, nach der verzweigt wird',
        help:
          'Der Wert dieser Workflow-Variable entscheidet, welcher Ausgang genommen wird. ' +
          'Typisch: ai.class aus der KI-Klassifizierung. Groß-/Kleinschreibung und Leerzeichen ' +
          'am Rand spielen beim Vergleich keine Rolle.',
        example: 'ai.class',
        placeholder: 'ai.class',
        required: true,
      },
      {
        key: 'cases',
        type: 'text',
        label: 'Fälle (mit Komma getrennt)',
        help:
          'Für jeden Fall entsteht ein eigener Ausgang: Die abgehende Kante bekommt als Beschriftung ' +
          'genau den Fall-Namen. Passt der Wert der Variable zu keinem Fall, geht es über die Kante ' +
          '„default“ weiter.',
        example: 'Frage, Bestellstatus, Reklamation',
        required: true,
      },
    ],
    outputs: [],
    docs: {
      longHelp:
        'Verzweigt anhand einer Variable in beliebig viele Zweige — z. B. nach der KI-Klassifizierung ' +
        'jede Kategorie in einen eigenen Ablauf. Die Ausgänge entstehen DYNAMISCH aus den Fällen: ' +
        'Für jeden Fall wird die abgehende Kante mit dem Fall-Namen beschriftet (Groß-/Kleinschreibung egal), ' +
        'dazu kommt immer die Auffang-Kante „default“ für alle Werte, die zu keinem Fall passen. ' +
        'Deshalb hat dieser Knoten keine festen Ausgänge im Katalog. Ohne verbundene default-Kante ' +
        'endet der Workflow bei einem unbekannten Wert einfach.',
      prerequisites: [
        'Ein vorheriger Knoten muss die Variable füllen (z. B. „KI-Klassifizierung“ für ai.class).',
      ],
      seeAlso: ['ai.classify', 'logic.threshold', 'logic.merge'],
    },
  },

  'logic.loop': {
    customWidget: 'loopBuilder',
    fields: [
      {
        key: 'sourceVariable',
        type: 'variableRef',
        label: 'Variable mit der Liste',
        help:
          'Aus dieser Workflow-Variable kommt die Liste, über die die Schleife läuft. Die Einträge werden ' +
          'an Komma, Semikolon oder Zeilenumbruch getrennt. Vorbelegt ist attachment_names — ' +
          'die Dateinamen der Mail-Anhänge.',
        example: 'attachment_names',
        placeholder: 'attachment_names',
      },
      {
        key: 'items',
        type: 'textarea',
        label: 'Feste Liste (Ersatz, wenn die Variable leer ist)',
        help:
          'Nur wenn die Variable oben leer ist oder fehlt, läuft die Schleife über diese feste Liste — ' +
          'Einträge mit Komma, Semikolon oder je einer pro Zeile. Praktisch zum Testen.',
        example: 'rechnung.pdf, lieferschein.pdf',
        placeholder: 'eins, zwei, drei',
      },
      {
        key: 'maxItems',
        type: 'number',
        label: 'Höchstens so viele Einträge verarbeiten',
        help:
          'Schutz vor sehr langen Listen: Nach dieser Anzahl bricht die Schleife ab und geht zum ' +
          'Ausgang „Fertig“. Erlaubt sind 1 bis 500.',
        example: '50',
        validation: { min: 1, max: 500, integer: true },
      },
    ],
    ports: [
      {
        id: 'each',
        label: 'Je Eintrag',
        description:
          'Dieser Zweig läuft für JEDEN Listen-Eintrag einmal — darin stehen loop.item (der Eintrag) ' +
          'und loop.index (die laufende Nummer ab 0) bereit.',
        kind: 'branch',
        color: 'violet',
        synonyms: ['je', 'loop'],
      },
      {
        id: 'done',
        label: 'Fertig',
        description: 'Hier geht es weiter, wenn alle Einträge verarbeitet sind — oder die Liste leer war.',
        kind: 'success',
        color: 'emerald',
        synonyms: ['fertig', 'end'],
      },
    ],
    outputs: [
      {
        name: 'loop.item',
        label: 'Aktueller Listen-Eintrag',
        description: 'Der Eintrag des laufenden Durchgangs — im „Je Eintrag“-Zweig als {{loop.item}} nutzbar.',
        example: 'rechnung.pdf',
        type: 'string',
      },
      {
        name: 'loop.index',
        label: 'Laufende Nummer',
        description: 'Position des aktuellen Eintrags, beginnend bei 0.',
        example: '0',
        type: 'number',
      },
    ],
    docs: {
      longHelp:
        'Führt den „Je Eintrag“-Zweig für jeden Eintrag einer Liste einmal aus — z. B. für jeden ' +
        'Anhangs-Namen einen Tag setzen. In jedem Durchgang stehen {{loop.item}} und {{loop.index}} bereit. ' +
        'Ist die Liste leer oder keine „Je Eintrag“-Kante verbunden, geht es direkt bei „Fertig“ weiter. ' +
        'Bricht ein Durchgang mit einem Fehler ab, endet der ganze Workflow. ' +
        'Hinweis: Enthält ein Auslöser-Ereignis einen Wert mit demselben Namen wie die Listen-Variable, ' +
        'hat der Ereignis-Wert Vorrang vor der Workflow-Variable.',
      seeAlso: ['logic.set_variable', 'email.tag', 'logic.merge'],
    },
  },

  'workflow.subflow': {
    fields: [
      {
        key: 'workflowId',
        type: 'workflowRef',
        label: 'Workflow, der ausgeführt werden soll',
        help:
          'Dieser Workflow wird als Unter-Ablauf komplett ausgeführt, danach geht es hier weiter. ' +
          'Der gewählte Workflow muss aktiviert sein und darf nicht der aktuelle Workflow selbst sein — ' +
          'sonst bricht der Knoten mit einem Fehler ab.',
        required: true,
      },
    ],
    outputs: [
      {
        name: 'subflow.status',
        label: 'Ergebnis des Unter-Workflows',
        description: '"ok" bei Erfolg, "error" bei Fehler, "blocked" wenn der Unter-Workflow blockiert hat.',
        example: 'ok',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Ruft einen anderen Workflow als Baustein auf — so lassen sich wiederkehrende Abläufe ' +
        '(z. B. „Spam-Behandlung“) einmal bauen und in mehreren Workflows verwenden. Der Unter-Workflow ' +
        'läuft auf derselben Mail und bekommt eine KOPIE aller bisherigen Variablen mit. ' +
        'Variablen, die er selbst setzt, kommen NICHT zurück — hier landet nur subflow.status. ' +
        'Blockiert der Unter-Workflow (z. B. Versand-Sperre), gilt das auch für den aufrufenden Workflow; ' +
        'endet er mit Fehler, endet auch dieser Workflow mit Fehler.',
      prerequisites: [
        'Der aufgerufene Workflow muss existieren und aktiviert sein — deaktivierte Workflows führen zu einem Fehler.',
      ],
      seeAlso: ['logic.stop', 'logic.set_variable'],
    },
  },
};
