/**
 * Platzhalter-Auflösung für Workflow-Konfigfelder ({{subject}},
 * {{customer.name}}, …) — EINE Semantik für Desktop-Runtime
 * (electron/workflow/context.ts delegiert hierher) und Server-Ausführung
 * (packages/server/src/workflow-execution.ts, Pre-Pass).
 *
 * Single-Pass: bereits eingesetzte Werte werden NIE erneut gescannt —
 * ein {{…}} im Mail-Inhalt kann sich also nicht selbst auflösen (Injection).
 * Keys mit mehreren Punkten werden exakt aufgelöst; unbekannte Platzhalter
 * bleiben unverändert stehen. Key = alles außer geschweiften Klammern
 * (Variablennamen dürfen Umlaute, Leerzeichen etc. enthalten —
 * logic.set_variable erlaubt freie Namen).
 *
 * Präzedenz: {{text}} (= combined_text) → strings → variables.
 */
export type WorkflowInterpolationScope = {
  strings: Record<string, string | undefined>;
  variables: Record<string, string | number | boolean | null | undefined>;
};

export function interpolateWorkflowPlaceholders(
  template: string,
  scope: WorkflowInterpolationScope,
): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key: string) => {
    if (key === 'text') return scope.strings.combined_text ?? '';
    if (Object.prototype.hasOwnProperty.call(scope.strings, key)) {
      return scope.strings[key] ?? '';
    }
    if (Object.prototype.hasOwnProperty.call(scope.variables, key)) {
      return String(scope.variables[key] ?? '');
    }
    return match;
  });
}
