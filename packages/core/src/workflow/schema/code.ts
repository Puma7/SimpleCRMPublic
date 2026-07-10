import type { WorkflowNodeSchemaExtension } from '../node-schema';

/**
 * Feld-/Port-/Output-Schemata der code.*- und plugin.*-Knoten.
 * Alle drei Knoten führen fremden bzw. eigenen Code aus — die Hilfetexte
 * warnen deshalb ausdrücklich vor den Sicherheits-Grenzen.
 */
export const CODE_NODE_SCHEMAS: Record<string, WorkflowNodeSchemaExtension> = {
  'code.javascript': {
    customWidget: 'code',
    fields: [
      {
        key: 'code',
        type: 'code',
        language: 'javascript',
        label: 'JavaScript-Code',
        help:
          'Dieser Code läuft beim Ausführen des Knotens. Am Ende result = { name: wert } setzen — ' +
          'jeder Eintrag wird zu einer Workflow-Variable für die Folge-Knoten. ' +
          'Bleibt das Feld leer, wird der Knoten übersprungen.',
        example: 'result = { begruessung: "Hallo " + ctx.strings.from_name };',
        required: true,
      },
    ],
    docs: {
      longHelp:
        'Führt eigenen JavaScript-Code innerhalb des Workflows aus (max. 30 Sekunden Laufzeit). ' +
        'Der Code sieht folgende Werte: ctx.strings (alle Text-Platzhalter der Mail, z. B. ctx.strings.subject), ' +
        'ctx.variables (alle bisher gesetzten Workflow-Variablen), ctx.messageId (interne Nummer der Nachricht) ' +
        'und ctx.dryRun (true im Testlauf). Das sind KOPIEN — Änderungen daran wirken nicht zurück. ' +
        'Zusätzlich stehen JSON, Math und Date bereit; andere eingebaute Objekte, require oder fetch gibt es nicht, ' +
        'und await/asynchroner Code wird nicht unterstützt. ' +
        'Ergebnisse gibt man zurück, indem man result = { name: wert } setzt: Jeder Eintrag wird zur ' +
        'Workflow-Variable (Texte, Zahlen, Ja/Nein und leer bleiben erhalten; alles andere wird als JSON-Text gespeichert). ' +
        'Wird kein result gesetzt, entstehen keine Variablen. Ein Fehler im Code lässt den Knoten mit Fehler enden. ' +
        'Im Testlauf (Trockenlauf) wird der Code gar nicht ausgeführt. ' +
        'WICHTIG: Es gibt KEINE echte Sandbox — der Code läuft mit den Rechten der App und kann im schlimmsten ' +
        'Fall aus der Umgebung ausbrechen. Nur Code einfügen, den man selbst geschrieben hat oder vollständig versteht.',
      prerequisites: [
        'Nur selbst geschriebenen oder vollständig geprüften Code verwenden — es gibt keine echte Sandbox.',
      ],
      seeAlso: ['code.python', 'plugin.custom', 'logic.set_variable'],
    },
  },

  'code.python': {
    customWidget: 'code',
    fields: [
      {
        key: 'code',
        type: 'code',
        language: 'python',
        label: 'Python-Code',
        help:
          'Dieser Code wird mit python3 ausgeführt. Alles, was er mit print() ausgibt, landet in der ' +
          'Workflow-Variable python.stdout. Bleibt das Feld leer, wird der Knoten übersprungen.',
        example: 'import os, json\nctx = json.loads(os.environ["WORKFLOW_CTX"])\nprint(ctx.get("subject", ""))',
        required: true,
      },
    ],
    outputs: [
      {
        name: 'python.stdout',
        label: 'Ausgabe des Python-Skripts',
        description:
          'Alles, was das Skript mit print() ausgibt (ohne Leerzeichen/Zeilenumbrüche am Anfang und Ende). ' +
          'Folge-Knoten können es als {{python.stdout}} einsetzen.',
        example: 'Bestellung 12345 gefunden',
        type: 'string',
      },
    ],
    docs: {
      longHelp:
        'Startet ein kleines Python-Programm als eigenen Prozess (max. 30 Sekunden Laufzeit). ' +
        'Die Mail-Daten bekommt das Skript über die Umgebungsvariable WORKFLOW_CTX: Sie enthält alle ' +
        'Text-Platzhalter der Mail (subject, from_address, body_text, …) als JSON — im Skript mit ' +
        'json.loads(os.environ["WORKFLOW_CTX"]) einlesen. Workflow-Variablen anderer Knoten sind darin ' +
        'NICHT enthalten; wer sie braucht, setzt sie vorher per Platzhalter in den Code ein oder nutzt den ' +
        'JavaScript-Knoten. Die gesamte print()-Ausgabe landet in der Variable python.stdout. ' +
        'Endet das Skript mit einem Fehler, endet der Knoten mit Fehler (die Fehlermeldung ist die ' +
        'Fehlerausgabe des Skripts). Im Testlauf (Trockenlauf) wird nichts ausgeführt. ' +
        'WICHTIG: Das Skript läuft mit den vollen Rechten des angemeldeten Benutzers auf diesem Rechner ' +
        '(Dateien lesen/schreiben, Netzwerk) — nur eigenen, geprüften Code verwenden.',
      prerequisites: [
        'Python 3 muss auf dem Rechner installiert und als „python3“ aufrufbar sein (unter Windows ggf. nachinstallieren).',
        'Nur selbst geschriebenen oder vollständig geprüften Code verwenden — das Skript hat vollen Zugriff auf den Rechner.',
      ],
      seeAlso: ['code.javascript', 'plugin.custom'],
    },
  },

  'plugin.custom': {
    fields: [
      {
        key: 'pluginId',
        type: 'text',
        label: 'Plugin-Kennung',
        help:
          'Die Kennung (id) aus der Manifest-Datei des Plugins. Plugins liegen als Ordner mit einer ' +
          '.json-Manifest-Datei im Datenverzeichnis der App unter „workflow-plugins“. ' +
          'Bleibt das Feld leer, wird der Knoten übersprungen.',
        example: 'mein-firmen-plugin',
        placeholder: 'z. B. mein-firmen-plugin',
        required: true,
      },
      {
        key: 'handler',
        type: 'text',
        label: 'Funktion (Handler)',
        help:
          'Welche Funktion des Plugins ausgeführt wird — die Kennung eines Eintrags aus der handlers-Liste ' +
          'im Manifest. Ein Plugin kann mehrere Funktionen anbieten. Bleibt das Feld leer, wird der Knoten übersprungen.',
        example: 'bestellung-pruefen',
        placeholder: 'z. B. bestellung-pruefen',
        required: true,
      },
    ],
    docs: {
      longHelp:
        'Ruft eine selbst installierte Erweiterung (Plugin) auf. Plugins liegen im Datenverzeichnis der App ' +
        'im Unterordner „workflow-plugins“: pro Plugin eine Manifest-Datei (.json) mit Kennung, Name und der ' +
        'Liste der Funktionen (handlers) sowie je Funktion eine JavaScript-Datei, die eine run()-Funktion ' +
        'exportiert (module.exports.run = async (ctx, config) => { … }). ' +
        'run() bekommt die Mail-Platzhalter (ctx.strings), die Workflow-Variablen (ctx.variables) und die ' +
        'Nachrichten-Nummer (ctx.messageId) sowie die komplette Knoten-Konfiguration — zusätzliche eigene ' +
        'Einstellungs-Felder lassen sich über den Experten-Modus (JSON) mitgeben. ' +
        'Gibt run() ein Objekt der Form { variables: { name: wert } } zurück, werden diese Einträge zu ' +
        'Workflow-Variablen für die Folge-Knoten (max. 50 Stück; komplexe Werte werden als JSON-Text gespeichert). ' +
        'Nach spätestens 30 Sekunden wird die Funktion abgebrochen. Der Knoten ist im Servermodus nicht verfügbar. ' +
        'WICHTIG: Plugins laufen ohne echte Sandbox mit den Rechten der App — nur Plugins aus vertrauenswürdiger ' +
        'Quelle installieren.',
      prerequisites: [
        'Das Plugin muss installiert sein: Manifest-Datei (.json) und Handler-Datei (.js) im App-Datenverzeichnis unter „workflow-plugins“.',
        'Die Handler-Datei muss eine run()-Funktion exportieren, sonst endet der Knoten mit Fehler.',
        'Nur Plugins aus vertrauenswürdiger Quelle verwenden — sie laufen mit vollen App-Rechten.',
      ],
      seeAlso: ['code.javascript', 'code.python', 'http.request'],
    },
  },
};
