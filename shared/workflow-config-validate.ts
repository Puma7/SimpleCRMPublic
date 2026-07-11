/**
 * Reine Konfigurations-Validierung anhand des deklarativen Knoten-Schemas.
 * Läuft inline im Eigenschaften-Panel (pro Feld) und aggregiert beim
 * Speichern (workflow-shell): `error` blockiert das Speichern,
 * `warning` wird als Hinweis gezeigt.
 */

import type { WorkflowNodeFieldSchema } from './workflow-node-schema';
import type { WorkflowNodeCatalogEntry } from './workflow-types';

export type WorkflowConfigIssue = {
  fieldKey: string;
  fieldLabel: string;
  severity: 'error' | 'warning';
  message: string;
};

function isEmpty(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

/**
 * showIf auswerten — versteckte Felder werden nicht validiert.
 * Mit defaultConfig-Fallback (wie das UI in schema-fields.tsx): frisch
 * gezogene Knoten haben eine leere Config, das steuernde Select zeigt aber
 * den Default — Sichtbarkeit und Validierung müssen dieselbe Sicht haben.
 */
function isFieldVisible(
  field: WorkflowNodeFieldSchema,
  config: Record<string, unknown>,
  defaultConfig?: Record<string, unknown>,
): boolean {
  if (!field.showIf) return true;
  const raw = config[field.showIf.field];
  const value = raw !== undefined ? raw : defaultConfig?.[field.showIf.field];
  return value === field.showIf.equals;
}

export function validateNodeConfig(
  entry: Pick<WorkflowNodeCatalogEntry, 'fields' | 'defaultConfig'>,
  config: Record<string, unknown>,
): WorkflowConfigIssue[] {
  const issues: WorkflowConfigIssue[] = [];
  for (const field of entry.fields ?? []) {
    if (!isFieldVisible(field, config, entry.defaultConfig)) continue;
    const value = config[field.key];

    if (isEmpty(value)) {
      if (field.required) {
        // Bewusst nur WARNUNG: die Laufzeit überspringt Knoten mit leeren
        // Pflichtfeldern gutmütig (z. B. email.tag → "skipped"), und
        // Bestands-Workflows mit leeren Feldern müssen speicherbar bleiben.
        // Blockierende Fehler sind Wertebereichs-/Typ-Verstöße (unten).
        issues.push({
          fieldKey: field.key,
          fieldLabel: field.label,
          severity: 'warning',
          message: `„${field.label}“ ist leer — der Knoten wird beim Lauf übersprungen.`,
        });
      }
      continue;
    }

    if (field.type === 'number' || field.type === 'duration') {
      const num = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(num)) {
        issues.push({
          fieldKey: field.key,
          fieldLabel: field.label,
          severity: 'error',
          message: `„${field.label}“ muss eine Zahl sein.`,
        });
        continue;
      }
      const v = field.validation;
      if (v?.integer && !Number.isInteger(num)) {
        issues.push({
          fieldKey: field.key,
          fieldLabel: field.label,
          severity: 'error',
          message: `„${field.label}“ muss eine ganze Zahl sein.`,
        });
      }
      if (v?.min !== undefined && num < v.min) {
        issues.push({
          fieldKey: field.key,
          fieldLabel: field.label,
          severity: 'error',
          message: `„${field.label}“ muss mindestens ${v.min} sein.`,
        });
      }
      if (v?.max !== undefined && num > v.max) {
        issues.push({
          fieldKey: field.key,
          fieldLabel: field.label,
          severity: 'error',
          message: `„${field.label}“ darf höchstens ${v.max} sein.`,
        });
      }
      continue;
    }

    if (typeof value === 'string') {
      const v = field.validation;
      if (v?.maxLength !== undefined && value.length > v.maxLength) {
        issues.push({
          fieldKey: field.key,
          fieldLabel: field.label,
          severity: 'error',
          message: `„${field.label}“ ist zu lang (max. ${v.maxLength} Zeichen).`,
        });
      }
      if (v?.pattern) {
        let re: RegExp | null = null;
        try {
          re = new RegExp(v.pattern);
        } catch {
          re = null;
        }
        if (re && !re.test(value)) {
          issues.push({
            fieldKey: field.key,
            fieldLabel: field.label,
            severity: 'error',
            message: v.patternHint
              ? `„${field.label}“: ${v.patternHint}`
              : `„${field.label}“ hat nicht das erwartete Format.`,
          });
        }
      }
      if (field.type === 'select' && field.options?.length) {
        if (!field.options.some((o) => o.value === value)) {
          issues.push({
            fieldKey: field.key,
            fieldLabel: field.label,
            severity: 'warning',
            message: `„${field.label}“ hat einen unbekannten Wert („${value}“).`,
          });
        }
      }
    }
  }
  return issues;
}

export type WorkflowGraphNodeForValidation = {
  id: string;
  /** Registry-Knotentyp oder null (Trigger/Bedingung/Legacy-Aktion). */
  nodeType: string | null;
  /** Anzeige-Label für Fehlermeldungen. */
  title: string;
  config: Record<string, unknown>;
};

export type WorkflowGraphEdgeForValidation = {
  source: string;
  label?: string | null;
};

export type WorkflowGraphIssue = {
  nodeId: string;
  nodeTitle: string;
  severity: 'error' | 'warning';
  message: string;
};

/**
 * Graph-weite Prüfung beim Speichern: Config-Fehler pro Knoten plus
 * Kanten-Warnungen an Mehrfach-Port-Knoten (eine unbeschriftete Kante
 * fängt dort JEDEN Port — meist ein Versehen).
 */
export function validateWorkflowGraphConfigs(
  nodes: readonly WorkflowGraphNodeForValidation[],
  edges: readonly WorkflowGraphEdgeForValidation[],
  catalogByType: ReadonlyMap<string, WorkflowNodeCatalogEntry>,
): WorkflowGraphIssue[] {
  const issues: WorkflowGraphIssue[] = [];

  for (const node of nodes) {
    if (!node.nodeType) continue;
    const entry = catalogByType.get(node.nodeType);
    if (!entry) continue;

    for (const issue of validateNodeConfig(entry, node.config)) {
      issues.push({
        nodeId: node.id,
        nodeTitle: node.title,
        severity: issue.severity,
        message: issue.message,
      });
    }

    if (entry.ports && entry.ports.length > 1) {
      const outgoing = edges.filter((e) => e.source === node.id);
      // Gleiche Akzeptanz wie die UI-Normalisierung: Port-ID, deutsches
      // Port-Label und deklarierte Synonyme.
      const validIds = new Set(entry.ports.map((p) => p.id.toLowerCase()));
      const synonyms = new Map<string, string>();
      for (const p of entry.ports) {
        synonyms.set(p.label.toLowerCase(), p.id);
        for (const s of p.synonyms ?? []) synonyms.set(s.toLowerCase(), p.id);
      }
      for (const e of outgoing) {
        const label = (e.label ?? '').trim().toLowerCase();
        if (!label) {
          issues.push({
            nodeId: node.id,
            nodeTitle: node.title,
            severity: 'warning',
            message:
              `„${node.title}“ hat mehrere Ausgänge (${entry.ports.map((p) => p.label).join(', ')}), ` +
              'aber eine Kante ohne Beschriftung — sie würde JEDEN Ausgang auffangen. Bitte Kante beschriften.',
          });
        } else if (!validIds.has(label) && !synonyms.has(label)) {
          issues.push({
            nodeId: node.id,
            nodeTitle: node.title,
            severity: 'warning',
            message:
              `Kanten-Beschriftung „${e.label}“ passt zu keinem Ausgang von „${node.title}“ ` +
              `(gültig: ${entry.ports.map((p) => p.id).join(', ')}) — dieser Weg wird nie durchlaufen.`,
          });
        }
      }
    }
  }

  return issues;
}
