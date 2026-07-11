import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '@simplecrm/core';

import type { ServerApiPorts } from './api';
import { isServerWorkflowNodeTypeSupported } from './workflow-node-catalog';

/**
 * Nur Vorlagen anbieten, deren sämtliche Registry-Knoten der Server auch
 * ausführen kann. Desktop-only-Vorlagen (z. B. die Zwei-Stufen-KI-Antwort mit
 * ai.draft_reply/ai.review_draft) ließen sich sonst im HTTP-Modus zwar laden
 * und speichern, blieben aber zur Laufzeit am nicht unterstützten Knoten
 * stecken. Engine-Primitive (trigger/condition/switch/…) sind immer da —
 * geprüft wird nur data.nodeType.
 */
export function listServerWorkflowTemplates(): WorkflowTemplate[] {
  return WORKFLOW_TEMPLATES.filter((template) =>
    template.graph.nodes.every((node) => {
      const nodeType = node.data.nodeType;
      return typeof nodeType !== 'string' || isServerWorkflowNodeTypeSupported(nodeType);
    }),
  );
}

export function createStaticWorkflowTemplatePort(): NonNullable<ServerApiPorts['workflowTemplates']> {
  return {
    list() {
      return listServerWorkflowTemplates();
    },
  };
}
