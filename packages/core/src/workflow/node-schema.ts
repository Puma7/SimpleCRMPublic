/**
 * Deklaratives Konfigurations-Schema für Workflow-Knoten.
 *
 * Eine Quelle der Wahrheit: Aus diesen Feld-/Port-/Output-Deklarationen werden
 * generiert: das Formular im Eigenschaften-Panel, die Validierung (inline und
 * beim Speichern), die Canvas-Ports samt Kantenlabel-Restriktion, die
 * Variablen-Vorschläge und die Knoten-Referenz.
 *
 * WICHTIG (Kompatibilität): `WorkflowNodeFieldSchema.key` MUSS den bestehenden
 * defaultConfig-Keys entsprechen — gespeicherte graph_json-Dokumente dürfen
 * durch Schema-Änderungen nie brechen.
 *
 * Spiegel-Typen für den Renderer: `shared/workflow-node-schema.ts`
 * (der Renderer darf @simplecrm/core nicht importieren; Sync wird per Test
 * erzwungen, siehe tests/unit/workflow-node-catalog-sync.test.ts).
 */

export type WorkflowFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'aiProfile'
  | 'promptId'
  | 'knowledgeBase'
  | 'cannedResponse'
  | 'teamMember'
  | 'account'
  | 'workflowRef'
  /** Node SCHREIBT unter diesem Namen eine Variable (Ziel; Namens-Validierung). */
  | 'variableName'
  /** Node LIEST eine Variable → Picker mit Vorschlägen aus vorgelagerten Knoten. */
  | 'variableRef'
  | 'categoryPath'
  | 'duration'
  | 'cron'
  | 'code';

export type WorkflowFieldOption = {
  value: string;
  label: string;
  description?: string;
};

export type WorkflowFieldValidation = {
  min?: number;
  max?: number;
  integer?: boolean;
  /** RegExp-Quelltext (ohne Flags); Prüfung case-sensitiv. */
  pattern?: string;
  /** Laienverständliche Erklärung, was das Muster verlangt. */
  patternHint?: string;
  maxLength?: number;
};

export type WorkflowNodeFieldSchema = {
  /** MUSS bestehendem defaultConfig-Key entsprechen (Kompatibilität!). */
  key: string;
  type: WorkflowFieldType;
  /** Deutsch, laienfreundlich — keine rohen Variablen-/Fachbegriffe ohne Erklärung. */
  label: string;
  /** Hilfetext unter dem Feld: Was bewirkt es, woher kommen die Werte? */
  help?: string;
  /** Konkretes Beispiel (wird als „z. B. …“ angezeigt). */
  example?: string;
  placeholder?: string;
  required?: boolean;
  /** Für type 'select'. */
  options?: WorkflowFieldOption[];
  validation?: WorkflowFieldValidation;
  /**
   * {{Platzhalter}} in diesem Feld werden zur Laufzeit ZENTRAL aufgelöst
   * (Pre-Pass im Interpreter, Kopie — nie persistiert).
   * Niemals auf code-/JSON-Felder setzen.
   */
  interpolate?: boolean;
  /** Einklappen unter „Erweitert“. */
  advanced?: boolean;
  /** Für type 'code'. */
  language?: 'javascript' | 'python';
  /** Feld nur zeigen, wenn ein anderes Feld einen bestimmten Wert hat. */
  showIf?: { field: string; equals: unknown };
  /**
   * Feld-Ebene des Node-runtime-Flags: 'desktop' = nur der Desktop-Executor
   * wertet dieses Feld aus — der Server-Katalog blendet es aus, statt eine
   * Konfiguration zu bewerben, die die Server-Ausführung ignoriert.
   */
  runtime?: 'both' | 'desktop';
};

export type WorkflowNodePortSchema = {
  /** Laufzeit-Port == Kantenlabel (pickEdge matcht exakt, case-insensitiv). */
  id: string;
  /** Deutsch, kurz — erscheint am Canvas-Handle und im Kanten-Dropdown. */
  label: string;
  /** Wann geht es hier weiter? */
  description?: string;
  kind: 'success' | 'branch' | 'failure';
  color?: 'emerald' | 'amber' | 'red' | 'violet' | 'sky';
  /** Nur UI-Normalisierung (de/en); die Engine matcht weiterhin exakt + default. */
  synonyms?: string[];
};

export type WorkflowNodeOutputSchema = {
  /** Variablenname, z. B. 'ai.class_confidence'. */
  name: string;
  label: string;
  description?: string;
  example?: string;
  type: 'string' | 'number' | 'boolean';
  /**
   * Der tatsächliche Variablenname steht in diesem Config-Feld
   * (z. B. logic.set_variable.name, ai.transform_text.targetVariable).
   */
  dynamicFromField?: string;
};

export type WorkflowNodeDocsSchema = {
  /** Ausführlichere Erklärung für Referenz-Dialog/Handbuch. */
  longHelp?: string;
  /** Was muss eingerichtet sein, damit der Knoten funktioniert? */
  prerequisites?: string[];
  /** Verwandte Knoten-Typen. */
  seeAlso?: string[];
};

/** Schema-Erweiterung eines Katalogeintrags (fields/ports/outputs/docs). */
export type WorkflowNodeSchemaExtension = {
  fields?: WorkflowNodeFieldSchema[];
  ports?: WorkflowNodePortSchema[];
  outputs?: WorkflowNodeOutputSchema[];
  docs?: WorkflowNodeDocsSchema;
  /**
   * Name eines Spezial-Widgets im Renderer, das das generierte Formular
   * ersetzt oder ergänzt (z. B. 'switchCases', 'loopBuilder', 'code',
   * 'jtlOrderContext').
   */
  customWidget?: string;
};
