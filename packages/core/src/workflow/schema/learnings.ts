import type { WorkflowNodeSchemaExtension } from '../node-schema';

/**
 * TA-P5 „Learnings auswerten“ (docs/MAIL_TEILAUTOMATISIERUNG.md 4.2). Eigene
 * Datei, damit die übrigen KI-Schemata unberührt bleiben.
 */
export const LEARNINGS_NODE_SCHEMAS: Record<string, WorkflowNodeSchemaExtension> = {
  'ai.learnings_digest': {
    fields: [
      {
        key: 'knowledgeBaseId',
        type: 'knowledgeBase',
        label: 'Ziel-Wissensbasis',
        help:
          'In welche Wissensbasis die vorgeschlagenen Änderungen gehören. Leer = Einstellung unter ' +
          'Einstellungen → Learnings (ohne Einstellung: eigene Wissensbasis „Learnings“, wird beim ersten Vorschlag angelegt).',
      },
      {
        key: 'period',
        type: 'select',
        label: 'Zeitraum',
        help: 'Welche gesammelten Einträge ausgewertet werden. Ältere Einträge bleiben für spätere Auswertungen liegen.',
        options: [
          { value: 'since_last', label: 'Seit der letzten Auswertung' },
          { value: 'day', label: 'Letzter Tag' },
          { value: 'week', label: 'Letzte Woche' },
          { value: 'month', label: 'Letzter Monat' },
        ],
      },
      {
        key: 'minCandidates',
        type: 'number',
        label: 'Mindestanzahl gesammelter Einträge',
        help: 'Liegen weniger Einträge vor, passiert nichts (Ausgabe learnings.status = skipped_no_candidates).',
        example: '3',
        validation: { min: 1, max: 200, integer: true },
      },
      {
        key: 'profileId',
        type: 'aiProfile',
        label: 'KI-Profil (Chat-Modell)',
        help: 'Leer = Einstellung unter Einstellungen → Learnings bzw. Standard-Profil. Entscheidungsmodelle eignen sich nicht.',
        advanced: true,
      },
    ],
    outputs: [
      {
        name: 'learnings.status',
        label: 'Ergebnis',
        description:
          'queued (Server: Auswertung eingereiht), created (Vorschlag angelegt), skipped_no_candidates (zu wenige Einträge), ' +
          'skipped_pending (es gibt schon einen offenen Vorschlag), failed (Fehler).',
        example: 'created',
        type: 'string',
      },
      {
        name: 'learnings.digest_id',
        label: 'Vorschlags-Nummer',
        description: 'Leer, wenn kein Vorschlag angelegt wurde (auf dem Server erst nach dem Hintergrund-Job).',
        example: '12',
        type: 'number',
      },
      {
        name: 'learnings.candidate_count',
        label: 'Ausgewertete Einträge',
        example: '8',
        type: 'number',
      },
    ],
    docs: {
      longHelp:
        'Wertet die gesammelten Learnings (geänderte KI-Entwürfe, menschliche Antworten, Notizen) per KI aus und legt ' +
        'unter Einstellungen → Learnings einen Vorschlag für die neue Fassung der Wissensbasis an. Der Baustein ändert ' +
        'die Wissensbasis nie selbst — ein Owner/Admin prüft den Vorschlag und übernimmt oder verwirft ihn. ' +
        'Gedacht für Workflows mit Zeitplan oder manuellem Start; in eingehenden/ausgehenden Workflows wird er übersprungen. ' +
        'Gibt es schon einen offenen Vorschlag für die Wissensbasis, entsteht kein zweiter.',
      prerequisites: [
        'Learnings sammeln ist eingeschaltet (Einstellungen → Learnings) oder es gibt Notizen.',
        'Ein KI-Profil mit Chat-Modell und API-Schlüssel.',
      ],
      seeAlso: ['ai.agent', 'ai.draft_reply'],
    },
  },
};
